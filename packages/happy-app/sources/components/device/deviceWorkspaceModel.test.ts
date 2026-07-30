import { describe, expect, it } from 'vitest';
import type { Machine, Session } from '@/sync/storageTypes';
import { projectDeviceWorkspace } from './deviceWorkspaceModel';

const testMachine: Machine = {
    id: 'machine-1',
    seq: 1,
    createdAt: 1,
    updatedAt: 1,
    active: true,
    activeAt: 1,
    metadata: {
        host: 'workstation',
        platform: 'darwin',
        happyCliVersion: '1.0.0',
        happyHomeDir: '/Users/test/.happy',
        homeDir: '/Users/test',
    },
    metadataVersion: 1,
    daemonState: null,
    daemonStateVersion: 1,
};

function session(id: string, options: {
    machineId?: string;
    flavor?: string | null;
    active?: boolean;
    updatedAt?: number;
    path?: string;
} = {}): Session {
    return {
        id,
        seq: 1,
        createdAt: 1,
        updatedAt: options.updatedAt ?? 1,
        active: options.active ?? false,
        activeAt: 1,
        metadata: {
            path: options.path ?? '/Users/test/project',
            host: 'workstation',
            machineId: options.machineId ?? 'machine-1',
            flavor: options.flavor === undefined ? 'terminal' : options.flavor,
        },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 0,
        presence: 'online',
    };
}

describe('projectDeviceWorkspace', () => {
    it('separates active and recent terminal sessions without duplicates', () => {
        const projection = projectDeviceWorkspace({
            machine: testMachine,
            machineId: testMachine.id,
            sessions: [
                session('recent-old', { updatedAt: 10 }),
                session('active', { active: true, updatedAt: 30 }),
                session('recent-new', { updatedAt: 20 }),
            ],
            isDataReady: true,
        });

        expect(projection.activeSessions.map((value) => value.id)).toEqual(['active']);
        expect(projection.recentSessions.map((value) => value.id)).toEqual(['recent-new', 'recent-old']);
    });

    it('excludes other machines and non-terminal legacy sessions', () => {
        const projection = projectDeviceWorkspace({
            machine: testMachine,
            machineId: testMachine.id,
            sessions: [
                session('terminal'),
                session('legacy', { flavor: 'claude' }),
                session('other-machine', { machineId: 'machine-2' }),
            ],
            isDataReady: true,
        });

        expect(projection.recentSessions.map((value) => value.id)).toEqual(['terminal']);
    });

    it('keeps recent sessions capped and paths ordered by recent session activity', () => {
        const sessions = Array.from({ length: 7 }, (_, index) => session(`session-${index}`, {
            updatedAt: index,
            path: `/project/${index}`,
        }));
        const projection = projectDeviceWorkspace({
            machine: testMachine,
            machineId: testMachine.id,
            sessions,
            isDataReady: true,
        });

        expect(projection.recentSessions).toHaveLength(5);
        expect(projection.recentSessions[0].id).toBe('session-6');
        expect(projection.recentPaths[0]).toBe('/project/6');
    });

    it('distinguishes loading, missing, offline, and unverified presence', () => {
        expect(projectDeviceWorkspace({ machine: null, machineId: 'x', sessions: [], isDataReady: false }).state).toBe('loading');
        expect(projectDeviceWorkspace({ machine: null, machineId: 'x', sessions: [], isDataReady: true }).state).toBe('missing');
        expect(projectDeviceWorkspace({
            machine: { ...testMachine, active: false },
            machineId: testMachine.id,
            sessions: [],
            isDataReady: true,
        }).canSpawn).toBe(false);
        expect(projectDeviceWorkspace({
            machine: testMachine,
            machineId: testMachine.id,
            sessions: [],
            isDataReady: true,
            presenceVerified: false,
        }).presence).toBe('unverified');
    });
});
