import type { SpawnSessionOptions, SpawnSessionResult } from '@/sync/ops';

export type DeviceWorkspaceSpawnOutcome =
    | { type: 'success'; sessionId: string; navigationTarget: { kind: 'session'; sessionId: string } }
    | { type: 'approvalRequired'; directory: string }
    | { type: 'error'; message: string };

export interface DeviceWorkspaceActionDependencies {
    spawn: (options: SpawnSessionOptions) => Promise<SpawnSessionResult>;
    refreshSessions: () => Promise<void>;
    resolvePath: (path: string, homeDir?: string) => string;
}

export async function spawnWorkspaceTerminal(input: {
    machineId: string;
    path: string;
    homeDir?: string;
    approvedNewDirectoryCreation?: boolean;
    dependencies: DeviceWorkspaceActionDependencies;
}): Promise<DeviceWorkspaceSpawnOutcome> {
    const pathToUse = input.path.trim() || '~';
    const directory = input.dependencies.resolvePath(pathToUse, input.homeDir);

    try {
        const result = await input.dependencies.spawn({
            machineId: input.machineId,
            directory,
            approvedNewDirectoryCreation: input.approvedNewDirectoryCreation ?? false,
            agent: 'terminal',
        });

        switch (result.type) {
            case 'success':
                await input.dependencies.refreshSessions();
                return {
                    type: 'success',
                    sessionId: result.sessionId,
                    navigationTarget: { kind: 'session', sessionId: result.sessionId },
                };
            case 'requestToApproveDirectoryCreation':
                return { type: 'approvalRequired', directory: result.directory };
            case 'error':
                return { type: 'error', message: result.errorMessage };
        }
    } catch (error) {
        return {
            type: 'error',
            message: error instanceof Error ? error.message : 'Failed to start terminal',
        };
    }
}
