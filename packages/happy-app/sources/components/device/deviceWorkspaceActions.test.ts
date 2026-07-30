import { describe, expect, it, vi } from 'vitest';
import { spawnWorkspaceTerminal } from './deviceWorkspaceActions';

describe('spawnWorkspaceTerminal', () => {
    it('spawns terminal flavor, refreshes, and returns navigation intent', async () => {
        const spawn = vi.fn().mockResolvedValue({ type: 'success', sessionId: 'session-1' });
        const refreshSessions = vi.fn().mockResolvedValue(undefined);
        const outcome = await spawnWorkspaceTerminal({
            machineId: 'machine-1',
            path: '',
            homeDir: '/Users/test',
            dependencies: {
                spawn,
                refreshSessions,
                resolvePath: (path, homeDir) => path === '~' ? homeDir! : path,
            },
        });

        expect(spawn).toHaveBeenCalledWith({
            machineId: 'machine-1',
            directory: '/Users/test',
            approvedNewDirectoryCreation: false,
            agent: 'terminal',
        });
        expect(refreshSessions).toHaveBeenCalledOnce();
        expect(outcome).toEqual({
            type: 'success',
            sessionId: 'session-1',
            navigationTarget: { kind: 'session', sessionId: 'session-1' },
        });
    });

    it('returns directory approval without refreshing or navigating', async () => {
        const refreshSessions = vi.fn().mockResolvedValue(undefined);
        const outcome = await spawnWorkspaceTerminal({
            machineId: 'machine-1',
            path: '/new-directory',
            dependencies: {
                spawn: vi.fn().mockResolvedValue({
                    type: 'requestToApproveDirectoryCreation',
                    directory: '/new-directory',
                }),
                refreshSessions,
                resolvePath: (path) => path,
            },
        });

        expect(outcome).toEqual({ type: 'approvalRequired', directory: '/new-directory' });
        expect(refreshSessions).not.toHaveBeenCalled();
    });

    it('preserves operation and thrown errors as user-visible outcomes', async () => {
        const common = {
            machineId: 'machine-1',
            path: '~',
            dependencies: {
                refreshSessions: vi.fn().mockResolvedValue(undefined),
                resolvePath: (path: string) => path,
                spawn: vi.fn(),
            },
        };

        common.dependencies.spawn.mockResolvedValueOnce({ type: 'error', errorMessage: 'daemon unavailable' });
        await expect(spawnWorkspaceTerminal(common)).resolves.toEqual({ type: 'error', message: 'daemon unavailable' });
        common.dependencies.spawn.mockRejectedValueOnce(new Error('network unavailable'));
        await expect(spawnWorkspaceTerminal(common)).resolves.toEqual({ type: 'error', message: 'network unavailable' });
    });
});
