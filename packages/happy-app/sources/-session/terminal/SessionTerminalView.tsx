import * as React from 'react';
import { ActivityIndicator, Keyboard, Text, useWindowDimensions, View, TextInput, Pressable, type LayoutChangeEvent } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
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
import { TerminalOrderer } from './terminalOrdering';
import { TerminalRecordMux, terminalEventBelongsToDevice } from './terminalRecordMux';
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
import { useSkiaTerminal, type RenderData } from './skia/useSkiaTerminal';

/** Keystroke text (UTF-16 JS string) -> base64 UTF-8 bytes. */
function textToBase64(text: string): string {
    return encodeBase64(new TextEncoder().encode(text), 'base64');
}

const WRITE_BATCH_MS = 16;
const DEFAULT_FONT_SIZE = 13;
const PHONE_FONT_SIZE = 10;
const PHONE_MAX_WIDTH = 480;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 24;
const COPIED_FEEDBACK_MS = 2000;
const CELL_WIDTH_RATIO = 0.6;
const CELL_HEIGHT_RATIO = 1.2;

/** Maps React Native `onKeyPress` key names to terminal escape sequences. */
const SPECIAL_KEYS: Record<string, string> = {
    'Enter': '\r',
    'Backspace': '\x7f',
    'Tab': '\t',
    'Escape': '\x1b',
    'ArrowUp': '\x1b[A',
    'ArrowDown': '\x1b[B',
    'ArrowRight': '\x1b[C',
    'ArrowLeft': '\x1b[D',
    'Home': '\x1b[H',
    'End': '\x1b[F',
    'PageUp': '\x1b[5~',
    'PageDown': '\x1b[6~',
    'Delete': '\x1b[3~',
};

interface TerminalControls {
    focus: () => void;
    reconnect: () => void;
    copyAll: () => void;
    clear: () => void;
    changeFontSize: (delta: number) => void;
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

    const terminalIdRef = React.useRef(loadOrCreateTerminalDeviceId());
    const terminalId = terminalIdRef.current;
    const controlsRef = React.useRef<TerminalControls | null>(null);
    const capabilitiesRef = React.useRef<TerminalAttachResponse['capabilities']>(undefined);
    const fontSizeRef = React.useRef(loadTerminalFontSize(windowWidth <= PHONE_MAX_WIDTH ? PHONE_FONT_SIZE : DEFAULT_FONT_SIZE));
    const restoredBlockSessionRef = React.useRef<string | null>(null);
    const copiedTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const autoRawCommandIdRef = React.useRef<string | null>(null);
    const inputRef = React.useRef<TextInput>(null);
    const lastReportedViewportRef = React.useRef('');
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

    // Skia + WASM terminal
    const { ready: skiaReady, termRef } = useSkiaTerminal(SHARED_TERMINAL_COLS, SHARED_TERMINAL_ROWS);
    const [renderData, setRenderData] = React.useState<RenderData | null>(null);
    const [containerSize, setContainerSize] = React.useState({ width: 0, height: 0 });

    const isConnected = props.session.presence === 'online' && props.session.active;
    const connectionState: TerminalConnectionState = !isConnected
        ? 'disconnected'
        : attaching
            ? 'connecting'
            : 'connected';

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

