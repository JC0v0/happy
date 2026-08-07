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
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { localizedText, t } from '@/text';
import { loadTerminalHistoryCommands } from './terminalHistory';
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
import { wrapPasteForTerminal } from './terminalInput';
import { getTerminalModes } from './terminalModes';
import { TERMINAL_VISUAL_THEME as terminalPalette } from './terminalVisualTheme';
import { TerminalShortcutSheet } from './terminal-shortcut-sheet';
import { FontFamilies } from '@/constants/Typography';

export type TerminalConnectionState = 'connected' | 'connecting' | 'disconnected';

interface TerminalToolbarProps {
    connectionState: TerminalConnectionState;
    copied: boolean;
    onReconnect: () => void;
    onCopyAll: () => void;
    onClear: () => void;
    onFontSizeChange: (delta: number) => void;
    skiaEnabled?: boolean;
    onToggleSkia?: () => void;
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

const stylesheet = StyleSheet.create((theme) => ({
    toolbar: {
        minHeight: 52,
        paddingHorizontal: 10,
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        justifyContent: 'space-between' as const,
        backgroundColor: theme.semantic.surface,
        borderBottomWidth: 1,
        borderBottomColor: theme.semantic.border,
        zIndex: 20,
    },
    statusGroup: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 7 },
    statusDot: { width: 7, height: 7, borderRadius: 999 },
    statusText: {
        color: theme.semantic.textPrimary,
        fontSize: 12,
        fontFamily: FontFamilies.default.semiBold,
    },
    securePill: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 3,
        paddingHorizontal: 6,
        paddingVertical: 3,
        borderRadius: 4,
        backgroundColor: theme.semantic.surfaceMuted,
        borderWidth: 1,
        borderColor: theme.semantic.border,
    },
    secureText: {
        color: theme.semantic.textMuted,
        fontSize: 9,
        fontFamily: FontFamilies.mono.semiBold,
        letterSpacing: 0.5,
    },
    toolbarActions: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
    copiedText: {
        color: theme.semantic.status.success,
        fontSize: 11,
        fontFamily: FontFamilies.default.semiBold,
        marginRight: 2,
    },
    iconButton: {
        width: 44,
        height: 44,
        borderRadius: 4,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
    },
    compactIconButton: {
        width: 42,
        height: 38,
        borderRadius: 4,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        backgroundColor: theme.semantic.surfaceMuted,
        borderWidth: 1,
        borderColor: theme.semantic.border,
    },
    controlPressed: { backgroundColor: theme.semantic.surfaceSelected },
    controlDisabled: { opacity: 0.45 },
    modalBackdrop: {
        flex: 1,
        position: 'relative' as const,
        zIndex: 40,
        justifyContent: 'flex-end' as const,
        backgroundColor: theme.dark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.35)',
    },
    actionSheet: {
        position: 'relative' as const,
        zIndex: 50,
        elevation: 0,
        paddingHorizontal: 14,
        paddingTop: 10,
        backgroundColor: theme.semantic.surface,
        borderTopLeftRadius: 0,
        borderTopRightRadius: 0,
        borderWidth: 1,
        borderBottomWidth: 0,
        borderColor: theme.semantic.border,
    },
    desktopMenu: {
        position: 'absolute' as const,
        top: 48,
        right: 8,
        width: 270,
        paddingHorizontal: 10,
        paddingVertical: 10,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: theme.semantic.border,
        backgroundColor: theme.semantic.surface,
        zIndex: 50,
        elevation: 0,
    },
    sheetHandle: {
        width: 34,
        height: 4,
        borderRadius: 2,
        backgroundColor: theme.semantic.border,
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
    sheetTitle: {
        color: theme.semantic.textPrimary,
        fontSize: 15,
        fontFamily: FontFamilies.default.semiBold,
        marginLeft: 4,
    },
    actionRow: {
        minHeight: 48,
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 12,
        paddingHorizontal: 12,
        borderRadius: 4,
    },
    actionLabel: {
        color: theme.semantic.textPrimary,
        fontSize: 14,
        fontFamily: FontFamilies.default.regular,
    },
    actionLabelDestructive: {
        color: theme.semantic.status.error,
    },
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
        backgroundColor: theme.semantic.surface,
        borderTopWidth: 1,
        borderTopColor: theme.semantic.border,
        paddingTop: 7,
    },
    shortcutRow: { gap: 8, paddingHorizontal: 10, paddingBottom: 7 },
    shortcutButton: {
        minWidth: 40,
        height: 38,
        paddingHorizontal: 9,
        borderRadius: 4,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        backgroundColor: theme.semantic.surfaceMuted,
        borderWidth: 1,
        borderColor: theme.semantic.border,
    },
    shortcutButtonActive: {
        borderColor: theme.semantic.borderStrong,
        backgroundColor: theme.semantic.surfaceSelected,
    },
    modeButton: {
        height: 38,
        paddingHorizontal: 10,
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        gap: 5,
        borderRadius: 4,
        backgroundColor: theme.semantic.surfaceMuted,
        borderWidth: 1,
        borderColor: theme.semantic.border,
    },
    modeButtonActive: {
        borderColor: theme.semantic.borderStrong,
        backgroundColor: theme.semantic.surfaceSelected,
    },
    modeText: {
        color: theme.semantic.textMuted,
        fontSize: 9,
        fontFamily: FontFamilies.mono.semiBold,
        letterSpacing: 0.5,
    },
    modeTextActive: { color: theme.semantic.textPrimary },
    directoryContext: {
        maxWidth: 150,
        height: 38,
        paddingHorizontal: 10,
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 6,
        borderRadius: 4,
        backgroundColor: theme.semantic.surfaceMuted,
        borderWidth: 1,
        borderColor: theme.semantic.border,
    },
    directoryText: {
        flexShrink: 1,
        color: theme.semantic.textSecondary,
        fontSize: 10,
        fontFamily: FontFamilies.mono.regular,
    },
    shortcutText: {
        color: theme.semantic.textMuted,
        fontSize: 10,
        fontFamily: FontFamilies.mono.semiBold,
        letterSpacing: 0.35,
    },
    shortcutTextActive: { color: theme.semantic.textPrimary },
    commandBar: {
        minHeight: 46,
        marginHorizontal: 10,
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 8,
        paddingLeft: 12,
        paddingRight: 5,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: theme.semantic.border,
        backgroundColor: theme.semantic.surfaceMuted,
    },
    prompt: {
        color: theme.semantic.textPrimary,
        fontSize: 16,
        fontFamily: FontFamilies.mono.semiBold,
    },
    commandInput: {
        flex: 1,
        minWidth: 0,
        minHeight: 44,
        maxHeight: 120,
        color: theme.semantic.textPrimary,
        fontSize: 13,
        fontFamily: FontFamilies.mono.regular,
        paddingVertical: 8,
        textAlignVertical: 'top',
    },
    sendButton: {
        width: 38,
        height: 38,
        borderRadius: 4,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        backgroundColor: theme.semantic.control,
        borderWidth: 1,
        borderColor: theme.semantic.control,
    },
    sendButtonDisabled: { backgroundColor: theme.semantic.surfaceMuted, borderColor: theme.semantic.border, opacity: 0.62 },
    sendButtonPressed: { transform: [{ scale: 0.96 }] },
}));

