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
import {
    clearTerminalHistory,
    isTerminalHistoryEnabled,
    loadTerminalHistory,
    setTerminalHistoryEnabled,
    setTerminalHistoryFavorite,
    type PersistedTerminalHistoryEntry,
} from '@/sync/persistence';
import { queryTerminalHistory } from './terminalHistorySearch';
import { TERMINAL_VISUAL_THEME as palette } from './terminalVisualTheme';

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

export const TerminalHistorySheet = React.memo(function TerminalHistorySheet(props: {
    visible: boolean;
    currentMachineId?: string;
    revision: string;
    onClose: () => void;
    onRun: (command: string) => void;
}) {
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
                        <Ionicons name="search" size={17} color={palette.textMuted} />
                        <TextInput
                            value={query}
                            onChangeText={setQuery}
                            placeholder="Search commands, paths, machines"
                            placeholderTextColor={palette.textMuted}
                            autoCapitalize="none"
                            autoCorrect={false}
                            style={styles.searchInput}
                        />
                        {query ? (
                            <IconButton icon="close-circle" label="Clear search" compact onPress={() => setQuery('')} />
                        ) : null}
                    </View>

                    <View style={styles.filters}>
                        <FilterChip
                            label="Favorites"
                            icon="star-outline"
                            selected={favoritesOnly}
                            onPress={() => setFavoritesOnly((value) => !value)}
                        />
                        {props.currentMachineId ? (
                            <FilterChip
                                label="This machine"
                                icon="desktop-outline"
                                selected={currentMachineOnly}
                                onPress={() => setCurrentMachineOnly((value) => !value)}
                            />
                        ) : null}
                        {!historyEnabled ? <Text style={styles.paused}>HISTORY PAUSED</Text> : null}
                    </View>

                    <FlatList
                        data={visibleEntries}
                        keyExtractor={(entry) => entry.id}
                        keyboardShouldPersistTaps="handled"
                        contentContainerStyle={visibleEntries.length === 0 ? styles.emptyContainer : styles.listContent}
                        renderItem={({ item }) => (
                            <HistoryRow
                                entry={item}
                                onFavorite={() => {
                                    setTerminalHistoryFavorite(item.id, !item.favorite);
                                    reload();
                                }}
                                onRun={() => {
                                    props.onClose();
                                    props.onRun(item.command);
                                }}
                            />
                        )}
                        ListEmptyComponent={(
                            <View style={styles.empty}>
                                <Ionicons name="time-outline" size={24} color={palette.textMuted} />
                                <Text style={styles.emptyTitle}>{query ? 'No matching commands' : 'No command history yet'}</Text>
                            </View>
                        )}
                    />
                </Pressable>
            </Pressable>
        </Modal>
    );
});

function HistoryRow(props: {
    entry: PersistedTerminalHistoryEntry;
    onFavorite: () => void;
    onRun: () => void;
}) {
    const success = props.entry.exitCode === 0;
    return (
        <View style={styles.row}>
            <Pressable
                onPress={props.onRun}
                accessibilityRole="button"
                accessibilityLabel={`Run ${props.entry.command}`}
                style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}
            >
                <View style={[styles.exitDot, { backgroundColor: success ? palette.success : palette.danger }]} />
                <View style={styles.rowContent}>
                    <Text style={styles.command} numberOfLines={2}>{props.entry.command}</Text>
                    <View style={styles.rowMeta}>
                        <Text style={styles.meta} numberOfLines={1}>{props.entry.cwd ?? props.entry.host ?? 'Terminal'}</Text>
                        <Text style={styles.meta}>{formatDuration(props.entry.durationMs)} · {formatWhen(props.entry.endedAt)}</Text>
                    </View>
                </View>
                <Ionicons name="play" size={14} color={palette.accent} />
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
    return (
        <Pressable onPress={props.onPress} style={[styles.chip, props.selected && styles.chipSelected]}>
            <Ionicons name={props.icon} size={13} color={props.selected ? palette.text : palette.textMuted} />
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
                color={props.danger ? palette.danger : props.active ? palette.accent : palette.textMuted}
            />
        </Pressable>
    );
}

const styles = {
    backdrop: { flex: 1, justifyContent: 'flex-end' as const, backgroundColor: 'rgba(0,0,0,0.62)' },
    sheet: { height: '78%' as const, backgroundColor: palette.chrome, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderBottomWidth: 0, borderColor: palette.border },
    handle: { width: 36, height: 4, marginTop: 9, marginBottom: 5, borderRadius: 2, alignSelf: 'center' as const, backgroundColor: palette.border },
    header: { minHeight: 62, paddingHorizontal: 14, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
    title: { color: palette.text, fontSize: 16, fontWeight: '700' as const },
    subtitle: { color: palette.textMuted, fontSize: 10, marginTop: 3 },
    headerActions: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 2 },
    iconButton: { width: 38, height: 38, borderRadius: 9, alignItems: 'center' as const, justifyContent: 'center' as const },
    iconCompact: { width: 30, height: 30, borderRadius: 8, alignItems: 'center' as const, justifyContent: 'center' as const },
    pressed: { backgroundColor: palette.controlPressed },
    searchBar: { height: 44, marginHorizontal: 14, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingHorizontal: 11, borderRadius: 11, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.chromeRaised },
    searchInput: { flex: 1, height: 42, paddingVertical: 0, color: palette.text, fontSize: 13, fontFamily: 'monospace' },
    filters: { minHeight: 48, paddingHorizontal: 14, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
    chip: { height: 30, paddingHorizontal: 10, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5, borderRadius: 8, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.control },
    chipSelected: { borderColor: palette.accent, backgroundColor: 'rgba(184,107,255,0.16)' },
    chipText: { color: palette.textMuted, fontSize: 10, fontWeight: '600' as const },
    chipTextSelected: { color: palette.text },
    paused: { marginLeft: 'auto' as const, color: palette.warning, fontSize: 9, fontWeight: '800' as const, letterSpacing: 0.5 },
    listContent: { paddingHorizontal: 10, paddingBottom: 18 },
    emptyContainer: { flexGrow: 1, justifyContent: 'center' as const },
    empty: { alignItems: 'center' as const, gap: 8 },
    emptyTitle: { color: palette.textMuted, fontSize: 12 },
    row: { minHeight: 68, marginBottom: 5, flexDirection: 'row' as const, alignItems: 'center' as const, borderRadius: 11, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.chromeRaised, overflow: 'hidden' as const },
    rowMain: { flex: 1, minWidth: 0, minHeight: 66, paddingHorizontal: 10, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 9 },
    exitDot: { width: 7, height: 7, borderRadius: 4 },
    rowContent: { flex: 1, minWidth: 0 },
    command: { color: palette.text, fontSize: 12, lineHeight: 17, fontWeight: '600' as const, fontFamily: 'monospace' },
    rowMeta: { marginTop: 5, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: 10 },
    meta: { flexShrink: 1, color: palette.textMuted, fontSize: 9, fontFamily: 'monospace' },
};
