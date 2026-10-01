import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadGameData } from './testData.js';
import { RunManager } from '../src/engine/RunManager.js';
import { createVeteranKnight } from '../src/engine/SpecialCharacters.js';
import {
  canReclass,
  getReclassTargets,
  reclassUnit,
  promoteUnit,
  checkLevelUpSkills,
  learnSkill,
  calculateCombatXP,
  applyStatBoost,
  canEquip,
} from '../src/engine/UnitManager.js';
import { recordBattleParticipation, getMasteryCombatMods } from '../src/engine/MasterySystem.js';
import { resolveRecruitNodeLevel } from '../src/engine/RecruitNodeSystem.js';
import { resolveTeamAverageLevel } from '../src/engine/RecruitScaling.js';
import { revivalCatchUpPlan } from '../src/engine/RevivalCatchUp.js';
import { applyRosterClassChange } from '../src/engine/RosterCommands.js';
import { completeResolvedAction } from '../src/ui/BattlePresentationCheckpoint.js';
import { readActionContinuation } from '../src/engine/ActionContinuation.js';
import { getXpShareRecipients, calculateSharedXp } from '../src/engine/XpShare.js';
import { mergeRunRecords } from '../src/engine/RunRecords.js';
import { levelUpLine, fallenLine, temperamentFor } from '../src/engine/UnitVoice.js';
import { specialCharacterEntries } from '../src/engine/SpecialCharacterDialogue.js';
import { portraitIdForUnit, rebuiltPortraitUrl } from '../src/ui/portraitArt.js';
import { battleUnitSpriteKey } from '../src/ui/BattleUnitVisuals.js';
import { applyForge } from '../src/engine/ForgeSystem.js';

const data = loadGameData();
data.dialogue = JSON.parse(readFileSync(new URL('../data/dialogue.json', import.meta.url)));
const veteran = (run) => run.roster.find((u) => u.specialCharId === 'old_knight');
const start = (difficultyId = 'normal', meta = null, options = {}) => {
  const run = new RunManager(data, meta);
  run.startRun({ runSeed: 1234, difficultyId, ...options });
  return run;
};

