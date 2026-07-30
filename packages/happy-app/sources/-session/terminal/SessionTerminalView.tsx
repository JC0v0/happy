import * as React from 'react';
import { ActivityIndicator, Keyboard, Text, useWindowDimensions, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import * as Clipboard from 'expo-clipboard';
import {
    loadTerminalFontSize,
    loadTerminalHistory,
    loadTerminalLastBlock,
    loadOrCreateTerminalDeviceId,
    loadTerminalViewMode,
    saveTerminalFontSize,
    saveTerminalLastBlock,
    saveTerminalViewMode,
    setTerminalHistoryFavorite,
    type TerminalViewMode,
} from '@/sync/persistence';
import { decodeBase64, encodeBase64 } from '@/encryption/base64';
import { apiSocket } from '@/sync/apiSocket';
import type { Session } from '@/sync/storageTypes';
import { t } from '@/text';
import { Button } from '@/components/ui/button';
import { Text as UiText } from '@/components/ui/text';
import { subscribeTerminalOutput } from './terminalOutputBus';
import { TerminalOrderer, type TerminalMetadataEvent } from './terminalOrdering';
import { TerminalRecordMux, terminalEventBelongsToDevice } from './terminalRecordMux';
import { DEFAULT_TERMINAL_ANSI_COLORS_DARK, DEFAULT_TERMINAL_ANSI_COLORS_LIGHT } from './terminalTheme';
import { loadTerminalWebviewAssets, type TerminalWebviewAssets } from './terminalWebviewAsset';
import { TERMINAL_TOUCH_SCROLL_SCRIPT } from './terminalTouchScroll';
import { TerminalCommandDock, TerminalToolbar, type TerminalConnectionState } from './TerminalToolbar';
import { TerminalBlockTranscript } from './TerminalBlockTranscript';
import { TerminalHistorySheet } from './TerminalHistorySheet';
import { persistCompletedTerminalCommand } from './terminalHistory';
import {
    applyTerminalAttachState,
    appendTerminalCommandOutput,
    EMPTY_TERMINAL_COMMAND_STATE,
    latestTerminalCommandBlock,
    mergeTerminalCommandStates,
    reduceTerminalCommandState,
    type TerminalCommandStatesById,
} from './terminalCommandState';
import { TerminalTranscriptDecoder, terminalBlockOutputText, terminalTranscriptText } from './terminalTranscript';
import { useTerminalModifierInput } from './use-terminal-modifiers';
import { resolveTerminalPalette } from './terminalVisualTheme';
import { SHARED_TERMINAL_COLS, SHARED_TERMINAL_ROWS } from './terminalSharedGrid';
import type { TerminalAttachResponse, TerminalExecuteResponse } from '@slopus/happy-wire';
import { SkiaTerminalView } from './skia/SkiaTerminalView';
import { useSkiaTerminal } from './skia/useSkiaTerminal';

/** Keystroke text (UTF-16 JS string from xterm onData) -> base64 UTF-8 bytes. */
function textToBase64(text: string): string {
    return encodeBase64(new TextEncoder().encode(text), 'base64');
}

// Coalesce output chunks before crossing the JS bridge - terminal output can
// burst, and one injectJavaScript per 16ms keeps the bridge quiet without lag.
const WRITE_BATCH_MS = 16;
const DEFAULT_FONT_SIZE = 13;
const PHONE_FONT_SIZE = 10;
const PHONE_MAX_WIDTH = 480;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 24;
const COPIED_FEEDBACK_MS = 2000;

function buildHtml(
    assets: TerminalWebviewAssets,
    colors: { background: string; foreground: string; selection: string; ansi: Record<string, string> },
    initialFontSize: number,
): string {
    // Escape the script-terminator sequence so the inlined JS bundles can't
    // prematurely close the <script> tag.
    const safeJs = (js: string) => js.replace(/<\/script>/gi, '<\\/script>');
    const bg = JSON.stringify(colors.background);
    const fg = JSON.stringify(colors.foreground);
    const sel = JSON.stringify(colors.selection);
    const ansi = JSON.stringify(colors.ansi);
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
#term-container{width:100%;height:100%;padding:4px;box-sizing:border-box;touch-action:none;overscroll-behavior:contain;}
.xterm .xterm-viewport{background-color:${colors.background};}
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
    allowProposedApi: true,
    cursorBlink: true,
    fontSize: ${initialFontSize},
    // Embedded Sarasa Term SC first: one font covers Latin + box drawing +
    // CJK, so the WebView never depends on (broken) system font fallback.
    fontFamily: '"SarasaTerm", ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace',
    theme: Object.assign({ background: ${bg}, foreground: ${fg}, cursor: ${fg}, cursorAccent: ${bg}, selectionBackground: ${sel} }, ansi)
  });
  var fit = new FitAddon.FitAddon();
  var happyBaseFontSize = ${initialFontSize};
  var happyFontZoom = 0;
  var happyGridCols = ${SHARED_TERMINAL_COLS};
  var happyGridRows = ${SHARED_TERMINAL_ROWS};
  term.loadAddon(fit);
  term.open(document.getElementById('term-container'));

  function fitSharedGrid(reportViewport){
    term.options.fontSize = happyBaseFontSize;
    try { fit.fit(); } catch (e) {}
    var measuredCols = term.cols;
    var measuredRows = term.rows;
    var scale = Math.min(measuredCols / happyGridCols, measuredRows / happyGridRows);
    if (!isFinite(scale) || scale <= 0) { scale = 1; }
    var fittedFontSize = Math.floor((happyBaseFontSize * scale + happyFontZoom) * 10) / 10;
    fittedFontSize = Math.max(${MIN_FONT_SIZE}, Math.min(${MAX_FONT_SIZE}, fittedFontSize));
    term.options.fontSize = fittedFontSize;
    term.resize(happyGridCols, happyGridRows);
    document.getElementById('term-container').dataset.grid = term.cols + 'x' + term.rows;
    if (reportViewport) {
      post({ type: 'resize', cols: measuredCols, rows: measuredRows });
    }
  }
  // App -> WebView control bridge (toolbar actions, host theme sync).
  window.__happyTermSetTheme = function(theme){ term.options.theme = theme; var vp=document.querySelector('.xterm-viewport'); if(vp&&theme.background)vp.style.backgroundColor=theme.background; };
  window.__happyTermClear = function(){ term.clear(); };
  window.__happyTermReset = function(){ term.reset(); };
  window.__happyTermSetFontSize = function(size){ happyFontZoom = size - happyBaseFontSize; fitSharedGrid(false); };
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
  var happyBlocks = Object.create(null);
  function decorateBlock(record){
    if (!record || !record.startMarker || !term.registerDecoration) { return; }
    try {
      var decoration = term.registerDecoration({ marker: record.startMarker, x: 0, width: term.cols, layer: 'bottom' });
      if (!decoration) { return; }
      record.decoration = decoration;
      decoration.onRender(function(element){
        record.element = element;
        element.style.borderLeft = '3px solid ' + (record.color || '#B86BFF');
        element.style.background = record.background || 'rgba(184,107,255,0.10)';
        element.style.boxSizing = 'border-box';
        element.style.pointerEvents = 'none';
      });
    } catch (e) {}
  }
  window.__happyTermApplyMetadata = function(event){
    if (!event || !event.t) { return; }
    if (event.t === 'grid') {
      happyGridCols = event.cols;
      happyGridRows = event.rows;
      fitSharedGrid(false);
    } else if (event.t === 'command-start') {
      var existing = happyBlocks[event.commandId];
      if (existing && existing.startMarker) { return; }
      var marker = term.registerMarker ? term.registerMarker(0) : null;
      var record = { startMarker: marker, command: event.command, color: '#B86BFF', background: 'rgba(184,107,255,0.10)' };
      happyBlocks[event.commandId] = record;
      decorateBlock(record);
    } else if (event.t === 'command-end') {
      var record = happyBlocks[event.commandId] || {};
      record.endMarker = term.registerMarker ? term.registerMarker(0) : null;
      record.endColumn = term.buffer.active.cursorX;
      record.color = event.exitCode === 0 ? '#6DD58C' : '#FF6B78';
      record.background = event.exitCode === 0 ? 'rgba(109,213,140,0.07)' : 'rgba(255,107,120,0.08)';
      if (record.element) {
        record.element.style.borderLeftColor = record.color;
        record.element.style.background = record.background;
      }
      happyBlocks[event.commandId] = record;
    }
  };
  window.__happyTermGetBlockBuffer = function(commandId){
    var record = happyBlocks[commandId];
    if (!record || !record.startMarker) { post({ type: 'block-buffer', commandId: commandId, data: '' }); return; }
    var buf = term.buffer.active;
    var start = Math.max(0, record.startMarker.line + 1);
    var end = record.endMarker ? record.endMarker.line : (buf.baseY + buf.cursorY);
    var lines = [];
    if (start > end) { post({ type: 'block-buffer', commandId: commandId, data: '' }); return; }
    for (var i = start; i <= end; i++) {
      var line = buf.getLine ? buf.getLine(i) : buf.get(i);
      var text = line ? line.translateToString(true) : '';
      if (i === end && typeof record.endColumn === 'number') { text = text.slice(0, record.endColumn); }
      lines.push(text);
    }
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') { lines.pop(); }
    post({ type: 'block-buffer', commandId: commandId, data: lines.join('\\n') });
  };
  window.__happyTermScrollToBlock = function(commandId){
    var record = happyBlocks[commandId];
    if (record && record.startMarker) { term.scrollToLine(record.startMarker.line); }
    term.focus();
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
    window.__happyTermRender(arr.map(function(data){ return { type: 'write', data: data }; }));
  };
  var happyRenderQueue = [];
  var happyRenderActive = false;
  function drainHappyRenderQueue(){
    if (happyRenderActive || happyRenderQueue.length === 0) { return; }
    happyRenderActive = true;
    var item = happyRenderQueue.shift();
    if (item.type === 'write') {
      try {
        term.write(b64ToBytes(item.data), function(){ happyRenderActive = false; drainHappyRenderQueue(); });
      } catch (e) {
        happyRenderActive = false;
        drainHappyRenderQueue();
      }
    } else if (item.type === 'metadata') {
      try { window.__happyTermApplyMetadata(item.event); } catch (e) {}
      happyRenderActive = false;
      drainHappyRenderQueue();
    } else {
      happyRenderActive = false;
      drainHappyRenderQueue();
    }
  }
  window.__happyTermRender = function(items){
    for (var i = 0; i < items.length; i++) { happyRenderQueue.push(items[i]); }
    drainHappyRenderQueue();
  };
  // WebView -> App: keystrokes
  term.onData(function(data){ post({ type: 'input', data: data }); });
  // Keep xterm's hidden textarea focused. The touch bridge focuses it again
  // after a tap, while leaving vertical drags available for scrollback.
  term.focus();
