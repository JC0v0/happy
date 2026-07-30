import * as React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/ui/text';
import { t } from '@/text';
import type { DeviceHomeProjection, DeviceListEntry } from '@/utils/machineUtils';
import { getMachineDisplayName } from '@/utils/machineUtils';

interface DeviceListProps {
    projection: DeviceHomeProjection;
    selectedMachineId?: string | null;
    onSelectMachine: (machineId: string) => void;
    onToggleOffline: () => void;
}

export const DeviceList = React.memo(function DeviceList({
    projection,
    selectedMachineId,
    onSelectMachine,
    onToggleOffline,
}: DeviceListProps) {
    const { theme } = useUnistyles();

    if (projection.state === 'loading') {
        return (
            <View style={styles.centerState} accessibilityRole="progressbar">
                <ActivityIndicator color={theme.semantic.textSecondary} />
                <Text variant="muted">{t('status.connecting')}</Text>
            </View>
        );
    }

    if (projection.state === 'empty') {
        return (
            <View style={styles.centerState}>
                <Ionicons name="desktop-outline" size={28} color={theme.semantic.textMuted} />
                <Text variant="title">{t('terminals.machines')}</Text>
                <Text variant="muted" style={styles.centerCopy}>{t('terminals.noMachines')}</Text>
            </View>
        );
    }

    return (
        <View style={styles.list}>
            {projection.transportStatus !== 'connected' && (
                <View style={styles.transportBanner} accessibilityRole="alert">
                    <Text variant="label">{t(`status.${projection.transportStatus}`)}</Text>
                    <Text variant="small" style={styles.transportCopy}>
                        {t('deviceFirst.presenceUnverifiedDescription')}
                    </Text>
                </View>
            )}

            <View accessibilityRole="list">
                <Text variant="label" style={styles.sectionLabel}>{t('status.online')}</Text>
                {projection.online.map((entry) => (
                    <DeviceRow key={entry.machine.id} entry={entry} selected={selectedMachineId === entry.machine.id} onPress={onSelectMachine} />
                ))}
            </View>

            {projection.offline.length > 0 && (
                <View>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ expanded: projection.offlineExpanded }}
                        accessibilityLabel={projection.offlineExpanded
                            ? t('settings.hideOfflineMachines')
                            : t('settings.showOfflineMachines', { count: projection.offline.length })}
                        onPress={onToggleOffline}
                        style={({ pressed }) => [styles.disclosure, pressed && styles.pressed]}
                    >
                        <View style={styles.disclosureLabel}>
                            <Text variant="label">{t('status.offline')}</Text>
                            <Text variant="mono">{projection.offline.length}</Text>
                        </View>
                        <Ionicons
                            name={projection.offlineExpanded ? 'chevron-up' : 'chevron-down'}
                            size={16}
                            color={theme.semantic.textSecondary}
                        />
                    </Pressable>
                    {projection.offlineExpanded && (
                        <View accessibilityRole="list">
                            {projection.offline.map((entry) => (
                                <DeviceRow key={entry.machine.id} entry={entry} selected={selectedMachineId === entry.machine.id} onPress={onSelectMachine} />
                            ))}
                        </View>
                    )}
                </View>
            )}
        </View>
    );
});

const DeviceRow = React.memo(function DeviceRow({
    entry,
    onPress,
    selected,
}: {
    entry: DeviceListEntry;
    onPress: (machineId: string) => void;
    selected: boolean;
}) {
    const { theme } = useUnistyles();
    const name = getMachineDisplayName(entry.machine);
    const status = entry.presence === 'unverified'
        ? t('deviceFirst.presenceUnverified')
        : t(`status.${entry.presence}`);
    const statusColor = entry.presence === 'online'
        ? theme.semantic.status.success
        : entry.presence === 'offline'
            ? theme.semantic.status.offline
            : theme.semantic.status.warning;

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${name}, ${status}`}
            accessibilityState={{ selected }}
            onPress={() => onPress(entry.machine.id)}
            style={({ pressed }) => [styles.row, selected && styles.selected, pressed && styles.pressed]}
        >
            <View style={[styles.statusRail, { backgroundColor: statusColor }]} />
            <View style={styles.rowCopy}>
                <Text variant="title" numberOfLines={1}>{name}</Text>
                <View style={styles.metadataLine}>
                    <Text variant="label" style={{ color: statusColor }}>{status}</Text>
                    {entry.machine.metadata?.platform && (
                        <Text variant="mono" style={styles.platform}>{entry.machine.metadata.platform}</Text>
                    )}
                </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.semantic.textMuted} />
        </Pressable>
    );
});

const styles = StyleSheet.create((theme) => ({
    list: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderColor: theme.semantic.border,
    },
    centerState: {
        minHeight: 280,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        padding: 24,
    },
    centerCopy: {
        maxWidth: 360,
        textAlign: 'center',
    },
    transportBanner: {
        gap: 4,
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: theme.semantic.surfaceMuted,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderColor: theme.semantic.border,
    },
    transportCopy: {
        color: theme.semantic.textSecondary,
    },
    sectionLabel: {
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 8,
    },
    row: {
        minHeight: 68,
        flexDirection: 'row',
        alignItems: 'stretch',
        backgroundColor: theme.semantic.surface,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderColor: theme.semantic.border,
    },
    pressed: {
        backgroundColor: theme.semantic.surfaceSelected,
    },
    selected: {
        backgroundColor: theme.semantic.surfaceSelected,
    },
    statusRail: {
        width: 3,
    },
    rowCopy: {
        flex: 1,
        justifyContent: 'center',
        gap: 4,
        paddingHorizontal: 13,
        paddingVertical: 10,
    },
    metadataLine: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    platform: {
        color: theme.semantic.textMuted,
    },
    disclosure: {
        minHeight: 48,
        paddingHorizontal: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: theme.semantic.canvas,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderColor: theme.semantic.border,
    },
    disclosureLabel: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
}));
