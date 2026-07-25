import * as React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import * as Clipboard from 'expo-clipboard';
import { useUnistyles } from 'react-native-unistyles';
import { encodeBase64 } from '@/encryption/base64';
import { apiSocket } from '@/sync/apiSocket';
import type { Session } from '@/sync/storageTypes';
import { t } from '@/text';
import { Button } from '@/components/ui/button';
import { Text as UiText } from '@/components/ui/text';
import { subscribeTerminalOutput } from './terminalOutputBus';
import { TerminalOrderer } from './terminalOrdering';
import { DEFAULT_TERMINAL_ANSI_COLORS } from './terminalTheme';
import { loadTerminalWebviewAssets, type TerminalWebviewAssets } from './terminalWebviewAsset';
import { TerminalToolbar, type TerminalConnectionState } from './TerminalToolbar';
import type { TerminalAttachResponse } from '@slopus/happy-wire';

/** Keystroke text (UTF-16 JS string from xterm onData) -> base64 UTF-8 bytes. */
function textToBase64(text: string): string {
    return encodeBase64(new TextEncoder().encode(text), 'base64');
}

// Coalesce output chunks before crossing the JS bridge - terminal output can
// burst, and one injectJavaScript per 16ms keeps the bridge quiet without lag.
const WRITE_BATCH_MS = 16;
const DEFAULT_FONT_SIZE = 13;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 24;
const COPIED_FEEDBACK_MS = 2000;

