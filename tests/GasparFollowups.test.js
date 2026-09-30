import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadGameData } from './testData.js';
import { benchSkill, equipSkill } from '../src/engine/SkillLoadout.js';
import {
  specialCharacterRefusalText,
  speakSpecialCharacterRefusal,
} from '../src/engine/SpecialCharacterDialogue.js';
import { levelUpContent } from '../src/ui/growthContent.js';
import { levelUpLine } from '../src/engine/UnitVoice.js';
import { describeRecruitPreview } from '../src/ui/loomModel.js';
import { createBattleRng } from '../src/engine/BattleRng.js';
import { RunManager } from '../src/engine/RunManager.js';
import { normalizeUnitClassState } from '../src/engine/UnitManager.js';
import { cantoRuleFor } from '../src/engine/CantoRule.js';
import { migrateUnitTraits, rollTraits, isTraitEligible } from '../src/engine/TraitSystem.js';
import { traitLines } from '../src/ui/traitContent.js';
import { getCombatForecast } from '../src/engine/Combat.js';
import { resolveTeamAverageLevel } from '../src/engine/RecruitScaling.js';
import { resolveRecruitNodeLevel } from '../src/engine/RecruitNodeSystem.js';
import { revivalCatchUpPlan } from '../src/engine/RevivalCatchUp.js';
import { rosterClassChangeBlock, applyRosterClassChange } from '../src/engine/RosterCommands.js';
import { churchPromotionBlock } from '../src/engine/ChurchCommands.js';
import { BattleBeatsController } from '../src/ui/BattleBeatsController.js';
import { chooseDeployRoster } from './sim/RunPolicies.js';

const data = loadGameData();
data.dialogue = JSON.parse(readFileSync(new URL('../data/dialogue.json', import.meta.url)));
function start(options = {}, meta = null) {
  const run = new RunManager(data, meta);
  run.startRun({ runSeed: 1234, ...options });
  return run;
}
const gaspar = (run) => run.roster.find((unit) => unit.specialCharId);

