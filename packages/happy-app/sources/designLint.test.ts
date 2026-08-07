import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Design-system lint. Scans component/screen sources for violations of the
 * rules documented in `docs/design-system.md`:
 *
 *  1. No hardcoded hex colors in component code (use theme.semantic tokens).
 *  2. Corner radii must come from the geometry scale {0, 2, 4, 999}.
 *  3. Screens never set raw title font sizes (>= 17); use ui/text variants.
 *
 * The dev sandbox (`app/(app)/dev/**`) is exempt by design.
 */

const SOURCES_ROOT = path.resolve(__dirname);

/** Files that legitimately own raw palettes (art, syntax, QR, HTML, webview JS). */
const HEX_ALLOWLIST: ReadonlyArray<string> = [
    'app/+html.tsx',
    'app/_layout.tsx', // Android notification LED colors (platform config, not UI)
    'components/Avatar.tsx',
    'components/AvatarBrutalist.tsx',
    'components/AvatarGradient.tsx',
    'components/AvatarSkia.tsx',
    'components/AvatarSkia.web.tsx',
    'components/CodeEditor.web.tsx',
    'components/FileIcon.tsx',
    'components/qr/QRCode.tsx',
    'components/qr/QRCode.web.tsx',
    'components/markdown/MermaidRenderer.tsx',
    '-session/terminal/SessionTerminalView.tsx',
];

const ALLOWED_RADII = new Set([0, 2, 4, 999]);

function collectTsxFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...collectTsxFiles(full));
        } else if (entry.name.endsWith('.tsx')) {
            out.push(full);
        }
    }
    return out;
}

function rel(file: string): string {
    return path.relative(SOURCES_ROOT, file).split(path.sep).join('/');
}

function isDevSandbox(file: string): boolean {
    return rel(file).startsWith('app/(app)/dev/');
}

function isScreen(file: string): boolean {
    const r = rel(file);
    return r.startsWith('app/') || r === '-session/SessionView.tsx';
}

const tsxFiles = collectTsxFiles(SOURCES_ROOT).filter((f) => !isDevSandbox(f));

function violationsFor(file: string, pattern: RegExp, reject: (match: RegExpExecArray) => string | null): string[] {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    const violations: string[] = [];
    lines.forEach((line, index) => {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(line)) !== null) {
            const reason = reject(match);
            if (reason) {
                violations.push(`${rel(file)}:${index + 1} ${reason} -> ${line.trim()}`);
            }
        }
    });
    return violations;
}

describe('design lint', () => {
    it('finds source files to scan', () => {
        expect(tsxFiles.length).toBeGreaterThan(50);
    });

    it('forbids hardcoded hex colors outside palette-owning files', () => {
        const violations: string[] = [];
        for (const file of tsxFiles) {
            if (HEX_ALLOWLIST.includes(rel(file))) {
                continue;
            }
            violations.push(
                ...violationsFor(file, /#[0-9a-fA-F]{3,8}\b/g, (match) => `hardcoded color ${match[0]}`),
            );
        }
        expect(violations).toEqual([]);
    });

    it('restricts corner radii to the geometry scale {0, 2, 4, 999}', () => {
        const violations: string[] = [];
        for (const file of tsxFiles) {
            violations.push(
                ...violationsFor(file, /borderRadius:\s*(\d+(?:\.\d+)?)/g, (match) =>
                    ALLOWED_RADII.has(Number(match[1])) ? null : `off-scale radius ${match[1]}`,
                ),
            );
        }
        expect(violations).toEqual([]);
    });

    it('forbids raw title font sizes (>= 17) in screens', () => {
        const violations: string[] = [];
        for (const file of tsxFiles.filter(isScreen)) {
            violations.push(
                ...violationsFor(file, /fontSize:\s*(\d+(?:\.\d+)?)/g, (match) =>
                    Number(match[1]) >= 17 ? `raw title fontSize ${match[1]} (use ui/text variants)` : null,
                ),
            );
        }
        expect(violations).toEqual([]);
    });
});
