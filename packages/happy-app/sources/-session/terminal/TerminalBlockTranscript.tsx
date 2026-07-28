import * as React from 'react';
import {
    Pressable,
    SectionList,
    Text,
    View,
    type NativeScrollEvent,
    type NativeSyntheticEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { TerminalCommandBlock } from './terminalCommandState';
import { terminalBlockOutputText } from './terminalTranscript';
import { TERMINAL_VISUAL_THEME as palette } from './terminalVisualTheme';

interface TerminalBlockTranscriptProps {
    blocks: TerminalCommandBlock[];
    localTerminalId: string;
    fontSize: number;
    initialSelectedBlockId?: string | null;
    favoriteCommandIds: ReadonlySet<string>;
    onSelectBlock: (block: TerminalCommandBlock) => void;
    onCopyCommand: (block: TerminalCommandBlock) => void;
    onCopyOutput: (block: TerminalCommandBlock) => void;
    onRerun: (block: TerminalCommandBlock) => void;
    onToggleFavorite: (block: TerminalCommandBlock) => void;
    onOpenRaw: (block: TerminalCommandBlock) => void;
}

interface TranscriptSection {
    block: TerminalCommandBlock;
    data: TerminalCommandBlock[];
}

function formatDuration(durationMs: number | undefined): string {
    if (durationMs === undefined) {
        return 'running';
    }
    if (durationMs < 1000) {
        return `${durationMs} ms`;
    }
    if (durationMs < 60_000) {
        return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)} s`;
    }
    const minutes = Math.floor(durationMs / 60_000);
    const seconds = Math.floor((durationMs % 60_000) / 1000);
    return `${minutes}m ${seconds}s`;
}

function statusPresentation(block: TerminalCommandBlock): {
    color: string;
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
} {
    if (block.status === 'running') {
        return { color: palette.warning, icon: 'sync-outline', label: 'RUNNING' };
    }
    if (block.status === 'waiting') {
        return { color: palette.warning, icon: 'alert-circle-outline', label: 'INPUT' };
    }
    if (block.status === 'succeeded') {
        return { color: palette.success, icon: 'checkmark-circle-outline', label: 'DONE' };
    }
    return { color: palette.danger, icon: 'close-circle-outline', label: `EXIT ${block.exitCode ?? 1}` };
}

export const TerminalBlockTranscript = React.memo(function TerminalBlockTranscript(props: TerminalBlockTranscriptProps) {
    const listRef = React.useRef<SectionList<TerminalCommandBlock, TranscriptSection>>(null);
    const followingBottomRef = React.useRef(true);
    const [showJumpToLatest, setShowJumpToLatest] = React.useState(false);
    const [selectedBlockId, setSelectedBlockId] = React.useState<string | null>(
        props.initialSelectedBlockId ?? props.blocks[props.blocks.length - 1]?.commandId ?? null,
    );
    const [collapsedBlockIds, setCollapsedBlockIds] = React.useState<ReadonlySet<string>>(new Set());

    React.useEffect(() => {
        if (selectedBlockId === null && props.blocks.length > 0) {
            setSelectedBlockId(props.blocks[props.blocks.length - 1].commandId);
        }
    }, [props.blocks, selectedBlockId]);

    React.useEffect(() => {
        if (
            props.initialSelectedBlockId
            && props.blocks.some((block) => block.commandId === props.initialSelectedBlockId)
        ) {
            setSelectedBlockId(props.initialSelectedBlockId);
        }
    }, [props.blocks, props.initialSelectedBlockId]);

    const sections = React.useMemo<TranscriptSection[]>(() => props.blocks.map((block) => ({
        block,
        data: collapsedBlockIds.has(block.commandId) ? [] : [block],
    })), [collapsedBlockIds, props.blocks]);

    const selectBlock = React.useCallback((block: TerminalCommandBlock) => {
        setSelectedBlockId(block.commandId);
        props.onSelectBlock(block);
    }, [props]);

    const toggleCollapsed = React.useCallback((commandId: string) => {
        setCollapsedBlockIds((current) => {
            const next = new Set(current);
            if (next.has(commandId)) {
                next.delete(commandId);
            } else {
                next.add(commandId);
            }
            return next;
        });
    }, []);

    const onScroll = React.useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
        const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
        const followsBottom = distanceFromBottom < 56;
        followingBottomRef.current = followsBottom;
        setShowJumpToLatest(!followsBottom && contentSize.height > layoutMeasurement.height + 80);
    }, []);

    const scrollToLatest = React.useCallback(() => {
        listRef.current?.getScrollResponder()?.scrollToEnd({ animated: true });
        followingBottomRef.current = true;
        setShowJumpToLatest(false);
    }, []);

    return (
        <View style={styles.root}>
            <SectionList
                ref={listRef}
                sections={sections}
                keyExtractor={(block) => block.commandId}
                stickySectionHeadersEnabled
                contentInsetAdjustmentBehavior="automatic"
                keyboardShouldPersistTaps="handled"
                onScroll={onScroll}
                scrollEventThrottle={32}
                onContentSizeChange={() => {
                    if (followingBottomRef.current) {
                        requestAnimationFrame(() => listRef.current?.getScrollResponder()?.scrollToEnd({ animated: false }));
                    }
                }}
                contentContainerStyle={props.blocks.length === 0 ? styles.emptyContent : styles.content}
                ListEmptyComponent={<EmptyTranscript />}
                renderSectionHeader={({ section }) => (
                    <BlockHeader
                        block={section.block}
                        localTerminalId={props.localTerminalId}
                        selected={selectedBlockId === section.block.commandId}
                        collapsed={collapsedBlockIds.has(section.block.commandId)}
                        favorite={props.favoriteCommandIds.has(section.block.commandId)}
                        onSelect={() => selectBlock(section.block)}
                        onToggleCollapsed={() => toggleCollapsed(section.block.commandId)}
                        onCopyCommand={() => props.onCopyCommand(section.block)}
                        onCopyOutput={() => props.onCopyOutput(section.block)}
                        onRerun={() => props.onRerun(section.block)}
                        onToggleFavorite={() => props.onToggleFavorite(section.block)}
                        onOpenRaw={() => props.onOpenRaw(section.block)}
                    />
                )}
                renderItem={({ item }) => (
                    <BlockOutput
                        block={item}
                        localTerminalId={props.localTerminalId}
                        fontSize={props.fontSize}
                        selected={selectedBlockId === item.commandId}
                        onOpenRaw={() => props.onOpenRaw(item)}
                    />
                )}
                ListFooterComponent={<View style={styles.footerSpace} />}
            />
            {showJumpToLatest ? (
                <Pressable
                    onPress={scrollToLatest}
                    accessibilityRole="button"
                    accessibilityLabel="Jump to latest command"
                    style={({ pressed }) => [styles.jumpButton, pressed && styles.pressed]}
                >
                    <Ionicons name="arrow-down" size={17} color={palette.text} />
                    <Text style={styles.jumpText}>最新</Text>
                </Pressable>
            ) : null}
        </View>
    );
});

function BlockHeader(props: {
    block: TerminalCommandBlock;
    localTerminalId: string;
    selected: boolean;
    collapsed: boolean;
    favorite: boolean;
    onSelect: () => void;
    onToggleCollapsed: () => void;
    onCopyCommand: () => void;
    onCopyOutput: () => void;
    onRerun: () => void;
    onToggleFavorite: () => void;
    onOpenRaw: () => void;
}) {
    const status = statusPresentation(props.block);
    const isLocal = props.block.terminalId === undefined || props.block.terminalId === props.localTerminalId;
    return (
        <View style={[styles.headerShell, props.selected && styles.headerSelected]}>
            <View style={styles.header}>
                <Pressable
                    onPress={props.onSelect}
                    onLongPress={props.onSelect}
                    accessibilityRole="button"
                    accessibilityLabel={`Select command ${props.block.command}`}
                    style={({ pressed }) => [styles.headerMain, pressed && styles.pressed]}
                >
                    <Text style={styles.prompt}>›</Text>
                    <View style={styles.headerContent}>
                        <Text selectable style={styles.command} numberOfLines={2}>{props.block.command}</Text>
                        <View style={styles.metaRow}>
                            <View style={styles.statusGroup}>
                                <Ionicons name={status.icon} size={12} color={status.color} />
                                <Text style={[styles.status, { color: status.color }]}>{status.label}</Text>
                                <Text style={styles.duration}>· {props.block.status === 'waiting' ? 'waiting' : formatDuration(props.block.durationMs)}</Text>
                            </View>
                            <Text style={styles.deviceLabel}>{isLocal ? '本机' : '其他设备'}</Text>
                            {props.block.cwd ? <Text selectable style={styles.cwd} numberOfLines={1}>{props.block.cwd}</Text> : null}
                        </View>
                    </View>
                </Pressable>
                <Pressable
                    onPress={props.onToggleCollapsed}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={props.collapsed ? 'Expand command output' : 'Collapse command output'}
                    style={({ pressed }) => [styles.collapseButton, pressed && styles.pressed]}
                >
                    <Ionicons name={props.collapsed ? 'chevron-down' : 'chevron-up'} size={17} color={palette.textMuted} />
                </Pressable>
            </View>
            {props.selected ? (
                <View style={styles.actions}>
                    <BlockAction icon="code-slash-outline" label="命令" onPress={props.onCopyCommand} />
                    <BlockAction icon="copy-outline" label="输出" onPress={props.onCopyOutput} />
                    <BlockAction icon="refresh-outline" label="重跑" onPress={props.onRerun} />
                    <BlockAction
                        icon={props.favorite ? 'bookmark' : 'bookmark-outline'}
                        label={props.favorite ? '已收藏' : '收藏'}
                        onPress={props.onToggleFavorite}
                        disabled={props.block.endedAt === undefined}
                    />
                    <BlockAction icon="terminal-outline" label="RAW" onPress={props.onOpenRaw} disabled={!isLocal} />
                </View>
            ) : null}
        </View>
    );
}

function BlockAction(props: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    onPress: () => void;
    disabled?: boolean;
}) {
    return (
        <Pressable
            onPress={props.onPress}
            disabled={props.disabled}
            accessibilityRole="button"
            accessibilityLabel={props.label}
            style={({ pressed }) => [
                styles.action,
                pressed && styles.pressed,
                props.disabled && styles.disabled,
            ]}
        >
            <Ionicons name={props.icon} size={15} color={palette.textMuted} />
            <Text style={styles.actionText}>{props.label}</Text>
        </Pressable>
    );
}

function BlockOutput(props: {
    block: TerminalCommandBlock;
    localTerminalId: string;
    fontSize: number;
    selected: boolean;
    onOpenRaw: () => void;
}) {
    const output = React.useMemo(() => terminalBlockOutputText(props.block), [props.block]);
    const isLocal = props.block.terminalId === undefined || props.block.terminalId === props.localTerminalId;
    return (
        <View style={[styles.outputShell, props.selected && styles.outputSelected]}>
            {output ? (
                <Text selectable style={[styles.output, { fontSize: props.fontSize, lineHeight: Math.round(props.fontSize * 1.55) }]}>
                    {output}
                </Text>
            ) : (
                <Text style={styles.emptyOutput}>
                    {props.block.status === 'running' || props.block.status === 'waiting' ? '等待输出…' : '无输出'}
                </Text>
            )}
            {props.block.rawPreferred ? (
                <Pressable
                    onPress={props.onOpenRaw}
                    disabled={!isLocal}
                    style={({ pressed }) => [styles.rawBanner, pressed && styles.pressed, !isLocal && styles.disabled]}
                >
                    <Ionicons name="terminal-outline" size={16} color={palette.warning} />
                    <View style={styles.rawBannerText}>
                        <Text style={styles.rawTitle}>交互式终端</Text>
                        <Text style={styles.rawSubtitle}>此命令使用全屏终端，切换到 RAW 查看和操作</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={17} color={palette.textMuted} />
                </Pressable>
            ) : null}
        </View>
    );
}

function EmptyTranscript() {
    return (
        <View style={styles.empty}>
            <View style={styles.emptyIcon}>
                <Ionicons name="terminal-outline" size={22} color={palette.accent} />
            </View>
            <Text style={styles.emptyTitle}>运行一条命令</Text>
            <Text style={styles.emptySubtitle}>命令和输出会作为可复制、重跑和收藏的 Block 保存在这里。</Text>
        </View>
    );
}

const styles = {
    root: { flex: 1, position: 'relative' as const, backgroundColor: palette.canvas },
    content: { paddingTop: 4 },
    emptyContent: { flexGrow: 1 },
    headerShell: {
        backgroundColor: palette.canvas,
        borderTopWidth: 1,
        borderTopColor: palette.border,
        borderLeftWidth: 2,
        borderLeftColor: 'transparent',
    },
    headerSelected: { borderLeftColor: palette.accent, backgroundColor: palette.chrome },
    header: { minHeight: 64, flexDirection: 'row' as const, alignItems: 'flex-start' as const, paddingRight: 6 },
    headerMain: { flex: 1, minWidth: 0, flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 8, paddingLeft: 12, paddingVertical: 10 },
    prompt: { color: palette.accent, fontSize: 18, lineHeight: 22, fontFamily: 'monospace', fontWeight: '700' as const },
    headerContent: { flex: 1, minWidth: 0, gap: 7 },
    command: { color: palette.text, fontSize: 13, lineHeight: 18, fontFamily: 'monospace', fontWeight: '600' as const },
    metaRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: 8 },
    statusGroup: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
    status: { fontSize: 9, fontWeight: '800' as const, letterSpacing: 0.45 },
    deviceLabel: { color: palette.textMuted, fontSize: 9, fontWeight: '700' as const },
    duration: { color: palette.textMuted, fontSize: 10, fontVariant: ['tabular-nums'] as ('tabular-nums')[] },
    cwd: { flex: 1, color: palette.textMuted, fontSize: 10, textAlign: 'right' as const, fontFamily: 'monospace' },
    collapseButton: { width: 36, height: 36, alignItems: 'center' as const, justifyContent: 'center' as const, borderRadius: 9 },
    actions: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 2, paddingHorizontal: 10, paddingBottom: 8 },
    action: { minWidth: 54, height: 36, paddingHorizontal: 7, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 4, borderRadius: 8 },
    actionText: { color: palette.textMuted, fontSize: 10, fontWeight: '600' as const },
    disabled: { opacity: 0.35 },
    outputShell: { paddingHorizontal: 16, paddingTop: 7, paddingBottom: 18, backgroundColor: palette.canvas },
    outputSelected: { borderLeftWidth: 2, borderLeftColor: palette.accent, paddingLeft: 14, backgroundColor: palette.chrome },
    output: { color: palette.text, fontFamily: 'monospace' },
    emptyOutput: { color: palette.textMuted, fontSize: 12, fontStyle: 'italic' as const },
    rawBanner: { minHeight: 54, marginTop: 12, paddingHorizontal: 11, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 9, borderRadius: 10, backgroundColor: palette.chromeRaised, borderWidth: 1, borderColor: palette.border },
    rawBannerText: { flex: 1, minWidth: 0, gap: 2 },
    rawTitle: { color: palette.text, fontSize: 12, fontWeight: '700' as const },
    rawSubtitle: { color: palette.textMuted, fontSize: 10, lineHeight: 14 },
    footerSpace: { height: 28 },
    jumpButton: { position: 'absolute' as const, right: 14, bottom: 12, height: 40, paddingHorizontal: 12, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, borderRadius: 20, backgroundColor: palette.controlPressed, borderWidth: 1, borderColor: palette.border },
    jumpText: { color: palette.text, fontSize: 11, fontWeight: '700' as const },
    pressed: { backgroundColor: palette.controlPressed },
    empty: { flex: 1, minHeight: 260, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8, paddingHorizontal: 38 },
    emptyIcon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: palette.chromeRaised },
    emptyTitle: { color: palette.text, fontSize: 15, fontWeight: '700' as const },
    emptySubtitle: { color: palette.textMuted, fontSize: 12, lineHeight: 18, textAlign: 'center' as const },
};
