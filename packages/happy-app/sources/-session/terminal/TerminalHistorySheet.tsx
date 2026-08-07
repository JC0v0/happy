import * as React from 'react';
import {
    Alert,
    FlatList,
    Modal,
    Pressable,
    Text,
    TextInput,
    View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { FontFamilies } from '@/constants/Typography';
import {
    clearTerminalHistory,
    isTerminalHistoryEnabled,
    loadTerminalHistory,
    setTerminalHistoryEnabled,
    setTerminalHistoryFavorite,
    type PersistedTerminalHistoryEntry,
} from '@/sync/persistence';
import { queryTerminalHistory } from './terminalHistorySearch';

function formatWhen(timestamp: number): string {
    const delta = Math.max(0, Date.now() - timestamp);
    if (delta < 60_000) return 'now';
    if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
    if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
    return new Date(timestamp).toLocaleDateString();
}

function formatDuration(ms: number): string {
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

const stylesheet = StyleSheet.create((theme) => ({
    backdrop: {
        flex: 1,
        justifyContent: 'flex-end' as const,
        backgroundColor: theme.dark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.35)',
    },
    sheet: {
        height: '78%' as const,
        backgroundColor: theme.semantic.surface,
        borderTopLeftRadius: 0,
        borderTopRightRadius: 0,
        borderWidth: 1,
        borderBottomWidth: 0,
        borderColor: theme.semantic.border,
    },
    handle: {
        width: 36,
        height: 4,
        marginTop: 9,
        marginBottom: 5,
        borderRadius: 2,
        alignSelf: 'center' as const,
        backgroundColor: theme.semantic.border,
    },
    header: {
        minHeight: 62,
        paddingHorizontal: 14,
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        justifyContent: 'space-between' as const,
    },
    title: {
        color: theme.semantic.textPrimary,
        fontSize: 16,
        fontFamily: FontFamilies.default.semiBold,
    },
    subtitle: {
        color: theme.semantic.textSecondary,
        fontSize: 11,
        fontFamily: FontFamilies.default.regular,
        marginTop: 3,
    },
    headerActions: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 2 },
    iconButton: {
        width: 38,
        height: 38,
        borderRadius: 4,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
    },
    iconCompact: {
        width: 30,
        height: 30,
        borderRadius: 4,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
    },
    pressed: { backgroundColor: theme.semantic.surfaceSelected },
    searchBar: {
        height: 44,
        marginHorizontal: 14,
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 8,
        paddingHorizontal: 11,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: theme.semantic.border,
        backgroundColor: theme.semantic.surfaceMuted,
    },
    searchInput: {
        flex: 1,
        height: 42,
        paddingVertical: 0,
        color: theme.semantic.textPrimary,
        fontSize: 13,
        fontFamily: FontFamilies.mono.regular,
    },
    filters: {
        minHeight: 48,
        paddingHorizontal: 14,
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 8,
    },
    chip: {
        height: 30,
        paddingHorizontal: 10,
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 5,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: theme.semantic.border,
        backgroundColor: theme.semantic.surfaceMuted,
    },
    chipSelected: {
        borderColor: theme.semantic.borderStrong,
        backgroundColor: theme.semantic.surfaceSelected,
    },
    chipText: {
        color: theme.semantic.textSecondary,
        fontSize: 10,
        fontFamily: FontFamilies.default.semiBold,
    },
    chipTextSelected: { color: theme.semantic.textPrimary },
    paused: {
        marginLeft: 'auto' as const,
        color: theme.semantic.status.warning,
        fontSize: 9,
        fontFamily: FontFamilies.mono.semiBold,
        letterSpacing: 0.5,
    },
    listContent: { paddingHorizontal: 10, paddingBottom: 18 },
    emptyContainer: { flexGrow: 1, justifyContent: 'center' as const },
    empty: { alignItems: 'center' as const, gap: 8 },
    emptyTitle: {
        color: theme.semantic.textMuted,
        fontSize: 12,
        fontFamily: FontFamilies.default.regular,
    },
    row: {
        minHeight: 68,
        marginBottom: 5,
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        borderRadius: 0,
        borderWidth: 1,
        borderColor: theme.semantic.border,
        backgroundColor: theme.semantic.surface,
        overflow: 'hidden' as const,
    },
    rowMain: {
        flex: 1,
        minWidth: 0,
        minHeight: 66,
        paddingHorizontal: 10,
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 9,
    },
    exitDot: { width: 7, height: 7, borderRadius: 999 },
    rowContent: { flex: 1, minWidth: 0 },
    command: {
        color: theme.semantic.textPrimary,
        fontSize: 12,
        lineHeight: 17,
        fontFamily: FontFamilies.mono.semiBold,
    },
    rowMeta: {
        marginTop: 5,
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        justifyContent: 'space-between' as const,
        gap: 10,
    },
    meta: {
        flexShrink: 1,
        color: theme.semantic.textSecondary,
        fontSize: 9,
        fontFamily: FontFamilies.mono.regular,
    },
}));

