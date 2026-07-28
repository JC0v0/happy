import { describe, expect, it } from 'vitest';
import { shouldDetachSessionProcess } from './sessionSpawnOptions';

describe('session process spawning', () => {
  it('does not request an independent console on Windows', () => {
    expect(shouldDetachSessionProcess('win32')).toBe(false);
  });

  it('keeps detached session behavior on Unix platforms', () => {
    expect(shouldDetachSessionProcess('linux')).toBe(true);
    expect(shouldDetachSessionProcess('darwin')).toBe(true);
  });
});
