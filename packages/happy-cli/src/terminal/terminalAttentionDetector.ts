/** Conservative detector for interactive programs waiting at a textual prompt. */

const CSI_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const OSC_PATTERN = /\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;
const MAX_TAIL_CHARS = 512;

const ATTENTION_PATTERNS = [
  /(?:password|passphrase|pin|verification code|one[- ]time code|otp)\s*:\s*$/i,
  /(?:are you sure|continue|proceed)\??\s*(?:\[[yY]\/[nN]\]|\([yY]es\/[nN]o\))?\s*$/i,
  /(?:\[[yY]\/[nN]\]|\[[nN]\/[yY]\]|\([yY]es\/[nN]o\))\s*[:?]?\s*$/i,
  /press (?:enter|return|any key)(?: to [^\r\n]+)?\s*\.?\s*$/i,
];

function stripTerminalControls(value: string): string {
  return value
    .replace(OSC_PATTERN, '')
    .replace(CSI_PATTERN, '')
    .replace(/\r/g, '\n');
}

export class TerminalAttentionDetector {
  private tail = '';

  push(data: string): boolean {
    this.tail = (this.tail + stripTerminalControls(data)).slice(-MAX_TAIL_CHARS);
    const lastLine = this.tail.split('\n').pop()?.trimEnd() ?? '';
    return ATTENTION_PATTERNS.some((pattern) => pattern.test(lastLine));
  }

  reset(): void {
    this.tail = '';
  }
}
