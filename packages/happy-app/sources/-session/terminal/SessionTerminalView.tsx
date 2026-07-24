import * as React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { useUnistyles } from 'react-native-unistyles';
import { encodeBase64 } from '@/encryption/base64';
import { apiSocket } from '@/sync/apiSocket';
import type { Session } from '@/sync/storageTypes';
import { subscribeTerminalOutput } from './terminalOutputBus';
import { TerminalOrderer } from './terminalOrdering';
import { loadTerminalWebviewAssets, type TerminalWebviewAssets } from './terminalWebviewAsset';

/** Keystroke text (UTF-16 JS string from xterm onData) -> base64 UTF-8 bytes. */
function textToBase64(text: string): string {
    return encodeBase64(new TextEncoder().encode(text), 'base64');
}

// Coalesce output chunks before crossing the JS bridge - terminal output can
// burst, and one injectJavaScript per 16ms keeps the bridge quiet without lag.
const WRITE_BATCH_MS = 16;

function buildHtml(assets: TerminalWebviewAssets, colors: { background: string; foreground: string; selection: string }): string {
    // Escape the script-terminator sequence so the inlined JS bundles can't
    // prematurely close the <script> tag.
    const safeJs = (js: string) => js.replace(/<\/script>/gi, '<\\/script>');
    const bg = JSON.stringify(colors.background);
    const fg = JSON.stringify(colors.foreground);
    const sel = JSON.stringify(colors.selection);
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<style>
${assets.css}
html,body{margin:0;padding:0;height:100%;background:${colors.background};overflow:hidden;-webkit-user-select:none;user-select:none;}
#term-container{width:100%;height:100%;padding:4px;box-sizing:border-box;}
</style>
</head>
<body>
<div id="term-container"></div>
<script>${safeJs(assets.xtermJs)}</script>
<script>${safeJs(assets.fitJs)}</script>
<script>
(function(){
  var post = function(msg){ window.ReactNativeWebView.postMessage(JSON.stringify(msg)); };
  var term = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: 'ui-monospace, "SF Mono", "Cascadia Code", "Segoe UI Mono", Menlo, Monaco, Consolas, monospace',
    theme: { background: ${bg}, foreground: ${fg}, cursor: ${fg}, cursorAccent: ${bg}, selectionBackground: ${sel} }
  });
  var fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(document.getElementById('term-container'));

  function fitAndReport(){
    try { fit.fit(); } catch (e) {}
    post({ type: 'resize', cols: term.cols, rows: term.rows });
  }
  function b64ToBytes(b64){
    var bin = atob(b64);
    var len = bin.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) { bytes[i] = bin.charCodeAt(i); }
    return bytes;
  }
  // App -> WebView: write an array of base64-encoded UTF-8 byte chunks. Each
  // chunk is decoded to a Uint8Array (not a string) so xterm can buffer
  // split multibyte sequences across chunk boundaries.
  window.__happyTermWriteBase64 = function(arr){
    for (var i = 0; i < arr.length; i++) {
      try { term.write(b64ToBytes(arr[i])); } catch (e) {}
    }
  };
  // WebView -> App: keystrokes
  term.onData(function(data){ post({ type: 'input', data: data }); });
  // WebView -> App: size changes (container resize + initial fit)
  var ro = new ResizeObserver(function(){ fitAndReport(); });
  ro.observe(document.getElementById('term-container'));
  setTimeout(function(){ fitAndReport(); post({ type: 'ready' }); }, 0);
})();
</script>
</body>
</html>`;
}

type MessageHandler = (event: WebViewMessageEvent) => void;

export const SessionTerminalView = React.memo(function SessionTerminalView(props: { session: Session }) {
    const { theme } = useUnistyles();
    const sessionId = props.session.id;
    const webviewRef = React.useRef<WebView>(null);
    const messageHandlerRef = React.useRef<MessageHandler>(() => {});

    const isConnected = props.session.presence === 'online' && props.session.active;
    const [html, setHtml] = React.useState<string | null>(null);

    // Load the vendored xterm assets once and build the WebView HTML. Built on
    // mount only - rebuilding would reload the WebView and drop terminal state.
    React.useEffect(() => {
        let cancelled = false;
        const colors = {
            background: theme.colors.surface,
            foreground: theme.colors.text,
            selection: theme.colors.surfaceSelected,
        };
        loadTerminalWebviewAssets()
            .then((assets) => {
                if (!cancelled) {
                    setHtml(buildHtml(assets, colors));
                }
            })
            .catch((error) => console.warn('[terminal] Failed to load webview assets:', error));
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Wire ordering + the output bus to the WebView once the HTML is ready.
    React.useEffect(() => {
        if (!html) {
            return;
        }
        let disposed = false;
        let webviewReady = false;
        const pendingWrites: string[] = [];
        let flushTimer: ReturnType<typeof setTimeout> | null = null;

        const flush = () => {
            flushTimer = null;
            if (pendingWrites.length === 0) {
                return;
            }
            const batch = JSON.stringify(pendingWrites);
            pendingWrites.length = 0;
            // IIFE so the evaluated program's completion value is undefined
            // (iOS WKWebView crashes on non-null/non-undefined results).
            webviewRef.current?.injectJavaScript(`;(function(){ window.__happyTermWriteBase64(${batch}); })();`);
        };
        const scheduleFlush = () => {
            if (flushTimer === null) {
                flushTimer = setTimeout(flush, WRITE_BATCH_MS);
            }
        };

        const orderer = new TerminalOrderer((event) => {
            if (disposed) {
                return;
            }
            if (event.type === 'write') {
                // Buffer always; flush only once the WebView can render.
                pendingWrites.push(event.data);
                if (webviewReady) {
                    scheduleFlush();
                }
            } else {
                apiSocket.sessionRPC(sessionId, 'terminal-attach', { t: 'attach' })
                    .catch((error) => console.warn('[terminal] Resync attach failed:', error));
            }
        });

        const unsubscribe = subscribeTerminalOutput(sessionId, (chunk) => {
            if (!disposed) {
                orderer.push(chunk);
            }
        });

        // The WebView signals readiness once xterm is mounted. At that point we
        // flush anything buffered and request the snapshot (settle flushes any
        // live chunks that arrived in the meantime in seq order).
        const onReady = () => {
            if (disposed || webviewReady) {
                return;
            }
            webviewReady = true;
            flush();
            apiSocket.sessionRPC(sessionId, 'terminal-attach', { t: 'attach' })
                .catch((error) => console.warn('[terminal] terminal-attach failed:', error))
                .finally(() => {
                    if (!disposed) {
                        orderer.settle();
                    }
                });
        };

        messageHandlerRef.current = (event: WebViewMessageEvent) => {
            let msg: { type?: string; data?: string; cols?: number; rows?: number };
            try {
                msg = JSON.parse(event.nativeEvent.data);
            } catch {
                return;
            }
            if (msg.type === 'ready') {
                onReady();
            } else if (msg.type === 'input' && typeof msg.data === 'string') {
                apiSocket.sessionRPC(sessionId, 'terminal-input', { t: 'input', data: textToBase64(msg.data) })
                    .catch((error) => console.warn('[terminal] terminal-input failed:', error));
            } else if (msg.type === 'resize' && typeof msg.cols === 'number' && typeof msg.rows === 'number') {
                apiSocket.sessionRPC(sessionId, 'terminal-resize', { t: 'resize', cols: msg.cols, rows: msg.rows })
                    .catch((error) => console.warn('[terminal] terminal-resize failed:', error));
            }
        };

        return () => {
            disposed = true;
            if (flushTimer !== null) {
                clearTimeout(flushTimer);
            }
            unsubscribe();
        };
    }, [html, sessionId]);

    return (
        <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
            {html ? (
                <WebView
                    ref={webviewRef}
                    source={{ html }}
                    style={{ flex: 1, backgroundColor: theme.colors.surface }}
                    scrollEnabled={false}
                    javaScriptEnabled={true}
                    onMessage={(event) => messageHandlerRef.current(event)}
                />
            ) : (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                    <ActivityIndicator color={theme.colors.textSecondary} />
                </View>
            )}
            {!isConnected && (
                <View style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'rgba(0, 0, 0, 0.5)',
                }}>
                    <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '600' }}>
                        Session disconnected
                    </Text>
                </View>
            )}
        </View>
    );
});