export const TerminalHistorySheet = React.memo(function TerminalHistorySheet(props: {
    visible: boolean;
    currentMachineId?: string;
    revision: string;
    onClose: () => void;
    onRun: (command: string) => void;
}) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const safeArea = useSafeAreaInsets();
    const [entries, setEntries] = React.useState<PersistedTerminalHistoryEntry[]>([]);
    const [query, setQuery] = React.useState('');
    const [favoritesOnly, setFavoritesOnly] = React.useState(false);
    const [currentMachineOnly, setCurrentMachineOnly] = React.useState(false);
    const [historyEnabled, setHistoryEnabledState] = React.useState(true);

    const reload = React.useCallback(() => {
        setEntries(loadTerminalHistory());
        setHistoryEnabledState(isTerminalHistoryEnabled());
    }, []);

    React.useEffect(() => {
        if (props.visible) {
            reload();
        }
    }, [props.visible, props.revision, reload]);

    const visibleEntries = React.useMemo(() => queryTerminalHistory(entries, {
        text: query,
        favoritesOnly,
        machineId: currentMachineOnly ? props.currentMachineId : undefined,
    }), [currentMachineOnly, entries, favoritesOnly, props.currentMachineId, query]);

    const toggleHistoryEnabled = React.useCallback(() => {
        const next = !historyEnabled;
        setTerminalHistoryEnabled(next);
        setHistoryEnabledState(next);
    }, [historyEnabled]);

    const confirmClear = React.useCallback(() => {
        Alert.alert(
            'Clear command history?',
            'This removes command history stored on this device. Favorites are removed too.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Clear',
                    style: 'destructive',
                    onPress: () => {
                        clearTerminalHistory();
                        reload();
                    },
                },
            ],
        );
    }, [reload]);

    const renderItem = React.useCallback(({ item }: { item: PersistedTerminalHistoryEntry }) => (
        <HistoryRow
            entry={item}
            onRun={() => {
                props.onRun(item.command);
                props.onClose();
            }}
            onFavorite={() => {
                setTerminalHistoryFavorite(item.id, !item.favorite);
                reload();
            }}
        />
    ), [props, reload]);

    return (
        <Modal visible={props.visible} transparent animationType="slide" onRequestClose={props.onClose}>
            <Pressable style={styles.backdrop} onPress={props.onClose}>
                <Pressable
                    style={[styles.sheet, { paddingBottom: Math.max(safeArea.bottom, 12) }]}
                    onPress={(event) => event.stopPropagation()}
                >
                    <View style={styles.handle} />
                    <View style={styles.header}>
                        <View>
                            <Text style={styles.title}>Command history</Text>
                            <Text style={styles.subtitle}>Stored only on this device</Text>
                        </View>
                        <View style={styles.headerActions}>
                            <IconButton
                                icon={historyEnabled ? 'eye-outline' : 'eye-off-outline'}
                                label={historyEnabled ? 'Pause command history' : 'Resume command history'}
                                active={!historyEnabled}
                                onPress={toggleHistoryEnabled}
                            />
                            <IconButton icon="trash-outline" label="Clear command history" danger onPress={confirmClear} />
                            <IconButton icon="close" label="Close command history" onPress={props.onClose} />
                        </View>
                    </View>

                    <View style={styles.searchBar}>
                        <Ionicons name="search" size={17} color={theme.semantic.textMuted} />
                        <TextInput
                            value={query}
                            onChangeText={setQuery}
                            placeholder="Search commands, paths, machines"
                            placeholderTextColor={theme.semantic.textMuted}
                            autoCapitalize="none"
                            autoCorrect={false}
                            style={styles.searchInput}
                        />
                        {!historyEnabled ? <Text style={styles.paused}>PAUSED</Text> : null}
                    </View>

                    <View style={styles.filters}>
                        <FilterChip
                            label="Favorites"
                            icon="star-outline"
                            selected={favoritesOnly}
                            onPress={() => setFavoritesOnly((v) => !v)}
                        />
                        <FilterChip
                            label="This device"
                            icon="desktop-outline"
                            selected={currentMachineOnly}
                            onPress={() => setCurrentMachineOnly((v) => !v)}
                        />
                    </View>

                    <FlatList
                        data={visibleEntries}
                        keyExtractor={(item) => item.id}
                        renderItem={renderItem}
                        contentContainerStyle={styles.listContent}
                        contentInsetAdjustmentBehavior="automatic"
                        keyboardShouldPersistTaps="handled"
                        ListEmptyComponent={
                            <View style={styles.emptyContainer}>
                                <View style={styles.empty}>
                                    <Ionicons name="search-outline" size={28} color={theme.semantic.textMuted} />
                                    <Text style={styles.emptyTitle}>No matching commands</Text>
                                </View>
                            </View>
                        }
                    />
                </Pressable>
            </Pressable>
        </Modal>
    );
});