    // Wire ordering + the output bus to the WASM terminal once Skia is ready.
    React.useEffect(() => {
        if (!skiaReady) {
            return;
        }
        let disposed = false;
        const transcriptStreams = new Map<string, {
            decoder: TerminalTranscriptDecoder;
            pendingText: string;
            pendingRawPreferred: boolean;
        }>();
        let transcriptFlushTimer: ReturnType<typeof setTimeout> | null = null;
        let renderTimer: ReturnType<typeof setTimeout> | null = null;

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

        // Batch WASM render calls to at most one per frame.
        let renderPending = false;
        const scheduleRender = () => {
            if (renderPending) return;
            renderPending = true;
            renderTimer = setTimeout(() => {
                renderPending = false;
                renderTimer = null;
                if (disposed) return;
                const data = termRef.current?.render();
                if (data) setRenderData(data);
            }, WRITE_BATCH_MS);
        };

        let attach = () => {};
        const rawOrderer = new TerminalOrderer((event) => {
            if (disposed) {
                return;
            }
            const term = termRef.current;
            if (!term) {
                return;
            }
            if (event.type === 'write') {
                const bytes = decodeBase64(event.data, 'base64');
                term.write(bytes);
                scheduleRender();
            } else if (event.type === 'metadata') {
                if (event.event.t === 'grid') {
                    term.resize(event.event.cols, event.event.rows);
                    scheduleRender();
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

        attach = () => {
            setAttaching(true);
            apiSocket.sessionRPC<TerminalAttachResponse, { t: 'attach'; terminalId: string }>(
                sessionId,
                'terminal-attach',
                { t: 'attach', terminalId },
            )
                .then((response) => {
                    if (disposed) return;
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
                        scheduleRender();
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

        // Initial attach - no WebView readiness gate needed, WASM terminal is
        // already created by useSkiaTerminal.
        attach();

        controlsRef.current = {
            focus: () => {
                inputRef.current?.focus();
            },
            reconnect: () => {
                termRef.current?.clear();
                setRenderData(null);
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
                const data = termRef.current?.render();
                if (!data) return;
                const lines: string[] = [];
                for (const row of data.rows) {
                    lines.push(row.cells.map(c => c.ch).join('').trimEnd());
                }
                while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
                const text = lines.join('\n');
                if (text.length > 0) {
                    Clipboard.setStringAsync(text)
                        .then(showCopiedFeedback)
                        .catch((error) => console.warn('[terminal] Copy failed:', error));
                }
            },
            clear: () => {
                termRef.current?.clear();
                scheduleRender();
            },
            changeFontSize: (delta: number) => {
                const clamped = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, fontSizeRef.current + delta));
                if (clamped === fontSizeRef.current) {
                    return;
                }
                fontSizeRef.current = clamped;
                setFontSize(clamped);
                saveTerminalFontSize(clamped);
            },
            focusBlock: (_commandId: string) => {
                // Scrollback positioning not supported in the WASM model.
            },
        };

        return () => {
            disposed = true;
            controlsRef.current = null;
            if (renderTimer !== null) {
                clearTimeout(renderTimer);
            }
            if (transcriptFlushTimer !== null) {
                clearTimeout(transcriptFlushTimer);
            }
            unsubscribe();
        };
    }, [clearModifiers, skiaReady, sendTerminalInput, sessionId, showCopiedFeedback, terminalId]);

    // Report physical viewport capacity to the server when the container or
    // font size changes, so the shared PTY grid can be adjusted.
    React.useEffect(() => {
        if (!skiaReady || containerSize.width === 0 || containerSize.height === 0) return;
        const cellWidth = fontSize * CELL_WIDTH_RATIO;
        const cellHeight = fontSize * CELL_HEIGHT_RATIO;
        const measuredCols = Math.floor(containerSize.width / cellWidth);
        const measuredRows = Math.floor(containerSize.height / cellHeight);
        if (measuredCols <= 0 || measuredRows <= 0) return;
        const viewportKey = `${measuredCols}x${measuredRows}`;
        if (lastReportedViewportRef.current === viewportKey) return;
        lastReportedViewportRef.current = viewportKey;
        apiSocket.sessionRPC<void, { t: 'resize'; terminalId: string; cols: number; rows: number }>(
            sessionId,
            'terminal-resize',
            { t: 'resize', terminalId, cols: measuredCols, rows: measuredRows },
        ).catch((error) => {
            lastReportedViewportRef.current = '';
            console.warn('[terminal] terminal-resize failed:', error);
        });
    }, [containerSize, fontSize, skiaReady, sessionId, terminalId]);

    // Focus the hidden TextInput when entering RAW mode.
    const latestBlock = latestTerminalCommandBlock(commandState);
    const localLatestBlock = latestTerminalCommandBlock(localCommandState);
    const effectiveViewMode: TerminalViewMode = blocksEnabled ? viewMode : 'raw';

    React.useEffect(() => {
        if (skiaReady && effectiveViewMode === 'raw') {
            const timeout = setTimeout(() => inputRef.current?.focus(), 200);
            return () => clearTimeout(timeout);
        }
    }, [skiaReady, effectiveViewMode]);

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
        if (nextMode === 'blocks') {
            inputRef.current?.blur();
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

    const onContainerLayout = React.useCallback((event: LayoutChangeEvent) => {
        const { width, height } = event.nativeEvent.layout;
        setContainerSize(prev => {
            if (prev.width === width && prev.height === height) return prev;
            return { width, height };
        });
    }, []);

    const handleKeyPress = React.useCallback((e: { nativeEvent: { key: string } }) => {
        const data = SPECIAL_KEYS[e.nativeEvent.key];
        if (data) {
            sendTerminalInput(data);
        }
    }, [sendTerminalInput]);

    const handleInputChange = React.useCallback((text: string) => {
        if (text.length > 0) {
            const filtered = text.replace(/\n/g, '');
            if (filtered.length > 0) {
                sendTerminalInput(filtered);
            }
            inputRef.current?.setNativeProps({ text: '' });
        }
    }, [sendTerminalInput]);

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
                {skiaReady ? (
                    <View
                        pointerEvents={effectiveViewMode === 'raw' ? 'auto' : 'none'}
                        accessibilityElementsHidden={effectiveViewMode !== 'raw'}
                        importantForAccessibility={effectiveViewMode === 'raw' ? 'auto' : 'no-hide-descendants'}
                        onLayout={onContainerLayout}
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
                        <Pressable
                            onPress={() => inputRef.current?.focus()}
                            style={{ flex: 1 }}
                        >
                            <SkiaTerminalView
                                renderData={renderData}
                                fontSize={fontSize}
                                palette={terminalPalette}
                            />
                        </Pressable>
                        <TextInput
                            ref={inputRef}
                            style={{
                                position: 'absolute',
                                opacity: 0,
                                width: 1,
                                height: 1,
                                top: 0,
                                left: 0,
                            }}
                            multiline
                            autoCorrect={false}
                            autoCapitalize="none"
                            spellCheck={false}
                            keyboardType="default"
                            onKeyPress={handleKeyPress}
                            onChangeText={handleInputChange}
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
                    backgroundColor: terminalPalette.canvas,
                }}>
                    <Text style={{ color: terminalPalette.text, fontSize: 16, fontWeight: '600' }}>
                        {t('terminal.disconnected')}
                    </Text>
                    <Button
                        variant="ghost"
                        onPress={() => controlsRef.current?.reconnect()}
                        style={{ marginTop: 12 }}
                    >
                        <UiText>{t('terminal.reconnect')}</UiText>
                    </Button>
                </View>
            )}
        </KeyboardAvoidingView>
    );
});
