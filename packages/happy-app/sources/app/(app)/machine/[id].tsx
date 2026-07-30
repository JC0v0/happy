import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons, Octicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { ItemList } from '@/components/ItemList';
import { DeviceWorkspace } from '@/components/device/DeviceWorkspace';
import { DeviceManagementSections } from '@/components/device/DeviceManagementSections';
import { projectDeviceWorkspace } from '@/components/device/deviceWorkspaceModel';
import { spawnWorkspaceTerminal } from '@/components/device/deviceWorkspaceActions';
import { Typography } from '@/constants/Typography';
import { useAllSessions, useIsDataReady, useMachine, useSocketStatus } from '@/sync/storage';
import { machineDelete, machineSpawnNewSession, machineStopDaemon, machineUpdateMetadata } from '@/sync/ops';
import { sync } from '@/sync/sync';
import { Modal } from '@/modal';
import { getMachineDisplayName, isMachineOnline } from '@/utils/machineUtils';
import { resolveAbsolutePath } from '@/utils/pathUtils';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import type { MultiTextInputHandle } from '@/components/MultiTextInput';
import { t } from '@/text';

export default function MachineDetailScreen() {
    const { theme } = useUnistyles();
    const { id: machineId } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const machine = useMachine(machineId!);
    const sessions = useAllSessions();
    const isDataReady = useIsDataReady();
    const socket = useSocketStatus();
    const navigateToSession = useNavigateToSession();
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isStoppingDaemon, setIsStoppingDaemon] = useState(false);
    const [isRenamingMachine, setIsRenamingMachine] = useState(false);
    const [isDeletingMachine, setIsDeletingMachine] = useState(false);
    const [customPath, setCustomPath] = useState('');
    const [isSpawning, setIsSpawning] = useState(false);
    const [showAllPaths, setShowAllPaths] = useState(false);
    const inputRef = useRef<MultiTextInputHandle>(null);

    const projection = useMemo(() => projectDeviceWorkspace({
        machine,
        machineId: machineId ?? '',
        sessions,
        isDataReady,
        presenceVerified: socket.status === 'connected',
    }), [machine, machineId, sessions, isDataReady, socket.status]);

    const daemonStatus = useMemo<'likely alive' | 'stopped' | 'unknown'>(() => {
        if (!machine) return 'unknown';
        if (machine.metadata?.daemonLastKnownStatus === 'shutting-down') return 'stopped';
        return isMachineOnline(machine) ? 'likely alive' : 'stopped';
    }, [machine]);

    const handleRefresh = useCallback(async () => {
        setIsRefreshing(true);
        try {
            await Promise.all([sync.refreshMachines(), sync.refreshSessions()]);
        } finally {
            setIsRefreshing(false);
        }
    }, []);

    const handleStopDaemon = useCallback(() => {
        Modal.alert(
            t('deviceFirst.stopDaemonTitle'),
            t('deviceFirst.stopDaemonDescription'),
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('deviceFirst.stopDaemon'),
                    style: 'destructive',
                    onPress: async () => {
                        setIsStoppingDaemon(true);
                        try {
                            const result = await machineStopDaemon(machineId!);
                            Modal.alert(t('deviceFirst.daemonStopped'), result.message);
                            await sync.refreshMachines();
                        } catch {
                            Modal.alert(t('common.error'), t('deviceFirst.daemonStopFailed'));
                        } finally {
                            setIsStoppingDaemon(false);
                        }
                    },
                },
            ],
        );
    }, [machineId]);

    const handleRenameMachine = useCallback(async () => {
        if (!machine || !machineId) return;
        const newDisplayName = await Modal.prompt(
            t('deviceFirst.renameDeviceTitle'),
            t('deviceFirst.renameDeviceDescription'),
            {
                defaultValue: machine.metadata?.displayName || '',
                placeholder: machine.metadata?.host || t('deviceFirst.deviceNamePlaceholder'),
                cancelText: t('common.cancel'),
                confirmText: t('common.rename'),
            },
        );
        if (newDisplayName === null) return;

        setIsRenamingMachine(true);
        try {
            await machineUpdateMetadata(machineId, {
                ...machine.metadata!,
                displayName: newDisplayName.trim() || undefined,
            }, machine.metadataVersion);
            Modal.alert(t('common.success'), t('deviceFirst.deviceRenamed'));
        } catch (error) {
            Modal.alert(t('common.error'), error instanceof Error ? error.message : t('deviceFirst.renameDeviceFailed'));
            await sync.refreshMachines();
        } finally {
            setIsRenamingMachine(false);
        }
    }, [machine, machineId]);

    const handleDeleteMachine = useCallback(async () => {
        if (!machineId) return;
        const confirmed = await Modal.confirm(
            t('machine.deleteConfirmTitle'),
            t('machine.deleteConfirmMessage'),
            { cancelText: t('common.cancel'), confirmText: t('common.delete'), destructive: true },
        );
        if (!confirmed) return;

        setIsDeletingMachine(true);
        try {
            const result = await machineDelete(machineId);
            if (result.success) {
                router.back();
            } else {
                Modal.alert(t('common.error'), result.message || t('machine.deleteFailed'));
            }
        } catch (error) {
            Modal.alert(t('common.error'), error instanceof Error ? error.message : t('machine.deleteFailed'));
        } finally {
            setIsDeletingMachine(false);
        }
    }, [machineId, router]);

    const handleStartTerminal = useCallback(async () => {
        if (!machine || !machineId || !projection.canSpawn || isSpawning) return;
        setIsSpawning(true);
        try {
            const run = (approvedNewDirectoryCreation = false) => spawnWorkspaceTerminal({
                machineId,
                path: customPath,
                homeDir: machine.metadata?.homeDir,
                approvedNewDirectoryCreation,
                dependencies: {
                    spawn: machineSpawnNewSession,
                    refreshSessions: () => sync.refreshSessions(),
                    resolvePath: resolveAbsolutePath,
                },
            });

            let outcome = await run();
            if (outcome.type === 'approvalRequired') {
                const approved = await Modal.confirm(
                    t('deviceFirst.createDirectoryTitle'),
                    t('deviceFirst.createDirectoryDescription', { directory: outcome.directory }),
                    { cancelText: t('common.cancel'), confirmText: t('common.create') },
                );
                if (!approved) return;
                outcome = await run(true);
            }

            if (outcome.type === 'success') {
                navigateToSession(outcome.navigationTarget.sessionId);
            } else if (outcome.type === 'error') {
                Modal.alert(t('common.error'), outcome.message);
            }
        } finally {
            setIsSpawning(false);
        }
    }, [customPath, isSpawning, machine, machineId, navigateToSession, projection.canSpawn]);

    const machineName = machine ? getMachineDisplayName(machine) : '';

    if (projection.state !== 'ready' || !projection.machine) {
        return (
            <>
                <Stack.Screen options={{ headerShown: true, headerTitle: '', headerBackTitle: t('machine.back') }} />
                <View style={styles.stateContainer}>
                    {projection.state === 'loading' ? (
                        <ActivityIndicator color={theme.semantic.textSecondary} />
                    ) : (
                        <>
                            <Ionicons name="desktop-outline" size={28} color={theme.semantic.textMuted} />
                            <Text style={styles.stateTitle}>{t('deviceFirst.deviceNotFound')}</Text>
                            <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backAction}>
                                <Text style={styles.backActionText}>{t('machine.back')}</Text>
                            </Pressable>
                        </>
                    )}
                </View>
            </>
        );
    }

    return (
        <>
            <Stack.Screen
                options={{
                    headerShown: true,
                    headerTitle: machineName,
                    headerBackTitle: t('machine.back'),
                    headerRight: () => (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t('deviceFirst.renameDevice')}
                            onPress={handleRenameMachine}
                            disabled={isRenamingMachine}
                            hitSlop={10}
                            style={({ pressed }) => ({ opacity: isRenamingMachine ? 0.4 : pressed ? 0.65 : 1 })}
                        >
                            <Octicons name="pencil" size={20} color={theme.semantic.textPrimary} />
                        </Pressable>
                    ),
                }}
            />
            <ItemList
                refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
                keyboardShouldPersistTaps="handled"
            >
                <DeviceWorkspace
                    projection={projection}
                    customPath={customPath}
                    onCustomPathChange={setCustomPath}
                    inputRef={inputRef}
                    isSpawning={isSpawning}
                    showAllPaths={showAllPaths}
                    onToggleAllPaths={() => setShowAllPaths((value) => !value)}
                    onStartTerminal={handleStartTerminal}
                    onOpenSession={navigateToSession}
                >
                    <DeviceManagementSections
                        machine={projection.machine}
                        machineId={machineId!}
                        daemonStatus={daemonStatus}
                        isStoppingDaemon={isStoppingDaemon}
                        isRenamingMachine={isRenamingMachine}
                        isDeletingMachine={isDeletingMachine}
                        onStopDaemon={handleStopDaemon}
                        onRenameMachine={handleRenameMachine}
                        onDeleteMachine={handleDeleteMachine}
                    />
                </DeviceWorkspace>
            </ItemList>
        </>
    );
}

const styles = StyleSheet.create((theme) => ({
    stateContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 24,
        backgroundColor: theme.semantic.canvas,
    },
    stateTitle: {
        ...Typography.title(),
        color: theme.semantic.textPrimary,
    },
    backAction: {
        minHeight: 44,
        justifyContent: 'center',
        paddingHorizontal: 16,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.semantic.borderStrong,
        borderRadius: theme.geometry.radius.interactive,
    },
    backActionText: {
        ...Typography.label(),
        color: theme.semantic.textPrimary,
    },
}));
