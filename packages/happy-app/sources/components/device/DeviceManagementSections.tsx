import * as React from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { Typography } from '@/constants/Typography';
import type { Machine } from '@/sync/storageTypes';
import { t } from '@/text';

interface DeviceManagementSectionsProps {
    machine: Machine;
    machineId: string;
    daemonStatus: 'likely alive' | 'stopped' | 'unknown';
    isStoppingDaemon: boolean;
    isRenamingMachine: boolean;
    isDeletingMachine: boolean;
    onStopDaemon: () => void;
    onRenameMachine: () => void;
    onDeleteMachine: () => void;
}

export const DeviceManagementSections = React.memo(function DeviceManagementSections({
    machine,
    machineId,
    daemonStatus,
    isStoppingDaemon,
    isRenamingMachine,
    isDeletingMachine,
    onStopDaemon,
    onRenameMachine,
    onDeleteMachine,
}: DeviceManagementSectionsProps) {
    const { theme } = useUnistyles();
    const metadata = machine.metadata;
    const daemonColor = daemonStatus === 'likely alive'
        ? theme.semantic.status.success
        : theme.semantic.status.warning;
    const monoStyle = Typography.monoDeveloper();

    return (
        <>
            <ItemGroup title={t('deviceFirst.deviceManagement')}>
                <Item
                    title={t('deviceFirst.renameDevice')}
                    onPress={onRenameMachine}
                    disabled={isRenamingMachine}
                    loading={isRenamingMachine}
                />
            </ItemGroup>

            <ItemGroup title={t('machine.daemon')}>
                <Item
                    title={t('machine.status')}
                    detail={daemonStatus}
                    detailStyle={{ color: daemonColor, ...monoStyle }}
                    showChevron={false}
                />
                <Item
                    title={t('machine.stopDaemon')}
                    destructive={daemonStatus !== 'stopped'}
                    onPress={daemonStatus === 'stopped' ? undefined : onStopDaemon}
                    disabled={isStoppingDaemon || daemonStatus === 'stopped'}
                    rightElement={isStoppingDaemon ? (
                        <ActivityIndicator size="small" color={theme.semantic.textSecondary} />
                    ) : (
                        <Ionicons
                            name="stop-circle"
                            size={20}
                            color={daemonStatus === 'stopped'
                                ? theme.semantic.textMuted
                                : theme.semantic.status.warning}
                        />
                    )}
                />
                {machine.daemonState?.pid && (
                    <Item title={t('machine.lastKnownPid')} subtitle={String(machine.daemonState.pid)} subtitleStyle={monoStyle} />
                )}
                {machine.daemonState?.httpPort && (
                    <Item title={t('machine.lastKnownHttpPort')} subtitle={String(machine.daemonState.httpPort)} subtitleStyle={monoStyle} />
                )}
                {machine.daemonState?.startTime && (
                    <Item title={t('machine.startedAt')} subtitle={new Date(machine.daemonState.startTime).toLocaleString()} />
                )}
                {machine.daemonState?.startedWithCliVersion && (
                    <Item title={t('machine.cliVersion')} subtitle={machine.daemonState.startedWithCliVersion} subtitleStyle={monoStyle} />
                )}
                <Item title={t('machine.daemonStateVersion')} subtitle={String(machine.daemonStateVersion)} subtitleStyle={monoStyle} />
            </ItemGroup>

            {metadata?.cliAvailability && (
                <ItemGroup title={t('machine.cliAvailability')}>
                    {([
                        ['Claude', metadata.cliAvailability.claude],
                        ['Codex', metadata.cliAvailability.codex],
                        ['Gemini', metadata.cliAvailability.gemini],
                        ['OpenClaw', metadata.cliAvailability.openclaw],
                        ['Antigravity', metadata.cliAvailability.agy],
                    ] as const).map(([name, installed]) => installed === undefined ? null : (
                        <Item
                            key={name}
                            title={name}
                            showChevron={false}
                            rightElement={(
                                <Text style={{
                                    ...Typography.label(),
                                    color: installed
                                        ? theme.semantic.status.success
                                        : theme.semantic.textMuted,
                                }}>
                                    {installed ? t('machine.cliInstalled') : t('machine.cliNotFound')}
                                </Text>
                            )}
                        />
                    ))}
                    <Item
                        title={t('machine.lastDetected')}
                        subtitle={new Date(metadata.cliAvailability.detectedAt).toLocaleString()}
                        showChevron={false}
                    />
                </ItemGroup>
            )}

            <ItemGroup title={t('machine.machineGroup')}>
                <Item title={t('machine.host')} subtitle={metadata?.host || machineId} subtitleStyle={monoStyle} />
                <Item title={t('machine.machineId')} subtitle={machineId} subtitleStyle={monoStyle} copy />
                {metadata?.username && <Item title={t('machine.username')} subtitle={metadata.username} />}
                {metadata?.homeDir && (
                    <Item title={t('machine.homeDirectory')} subtitle={metadata.homeDir} subtitleStyle={monoStyle} copy />
                )}
                {metadata?.platform && <Item title={t('machine.platform')} subtitle={metadata.platform} />}
                {metadata?.arch && <Item title={t('machine.architecture')} subtitle={metadata.arch} />}
                <Item
                    title={t('machine.lastSeen')}
                    subtitle={machine.activeAt ? new Date(machine.activeAt).toLocaleString() : t('machine.never')}
                />
                <Item title={t('machine.metadataVersion')} subtitle={String(machine.metadataVersion)} subtitleStyle={monoStyle} />
            </ItemGroup>

            <ItemGroup title={t('machine.dangerZone')} footer={t('machine.deleteFooter')}>
                <Item
                    title={t('machine.delete')}
                    destructive
                    onPress={onDeleteMachine}
                    disabled={isDeletingMachine}
                    showChevron={false}
                    rightElement={isDeletingMachine ? (
                        <ActivityIndicator size="small" color={theme.semantic.textSecondary} />
                    ) : (
                        <Ionicons name="trash-outline" size={20} color={theme.semantic.status.error} />
                    )}
                />
            </ItemGroup>
        </>
    );
});
