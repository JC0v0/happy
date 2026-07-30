import type { Machine, Session } from '@/sync/storageTypes';
import { isMachineOnline } from '@/utils/machineUtils';

export interface DeviceWorkspaceProjection {
    state: 'loading' | 'missing' | 'ready';
    machine: Machine | null;
    presence: 'online' | 'offline' | 'unverified';
    canSpawn: boolean;
    activeSessions: Session[];
    recentSessions: Session[];
    recentPaths: string[];
}

export function projectDeviceWorkspace(input: {
    machine: Machine | null;
    machineId: string;
    sessions: readonly Session[];
    isDataReady: boolean;
    presenceVerified?: boolean;
    recentLimit?: number;
}): DeviceWorkspaceProjection {
    const {
        machine,
        machineId,
        sessions,
        isDataReady,
        presenceVerified = true,
        recentLimit = 5,
    } = input;

    if (!isDataReady) {
        return {
            state: 'loading',
            machine: null,
            presence: 'unverified',
            canSpawn: false,
            activeSessions: [],
            recentSessions: [],
            recentPaths: [],
        };
    }

    if (!machine) {
        return {
            state: 'missing',
            machine: null,
            presence: 'offline',
            canSpawn: false,
            activeSessions: [],
            recentSessions: [],
            recentPaths: [],
        };
    }

    const terminalSessions = sessions
        .filter((session) => session.metadata?.machineId === machineId && session.metadata?.flavor === 'terminal')
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const activeSessions = terminalSessions.filter((session) => session.active);
    const recentSessions = terminalSessions.filter((session) => !session.active).slice(0, recentLimit);
    const recentPaths = [...new Set(terminalSessions
        .map((session) => session.metadata?.path)
        .filter((path): path is string => Boolean(path)))];
    const online = isMachineOnline(machine);

    return {
        state: 'ready',
        machine,
        presence: presenceVerified ? (online ? 'online' : 'offline') : 'unverified',
        canSpawn: presenceVerified && online,
        activeSessions,
        recentSessions,
        recentPaths,
    };
}