export const TerminalToolbar = React.memo(function TerminalToolbar(props: TerminalToolbarProps) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const [menuVisible, setMenuVisible] = React.useState(false);
    const safeArea = useSafeAreaInsets();
    const statusText = props.connectionState === 'connected'
        ? t('terminal.connected')
        : props.connectionState === 'connecting'
            ? t('terminal.connecting')
            : t('terminal.disconnected');

    const statusColor = props.connectionState === 'connected'
        ? theme.colors.status.connected
        : props.connectionState === 'connecting'
            ? theme.colors.status.connecting
            : theme.colors.status.disconnected;

    const actionsPanel = (
        <>
            {Platform.OS === 'web' ? null : <View style={styles.sheetHandle} />}
            <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>{t('terminal.title')}</Text>
                <ChromeIconButton
                    icon="close"
                    label={localizedText('Close terminal actions', '关闭终端操作', '關閉終端機操作')}
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
            {props.onToggleSkia ? (
                <ActionRow
                    icon={props.skiaEnabled ? 'flash' : 'flash-outline'}
                    label={props.skiaEnabled
                        ? localizedText('Skia Renderer (On)', 'Skia 渲染器（开）', 'Skia 渲染器（開）')
                        : localizedText('Skia Renderer (Off)', 'Skia 渲染器（关）', 'Skia 渲染器（關）')}
                    onPress={() => {
                        setMenuVisible(false);
                        props.onToggleSkia!();
                    }}
                />
            ) : null}
            <View style={styles.fontRow}>
                <View style={styles.fontLabel}>
                    <Ionicons name="text-outline" size={18} color={theme.semantic.textMuted} />
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
                    <ActivityIndicator size={12} color={statusColor} />
                ) : (
                    <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                )}
                <Text style={styles.statusText}>{statusText}</Text>
                <View style={styles.securePill}>
                    <Ionicons name="lock-closed" size={10} color={theme.semantic.textMuted} />
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
                    label={localizedText('More terminal actions', '更多终端操作', '更多終端機操作')}
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
    const { theme } = useUnistyles();
    const styles = stylesheet;
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

    const historyRef = React.useRef<string[]>([]);
    const historyIndexRef = React.useRef<number>(-1);
    const historyDraftRef = React.useRef<string>('');
    React.useEffect(() => {
        historyRef.current = loadTerminalHistoryCommands();
        historyIndexRef.current = -1;
    }, []);
    const navigateHistory = React.useCallback((direction: 'up' | 'down') => {
        const history = historyRef.current;
        if (history.length === 0) return;
        if (direction === 'up') {
            if (historyIndexRef.current === -1) {
                historyDraftRef.current = command;
                historyIndexRef.current = 0;
            } else if (historyIndexRef.current < history.length - 1) {
                historyIndexRef.current += 1;
            } else {
                return;
            }
        } else {
            if (historyIndexRef.current === -1) return;
            if (historyIndexRef.current > 0) {
                historyIndexRef.current -= 1;
            } else {
                historyIndexRef.current = -1;
                setCommand(historyDraftRef.current);
                return;
            }
        }
        setCommand(history[historyIndexRef.current] ?? '');
    }, [command]);

    const pasteToTerminal = React.useCallback(() => {
        Clipboard.getStringAsync()
            .then((value) => {
                if (value.length > 0) {
                    props.onSendInput(wrapPasteForTerminal(value, getTerminalModes().bracketedPaste));
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
                    accessibilityLabel={props.ctrlActive
                        ? localizedText('Disable Ctrl modifier', '关闭 Ctrl 修饰键', '關閉 Ctrl 修飾鍵')
                        : localizedText('Enable Ctrl modifier', '启用 Ctrl 修饰键', '啟用 Ctrl 修飾鍵')}
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
                    accessibilityLabel={localizedText('More keys', '更多按键', '更多按鍵')}
                    onPress={() => {
                        Keyboard.dismiss();
                        setShortcutSheetVisible(true);
                    }}
                />
                <ShortcutButton icon="clipboard-outline" onPress={pasteToTerminal} />
                <ShortcutButton icon="chevron-down" onPress={() => Keyboard.dismiss()} />
            </ScrollView>

            <View style={styles.commandBar}>
                <Text style={styles.prompt}>&gt;</Text>
                <TextInput
                    value={command}
                    onChangeText={updateCommand}
                    onSubmitEditing={submitCommand}
                    onKeyPress={(e) => {
                        if (e.nativeEvent.key === 'ArrowUp') {
                            navigateHistory('up');
                        } else if (e.nativeEvent.key === 'ArrowDown') {
                            navigateHistory('down');
                        }
                    }}
                    placeholder={t('commandPalette.placeholder')}
                    placeholderTextColor={theme.semantic.textMuted}
                    style={styles.commandInput}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="send"
                    multiline
                    selectionColor={theme.semantic.focus}
                    accessibilityLabel={t('commandPalette.placeholder')}
                />
                <Pressable
                    onPress={submitCommand}
                    disabled={command.trim().length === 0}
                    hitSlop={3}
                    accessibilityRole="button"
                    accessibilityLabel={localizedText('Send command', '发送命令', '傳送命令')}
                    style={({ pressed }) => [
                        styles.sendButton,
                        command.trim().length === 0 && styles.sendButtonDisabled,
                        pressed && command.trim().length > 0 && styles.sendButtonPressed,
                    ]}
                >
                    <Ionicons name="arrow-up" size={18} color={theme.semantic.textInverse} />
                </Pressable>
            </View>
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
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const isBlocks = props.mode === 'blocks';
    const iconColor = isBlocks ? theme.semantic.textPrimary : theme.semantic.textMuted;
    return (
        <Pressable
            onPress={props.onPress}
            disabled={props.disabled}
            accessibilityRole="button"
            accessibilityLabel={isBlocks
                ? localizedText('Switch to raw terminal', '切换到原始终端', '切換到原始終端機')
                : localizedText('Switch to command blocks', '切换到命令块', '切換到命令區塊')}
            style={({ pressed }) => [
                styles.modeButton,
                isBlocks && styles.modeButtonActive,
                pressed && styles.controlPressed,
                props.disabled && styles.controlDisabled,
            ]}
        >
            <Ionicons name={isBlocks ? 'list-outline' : 'terminal-outline'} size={14} color={iconColor} />
            <Text style={[styles.modeText, isBlocks && styles.modeTextActive]}>{isBlocks ? 'BLOCKS' : 'RAW'}</Text>
        </Pressable>
    );
}

function DirectoryContext(props: { cwd: string }) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const leaf = props.cwd.split(/[\\/]/u).filter(Boolean).pop() ?? props.cwd;
    return (
        <View style={styles.directoryContext} accessibilityLabel={`${localizedText('Current directory', '当前目录', '目前目錄')} ${props.cwd}`}>
            <Ionicons name="folder-outline" size={14} color={theme.semantic.textMuted} />
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
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const color = props.disabled ? theme.semantic.textMuted : theme.semantic.textPrimary;
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
                color={color}
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
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const accessibilityLabel = props.accessibilityLabel ?? props.label ?? props.icon ?? localizedText('Terminal shortcut', '终端快捷键', '終端機快速鍵');
    const iconColor = props.active ? theme.semantic.textPrimary : theme.semantic.textMuted;
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
                <Ionicons name={props.icon} size={15} color={iconColor} />
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
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const color = props.destructive ? theme.semantic.status.error : theme.semantic.textPrimary;
    return (
        <Pressable
            onPress={props.onPress}
            disabled={props.disabled}
            accessibilityRole="button"
            style={({ pressed }) => [styles.actionRow, pressed && styles.controlPressed, props.disabled && styles.controlDisabled]}
        >
            <Ionicons name={props.icon} size={19} color={color} />
            <Text style={[styles.actionLabel, props.destructive && styles.actionLabelDestructive]}>{props.label}</Text>
        </Pressable>
    );
}
