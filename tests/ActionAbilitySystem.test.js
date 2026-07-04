// ActionAbilitySystem — pure engine tests for utility abilities (Blink,
// Rally Cry, Healing Circle, Ensnare): availability, silence/root gating,
// per-map usage limits, blink tile legality, radius collection, plus the
// data contract for the four skills, their teach-scrolls, and loot pools.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import { loadGameData } from './testData.js';
import {
  ACTION_ABILITY_KINDS,
  getActionAbilities,
  getAbilityUsageCount,
  canUseAbility,
  markUsed,
  getBlinkTiles,
  collectAffected,
  abilityHasTargets,
} from '../src/engine/ActionAbilitySystem.js';

const gameData = loadGameData();
const skillById = new Map(gameData.skills.map((skill) => [skill.id, skill]));

const ABILITY_IDS = ['blink', 'rally_cry_skill', 'healing_circle', 'ensnare'];

function makeUnit(overrides = {}) {
  return {
    name: 'Unit',
    faction: 'player',
    col: 5,
    row: 5,
    currentHP: 20,
    stats: { HP: 24, STR: 8, SPD: 8, MOV: 5 },
    skills: [],
    _conditions: [],
    ...overrides,
  };
}

function makeGrid({ cols = 12, rows = 12, blocked = new Set() } = {}) {
  return {
    cols,
    rows,
    getMoveCost: (col, row) => (blocked.has(`${col},${row}`) ? Infinity : 1),
  };
}

describe('ability data contract', () => {
  it('all four ability skills exist with action trigger + structured actionAbility', () => {
    for (const id of ABILITY_IDS) {
      const skill = skillById.get(id);
      expect(skill, `skill ${id} missing from skills.json`).toBeTruthy();
      expect(skill.trigger).toBe('action');
      expect(skill.actionAbility, `skill ${id} missing actionAbility`).toBeTruthy();
      expect(ACTION_ABILITY_KINDS.has(skill.actionAbility.kind)).toBe(true);
      expect(skill.actionAbility.perMapLimit).toBe(1);
    }
  });

  it('ability shapes match the spec', () => {
    expect(skillById.get('blink').actionAbility).toEqual({
      kind: 'teleport_self',
      range: 4,
      perMapLimit: 1,
    });
    expect(skillById.get('rally_cry_skill').actionAbility).toEqual({
      kind: 'ally_buff',
      radius: 2,
      stats: { STR: 2, SPD: 2 },
      durationPhases: 2,
      perMapLimit: 1,
    });
    expect(skillById.get('healing_circle').actionAbility).toEqual({
      kind: 'aoe_heal',
      radius: 2,
      amount: 15,
      includeSelf: true,
      perMapLimit: 1,
    });
    expect(skillById.get('ensnare').actionAbility).toEqual({
      kind: 'aoe_root',
      radius: 2,
      durationPhases: 1,
      perMapLimit: 1,
    });
  });

  it('rally_cry_skill does not collide with the rally_cry blessing id', () => {
    // blessings.json already owns the id "rally_cry"; the skill must not
    // shadow it in any id-keyed lookup that mixes the two namespaces.
    const blessingIds = (gameData.blessings.blessings || []).map((b) => b.id);
    expect(blessingIds).toContain('rally_cry');
    expect(skillById.has('rally_cry')).toBe(false);
    expect(skillById.has('rally_cry_skill')).toBe(true);
  });

  it('legacy action skills (shove/pull/dance) do not gain actionAbility data', () => {
    for (const id of ['shove', 'pull', 'dance']) {
      expect(skillById.get(id).actionAbility).toBeUndefined();
    }
  });

  it('skills.schema.json rejects an unknown actionAbility kind and missing perMapLimit', () => {
    const ajv = new Ajv({ allErrors: true });
    const schema = JSON.parse(
      readFileSync(path.join(path.resolve('schemas'), 'skills.schema.json'), 'utf-8'),
    );
    const validate = ajv.compile(schema);
    expect(
      validate([
        {
          id: 'bad',
          name: 'Bad',
          description: 'x',
          trigger: 'action',
          actionAbility: { kind: 'aoe_stun', perMapLimit: 1 },
        },
      ]),
    ).toBe(false);
    expect(
      validate([
        {
          id: 'bad2',
          name: 'Bad2',
          description: 'x',
          trigger: 'action',
          actionAbility: { kind: 'teleport_self', range: 4 },
        },
      ]),
    ).toBe(false);
    expect(
      validate([
        {
          id: 'ok',
          name: 'Ok',
          description: 'x',
          trigger: 'action',
          actionAbility: { kind: 'teleport_self', range: 4, perMapLimit: 1 },
        },
      ]),
    ).toBe(true);
  });
});

