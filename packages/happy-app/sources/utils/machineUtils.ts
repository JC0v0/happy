import type { Machine } from '@/sync/storageTypes';

export type MachineTransportStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type MachinePresence = 'online' | 'offline' | 'unverified';

export interface DeviceListEntry {
    machine: Machine;
    presence: MachinePresence;
    canSpawnImmediately: false;
}

export interface DeviceHomeProjection {
    state: 'loading' | 'empty' | 'ready';
    transportStatus: MachineTransportStatus;
    presenceVerified: boolean;
    online: DeviceListEntry[];
    offline: DeviceListEntry[];
    offlineExpanded: boolean;
}

export interface MachineWorkspaceTarget {
    kind: 'workspace';
    machineId: string;
}

export function isMachineOnline(machine: Machine): boolean {
    // Use the active flag directly, no timeout checks
    return machine.active;
}

export function getMachineDisplayName(machine: Machine): string {
    return machine.metadata?.displayName || machine.metadata?.host || machine.id;
}

export function getMachineWorkspaceTarget(machineId: string): MachineWorkspaceTarget {
    return { kind: 'workspace', machineId };
}

export function projectDeviceHome(input: {
    machines: readonly Machine[];
    isDataReady: boolean;
    transportStatus: MachineTransportStatus;
    offlineExpanded?: boolean;
}): DeviceHomeProjection {
    const {
        machines,
        isDataReady,
        transportStatus,
        offlineExpanded = false,
    } = input;
    const presenceVerified = transportStatus === 'connected';
    const byRecentActivity = (a: Machine, b: Machine) =>
        (b.activeAt - a.activeAt) || (b.updatedAt - a.updatedAt) || a.id.localeCompare(b.id);
    const toEntry = (machine: Machine): DeviceListEntry => ({
        machine,
        presence: presenceVerified ? (isMachineOnline(machine) ? 'online' : 'offline') : 'unverified',
        canSpawnImmediately: false,
    });

    if (!isDataReady) {
        return {
            state: 'loading',
            transportStatus,
            presenceVerified,
            online: [],
            offline: [],
            offlineExpanded,
        };
    }

    const onlineMachines = machines.filter(isMachineOnline).sort(byRecentActivity);
    const offlineMachines = machines.filter((machine) => !isMachineOnline(machine)).sort(byRecentActivity);

    return {
        state: machines.length === 0 ? 'empty' : 'ready',
        transportStatus,
        presenceVerified,
        online: onlineMachines.map(toEntry),
        offline: offlineMachines.map(toEntry),
        offlineExpanded,
    };
}
