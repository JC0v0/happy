import { describe, expect, it } from 'vitest';
import type { Machine } from '@/sync/storageTypes';
import {
    getMachineWorkspaceTarget,
    projectDeviceHome,
} from './machineUtils';

function machine(id: string, active: boolean, activeAt: number): Machine {
    return {
        id,
        seq: 1,
        createdAt: activeAt,
        updatedAt: activeAt,
        active,
        activeAt,
        metadata: {
            host: `${id}.local`,
            platform: 'darwin',
            happyCliVersion: '1.0.0',
            happyHomeDir: '/tmp/.happy',
            homeDir: '/Users/test',
        },
        metadataVersion: 1,
        daemonState: null,
        daemonStateVersion: 1,
    };
}

describe('projectDeviceHome', () => {
    it('groups online first and keeps offline collapsed by default', () => {
        const projection = projectDeviceHome({
            machines: [
                machine('offline-old', false, 10),
                machine('online-old', true, 20),
                machine('offline-new', false, 40),
                machine('online-new', true, 50),
            ],
            isDataReady: true,
            transportStatus: 'connected',
        });

        expect(projection.state).toBe('ready');
        expect(projection.online.map((entry) => entry.machine.id)).toEqual(['online-new', 'online-old']);
        expect(projection.offline.map((entry) => entry.machine.id)).toEqual(['offline-new', 'offline-old']);
        expect(projection.offlineExpanded).toBe(false);
    });

    it('distinguishes initial loading from a ready empty snapshot', () => {
        expect(projectDeviceHome({
            machines: [],
            isDataReady: false,
            transportStatus: 'connecting',
        }).state).toBe('loading');
        expect(projectDeviceHome({
            machines: [],
            isDataReady: true,
            transportStatus: 'connected',
        }).state).toBe('empty');
    });

    it('keeps cached rows but marks presence unverified during transport loss', () => {
        const projection = projectDeviceHome({
            machines: [machine('cached-online', true, 20), machine('cached-offline', false, 10)],
            isDataReady: true,
            transportStatus: 'disconnected',
            offlineExpanded: true,
        });

        expect(projection.presenceVerified).toBe(false);
        expect([...projection.online, ...projection.offline].map((entry) => entry.presence)).toEqual([
            'unverified',
            'unverified',
        ]);
        expect(projection.offlineExpanded).toBe(true);
    });

    it('returns workspace-only row targets', () => {
        expect(getMachineWorkspaceTarget('machine-1')).toEqual({ kind: 'workspace', machineId: 'machine-1' });
    });
});
