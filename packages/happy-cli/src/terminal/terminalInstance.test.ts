import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TerminalStreamEvent } from '@slopus/happy-wire';

const ptyMock = vi.hoisted(() => {
  const instances: Array<{
    writes: string[];
    resizes: Array<[number, number]>;
    killed: boolean;
    emitData: (data: string) => void;
  }> = [];
  const spawn = vi.fn(() => {
    let onData: (data: string) => void = () => {};
    const instance = {
      writes: [] as string[],
      resizes: [] as Array<[number, number]>,
      killed: false,
      emitData: (data: string) => onData(data),
      onData: (callback: (data: string) => void) => { onData = callback; },
      onExit: (_callback: (event: { exitCode: number }) => void) => {},
      write(data: string) { instance.writes.push(data); },
      resize(cols: number, rows: number) { instance.resizes.push([cols, rows]); },
      kill() { instance.killed = true; },
    };
    instances.push(instance);
    return instance;
  });
  return { instances, spawn };
});

vi.mock('node-pty', () => ({ spawn: ptyMock.spawn }));

import { TerminalInstance } from './terminalInstance';

function createInstance(
  terminalId: string | undefined,
  events: TerminalStreamEvent[],
  initialSeq?: number,
  structuredCommands = false,
) {
  return new TerminalInstance({
    terminalId,
    shellLaunch: {
      file: 'test-shell',
      args: [],
      shell: 'test',
      structuredCommands,
    },
    cwd: 'C:\\work',
    cols: 80,
    rows: 24,
    initialSeq,
    env: {},
    onEvent: (event) => events.push(event),
    onNeedsInput: vi.fn(),
    onCommandFinished: vi.fn(),
    onExit: vi.fn(),
  });
}

afterEach(() => {
  vi.useRealTimers();
  ptyMock.instances.length = 0;
  ptyMock.spawn.mockClear();
});

describe('TerminalInstance', () => {
  it('keeps input, resize, output and sequence state isolated per device', () => {
    vi.useFakeTimers();
    const phoneEvents: TerminalStreamEvent[] = [];
    const webEvents: TerminalStreamEvent[] = [];
    const phone = createInstance('phone', phoneEvents);
    const web = createInstance('web', webEvents);

    phone.write('phone input');
    web.write('web input');
    phone.setGrid(40, 20, 'phone');
    web.setGrid(120, 50, 'web');
    ptyMock.instances[0].emitData('phone output');
    ptyMock.instances[1].emitData('web output');
    vi.advanceTimersByTime(16);

    expect(ptyMock.instances[0].writes).toEqual(['phone input']);
    expect(ptyMock.instances[1].writes).toEqual(['web input']);
    expect(ptyMock.instances[0].resizes).toEqual([[40, 20]]);
    expect(ptyMock.instances[1].resizes).toEqual([[120, 50]]);
    expect(phoneEvents).toEqual([
      expect.objectContaining({ t: 'grid', terminalId: 'phone', seq: 0, cols: 40, rows: 20 }),
      expect.objectContaining({ t: 'output', terminalId: 'phone', seq: 1 }),
    ]);
    expect(webEvents).toEqual([
      expect.objectContaining({ t: 'grid', terminalId: 'web', seq: 0, cols: 120, rows: 50 }),
      expect.objectContaining({ t: 'output', terminalId: 'web', seq: 1 }),
    ]);

    expect(phone.snapshotEvents()).toEqual([
      expect.objectContaining({ terminalId: 'phone', t: 'grid', seq: 0, snapshot: true }),
      expect.objectContaining({ terminalId: 'phone', t: 'output', seq: 1, snapshot: true }),
    ]);
    expect(web.snapshotEvents()).toEqual([
      expect.objectContaining({ terminalId: 'web', t: 'grid', seq: 0, snapshot: true }),
      expect.objectContaining({ terminalId: 'web', t: 'output', seq: 1, snapshot: true }),
    ]);

    phone.dispose();
    web.dispose();
    expect(ptyMock.instances.map((instance) => instance.killed)).toEqual([true, true]);
  });

  it('can continue a device sequence when its shell is recreated', () => {
    vi.useFakeTimers();
    const events: TerminalStreamEvent[] = [];
    const instance = createInstance('phone', events, 12);
    ptyMock.instances[0].emitData('restored');
    vi.advanceTimersByTime(16);
    expect(events[0]).toEqual(expect.objectContaining({ terminalId: 'phone', seq: 12 }));
    expect(instance.nextSequence).toBe(13);
    instance.dispose();
  });

  it('turns a RAW PSReadLine submission into a shared command block', () => {
    const events: TerminalStreamEvent[] = [];
    const instance = createInstance('phone', events, undefined, true);
    const encodedCommand = Buffer.from('Get-ChildItem', 'utf8').toString('base64');

    ptyMock.instances[0].emitData(
      `\u001b]133;C;${encodedCommand}\u0007file.txt\r\n\u001b]133;D;0\u0007`,
    );

    expect(events.map((event) => event.t)).toEqual([
      'command-start',
      'state',
      'output',
      'command-end',
      'state',
    ]);
    expect(events[0]).toEqual(expect.objectContaining({
      t: 'command-start',
      terminalId: 'phone',
      command: 'Get-ChildItem',
    }));
    expect(events[3]).toEqual(expect.objectContaining({ t: 'command-end', exitCode: 0 }));
    instance.dispose();
  });

  it('does not duplicate a dock command when its PSReadLine marker arrives', () => {
    const events: TerminalStreamEvent[] = [];
    const instance = createInstance('web', events, undefined, true);
    instance.execute('Get-Date');
    const encodedCommand = Buffer.from('Get-Date', 'utf8').toString('base64');
    ptyMock.instances[0].emitData(`\u001b]133;C;${encodedCommand}\u0007`);

    expect(events.filter((event) => event.t === 'command-start')).toHaveLength(1);
    instance.dispose();
  });

  it('emits an unscoped stream for the session-wide shared PTY', () => {
    vi.useFakeTimers();
    const events: TerminalStreamEvent[] = [];
    const instance = createInstance(undefined, events);
    ptyMock.instances[0].emitData('shared output');
    vi.advanceTimersByTime(16);

    expect(events[0]).toEqual(expect.objectContaining({ t: 'output', seq: 0 }));
    expect(events[0]).not.toHaveProperty('terminalId');
    instance.dispose();
  });

  it('sequences a shared grid before resizing and deduplicates repeats', () => {
    const events: TerminalStreamEvent[] = [];
    const instance = createInstance(undefined, events);

    instance.setGrid(42, 28, 'phone');
    instance.setGrid(42, 28, 'phone');

    expect(events).toEqual([
      expect.objectContaining({
        t: 'grid', seq: 0, cols: 42, rows: 28, controllerTerminalId: 'phone',
      }),
    ]);
    expect(events[0]).not.toHaveProperty('terminalId');
    expect(ptyMock.instances[0].resizes).toEqual([[42, 28]]);
    expect(instance.grid).toEqual({ cols: 42, rows: 28, controllerTerminalId: 'phone' });
    instance.dispose();
  });
});
