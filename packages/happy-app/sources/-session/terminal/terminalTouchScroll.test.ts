import { describe, expect, it, vi } from 'vitest';
import { TERMINAL_TOUCH_SCROLL_SCRIPT } from './terminalTouchScroll';

type TouchHandler = (event: {
    touches: Array<{ clientX: number; clientY: number }>;
    preventDefault: ReturnType<typeof vi.fn>;
}) => void;

function setup() {
    const handlers = new Map<string, TouchHandler>();
    const terminalElement = { dispatchEvent: vi.fn((event: unknown) => {
        void event;
        return true;
    }) };
    const container = {
        clientHeight: 200,
        getBoundingClientRect: vi.fn(() => ({ top: 0 })),
        addEventListener: vi.fn((type: string, handler: TouchHandler) => handlers.set(type, handler)),
    };
    const term = {
        rows: 20,
        scrollLines: vi.fn(),
        focus: vi.fn(),
        blur: vi.fn(),
        input: vi.fn(),
        element: terminalElement,
        buffer: { active: { type: 'normal', cursorY: 10 } },
        modes: { mouseTrackingMode: 'none', applicationCursorKeysMode: false },
    };
    const document = { getElementById: vi.fn(() => container) };
    const setTimeout = vi.fn((callback: () => void) => callback());
    const post = vi.fn();
    class MockWheelEvent {
        constructor(public type: string, public options: Record<string, unknown>) {}
    }

    new Function('document', 'term', 'setTimeout', 'WheelEvent', 'post', TERMINAL_TOUCH_SCROLL_SCRIPT)(
        document,
        term,
        setTimeout,
        MockWheelEvent,
        post,
    );

    const fire = (type: string, touches: Array<{ clientX: number; clientY: number }>) => {
        const event = { touches, preventDefault: vi.fn() };
        handlers.get(type)?.(event);
        return event;
    };

    return { fire, term, terminalElement, post, setTimeout };
}

describe('native terminal touch scrolling', () => {
    it('scrolls down when a finger moves up', () => {
        const { fire, term } = setup();
        fire('touchstart', [{ clientX: 20, clientY: 100 }]);
        const move = fire('touchmove', [{ clientX: 20, clientY: 70 }]);

        expect(move.preventDefault).toHaveBeenCalledOnce();
        expect(term.scrollLines).toHaveBeenCalledWith(3);
    });

    it('scrolls up when a finger moves down', () => {
        const { fire, term } = setup();
        fire('touchstart', [{ clientX: 20, clientY: 70 }]);
        fire('touchmove', [{ clientX: 20, clientY: 100 }]);

        expect(term.scrollLines).toHaveBeenCalledWith(-3);
    });

    it('opens local records for an alternate-buffer swipe without sending PTY input', () => {
        const { fire, term, terminalElement, post } = setup();
        term.buffer.active.type = 'alternate';

        fire('touchstart', [{ clientX: 20, clientY: 100 }]);
        fire('touchmove', [{ clientX: 20, clientY: 70 }]);
        fire('touchmove', [{ clientX: 20, clientY: 40 }]);

        expect(term.scrollLines).not.toHaveBeenCalled();
        expect(term.input).not.toHaveBeenCalled();
        expect(terminalElement.dispatchEvent).not.toHaveBeenCalled();
        expect(post).toHaveBeenCalledOnce();
        expect(post).toHaveBeenCalledWith({ type: 'local-records', deltaLines: 3 });
    });

    it('keeps mouse-tracked TUI scrolling local in the normal buffer', () => {
        const { fire, term, terminalElement, post } = setup();
        term.modes.mouseTrackingMode = 'vt200';

        fire('touchstart', [{ clientX: 20, clientY: 70 }]);
        fire('touchmove', [{ clientX: 20, clientY: 100 }]);

        expect(term.scrollLines).not.toHaveBeenCalled();
        expect(term.input).not.toHaveBeenCalled();
        expect(terminalElement.dispatchEvent).not.toHaveBeenCalled();
        expect(post).toHaveBeenCalledWith({ type: 'local-records', deltaLines: -3 });
    });

    it('focuses on a tap but not after a scroll gesture', () => {
        const tap = setup();
        tap.fire('touchstart', [{ clientX: 20, clientY: 100 }]);
        tap.fire('touchend', []);
        expect(tap.term.focus).toHaveBeenCalledOnce();

        const drag = setup();
        drag.fire('touchstart', [{ clientX: 20, clientY: 100 }]);
        drag.fire('touchmove', [{ clientX: 20, clientY: 70 }]);
        drag.fire('touchend', []);
        expect(drag.term.focus).not.toHaveBeenCalled();
    });

    it('focuses a TUI input immediately when tapping near its cursor', () => {
        const { fire, term, setTimeout } = setup();
        term.buffer.active.type = 'alternate';

        fire('touchstart', [{ clientX: 20, clientY: 100 }]);
        const end = fire('touchend', []);

        expect(end.preventDefault).toHaveBeenCalledOnce();
        expect(term.focus).toHaveBeenCalledOnce();
        expect(setTimeout).not.toHaveBeenCalled();
    });

    it('dismisses the native keyboard when tapping TUI space away from the cursor', () => {
        const { fire, term, post } = setup();
        term.buffer.active.type = 'alternate';

        fire('touchstart', [{ clientX: 20, clientY: 20 }]);
        const end = fire('touchend', []);

        expect(end.preventDefault).toHaveBeenCalledOnce();
        expect(term.focus).not.toHaveBeenCalled();
        expect(term.blur).toHaveBeenCalledOnce();
        expect(post).toHaveBeenCalledWith({ type: 'keyboard-dismiss' });
    });

    it('does not turn a horizontal gesture into terminal scrolling', () => {
        const { fire, term } = setup();
        fire('touchstart', [{ clientX: 20, clientY: 100 }]);
        const move = fire('touchmove', [{ clientX: 60, clientY: 90 }]);

        expect(move.preventDefault).not.toHaveBeenCalled();
        expect(term.scrollLines).not.toHaveBeenCalled();
    });
});
