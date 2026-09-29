// Sniper buffs are for the player's Snipers only (playtest 2026-09-29, triage row 8):
// Onslaught as a level-1 class skill, and a Recurve Bow for a recruited Sniper.
// Ways it can go wrong, each caught below:
//   - a unit that promotes into Sniper (church, Sovereign Seal) never learns Onslaught,
//     because promotion lands on level 1 and nothing checks level-1 class skills;
//   - an enemy Sniper learns it (map enemies, Colosseum challengers);
//   - a recruited Sniper still arrives with the Longbow, or without the Recurve equipped;
//   - an enemy Sniper's weapons change;
//   - a Sniper from an old save never gets it (load migration).
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPromotedEnemyUnit,
  createRecruitUnit,
  knowsSkill,
  promoteUnit,
} from '../src/engine/UnitManager.js';
import { buildRecruitNodeUnit } from '../src/engine/RecruitNodeSystem.js';
import { generateBossRecruitCandidates } from '../src/engine/BossRecruitSystem.js';
import { generateChallenger } from '../src/engine/ColosseumEngine.js';
import { promoteAtChurch } from '../src/engine/ChurchCommands.js';
import { applyRosterClassChange } from '../src/engine/RosterCommands.js';
import { RunManager } from '../src/engine/RunManager.js';
import { MAX_SKILLS } from '../src/utils/constants.js';
import { promotionPathContent } from '../src/ui/growthContent.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const cls = (name) => data.classes.find((c) => c.name === name);
const sniper = cls('Sniper');
afterEach(() => vi.restoreAllMocks());

function archer(level = 10) {
  const unit = createRecruitUnit({ name: 'Wil', level }, cls('Archer'), data.weapons, null, null, null, data.classes, { skillsData: data.skills }); // prettier-ignore
  unit.faction = 'player';
  return unit;
}

describe('Sniper: Onslaught from level 1, for the player only', () => {
  it('the class data teaches death_blow at level 1', () => {
    expect(sniper.learnableSkills).toEqual([{ skillId: 'death_blow', level: 1 }]);
  });

  it('a church promotion into Sniper learns Onslaught at once', () => {
    const run = new RunManager(data);
    run.gold = 10000;
    const unit = archer();
    run.roster = [unit];
    expect(knowsSkill(unit, 'death_blow')).toBe(false);
    expect(promoteAtChurch(run, unit, 'church-1', sniper, data).ok).toBe(true);
    expect(unit.className).toBe('Sniper');
    expect(unit.level).toBe(1);
    expect(unit.skills).toContain('death_blow');
  });

  it('a Sovereign Seal promotion into Sniper learns it, and the rite shows it', () => {
    const unit = archer();
    const content = promotionPathContent(unit, sniper, data);
    expect(content.skills.map((s) => s.id)).toContain('death_blow');
    const seal = structuredClone(data.consumables.find((c) => c.effect === 'promote'));
    unit.consumables = [seal];
    const result = applyRosterClassChange({ roster: [unit], convoy: {} }, unit, seal, sniper, data);
    expect(result.ok).toBe(true);
    expect(unit.skills).toContain('death_blow');
  });

  it('at the skill cap it waits on the bench and is reported', () => {
    const unit = archer();
    unit.skills = Array.from({ length: MAX_SKILLS }, (_, i) => `held-${i}`);
    const result = promoteUnit(unit, sniper, sniper.promotionBonuses, data.skills);
    expect(unit.skills).not.toContain('death_blow');
    expect(unit.benchedSkills).toContain('death_blow');
    expect(result.droppedSkills).toContain('death_blow');
  });

  it('the other promotion (Bow Knight) does not teach it', () => {
    const unit = archer();
    const bowKnight = cls('Bow Knight');
    promoteUnit(unit, bowKnight, bowKnight.promotionBonuses, data.skills);
    expect(knowsSkill(unit, 'death_blow')).toBe(false);
  });

  it('enemy Snipers never learn it, at any level or act', () => {
    for (const act of ['act2', 'act3', 'act4', 'finalBoss'])
      for (const level of [1, 5, 10, 15, 20]) {
        const enemy = createPromotedEnemyUnit(sniper, level, data.weapons, 1.0, data.skills, act, data.classes); // prettier-ignore
        expect(enemy.faction).toBe('enemy');
        expect(knowsSkill(enemy, 'death_blow'), `${act} L${level}`).toBe(false);
        expect(enemy.inventory.map((w) => w.name)).not.toContain('Recurve Bow');
      }
  });

  it('Colosseum challengers never learn it', () => {
    let x = 3;
    const rng = () => {
      x = (x * 16807) % 2147483647;
      return x / 2147483647;
    };
    const tiers = data.colosseum.arena.tiers;
    let snipers = 0;
    for (let i = 0; i < 400; i++)
      for (const [name, tier] of Object.entries(tiers)) {
        let challenger;
        try {
          challenger = generateChallenger(15, tier, 'act4', data.enemies, data.classes, data.weapons, 'normal', data.colosseum, rng); // prettier-ignore
        } catch {
          continue;
        }
        if (challenger.unit.className !== 'Sniper') continue;
        snipers++;
        expect(knowsSkill(challenger.unit, 'death_blow'), name).toBe(false);
      }
    expect(snipers).toBeGreaterThan(0);
  });

  it('a Sniper from an old save learns it on load', () => {
    const run = new RunManager(data);
    const unit = archer();
    promoteUnit(unit, sniper, sniper.promotionBonuses, data.skills);
    unit.skills = unit.skills.filter((id) => id !== 'death_blow');
    run.roster = [unit];
    RunManager.migrateClassLearnableSkills(run);
    expect(unit.skills).toContain('death_blow');
  });
});

describe('recruited Snipers arrive with a Recurve Bow', () => {
  const recurveEquipped = (unit) => {
    expect(unit.className).toBe('Sniper');
    expect(unit.weapon?.name).toBe('Recurve Bow');
    expect(unit.inventory[0]).toBe(unit.weapon);
    expect(unit.inventory.map((w) => w.name)).not.toContain('Longbow');
    expect(unit.skills).toContain('death_blow');
  };

  it('from a recruit node (promoted roll)', () => {
    const roster = [{ name: 'Edric', isLord: true, isCommander: true, tier: 'promoted', level: 4 }];
    const draws = [0.99, 0.99, 0.99, 0.1];
    let i = 0;
    const { unit } = buildRecruitNodeUnit({
      preview: { className: 'Sniper', name: 'Faye' },
      nodeId: 'n1',
      runSeed: 1,
      act: 'act3',
      roster,
      gameData: { ...data, lords: [] },
      rng: () => (i < draws.length ? draws[i++] : 0.1),
    });
    recurveEquipped(unit);
    // The level-tier bow stays in the bag.
    expect(unit.inventory.map((w) => w.name)).toContain('Steel Bow');
  });

  it('from a boss recruit', () => {
    const roster = [{ name: 'Edric', isCommander: true, tier: 'promoted', level: 6 }];
    const gameData = structuredClone(data);
    gameData.recruits.act4.classPool = ['Sniper'];
    gameData.lords = [];
    vi.spyOn(Math, 'random').mockReturnValue(0.1); // promotion roll succeeds
    const [candidate] = generateBossRecruitCandidates('act3', roster, gameData, null);
    recurveEquipped(candidate.unit);
  });

  it('Archers keep the Longbow', () => {
    const unit = archer(3);
    expect(unit.inventory.map((w) => w.name)).toEqual([unit.inventory[0].name, 'Longbow']);
    expect(unit.weapon.name).not.toBe('Recurve Bow');
  });
});
