import type { TerminalCommandBlock, TerminalCommandState } from './terminalCommandState';

export interface TerminalTranscriptDecodeResult {
    text: string;
    rawPreferred: boolean;
}

type EscapeState = 'text' | 'escape' | 'csi' | 'osc' | 'osc-escape';

/**
 * Streaming UTF-8/ANSI decoder used by the semantic Block transcript.
 * xterm still receives the original bytes; this decoder only creates a safe,
 * selectable plain-text projection for the Block UI.
 */
export class TerminalTranscriptDecoder {
    private readonly decoder = new TextDecoder();
    private escapeState: EscapeState = 'text';
    private alternateScreenProbe = '';

    push(bytes: Uint8Array): TerminalTranscriptDecodeResult {
        const decoded = this.decoder.decode(bytes, { stream: true });
        const probe = (this.alternateScreenProbe + decoded).slice(-48);
        const rawPreferred = /\x1b\[\?(?:47|1047|1049)h/.test(this.alternateScreenProbe + decoded);
        this.alternateScreenProbe = probe;

        let text = '';
        for (const character of decoded) {
            const code = character.charCodeAt(0);
            if (this.escapeState === 'text') {
                if (code === 0x1b) {
                    this.escapeState = 'escape';
                } else if (character === '\n' || character === '\r' || character === '\t' || character === '\b' || code >= 0x20) {
                    text += character;
                }
            } else if (this.escapeState === 'escape') {
                if (character === '[') {
                    this.escapeState = 'csi';
                } else if (character === ']') {
                    this.escapeState = 'osc';
                } else {
                    this.escapeState = 'text';
                }
            } else if (this.escapeState === 'csi') {
                if (code >= 0x40 && code <= 0x7e) {
                    this.escapeState = 'text';
                }
            } else if (this.escapeState === 'osc') {
                if (code === 0x07) {
                    this.escapeState = 'text';
                } else if (code === 0x1b) {
                    this.escapeState = 'osc-escape';
                }
            } else if (character === '\\') {
                this.escapeState = 'text';
            } else if (code !== 0x1b) {
                this.escapeState = 'osc';
            }
        }
        return { text, rawPreferred };
    }

    reset(): void {
        this.decoder.decode();
        this.escapeState = 'text';
        this.alternateScreenProbe = '';
    }
}

function terminalLines(text: string): string[] {
    const lines: string[] = [];
    let line: string[] = [];
    let cursor = 0;
    const commit = () => {
        lines.push(line.join('').replace(/\s+$/u, ''));
        line = [];
        cursor = 0;
    };

    for (let index = 0; index < text.length; index++) {
        const character = text[index];
        if (character === '\r') {
            if (text[index + 1] === '\n') {
                index++;
                commit();
            } else {
                cursor = 0;
            }
        } else if (character === '\n') {
            commit();
        } else if (character === '\b') {
            cursor = Math.max(0, cursor - 1);
        } else if (character === '\t') {
            const spaces = 4 - (cursor % 4);
            for (let offset = 0; offset < spaces; offset++) {
                line[cursor++] = ' ';
            }
        } else {
            line[cursor++] = character;
        }
    }
    if (line.length > 0) {
        commit();
    }
    return lines;
}

function isEchoedCommand(line: string, command: string): boolean {
    const value = line.trim();
    const target = command.trim();
    if (!target) {
        return false;
    }
    if (value === target) {
        return true;
    }
    if (!value.endsWith(target)) {
        return false;
    }
    const prefix = value.slice(0, -target.length).trim();
    return /^PS\s.+?>\s*/iu.test(value)
        || /^[^\s]+[$#>]\s*/u.test(value)
        || (prefix.length > 0 && target.startsWith(prefix));
}

export function terminalBlockOutputText(block: TerminalCommandBlock): string {
    const lines = terminalLines(block.output);
    while (lines.length > 0 && lines[0].trim() === '') {
        lines.shift();
    }
    if (lines.length > 0 && isEchoedCommand(lines[0], block.command)) {
        lines.shift();
    }
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
        lines.pop();
    }
    if (block.outputTruncated) {
        lines.unshift('… earlier output truncated …');
    }
    return lines.join('\n');
}

export function terminalTranscriptText(state: TerminalCommandState): string {
    return state.blocks.map((block) => {
        const output = terminalBlockOutputText(block);
        return output ? `$ ${block.command}\n${output}` : `$ ${block.command}`;
    }).join('\n\n');
}
