// Kingmaker's Oath's twist (docs/specs/blessings-v3.md §6.2): "Master Seals can't be used:
// promote only at a church". Every way a Master Seal (a `promote` consumable) can promote a unit
// must ask the one rule, `TwistedBoons.classChangeItemBlock(run, item)`, and the reclass seals
// (Infantry Seal, Mounted Seal: `reclass`) must never be caught by it.
//
// The paths, each held here:
//   1. the roster sheet (bag) and the convoy's Use (MobileRosterSheet -> RosterCommands
//      .rosterClassChangeBlock / applyRosterClassChange), and the desktop overlay (RosterOverlay);
//   2. the battle's Promote command and its item menu (BattleScene.getPromotionConsumable, and
//      the menu row's reason);
//   3. the promotion itself in battle (PromotionController._executePromotion, which a seal handed
//      in directly reaches without the menu).
//
// Ways this can fail, a test each:
//   a. a path promotes with a Master Seal while the oath is held;
//   b. a reclass seal is refused by the ban;
//   c. a new file starts reading `promote` consumables without the rule (the scan), or the scan
//      is blind (an allowlist entry that no longer matches).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { PromotionController } from '../src/ui/PromotionController.js';
import { RunManager } from '../src/engine/RunManager.js';
import { twistPriceOf } from '../src/engine/EarnedBlessings.js';
import { MASTER_SEAL_BANNED, classChangeItemBlock } from '../src/engine/TwistedBoons.js';
import { rosterClassChangeBlock } from '../src/engine/RosterCommands.js';
import { createUnit } from '../src/engine/UnitManager.js';
import { createSeededRng } from '../src/engine/BlessingEngine.js';
import { loadGameData } from './testData.js';

const ROOT = join(import.meta.dirname, '..');
const data = loadGameData();

function runWith({ oath }) {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: 3, difficultyId: 'dusk', applyBlessingsAtStart: false });
  if (oath) {
    const card = data.blessings.blessings.find((b) => b.id === 'kingmakers_oath');
    expect(
      rm.addBlessingMidRun(card.id, {
        earned: true,
        price: twistPriceOf(card),
        source: 'act_boss',
      }),
    ).toBe(true);
  }
  return rm;
}
const masterSeal = () => ({
  name: 'Master Seal',
  type: 'Consumable',
  effect: 'promote',
  uses: 1,
});
function promotable(rm) {
  const unit = createUnit(
    data.classes.find((c) => c.name === 'Fighter'),
    10,
    data.weapons,
    { name: 'Test Fighter', rng: createSeededRng(7) },
  );
  unit.level = 10;
  rm.assignUnitUid(unit);
  rm.roster.push(unit);
  return unit;
}

describe('every Master Seal path asks the one rule', () => {
  it('the roster sheet and the convoy: refused with the oath, allowed without', () => {
    // Failure (a): the sheet's Promote (bag or convoy card) promotes under the oath.
    for (const oath of [true, false]) {
      const rm = runWith({ oath });
      const unit = promotable(rm);
      unit.consumables = [masterSeal()];
      const expected = oath ? MASTER_SEAL_BANNED : '';
      expect(rosterClassChangeBlock(rm, unit, unit.consumables[0], data)).toBe(expected);
      unit.consumables = [];
      rm.addToConvoy(masterSeal());
      const convoy = rm.convoy.consumables.find((c) => c.effect === 'promote');
      expect(rosterClassChangeBlock(rm, unit, convoy, data)).toBe(expected);
    }
  });

  it("the battle's Promote command and item menu: no seal is offered under the oath", () => {
    // Failure (a): the Promote command shows (and promotes) with a seal in the bag.
    for (const oath of [true, false]) {
      const rm = runWith({ oath });
      const seal = masterSeal();
      const reclass = { name: 'Infantry Seal', effect: 'reclass', subEffect: 'infantry', uses: 1 };
      const unit = { consumables: [reclass, seal] };
      const scene = { runManager: rm };
      expect(BattleScene.prototype.getPromotionConsumable.call(scene, unit)).toBe(
        oath ? null : seal,
      );
      // The reclass seal is untouched by the oath (b).
      expect(BattleScene.prototype.getReclassConsumable.call(scene, unit)).toBe(reclass);
    }
  });

  it('the promotion itself refuses a seal handed in directly, and spends nothing', async () => {
    // Failure (a): the item menu's Use reaches executePromotion with the seal, which promotes.
    const rm = runWith({ oath: true });
    const seal = masterSeal();
    const unit = {
      name: 'Test',
      className: 'Fighter',
      tier: 'base',
      level: 10,
      proficiencies: [],
      inventory: [],
      consumables: [seal],
    };
    const scene = {
      _battleSession: 1,
      runManager: rm,
      gameData: data,
      battleState: 'UNIT_ACTION_MENU',
      showActionMenu: vi.fn(),
      showBriefBanner: vi.fn(async () => {}),
      sys: { isActive: () => true },
    };
    const controller = new PromotionController(scene);
    expect(await controller.executePromotion(unit, seal)).toBe(false);
    expect(scene.showBriefBanner).toHaveBeenCalledWith(MASTER_SEAL_BANNED, expect.anything());
    expect(seal.uses).toBe(1);
    expect(unit.className).toBe('Fighter');
  });

  it('the reclass seals are never the ban: Infantry Seal and Mounted Seal pass', () => {
    // Failure (b): the rule keys on "a seal" instead of a Master Seal's effect.
    const rm = runWith({ oath: true });
    const reclass = data.consumables.filter((c) => c.effect === 'reclass');
    expect(reclass.map((c) => c.name).sort()).toEqual(['Infantry Seal', 'Mounted Seal']);
    for (const item of reclass) expect(classChangeItemBlock(rm, item), item.name).toBe('');
    const promote = data.consumables.filter((c) => c.effect === 'promote');
    expect(promote.length).toBeGreaterThan(0);
    for (const item of promote) expect(classChangeItemBlock(rm, item), item.name).not.toBe('');
  });
});

