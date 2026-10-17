// The Vigil's shields (engine/Vigil.js; docs/specs/act-v-descent.md §3.1.1): a Voice is warded
// while a circle naming it stands, the Waking while any other Voice lives, and a warded unit
// takes no damage from anything. Ways this breaks, a test each:
//   - a circle breaks with wards off, under an enemy, for a fallen Voice, twice, or a broken one
//     calls again once the army steps off it
//   - the breaks happen after the summons (a covered circle that breaks still calls), or a
//     second run of the same turn breaks again
//   - a Voice stays warded once its circles are broken, or loses its ward with one still up;
//     the choir holds with every other Voice fallen, or drops while one lives
//   - the stamps reach a non-Voice, linger when the shields are off, or the reason is wrong
//   - the saved state drops `broken`, keeps a bad entry, or writes an empty one
//   - a warded unit loses HP to a strike, a crit, a drain's give-back, an area blow (damageUnit)
//     or an art's "HP -> N"; or the forecast hides that the blow does nothing
//   - the set piece drops `wards` / `choir`, or the validator lets a warded Voice with no
//     circle, a choir with no Waking or a non-boolean through
//   - the shipped Vigil: no shields, no Abyss, a circle the army cannot reach, a Voice whose
//     circle is not across the dark from it, or an Abyss tile a walker can enter
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGameData } from './testData.js';
import {
  applyVigilWards,
  createVigilState,
  openWardCircles,
  sanitizeVigilState,
  vigilBoardView,
  vigilPhaseStep,
  wardOf,
} from '../src/engine/Vigil.js';
import {
  calculateDamage,
  getCombatForecast,
  isWardedUnit,
  resolveCombat,
} from '../src/engine/Combat.js';
import { applyCombatHP, damageUnit, damageUnitDetailed } from '../src/engine/UnitHealth.js';
import { postCombatEffects } from '../src/engine/PostCombatEffects.js';
import {
  buildSetPieceBattle,
  SET_PIECE_MAX_DEPLOY,
  validateSetPiecesConfig,
} from '../src/engine/SetPieces.js';
import { deployLimitsForParams, resolveDeployLimits } from '../src/engine/BattleDeployCount.js';
import { generateSeededBattle } from '../src/engine/BattleScout.js';
import { wardInfo } from '../src/engine/BattleInformation.js';
import { forecastNotes, WARDED_FORECAST_NOTE } from '../src/ui/forecastDisplay.js';
import { combatNumberStyle } from '../src/ui/combatNumberStyle.js';
import { DEPLOY_LIMITS, TERRAIN } from '../src/utils/constants.js';
import { DEV_SET_PIECE_FIXTURES, withDevSetPiece } from '../src/utils/devSetPieceFixtures.js';

const data = loadGameData();
afterEach(() => vi.restoreAllMocks());

/** A 9x9 floor: four sigils round the centre, four circles at the edges, shields on. */
const VIGIL = Object.freeze({
  wards: true,
  choir: true,
  sigils: [
    { id: 's_n', col: 4, row: 2, target: 'v_n' },
    { id: 's_e', col: 6, row: 4, target: 'v_e' },
    { id: 's_s', col: 4, row: 6, target: 'v_s' },
    { id: 's_w', col: 2, row: 4, target: 'v_w', waking: true },
  ],
  circles: [
    { id: 'c_n', col: 4, row: 0, voice: 'v_n' },
    { id: 'c_e', col: 8, row: 4, voice: 'v_e' },
    { id: 'c_s', col: 4, row: 8, voice: 'v_s' },
    { id: 'c_w', col: 0, row: 4, voice: 'v_w' },
  ],
  levelRange: [10, 10],
});
const PLAIN = Object.freeze({ ...VIGIL, wards: undefined, choir: undefined });

const voice = (id, col, row) => ({
  name: id,
  authoredId: id,
  faction: 'enemy',
  className: 'Circle Adept',
  currentHP: 20,
  stats: { HP: 20 },
  col,
  row,
});
const voices = () => VIGIL.sigils.map((s) => voice(s.target, s.col, s.row));
const hero = (col, row, faction = 'player') => ({ name: 'Edric', faction, currentHP: 30, col, row }); // prettier-ignore