${TERMINAL_TOUCH_SCROLL_SCRIPT}
  window.__happyTermFocus = function(){ term.focus(); };
  // Report physical capacity; render only the sequenced grid confirmed by
  // the CLI, so passive viewers never resize the collaborative PTY.
  var ro = new ResizeObserver(function(){ fitSharedGrid(true); });
  ro.observe(document.getElementById('term-container'));
  if (document.fonts && document.fonts.ready) { document.fonts.ready.then(function(){ fitSharedGrid(true); }); }
  setTimeout(function(){ fitSharedGrid(false); post({ type: 'ready' }); fitSharedGrid(true); }, 0);
})();
</script>
</body>
</html>`;
}

type MessageHandler = (event: WebViewMessageEvent) => void;
type TerminalRenderEvent =
    | { type: 'write'; data: string }
    | { type: 'metadata'; event: TerminalMetadataEvent };

interface TerminalControls {
    focus: () => void;
    reconnect: () => void;
    copyAll: () => void;
    clear: () => void;
    changeFontSize: (delta: number) => void;
    copyBlock: (commandId: string) => void;
    focusBlock: (commandId: string) => void;
}

export const SessionTerminalView = React.memo(function SessionTerminalView(props: { session: Session }) {
    const { width: windowWidth } = useWindowDimensions();
    const sessionId = props.session.id;
    const { theme } = useUnistyles();

    const terminalPalette = React.useMemo(
        () => resolveTerminalPalette(theme.semantic, theme.dark ? 'dark' : 'light'),
        [theme],
    );
    const themeRef = React.useRef(theme);
    themeRef.current = theme;

    const terminalIdRef = React.useRef(loadOrCreateTerminalDeviceId());
    const terminalId = terminalIdRef.current;
    const webviewRef = React.useRef<WebView>(null);
    const messageHandlerRef = React.useRef<MessageHandler>(() => {});
    const controlsRef = React.useRef<TerminalControls | null>(null);
    const capabilitiesRef = React.useRef<TerminalAttachResponse['capabilities']>(undefined);
    const fontSizeRef = React.useRef(loadTerminalFontSize(windowWidth <= PHONE_MAX_WIDTH ? PHONE_FONT_SIZE : DEFAULT_FONT_SIZE));
    const restoredBlockSessionRef = React.useRef<string | null>(null);
    const copiedTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const autoRawCommandIdRef = React.useRef<string | null>(null);
    const [attaching, setAttaching] = React.useState(false);
    const [copied, setCopied] = React.useState(false);
    const [fontSize, setFontSize] = React.useState(fontSizeRef.current);
    const [viewMode, setViewMode] = React.useState<TerminalViewMode>(() => loadTerminalViewMode());
    const [blocksEnabled, setBlocksEnabled] = React.useState(true);
    const [terminalStates, setTerminalStates] = React.useState<TerminalCommandStatesById>({});
    const localCommandState = terminalStates[terminalId] ?? EMPTY_TERMINAL_COMMAND_STATE;
    const commandState = React.useMemo(
        () => mergeTerminalCommandStates(terminalStates, terminalId),
        [terminalId, terminalStates],
    );
    const [historyVisible, setHistoryVisible] = React.useState(false);
    const [selectedBlockId, setSelectedBlockId] = React.useState<string | null>(() => loadTerminalLastBlock(sessionId));
    const [favoriteCommandIds, setFavoriteCommandIds] = React.useState<ReadonlySet<string>>(() => new Set(
        loadTerminalHistory()
            .filter((entry) => entry.sessionId === sessionId && entry.favorite)
            .map((entry) => entry.id.slice(sessionId.length + 1)),
    ));

    const isConnected = props.session.presence === 'online' && props.session.active;
    const connectionState: TerminalConnectionState = !isConnected
        ? 'disconnected'
        : attaching
            ? 'connecting'
            : 'connected';
    const [html, setHtml] = React.useState<string | null>(null);

    const sendRawTerminalInput = React.useCallback((data: string) => {
        if (data.length === 0) {
            return;
        }
        apiSocket.sessionRPC(sessionId, 'terminal-input', { t: 'input', terminalId, data: textToBase64(data) })
            .catch((error) => console.warn('[terminal] terminal-input failed:', error));
    }, [sessionId, terminalId]);

    const {
        ctrlActive,
        sendTerminalInput,
        toggleCtrl,
        clearModifiers,
    } = useTerminalModifierInput(sendRawTerminalInput);

    const executeTerminalCommand = React.useCallback((command: string) => {
        clearModifiers();
        if ((capabilitiesRef.current?.protocolVersion ?? 0) < 2) {
            sendRawTerminalInput(`${command}\r`);
            return;
        }
        apiSocket.sessionRPC<TerminalExecuteResponse, { t: 'execute'; terminalId: string; command: string }>(
            sessionId,
            'terminal-execute',
            { t: 'execute', terminalId, command },
        ).catch((error) => {
            console.warn('[terminal] terminal-execute failed, falling back to raw input:', error);
            sendRawTerminalInput(`${command}\r`);
        });
    }, [clearModifiers, sendRawTerminalInput, sessionId, terminalId]);

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
        const variant = theme.dark ? 'dark' : 'light';
        const variantAnsi = variant === 'dark' ? DEFAULT_TERMINAL_ANSI_COLORS_DARK : DEFAULT_TERMINAL_ANSI_COLORS_LIGHT;
        const colors = {
            background: terminalPalette.canvas,
            foreground: terminalPalette.text,
            selection: terminalPalette.selection,
            ansi: variantAnsi,
        };
        loadTerminalWebviewAssets()
            .then((assets) => {
                if (!cancelled) {
                    setHtml(buildHtml(assets, colors, fontSizeRef.current));
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
        let lastReportedViewport = '';
        const pendingRenderEvents: TerminalRenderEvent[] = [];
        let flushTimer: ReturnType<typeof setTimeout> | null = null;
        const transcriptStreams = new Map<string, {
            decoder: TerminalTranscriptDecoder;
            pendingText: string;
            pendingRawPreferred: boolean;
        }>();
        let transcriptFlushTimer: ReturnType<typeof setTimeout> | null = null;

        const getTranscriptStream = (scopeId: string) => {
            const existing = transcriptStreams.get(scopeId);
            if (existing) {
                return existing;
            }
            const created = {
                decoder: new TerminalTranscriptDecoder(),
                pendingText: '',
                pendingRawPreferred: false,
            };
            transcriptStreams.set(scopeId, created);
            return created;
        };
        const flushTranscript = (scopeId: string) => {
            const stream = transcriptStreams.get(scopeId);
            if (!stream) {
                return;
            }
            const text = stream.pendingText;
            const rawPreferred = stream.pendingRawPreferred;
            stream.pendingText = '';
            stream.pendingRawPreferred = false;
            if (text.length > 0 || rawPreferred) {
                setTerminalStates((current) => ({
                    ...current,
                    [scopeId]: appendTerminalCommandOutput(
                        current[scopeId] ?? EMPTY_TERMINAL_COMMAND_STATE,
                        text,
                        { rawPreferred },
                    ),
                }));
            }
        };
        const flushAllTranscripts = () => {
            transcriptFlushTimer = null;
            for (const scopeId of transcriptStreams.keys()) {
                flushTranscript(scopeId);
            }
        };
        const scheduleTranscriptFlush = () => {
            if (transcriptFlushTimer === null) {
                transcriptFlushTimer = setTimeout(flushAllTranscripts, 32);
            }
        };

        const inject = (js: string) => {
            webviewRef.current?.injectJavaScript(`;(function(){ ${js} })();`);
        };

        const flush = () => {
            flushTimer = null;
            if (pendingRenderEvents.length === 0) {
                return;
            }
            const batch = JSON.stringify(pendingRenderEvents);
            pendingRenderEvents.length = 0;
            // IIFE so the evaluated program's completion value is undefined
            // (iOS WKWebView crashes on non-null/non-undefined results).
            inject(`window.__happyTermRender(${batch});`);
        };
        const scheduleFlush = () => {
            if (flushTimer === null) {
                flushTimer = setTimeout(flush, WRITE_BATCH_MS);
            }
        };

        // Keep the host ANSI palette, while the surrounding canvas remains
        // stable and Warp-like across light/dark app themes.
        const applySyncedTheme = (response: TerminalAttachResponse) => {
            if (disposed || !response.theme) {
                return;
            }
            const synced = response.theme;
            const themeObj = {
                ...DEFAULT_TERMINAL_ANSI_COLORS_DARK,
                ...Object.fromEntries(
                    Object.entries(synced).filter(([, v]) => v != null),
                ),
                background: terminalPalette.canvas,
                foreground: terminalPalette.text,
                cursor: terminalPalette.accent,
                cursorAccent: terminalPalette.canvas,
                selectionBackground: terminalPalette.selection,
            };
            inject(`window.__happyTermSetTheme(${JSON.stringify(themeObj)});`);
        };

        let attach = () => {};
        const rawOrderer = new TerminalOrderer((event) => {
            if (disposed) {
                return;
            }
            if (event.type === 'write') {
                // Buffer always; flush only once the WebView can render.
                pendingRenderEvents.push({ type: 'write', data: event.data });
                if (webviewReady) {
                    scheduleFlush();
                }
            } else if (event.type === 'metadata') {
                pendingRenderEvents.push({ type: 'metadata', event: event.event });
                if (webviewReady) {
                    scheduleFlush();
                }
            } else {
                attach();
            }
        });

        const recordMux = new TerminalRecordMux(({ terminalId: scopeId, event }) => {
            if (disposed) {
                return;
            }
            if (event.type === 'write') {
                const stream = getTranscriptStream(scopeId);
                const transcript = stream.decoder.push(decodeBase64(event.data, 'base64'));
                stream.pendingText += transcript.text;
                stream.pendingRawPreferred ||= transcript.rawPreferred;
                scheduleTranscriptFlush();
            } else if (event.type === 'metadata') {
                if (event.event.t === 'grid') {
                    return;
                }
                flushTranscript(scopeId);
                setTerminalStates((current) => ({
                    ...current,
                    [scopeId]: reduceTerminalCommandState(
                        current[scopeId] ?? EMPTY_TERMINAL_COMMAND_STATE,
                        event.event,
                        scopeId,
                    ),
                }));
            } else {
                attach();
            }
        });

        // Attach replays every device ring for Blocks, while the RAW orderer
        // accepts only this device's terminalId below.
        attach = () => {
            setAttaching(true);
            apiSocket.sessionRPC<TerminalAttachResponse, { t: 'attach'; terminalId: string }>(
                sessionId,
                'terminal-attach',
                { t: 'attach', terminalId },
            )
                .then((response) => {
                    applySyncedTheme(response);
                    capabilitiesRef.current = response.capabilities;
                    const supportsBlocks = (response.capabilities?.protocolVersion ?? 0) >= 2
                        && response.capabilities?.structuredCommands === true;
                    setBlocksEnabled(supportsBlocks);
                    setTerminalStates((current) => ({
                        ...current,
                        [terminalId]: applyTerminalAttachState(
                            current[terminalId] ?? EMPTY_TERMINAL_COMMAND_STATE,
                            response,
                            terminalId,
                        ),
                    }));
                })
                .catch((error) => console.warn('[terminal] terminal-attach failed:', error))
                .finally(() => {
                    if (!disposed) {
                        rawOrderer.settle();
                        recordMux.settle();
                        setAttaching(false);
                    }
                });
        };

        const unsubscribe = subscribeTerminalOutput(sessionId, (chunk) => {
            if (!disposed) {
                recordMux.push(chunk, terminalId);
                if (terminalEventBelongsToDevice(chunk, terminalId)) {
                    rawOrderer.push(chunk);
                }
            }
        });

        controlsRef.current = {
            focus: () => {
                inject('window.__happyTermFocus();');
            },
            reconnect: () => {
                // Wipe the WebView's screen and re-fetch the snapshot; the
                // orderers' pending buffers merge it with any live chunks
                // that arrive while the attach is in flight.
                inject('window.__happyTermReset();');
                rawOrderer.reset();
                recordMux.reset();
                if (transcriptFlushTimer !== null) {
                    clearTimeout(transcriptFlushTimer);
                    transcriptFlushTimer = null;
                }
                transcriptStreams.clear();
                setTerminalStates({});
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
                setFontSize(clamped);
                saveTerminalFontSize(clamped);
                // The WebView refits and posts the new cols/rows back to us.
                inject(`window.__happyTermSetFontSize(${clamped});`);
            },
            copyBlock: (commandId: string) => {
                inject(`window.__happyTermGetBlockBuffer(${JSON.stringify(commandId)});`);
            },
            focusBlock: (commandId: string) => {
                inject(`window.__happyTermScrollToBlock(${JSON.stringify(commandId)});`);
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
            let msg: { type?: string; data?: string; commandId?: string; cols?: number; rows?: number };
            try {
                msg = JSON.parse(event.nativeEvent.data);
            } catch {
                return;
            }
            if (msg.type === 'ready') {
                onReady();
            } else if (msg.type === 'input' && typeof msg.data === 'string') {
                sendTerminalInput(msg.data);
            } else if (
                msg.type === 'resize'
                && Number.isInteger(msg.cols)
                && Number.isInteger(msg.rows)
                && (msg.cols ?? 0) > 0
                && (msg.rows ?? 0) > 0
            ) {
                const viewportKey = `${msg.cols}x${msg.rows}`;
                if (viewportKey === lastReportedViewport) {
                    return;
                }
                lastReportedViewport = viewportKey;
                apiSocket.sessionRPC<void, { t: 'resize'; terminalId: string; cols: number; rows: number }>(
                    sessionId,
                    'terminal-resize',
                    { t: 'resize', terminalId, cols: msg.cols!, rows: msg.rows! },
                ).catch((error) => {
                    if (lastReportedViewport === viewportKey) {
                        lastReportedViewport = '';
                    }
                    console.warn('[terminal] terminal-resize failed:', error);
                });
            } else if (msg.type === 'keyboard-dismiss') {
                Keyboard.dismiss();
            } else if (msg.type === 'local-records') {
                Keyboard.dismiss();
                clearModifiers();
                setViewMode('blocks');
            } else if (msg.type === 'buffer' && typeof msg.data === 'string') {
                if (msg.data.length > 0) {
                    Clipboard.setStringAsync(msg.data)
                        .then(showCopiedFeedback)
                        .catch((error) => console.warn('[terminal] Copy failed:', error));
                }
            } else if (msg.type === 'block-buffer' && typeof msg.data === 'string' && msg.data.length > 0) {
                Clipboard.setStringAsync(msg.data)
                    .then(showCopiedFeedback)
                    .catch((error) => console.warn('[terminal] Copy block failed:', error));
            }
        };

        return () => {
            disposed = true;
            controlsRef.current = null;
            if (flushTimer !== null) {
                clearTimeout(flushTimer);
            }
            if (transcriptFlushTimer !== null) {
                clearTimeout(transcriptFlushTimer);
            }
            unsubscribe();
        };
    }, [clearModifiers, html, sendTerminalInput, sessionId, showCopiedFeedback, terminalId]);

    const latestBlock = latestTerminalCommandBlock(commandState);
    const localLatestBlock = latestTerminalCommandBlock(localCommandState);
    const effectiveViewMode: TerminalViewMode = blocksEnabled ? viewMode : 'raw';

    React.useEffect(() => {
        clearModifiers();
        setTerminalStates({});
        setSelectedBlockId(loadTerminalLastBlock(sessionId));
        setFavoriteCommandIds(new Set(
            loadTerminalHistory()
                .filter((entry) => entry.sessionId === sessionId && entry.favorite)
                .map((entry) => entry.id.slice(sessionId.length + 1)),
        ));
        autoRawCommandIdRef.current = null;
        restoredBlockSessionRef.current = null;
    }, [clearModifiers, sessionId]);

    React.useEffect(() => {
        if (effectiveViewMode !== 'raw' || !selectedBlockId) {
            return;
        }
        const restoreKey = `${sessionId}:${selectedBlockId}`;
        if (restoredBlockSessionRef.current === restoreKey) {
            return;
        }
        if (localCommandState.blocks.some((block) => block.commandId === selectedBlockId)) {
            controlsRef.current?.focusBlock(selectedBlockId);
            restoredBlockSessionRef.current = restoreKey;
        }
    }, [effectiveViewMode, localCommandState.blocks, selectedBlockId, sessionId]);

    React.useEffect(() => {
        for (const block of commandState.blocks) {
            if (block.endedAt !== undefined) {
                persistCompletedTerminalCommand(props.session, block);
            }
        }
    }, [commandState.blocks, props.session]);

    React.useEffect(() => {
        if (
            localLatestBlock?.rawPreferred
            && (localLatestBlock.status === 'running' || localLatestBlock.status === 'waiting')
            && autoRawCommandIdRef.current !== localLatestBlock.commandId
        ) {
            autoRawCommandIdRef.current = localLatestBlock.commandId;
            setViewMode('raw');
        }
    }, [localLatestBlock]);

    const copyText = React.useCallback((text: string, label: string) => {
        if (!text) {
            return;
        }
        Clipboard.setStringAsync(text)
            .then(showCopiedFeedback)
            .catch((error) => console.warn(`[terminal] Copy ${label} failed:`, error));
    }, [showCopiedFeedback]);

    const selectBlock = React.useCallback((block: NonNullable<typeof latestBlock>) => {
        setSelectedBlockId(block.commandId);
        saveTerminalLastBlock(sessionId, block.commandId);
    }, [sessionId]);

    const toggleFavorite = React.useCallback((block: NonNullable<typeof latestBlock>) => {
        if (block.endedAt === undefined) {
            return;
        }
        persistCompletedTerminalCommand(props.session, block);
        const favorite = !favoriteCommandIds.has(block.commandId);
        setTerminalHistoryFavorite(`${sessionId}:${block.commandId}`, favorite);
        setFavoriteCommandIds((current) => {
            const next = new Set(current);
            if (favorite) {
                next.add(block.commandId);
            } else {
                next.delete(block.commandId);
            }
            return next;
        });
    }, [favoriteCommandIds, props.session, sessionId]);

    const toggleViewMode = React.useCallback(() => {
        if (!blocksEnabled) {
            return;
        }
        const nextMode: TerminalViewMode = effectiveViewMode === 'blocks' ? 'raw' : 'blocks';
        clearModifiers();
        if (nextMode === 'raw') {
            Keyboard.dismiss();
        }
        setViewMode(nextMode);
        saveTerminalViewMode(nextMode);
    }, [blocksEnabled, clearModifiers, effectiveViewMode]);

    const toggleCtrlWithFocus = React.useCallback(() => {
        toggleCtrl();
        if (effectiveViewMode === 'raw') {
            controlsRef.current?.focus();
        }
    }, [effectiveViewMode, toggleCtrl]);

    const copyAll = React.useCallback(() => {
        if (effectiveViewMode === 'blocks') {
            copyText(terminalTranscriptText(commandState), 'transcript');
        } else {
            controlsRef.current?.copyAll();
        }
    }, [commandState, copyText, effectiveViewMode]);

    const clearVisibleTerminal = React.useCallback(() => {
        controlsRef.current?.clear();
        if (effectiveViewMode === 'blocks') {
            setTerminalStates((current) => Object.fromEntries(
                Object.entries(current).map(([scopeId, state]) => [scopeId, {
                    ...state,
                    blocks: state.blocks.filter((block) => block.status === 'running' || block.status === 'waiting'),
                }]),
            ));
        }
    }, [effectiveViewMode]);

    return (
        <KeyboardAvoidingView
            style={{ flex: 1, backgroundColor: terminalPalette.canvas }}
            behavior="height"
            automaticOffset
        >
            <TerminalToolbar
                connectionState={connectionState}
                copied={copied}
                onReconnect={() => controlsRef.current?.reconnect()}
                onCopyAll={copyAll}
                onClear={clearVisibleTerminal}
                onFontSizeChange={(delta) => controlsRef.current?.changeFontSize(delta)}
            />
            <View style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                {html ? (
                    <View
                        pointerEvents={effectiveViewMode === 'raw' ? 'auto' : 'none'}
                        accessibilityElementsHidden={effectiveViewMode !== 'raw'}
                        importantForAccessibility={effectiveViewMode === 'raw' ? 'auto' : 'no-hide-descendants'}
                        style={{
                            position: 'absolute',
                            top: 0,
                            right: 0,
                            bottom: 0,
                            left: 0,
                            opacity: effectiveViewMode === 'raw' ? 1 : 0,
                            borderTopWidth: 1,
                            borderTopColor: terminalPalette.border,
                        }}
                    >
                    <WebView
                        ref={webviewRef}
                        source={{ html }}
                        style={{ flex: 1, backgroundColor: terminalPalette.canvas }}
                        scrollEnabled={false}
                        javaScriptEnabled={true}
                        onMessage={(event) => messageHandlerRef.current(event)}
                        // Let the page raise the software keyboard from JS focus
                        // calls; without this iOS swallows them outside a gesture.
                        keyboardDisplayRequiresUserAction={false}
                        // WKWebView's previous/next/done bar covers terminal rows
                        // and has no useful semantics for a single xterm textarea.
                        hideKeyboardAccessoryView
                    />
                    </View>
                ) : effectiveViewMode === 'raw' ? (
                    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                    <ActivityIndicator color={terminalPalette.textMuted} />
                    </View>
                ) : null}
                {effectiveViewMode === 'blocks' ? (
                    <TerminalBlockTranscript
                        blocks={commandState.blocks}
                        localTerminalId={terminalId}
                        fontSize={fontSize}
                        initialSelectedBlockId={selectedBlockId}
                        favoriteCommandIds={favoriteCommandIds}
                        onSelectBlock={selectBlock}
                        onCopyCommand={(block) => copyText(block.command, 'command')}
                        onCopyOutput={(block) => copyText(terminalBlockOutputText(block), 'output')}
                        onRerun={(block) => executeTerminalCommand(block.command)}
                        onToggleFavorite={toggleFavorite}
                        onOpenRaw={(block) => {
                            if (block.terminalId === undefined || block.terminalId === terminalId) {
                                selectBlock(block);
                                setViewMode('raw');
                            }
                        }}
                    />
                ) : null}
            </View>
            <TerminalCommandDock
                sessionId={sessionId}
                viewMode={effectiveViewMode}
                blocksEnabled={blocksEnabled}
                ctrlActive={ctrlActive}
                cwd={localCommandState.cwd}
                onSendInput={sendTerminalInput}
                onExecuteCommand={executeTerminalCommand}
                onToggleCtrl={toggleCtrlWithFocus}
                onToggleViewMode={toggleViewMode}
                onOpenHistory={() => setHistoryVisible(true)}
            />
            <TerminalHistorySheet
                visible={historyVisible}
                currentMachineId={props.session.metadata?.machineId}
                revision={`${latestBlock?.commandId ?? ''}:${latestBlock?.status ?? ''}`}
                onClose={() => setHistoryVisible(false)}
                onRun={executeTerminalCommand}
            />
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
        </KeyboardAvoidingView>
    );
});
