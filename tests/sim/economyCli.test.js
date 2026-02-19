import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const economyScriptPath = join(__dirname, '..', '..', 'sim', 'economy.js');

describe('sim/economy CLI', () => {
  it('runs successfully for meta tiers 0/1/2/3', () => {
    for (const meta of [0, 1, 2, 3]) {
      const result = spawnSync(
        process.execPath,
        [economyScriptPath, '--trials', '2', '--seed', '1', '--meta', String(meta)],
        { encoding: 'utf8' },
      );
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`meta=${meta}`);
      expect(result.stdout).toContain('Promotion affordable (by Act 2 end):');
    }
  });
});