function step({
  vigil = VIGIL,
  state = null,
  enemyUnits = voices(),
  playerUnits = [],
  npcUnits = [],
  turn = 1,
} = {}) {
  const all = [...enemyUnits, ...playerUnits, ...npcUnits];
  return vigilPhaseStep({
    vigil,
    state,
    enemyUnits,
    playerUnits,
    npcUnits,
    cols: 9,
    rows: 9,
    isOccupied: (c, r) => all.some((u) => u.currentHP > 0 && u.col === c && u.row === r),
    moveCostAt: () => '1',
    turn,
    seed: 77,
    riteAtEntry: 0,
    classes: data.classes,
    weapons: data.weapons,
  });
}
const circlesCalled = (summons) => summons.map((s) => s.circleId);

describe('the circles break', () => {
  it('a player or NPC on a circle at the phase start breaks it, before the summons', () => {
    const { breaks, state, summons } = step({
      playerUnits: [hero(4, 0)],
      npcUnits: [hero(8, 4, 'npc')],
    });
    expect(breaks).toEqual([
      { circleId: 'c_n', voiceId: 'v_n', col: 4, row: 0 },
      { circleId: 'c_e', voiceId: 'v_e', col: 8, row: 4 },
    ]);
    expect(state.broken).toEqual({ c_n: 1, c_e: 1 });
    expect(circlesCalled(summons)).toEqual(['c_s', 'c_w']);
  });

  it('a broken circle calls no more once the army steps off it', () => {
    const first = step({ playerUnits: [hero(4, 0)] });
    const later = step({ state: first.state, turn: 2 });
    expect(later.breaks).toEqual([]);
    expect(circlesCalled(later.summons)).toEqual(['c_e', 'c_s', 'c_w']);
    expect(later.state.broken).toEqual({ c_n: 1 });
  });

  it('wards off: standing on a circle only blocks it, as before; nothing is saved as broken', () => {
    const covered = step({ vigil: PLAIN, playerUnits: [hero(4, 0)] });
    expect(covered.breaks).toEqual([]);
    expect(covered.state).not.toHaveProperty('broken');
    const after = step({ vigil: PLAIN, state: covered.state, turn: 2 });
    expect(circlesCalled(after.summons)).toEqual(['c_n', 'c_e', 'c_s', 'c_w']);
  });

  it('an enemy on a circle breaks nothing; a fallen Voice’s circle does not break', () => {
    const guard = { ...voice('guard', 4, 0), authoredId: undefined };
    expect(step({ enemyUnits: [...voices(), guard] }).breaks).toEqual([]);
    const noNorth = voices().filter((v) => v.authoredId !== 'v_n');
    expect(step({ enemyUnits: noNorth, playerUnits: [hero(4, 0)] }).breaks).toEqual([]);
  });

  it('a turn already processed breaks nothing again; the step writes none of its inputs', () => {
    const state = step({ playerUnits: [hero(4, 0)] }).state;
    const frozen = structuredClone(state);
    const again = step({ state, playerUnits: [hero(8, 4)], turn: 1 });
    expect(again.breaks).toEqual([]);
    expect(again.state).toEqual(frozen);
    expect(state).toEqual(frozen);
  });

  it('the board view marks a broken circle and each sigil’s ward', () => {
    const { state } = step({ playerUnits: [hero(4, 0)] });
    const view = vigilBoardView(VIGIL, { enemyUnits: voices(), state });
    expect(view.circles.find((c) => c.id === 'c_n').broken).toBe(true);
    expect(view.circles.find((c) => c.id === 'c_e').broken).toBe(false);
    expect(view.sigils.find((x) => x.id === 's_n').ward).toMatchObject({ circle: false });
    expect(view.sigils.find((x) => x.id === 's_e').ward).toMatchObject({ circle: true });
    expect(view.sigils.find((x) => x.id === 's_w').ward).toMatchObject({ choir: true });
  });
});