// ── The scan ───────────────────────────────────────────────────────────────

function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(js|mjs)$/.test(name)) out.push(path);
  }
  return out;
}
const rel = (path) => relative(ROOT, path).replaceAll('\\', '/');
/** Blank out comments so prose never counts. */
const stripComments = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\'"`])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));

// Code that reads a consumable's `promote` effect (or the item paths that pass one on).
const READS_PROMOTE_ITEM = /effect\s*[!=]==\s*'promote'|\[\s*'promote'\s*,\s*'reclass'\s*\]/;

// Each file that reads a `promote` consumable, with what holds it to the rule: a gate (the file
// must call `needs`) or the reason it needs none.
const PATHS = {
  'src/engine/TwistedBoons.js': { needs: null, why: 'defines the rule' },
  'src/engine/RosterCommands.js': {
    needs: 'classChangeItemBlock',
    why: 'rosterClassChangeBlock: the roster sheet, the convoy and the overlay all apply through it',
  },
  'src/ui/MobileRosterSheet.js': {
    needs: 'rosterClassChangeBlock',
    why: 'the bag card and the convoy card ask RosterCommands before they offer Promote',
  },
  'src/ui/RosterOverlay.js': {
    needs: 'classChangeItemBlock',
    why: 'the desktop [Use] is hidden and _usePromote refuses before applyRosterClassChange',
  },
  'src/scenes/BattleScene.js': {
    needs: 'classChangeItemBlock',
    why: 'getPromotionConsumable (the Promote command, the item menu) and the menu row reason',
  },
  'src/ui/PromotionController.js': {
    needs: 'classChangeItemBlock',
    why: '_executePromotion: a seal handed in directly',
  },
  'src/ui/LootScreenController.js': { needs: null, why: "display only: a seal card's words" },
  'src/ui/rewardDisplay.js': { needs: null, why: "display only: the reward card's category" },
  'src/ui/classChangeDisplay.js': { needs: null, why: 'display only: Promote or Reclass labels' },
  'src/engine/LootSystem.js': { needs: null, why: "a loot card's category" },
  'src/engine/SpecialCharacterDialogue.js': {
    needs: null,
    why: "a special character's refusal line, read beside the rule",
  },
  'src/utils/consumableText.js': { needs: null, why: "display only: the seal's description" },
  'tests/harness/HeadlessBattle.js': {
    needs: null,
    why: 'lists Promote as an unsupported action: the harness never promotes',
  },
};

describe('the scan: every file that reads a Master Seal is listed with its gate', () => {
  const files = [
    ...sourceFiles(join(ROOT, 'src')),
    ...sourceFiles(join(ROOT, 'tests/harness')),
    ...sourceFiles(join(ROOT, 'sim')),
  ];
  const readers = files
    .filter((path) => READS_PROMOTE_ITEM.test(stripComments(readFileSync(path, 'utf8'))))
    .map(rel)
    .sort();

  it('no file reads a promote consumable without being listed (a new path is a test failure)', () => {
    expect(readers.filter((file) => !(file in PATHS))).toEqual([]);
  });

  it('each listed path still reads one (no stale entry) and calls its gate', () => {
    expect(Object.keys(PATHS).sort()).toEqual(readers);
    for (const [file, { needs }] of Object.entries(PATHS)) {
      if (!needs) continue;
      const text = stripComments(readFileSync(join(ROOT, file), 'utf8'));
      expect(text.includes(`${needs}(`), `${file} calls ${needs}`).toBe(true);
    }
  });

  it("BattleScene's item menu names the ban as the row's reason", () => {
    // Failure (a): the row is disabled with "Promotion unavailable", hiding why.
    const text = stripComments(readFileSync(join(ROOT, 'src/scenes/BattleScene.js'), 'utf8'));
    expect(text).toMatch(/isPromote && !canUsePromote\s*\?\s*classChangeItemBlock\(/);
  });
});
