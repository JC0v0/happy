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
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { FontFamilies } from '@/constants/Typography';
import { localizedText } from '@/text';
import type { TerminalCommandBlock } from './terminalCommandState';
import { terminalBlockOutputText } from './terminalTranscript';

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

const stylesheet = StyleSheet.create((theme) => ({
    root: { flex: 1, position: 'relative' as const, backgroundColor: theme.semantic.canvas },
    content: { paddingTop: 4 },
    emptyContent: { flexGrow: 1 },
    headerShell: {
        backgroundColor: theme.semantic.canvas,
        borderTopWidth: 1,
        borderTopColor: theme.semantic.border,
        borderLeftWidth: 2,
        borderLeftColor: 'transparent',
    },
    headerSelected: {
        borderLeftColor: theme.semantic.borderStrong,
        backgroundColor: theme.semantic.surface,
    },
    header: { minHeight: 64, flexDirection: 'row' as const, alignItems: 'flex-start' as const, paddingRight: 6 },
    headerMain: {
        flex: 1,
        minWidth: 0,
        flexDirection: 'row' as const,
        alignItems: 'flex-start' as const,
        gap: 8,
        paddingLeft: 12,
        paddingVertical: 10,
    },
    prompt: {
        color: theme.semantic.textPrimary,
        fontSize: 18,
        lineHeight: 22,
        fontFamily: FontFamilies.mono.semiBold,
    },
    headerContent: { flex: 1, minWidth: 0, gap: 7 },
    command: {
        color: theme.semantic.textPrimary,
        fontSize: 13,
        lineHeight: 18,
        fontFamily: FontFamilies.mono.semiBold,
    },
    metaRow: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        justifyContent: 'space-between' as const,
        gap: 8,
    },
    statusGroup: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
    status: {
        fontSize: 9,
        fontFamily: FontFamilies.mono.semiBold,
        letterSpacing: 0.45,
    },
    deviceLabel: {
        color: theme.semantic.textMuted,
        fontSize: 9,
        fontFamily: FontFamilies.default.semiBold,
    },
    duration: {
        color: theme.semantic.textSecondary,
        fontSize: 10,
        fontVariant: ['tabular-nums'] as ('tabular-nums')[],
        fontFamily: FontFamilies.mono.regular,
    },
    cwd: {
        flex: 1,
        color: theme.semantic.textMuted,
        fontSize: 10,
        textAlign: 'right' as const,
        fontFamily: FontFamilies.mono.regular,
    },
    collapseButton: {
        width: 36,
        height: 36,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        borderRadius: 4,
    },
    actions: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 2,
        paddingHorizontal: 10,
        paddingBottom: 8,
    },
    action: {
        minWidth: 54,
        height: 36,
        paddingHorizontal: 7,
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        gap: 4,
        borderRadius: 4,
    },
    actionText: {
        color: theme.semantic.textSecondary,
        fontSize: 10,
        fontFamily: FontFamilies.default.semiBold,
    },
    disabled: { opacity: 0.35 },
    outputShell: {
        paddingHorizontal: 16,
        paddingTop: 7,
        paddingBottom: 18,
        backgroundColor: theme.semantic.canvas,
    },
    outputSelected: {
        borderLeftWidth: 2,
        borderLeftColor: theme.semantic.borderStrong,
        paddingLeft: 14,
        backgroundColor: theme.semantic.surface,
    },
    output: {
        color: theme.semantic.textPrimary,
        fontFamily: FontFamilies.mono.regular,
    },
    emptyOutput: {
        color: theme.semantic.textMuted,
        fontSize: 12,
        fontStyle: 'italic' as const,
    },
    rawBanner: {
        minHeight: 54,
        marginTop: 12,
        paddingHorizontal: 11,
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 9,
        borderRadius: 4,
        backgroundColor: theme.semantic.surfaceMuted,
        borderWidth: 1,
        borderColor: theme.semantic.border,
    },
    rawBannerText: { flex: 1, minWidth: 0, gap: 2 },
    rawTitle: {
        color: theme.semantic.textPrimary,
        fontSize: 12,
        fontFamily: FontFamilies.default.semiBold,
    },
    rawSubtitle: {
        color: theme.semantic.textSecondary,
        fontSize: 10,
        lineHeight: 14,
        fontFamily: FontFamilies.default.regular,
    },
    footerSpace: { height: 28 },
    jumpButton: {
        position: 'absolute' as const,
        right: 14,
        bottom: 12,
        height: 40,
        paddingHorizontal: 12,
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 6,
        borderRadius: 4,
        backgroundColor: theme.semantic.surface,
        borderWidth: 1,
        borderColor: theme.semantic.border,
    },
    jumpText: {
        color: theme.semantic.textPrimary,
        fontSize: 11,
        fontFamily: FontFamilies.default.semiBold,
    },
    pressed: { backgroundColor: theme.semantic.surfaceSelected },
    empty: {
        flex: 1,
        minHeight: 260,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        gap: 8,
        paddingHorizontal: 38,
    },
    emptyIcon: {
        width: 48,
        height: 48,
        borderRadius: 4,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        backgroundColor: theme.semantic.surfaceMuted,
        borderWidth: 1,
        borderColor: theme.semantic.border,
    },
    emptyTitle: {
        color: theme.semantic.textPrimary,
        fontSize: 15,
        fontFamily: FontFamilies.default.semiBold,
    },
    emptySubtitle: {
        color: theme.semantic.textSecondary,
        fontSize: 12,
        lineHeight: 18,
        textAlign: 'center' as const,
        fontFamily: FontFamilies.default.regular,
    },
}));

