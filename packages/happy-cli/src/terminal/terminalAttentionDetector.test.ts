import { describe, expect, it } from 'vitest';
import { TerminalAttentionDetector } from './terminalAttentionDetector';

describe('TerminalAttentionDetector', () => {
  it('recognizes password, confirmation and press-enter prompts', () => {
    const detector = new TerminalAttentionDetector();
    expect(detector.push('Password:')).toBe(true);
    detector.reset();
    expect(detector.push('Are you sure? [y/N]')).toBe(true);
    detector.reset();
    expect(detector.push('Press Enter to continue')).toBe(true);
  });

  it('handles prompts split across chunks and ignores ANSI styling', () => {
    const detector = new TerminalAttentionDetector();
    expect(detector.push('\u001b[33mPass')).toBe(false);
    expect(detector.push('phrase:\u001b[0m')).toBe(true);
  });

  it('does not classify ordinary output as input requests', () => {
    const detector = new TerminalAttentionDetector();
    expect(detector.push('Build completed successfully\r\n')).toBe(false);
    expect(detector.push('password policy loaded\r\n')).toBe(false);
    expect(detector.push('Continue processing 100 records')).toBe(false);
  });
});