describe('Gaspar starter and investment rules', () => {
  it('joins ordinary and fast-path runs on every difficulty, but not the tutorial', () => {
    for (const [difficultyId, hp, def] of [
      ['normal', 18, 6],
      ['dusk', 19, 6],
      ['hard', 20, 7],
      ['lunatic', 21, 8],
    ]) {
      const run = start(difficultyId, null, { firstRunFastPath: true });
      const unit = veteran(run);
      assert.equal(run.roster.length, 3);
      assert.equal(unit.isLord, false);
      assert.equal(unit.tier, 'promoted');
      assert.equal(unit.stats.HP, hp);
      assert.equal(unit.stats.DEF, def);
      assert.equal(unit.stats.STR, 10);
      assert.equal(unit.stats.SKL, 12);
      assert.equal(unit.stats.MOV, 6);
      assert.equal(unit.weapon.name, 'Steel Lance');
      assert.deepEqual(
        unit.inventory.map((w) => w.name),
        ['Steel Lance', 'Iron Sword'],
      );
      assert.ok(unit.proficiencies.every((p) => p.rank === 'Mast'));
      assert.deepEqual(unit.skills, ['measured_step', 'aegis']);
    }
    assert.equal(veteran(start()).name, 'Gaspar');
  });

  it('stacks with Vanguard and bypasses recruit flat bonuses and join perks', () => {
    const run = start('normal', {
      extraStartingUnitTier: 4,
      statBonuses: { HP: 10, DEF: 4 },
      recruitRandomSkill: true,
      recruitStartingVulnerary: 1,
      recruitWeaponForge: 3,
    });
    assert.equal(run.roster.length, 4);
    assert.equal(veteran(run).stats.HP, 18);
    assert.equal(veteran(run).stats.DEF, 6);
    assert.equal(veteran(run).consumables.length, 0);
    assert.equal(veteran(run).inventory[0]._forgeHistory, undefined);
  });

  it('rounds home-base growth bonuses only once after both multipliers', () => {
    const unit = createVeteranKnight(data, {
      metaGrowthBonuses: { STR: 3, HP: 5 },
      growthMultiplier: 0.5,
    });
    assert.equal(unit.growths.STR, 11);
    assert.equal(unit.growths.HP, 21);
    const base = createVeteranKnight(data);
    assert.equal(
      Object.values(base.growths).reduce((sum, n) => sum + n, 0),
      70,
    );
  });

  it('applies positive blessings, pact costs, forging and boosters as ordinary in-run investments', () => {
    const run = start();
    const unit = veteran(run);
    run._applySingleRunStartBlessingEffect('test', {
      type: 'run_start_max_hp_bonus',
      params: { scope: 'recruits', value: 3 },
    });
    assert.equal(unit.stats.HP, 21);
    run._applySingleRunStartBlessingEffect('test', {
      type: 'run_start_max_hp_bonus',
      params: { scope: 'all', value: -2 },
    });
    assert.equal(unit.stats.HP, 19);
    assert.equal(applyForge(unit.weapon, 'might').success, true);
    applyStatBoost(unit, { stat: 'STR', value: 2 });
    assert.equal(unit.stats.STR, 12);
    const rapier = data.weapons.find((w) => w.name === 'Rapier');
    assert.equal(rapier.might, 6);
    assert.equal(canEquip(unit, rapier), true);
  });

  it('cannot reclass or consume a seal, while earned scroll skills remain available', () => {
    const run = start();
    const unit = veteran(run);
    const seal = structuredClone(
      data.consumables.find((item) => item.effect === 'reclass' && item.subEffect === 'mounted'),
    );
    unit.consumables.push(seal);
    const before = JSON.stringify(unit);
    const target = data.classes.find((cls) => cls.name === 'Wyvern Lord');
    assert.equal(canReclass(unit), false);
    assert.deepEqual(getReclassTargets(unit, data.classes, 'mounted'), []);
    assert.equal(applyRosterClassChange(run, unit, seal, target, data).ok, false);
    reclassUnit(
      unit,
      target,
      data.classes.find((cls) => cls.name === 'Paladin'),
      data.classes,
      data.skills,
    );
    promoteUnit(
      unit,
      data.classes.find((cls) => cls.name === 'Paladin'),
      { HP: 10, STR: 10 },
      data.skills,
    );
    assert.equal(JSON.stringify(unit), before);
    unit.level = 20;
    assert.deepEqual(checkLevelUpSkills(unit, data.classes), []);
    assert.equal(learnSkill(unit, 'sol').learned, true);
    recordBattleParticipation(unit);
    unit.classBattles = { Paladin: 99 };
    assert.deepEqual(getMasteryCombatMods(unit, data.classes), { mods: {}, activated: null });
    const loaded = RunManager.fromJSON(run.toJSON(), data);
    assert.ok(veteran(loaded).skills.includes('sol'));
    assert.ok(!veteran(loaded).skills.includes('ride_down'));
  });

  it('round-trips identity, investments and old Rapier snapshots without injecting old saves', () => {
    const run = start();
    const unit = veteran(run);
    unit.growths.STR += 10;
    const oldRapier = {
      ...data.weapons.find((w) => w.name === 'Rapier'),
      might: 9,
      _forgeHistory: [{ stat: 'might', delta: 2 }],
    };
    unit.inventory.push(oldRapier);
    const loaded = RunManager.fromJSON(run.toJSON(), data);
    assert.equal(veteran(loaded).growths.STR, unit.growths.STR);
    assert.equal(veteran(loaded).inventory.find((w) => w.name === 'Rapier').might, 9);
    assert.equal(veteran(loaded).specialCharId, 'old_knight');
    const oldSave = run.toJSON();
    oldSave.roster = oldSave.roster.filter((u) => !u.specialCharId);
    assert.equal(veteran(RunManager.fromJSON(oldSave, data)), undefined);
  });
});

