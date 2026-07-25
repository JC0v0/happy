import * as React from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { ActivityIndicator, Text, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { decodeBase64, encodeBase64 } from '@/encryption/base64';
import { apiSocket } from '@/sync/apiSocket';
import type { Session } from '@/sync/storageTypes';
import { t } from '@/text';
import { Button } from '@/components/ui/button';
import { Text as UiText } from '@/components/ui/text';
import { subscribeTerminalOutput } from './terminalOutputBus';
import { TerminalOrderer } from './terminalOrdering';
import { DEFAULT_TERMINAL_ANSI_COLORS } from './terminalTheme';
import { TerminalToolbar, type TerminalConnectionState } from './TerminalToolbar';
import type { TerminalAttachResponse } from '@slopus/happy-wire';

/** Keystroke text (UTF-16 JS string from xterm onData) -> base64 UTF-8 bytes. */
function textToBase64(text: string): string {
    return encodeBase64(new TextEncoder().encode(text), 'base64');
}

/** Dump the full xterm buffer (scrollback + screen) as plain text. */
function readTerminalText(term: Terminal): string {
    const buffer = term.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < buffer.length; i++) {
        lines.push(buffer.getLine(i)?.translateToString(true) ?? '');
    }
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
        lines.pop();
    }
    return lines.join('\n');
}

const RESIZE_DEBOUNCE_MS = 100;
const DEFAULT_FONT_SIZE = 13;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 24;
const COPIED_FEEDBACK_MS = 2000;

interface TerminalControls {
    reconnect: () => void;
    copyAll: () => void;
    clear: () => void;
    changeFontSize: (delta: number) => void;
}

export const SessionTerminalView = React.memo(function SessionTerminalView(props: { session: Session }) {
    const { theme } = useUnistyles();
    const sessionId = props.session.id;
    const containerRef = React.useRef<HTMLDivElement | null>(null);
    const controlsRef = React.useRef<TerminalControls | null>(null);
    const copiedTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const [attaching, setAttaching] = React.useState(false);
    const [copied, setCopied] = React.useState(false);

    const isConnected = props.session.presence === 'online' && props.session.active;
    const connectionState: TerminalConnectionState = !isConnected
        ? 'disconnected'
        : attaching
            ? 'connecting'
            : 'connected';

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

    React.useEffect(() => {
        const container = containerRef.current;
        if (!container) {
            return;
        }

        const term = new Terminal({
            cursorBlink: true,
            fontSize: DEFAULT_FONT_SIZE,
            fontFamily: 'ui-monospace, "SF Mono", "Cascadia Code", "Segoe UI Mono", Menlo, Monaco, Consolas, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", monospace',
            theme: {
                background: theme.colors.surface,
                foreground: theme.colors.text,
                cursor: theme.colors.text,
                cursorAccent: theme.colors.surface,
                selectionBackground: theme.colors.surfaceSelected,
                ...DEFAULT_TERMINAL_ANSI_COLORS,
            },
        });
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.loadAddon(new WebLinksAddon());
        term.open(container);
        fitAddon.fit();
        term.focus();

        let disposed = false;

        // Ordering/dedup lives in TerminalOrderer; this view only renders the
        // ordered writes it emits and re-issues terminal-attach on resync.
        const orderer = new TerminalOrderer((event) => {
            if (disposed) {
                return;
            }
            if (event.type === 'write') {
                try {
                    term.write(decodeBase64(event.data, 'base64'));
                } catch (error) {
                    console.warn('[terminal] Failed to write output chunk:', error);
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

        // Attach = fetch the CLI snapshot (and host theme), then settle the
        // orderer so buffered history writes in order. Re-runnable: reconnect
        // wipes the screen and re-attaches from scratch.
        const attach = () => {
            setAttaching(true);
            apiSocket.sessionRPC<TerminalAttachResponse, { t: 'attach' }>(sessionId, 'terminal-attach', { t: 'attach' })
                .then((response) => {
                    if (disposed || !response?.theme) {
                        return;
                    }
                    // Sync the host's local terminal colors. Override the ANSI
                    // palette entirely; fill any gaps from the app/default theme.
                    term.options.theme = {
                        background: response.theme.background ?? theme.colors.surface,
                        foreground: response.theme.foreground ?? theme.colors.text,
                        cursor: response.theme.cursor ?? theme.colors.text,
                        cursorAccent: response.theme.cursorAccent ?? theme.colors.surface,
                        selectionBackground: response.theme.selectionBackground ?? theme.colors.surfaceSelected,
                        ...DEFAULT_TERMINAL_ANSI_COLORS,
                        ...Object.fromEntries(
                            Object.entries(response.theme).filter(([, v]) => v != null),
                        ),
                    };
                })
                .catch((error) => {
                    // Snapshot replay failed - still go live so new output streams in
                    console.warn('[terminal] terminal-attach failed:', error);
                })
                .finally(() => {
                    if (!disposed) {
                        orderer.settle();
                        setAttaching(false);
                    }
                });
        };

        // Keystrokes -> CLI
        const dataSubscription = term.onData((data) => {
            apiSocket.sessionRPC(sessionId, 'terminal-input', { t: 'input', data: textToBase64(data) })
                .catch((error) => console.warn('[terminal] terminal-input failed:', error));
        });

        // Resize (container-driven, debounced) -> fit + CLI
        let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
        const sendResize = () => {
            fitAddon.fit();
            apiSocket.sessionRPC(sessionId, 'terminal-resize', { t: 'resize', cols: term.cols, rows: term.rows })
                .catch((error) => console.warn('[terminal] terminal-resize failed:', error));
        };
        const observer = new ResizeObserver(() => {
            if (resizeTimeout !== null) {
                clearTimeout(resizeTimeout);
            }
            resizeTimeout = setTimeout(sendResize, RESIZE_DEBOUNCE_MS);
        });
        observer.observe(container);
        // Announce the initial size so the pty matches what the user sees
        sendResize();

        attach();

        controlsRef.current = {
            reconnect: () => {
                // Wipe the screen and re-fetch the snapshot; the orderer's
                // pending buffer merges it with any live chunks that arrive
                // while the attach is in flight.
                term.reset();
                orderer.reset();
                attach();
            },
            copyAll: () => {
                const text = readTerminalText(term);
                if (!text) {
                    return;
                }
                navigator.clipboard.writeText(text)
                    .then(showCopiedFeedback)
                    .catch((error) => console.warn('[terminal] Copy failed:', error));
            },
            clear: () => {
                term.clear();
                term.focus();
            },
            changeFontSize: (delta: number) => {
                const current = term.options.fontSize ?? DEFAULT_FONT_SIZE;
                const clamped = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, current + delta));
                if (clamped === current) {
                    return;
                }
                term.options.fontSize = clamped;
                // New metrics change cols/rows — refit and tell the pty.
                sendResize();
            },
        };

        return () => {
            disposed = true;
            controlsRef.current = null;
            if (resizeTimeout !== null) {
                clearTimeout(resizeTimeout);
            }
            observer.disconnect();
            dataSubscription.dispose();
            unsubscribe();
            term.dispose();
        };
    }, [sessionId]);

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
            <div
                ref={containerRef}
                style={{
                    flex: 1,
                    width: '100%',
                    height: '100%',
                    minHeight: 0,
                    overflow: 'hidden',
                    padding: 4,
                    backgroundColor: theme.colors.surface,
                }}
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
        </View>
    );
});
