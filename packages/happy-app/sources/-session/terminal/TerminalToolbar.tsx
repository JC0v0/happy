import * as React from 'react';
import {
    ActivityIndicator,
    Keyboard,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    Text,
    TextInput,
    View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '@/text';
import {
    loadTerminalCommandDraft,
    saveTerminalCommandDraft,
    type TerminalViewMode,
} from '@/sync/persistence';
import {
    terminalCommandText,
    terminalShortcutData,
    type TerminalShortcut,
} from './terminalInput';
import { TERMINAL_VISUAL_THEME as palette } from './terminalVisualTheme';
import { TerminalShortcutSheet } from './terminal-shortcut-sheet';

export type TerminalConnectionState = 'connected' | 'connecting' | 'disconnected';

interface TerminalToolbarProps {
    connectionState: TerminalConnectionState;
    copied: boolean;
    onReconnect: () => void;
    onCopyAll: () => void;
    onClear: () => void;
    onFontSizeChange: (delta: number) => void;
}

interface TerminalCommandDockProps {
    sessionId: string;
    viewMode: TerminalViewMode;
    blocksEnabled: boolean;
    ctrlActive: boolean;
    cwd?: string;
    onSendInput: (data: string) => void;
    onExecuteCommand: (command: string) => void;
    onToggleCtrl: () => void;
    onToggleViewMode: () => void;
    onOpenHistory: () => void;
}

const STATUS_COLORS: Record<TerminalConnectionState, string> = {
    connected: palette.success,
    connecting: palette.warning,
    disconnected: palette.danger,
};

const SHORTCUTS: Array<{
    id: TerminalShortcut;
    label?: string;
    icon?: keyof typeof Ionicons.glyphMap;
}> = [
    { id: 'escape', label: 'ESC' },
    { id: 'tab', label: 'TAB' },
    { id: 'interrupt', label: 'CTRL C' },
    { id: 'up', icon: 'arrow-up' },
    { id: 'down', icon: 'arrow-down' },
    { id: 'left', icon: 'arrow-back' },
    { id: 'right', icon: 'arrow-forward' },
];

export const TerminalToolbar = React.memo(function TerminalToolbar(props: TerminalToolbarProps) {
    const [menuVisible, setMenuVisible] = React.useState(false);
    const safeArea = useSafeAreaInsets();
    const statusText = props.connectionState === 'connected'
        ? t('terminal.connected')
        : props.connectionState === 'connecting'
            ? t('terminal.connecting')
            : t('terminal.disconnected');

    const actionsPanel = (
        <>
            {Platform.OS === 'web' ? null : <View style={styles.sheetHandle} />}
            <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>{t('terminal.title')}</Text>
                <ChromeIconButton
                    icon="close"
                    label="Close terminal actions"
                    onPress={() => setMenuVisible(false)}
                    compact
                />
            </View>
            <ActionRow
                icon="refresh-outline"
                label={t('terminal.reconnect')}
                disabled={props.connectionState === 'connecting'}
                onPress={() => {
                    setMenuVisible(false);
                    props.onReconnect();
                }}
            />
            <ActionRow
                icon="copy-outline"
                label={t('terminal.copyAll')}
                onPress={() => {
                    setMenuVisible(false);
                    props.onCopyAll();
                }}
            />
            <ActionRow
                icon="trash-outline"
                label={t('terminal.clear')}
                destructive
                onPress={() => {
                    setMenuVisible(false);
                    props.onClear();
                }}
            />
            <View style={styles.fontRow}>
                <View style={styles.fontLabel}>
                    <Ionicons name="text-outline" size={18} color={palette.textMuted} />
                    <Text style={styles.actionLabel}>{t('terminal.fontSizeIncrease')}</Text>
                </View>
                <View style={styles.stepper}>
                    <ChromeIconButton
                        icon="remove"
                        label={t('terminal.fontSizeDecrease')}
                        onPress={() => props.onFontSizeChange(-1)}
                        compact
                    />
                    <ChromeIconButton
                        icon="add"
                        label={t('terminal.fontSizeIncrease')}
                        onPress={() => props.onFontSizeChange(1)}
                        compact
                    />
                </View>
            </View>
        </>
    );

    return (
        <View style={styles.toolbar}>
            <View style={styles.statusGroup}>
                {props.connectionState === 'connecting' ? (
                    <ActivityIndicator size={12} color={STATUS_COLORS.connecting} />
                ) : (
                    <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[props.connectionState] }]} />
                )}
                <Text style={styles.statusText}>{statusText}</Text>
                <View style={styles.securePill}>
                    <Ionicons name="lock-closed" size={10} color={palette.textMuted} />
                    <Text style={styles.secureText}>E2E</Text>
                </View>
            </View>

            <View style={styles.toolbarActions}>
                {props.copied ? <Text style={styles.copiedText}>{t('terminal.copied')}</Text> : null}
                <ChromeIconButton
                    icon="copy-outline"
                    label={t('terminal.copyAll')}
                    onPress={props.onCopyAll}
                />
                <ChromeIconButton
                    icon="ellipsis-horizontal"
                    label="More terminal actions"
                    onPress={() => setMenuVisible((visible) => !visible)}
                />
            </View>

            {Platform.OS === 'web' ? (
                menuVisible ? <View style={styles.desktopMenu}>{actionsPanel}</View> : null
            ) : (
                <Modal
                    transparent
                    animationType="fade"
                    visible={menuVisible}
                    onRequestClose={() => setMenuVisible(false)}
                >
                    <Pressable style={styles.modalBackdrop} onPress={() => setMenuVisible(false)}>
                        <Pressable
                            style={[styles.actionSheet, { paddingBottom: Math.max(safeArea.bottom, 16) }]}
                            onPress={(event) => event.stopPropagation()}
                        >
                            {actionsPanel}
                        </Pressable>
                    </Pressable>
                </Modal>
            )}
        </View>
    );
});

