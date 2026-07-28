import * as React from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { ActivityIndicator, Text, View } from 'react-native';
import { decodeBase64, encodeBase64 } from '@/encryption/base64';
import { apiSocket } from '@/sync/apiSocket';
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
import type { Session } from '@/sync/storageTypes';
import { t } from '@/text';
import { Button } from '@/components/ui/button';
import { Text as UiText } from '@/components/ui/text';
import { subscribeTerminalOutput } from './terminalOutputBus';
import { TerminalOrderer } from './terminalOrdering';
import { TerminalRecordMux, terminalEventBelongsToDevice } from './terminalRecordMux';
import { DEFAULT_TERMINAL_ANSI_COLORS } from './terminalTheme';
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
import { TERMINAL_VISUAL_THEME as palette } from './terminalVisualTheme';
import {
    SHARED_TERMINAL_COLS,
    SHARED_TERMINAL_ROWS,
    sharedGridFontSize,
} from './terminalSharedGrid';
import type { TerminalAttachResponse, TerminalExecuteResponse } from '@slopus/happy-wire';

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
const PHONE_FONT_SIZE = 10;
const PHONE_MAX_WIDTH = 480;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 24;
const COPIED_FEEDBACK_MS = 2000;

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
    const sessionId = props.session.id;
    const terminalIdRef = React.useRef(loadOrCreateTerminalDeviceId());
    const terminalId = terminalIdRef.current;
    const containerRef = React.useRef<HTMLDivElement | null>(null);
    const controlsRef = React.useRef<TerminalControls | null>(null);
    const capabilitiesRef = React.useRef<TerminalAttachResponse['capabilities']>(undefined);
    const restoredBlockSessionRef = React.useRef<string | null>(null);
    const copiedTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const autoRawCommandIdRef = React.useRef<string | null>(null);
    const initialFontSizeRef = React.useRef(loadTerminalFontSize(window.innerWidth <= PHONE_MAX_WIDTH ? PHONE_FONT_SIZE : DEFAULT_FONT_SIZE));
    const [attaching, setAttaching] = React.useState(false);
    const [copied, setCopied] = React.useState(false);
    const [fontSize, setFontSize] = React.useState(initialFontSizeRef.current);
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

    React.useEffect(() => {
        const container = containerRef.current;
        if (!container) {
            return;
        }

        let disposed = false;
        const initialFontSize = initialFontSizeRef.current;
        const term = new Terminal({
            allowProposedApi: true,
            cursorBlink: true,
            fontSize: initialFontSize,
            fontFamily: 'ui-monospace, "SF Mono", "Cascadia Code", "Segoe UI Mono", Menlo, Monaco, Consolas, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", monospace',
            theme: {
                background: palette.canvas,
                foreground: palette.text,
                cursor: palette.accent,
                cursorAccent: palette.canvas,
                selectionBackground: palette.selection,
                ...DEFAULT_TERMINAL_ANSI_COLORS,
            },
        });
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.loadAddon(new WebLinksAddon());
        term.open(container);
        let fontZoomDelta = 0;
        let sharedGridCols = SHARED_TERMINAL_COLS;
        let sharedGridRows = SHARED_TERMINAL_ROWS;
        let attachSettled = false;
        let lastReportedViewport = '';
        const reportViewport = (cols: number, rows: number) => {
            if (!attachSettled || disposed) {
                return;
            }
            const key = `${cols}x${rows}`;
            if (key === lastReportedViewport) {
                return;
            }
            lastReportedViewport = key;
            apiSocket.sessionRPC<void, { t: 'resize'; terminalId: string; cols: number; rows: number }>(
                sessionId,
                'terminal-resize',
                { t: 'resize', terminalId, cols, rows },
            ).catch((error) => {
                if (lastReportedViewport === key) {
                    lastReportedViewport = '';
                }
                console.warn('[terminal] terminal-resize failed:', error);
            });
        };
        const fitSharedGrid = (shouldReportViewport = false) => {
            term.options.fontSize = initialFontSize;
            fitAddon.fit();
            const measuredCols = term.cols;
            const measuredRows = term.rows;
            const fittedFontSize = sharedGridFontSize({
                baseFontSize: initialFontSize,
                measuredCols,
                measuredRows,
                gridCols: sharedGridCols,
                gridRows: sharedGridRows,
                zoomDelta: fontZoomDelta,
                minFontSize: MIN_FONT_SIZE,
                maxFontSize: MAX_FONT_SIZE,
            });
            term.options.fontSize = fittedFontSize;
            term.resize(sharedGridCols, sharedGridRows);
            container.dataset.grid = `${term.cols}x${term.rows}`;
            if (shouldReportViewport) {
                reportViewport(measuredCols, measuredRows);
            }
            if (!disposed) {
                setFontSize(fittedFontSize);
            }
        };
        fitSharedGrid(false);
        term.focus();
        term.attachCustomWheelEventHandler((event) => {
            const interactive = term.buffer.active.type === 'alternate'
                || term.modes.mouseTrackingMode !== 'none';
            if (!interactive || event.deltaY === 0) {
                return true;
            }
            event.preventDefault();
            clearModifiers();
            setViewMode('blocks');
            return false;
        });

        let renderQueue = Promise.resolve();
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
        const blockMarkers = new Map<string, {
            start?: ReturnType<Terminal['registerMarker']>;
            end?: ReturnType<Terminal['registerMarker']>;
            endColumn?: number;
            decoration?: ReturnType<Terminal['registerDecoration']>;
            element?: HTMLElement;
        }>();

        const applyMetadataDecoration = (event: Exclude<import('@slopus/happy-wire').TerminalStreamEvent, { t: 'output' }>) => {
            if (event.t === 'command-start') {
                if (blockMarkers.get(event.commandId)?.start) {
                    return;
                }
                const start = term.registerMarker(0);
                if (!start) {
                    return;
                }
                const record = { start } as NonNullable<ReturnType<typeof blockMarkers.get>>;
                const decoration = term.registerDecoration({ marker: start, x: 0, width: term.cols, layer: 'bottom' });
                record.decoration = decoration;
                decoration?.onRender((element) => {
                    record.element = element;
                    element.style.borderLeft = `3px solid ${palette.accent}`;
                    element.style.background = 'rgba(184,107,255,0.10)';
                    element.style.boxSizing = 'border-box';
                    element.style.pointerEvents = 'none';
                });
                blockMarkers.set(event.commandId, record);
            } else if (event.t === 'command-end') {
                const record = blockMarkers.get(event.commandId) ?? {};
                record.end = term.registerMarker(0);
                record.endColumn = term.buffer.active.cursorX;
                if (record.element) {
                    record.element.style.borderLeftColor = event.exitCode === 0 ? palette.success : palette.danger;
                    record.element.style.background = event.exitCode === 0
                        ? 'rgba(109,213,140,0.07)'
                        : 'rgba(255,107,120,0.08)';
                }
                blockMarkers.set(event.commandId, record);
            }
        };

        const readBlockText = (commandId: string): string => {
            const record = blockMarkers.get(commandId);
            if (!record?.start) {
                return '';
            }
            const buffer = term.buffer.active;
            const start = Math.max(0, record.start.line + 1);
            const end = record.end?.line ?? (buffer.baseY + buffer.cursorY);
            if (start > end) {
                return '';
            }
            const lines: string[] = [];
            for (let lineIndex = start; lineIndex <= end; lineIndex++) {
                let text = buffer.getLine(lineIndex)?.translateToString(true) ?? '';
                if (lineIndex === end && record.endColumn !== undefined) {
                    text = text.slice(0, record.endColumn);
                }
                lines.push(text);
            }
            while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
                lines.pop();
            }
            return lines.join('\n');
        };

        const enqueueWrite = (data: string) => {
            renderQueue = renderQueue.then(() => new Promise<void>((resolve) => {
                if (disposed) {
                    resolve();
                    return;
                }
                try {
                    term.write(decodeBase64(data, 'base64'), resolve);
                } catch (error) {
                    console.warn('[terminal] Failed to write output chunk:', error);
                    resolve();
                }
            }));
        };

        const enqueueMetadata = (event: Exclude<import('@slopus/happy-wire').TerminalStreamEvent, { t: 'output' }>) => {
            renderQueue = renderQueue.then(() => {
                if (!disposed) {
                    applyMetadataDecoration(event);
                }
            });
        };

        let attach = () => {};
        // RAW renders the shared PTY. Grid metadata is applied before the TUI
        // redraw bytes that follow it in the same sequence domain.
        const rawOrderer = new TerminalOrderer((event) => {
            if (disposed) {
                return;
            }
            if (event.type === 'write') {
                enqueueWrite(event.data);
            } else if (event.type === 'metadata') {
                if (event.event.t === 'grid') {
                    sharedGridCols = event.event.cols;
                    sharedGridRows = event.event.rows;
                    fitSharedGrid(false);
                    return;
                }
                enqueueMetadata(event.event);
            } else {
                attach();
            }
        });

        // Blocks are shared records, with one orderer/decoder per device seq.
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

        // Attach = fetch the CLI snapshot (and host theme), then settle the
        // orderers so buffered history writes in order. Re-runnable: reconnect
        // wipes the screen and re-attaches from scratch.
        attach = () => {
            setAttaching(true);
            apiSocket.sessionRPC<TerminalAttachResponse, { t: 'attach'; terminalId: string }>(
                sessionId,
                'terminal-attach',
                { t: 'attach', terminalId },
            )
                .then((response) => {
                    if (disposed) {
                        return;
                    }
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
                    if (!response.theme) {
                        return;
                    }
                    // Sync the host's local terminal colors. Override the ANSI
                    // palette entirely; fill any gaps from the app/default theme.
                    term.options.theme = {
                        ...DEFAULT_TERMINAL_ANSI_COLORS,
                        ...Object.fromEntries(
                            Object.entries(response.theme).filter(([, v]) => v != null),
                        ),
                        background: palette.canvas,
                        foreground: palette.text,
                        cursor: palette.accent,
                        cursorAccent: palette.canvas,
                        selectionBackground: palette.selection,
                    };
                })
                .catch((error) => {
                    // Snapshot replay failed - still go live so new output streams in
                    console.warn('[terminal] terminal-attach failed:', error);
                })
                .finally(() => {
                    if (!disposed) {
                        attachSettled = true;
                        rawOrderer.settle();
                        recordMux.settle();
                        fitSharedGrid(true);
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

        // Keystrokes -> CLI
        const dataSubscription = term.onData((data) => {
            sendTerminalInput(data);
        });

        // Report physical capacity, but keep rendering the sequenced shared
        // grid until the CLI confirms a controller-owned grid event.
        let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
        const observer = new ResizeObserver(() => {
            if (resizeTimeout !== null) {
                clearTimeout(resizeTimeout);
            }
            resizeTimeout = setTimeout(() => fitSharedGrid(true), RESIZE_DEBOUNCE_MS);
        });
        observer.observe(container);

        attach();

        controlsRef.current = {
            focus: () => {
                term.focus();
            },
            reconnect: () => {
                // Wipe the screen and re-fetch the snapshot; the orderers'
                // pending buffer merges it with any live chunks that arrive
                // while the attach is in flight.
                term.reset();
                rawOrderer.reset();
                recordMux.reset();
                blockMarkers.clear();
                if (transcriptFlushTimer !== null) {
                    clearTimeout(transcriptFlushTimer);
                    transcriptFlushTimer = null;
                }
                transcriptStreams.clear();
                setTerminalStates({});
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
                const nextZoom = Math.min(8, Math.max(-8, fontZoomDelta + delta));
                if (nextZoom === fontZoomDelta) {
                    return;
                }
                fontZoomDelta = nextZoom;
                fitSharedGrid(false);
                saveTerminalFontSize(term.options.fontSize ?? initialFontSize);
            },
            copyBlock: (commandId: string) => {
                const text = readBlockText(commandId);
                if (!text) {
                    return;
                }
                navigator.clipboard.writeText(text)
                    .then(showCopiedFeedback)
                    .catch((error) => console.warn('[terminal] Copy block failed:', error));
            },
            focusBlock: (commandId: string) => {
                const marker = blockMarkers.get(commandId)?.start;
                if (marker) {
                    term.scrollToLine(marker.line);
                }
                term.focus();
            },
        };

        return () => {
            disposed = true;
            controlsRef.current = null;
            if (resizeTimeout !== null) {
                clearTimeout(resizeTimeout);
            }
            if (transcriptFlushTimer !== null) {
                clearTimeout(transcriptFlushTimer);
            }
            observer.disconnect();
            dataSubscription.dispose();
            unsubscribe();
            term.dispose();
        };
    }, [clearModifiers, sendTerminalInput, sessionId, showCopiedFeedback, terminalId]);

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
        navigator.clipboard.writeText(text)
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
        <View style={{ flex: 1, backgroundColor: palette.canvas }}>
            <TerminalToolbar
                connectionState={connectionState}
                copied={copied}
                onReconnect={() => controlsRef.current?.reconnect()}
                onCopyAll={copyAll}
                onClear={clearVisibleTerminal}
                onFontSizeChange={(delta) => controlsRef.current?.changeFontSize(delta)}
            />
            <View style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
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
                        borderTopColor: palette.border,
                    }}
                >
                    <div
                        ref={containerRef}
                        style={{
                            width: '100%',
                            height: '100%',
                            minHeight: 0,
                            overflow: 'hidden',
                            padding: 6,
                            backgroundColor: palette.canvas,
                        }}
                    />
                </View>
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
        </View>
    );
});