describe('who is warded', () => {
  it('every Voice starts warded; its circle broken, it is not; the Waking keeps the choir', () => {
    const units = voices();
    const { raised, dropped } = applyVigilWards(VIGIL, createVigilState(), units);
    expect(raised.map((u) => u.authoredId)).toEqual(['v_n', 'v_e', 'v_s', 'v_w']);
    expect(dropped).toEqual([]);
    expect(units.map((u) => u.wardReason)).toEqual(['circle', 'circle', 'circle', 'both']);

    const state = { ...createVigilState(), broken: { c_n: 1, c_w: 1 } };
    const again = applyVigilWards(VIGIL, state, units);
    expect(again.dropped.map((u) => u.authoredId)).toEqual(['v_n']);
    expect(units[0]).not.toHaveProperty('warded');
    expect(units[0]).not.toHaveProperty('wardReason');
    expect(units[3]).toMatchObject({ warded: true, wardReason: 'choir' });
  });

  it('the choir falls silent with the last other Voice, not before', () => {
    const state = { ...createVigilState(), broken: { c_n: 1, c_e: 1, c_s: 1, c_w: 1 } };
    const units = voices();
    applyVigilWards(VIGIL, state, units);
    expect(units.filter(isWardedUnit).map((u) => u.authoredId)).toEqual(['v_w']);
    const two = units.filter((u) => ['v_n', 'v_w'].includes(u.authoredId));
    applyVigilWards(VIGIL, state, two);
    expect(two[1].warded).toBe(true);
    const alone = [units[3]];
    expect(applyVigilWards(VIGIL, state, alone).dropped).toEqual(alone);
    expect(alone[0]).not.toHaveProperty('warded');
  });

  it('a Voice at 0 HP is no longer one the choir counts', () => {
    const units = voices();
    const state = { ...createVigilState(), broken: { c_w: 1 } };
    for (const u of units.slice(0, 3)) u.currentHP = 0;
    expect(wardOf(VIGIL, state, units, units[3])).toMatchObject({ circle: false, choir: false });
  });

  it('only Voices are stamped; with the shields off every stamp is taken away', () => {
    const guard = { ...voice('guard', 1, 1), authoredId: undefined };
    const units = [...voices(), guard];
    applyVigilWards(VIGIL, createVigilState(), units);
    expect(guard).not.toHaveProperty('warded');
    applyVigilWards(PLAIN, createVigilState(), units);
    expect(units.some((u) => 'warded' in u || 'wardReason' in u)).toBe(false);
  });

  it('idempotent: a second pass raises and drops nothing', () => {
    const units = voices();
    applyVigilWards(VIGIL, createVigilState(), units);
    expect(applyVigilWards(VIGIL, createVigilState(), units)).toEqual({ raised: [], dropped: [] });
  });

  it('the circles still to break: standing ones of living Voices, none with wards off', () => {
    const state = { ...createVigilState(), broken: { c_e: 2 } };
    const noSouth = voices().filter((v) => v.authoredId !== 'v_s');
    expect(openWardCircles(VIGIL, state, noSouth).map((c) => c.id)).toEqual(['c_n', 'c_w']);
    expect(openWardCircles(PLAIN, state, noSouth)).toEqual([]);
  });

  it('the unit card says what holds the ward', () => {
    expect(wardInfo({ warded: true, wardReason: 'circle', currentHP: 5 }).text).toMatch(/circle/);
    expect(wardInfo({ warded: true, wardReason: 'choir', currentHP: 5 }).text).toMatch(
      /another Voice/,
    );
    expect(wardInfo({ warded: true, wardReason: 'both', currentHP: 5 }).text).toMatch(
      /another Voice.*circle/,
    );
    expect(wardInfo({ currentHP: 5 })).toBeNull();
  });
});

describe('the saved state', () => {
  it('keeps `broken` whole, drops a bad entry, writes none while nothing is broken', () => {
    const state = sanitizeVigilState({
      ...createVigilState(),
      broken: { c_n: 2, '': 1, c_e: -1, c_s: 'x' },
    });
    expect(state.broken).toEqual({ c_n: 2 });
    expect(sanitizeVigilState({ ...createVigilState(), broken: {} })).not.toHaveProperty('broken');
    expect(sanitizeVigilState(createVigilState())).not.toHaveProperty('broken');
  });
});