describe('Gaspar follow-up contracts', () => {
  it('migrates legacy Canto and traits once, including repeated normalization and later earned Canto', () => {
    const run = start();
    const unit = gaspar(run);
    delete unit.specialRulesVersion;
    unit.skills = ['canto', 'aegis'];
    unit.traits = [];
    const first = RunManager.fromJSON(run.toJSON(), data);
    const g = gaspar(first);
    expect(g.skills).toEqual(['measured_step', 'aegis']);
    expect(g.traits).toEqual(['old_campaigner', 'set_in_his_ways']);
    normalizeUnitClassState(
      g,
      data.classes.find((c) => c.name === 'Paladin'),
    );
    expect(g.skills).not.toContain('canto');
    g.skills.push('canto');
    const second = RunManager.fromJSON(first.toJSON(), data);
    expect(gaspar(second).skills).toEqual(['measured_step', 'aegis', 'canto']);
    expect(cantoRuleFor(gaspar(second))).toBe('any');
    gaspar(second)._conditions = [{ id: 'root', turnsRemaining: 1 }];
    expect(cantoRuleFor(gaspar(second))).toBeNull();
  });

  it('restores descriptive traits without applying mods or letting them roll', () => {
    const unit = gaspar(start());
    const before = structuredClone(unit.stats);
    expect(traitLines(unit, data).map((row) => row.text)).toEqual([
      'Fixed promoted kit; low XP and growth. Home-base growth upgrades count half.',
      'Cannot reclass or promote again. Learns no class skills or mastery.',
    ]);
    migrateUnitTraits(unit);
    expect(unit.stats).toEqual(before);
    for (const trait of data.traits.filter((t) => t.rarity === 'special')) {
      expect(isTraitEligible(trait, unit)).toBe(true);
      expect(isTraitEligible(trait, start().roster[0])).toBe(false);
    }
    for (const rng of [() => 0, () => 0.5, () => 0.99]) {
      for (const candidate of [unit, start().roster[0]])
        expect(rollTraits(data.traits, 2, rng, candidate)).not.toEqual(
          expect.arrayContaining(['old_campaigner']),
        );
    }
  });

  it('creates current traits: migration and a real run JSON round-trip change no unit fields', () => {
    const run = start();
    const unit = gaspar(run);
    const before = structuredClone(unit);
    migrateUnitTraits(unit);
    expect(unit).toEqual(before);
    expect(gaspar(RunManager.fromJSON(JSON.parse(JSON.stringify(run.toJSON())), data))).toEqual(
      before,
    );
  });

  it.each(['promote', 'reclass'])(
    'keeps %s previews pure and chooses fresh dialogue only on an attempt',
    (effect) => {
      const run = start();
      const unit = gaspar(run);
      const item = structuredClone(data.consumables.find((c) => c.effect === effect));
      unit.consumables.push(item);
      const before = structuredClone(run.narrativeSeen);
      const line = specialCharacterRefusalText(data, unit, effect);
      for (let i = 0; i < 6; i++) {
        expect(rosterClassChangeBlock(run, unit, item, data)).toBe(line);
        if (effect === 'promote')
          expect(churchPromotionBlock(run, unit, 'church', data)).toBe(line);
      }
      expect(run.narrativeSeen).toEqual(before);
      const first = speakSpecialCharacterRefusal(data, unit, effect, run);
      expect(run.narrativeSeen).not.toEqual(before);
      expect(speakSpecialCharacterRefusal(data, unit, effect, run)).not.toBe(first);
      expect(specialCharacterRefusalText(data, unit, effect)).toBe(line);
    },
  );

  it.each([
    [{ HP: 1 }, 'blank'],
    [{ HP: 1, STR: 1 }, 'normal'],
    [{ HP: 1, STR: 1, SKL: 1 }, 'major'],
    [{ HP: 1, STR: 1, MAG: 1, SKL: 1, SPD: 1, DEF: 1, RES: 1, LCK: 1 }, 'perfect'],
  ])('selects the intended level-up pool for %j gains', (gains, pool) => {
    const unit = gaspar(start());
    const content = levelUpContent(unit, { newLevel: 2, gains });
    const quote = levelUpLine(unit, content, { voice: data.dialogue.unitVoice, seed: 1234 });
    expect(quote.source).toBe(`special:${pool}`);
    expect(data.dialogue.unitVoice.specialChars[unit.specialCharId].levelUp[pool]).toContain(
      quote.line,
    );
  });

  it('locks the fixed kit against benching and swaps while allowing an earned skill to be benched', () => {
    const unit = gaspar(start());
    unit.skills.push('sol', 'luna', 'astra');
    unit.benchedSkills = ['vantage'];
    const before = structuredClone(unit);
    for (const id of ['measured_step', 'aegis']) {
      expect(benchSkill(unit, id, data)).toBe('Personal skills can’t be benched.');
      expect(equipSkill(unit, 'vantage', id, data)).toBe('Personal skills can’t be benched.');
    }
    expect(unit).toEqual(before);
    expect(benchSkill(unit, 'sol', data)).toBe('');
    const paladin = { ...structuredClone(unit), specialCharId: undefined, skills: ['canto'] };
    expect(benchSkill(paladin, 'canto', data)).toBe('Class skills can’t be benched.');
  });

  it('passes the special trait flag to the Loom card', () => {
    const unit = gaspar(start());
    const preview = describeRecruitPreview({ unit }, { traitLines: (u) => traitLines(u, data) });
    expect(preview.traits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Campaign Veteran', special: true, legendary: false }),
        expect.objectContaining({ name: 'Set in His Ways', special: true, legendary: false }),
      ]),
    );
  });

  it('routes surviving lance chips and sword/lance kills through their own pools without touching battle RNG', () => {
    const run = start();
    const unit = gaspar(run);
    const battleRng = createBattleRng(9876);
    const rngBefore = battleRng.getState();
    const globalRandom = vi.spyOn(Math, 'random').mockImplementation(battleRng);
    try {
      const scene = { gameData: data, runManager: run, time: { now: 0 } };
      const beats = new BattleBeatsController(scene, () => 0.34);
      beats._showQuipText = vi.fn();
      const pools = data.dialogue.specialChars[unit.specialCharId];
      expect(pools.onChipLance).toContain(beats.onChipLance(unit, { currentHP: 1 }).line);
      expect(beats._showQuipText).toHaveBeenCalledTimes(1);
      scene.time.now += 10000;
      expect(beats.onChipLance(unit, { currentHP: 0 })).toBeUndefined();
      unit.weapon = unit.inventory.find((w) => w.type === 'Sword');
      expect(beats.onChipLance(unit, { currentHP: 1 })).toBeUndefined();
      beats.onKill({ isBoss: true }, unit);
      expect(pools.onKillSword).toContain(beats._showQuipText.mock.calls.at(-1)[1]);
      unit.weapon = unit.inventory.find((w) => w.type === 'Lance');
      beats.onKill({ isBoss: true }, unit);
      expect(pools.onKill).toContain(beats._showQuipText.mock.calls.at(-1)[1]);
      const rejected = new BattleBeatsController(scene, () => 0.35);
      rejected._showQuipText = vi.fn();
      rejected.onChipLance(unit, { currentHP: 1 });
      expect(rejected._showQuipText).not.toHaveBeenCalled();
      expect(battleRng.getState()).toEqual(rngBefore);
      expect(globalRandom).not.toHaveBeenCalled();
    } finally {
      globalRandom.mockRestore();
    }
  });

  it('keeps empty and veteran-only recruit and revival averages at the baseline', () => {
    const unit = gaspar(start());
    for (const roster of [[], [unit]]) {
      expect(resolveTeamAverageLevel(roster)).toBe(1);
      expect(resolveRecruitNodeLevel({ roster, enemies: data.enemies })).toBe(1);
      expect(revivalCatchUpPlan({ level: 1, tier: 'base' }, roster).targetLevel).toBe(1);
    }
  });

  it('applies real run-start Dusk meta multipliers exactly once and respects no-meta mode', () => {
    const meta = { growthBonuses: { HP: 5, STR: 3, SKL: 7 } };
    const run = start({ difficultyId: 'dusk' }, meta);
    // Dusk multiplier 0.9: round(5*.9*.5)=2, round(3*.9*.5)=1, round(7*.9*.5)=3.
    expect(gaspar(run).growths).toMatchObject({ HP: 22, STR: 11, SKL: 18 });
    expect(gaspar(start({ difficultyId: 'dusk' }, null)).growths).toMatchObject({
      HP: 20,
      STR: 10,
      SKL: 15,
    });
  });

  it('keeps the alternate commander and Vanguard party while deploying by combat value', () => {
    const run = start(
      {},
      { startingLords: { commander: 'Cael', partner: 'Kira' }, extraStartingUnitTier: 4 },
    );
    expect(run.roster).toHaveLength(4);
    expect(run.roster.find((u) => u.isCommander)?.name).toBe('Cael');
    expect(chooseDeployRoster(run.roster, 4)).toContain(gaspar(run));
    expect(
      chooseDeployRoster(run.roster, 4)
        .slice(0, 2)
        .map((u) => u.name),
    ).toEqual(['Cael', 'Kira']);
    const weak = {
      ...structuredClone(gaspar(run)),
      specialCharId: undefined,
      level: 7,
      stats: { HP: 19, STR: 7, MAG: 0, SKL: 5, SPD: 6, DEF: 3, RES: 0, LCK: 1, MOV: 5 },
    };
    expect(chooseDeployRoster([weak, gaspar(run)], 1)).toEqual([gaspar(run)]);
  });

  it.each(['promote', 'reclass'])(
    'refuses a %s seal and church promotion without spending resources',
    (effect) => {
      const run = start();
      const unit = gaspar(run);
      const item = structuredClone(data.consumables.find((c) => c.effect === effect));
      unit.consumables.push(item);
      const before = JSON.stringify(unit);
      expect(rosterClassChangeBlock(run, unit, item, data)).toMatch(/^Gaspar: /);
      expect(applyRosterClassChange(run, unit, item, { name: 'Paladin' }, data)).toMatchObject({
        ok: false,
        reason: expect.stringMatching(/^Gaspar: /),
      });
      expect(churchPromotionBlock(run, unit, 'church', data)).toMatch(/^Gaspar: /);
      expect(JSON.stringify(unit)).toBe(before);
    },
  );

  it.each([
    ['Infantry', 12],
    ['Armored', 18],
    ['Cavalry', 18],
  ])('pins might-6 Rapier forecast against %s', (moveType, damage) => {
    const attacker = structuredClone(start().roster[0]);
    attacker.stats.STR = 10;
    const rapier = data.weapons.find((w) => w.name === 'Rapier');
    const defender = {
      ...structuredClone(attacker),
      moveType,
      className:
        moveType === 'Armored' ? 'Knight' : moveType === 'Cavalry' ? 'Cavalier' : 'Myrmidon',
      stats: { ...attacker.stats, DEF: 4 },
    };
    const terrain = { name: 'Plain', defBonus: 0, avoidBonus: 0 };
    // STR10 + might6 (doubled against armor/cavalry) - DEF4; no defending weapon/triangle.
    expect(
      getCombatForecast(attacker, rapier, defender, null, 1, terrain, terrain).attacker.damage,
    ).toBe(damage);
  });

  it('speaks once at low HP, retries after a blocked attempt, and leaves the lord cooldown free', () => {
    const run = start();
    const unit = gaspar(run);
    unit.currentHP = 5;
    const scene = { gameData: data, runManager: run, time: { now: 0 } };
    const beats = new BattleBeatsController(scene, () => 0);
    beats._showQuipText = vi.fn();
    beats.onLowHealth(unit);
    beats.onLowHealth(unit);
    expect(beats._showQuipText).toHaveBeenCalledTimes(1);
    beats.onCritStrike(run.roster[0]);
    expect(beats._showQuipText).toHaveBeenCalledTimes(2);
    scene.time.now = 20000;
    beats.onLowHealth(unit);
    expect(beats._showQuipText).toHaveBeenCalledTimes(2);
    const retry = new BattleBeatsController(scene, () => 0);
    retry._showQuipText = vi.fn();
    retry.onCritStrike(run.roster[0]);
    retry.onLowHealth(unit);
    expect(retry._showQuipText).toHaveBeenCalledTimes(1);
    scene.time.now += 10000;
    retry.onLowHealth(unit);
    expect(retry._showQuipText).toHaveBeenCalledTimes(2);
  });

  it('keeps character identity literals out of gameplay and presentation modules', () => {
    const scan = (dir) =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? scan(join(dir, entry.name)) : [join(dir, entry.name)],
      );
    const offenders = scan(new URL('../src', import.meta.url).pathname).filter(
      (path) =>
        path.endsWith('.js') &&
        !/SpecialCharacters?[^/]*\.js$/.test(path) &&
        /['"]old_knight['"]/.test(readFileSync(path, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
