import * as React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Text } from '@/components/ui/text';

export type TerminalConnectionState = 'connected' | 'connecting' | 'disconnected';

interface TerminalToolbarProps {
    connectionState: TerminalConnectionState;
    /** True briefly after a successful copy, shows the "copied" confirmation. */
    copied: boolean;
    onReconnect: () => void;
    onCopyAll: () => void;
    onClear: () => void;
    onFontSizeChange: (delta: number) => void;
}

const STATUS_META: Record<TerminalConnectionState, { color: string; badgeVariant: 'default' | 'secondary' | 'destructive' }> = {
    connected: { color: '#34C759', badgeVariant: 'secondary' },
    connecting: { color: '#FF9500', badgeVariant: 'secondary' },
    disconnected: { color: '#FF3B30', badgeVariant: 'destructive' },
};

/**
 * Shared toolbar for terminal sessions (web + native WebView renderers),
 * built with the shadcn-style ui components (unistyles implementation).
 */
export const TerminalToolbar = React.memo(function TerminalToolbar(props: TerminalToolbarProps) {
    const { theme } = useUnistyles();
    const meta = STATUS_META[props.connectionState];

    const statusText =
        props.connectionState === 'connected' ? t('terminal.connected')
            : props.connectionState === 'connecting' ? t('terminal.connecting')
                : t('terminal.disconnected');

    return (
        <View style={styles.container}>
            <View style={styles.statusGroup}>
                {props.connectionState === 'connecting' ? (
                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                ) : (
                    <View style={[styles.statusDot, { backgroundColor: meta.color }]} />
                )}
                <Badge variant={meta.badgeVariant}>
                    <Text variant="xs">{statusText}</Text>
                </Badge>
            </View>

            <View style={styles.actionsGroup}>
                {props.copied && (
                    <Text variant="xs" style={{ marginRight: 4 }}>{t('terminal.copied')}</Text>
                )}
                <ToolbarIconButton
                    icon="refresh-outline"
                    label={t('terminal.reconnect')}
                    disabled={props.connectionState === 'connecting'}
                    onPress={props.onReconnect}
                />
                <ToolbarIconButton icon="copy-outline" label={t('terminal.copyAll')} onPress={props.onCopyAll} />
                <ToolbarIconButton icon="trash-outline" label={t('terminal.clear')} onPress={props.onClear} />
                <ToolbarIconButton icon="remove-outline" label={t('terminal.fontSizeDecrease')} onPress={() => props.onFontSizeChange(-1)} />
                <ToolbarIconButton icon="add-outline" label={t('terminal.fontSizeIncrease')} onPress={() => props.onFontSizeChange(1)} />
            </View>
        </View>
    );
});

function ToolbarIconButton(props: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    onPress: () => void;
    disabled?: boolean;
}) {
    const { theme } = useUnistyles();
    return (
        <Button
            variant="ghost"
            size="icon"
            onPress={props.onPress}
            disabled={props.disabled}
            accessibilityLabel={props.label}
            accessibilityRole="button"
        >
            <Ionicons
                name={props.icon}
                size={18}
                color={props.disabled ? theme.colors.textSecondary : theme.colors.text}
            />
        </Button>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    statusGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    statusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    actionsGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
    },
}));
