import { describe, expect, it } from 'vitest';
import {
    SHARED_TERMINAL_COLS,
    SHARED_TERMINAL_ROWS,
    sharedGridFontSize,
} from './terminalSharedGrid';

describe('shared terminal grid', () => {
    it('uses the same 80x24 logical geometry on every client', () => {
        expect([SHARED_TERMINAL_COLS, SHARED_TERMINAL_ROWS]).toEqual([80, 24]);
    });

    it('shrinks mobile text to fit all shared columns', () => {
        expect(sharedGridFontSize({
            baseFontSize: 10,
            measuredCols: 64,
            measuredRows: 40,
        })).toBe(8);
    });

    it('uses the limiting viewport axis and clamps desktop text', () => {
        expect(sharedGridFontSize({
            baseFontSize: 13,
            measuredCols: 200,
            measuredRows: 60,
        })).toBe(24);
        expect(sharedGridFontSize({
            baseFontSize: 13,
            measuredCols: 160,
            measuredRows: 20,
        })).toBe(10.8);
    });

    it('applies local zoom without changing the logical grid', () => {
        expect(sharedGridFontSize({
            baseFontSize: 10,
            measuredCols: 80,
            measuredRows: 24,
            zoomDelta: 2,
        })).toBe(12);
    });

    it('fits an adaptive controller-owned grid into the local viewport', () => {
        expect(sharedGridFontSize({
            baseFontSize: 10,
            measuredCols: 60,
            measuredRows: 30,
            gridCols: 120,
            gridRows: 30,
        })).toBe(8);
        expect(sharedGridFontSize({
            baseFontSize: 10,
            measuredCols: 120,
            measuredRows: 30,
            gridCols: 60,
            gridRows: 30,
        })).toBe(10);
    });
});
