import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { prepareHostAgent } = require('./unpack-tools.cjs') as {
  prepareHostAgent: (toolsDir: string) => void;
};

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('prepareHostAgent', () => {
  it.skipIf(process.platform === 'win32')(
    'restores executable permissions removed by npm pack',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'happy-host-agent-mode-'));
      temporaryDirectories.push(root);
      const binary = join(
        root,
        'host-agent',
        `${process.platform}-${process.arch}`,
        'happy-host-agent',
      );
      mkdirSync(dirname(binary), { recursive: true });
      writeFileSync(binary, 'test');
      chmodSync(binary, 0o644);

      prepareHostAgent(root);

      expect(statSync(binary).mode & 0o777).toBe(0o755);
    },
  );
});
