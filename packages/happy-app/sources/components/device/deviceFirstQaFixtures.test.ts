import { describe, expect, it } from 'vitest';
import { DEVICE_FIRST_QA_FIXTURES, REQUIRED_DEVICE_FIRST_QA_STATES } from './deviceFirstQaFixtures';

describe('device-first QA fixtures', () => {
    it('covers every required non-deterministic state exactly once', () => {
        const ids = DEVICE_FIRST_QA_FIXTURES.map((fixture) => fixture.id);
        expect(ids).toEqual(REQUIRED_DEVICE_FIRST_QA_STATES);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('cannot invoke production operations', () => {
        for (const fixture of DEVICE_FIRST_QA_FIXTURES) {
            expect(fixture.productionOperations).toEqual([]);
            expect(fixture.expectedProjection).toBeTruthy();
        }
    });

    it('uses production home and workspace projection shapes', () => {
        expect((DEVICE_FIRST_QA_FIXTURES[0].expectedProjection as { state: string }).state).toBe('loading');
        expect((DEVICE_FIRST_QA_FIXTURES[2].expectedProjection as { online: unknown[] }).online).toHaveLength(1);
        expect((DEVICE_FIRST_QA_FIXTURES[3].expectedProjection as { canSpawn: boolean }).canSpawn).toBe(true);
    });
});