function buildHtml(assets: TerminalWebviewAssets, colors: { background: string; foreground: string; selection: string }): string {
    // Escape the script-terminator sequence so the inlined JS bundles can't
    // prematurely close the <script> tag.
    const safeJs = (js: string) => js.replace(/<\/script>/gi, '<\\/script>');
    const bg = JSON.stringify(colors.background);
    const fg = JSON.stringify(colors.foreground);
    const sel = JSON.stringify(colors.selection);
    const ansi = JSON.stringify(DEFAULT_TERMINAL_ANSI_COLORS);
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<style>
${assets.css}
@font-face {
  font-family: 'SarasaTerm';
  src: url(data:font/woff2;base64,${assets.fontBase64}) format('woff2');
  font-weight: normal;
  font-style: normal;
  font-display: block;
}
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
  var ansi = ${ansi};
  var term = new Terminal({
    cursorBlink: true,
    fontSize: ${DEFAULT_FONT_SIZE},
    // Embedded Sarasa Term SC first: one font covers Latin + box drawing +
    // CJK, so the WebView never depends on (broken) system font fallback.
    fontFamily: '"SarasaTerm", ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace',
    theme: Object.assign({ background: ${bg}, foreground: ${fg}, cursor: ${fg}, cursorAccent: ${bg}, selectionBackground: ${sel} }, ansi)
  });
  var fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(document.getElementById('term-container'));

  function fitAndReport(){
    try { fit.fit(); } catch (e) {}
    post({ type: 'resize', cols: term.cols, rows: term.rows });
  }
  // App -> WebView control bridge (toolbar actions, host theme sync).
  window.__happyTermSetTheme = function(theme){ term.options.theme = theme; };
  window.__happyTermClear = function(){ term.clear(); };
  window.__happyTermReset = function(){ term.reset(); };
  window.__happyTermSetFontSize = function(size){ term.options.fontSize = size; fitAndReport(); };
  window.__happyTermGetBuffer = function(){
    var buf = term.buffer.active;
    var lines = [];
    for (var i = 0; i < buf.length; i++) {
      var line = buf.getLine ? buf.getLine(i) : buf.get(i);
      lines.push(line ? line.translateToString(true) : '');
    }
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') { lines.pop(); }
    post({ type: 'buffer', data: lines.join('\\n') });
  };

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
  // Keep xterm's hidden textarea focused so tapping the terminal always
  // raises the software keyboard (iOS requires an explicit focus call).
  term.focus();
  document.getElementById('term-container').addEventListener('touchend', function(){
    setTimeout(function(){ term.focus(); }, 0);
  });
  window.__happyTermFocus = function(){ term.focus(); };
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

interface TerminalControls {
    reconnect: () => void;
    copyAll: () => void;
    clear: () => void;
    changeFontSize: (delta: number) => void;
}

export const SessionTerminalView = React.memo(function SessionTerminalView(props: { session: Session }) {
    const { theme } = useUnistyles();
    const sessionId = props.session.id;
    const webviewRef = React.useRef<WebView>(null);
    const messageHandlerRef = React.useRef<MessageHandler>(() => {});
    const controlsRef = React.useRef<TerminalControls | null>(null);
    const fontSizeRef = React.useRef(DEFAULT_FONT_SIZE);
    const copiedTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const [attaching, setAttaching] = React.useState(false);
    const [copied, setCopied] = React.useState(false);

    const isConnected = props.session.presence === 'online' && props.session.active;
    const connectionState: TerminalConnectionState = !isConnected
        ? 'disconnected'
        : attaching
            ? 'connecting'
            : 'connected';
    const [html, setHtml] = React.useState<string | null>(null);

    const showCopiedFeedback = React.useCallback(() => {
        setCopied(true);
        if (copiedTimeoutRef.current !== null) {
            clearTimeout(copiedTimeoutRef.current);
        }
        copiedTimeoutRef.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    }, []);

    React.useEffect(() => {
        return () => {
            if (copiedTimeoutRef.current !== null) {
                clearTimeout(copiedTimeoutRef.current);
            }
        };
    }, []);

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

        const inject = (js: string) => {
            webviewRef.current?.injectJavaScript(`;(function(){ ${js} })();`);
        };

        const flush = () => {
            flushTimer = null;
            if (pendingWrites.length === 0) {
                return;
            }
            const batch = JSON.stringify(pendingWrites);
            pendingWrites.length = 0;
            // IIFE so the evaluated program's completion value is undefined
            // (iOS WKWebView crashes on non-null/non-undefined results).
            inject(`window.__happyTermWriteBase64(${batch});`);
        };
        const scheduleFlush = () => {
            if (flushTimer === null) {
                flushTimer = setTimeout(flush, WRITE_BATCH_MS);
            }
        };

        // Push the host's synced terminal colors into the WebView's xterm.
        const applySyncedTheme = (response: TerminalAttachResponse) => {
            if (disposed || !response.theme) {
                return;
            }
            const synced = response.theme;
            const themeObj = {
                background: synced.background ?? theme.colors.surface,
                foreground: synced.foreground ?? theme.colors.text,
                cursor: synced.cursor ?? theme.colors.text,
                cursorAccent: synced.cursorAccent ?? theme.colors.surface,
                selectionBackground: synced.selectionBackground ?? theme.colors.surfaceSelected,
                ...DEFAULT_TERMINAL_ANSI_COLORS,
                ...Object.fromEntries(
                    Object.entries(synced).filter(([, v]) => v != null),
                ),
            };
            inject(`window.__happyTermSetTheme(${JSON.stringify(themeObj)});`);
        };

        // Attach = fetch the CLI snapshot (and host theme), then settle the
        // orderer so buffered history flushes in order. Re-runnable from the
        // toolbar's reconnect action.
        const attach = () => {
            setAttaching(true);
            apiSocket.sessionRPC<TerminalAttachResponse, { t: 'attach' }>(sessionId, 'terminal-attach', { t: 'attach' })
                .then(applySyncedTheme)
                .catch((error) => console.warn('[terminal] terminal-attach failed:', error))
                .finally(() => {
                    if (!disposed) {
                        orderer.settle();
                        setAttaching(false);
                    }
                });
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
                attach();
            }
        });

        const unsubscribe = subscribeTerminalOutput(sessionId, (chunk) => {
            if (!disposed) {
                orderer.push(chunk);
            }
        });

        controlsRef.current = {
            reconnect: () => {
                // Wipe the WebView's screen and re-fetch the snapshot; the
                // orderer's pending buffer merges it with any live chunks
                // that arrive while the attach is in flight.
                inject('window.__happyTermReset();');
                orderer.reset();
                attach();
            },
            copyAll: () => {
                // The buffer text comes back as a { type: 'buffer' } message.
                inject('window.__happyTermGetBuffer();');
            },
            clear: () => {
                inject('window.__happyTermClear();');
            },
            changeFontSize: (delta: number) => {
                const clamped = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, fontSizeRef.current + delta));
                if (clamped === fontSizeRef.current) {
                    return;
                }
                fontSizeRef.current = clamped;
                // The WebView refits and posts the new cols/rows back to us.
                inject(`window.__happyTermSetFontSize(${clamped});`);
            },
        };

        // The WebView signals readiness once xterm is mounted. At that point we
        // flush anything buffered and request the snapshot (settle flushes any
        // live chunks that arrived in the meantime in seq order).
        const onReady = () => {
            if (disposed || webviewReady) {
                return;
            }
            webviewReady = true;
            flush();
            attach();
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
            } else if (msg.type === 'buffer' && typeof msg.data === 'string') {
                if (msg.data.length > 0) {
                    Clipboard.setStringAsync(msg.data)
                        .then(showCopiedFeedback)
                        .catch((error) => console.warn('[terminal] Copy failed:', error));
                }
            }
        };

        return () => {
            disposed = true;
            controlsRef.current = null;
            if (flushTimer !== null) {
                clearTimeout(flushTimer);
            }
            unsubscribe();
        };
    }, [html, sessionId]);

    return (
        <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
            <TerminalToolbar
                connectionState={connectionState}
                copied={copied}
                onReconnect={() => controlsRef.current?.reconnect()}
                onCopyAll={() => controlsRef.current?.copyAll()}
                onClear={() => controlsRef.current?.clear()}
                onFontSizeChange={(delta) => controlsRef.current?.changeFontSize(delta)}
            />
            {html ? (
                <WebView
                    ref={webviewRef}
                    source={{ html }}
                    style={{ flex: 1, backgroundColor: theme.colors.surface }}
                    scrollEnabled={false}
                    javaScriptEnabled={true}
                    onMessage={(event) => messageHandlerRef.current(event)}
                    // Let the page raise the software keyboard from JS focus
                    // calls; without this iOS swallows them outside a gesture.
                    keyboardDisplayRequiresUserAction={false}
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
                    <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '600', marginBottom: 16 }}>
                        {t('terminal.disconnected')}
                    </Text>
                    <Button
                        variant="secondary"
                        onPress={() => controlsRef.current?.reconnect()}
                        disabled={attaching}
                    >
                        {attaching && <ActivityIndicator size="small" style={{ marginRight: 4 }} />}
                        <UiText>{attaching ? t('terminal.connecting') : t('terminal.reconnect')}</UiText>
                    </Button>
                </View>
            )}
        </View>
    );
});
