import { describe, expect, it, vi } from 'vitest';
import { TerminalGridController } from './terminalGridController';

describe('TerminalGridController', () => {
  it('lets the first viewport establish the initial grid', () => {
    const apply = vi.fn();
    const controller = new TerminalGridController(apply);

    controller.reportViewport('phone', { cols: 42, rows: 28 });

    expect(apply).toHaveBeenCalledWith({ cols: 42, rows: 28 }, 'phone');
    expect(controller.activeTerminalId).toBe('phone');
  });

  it('ignores passive resizes and switches on input activation', () => {
    const apply = vi.fn();
    const controller = new TerminalGridController(apply);
    controller.reportViewport('web', { cols: 120, rows: 40 });
    apply.mockClear();

    controller.reportViewport('phone', { cols: 42, rows: 28 });
    expect(apply).not.toHaveBeenCalled();

    controller.activate('phone');
    expect(apply).toHaveBeenLastCalledWith({ cols: 42, rows: 28 }, 'phone');

    controller.reportViewport('web', { cols: 100, rows: 35 });
    expect(apply).toHaveBeenCalledTimes(1);

    controller.activate('web');
    expect(apply).toHaveBeenLastCalledWith({ cols: 100, rows: 35 }, 'web');
  });
});
