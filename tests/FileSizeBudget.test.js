// Line budgets for the god objects (CLAUDE.md "God Objects & Decomposition Strategy").
//
// These files only shrink. A change that needs room in one of them extracts a controller or
// an engine module instead (BattleScene: a controller with create()/destroy(); a rule: a pure
// function in src/engine/ that the harness imports rather than copies). Raising a budget is a
// decision for the PR's reviewer, so it is made here, in the diff, with a reason beside it.
//
// When a PR shrinks one of these files, lower its budget to the new count rounded up to the
// next hundred, so the room it freed is not quietly spent again.
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');

// Tightened 2026-10-13 after #379 and #380 landed: each file's count on main rounded up to
// the next hundred, with no slack for open pull requests. A PR that needs room extracts
// first, or raises the budget here with its reason.
const BUDGETS = {
  'src/scenes/BattleScene.js': 12100,
  'src/engine/RunManager.js': 6600,
  'src/scenes/NodeMapScene.js': 2700,
  // The harness's copy of the scene's state machine: a rule moved to src/engine/ deletes
  // its copy here, it never grows a second one.
  'tests/harness/HeadlessBattle.js': 2700,
};

const lineCount = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n').length;

describe('god object line budgets', () => {
  for (const [file, budget] of Object.entries(BUDGETS)) {
    it(`${file} stays within ${budget} lines`, () => {
      const lines = lineCount(file);
      expect(
        lines,
        `${file} has ${lines} lines, over its budget of ${budget}. Extract the new flow ` +
          '(a controller, or a pure engine module) instead of growing this file.',
      ).toBeLessThanOrEqual(budget);
    });
  }
});
