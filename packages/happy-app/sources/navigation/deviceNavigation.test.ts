import { describe, expect, it } from 'vitest';
import {
    getMachineWorkspacePath,
    resolveSelectedMachineId,
    resolveSessionBackIntent,
} from './deviceNavigation';

describe('device navigation', () => {
    it('uses real back only when the parent is the same device workspace', () => {
        expect(resolveSessionBackIntent({
            stack: ['/', '/machine/machine-1', '/session/session-1'],
            cursor: 2,
        }, 'machine-1')).toEqual({ kind: 'back' });

        expect(resolveSessionBackIntent({
            stack: ['/machine/machine-2', '/session/session-1'],
            cursor: 1,
        }, 'machine-1')).toEqual({ kind: 'replace', pathname: '/machine/machine-1' });
    });

    it('falls back deterministically for direct links, refreshes, and missing metadata', () => {
        expect(resolveSessionBackIntent(null, 'machine 1')).toEqual({
            kind: 'replace',
            pathname: getMachineWorkspacePath('machine 1'),
        });
        expect(resolveSessionBackIntent({ stack: ['/session/s1'], cursor: 0 }, null)).toEqual({
            kind: 'replace',
            pathname: '/',
        });
    });

    it('does not treat settings as a usable session parent', () => {
        expect(resolveSessionBackIntent({
            stack: ['/settings', '/session/session-1'],
            cursor: 1,
        }, 'machine-1')).toEqual({ kind: 'replace', pathname: '/machine/machine-1' });
    });

    it('uses the fallback when the native navigator cannot go back', () => {
        expect(resolveSessionBackIntent({
            stack: ['/machine/machine-1', '/session/session-1'],
            cursor: 1,
        }, 'machine-1', false)).toEqual({ kind: 'replace', pathname: '/machine/machine-1' });
    });

    it('selects a device from workspace routes or session metadata', () => {
        expect(resolveSelectedMachineId('/machine/machine%201', null)).toBe('machine 1');
        expect(resolveSelectedMachineId('/session/session-1', 'machine-1')).toBe('machine-1');
        expect(resolveSelectedMachineId('/settings', 'machine-1')).toBeNull();
    });
});
