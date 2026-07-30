import type { Machine, Session } from '@/sync/storageTypes';
import { projectDeviceWorkspace } from './deviceWorkspaceModel';
import { projectDeviceHome, type MachineTransportStatus } from '@/utils/machineUtils';

export const REQUIRED_DEVICE_FIRST_QA_STATES = [
    'loading', 'transport-error', 'mixed-presence', 'empty-workspace',
    'deleted-session', 'unsupported-session', 'operation-result',
] as const;

export type DeviceFirstQaState = typeof REQUIRED_DEVICE_FIRST_QA_STATES[number];

export interface DeviceFirstQaFixture {
    id: DeviceFirstQaState;
    title: string;
    setup: string;
    expectedProjection: unknown;
    productionOperations: readonly never[];
}

function machine(id: string, active: boolean, activeAt: number): Machine {
    return {
        id, seq: 1, createdAt: activeAt, updatedAt: activeAt, active, activeAt,
        metadata: {
            host: `${id}.local`, platform: 'darwin', happyCliVersion: '1.0.0',
            happyHomeDir: '/Users/qa/.happy', homeDir: '/Users/qa',
        },
        metadataVersion: 1, daemonState: null, daemonStateVersion: 1,
    };
}

function terminalSession(id: string, machineId: string, active: boolean): Session {
    return {
        id, seq: 1, createdAt: 1, updatedAt: active ? 2 : 1, active, activeAt: active ? 2 : 1,
        metadata: { host: `${machineId}.local`, machineId, path: '/Users/qa/project', flavor: 'terminal' },
        metadataVersion: 1, agentState: null, agentStateVersion: 1,
        thinking: false, thinkingAt: 0, presence: active ? 'online' : 1,
    };
}

const qaOnlineMachine = machine('qa-online', true, 20);
const qaOfflineMachine = machine('qa-offline', false, 10);

function homeFixture(id: DeviceFirstQaState, title: string, transportStatus: MachineTransportStatus, machines: Machine[], isDataReady: boolean): DeviceFirstQaFixture {
    return {
        id, title,
        setup: 'Development-only pure device-home projection',
        expectedProjection: projectDeviceHome({ machines, isDataReady, transportStatus, offlineExpanded: true }),
        productionOperations: [],
    };
}

export const DEVICE_FIRST_QA_FIXTURES: readonly DeviceFirstQaFixture[] = [
    homeFixture('loading', 'Initial device loading', 'connecting', [], false),
    homeFixture('transport-error', 'Cached devices during transport error', 'error', [qaOnlineMachine, qaOfflineMachine], true),
    homeFixture('mixed-presence', 'Online and offline device groups', 'connected', [qaOfflineMachine, qaOnlineMachine], true),
    {
        id: 'empty-workspace', title: 'Online device with no terminal history',
        setup: 'Development-only pure device-workspace projection',
        expectedProjection: projectDeviceWorkspace({ machine: qaOnlineMachine, machineId: qaOnlineMachine.id, sessions: [], isDataReady: true }),
        productionOperations: [],
    },
    {
        id: 'deleted-session', title: 'Deleted session route', setup: 'Development-only route-state fixture',
        expectedProjection: { state: 'deleted', session: null }, productionOperations: [],
    },
    {
        id: 'unsupported-session', title: 'Unsupported legacy session', setup: 'Development-only route-state fixture',
        expectedProjection: { state: 'unsupported', flavor: 'claude' }, productionOperations: [],
    },
    {
        id: 'operation-result', title: 'Terminal operation result', setup: 'Development-only inert result fixture',
        expectedProjection: {
            success: { type: 'success', sessionId: 'qa-terminal' },
            error: { type: 'error', message: 'Fixture operation failed' },
            activeSession: terminalSession('qa-active', qaOnlineMachine.id, true).id,
        },
        productionOperations: [],
    },
] as const;