describe('scroll + loot data contract', () => {
  const scrollBySkillId = new Map(
    gameData.weapons.filter((w) => w.type === 'Scroll' && w.skillId).map((w) => [w.skillId, w]),
  );

  it('each ability has a teach-scroll wired through the existing scroll flow', () => {
    const expectedNames = {
      blink: 'Blink Scroll',
      rally_cry_skill: 'Rally Cry Scroll',
      healing_circle: 'Healing Circle Scroll',
      ensnare: 'Ensnare Scroll',
    };
    for (const id of ABILITY_IDS) {
      const scroll = scrollBySkillId.get(id);
      expect(scroll, `no scroll teaches ${id}`).toBeTruthy();
      expect(scroll.name).toBe(expectedNames[id]);
      expect(scroll.type).toBe('Scroll');
      expect(scroll.price).toBe(2500);
    }
  });

  it('ability scrolls sit in the act2+/act3+ skillScroll loot pools', () => {
    const lootTables = gameData.lootTables;
    expect(lootTables.act1.skillScroll).toEqual([]);
    for (const name of ['Rally Cry Scroll', 'Healing Circle Scroll', 'Ensnare Scroll']) {
      expect(lootTables.act2.skillScroll).toContain(name);
      expect(lootTables.act3.skillScroll).toContain(name);
      expect(lootTables.act4.skillScroll).toContain(name);
    }
    // Blink is the strongest — act3+ only
    expect(lootTables.act2.skillScroll).not.toContain('Blink Scroll');
    expect(lootTables.act3.skillScroll).toContain('Blink Scroll');
    expect(lootTables.act4.skillScroll).toContain('Blink Scroll');
    expect(lootTables.finalBoss.skillScroll).toEqual([]);
  });
});

describe('getActionAbilities', () => {
  it('returns only action-trigger skills that carry actionAbility data', () => {
    const unit = makeUnit({ skills: ['blink', 'shove', 'dance', 'sol', 'ensnare'] });
    const abilities = getActionAbilities(unit, gameData.skills);
    expect(abilities.map((s) => s.id)).toEqual(['blink', 'ensnare']);
  });

  it('handles missing/unknown skills and bad input gracefully', () => {
    expect(getActionAbilities(null, gameData.skills)).toEqual([]);
    expect(getActionAbilities(makeUnit({ skills: undefined }), gameData.skills)).toEqual([]);
    expect(getActionAbilities(makeUnit({ skills: ['nope'] }), gameData.skills)).toEqual([]);
    expect(getActionAbilities(makeUnit({ skills: ['blink'] }), null)).toEqual([]);
  });

  it('ignores actionAbility entries with unknown kinds', () => {
    const unit = makeUnit({ skills: ['weird'] });
    const skills = [
      {
        id: 'weird',
        name: 'Weird',
        description: 'x',
        trigger: 'action',
        actionAbility: { kind: 'summon_dragon', perMapLimit: 1 },
      },
    ];
    expect(getActionAbilities(unit, skills)).toEqual([]);
  });
});

describe('canUseAbility / markUsed', () => {
  const blink = skillById.get('blink');

  it('allows a fresh, unafflicted unit', () => {
    const unit = makeUnit({ skills: ['blink'] });
    expect(canUseAbility(unit, blink)).toEqual({ ok: true, reason: null });
  });

  it('silence blocks abilities', () => {
    const unit = makeUnit({
      skills: ['blink'],
      _conditions: [{ id: 'silence', turnsRemaining: 2 }],
    });
    expect(canUseAbility(unit, blink)).toEqual({ ok: false, reason: 'silenced' });
  });

  it('root does NOT block abilities (root allows acting)', () => {
    const unit = makeUnit({
      skills: ['blink'],
      _conditions: [{ id: 'root', turnsRemaining: 2 }],
    });
    expect(canUseAbility(unit, blink).ok).toBe(true);
  });

  it('enforces the per-map limit via markUsed', () => {
    const unit = makeUnit({ skills: ['blink'] });
    expect(getAbilityUsageCount(unit, 'blink')).toBe(0);
    markUsed(unit, 'blink');
    expect(getAbilityUsageCount(unit, 'blink')).toBe(1);
    expect(unit._battleAbilityUsage).toEqual({ map: { blink: 1 } });
    expect(canUseAbility(unit, blink)).toEqual({ ok: false, reason: 'per_map_limit' });
  });

  it('usage counters are per-ability', () => {
    const unit = makeUnit({ skills: ['blink', 'ensnare'] });
    markUsed(unit, 'blink');
    expect(canUseAbility(unit, skillById.get('ensnare')).ok).toBe(true);
  });

  it('usage counter survives a structuredClone round trip (suspend/resume shape)', () => {
    const unit = makeUnit({ skills: ['blink'] });
    markUsed(unit, 'blink');
    const restored = structuredClone(unit);
    expect(canUseAbility(restored, blink)).toEqual({ ok: false, reason: 'per_map_limit' });
  });

  it('rejects invalid input', () => {
    expect(canUseAbility(null, blink)).toEqual({ ok: false, reason: 'invalid_input' });
    expect(canUseAbility(makeUnit(), null)).toEqual({ ok: false, reason: 'invalid_input' });
    expect(canUseAbility(makeUnit(), { id: 'blink' })).toEqual({
      ok: false,
      reason: 'invalid_input',
    });
  });
});