export const TerminalCommandDock = React.memo(function TerminalCommandDock(props: TerminalCommandDockProps) {
    const safeArea = useSafeAreaInsets();
    const [command, setCommand] = React.useState(() => loadTerminalCommandDraft(props.sessionId));
    const [shortcutSheetVisible, setShortcutSheetVisible] = React.useState(false);

    React.useEffect(() => {
        setCommand(loadTerminalCommandDraft(props.sessionId));
    }, [props.sessionId]);

    const updateCommand = React.useCallback((value: string) => {
        setCommand(value);
        saveTerminalCommandDraft(props.sessionId, value);
    }, [props.sessionId]);

    const submitCommand = React.useCallback(() => {
        const normalized = terminalCommandText(command);
        if (!normalized) {
            return;
        }
        props.onExecuteCommand(normalized);
        setCommand('');
        saveTerminalCommandDraft(props.sessionId, '');
    }, [command, props]);

    const pasteToTerminal = React.useCallback(() => {
        Clipboard.getStringAsync()
            .then((value) => {
                if (value.length > 0) {
                    props.onSendInput(value);
                }
            })
            .catch((error) => console.warn('[terminal] Paste failed:', error));
    }, [props]);

    return (
        <>
        <View style={[styles.dock, { paddingBottom: Math.max(safeArea.bottom, 8) }]}>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="always"
                contentContainerStyle={styles.shortcutRow}
            >
                <DockModeButton
                    mode={props.viewMode}
                    disabled={!props.blocksEnabled}
                    onPress={props.onToggleViewMode}
                />
                <ShortcutButton icon="time-outline" onPress={props.onOpenHistory} />
                {props.cwd ? <DirectoryContext cwd={props.cwd} /> : null}
                <ShortcutButton
                    label="CTRL"
                    active={props.ctrlActive}
                    accessibilityLabel={props.ctrlActive ? '取消 Ctrl 组合键' : '启用 Ctrl 组合键'}
                    onPress={props.onToggleCtrl}
                />
                {SHORTCUTS.map((shortcut) => (
                    <ShortcutButton
                        key={shortcut.id}
                        label={shortcut.label}
                        icon={shortcut.icon}
                        onPress={() => props.onSendInput(terminalShortcutData(shortcut.id))}
                    />
                ))}
                <ShortcutButton
                    icon="keypad-outline"
                    accessibilityLabel="更多按键"
                    onPress={() => {
                        Keyboard.dismiss();
                        setShortcutSheetVisible(true);
                    }}
                />
                <ShortcutButton icon="clipboard-outline" onPress={pasteToTerminal} />
                <ShortcutButton icon="chevron-down" onPress={() => Keyboard.dismiss()} />
            </ScrollView>

            {props.viewMode === 'blocks' ? <View style={styles.commandBar}>
                <Text style={styles.prompt}>›</Text>
                <TextInput
                    value={command}
                    onChangeText={updateCommand}
                    onSubmitEditing={submitCommand}
                    placeholder={t('commandPalette.placeholder')}
                    placeholderTextColor={palette.textMuted}
                    style={styles.commandInput}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="send"
                    selectionColor={palette.accent}
                    accessibilityLabel={t('commandPalette.placeholder')}
                />
                <Pressable
                    onPress={submitCommand}
                    disabled={command.trim().length === 0}
                    hitSlop={3}
                    accessibilityRole="button"
                    accessibilityLabel="Send command"
                    style={({ pressed }) => [
                        styles.sendButton,
                        command.trim().length === 0 && styles.sendButtonDisabled,
                        pressed && command.trim().length > 0 && styles.sendButtonPressed,
                    ]}
                >
                    <Ionicons name="arrow-up" size={18} color={palette.text} />
                </Pressable>
            </View> : null}
        </View>
        <TerminalShortcutSheet
            visible={shortcutSheetVisible}
            onClose={() => setShortcutSheetVisible(false)}
            onSendShortcut={(shortcut) => props.onSendInput(terminalShortcutData(shortcut))}
        />
        </>
    );
});