describe('a warded unit takes no damage', () => {
  const sword = { name: 'Iron Sword', type: 'Sword', might: 5, hit: 100, crit: 0, range: '1' };
  const drain = { ...sword, name: 'Nosferatu', special: 'Drains HP equal to damage dealt' };
  const unit = (name, extra = {}) => ({
    name,
    stats: { HP: 30, STR: 20, MAG: 0, SKL: 10, SPD: 10, DEF: 2, RES: 2, LCK: 0 },
    currentHP: 30,
    weapon: sword,
    proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    skills: [],
    ...extra,
  });

  it('a strike and a crit land for 0 and say so; the attacker heals nothing back', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const attacker = unit('A', { currentHP: 10, weapon: drain });
    const defender = unit('V', { warded: true });
    const result = resolveCombat(attacker, drain, defender, sword, 1, null, null);
    const strikes = result.events.filter((e) => e.attacker === 'A' && !e.miss);
    expect(strikes.length).toBeGreaterThan(0);
    for (const e of strikes) expect(e).toMatchObject({ damage: 0, warded: true });
    expect(result.defenderHP).toBe(30);
    expect(result.attackerHP).toBeLessThanOrEqual(10);
    // A skill that adds to the blow adds nothing to 0.
    const boost = { rollStrikeSkills: (_s, d) => ({ modifiedDamage: d + 10, activated: [] }) };
    const boosted = unit('V', { warded: true });
    expect(resolveCombat(unit('A'), sword, boosted, sword, 1, null, null, boost).defenderHP).toBe(
      30,
    );
    // The same blow on an unwarded unit does damage (the test can fail).
    const plain = resolveCombat(unit('A'), sword, unit('V'), sword, 1, null, null);
    expect(plain.defenderHP).toBeLessThan(30);
  });

  it('the forecast flags it, deals 0, and its note says why', () => {
    const defender = unit('V', { warded: true });
    const fc = getCombatForecast(unit('A'), sword, defender, sword, 1, null, null);
    expect(fc.defender.warded).toBe(true);
    expect(fc.attacker.damage).toBe(0);
    expect(forecastNotes(fc, true, 30)).toContain(WARDED_FORECAST_NOTE);
    expect(calculateDamage(unit('A'), sword, defender, null)).toBe(0);
    const open = getCombatForecast(unit('A'), sword, unit('V'), sword, 1, null, null);
    expect(open.defender).not.toHaveProperty('warded');
    expect(forecastNotes(open, true, 30)).not.toContain(WARDED_FORECAST_NOTE);
  });

  it('a weapon’s after-combat poison passes it by, attacking or countering, through the HP commit', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const venom = data.weapons.find(
      (w) => w.type === 'Sword' && /Poison: target loses (\d+) HP/i.test(w.special || ''),
    );
    expect(venom).toBeTruthy();
    const dose = Number(venom.special.match(/loses (\d+) HP/i)[1]);
    // SKL and LCK 0: no crit, so every exchange leaves both sides standing (poison needs that).
    const steady = (name, extra = {}) =>
      unit(name, { ...extra, stats: { ...unit(name).stats, SKL: 0, ...extra.stats } });
    const settle = (attacker, atkWeapon, defender, defWeapon) => {
      const result = resolveCombat(attacker, atkWeapon, defender, defWeapon, 1, null, null);
      applyCombatHP(attacker, defender, result);
      expect(attacker.currentHP).toBeGreaterThan(0);
      expect(defender.currentHP).toBeGreaterThan(0);
      return result;
    };

    // The poisoner attacks a warded Voice: its blows land for 0, its poison takes nothing.
    const voice = steady('V', { warded: true });
    const hit = settle(steady('A', { weapon: venom }), venom, voice, sword);
    expect(hit.events.some((e) => e.attacker === 'A' && !e.miss)).toBe(true);
    expect(hit.poisonEffects).toEqual([]);
    expect(voice.currentHP).toBe(30);

    // A warded Voice attacks the poisoner, whose counter lands: no poison on the Voice either.
    const striker = steady('V', { warded: true });
    const counter = settle(striker, sword, steady('D', { weapon: venom }), venom);
    expect(counter.events.some((e) => e.attacker === 'D' && !e.miss)).toBe(true);
    expect(counter.poisonEffects).toEqual([]);
    expect(striker.currentHP).toBe(30);

    // The same exchanges on unwarded units whose armour stops the blows do poison (the test
    // can fail): the poison is all the HP they lose.
    const tough = { DEF: 40, RES: 40 };
    const open = steady('V', { stats: tough });
    settle(steady('A', { weapon: venom }), venom, open, sword);
    expect(open.currentHP).toBe(30 - dose);
    const bare = steady('V', { stats: tough });
    settle(bare, sword, steady('D', { weapon: venom }), venom);
    expect(bare.currentHP).toBe(30 - dose);
  });

  it('area blows, Deathburst and ground damage (damageUnit) pass it by', () => {
    const v = unit('V', { warded: true });
    expect(damageUnitDetailed(v, 50)).toMatchObject({ lost: 0, warded: true });
    damageUnit(v, 50);
    expect(v.currentHP).toBe(30);
    const open = unit('V');
    damageUnit(open, 50);
    expect(open.currentHP).toBe(0);
  });

  it('an art’s "HP -> N" leaves it whole', () => {
    const art = {
      targeting: 'normal_attack',
      effects: { afterCombat: [{ type: 'set_hp', target: 'defender', value: 1 }] },
    };
    const run = (defender) => {
      const attacker = { ...unit('A'), col: 0, row: 0 };
      const result = { events: [{ type: 'strike', attackerSide: 'attacker', miss: false }] };
      return [...postCombatEffects({ attacker, defender, result, attackerWeaponArt: art }, { skillsData: [] })]; // prettier-ignore
    };
    const v = { ...unit('V', { warded: true }), col: 1, row: 0 };
    run(v);
    expect(v.currentHP).toBe(30);
    const open = { ...unit('V'), col: 1, row: 0 };
    run(open);
    expect(open.currentHP).toBe(1);
  });

  it('the floating number reads "Warded"', () => {
    const n = combatNumberStyle('warded', 0);
    expect([n.kind, n.text]).toEqual(['warded', 'Warded']);
  });
});

