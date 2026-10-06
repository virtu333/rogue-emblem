import { describe, it, expect } from 'vitest';
import config, { BUILD_TARGET } from '../vite.config.js';
import { prologueWasWon } from '../src/ui/PrologueEnding.js';

// The unit suite runs src through the build's syntax lowering. Without it a transpile
// bug ships green: the prologue's end threw `o is not defined` in every browser while
// every unit test passed on the untranspiled source.
describe('unit tests run the code the build ships', () => {
  it('the build and the test transform lower to the same targets', () => {
    const resolved = config({ command: 'build', mode: 'production' });
    expect(resolved.build.target).toBe(BUILD_TARGET);
    expect(resolved.esbuild?.target).toBe(BUILD_TARGET);
    expect('x.js').not.toMatch(resolved.esbuild.include);
    expect('/repo/src/ui/PrologueEnding.js').toMatch(resolved.esbuild.include);
  });

  it('src arrives lowered (optional chaining rewritten for the Chrome 87 target)', () => {
    // The source reads `runManager?.nodeMap?.nodes`; lowered, no `?.` survives.
    expect(prologueWasWon.toString()).not.toContain('?.');
  });
});
