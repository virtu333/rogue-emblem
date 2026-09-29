// The engine runs headless in plain Node (the harness's fuzz runner, the sims), where a
// JSON import needs an import attribute Vite does not. Grid.js once pulled the UI
// palette (uiStyles.js -> uiPalette.json) and broke `npm run test:harness:pr` in CI.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';

describe('engine modules load in plain Node', () => {
  it('Grid.js imports without Vite', () => {
    const out = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', "await import('./src/engine/Grid.js'); console.log('ok')"],
      { encoding: 'utf8' },
    );
    expect(out.trim()).toBe('ok');
  });
});
