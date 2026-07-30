import { describe, expect, it } from 'vitest';
import { resolveResponsiveLayout, WIDE_LAYOUT_MIN_WIDTH } from './responsiveLayout';

describe('resolveResponsiveLayout', () => {
    it('uses compact navigation below the width threshold', () => {
        expect(resolveResponsiveLayout(WIDE_LAYOUT_MIN_WIDTH - 1)).toEqual({
            mode: 'compact',
            isWide: false,
            showSidebar: false,
            showInlineBackButton: true,
        });
    });

    it('uses wide navigation at the threshold', () => {
        expect(resolveResponsiveLayout(WIDE_LAYOUT_MIN_WIDTH).isWide).toBe(true);
    });

    it('keeps a narrow tablet compact and allows a wide phone or browser to be wide', () => {
        expect(resolveResponsiveLayout(744).mode).toBe('compact');
        expect(resolveResponsiveLayout(932).mode).toBe('wide');
    });

    it('treats invalid measurements as compact', () => {
        expect(resolveResponsiveLayout(Number.NaN).mode).toBe('compact');
    });
});
