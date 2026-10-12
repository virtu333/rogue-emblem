// The Entity's 3x3 body in the rules that measure one unit from another. Every rule here
// reads EntitySystem.combatDistance, so the Entity is beside (or within N of) a unit at the
// nearest tile of its body, exactly as an attack measures it, never at its top-left anchor
// alone. Each case puts the other unit beside a non-anchor body tile, where the anchor is
// far: the Entity's anchor is (3,3), its body cols 3-5 x rows 3-5, and (6,5) is beside the
// bottom-right tile (5,5) but 5 tiles from the anchor. Expected values are worked by hand.
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/ui/LevelUpPopup.js', () => ({
  LevelUpPopup: class {
    async show() {}
  },
}));
vi.mock('../src/utils/SceneRouter.js', async () => {
  const actual = await vi.importActual('../src/utils/SceneRouter.js');
  return { ...actual, transitionToScene: vi.fn(async () => true) };
});
vi.mock('../src/ui/RosterOverlay.js', () => ({
  RosterOverlay: class {
    show() {}
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { combatDistance } from '../src/engine/EntitySystem.js';
import { deathburstVictims, getAffixCombatMods } from '../src/engine/AffixSystem.js';
import { affixForecastNotes } from '../src/engine/AffixForecast.js';
import { getSkillCombatMods, getTurnStartEffects } from '../src/engine/SkillSystem.js';
import { getConditionalWeaponBonuses } from '../src/engine/Combat.js';
import { AIController } from '../src/engine/AIController.js';
import { allyBuff, postCombatEffects } from '../src/engine/PostCombatEffects.js';
import { previewAreaArt } from '../src/engine/AreaPreview.js';
import { resolvePostCombatMove } from '../src/engine/WeaponArtPostCombat.js';
import { collectAffected } from '../src/engine/ActionAbilitySystem.js';
import { selectBallistaTarget } from '../src/engine/BallistaEngine.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const plain = { name: 'Plain', avoidBonus: 0, defBonus: 0 };
const BESIDE_BR = { col: 6, row: 5 };

const unit = (name, faction, col, row, hp = 20, extra = {}) => ({
  name,
  faction,
  col,
  row,
  currentHP: hp,
  stats: { HP: 20, STR: 5, MAG: 5, SKL: 5, SPD: 5, DEF: 5, RES: 5, LCK: 0, MOV: 5 },
  className: 'Soldier',
  level: 1,
  moveType: 'Infantry',
  skills: [],
  affixes: [],
  ...extra,
});
const entity = (extra = {}) =>
  unit('The Entity', 'enemy', 3, 3, 60, {
    isEntity: true,
    isBoss: true,
    className: 'Entity',
    stats: { HP: 80, STR: 20, MAG: 20, SKL: 10, SPD: 5, DEF: 10, RES: 10, LCK: 0, MOV: 0 },
    ...extra,
  });

describe('the geometry these tests rely on', () => {
  it('(6,5) is beside the bottom-right body tile and 5 tiles from the anchor', () => {
    const e = entity();
    const beside = unit('Beside', 'player', BESIDE_BR.col, BESIDE_BR.row);
    expect(combatDistance(e, beside)).toBe(1);
    expect(combatDistance(beside, e)).toBe(1);
    expect(Math.abs(e.col - beside.col) + Math.abs(e.row - beside.row)).toBe(5);
  });
});

describe('Deathburst: 5 damage to every unit beside the bursting foe', () => {
  function deathScene() {
    const scene = new BattleScene();
    Object.assign(scene, {
      _battleSession: 1,
      registry: { get: () => null },
      gameData: data,
      runManager: null,
      battleState: 'COMBAT_RESOLVING',
      battleConfig: { objective: 'rout' },
      playerUnits: [],
      npcUnits: [],
      goldEarned: 0,
      _combatFx: { deathFade: async () => {} },
      _battleBeats: { onKill: vi.fn() },
      _awaitSceneDelay: async () => {},
      _applyKillRewards: vi.fn(),
      removeUnitGraphic: vi.fn(),
      updateObjectiveText: vi.fn(),
      updateHPBar: vi.fn(),
      checkBattleEnd: vi.fn(),
      grid: {
        gridToPixel: (col, row) => ({ x: col * 32, y: row * 32 }),
        clearTemporaryTerrainsBySource: vi.fn(),
      },
      add: {
        text: () => {
          const text = { setOrigin: () => text, setDepth: () => text, destroy: vi.fn() };
          return text;
        },
        rectangle: () => {
          const r = { setStrokeStyle: () => r, setAngle: () => r, setDepth: () => r, destroy() {} };
          return r;
        },
      },
      tweens: { add: (config) => config.onComplete?.() },
    });
    return scene;
  }
  const burst = () =>
    unit('Burst', 'enemy', BESIDE_BR.col, BESIDE_BR.row, 0, { affixes: ['deathburst'] });

  it('reaches the Entity beside its bottom-right tile', async () => {
    const scene = deathScene();
    const source = burst();
    const boss = entity({ currentHP: 30 });
    const far = unit('Far', 'enemy', 8, 5, 10); // two tiles off: untouched
    scene.enemyUnits = [source, boss, far];
    await scene.removeUnit(source);
    expect([boss.currentHP, far.currentHP]).toEqual([25, 10]);
    expect(scene.enemyUnits).toEqual([boss, far]);
  });

  it('the blow goes through UnitHealth: a stone takes the lethal 5, then the last bar falls', async () => {
    // The Entity never carries a stone in a real battle; the blow still meets the one rule.
    const scene = deathScene();
    const source = burst();
    const boss = entity({ currentHP: 4, revivalStones: 1, revivalStonesMax: 1 });
    scene.enemyUnits = [source, boss];
    await scene.removeUnit(source);
    expect([boss.currentHP, boss.revivalStones]).toEqual([80, 0]);
    expect(scene.enemyUnits).toEqual([boss]);

    const again = deathScene();
    const second = burst();
    const bare = entity({ currentHP: 4 });
    again.enemyUnits = [second, bare];
    await again.removeUnit(second);
    expect(bare.currentHP).toBe(0);
    expect(again.enemyUnits).toEqual([]);
  });

  it('deathburstVictims keeps single-tile reach and order, and finds the body', () => {
    const boss = entity();
    const n = unit('N', 'player', 6, 4);
    const diagonal = unit('Diag', 'player', 7, 6);
    const victims = deathburstVictims(BESIDE_BR, [n, boss, diagonal], 1);
    expect(victims).toEqual([n, boss]);
    expect(deathburstVictims({ col: 9, row: 9 }, [n, boss, diagonal], 1)).toEqual([]);
  });

  it('the forecast warns of the blast when only the Entity stands beside the burster', () => {
    const attacker = unit('Archer', 'player', 6, 7);
    const defender = unit('Burst', 'enemy', BESIDE_BR.col, BESIDE_BR.row, 8, {
      affixes: ['deathburst'],
    });
    const side = { damage: 8, crit: 0, hit: 75, attackCount: 1, canCounter: true };
    const forecast = { display: { distance: 2 }, attacker: side, defender: side };
    const notes = affixForecastNotes(attacker, defender, forecast, data.affixes, {
      visibleUnits: [entity()],
    }).defender;
    expect(notes.map((n) => n.affixId)).toEqual(['deathburst']);
  });
});

describe('accessory and skill conditions count the Entity by its body', () => {
  const mods = (u, opponent, allies, enemies) =>
    getSkillCombatMods(u, opponent, allies, enemies, data.skills, plain, true);
  const medallion = () =>
    structuredClone(data.accessories.find((a) => a.name === 'Diamond Medallion'));

  it('Diamond Medallion: the Entity beside its bottom-right tile is one of two foes within 2', () => {
    const wearer = unit('Wearer', 'player', BESIDE_BR.col, BESIDE_BR.row, 20, {
      accessory: medallion(),
    });
    const foe = unit('Foe', 'enemy', 7, 5);
    expect(mods(wearer, foe, [wearer], [foe, entity()]).defBonus).toBe(3);
    expect(mods(wearer, foe, [wearer], [foe]).defBonus).toBe(0);
  });

  it('isolated_duel: the Entity is a third unit near either side, and an opponent by its body', () => {
    const duelist = (col, row) =>
      unit('Duelist', 'player', col, row, 20, {
        accessory: { combatEffects: { atkBonus: 3, condition: 'isolated_duel' } },
      });
    // A third unit: the Entity's bottom-right tile is 2 from the duelist at (7,5).
    const near = duelist(7, 5);
    const foe = unit('Foe', 'enemy', 8, 5);
    expect(mods(near, foe, [near], [foe]).atkBonus).toBe(3);
    expect(mods(near, foe, [near], [foe, entity()]).atkBonus).toBe(0);
    // The opponent: a unit 2 from the Entity's body (but 6 from its anchor) is no longer alone.
    const fighter = duelist(BESIDE_BR.col, BESIDE_BR.row);
    const bystander = unit('Bystander', 'enemy', 7, 4);
    const boss = entity();
    expect(mods(fighter, boss, [fighter], [boss]).atkBonus).toBe(3);
    expect(mods(fighter, boss, [fighter], [boss, bystander]).atkBonus).toBe(0);
  });

  it("an enemy beside the Entity's body has an ally beside it (Phalanx Band, Guard, Skyward)", () => {
    const boss = entity();
    const band = unit('Band', 'enemy', BESIDE_BR.col, BESIDE_BR.row, 20, {
      accessory: structuredClone(data.accessories.find((a) => a.name === 'Phalanx Band')),
    });
    const foe = unit('Foe', 'player', 7, 5);
    expect(mods(band, foe, [band, boss], [foe]).hitBonus).toBe(10);
    const crest = unit('Crest', 'enemy', 7, 5, 20, {
      accessory: structuredClone(data.accessories.find((a) => a.name === 'Vanguard Crest')),
    });
    expect(mods(crest, foe, [crest], [foe]).atkBonus).toBe(4);
    expect(mods(crest, foe, [crest, boss], [foe]).atkBonus).toBe(0);

    const guard = unit('Guard', 'enemy', BESIDE_BR.col, BESIDE_BR.row, 20, { skills: ['guard'] });
    expect(mods(guard, foe, [guard, boss], [foe]).defBonus).toBe(3);
    const flier = unit('Flier', 'enemy', BESIDE_BR.col, BESIDE_BR.row, 20, { skills: ['skyward'] });
    expect(mods(flier, foe, [flier], [foe]).avoidBonus).toBe(15);
    expect(mods(flier, foe, [flier, boss], [foe]).avoidBonus).toBe(0);
  });

  it('"if no adjacent allies" weapons see the Entity beside their wielder', () => {
    const windward = structuredClone(data.weapons.find((w) => w.name === 'Windward'));
    const lancer = unit('Lancer', 'enemy', BESIDE_BR.col, BESIDE_BR.row);
    expect(getConditionalWeaponBonuses(windward, lancer, [lancer])).toEqual({
      atkBonus: 2,
      spdBonus: 2,
    });
    expect(getConditionalWeaponBonuses(windward, lancer, [lancer, entity()])).toEqual({
      atkBonus: 0,
      spdBonus: 0,
    });
  });
});

describe('auras reach the Entity at its body, and leave it from its body', () => {
  it("an ally's Charisma (range 2) beside the bottom-right tile buffs the Entity", () => {
    const boss = entity();
    const herald = unit('Herald', 'enemy', 7, 5, 20, { skills: ['charisma'] }); // 2 from (5,5)
    const foe = unit('Foe', 'player', 3, 2);
    const withAura = getSkillCombatMods(boss, foe, [boss, herald], [foe], data.skills, plain);
    const alone = getSkillCombatMods(boss, foe, [boss], [foe], data.skills, plain);
    expect(withAura.hitBonus - alone.hitBonus).toBe(10);
    expect(withAura.avoidBonus - alone.avoidBonus).toBe(5);
  });

  it('Rally (affix aura, range 2) reaches the Entity, and the Entity’s Rally reaches its allies', () => {
    const foe = unit('Foe', 'player', 3, 2);
    const boss = entity();
    const rallier = unit('Rallier', 'enemy', 7, 5, 20, { affixes: ['rally'] });
    expect(getAffixCombatMods(boss, foe, [boss, rallier], data.affixes, plain).atkBonus).toBe(3);

    const rallyingBoss = entity({ affixes: ['rally'] });
    const soldier = unit('Soldier', 'enemy', 7, 5);
    expect(
      getAffixCombatMods(soldier, foe, [soldier, rallyingBoss], data.affixes, plain).atkBonus,
    ).toBe(3);
  });

  it('Renewal Aura heals the Entity from beside its bottom-right tile', () => {
    const boss = entity({ currentHP: 40 });
    const monk = unit('Monk', 'enemy', BESIDE_BR.col, BESIDE_BR.row, 20, {
      skills: ['renewal_aura'],
    });
    const effects = getTurnStartEffects([monk, boss], data.skills);
    expect(effects).toEqual([
      expect.objectContaining({ type: 'heal', target: boss, amount: 3, sourceUnit: monk }),
    ]);
  });
});

describe('enemy staves reach the Entity at its body', () => {
  function healerFixture() {
    const staff = structuredClone(data.weapons.find((w) => w.name === 'Heal'));
    const healer = unit('Healer', 'enemy', BESIDE_BR.col, BESIDE_BR.row, 20, {
      mov: 2,
      aiMode: 'heal',
      stats: { HP: 20, MAG: 5 },
      weapon: staff,
      inventory: [staff],
      proficiencies: [{ type: 'Staff', rank: 'Prof' }],
    });
    const ai = new AIController({ getMovementRange: () => new Map(), findPath: () => null }, data);
    ai._delay = async () => {};
    return { ai, healer, staff };
  }

  it('a healer beside the bottom-right tile chooses the Entity and mends it', async () => {
    const { ai, healer, staff } = healerFixture();
    const boss = entity({ currentHP: 20 });
    const player = unit('Player', 'player', 9, 9);
    const onHeal = vi.fn();
    const decision = await ai._processOneEnemy(healer, [healer, boss], [player], [], {
      onHeal,
      onAttack: vi.fn(),
      onUnitDone: vi.fn(),
    });
    expect(decision).toMatchObject({ reason: 'heal_ally', healTarget: boss });
    expect(onHeal).toHaveBeenCalledTimes(1);
    expect(boss.currentHP).toBeGreaterThan(20);
    expect(staff._usesSpent).toBe(1);
  });

  it('applyHealDecision measures the Entity at its body', () => {
    const { ai, healer, staff } = healerFixture();
    const boss = entity({ currentHP: 20 });
    expect(ai.applyHealDecision(healer, boss, staff)).not.toBeNull();
    expect(boss.currentHP).toBeGreaterThan(20);
  });
});

describe('after-combat ally effects reach the Entity at its body', () => {
  const worldOf = (units) => ({
    affixes: data.affixes,
    cols: 12,
    rows: 12,
    getMoveCost: () => 1,
    getTerrainAt: () => null,
    getUnitAt: (col, row) => units.find((u) => u.col === col && u.row === row) || null,
    hostilesOf: (u) => units.filter((o) => o.faction !== u.faction),
    alliesOf: (u) => units.filter((o) => o.faction === u.faction),
    turnNumber: 1,
  });

  it("Divine Charge's heal finds the Entity 3 tiles from its body (7 from its anchor)", () => {
    const boss = entity({ currentHP: 40 });
    const charger = unit('Charger', 'enemy', 8, 5); // 3 from (5,5)
    const foe = unit('Foe', 'player', 9, 6);
    const result = {
      events: [],
      divineChargeHeals: [{ side: 'attacker', percent: 50, range: 3, damageDealt: 10 }],
    };
    const units = [charger, boss, foe];
    for (const beat of postCombatEffects(
      { attacker: charger, defender: foe, result },
      worldOf(units),
    ))
      void beat;
    expect(boss.currentHP).toBe(45);
  });

  it('Benediction-style ally heals reach the Entity beside the user, in play and in preview', () => {
    const art = {
      id: 'fixture_benediction',
      targeting: 'normal_attack',
      effects: { allyHeal: { radius: 1, percentOfDamage: 50 } },
      combatMods: {},
    };
    const boss = entity({ currentHP: 40 });
    const priest = unit('Priest', 'enemy', BESIDE_BR.col, BESIDE_BR.row);
    const foe = unit('Foe', 'player', 7, 5);
    const units = [priest, boss, foe];
    const preview = previewAreaArt({
      attacker: priest,
      art,
      target: foe,
      knowledge: { units },
      world: worldOf(units),
      dealt: 10,
    });
    expect(preview.heals).toEqual([{ unit: boss, amount: 5 }]);
    const result = {
      events: [{ type: 'strike', attackerSide: 'attacker', miss: false, damage: 10 }],
      startHP: { attacker: 20, defender: 20 },
    };
    for (const beat of postCombatEffects(
      { attacker: priest, defender: foe, result, attackerWeaponArt: art },
      worldOf(units),
    ))
      void beat;
    expect(boss.currentHP).toBe(45);
  });

  it('an ally buff (range 1) reaches the Entity beside the user', () => {
    const boss = entity();
    const source = unit('Captain', 'enemy', BESIDE_BR.col, BESIDE_BR.row);
    const step = { artId: 'rally', range: 1, durationPhases: 1, stats: { STR: 3 } };
    for (const beat of allyBuff(step, source, worldOf([source, boss]))) void beat;
    expect(boss.stats.STR).toBe(23);
  });
});

describe('art moves meet the Entity at its body and never displace it', () => {
  const occupant = (units) => (col, row) =>
    units.find((u) =>
      u.isEntity
        ? col >= u.col && col < u.col + 3 && row >= u.row && row < u.row + 3
        : u.col === col && u.row === row,
    ) || null;
  const move = (source, target, mode) =>
    resolvePostCombatMove({
      sourceUnit: source,
      targetUnit: target,
      mode,
      distance: 1,
      cols: 12,
      rows: 12,
      getMoveCost: () => 1,
      getUnitAt: occupant([source, target]),
    });

  it('Lunge (swap) and a push from beside the anchor leave the Entity where it stands', () => {
    const boss = entity();
    const user = unit('User', 'player', 2, 3); // left of the anchor itself
    expect(move(user, boss, 'swap')).toEqual({ ok: false, reason: 'immovable' });
    expect(move(user, boss, 'push')).toEqual({ ok: false, reason: 'immovable' });
    expect(move(user, boss, 'ram')).toEqual({ ok: false, reason: 'immovable' });
  });

  it('a retreat steps away from the bottom-right tile; through is blocked by the body', () => {
    const boss = entity();
    const user = unit('User', 'player', BESIDE_BR.col, BESIDE_BR.row);
    expect(move(user, boss, 'retreat')).toEqual({
      ok: true,
      assignments: [{ unit: user, col: 7, row: 5 }],
    });
    expect(move(user, boss, 'through')).toEqual({ ok: false, reason: 'blocked' });
    expect(move(user, boss, 'advance')).toEqual({ ok: false, reason: 'blocked' });
  });
});

describe('area abilities and the ballista reach the Entity at its body', () => {
  it('Ensnare (radius 2) catches the Entity 2 tiles from its bottom-right tile', () => {
    const ensnare = data.skills.find((s) => s.id === 'ensnare').actionAbility;
    const caster = unit('Caster', 'player', 7, 5);
    const boss = entity();
    expect(collectAffected(caster, ensnare, [boss])).toEqual([boss]);
  });

  it('a range-2 player ballista fires on the Entity 2 tiles from its bottom-right tile', () => {
    const boss = entity();
    expect(selectBallistaTarget({ col: 7, row: 5, owner: 'player', range: 2 }, [boss])).toBe(boss);
  });
});