function HistoryRow(props: {
    entry: PersistedTerminalHistoryEntry;
    onRun: () => void;
    onFavorite: () => void;
}) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const exitOk = props.entry.exitCode === 0;
    const dotColor = props.entry.exitCode === undefined
        ? theme.semantic.status.offline
        : exitOk
            ? theme.semantic.status.success
            : theme.semantic.status.error;

    return (
        <View style={styles.row}>
            <Pressable onPress={props.onRun} style={styles.rowMain}>
                <View style={[styles.exitDot, { backgroundColor: dotColor }]} />
                <View style={styles.rowContent}>
                    <Text style={styles.command} numberOfLines={2}>{props.entry.command}</Text>
                    <View style={styles.rowMeta}>
                        <Text style={styles.meta}>{formatWhen(props.entry.startedAt)}</Text>
                        {props.entry.durationMs !== undefined ? (
                            <Text style={styles.meta}>{formatDuration(props.entry.durationMs)}</Text>
                        ) : null}
                        {props.entry.host ? (
                            <Text style={styles.meta} numberOfLines={1}>{props.entry.host}</Text>
                        ) : null}
                    </View>
                </View>
                <Ionicons name="play" size={14} color={theme.semantic.textPrimary} />
            </Pressable>
            <IconButton
                icon={props.entry.favorite ? 'star' : 'star-outline'}
                label={props.entry.favorite ? 'Remove favorite' : 'Add favorite'}
                active={props.entry.favorite}
                onPress={props.onFavorite}
            />
        </View>
    );
}

function FilterChip(props: {
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    selected: boolean;
    onPress: () => void;
}) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const iconColor = props.selected ? theme.semantic.textPrimary : theme.semantic.textMuted;
    return (
        <Pressable onPress={props.onPress} style={[styles.chip, props.selected && styles.chipSelected]}>
            <Ionicons name={props.icon} size={13} color={iconColor} />
            <Text style={[styles.chipText, props.selected && styles.chipTextSelected]}>{props.label}</Text>
        </Pressable>
    );
}

function IconButton(props: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    onPress: () => void;
    active?: boolean;
    danger?: boolean;
    compact?: boolean;
}) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const color = props.danger
        ? theme.semantic.status.error
        : props.active
            ? theme.semantic.textPrimary
            : theme.semantic.textMuted;
    return (
        <Pressable
            onPress={props.onPress}
            accessibilityRole="button"
            accessibilityLabel={props.label}
            style={({ pressed }) => [props.compact ? styles.iconCompact : styles.iconButton, pressed && styles.pressed]}
        >
            <Ionicons
                name={props.icon}
                size={props.compact ? 16 : 18}
                color={color}
            />
        </Pressable>
    );
}