function DockModeButton(props: { mode: TerminalViewMode; disabled: boolean; onPress: () => void }) {
    const isBlocks = props.mode === 'blocks';
    return (
        <Pressable
            onPress={props.onPress}
            disabled={props.disabled}
            accessibilityRole="button"
            accessibilityLabel={isBlocks ? 'Switch to raw terminal' : 'Switch to command blocks'}
            style={({ pressed }) => [
                styles.modeButton,
                isBlocks && styles.modeButtonActive,
                pressed && styles.controlPressed,
                props.disabled && styles.controlDisabled,
            ]}
        >
            <Ionicons name={isBlocks ? 'list-outline' : 'terminal-outline'} size={14} color={isBlocks ? palette.accent : palette.textMuted} />
            <Text style={[styles.modeText, isBlocks && styles.modeTextActive]}>{isBlocks ? 'BLOCKS' : 'RAW'}</Text>
        </Pressable>
    );
}

function DirectoryContext(props: { cwd: string }) {
    const leaf = props.cwd.split(/[\\/]/u).filter(Boolean).pop() ?? props.cwd;
    return (
        <View style={styles.directoryContext} accessibilityLabel={`Current directory ${props.cwd}`}>
            <Ionicons name="folder-outline" size={14} color={palette.textMuted} />
            <Text style={styles.directoryText} numberOfLines={1}>{leaf}</Text>
        </View>
    );
}

function ChromeIconButton(props: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    onPress: () => void;
    disabled?: boolean;
    compact?: boolean;
}) {
    return (
        <Pressable
            onPress={props.onPress}
            disabled={props.disabled}
            accessibilityRole="button"
            accessibilityLabel={props.label}
            hitSlop={props.compact ? 3 : 0}
            style={({ pressed }) => [
                props.compact ? styles.compactIconButton : styles.iconButton,
                pressed && styles.controlPressed,
                props.disabled && styles.controlDisabled,
            ]}
        >
            <Ionicons
                name={props.icon}
                size={props.compact ? 18 : 19}
                color={props.disabled ? palette.textMuted : palette.text}
            />
        </Pressable>
    );
}

function ShortcutButton(props: {
    label?: string;
    icon?: keyof typeof Ionicons.glyphMap;
    accessibilityLabel?: string;
    active?: boolean;
    onPress: () => void;
}) {
    const accessibilityLabel = props.accessibilityLabel ?? props.label ?? props.icon ?? 'Terminal shortcut';
    return (
        <Pressable
            onPress={props.onPress}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            hitSlop={3}
            style={({ pressed }) => [
                styles.shortcutButton,
                props.active && styles.shortcutButtonActive,
                pressed && styles.controlPressed,
            ]}
        >
            {props.icon ? (
                <Ionicons name={props.icon} size={15} color={props.active ? palette.accent : palette.textMuted} />
            ) : (
                <Text style={[styles.shortcutText, props.active && styles.shortcutTextActive]}>{props.label}</Text>
            )}
        </Pressable>
    );
}

function ActionRow(props: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    onPress: () => void;
    destructive?: boolean;
    disabled?: boolean;
}) {
    const color = props.destructive ? palette.danger : palette.text;
    return (
        <Pressable
            onPress={props.onPress}
            disabled={props.disabled}
            accessibilityRole="button"
            style={({ pressed }) => [styles.actionRow, pressed && styles.controlPressed, props.disabled && styles.controlDisabled]}
        >
            <Ionicons name={props.icon} size={19} color={color} />
            <Text style={[styles.actionLabel, { color }]}>{props.label}</Text>
        </Pressable>
    );
}

