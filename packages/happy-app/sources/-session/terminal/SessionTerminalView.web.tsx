import * as React from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Text, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { decodeBase64, encodeBase64 } from '@/encryption/base64';
import { apiSocket } from '@/sync/apiSocket';
import type { Session } from '@/sync/storageTypes';
import { subscribeTerminalOutput } from './terminalOutputBus';
import { TerminalOrderer } from './terminalOrdering';

/** Keystroke text (UTF-16 JS string from xterm onData) -> base64 UTF-8 bytes. */
function textToBase64(text: string): string {
    return encodeBase64(new TextEncoder().encode(text), 'base64');
}

const RESIZE_DEBOUNCE_MS = 100;

export const SessionTerminalView = React.memo(function SessionTerminalView(props: { session: Session }) {
    const { theme } = useUnistyles();
    const sessionId = props.session.id;
    const containerRef = React.useRef<HTMLDivElement | null>(null);

    const isConnected = props.session.presence === 'online' && props.session.active;

    React.useEffect(() => {
        const container = containerRef.current;
        if (!container) {
            return;
        }

        const term = new Terminal({
            cursorBlink: true,
            fontSize: 13,
            fontFamily: 'ui-monospace, "SF Mono", "Cascadia Code", "Segoe UI Mono", Menlo, Monaco, Consolas, monospace',
            theme: {
                background: theme.colors.surface,
                foreground: theme.colors.text,
                cursor: theme.colors.text,
                cursorAccent: theme.colors.surface,
                selectionBackground: theme.colors.surfaceSelected,
            },
        });
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
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

        apiSocket.sessionRPC(sessionId, 'terminal-attach', { t: 'attach' })
            .catch((error) => {
                // Snapshot replay failed - still go live so new output streams in
                console.warn('[terminal] terminal-attach failed:', error);
            })
            .finally(() => {
                if (!disposed) {
                    orderer.settle();
                }
            });

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

        return () => {
            disposed = true;
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
                    <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '600' }}>
                        Session disconnected
                    </Text>
                </View>
            )}
        </View>
    );
});
