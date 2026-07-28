import * as React from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { TerminalShortcut } from './terminalInput';
import { TERMINAL_VISUAL_THEME as palette } from './terminalVisualTheme';

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
        title: '导航',
        items: [
            { id: 'home', label: 'HOME', detail: '行首' },
            { id: 'end', label: 'END', detail: '行尾' },
            { id: 'page-up', label: 'PG UP', detail: '上翻页' },
            { id: 'page-down', label: 'PG DN', detail: '下翻页' },
            { id: 'alt-b', label: 'ALT B', detail: '前一词' },
            { id: 'alt-f', label: 'ALT F', detail: '后一词' },
        ],
    },
    {
        title: '输入与编辑',
        items: [
            { id: 'enter', label: 'ENTER', detail: '确认' },
            { id: 'backtab', label: 'SHIFT TAB', detail: '反向切换' },
            { id: 'backspace', label: '⌫', detail: '退格' },
            { id: 'delete', label: 'DEL', detail: '删除' },
            { id: 'ctrl-a', label: 'CTRL A', detail: '移到行首' },
            { id: 'ctrl-e', label: 'CTRL E', detail: '移到行尾' },
            { id: 'ctrl-u', label: 'CTRL U', detail: '删至行首' },
            { id: 'ctrl-k', label: 'CTRL K', detail: '删至行尾' },
            { id: 'ctrl-w', label: 'CTRL W', detail: '删除前一词' },
        ],
    },
    {
        title: '终端控制',
        items: [
            { id: 'ctrl-d', label: 'CTRL D', detail: 'EOF / 退出' },
            { id: 'ctrl-l', label: 'CTRL L', detail: '清屏' },
            { id: 'ctrl-r', label: 'CTRL R', detail: '搜索历史' },
            { id: 'ctrl-z', label: 'CTRL Z', detail: '挂起进程' },
        ],
    },
    {
        title: '功能键',
        items: [
            { id: 'f1', label: 'F1', detail: '功能键' },
            { id: 'f2', label: 'F2', detail: '功能键' },
            { id: 'f3', label: 'F3', detail: '功能键' },
            { id: 'f4', label: 'F4', detail: '功能键' },
            { id: 'f5', label: 'F5', detail: '功能键' },
            { id: 'f6', label: 'F6', detail: '功能键' },
            { id: 'f7', label: 'F7', detail: '功能键' },
            { id: 'f8', label: 'F8', detail: '功能键' },
            { id: 'f9', label: 'F9', detail: '功能键' },
            { id: 'f10', label: 'F10', detail: '功能键' },
            { id: 'f11', label: 'F11', detail: '功能键' },
            { id: 'f12', label: 'F12', detail: '功能键' },
        ],
    },
];

export const TerminalShortcutSheet = React.memo(function TerminalShortcutSheet(props: {
    visible: boolean;
    onClose: () => void;
    onSendShortcut: (shortcut: TerminalShortcut) => void;
}) {
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
                                <Ionicons name="keypad-outline" size={18} color={palette.accent} />
                            </View>
                            <View>
                                <Text style={styles.title}>按键与快捷键</Text>
                                <Text style={styles.subtitle}>直接发送到当前终端或 TUI</Text>
                            </View>
                        </View>
                        <Pressable
                            onPress={props.onClose}
                            accessibilityRole="button"
                            accessibilityLabel="关闭按键面板"
                            style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
                        >
                            <Ionicons name="close" size={20} color={palette.text} />
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
                                            accessibilityLabel={`${shortcut.label}，${shortcut.detail}`}
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

const styles = {
    backdrop: {
        flex: 1,
        justifyContent: 'flex-end' as const,
        backgroundColor: 'rgba(0, 0, 0, 0.62)',
    },
    sheet: {
        width: '100%' as const,
        maxWidth: 620,
        maxHeight: '82%' as const,
        alignSelf: 'center' as const,
        paddingHorizontal: 14,
        paddingTop: 10,
        borderTopLeftRadius: 22,
        borderTopRightRadius: 22,
        borderWidth: 1,
        borderBottomWidth: 0,
        borderColor: palette.border,
        backgroundColor: palette.chromeRaised,
    },
    handle: {
        width: 34,
        height: 4,
        borderRadius: 2,
        alignSelf: 'center' as const,
        marginBottom: 10,
        backgroundColor: palette.border,
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
        borderRadius: 10,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        backgroundColor: 'rgba(184, 107, 255, 0.12)',
    },
    title: { color: palette.text, fontSize: 15, fontWeight: '700' as const },
    subtitle: { color: palette.textMuted, fontSize: 10, marginTop: 2 },
    closeButton: { width: 44, height: 44, borderRadius: 11, alignItems: 'center' as const, justifyContent: 'center' as const },
    content: { gap: 18, paddingTop: 4, paddingBottom: 6 },
    group: { gap: 8 },
    groupTitle: { color: palette.textMuted, fontSize: 10, fontWeight: '800' as const, letterSpacing: 0.7 },
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
        borderRadius: 10,
        borderWidth: 1,
        borderColor: palette.border,
        backgroundColor: palette.control,
    },
    keyPressed: { borderColor: palette.accent, backgroundColor: palette.controlPressed },
    keyLabel: { color: palette.text, fontSize: 11, fontWeight: '800' as const, fontFamily: 'monospace' },
    keyDetail: { color: palette.textMuted, fontSize: 9 },
    pressed: { backgroundColor: palette.controlPressed },
};