const styles = {
    toolbar: {
        minHeight: 52,
        paddingHorizontal: 10,
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        justifyContent: 'space-between' as const,
        backgroundColor: palette.chrome,
        borderBottomWidth: 1,
        borderBottomColor: palette.border,
        zIndex: 20,
    },
    statusGroup: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 7 },
    statusDot: { width: 7, height: 7, borderRadius: 4 },
    statusText: { color: palette.text, fontSize: 12, fontWeight: '600' as const },
    securePill: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 3,
        paddingHorizontal: 6,
        paddingVertical: 3,
        borderRadius: 6,
        backgroundColor: palette.control,
    },
    secureText: { color: palette.textMuted, fontSize: 9, fontWeight: '700' as const, letterSpacing: 0.5 },
    toolbarActions: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
    copiedText: { color: palette.success, fontSize: 11, marginRight: 2 },
    iconButton: {
        width: 44,
        height: 44,
        borderRadius: 11,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
    },
    compactIconButton: {
        width: 42,
        height: 38,
        borderRadius: 8,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        backgroundColor: palette.control,
    },
    controlPressed: { backgroundColor: palette.controlPressed },
    controlDisabled: { opacity: 0.45 },
    modalBackdrop: {
        flex: 1,
        position: 'relative' as const,
        zIndex: 40,
        justifyContent: 'flex-end' as const,
        backgroundColor: 'rgba(0, 0, 0, 0.58)',
    },
    actionSheet: {
        position: 'relative' as const,
        zIndex: 50,
        elevation: 24,
        paddingHorizontal: 14,
        paddingTop: 10,
        backgroundColor: palette.chromeRaised,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        borderWidth: 1,
        borderBottomWidth: 0,
        borderColor: palette.border,
    },
    desktopMenu: {
        position: 'absolute' as const,
        top: 48,
        right: 8,
        width: 270,
        paddingHorizontal: 10,
        paddingVertical: 10,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: palette.border,
        backgroundColor: palette.chromeRaised,
        zIndex: 50,
        elevation: 24,
        shadowColor: '#000000',
        shadowOpacity: 0.42,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 10 },
    },
    sheetHandle: {
        width: 34,
        height: 4,
        borderRadius: 2,
        backgroundColor: palette.border,
        alignSelf: 'center' as const,
        marginBottom: 12,
    },
    sheetHeader: {
        minHeight: 44,
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        justifyContent: 'space-between' as const,
        marginBottom: 4,
    },
    sheetTitle: { color: palette.text, fontSize: 15, fontWeight: '700' as const, marginLeft: 4 },
    actionRow: {
        minHeight: 48,
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 12,
        paddingHorizontal: 12,
        borderRadius: 10,
    },
    actionLabel: { color: palette.text, fontSize: 14, fontWeight: '500' as const },
    fontRow: {
        minHeight: 52,
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        justifyContent: 'space-between' as const,
        paddingHorizontal: 12,
    },
    fontLabel: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, flex: 1 },
    stepper: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
    dock: {
        backgroundColor: palette.chrome,
        borderTopWidth: 1,
        borderTopColor: palette.border,
        paddingTop: 7,
    },
    shortcutRow: { gap: 8, paddingHorizontal: 10, paddingBottom: 7 },
    shortcutButton: {
        minWidth: 40,
        height: 38,
        paddingHorizontal: 9,
        borderRadius: 8,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        backgroundColor: palette.control,
        borderWidth: 1,
        borderColor: palette.border,
    },
    shortcutButtonActive: { borderColor: palette.accent, backgroundColor: 'rgba(184, 107, 255, 0.14)' },
    modeButton: {
        height: 38,
        paddingHorizontal: 10,
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        gap: 5,
        borderRadius: 8,
        backgroundColor: palette.control,
        borderWidth: 1,
        borderColor: palette.border,
    },
    modeButtonActive: { borderColor: palette.accent, backgroundColor: 'rgba(184, 107, 255, 0.10)' },
    modeText: { color: palette.textMuted, fontSize: 9, fontWeight: '800' as const, letterSpacing: 0.5 },
    modeTextActive: { color: palette.accent },
    directoryContext: {
        maxWidth: 150,
        height: 38,
        paddingHorizontal: 10,
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 6,
        borderRadius: 8,
        backgroundColor: palette.control,
        borderWidth: 1,
        borderColor: palette.border,
    },
    directoryText: { flexShrink: 1, color: palette.textMuted, fontSize: 10, fontFamily: 'monospace' },
    shortcutText: { color: palette.textMuted, fontSize: 10, fontWeight: '700' as const, letterSpacing: 0.35 },
    shortcutTextActive: { color: palette.accent },
    commandBar: {
        minHeight: 46,
        marginHorizontal: 10,
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 8,
        paddingLeft: 12,
        paddingRight: 5,
        borderRadius: 13,
        borderWidth: 1,
        borderColor: palette.border,
        backgroundColor: palette.chromeRaised,
    },
    prompt: { color: palette.accent, fontSize: 16, fontWeight: '700' as const, fontFamily: 'monospace' },
    commandInput: {
        flex: 1,
        minWidth: 0,
        height: 44,
        color: palette.text,
        fontSize: 13,
        fontFamily: 'monospace',
        paddingVertical: 0,
    },
    sendButton: {
        width: 38,
        height: 38,
        borderRadius: 10,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        backgroundColor: palette.accentStrong,
    },
    sendButtonDisabled: { backgroundColor: palette.control, opacity: 0.62 },
    sendButtonPressed: { transform: [{ scale: 0.96 }] },
};