describe('Gaspar scaling and combat completion', () => {
  it('does not inflate recruit-node or revival targets, and can still catch up himself', () => {
    const run = start();
    assert.equal(resolveRecruitNodeLevel({ roster: run.roster, enemies: data.enemies }), 1);
    assert.equal(resolveTeamAverageLevel(run.roster), 1);
    const fallen = { level: 1, tier: 'base' };
    assert.equal(revivalCatchUpPlan(fallen, run.roster).targetLevel, 1);
    const unit = veteran(run);
    assert.equal(
      revivalCatchUpPlan(unit, [{ level: 18, tier: 'base', currentHP: 10 }]).targetLevel,
      6,
    );
  });

  it('keeps normal promoted XP and Mentor sharing to lower effective levels', () => {
    const run = start();
    const unit = veteran(run);
    const edric = run.roster[0];
    unit.col = 0;
    unit.row = 0;
    edric.col = 1;
    edric.row = 0;
    const opponent = { level: 2, tier: 'base' };
    assert.equal(calculateCombatXP(unit, opponent, true), 1);
    assert.deepEqual(getXpShareRecipients(unit, run.roster), [edric]);
    // Level-1 Edric versus a level-2 foe: floor((25 combat + 15 kill + 5 level gap) / 2).
    assert.equal(calculateSharedXp(edric, opponent, true, 0.5), 22);
    edric.tier = 'promoted';
    assert.deepEqual(getXpShareRecipients(unit, [edric]), []);
  });

  it('blocks Canto on committed combat, including saved continuations, but permits noncombat and fresh activations', () => {
    const unit = veteran(start());
    let options;
    const scene = {
      _battleSession: 1,
      playerUnits: [unit],
      checkBattleEnd: () => false,
      finishUnitAction: (_, value) => {
        options = value;
      },
    };
    const saved = readActionContinuation(
      JSON.parse(JSON.stringify({ kind: 'combat', unitName: unit.name })),
    );
    completeResolvedAction(scene, saved, { session: scene._battleSession });
    assert.equal(options.skipCanto, true);
    completeResolvedAction(
      scene,
      { kind: 'finish', unitName: unit.name, skipCanto: true },
      { session: scene._battleSession },
    );
    assert.equal(options.skipCanto, true);
    unit.hasActed = false; // Dance or the next player activation.
    completeResolvedAction(
      scene,
      { kind: 'finish', unitName: unit.name },
      { session: scene._battleSession },
    );
    assert.equal(options.skipCanto, false);
    delete unit.specialCharId;
    completeResolvedAction(scene, saved, { session: scene._battleSession });
    assert.equal(options.skipCanto, true); // Measured Step owns the rule.
    unit.skills = ['canto'];
    completeResolvedAction(scene, saved, { session: scene._battleSession });
    assert.equal(options.skipCanto, false);
  });
});

describe('Gaspar voice, assets and no-meta records', () => {
  it('uses a stable personal portrait, mounted sprite and voice without entering lord pools', () => {
    const unit = veteran(start());
    assert.equal(portraitIdForUnit(unit, data), 'special_old_knight');
    assert.ok(
      rebuiltPortraitUrl('special_old_knight', 'pc98').endsWith('/192/special_old_knight.png'),
    );
    const scene = { textures: { exists: (key) => key === 'traced-special_old_knight' } };
    assert.equal(battleUnitSpriteKey(scene, unit), 'traced-special_old_knight');
    const voice = data.dialogue.unitVoice;
    assert.equal(temperamentFor(unit, { voice, seed: 99 }), 'wry');
    assert.ok(levelUpLine(unit, { kind: 'normal', levelTo: '2' }, { voice, seed: 99 }).line);
    assert.ok(voice.specialChars.old_knight.fallen.includes(fallenLine(unit, { voice, seed: 99 })));
    assert.equal(specialCharacterEntries(data, unit, 'intro')[0].speaker, 'Gaspar');
    assert.ok(!data.lords.some((lord) => lord.name === 'Gaspar'));
  });

  it('preserves the explicit no-meta flag and special portrait identity through record merges', () => {
    const record = {
      id: 'win',
      endedAt: 1,
      difficulty: 'lunatic',
      noMetaMode: true,
      roster: [veteran(start())],
    };
    const merged = mergeRunRecords([record]);
    assert.equal(merged[0].noMetaMode, true);
    assert.equal(merged[0].difficulty, 'lunatic');
    assert.equal(merged[0].roster[0].specialCharId, 'old_knight');
    assert.deepEqual(mergeRunRecords(JSON.parse(JSON.stringify(merged))), merged);
    assert.equal(mergeRunRecords([{ ...record, noMetaMode: undefined }])[0].noMetaMode, undefined);
    assert.equal(mergeRunRecords([{ ...record, noMetaMode: 'true' }])[0].noMetaMode, undefined);
  });

  it('records no-meta victories exactly once even without Gaspar, and never records defeats', () => {
    for (const result of ['victory', 'defeat']) {
      const run = start();
      run.noMetaMode = true;
      run.roster = run.roster.filter((u) => !u.specialCharId);
      run.actIndex = 3;
      const records = [];
      const meta = {
        addValor() {},
        addSupply() {},
        incrementRunsCompleted() {},
        recordMilestone() {},
        hasMilestone: () => false,
        recordRunEnd: (value) => records.push(value),
      };
      run.settleEndRunRewards(meta, result);
      run.settleEndRunRewards(meta, result);
      assert.equal(records.length, 1);
      assert.equal(records[0].result, result);
      if (result === 'victory') assert.equal(records[0].victoryRecord.noMetaMode, true);
      else assert.equal(records[0].victoryRecord, null);
    }
  });
});