describe('the set piece carries the shields', () => {
  const piece = DEV_SET_PIECE_FIXTURES.dev_vigil;
  const shielded = () => {
    const gameData = structuredClone(withDevSetPiece(data, 'dev_vigil'));
    const vigil = gameData.setPieces.setPieces.find((p) => p.id === piece.id).variants[0].vigil;
    Object.assign(vigil, { wards: true, choir: true });
    return { gameData, vigil };
  };

  it('wards and choir reach the locked config; a piece without them has neither', () => {
    const { gameData } = shielded();
    const params = { act: 'finalBoss', objective: 'rout', setPiece: 'dev_vigil', difficultyId: 'hard', deployCount: 3, levelRange: [12, 14] }; // prettier-ignore
    expect(generateSeededBattle(params, gameData, 5).vigil).toMatchObject({
      wards: true,
      choir: true,
    });
    const plain = buildSetPieceBattle({ setPiece: piece, act: 'finalBoss', difficultyId: 'hard', levelRange: [1, 1], deployCount: 3, classes: data.classes, terrain: data.terrain, random: () => 0.1 }); // prettier-ignore
    expect(plain.vigil).not.toHaveProperty('wards');
    expect(plain.vigil).not.toHaveProperty('choir');
  });

  it('the validator refuses a non-boolean, a warded Voice with no circle, a choir with no Waking', () => {
    const errorsFor = (edit) => {
      const { gameData, vigil } = shielded();
      edit(vigil);
      return validateSetPiecesConfig(gameData.setPieces, gameData).errors.join('\n');
    };
    expect(errorsFor(() => {})).toBe('');
    expect(errorsFor((v) => (v.wards = 'yes'))).toMatch(/wards must be true or false/);
    expect(errorsFor((v) => (v.choir = 1))).toMatch(/choir must be true or false/);
    expect(errorsFor((v) => v.circles.shift())).toMatch(/has no circle to break/);
    expect(errorsFor((v) => v.sigils.forEach((s) => delete s.waking))).toMatch(
      /choir needs a Waking sigil/,
    );
  });
});

