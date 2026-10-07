// The Phase 2B burdens and the Dark Omen on their surfaces (docs/specs/event-nodes-phase2.md §2B):
// the chips under the Loom's header and the pause menu's list.
//
// Ways this can fail, a test each:
//   1. a new burden is on the run and no chip says it, or the chip's number is not the run's;
//   2. the pause list hides it;
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeDom } from './helpers/fakeDom.js';
import { _resetInputFocus } from '../src/utils/inputFocus.js';
import { NodeMapMenu } from '../src/ui/NodeMapMenu.js';
import { pauseBurdenList } from '../src/ui/MobilePauseMenu.js';
import { describeBurdens } from '../src/engine/Burdens.js';
import { addUnit, newRun } from './eventKit.js';

function hunted(run) {
  const unit = addUnit(run, 'Archer', { name: 'Hale' });
  run.burdens = [
    { id: 'hunted', battles: 2, wave: { turn: 3, count: [1, 2], xpMultiplier: 0.5 } },
    { id: 'sworn_enemy' },
    { id: 'wounded', unitUid: unit.unitUid, unitName: 'Hale', stat: 'SKL', value: -2, battles: 3 },
  ];
  return run;
}

describe('the chips and the pause list', () => {
  let dom;
  beforeEach(() => {
    vi.useFakeTimers();
    dom = installFakeDom(vi);
    _resetInputFocus();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    _resetInputFocus();
  });

  it("one chip per burden, with the run's own figures", () => {
    const run = hunted(newRun());
    const row = NodeMapMenu.prototype._burdenRow.call({
      _burdenOpen: null,
      scene: { runManager: run, gameData: run.gameData },
    });
    const chips = row.querySelectorAll('.re-burden');
    expect(chips.map((c) => c.dataset.burden)).toEqual(['hunted', 'sworn_enemy', 'wounded']);
    expect(chips.map((c) => c.textContent)).toEqual([
      'Hunted2 left',
      'Sworn EnemyBoss',
      'WoundedHale −2 SKL',
    ]);
    expect(dom).toBeTruthy();
  });

  it('the pause menu lists them with their lines and counts', () => {
    const run = hunted(newRun());
    const items = pauseBurdenList(describeBurdens(run)).querySelectorAll('li');
    expect(items.map((i) => i.querySelector('strong').textContent)).toEqual([
      'Hunted · 2 left',
      'Sworn Enemy · Boss',
      'Wounded · Hale −2 SKL',
    ]);
    expect(items[0].querySelector('span').textContent).toContain(
      '2 battles left: an extra wave of 1–2 foes on turn 3, boss maps spared.',
    );
    expect(items[1].querySelector('span').textContent).toContain(
      'the act boss carries an extra affix until it falls.',
    );
    expect(items[2].querySelector('span').textContent).toContain(
      'Hale fights at −2 SKL, 3 battles left; a church heal ends it.',
    );
  });
});
