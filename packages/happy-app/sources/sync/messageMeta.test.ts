import { describe, expect, it } from 'vitest';
import { resolveMessageModeMeta } from './messageMeta';
import { rigMetadataFixture } from './__testdata__/rigMetadata';

describe('resolveMessageModeMeta', () => {
    it('omits agent mode metadata when nothing was explicitly overridden', () => {
        const meta = resolveMessageModeMeta({
            permissionMode: null,
            modelMode: null,
            effortLevel: null,
            metadata: { flavor: 'codex' },
        } as any);

        expect(meta).toEqual({});
    });

    it('sends explicit per-session overrides', () => {
        const meta = resolveMessageModeMeta({
            permissionMode: 'read-only',
            modelMode: 'gpt-5.4',
            effortLevel: 'high',
            metadata: { flavor: 'codex' },
        } as any);

        expect(meta).toEqual({
            permissionMode: 'read-only',
            model: 'gpt-5.4',
            effort: 'high',
        });
    });

    it('returns empty meta when session has no overrides (agent defaults removed)', () => {
        const meta = resolveMessageModeMeta({
            permissionMode: null,
            modelMode: null,
            effortLevel: null,
            metadata: { flavor: 'claude' },
        } as any);

        expect(meta).toEqual({});
    });

    it('still picks up session-level overrides without settings', () => {
        const meta = resolveMessageModeMeta({
            permissionMode: 'default',
            modelMode: 'gpt-5.4',
            effortLevel: 'xhigh',
            metadata: { flavor: 'codex' },
        } as any);

        expect(meta).toEqual({
            permissionMode: 'default',
            model: 'gpt-5.4',
            effort: 'xhigh',
        });
    });

    it('skips default model value (agent backends removed)', () => {
        const meta = resolveMessageModeMeta({
            permissionMode: null,
            modelMode: 'default',
            effortLevel: null,
            metadata: { flavor: 'claude' },
        } as any);

        expect(meta).toEqual({});
    });

    it('sends canonical Rig selection metadata using mode code rather than semantic kind', () => {
        const meta = resolveMessageModeMeta({
            permissionMode: 'auto',
            modelMode: 'claude:shared-model',
            effortLevel: 'max',
            metadata: rigMetadataFixture,
        } as any);

        expect(meta).toEqual({
            permissionMode: 'auto',
            model: 'shared-model',
            modelProviderId: 'claude',
            effort: 'max',
        });
        expect(meta.permissionMode).not.toBe('safe-yolo');
    });

    it('does not carry an unsupported reasoning value across a Rig model change', () => {
        const meta = resolveMessageModeMeta({
            permissionMode: null,
            modelMode: 'claude:shared-model',
            effortLevel: 'medium',
            metadata: rigMetadataFixture,
        } as any);

        expect(meta.effort).toBe('high');
    });
});
