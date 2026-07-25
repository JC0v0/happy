import * as React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Modal } from '@/modal';
import { t } from '@/text';
import { useAllMachines } from '@/sync/storage';
import { machineSpawnNewSession } from '@/sync/ops';
import { sync } from '@/sync/sync';
import type { Machine } from '@/sync/storageTypes';
import { isMachineOnline } from '@/utils/machineUtils';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { useVisibleSessionListViewData, filterTerminalListViewData } from '@/hooks/useVisibleSessionListViewData';
import { SessionsList } from './SessionsList';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Text } from '@/components/ui/text';

/**
 * Terminal-only home: machine picker on top (tap = spawn a fresh terminal on
 * that machine), terminal sessions below. Rendered by both the phone tab and
 * the desktop/tablet sidebar.
 */
export const TerminalsHomeView = React.memo(function TerminalsHomeView() {
    const { theme } = useUnistyles();
    const fullData = useVisibleSessionListViewData();
    const hasTerminalSessions = React.useMemo(
        () => (filterTerminalListViewData(fullData)?.length ?? 0) > 0,
        [fullData],
    );

    const listHeader = (
        <View>
            <MachineSection />
            {!hasTerminalSessions && fullData !== null && (
                <Text variant="muted" style={styles.emptyHint}>
                    {t('terminals.emptyHint')}
                </Text>
            )}
        </View>
    );

    if (fullData === null) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color={theme.colors.textSecondary} />
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <SessionsList terminalOnly listHeader={listHeader} />
        </View>
    );
});

const MachineSection = React.memo(function MachineSection() {
    const { theme } = useUnistyles();
    const machines = useAllMachines({ includeOffline: true });
    const navigateToSession = useNavigateToSession();
    const [spawningMachineId, setSpawningMachineId] = React.useState<string | null>(null);

    const sorted = React.useMemo(
        () => [...machines].sort((a, b) => Number(isMachineOnline(b)) - Number(isMachineOnline(a))),
        [machines],
    );

    const spawnTerminal = React.useCallback(async (machine: Machine, approvedNewDirectoryCreation = false) => {
        if (!isMachineOnline(machine) || spawningMachineId) {
            return;
        }
        setSpawningMachineId(machine.id);
        try {
            const result = await machineSpawnNewSession({
                machineId: machine.id,
                directory: machine.metadata?.homeDir ?? '/',
                agent: 'terminal',
                approvedNewDirectoryCreation,
            });
            switch (result.type) {
                case 'success':
                    await sync.refreshSessions();
                    navigateToSession(result.sessionId);
                    break;
                case 'requestToApproveDirectoryCreation':
                    // We always spawn in the machine's home directory, which
                    // is guaranteed to exist — approve and retry silently.
                    await spawnTerminal(machine, true);
                    break;
                case 'error':
                    Modal.alert(t('terminals.spawnFailed'), result.errorMessage);
                    break;
            }
        } catch (error) {
            Modal.alert(
                t('terminals.spawnFailed'),
                error instanceof Error ? error.message : t('common.error'),
            );
        } finally {
            setSpawningMachineId(null);
        }
    }, [spawningMachineId, navigateToSession]);

    if (sorted.length === 0) {
        return (
            <View style={styles.noMachinesContainer}>
                <Ionicons name="desktop-outline" size={32} color={theme.colors.textSecondary} />
                <Text variant="muted" style={{ textAlign: 'center' }}>
                    {t('terminals.noMachines')}
                </Text>
            </View>
        );
    }

    return (
        <View style={styles.section}>
            <Text variant="muted" style={styles.sectionTitle}>
                {t('terminals.machines')}
            </Text>
            <View style={{ gap: 8 }}>
                {sorted.map((machine) => {
                    const online = isMachineOnline(machine);
                    const spawning = spawningMachineId === machine.id;
                    return (
                        <Pressable
                            key={machine.id}
                            onPress={() => spawnTerminal(machine)}
                            disabled={!online || spawningMachineId !== null}
                        >
                            <Card style={online ? undefined : { opacity: 0.5 }}>
                                <CardHeader style={styles.machineRow}>
                                    <Ionicons
                                        name="desktop-outline"
                                        size={22}
                                        color={online ? theme.colors.text : theme.colors.textSecondary}
                                    />
                                    <View style={{ flex: 1 }}>
                                        <CardTitle>
                                            {machine.metadata?.displayName || machine.metadata?.host || machine.id}
                                        </CardTitle>
                                        <CardDescription>
                                            {online
                                                ? (spawning ? t('terminals.spawning') : (machine.metadata?.platform ?? ''))
                                                : t('status.offline')}
                                        </CardDescription>
                                    </View>
                                    {spawning ? (
                                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                                    ) : (
                                        online && (
                                            <Ionicons name="chevron-forward" size={18} color={theme.colors.textSecondary} />
                                        )
                                    )}
                                </CardHeader>
                            </Card>
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
    },
    loadingContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.groupped.background,
    },
    section: {
        paddingHorizontal: 16,
        paddingTop: 16,
    },
    sectionTitle: {
        marginBottom: 8,
        fontWeight: '600',
    },
    machineRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 16,
    },
    emptyHint: {
        textAlign: 'center',
        paddingHorizontal: 32,
        marginTop: 24,
    },
    noMachinesContainer: {
        alignItems: 'center',
        paddingVertical: 48,
        gap: 12,
    },
}));