export const TerminalBlockTranscript = React.memo(function TerminalBlockTranscript(props: TerminalBlockTranscriptProps) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
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

    const statusPresentation = React.useCallback((block: TerminalCommandBlock) => {
        if (block.status === 'running') {
            return { color: theme.semantic.status.info, icon: 'sync-outline' as const, label: 'RUNNING' };
        }
        if (block.status === 'waiting') {
            return { color: theme.semantic.status.warning, icon: 'alert-circle-outline' as const, label: 'INPUT' };
        }
        if (block.status === 'succeeded') {
            return { color: theme.semantic.status.success, icon: 'checkmark-circle-outline' as const, label: 'DONE' };
        }
        return { color: theme.semantic.status.error, icon: 'close-circle-outline' as const, label: `EXIT ${block.exitCode ?? 1}` };
    }, [theme]);

    const renderSectionHeader = React.useCallback(({ section }: { section: TranscriptSection }) => {
        const block = section.block;
        const isSelected = selectedBlockId === block.commandId;
        const isCollapsed = collapsedBlockIds.has(block.commandId);
        const status = statusPresentation(block);
        return (
            <View style={[styles.headerShell, isSelected && styles.headerSelected]}>
                <Pressable onPress={() => selectBlock(block)}>
                    <View style={styles.header}>
                        <View style={styles.headerMain}>
                            <Text style={styles.prompt}>&gt;</Text>
                            <View style={styles.headerContent}>
                                <Text style={styles.command} numberOfLines={isCollapsed ? 1 : 0}>
                                    {block.command}
                                </Text>
                                <View style={styles.metaRow}>
                                    <View style={styles.statusGroup}>
                                        <Ionicons name={status.icon} size={11} color={status.color} />
                                        <Text style={[styles.status, { color: status.color }]}>{status.label}</Text>
                                    </View>
                                    {block.durationMs !== undefined ? (
                                        <Text style={styles.duration}>{formatDuration(block.durationMs)}</Text>
                                    ) : null}
                                    {block.cwd ? (
                                        <Text style={styles.cwd} numberOfLines={1}>{block.cwd}</Text>
                                    ) : null}
                                </View>
                            </View>
                        </View>
                        <Pressable
                            onPress={() => toggleCollapsed(block.commandId)}
                            style={styles.collapseButton}
                            accessibilityRole="button"
                            accessibilityLabel={isCollapsed
                                ? localizedText('Expand block', '展开块', '展開區塊')
                                : localizedText('Collapse block', '折叠块', '摺疊區塊')}
                        >
                            <Ionicons
                                name={isCollapsed ? 'chevron-down' : 'chevron-up'}
                                size={16}
                                color={theme.semantic.textMuted}
                            />
                        </Pressable>
                    </View>
                </Pressable>
                {!isCollapsed && isSelected ? (
                    <View style={styles.actions}>
                        <ActionButton
                            icon="copy-outline"
                            label="Copy"
                            onPress={() => props.onCopyCommand(block)}
                        />
                        <ActionButton
                            icon="copy"
                            label="Output"
                            onPress={() => props.onCopyOutput(block)}
                            disabled={!terminalBlockOutputText(block)}
                        />
                        <ActionButton
                            icon="play"
                            label="Rerun"
                            onPress={() => props.onRerun(block)}
                        />
                        <ActionButton
                            icon={props.favoriteCommandIds.has(block.commandId) ? 'star' : 'star-outline'}
                            label="Fav"
                            active={props.favoriteCommandIds.has(block.commandId)}
                            onPress={() => props.onToggleFavorite(block)}
                        />
                        {block.status !== 'running' && block.rawPreferred ? (
                            <ActionButton
                                icon="terminal-outline"
                                label="Raw"
                                onPress={() => props.onOpenRaw(block)}
                            />
                        ) : null}
                    </View>
                ) : null}
            </View>
        );
    }, [collapsedBlockIds, props, selectedBlockId, statusPresentation, styles, theme]);

    const renderItem = React.useCallback(({ item, section }: { item: TerminalCommandBlock; section: TranscriptSection }) => {
        const isSelected = selectedBlockId === item.commandId;
        const output = terminalBlockOutputText(item);
        return (
            <View style={[styles.outputShell, isSelected && styles.outputSelected]}>
                {output ? (
                    <Text
                        selectable
                        style={[styles.output, { fontSize: props.fontSize }]}
                    >
                        {output}
                    </Text>
                ) : (
                    <Text style={styles.emptyOutput}>{localizedText('No output', '无输出', '無輸出')}</Text>
                )}
                {item.rawPreferred && item.status !== 'running' ? (
                    <Pressable
                        style={styles.rawBanner}
                        onPress={() => props.onOpenRaw(item)}
                        accessibilityRole="button"
                        accessibilityLabel={localizedText('View in raw terminal', '在原始终端中查看', '在原始終端機中檢視')}
                    >
                        <Ionicons name="terminal-outline" size={18} color={theme.semantic.textPrimary} />
                        <View style={styles.rawBannerText}>
                            <Text style={styles.rawTitle}>{localizedText('Interactive terminal', '交互式终端', '互動式終端機')}</Text>
                            <Text style={styles.rawSubtitle}>{localizedText('This command uses a full-screen terminal. Switch to RAW to view and interact.', '此命令使用全屏终端。切换到 RAW 模式查看和交互。', '此命令使用全螢幕終端機。切換到 RAW 模式檢視和互動。')}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={17} color={theme.semantic.textMuted} />
                    </Pressable>
                ) : null}
            </View>
        );
    }, [props.fontSize, props, selectedBlockId, styles, theme]);

    return (
        <View style={styles.root}>
            <SectionList
                ref={listRef}
                sections={sections}
                keyExtractor={(item) => item.commandId}
                renderItem={renderItem}
                renderSectionHeader={renderSectionHeader}
                contentContainerStyle={styles.content}
                onScroll={onScroll}
                scrollEventThrottle={60}
                stickySectionHeadersEnabled={false}
                showsVerticalScrollIndicator={false}
                ListFooterComponent={<View style={styles.footerSpace} />}
                ListEmptyComponent={
                    <View style={styles.emptyContent}>
                        <EmptyTranscript />
                    </View>
                }
            />
            {showJumpToLatest ? (
                <Pressable
                    style={styles.jumpButton}
                    onPress={scrollToLatest}
                    accessibilityRole="button"
                    accessibilityLabel={localizedText('Jump to latest', '跳转到最新', '跳轉到最新')}
                >
                    <Ionicons name="arrow-down" size={14} color={theme.semantic.textPrimary} />
                    <Text style={styles.jumpText}>{localizedText('Latest', '最新', '最新')}</Text>
                </Pressable>
            ) : null}
        </View>
    );
});

function ActionButton(props: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    onPress: () => void;
    disabled?: boolean;
    active?: boolean;
}) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const color = props.disabled
        ? theme.semantic.textMuted
        : props.active
            ? theme.semantic.textPrimary
            : theme.semantic.textSecondary;
    return (
        <Pressable
            onPress={props.onPress}
            disabled={props.disabled}
            accessibilityRole="button"
            accessibilityLabel={props.label}
            style={({ pressed }) => [
                styles.action,
                pressed && !props.disabled && styles.pressed,
                props.disabled && styles.disabled,
            ]}
        >
            <Ionicons name={props.icon} size={13} color={color} />
            <Text style={[styles.actionText, { color }]}>{props.label}</Text>
        </Pressable>
    );
}

function EmptyTranscript() {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    return (
        <View style={styles.empty}>
            <View style={styles.emptyIcon}>
                <Ionicons name="terminal-outline" size={22} color={theme.semantic.textPrimary} />
            </View>
            <Text style={styles.emptyTitle}>Run a command</Text>
            <Text style={styles.emptySubtitle}>Commands and output are saved here as copyable, rerunnable, and favoritable Blocks.</Text>
        </View>
    );
}