describe('the shipped Vigil: platforms over the Abyss', () => {
  const vigilPiece = data.setPieces.setPieces.find((p) => p.id === 'the_vigil');
  const variant = vigilPiece.variants[0];
  const abyss = data.terrain[TERRAIN.Abyss];

  it('the Abyss: index 19, only a flier crosses it', () => {
    expect(TERRAIN.Abyss).toBe(19);
    expect(abyss.name).toBe('Abyss');
    for (const move of ['Infantry', 'Armored', 'Cavalry']) expect(abyss.moveCost[move]).toBe('--');
    expect(abyss.moveCost.Flying).toBe('1');
  });

  it('wards and the choir on, on every rung; every Voice has a circle', () => {
    expect(variant.vigil).toMatchObject({ wards: true, choir: true });
    for (const s of variant.vigil.sigils)
      expect(
        variant.vigil.circles.some((c) => c.voice === s.target),
        s.target,
      ).toBe(true);
    for (const difficultyId of ['normal', 'dusk', 'hard', 'lunatic']) {
      const params = { act: 'finalBoss', objective: 'rout', setPiece: 'the_vigil', difficultyId, deployCount: 8, levelRange: [14, 16] }; // prettier-ignore
      const config = generateSeededBattle(params, data, 11);
      expect(config.vigil, difficultyId).toMatchObject({ wards: true, choir: true });
      expect(config.mapLayout.flat(), difficultyId).toContain(TERRAIN.Abyss);
    }
  });

  it('each Voice’s circle is far from it: no circle on its own Voice’s platform', () => {
    const { sigils, circles } = variant.vigil;
    for (const c of circles) {
      const s = sigils.find((x) => x.target === c.voice);
      expect(Math.abs(s.col - c.col) + Math.abs(s.row - c.row), c.id).toBeGreaterThanOrEqual(8);
    }
  });

  it('the guards climb with the rung: First Light leaves the near circles unguarded; par allows the breaks', () => {
    const guardsAt = (difficultyId) => {
      const params = { act: 'finalBoss', objective: 'rout', setPiece: 'the_vigil', difficultyId, deployCount: 8, levelRange: [14, 16] }; // prettier-ignore
      const config = generateSeededBattle(params, data, 11);
      expect(config.parBonus, difficultyId).toBe(2);
      return config.enemySpawns.filter((s) => !String(s.authoredId ?? '').startsWith('voice_'));
    };
    const counts = ['normal', 'dusk', 'hard', 'lunatic'].map((d) => guardsAt(d).length);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect(counts[0]).toBeLessThan(counts[1]);
    // The guards by the two circles nearest the army stand from Dusk up.
    const near = (spawns) => spawns.filter((s) => s.col === 3 && (s.row === 2 || s.row === 11));
    expect(near(guardsAt('normal'))).toEqual([]);
    expect(near(guardsAt('dusk'))).toHaveLength(2);
  });

  it('seats the largest army a run can field: every deploy bonus at once', () => {
    // Counted from the data: the act's max, every meta deploy bonus, every blessing that widens it.
    const metaBonus = data.metaUpgrades
      .flatMap((u) => u.effects || [])
      .reduce((sum, e) => sum + Math.max(0, e.deployBonus || 0), 0);
    const blessingBonus = data.blessings.blessings
      .flatMap((b) => b.boons || b.effects || [])
      .filter((e) => e.type === 'deploy_cap_delta')
      .reduce((sum, e) => sum + Math.max(0, e.params?.value || 0), 0);
    const largest = DEPLOY_LIMITS.finalBoss.max + metaBonus + blessingBonus;
    expect(SET_PIECE_MAX_DEPLOY).toBe(largest);
    const params = { act: 'finalBoss', objective: 'rout', setPiece: 'the_vigil', difficultyId: 'hard', deployCap: vigilPiece.deploy.max, levelRange: [14, 16] }; // prettier-ignore
    const limits = resolveDeployLimits({
      base: deployLimitsForParams(params),
      deployBonus: metaBonus + blessingBonus,
    });
    expect(limits.max).toBe(largest);
    for (const seed of [11, 12]) {
      const config = generateSeededBattle({ ...params, deployCount: largest }, data, seed);
      const tiles = new Set(config.playerSpawns.map((t) => `${t.col},${t.row}`));
      expect(tiles.size, `seed ${seed}`).toBe(largest);
      for (const t of config.playerSpawns)
        expect(config.mapLayout[t.row][t.col], `${t.col},${t.row}`).not.toBe(TERRAIN.Abyss);
    }
  });

  it('the data validates (circles reachable on foot, the map in bounds)', () => {
    expect(validateSetPiecesConfig(data.setPieces, data).errors).toEqual([]);
  });
});
