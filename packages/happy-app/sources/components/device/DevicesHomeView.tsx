import * as React from 'react';
import { ScrollView, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import { DeviceList } from './DeviceList';
import { Text } from '@/components/ui/text';
import { useAllMachines, useAllSessions, useIsDataReady, useSocketStatus } from '@/sync/storage';
import { getMachineWorkspaceTarget, projectDeviceHome } from '@/utils/machineUtils';
import { t } from '@/text';
import { resolveSelectedMachineId } from '@/navigation/deviceNavigation';

export const DevicesHomeView = React.memo(function DevicesHomeView({ variant = 'phone' }: { variant?: 'phone' | 'sidebar' }) {
    const router = useRouter();
    const pathname = usePathname();
    const machines = useAllMachines({ includeOffline: true });
    const sessions = useAllSessions();
    const isDataReady = useIsDataReady();
    const socket = useSocketStatus();
    const [offlineExpanded, setOfflineExpanded] = React.useState(false);
    const projection = React.useMemo(() => projectDeviceHome({
        machines,
        isDataReady,
        transportStatus: socket.status,
        offlineExpanded,
    }), [machines, isDataReady, socket.status, offlineExpanded]);
    const routeSessionId = React.useMemo(() => {
        const match = pathname.match(/^\/session\/([^/]+)/);
        if (!match) return null;
        try {
            return decodeURIComponent(match[1]);
        } catch {
            return match[1];
        }
    }, [pathname]);
    const sessionMachineId = routeSessionId
        ? sessions.find((session) => session.id === routeSessionId)?.metadata?.machineId
        : null;
    const selectedMachineId = resolveSelectedMachineId(pathname, sessionMachineId);

    const selectMachine = React.useCallback((machineId: string) => {
        if (machineId === selectedMachineId) return;
        const target = getMachineWorkspaceTarget(machineId);
        router.push(`/machine/${encodeURIComponent(target.machineId)}`);
    }, [router, selectedMachineId]);

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
            <View style={[styles.intro, variant === 'sidebar' && styles.sidebarIntro]}>
                <Text variant="label">{t('deviceFirst.devicesEyebrow')}</Text>
                <Text variant="display">{t('deviceFirst.devices')}</Text>
                {variant === 'phone' && (
                    <Text variant="muted">{t('deviceFirst.devicesIntro')}</Text>
                )}
            </View>
            <DeviceList
                projection={projection}
                selectedMachineId={selectedMachineId}
                onSelectMachine={selectMachine}
                onToggleOffline={() => setOfflineExpanded((value) => !value)}
            />
        </ScrollView>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.semantic.canvas,
    },
    content: {
        paddingBottom: 32,
    },
    intro: {
        gap: 6,
        paddingHorizontal: 16,
        paddingTop: 24,
        paddingBottom: 20,
    },
    sidebarIntro: {
        paddingTop: 16,
        paddingBottom: 12,
    },
}));