describe('getBlinkTiles', () => {
  it('returns the full passable-unoccupied diamond within range', () => {
    const unit = makeUnit({ col: 5, row: 5 });
    const tiles = getBlinkTiles(unit, 2, makeGrid(), () => null);
    // Diamond of radius 2 minus the origin: 12 tiles
    expect(tiles).toHaveLength(12);
    // Full diamond, not just the max-distance ring (getWarpCandidates contrast)
    expect(tiles).toContainEqual({ col: 6, row: 5 });
    expect(tiles).toContainEqual({ col: 7, row: 5 });
    expect(tiles).not.toContainEqual({ col: 5, row: 5 });
    expect(tiles).not.toContainEqual({ col: 7, row: 7 }); // manhattan 4 > 2
  });

  it('excludes out-of-bounds, occupied, and impassable tiles', () => {
    const unit = makeUnit({ col: 0, row: 0, moveType: 'Infantry' });
    const blocked = new Set(['1,0']);
    const occupied = { col: 0, row: 1 };
    const tiles = getBlinkTiles(unit, 1, makeGrid({ blocked }), (col, row) =>
      col === occupied.col && row === occupied.row ? occupied : null,
    );
    expect(tiles).toEqual([]);
  });

  it('handles missing grid or zero range', () => {
    expect(getBlinkTiles(makeUnit(), 4, null, () => null)).toEqual([]);
    expect(getBlinkTiles(makeUnit(), 0, makeGrid(), () => null)).toEqual([]);
  });
});

describe('collectAffected', () => {
  const rally = skillById.get('rally_cry_skill').actionAbility;
  const heal = skillById.get('healing_circle').actionAbility;

  it('filters by manhattan radius and excludes dead units', () => {
    const caster = makeUnit({ name: 'Caster', col: 5, row: 5 });
    const near = makeUnit({ name: 'Near', col: 6, row: 6 }); // dist 2
    const far = makeUnit({ name: 'Far', col: 8, row: 5 }); // dist 3
    const dead = makeUnit({ name: 'Dead', col: 5, row: 6, currentHP: 0 });
    const result = collectAffected(caster, rally, [caster, near, far, dead]);
    expect(result).toEqual([near]);
  });

  it('includes self only when includeSelf is true', () => {
    const caster = makeUnit({ name: 'Caster' });
    expect(collectAffected(caster, rally, [caster])).toEqual([]);
    expect(collectAffected(caster, heal, [caster])).toEqual([caster]);
  });

  it('handles bad input', () => {
    expect(collectAffected(null, rally, [])).toEqual([]);
    expect(collectAffected(makeUnit(), null, [])).toEqual([]);
    expect(collectAffected(makeUnit(), rally, null)).toEqual([]);
  });
});

describe('abilityHasTargets', () => {
  it('teleport_self requires at least one legal tile', () => {
    const unit = makeUnit({ col: 0, row: 0, skills: ['blink'], moveType: 'Infantry' });
    const blink = skillById.get('blink');
    expect(abilityHasTargets(unit, blink, { grid: makeGrid(), getUnitAt: () => null })).toBe(true);
    const allBlocked = makeGrid({ cols: 1, rows: 1 });
    expect(abilityHasTargets(unit, blink, { grid: allBlocked, getUnitAt: () => null })).toBe(false);
  });

  it('ally_buff requires an ally in radius (self excluded)', () => {
    const unit = makeUnit({ skills: ['rally_cry_skill'] });
    const rally = skillById.get('rally_cry_skill');
    expect(abilityHasTargets(unit, rally, { allies: [unit] })).toBe(false);
    const ally = makeUnit({ name: 'Ally', col: 6, row: 5 });
    expect(abilityHasTargets(unit, rally, { allies: [unit, ally] })).toBe(true);
  });

  it('aoe_heal requires an affected unit that is missing HP', () => {
    const heal = skillById.get('healing_circle');
    const fullHp = makeUnit({ skills: ['healing_circle'], currentHP: 24 });
    expect(abilityHasTargets(fullHp, heal, { allies: [fullHp] })).toBe(false);
    const hurtSelf = makeUnit({ skills: ['healing_circle'], currentHP: 10 });
    expect(abilityHasTargets(hurtSelf, heal, { allies: [hurtSelf] })).toBe(true);
    const hurtAlly = makeUnit({ name: 'Ally', col: 6, row: 5, currentHP: 3 });
    expect(abilityHasTargets(fullHp, heal, { allies: [fullHp, hurtAlly] })).toBe(true);
  });

  it('aoe_root requires an enemy in radius', () => {
    const unit = makeUnit({ skills: ['ensnare'] });
    const ensnare = skillById.get('ensnare');
    expect(abilityHasTargets(unit, ensnare, { enemies: [] })).toBe(false);
    const enemyNear = makeUnit({ name: 'E1', faction: 'enemy', col: 5, row: 7 });
    const enemyFar = makeUnit({ name: 'E2', faction: 'enemy', col: 5, row: 9 });
    expect(abilityHasTargets(unit, ensnare, { enemies: [enemyFar] })).toBe(false);
    expect(abilityHasTargets(unit, ensnare, { enemies: [enemyNear, enemyFar] })).toBe(true);
  });
});
