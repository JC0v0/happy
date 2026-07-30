import * as React from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { FontFamilies } from '@/constants/Typography';
import type { TerminalShortcut } from './terminalInput';

interface ShortcutItem {
    id: TerminalShortcut;
    label: string;
    detail: string;
}

interface ShortcutGroup {
    title: string;
    items: ShortcutItem[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
    {
        title: 'Navigation',
        items: [
            { id: 'home', label: 'HOME', detail: 'Line start' },
            { id: 'end', label: 'END', detail: 'Line end' },
            { id: 'page-up', label: 'PG UP', detail: 'Scroll up' },
            { id: 'page-down', label: 'PG DN', detail: 'Scroll down' },
            { id: 'alt-b', label: 'ALT B', detail: 'Prev word' },
            { id: 'alt-f', label: 'ALT F', detail: 'Next word' },
        ],
    },
    {
        title: 'Input & Edit',
        items: [
            { id: 'enter', label: 'ENTER', detail: 'Confirm' },
            { id: 'backtab', label: 'SHIFT TAB', detail: 'Reverse tab' },
            { id: 'backspace', label: '←', detail: 'Backspace' },
            { id: 'delete', label: 'DEL', detail: 'Delete' },
            { id: 'ctrl-a', label: 'CTRL A', detail: 'Line start' },
            { id: 'ctrl-e', label: 'CTRL E', detail: 'Line end' },
            { id: 'ctrl-u', label: 'CTRL U', detail: 'Kill to start' },
            { id: 'ctrl-k', label: 'CTRL K', detail: 'Kill to end' },
            { id: 'ctrl-w', label: 'CTRL W', detail: 'Kill prev word' },
        ],
    },
    {
        title: 'Terminal Control',
        items: [
            { id: 'ctrl-d', label: 'CTRL D', detail: 'EOF / exit' },
            { id: 'ctrl-l', label: 'CTRL L', detail: 'Clear screen' },
            { id: 'ctrl-r', label: 'CTRL R', detail: 'Search history' },
            { id: 'ctrl-z', label: 'CTRL Z', detail: 'Suspend' },
        ],
    },
    {
        title: 'Function Keys',
        items: [
            { id: 'f1', label: 'F1', detail: 'F1' },
            { id: 'f2', label: 'F2', detail: 'F2' },
            { id: 'f3', label: 'F3', detail: 'F3' },
            { id: 'f4', label: 'F4', detail: 'F4' },
            { id: 'f5', label: 'F5', detail: 'F5' },
            { id: 'f6', label: 'F6', detail: 'F6' },
            { id: 'f7', label: 'F7', detail: 'F7' },
            { id: 'f8', label: 'F8', detail: 'F8' },
            { id: 'f9', label: 'F9', detail: 'F9' },
            { id: 'f10', label: 'F10', detail: 'F10' },
            { id: 'f11', label: 'F11', detail: 'F11' },
            { id: 'f12', label: 'F12', detail: 'F12' },
        ],
    },
];

const stylesheet = StyleSheet.create((theme) => ({
    backdrop: {
        flex: 1,
        justifyContent: 'flex-end' as const,
        backgroundColor: theme.dark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.35)',
    },
    sheet: {
        width: '100%' as const,
        maxWidth: 620,
        maxHeight: '82%' as const,
        alignSelf: 'center' as const,
        paddingHorizontal: 14,
        paddingTop: 10,
        borderTopLeftRadius: 0,
        borderTopRightRadius: 0,
        borderWidth: 1,
        borderBottomWidth: 0,
        borderColor: theme.semantic.border,
        backgroundColor: theme.semantic.surface,
    },
    handle: {
        width: 34,
        height: 4,
        borderRadius: 2,
        alignSelf: 'center' as const,
        marginBottom: 10,
        backgroundColor: theme.semantic.border,
    },
    header: {
        minHeight: 52,
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        justifyContent: 'space-between' as const,
        gap: 12,
        paddingBottom: 10,
    },
    titleGroup: { flex: 1, minWidth: 0, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
    titleIcon: {
        width: 38,
        height: 38,
        borderRadius: 4,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        backgroundColor: theme.semantic.surfaceMuted,
        borderWidth: 1,
        borderColor: theme.semantic.border,
    },
    title: {
        color: theme.semantic.textPrimary,
        fontSize: 15,
        fontFamily: FontFamilies.default.semiBold,
    },
    subtitle: {
        color: theme.semantic.textSecondary,
        fontSize: 11,
        fontFamily: FontFamilies.default.regular,
        marginTop: 2,
    },
    closeButton: { width: 44, height: 44, borderRadius: 4, alignItems: 'center' as const, justifyContent: 'center' as const },
    content: { gap: 18, paddingTop: 4, paddingBottom: 6 },
    group: { gap: 8 },
    groupTitle: {
        color: theme.semantic.textMuted,
        fontSize: 10,
        fontFamily: FontFamilies.default.semiBold,
        letterSpacing: 0.7,
    },
    grid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
    key: {
        width: '31%' as const,
        minWidth: 94,
        minHeight: 58,
        flexGrow: 1,
        paddingHorizontal: 9,
        paddingVertical: 8,
        justifyContent: 'center' as const,
        gap: 3,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: theme.semantic.border,
        backgroundColor: theme.semantic.surfaceMuted,
    },
    keyPressed: {
        borderColor: theme.semantic.borderStrong,
        backgroundColor: theme.semantic.surfaceSelected,
    },
    keyLabel: {
        color: theme.semantic.textPrimary,
        fontSize: 11,
        fontFamily: FontFamilies.mono.semiBold,
    },
    keyDetail: {
        color: theme.semantic.textSecondary,
        fontSize: 10,
        fontFamily: FontFamilies.default.regular,
    },
    pressed: { backgroundColor: theme.semantic.surfaceSelected },
}));

export const TerminalShortcutSheet = React.memo(function TerminalShortcutSheet(props: {
    visible: boolean;
    onClose: () => void;
    onSendShortcut: (shortcut: TerminalShortcut) => void;
}) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const safeArea = useSafeAreaInsets();

    return (
        <Modal
            transparent
            animationType="slide"
            visible={props.visible}
            onRequestClose={props.onClose}
        >
            <Pressable style={styles.backdrop} onPress={props.onClose}>
                <Pressable
                    style={[styles.sheet, { paddingBottom: Math.max(safeArea.bottom, 16) }]}
                    onPress={(event) => event.stopPropagation()}
                >
                    <View style={styles.handle} />
                    <View style={styles.header}>
                        <View style={styles.titleGroup}>
                            <View style={styles.titleIcon}>
                                <Ionicons name="keypad-outline" size={18} color={theme.semantic.textPrimary} />
                            </View>
                            <View>
                                <Text style={styles.title}>Keys & Shortcuts</Text>
                                <Text style={styles.subtitle}>Send directly to the current terminal or TUI</Text>
                            </View>
                        </View>
                        <Pressable
                            onPress={props.onClose}
                            accessibilityRole="button"
                            accessibilityLabel="Close shortcut panel"
                            style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
                        >
                            <Ionicons name="close" size={20} color={theme.semantic.textPrimary} />
                        </Pressable>
                    </View>
                    <ScrollView
                        contentInsetAdjustmentBehavior="automatic"
                        showsVerticalScrollIndicator={false}
                        keyboardShouldPersistTaps="handled"
                        contentContainerStyle={styles.content}
                    >
                        {SHORTCUT_GROUPS.map((group) => (
                            <View key={group.title} style={styles.group}>
                                <Text style={styles.groupTitle}>{group.title}</Text>
                                <View style={styles.grid}>
                                    {group.items.map((shortcut) => (
                                        <Pressable
                                            key={shortcut.id}
                                            onPress={() => {
                                                props.onSendShortcut(shortcut.id);
                                                props.onClose();
                                            }}
                                            accessibilityRole="button"
                                            accessibilityLabel={`${shortcut.label}: ${shortcut.detail}`}
                                            style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}
                                        >
                                            <Text style={styles.keyLabel}>{shortcut.label}</Text>
                                            <Text style={styles.keyDetail} numberOfLines={1}>{shortcut.detail}</Text>
                                        </Pressable>
                                    ))}
                                </View>
                            </View>
                        ))}
                    </ScrollView>
                </Pressable>
            </Pressable>
        </Modal>
    );
});
