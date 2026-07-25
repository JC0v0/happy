import { execSync } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionMetadata } from './createSessionMetadata';

vi.mock('node:child_process', () => ({
    execSync: vi.fn(),
}));

const mockedExecSync = vi.mocked(execSync);

describe('createSessionMetadata', () => {
    beforeEach(() => {
        mockedExecSync.mockReset();
        mockedExecSync.mockReturnValue('main\n');
    });

    it('sets terminal flavor and startedBy', () => {
        const { metadata, state } = createSessionMetadata({
            flavor: 'terminal',
            machineId: 'machine-1',
            startedBy: 'terminal',
        });

        expect(metadata.flavor).toBe('terminal');
        expect(metadata.startedBy).toBe('terminal');
        expect(metadata.startedFromDaemon).toBe(false);
        expect(metadata.machineId).toBe('machine-1');
        expect(state.controlledByUser).toBe(false);
    });

    it('marks daemon-started sessions', () => {
        const { metadata } = createSessionMetadata({
            flavor: 'terminal',
            machineId: 'machine-2',
            startedBy: 'daemon',
        });

        expect(metadata.startedBy).toBe('daemon');
        expect(metadata.startedFromDaemon).toBe(true);
    });

    it('sets metadata.gitBranch when a git branch is detected', () => {
        mockedExecSync.mockReturnValue('fix/session-status\n');

        const { metadata } = createSessionMetadata({
            flavor: 'terminal',
            machineId: 'machine-7',
        });

        expect(metadata.gitBranch).toBe('fix/session-status');
        expect(mockedExecSync).toHaveBeenCalledWith('git rev-parse --abbrev-ref HEAD', expect.objectContaining({
            cwd: process.cwd(),
        }));
    });

    it('omits metadata.gitBranch when git is unavailable or detached', () => {
        mockedExecSync.mockReturnValue('HEAD\n');

        const detached = createSessionMetadata({
            flavor: 'terminal',
            machineId: 'machine-8',
        });

        expect(detached.metadata.gitBranch).toBeUndefined();

        mockedExecSync.mockImplementation(() => {
            throw new Error('not a git repository');
        });

        const unavailable = createSessionMetadata({
            flavor: 'terminal',
            machineId: 'machine-9',
        });

        expect(unavailable.metadata.gitBranch).toBeUndefined();
    });
});
