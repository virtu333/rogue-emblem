// Prologue P4, "The Quarry Gate" (docs/specs/prologue-chapter.md §6 P4, §8): the harness
// owns the final tiles and numbers. Four units for three spawns (the first deploy screen;
// Edric always fields), then the first formation; Captain Varro, the prologue's own
// boss, holds the throne (a Fighter at level 1 with the boss bonus, an Iron Axe), a
// Soldier guards the gate's approach, an Archer and a Fighter guard their posts, one
// Fighter chases. Seize: Varro falls, then a lord takes the gate. Played through the real
// engine (HeadlessBattle on the locked config) from the replay's canned roster and from
// P3's real end states (both policies), after the watchtower's Rest or its Scavenge,
// with every deploy that fields Gaspar, and before the boss's enrage turn.
import { afterEach, describe, expect, it } from 'vitest';
import { restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import { getCombatForecast, gridDistance } from '../../src/engine/Combat.js';
import {
  prologue,
  chapter,
  data,
  SEEDS,
  startP4,
  boss,
  enemy,
  unit,
  throne,
  onThrone,
  exposure,
  intended,
  naive,
  equipAgainstAxes,
  p3EndStates,
  afterWatchtower,
  tally,
  enrageTurn,
  report,
  PROTECTED,
} from './prologueP4Policies.js';
import { finishPhase, moveAndWait, stoppableTiles } from './prologueP3Policies.js';
import { buildPrologueRoster } from '../../src/engine/Prologue.js';

afterEach(() => restoreMathRandom());

const terrain = (name) => data.terrain.find((t) => t.name === name);
const weapon = (name) => data.weapons.find((w) => w.name === name);
/** Every deploy the screen allows that fields Gaspar (Edric always fields). */
const WITH_GASPAR = [
  ['Edric', 'Gaspar', 'Sera'],
  ['Edric', 'Gaspar', 'Tamsin'],
  ['Edric', 'Gaspar'],
];

describe('Prologue P4: The Quarry Gate', () => {
  it("the spec's numbers hold: Varro's kit and stats, the throne, par 11 and enrage on 12", () => {
    const battle = startP4(prologue.seed);
    const v = boss(battle);
    // The prologue's own boss: in no act pool, a level 1 Fighter with the boss bonus.
    expect(JSON.stringify(data.enemies)).not.toContain('Captain Varro');
    expect([v.name, v.className, v.level, v.weapon.name]).toEqual(['Captain Varro', 'Fighter', 1, 'Iron Axe']); // prettier-ignore
    expect(v.stats).toMatchObject({ HP: 24, STR: 10, SKL: 5, SPD: 7, DEF: 6, RES: 3, LCK: 4 });
    expect(throne(battle)).toEqual({ col: 9, row: 0 });
    expect(onThrone(battle, v)).toBe(true);
    const seat = battle.grid.getTerrainAt(9, 0);
    expect(seat.name).toBe('Throne');
    expect([Number(seat.defBonus), Number(seat.avoidBonus)]).toEqual([3, 15]);
    expect(seat.special).toContain('Heals 10%');
    expect(battle.turnPar).toBe(11);
    expect(enrageTurn(battle)).toBe(Math.min(data.turnBonus.latePressure.bossEnrageTurn, 11 + data.turnBonus.latePressure.bossEnrageOverPar)); // prettier-ignore
    expect(enrageTurn(battle)).toBe(12);
    // The rest of the garrison: the gate's guard, two posts, one chaser.
    const kit = (id) => {
      const e = enemy(battle, id);
      return [e.className, e.level, e.weapon.name, e.aiMode || 'chase', e.col, e.row];
    };
    expect(kit('k')).toEqual(['Soldier', 1, 'Iron Lance', 'guard', 9, 3]);
    expect(kit('r')).toEqual(['Archer', 1, 'Iron Bow', 'guard', 6, 2]);
    expect(kit('b')).toEqual(['Fighter', 1, 'Iron Axe', 'guard', 12, 5]);
    expect(kit('a')).toEqual(['Fighter', 1, 'Iron Axe', 'chase', 8, 6]);
  });

  it('the deploy screen: four units, three spawns, Edric fields; the replay holds the sword against axes', () => {
    expect(chapter.roster).toEqual(['Edric', 'old_knight', 'Tamsin', 'Sera']);
    expect(chapter.playerSpawns).toHaveLength(3);
    expect(chapter.deploy).toEqual({ min: 2, note: 'p4_deploy' });
    const roster = buildPrologueRoster(prologue, data, chapter);
    expect(roster.map((u) => `${u.name} L${u.level}`)).toEqual(['Edric L3', 'Gaspar L1', 'Tamsin L1', 'Sera L2']); // prettier-ignore
    // The replay's Gaspar holds his sword (what the roster lesson and the deploy note
    // have the run's Gaspar do): swords beat axes.
    expect(roster.find((u) => u.name === 'Gaspar').weapon.name).toBe('Iron Sword');
    expect(roster.find((u) => u.name === 'Tamsin').weapon.name).toBe('Iron Bow');
    // Every fielded unit is protected (its fall restarts the chapter at the deploy screen).
    expect([...PROTECTED()].sort()).toEqual(['Edric', 'Gaspar', 'Sera', 'Tamsin']);
  });

  it("Sera's Glimmer from 2 tiles hits Varro on the throne and draws no counter", () => {
    const battle = startP4(prologue.seed, { deploy: ['Edric', 'Gaspar', 'Sera'] });
    const v = boss(battle);
    const s = unit(battle, 'Sera');
    const seat = terrain('Throne');
    const plain = terrain('Plain');
    const f = getCombatForecast(s, s.weapon, v, v.weapon, 2, plain, seat);
    expect(f.defender.canCounter).toBe(false);
    // MAG + Glimmer's might - RES - the throne's 3 (terrain defense guards RES too).
    expect(f.attacker.damage).toBe(s.stats.MAG + weapon('Glimmer').might - v.stats.RES - 3);
    expect(f.attacker.damage).toBeGreaterThan(0);
    // In melee his axe answers.
    expect(getCombatForecast(s, s.weapon, v, v.weapon, 1, plain, seat).defender.canCounter).toBe(true); // prettier-ignore
  });

  it('the guards hold their posts until someone comes within 3 tiles; the chaser comes', async () => {
    const battle = startP4(prologue.seed, { deploy: ['Edric', 'Gaspar', 'Sera'] });
    const post = (id) => ({ col: enemy(battle, id).col, row: enemy(battle, id).row });
    const posts = { k: post('k'), r: post('r'), b: post('b'), a: post('a') };
    // Everyone waits on the spawns: no guard stirs, Varro keeps the throne, the chaser comes.
    for (const name of ['Edric', 'Gaspar', 'Sera']) {
      battle.selectUnit(name);
      moveAndWait(battle, unit(battle, name));
    }
    await finishPhase(battle);
    for (const id of ['k', 'r', 'b']) expect(post(id), id).toEqual(posts[id]);
    expect(onThrone(battle, boss(battle))).toBe(true);
    expect(post('a')).not.toEqual(posts.a);
    // Gaspar stands 3 tiles from the gate's guard (and more than 3 from the other
    // posts): that guard answers, the others hold.
    const gaspar = unit(battle, 'Gaspar');
    Object.assign(gaspar, { col: 9, row: 6 });
    expect(gridDistance(9, 6, posts.k.col, posts.k.row)).toBe(3);
    for (const id of ['r', 'b'])
      expect(gridDistance(9, 6, posts[id].col, posts[id].row), id).toBeGreaterThan(3);
    for (const name of ['Edric', 'Gaspar', 'Sera']) {
      battle.selectUnit(name);
      moveAndWait(battle, unit(battle, name));
    }
    await finishPhase(battle);
    expect(post('k')).not.toEqual(posts.k);
    expect(post('r')).toEqual(posts.r);
    expect(post('b')).toEqual(posts.b);
  });

  it('the intended play wins with every deploy that fields Gaspar, before the enrage turn', async () => {
    const replay = await tally(intended, null, { deploy: WITH_GASPAR[0] });
    report('intended, replay, Edric+Gaspar+Sera', replay);
    expect(replay.wins).toBeGreaterThanOrEqual(SEEDS * 0.95);
    expect(replay.enraged).toBe(0);
    for (const policyEnds of ['intended', 'naive']) {
      const ends = (await p3EndStates({ policy: policyEnds })).map((u) => afterWatchtower(u));
      for (const deploy of WITH_GASPAR) {
        const t = await tally(intended, ends, { seeds: 100, deploy });
        report(`intended after ${policyEnds} P3, Rest, ${deploy.join('+')}`, t);
        expect(t.wins, deploy.join('+')).toBeGreaterThanOrEqual(t.total * 0.92);
        expect(t.deaths.Edric || 0, deploy.join('+')).toBeLessThanOrEqual(1);
      }
    }
  }, 900000);

  it('the naive play wins with every deploy that fields Gaspar, before the enrage turn', async () => {
    for (const deploy of WITH_GASPAR) {
      const replay = await tally(naive, null, { seeds: 100, deploy });
      report(`naive, replay, ${deploy.join('+')}`, replay);
      expect(replay.wins, deploy.join('+')).toBeGreaterThanOrEqual(replay.total * 0.95);
    }
    for (const policyEnds of ['intended', 'naive']) {
      const ends = (await p3EndStates({ policy: policyEnds })).map((u) => afterWatchtower(u));
      for (const deploy of WITH_GASPAR) {
        const t = await tally(naive, ends, { seeds: 100, deploy });
        report(`naive after ${policyEnds} P3, Rest, ${deploy.join('+')}`, t);
        expect(t.wins, deploy.join('+')).toBeGreaterThanOrEqual(t.total * 0.92);
      }
    }
  }, 900000);

  it("the deploy note's sword matters: Gaspar on his lance against the axes is what breaks the naive play", async () => {
    // Without the note's habit (the lance P3's naive play leaves in his hand), the naive
    // play loses most seeds: the reason the note says it and the replay holds the sword.
    const ends = (await p3EndStates({ policy: 'naive' })).map((u) => afterWatchtower(u));
    expect(ends.every((r) => r.find((u) => u.name === 'Gaspar').weapon.name === 'Steel Lance')).toBe(true); // prettier-ignore
    const bare = Object.assign((b, u, tiles) => naive(b, u, tiles), { orderFor: naive.orderFor });
    const lance = await tally(bare, ends, { seeds: 100, deploy: WITH_GASPAR[1] });
    report('naive after naive P3, Rest, Edric+Gaspar+Tamsin, Gaspar on his lance', lance);
    const sword = await tally(naive, ends, { seeds: 100, deploy: WITH_GASPAR[1] });
    expect(sword.wins).toBeGreaterThan(lance.wins + 30);
    // The habit itself: a lance against axes gives way to a carried sword.
    const roster = structuredClone(ends[0]);
    equipAgainstAxes(roster);
    expect(roster.find((u) => u.name === 'Gaspar').weapon.name).toBe('Iron Sword');
    expect(roster.find((u) => u.name === 'Edric').weapon.name).toBe('Iron Sword');
  }, 600000);

  it('safety: with the recommended deploy no run of hits and crits can kill Edric where the intended play leaves him', async () => {
    const guard = (b, seed) => {
      const u = unit(b, 'Edric');
      if (!u || !boss(b)) return;
      const worst = exposure(b, u, u, { crits: true });
      expect(worst, `seed ${seed}, turn ${b.turnManager.turnNumber}`).toBeLessThan(u.currentHP);
    };
    await tally(intended, null, { seeds: 100, deploy: WITH_GASPAR[0], onPhaseEnd: guard });
    const ends = (await p3EndStates({ policy: 'intended' })).map((u) => afterWatchtower(u));
    await tally(intended, ends, { seeds: 100, deploy: WITH_GASPAR[0], onPhaseEnd: guard });
  }, 600000);

  it('recorded, not required: Scavenge (HP carries) and deploys without Gaspar', async () => {
    // The watchtower's Scavenge leaves P3's wounds: with Sera fielded the army still
    // wins most seeds; without a healer, or without Gaspar, P4 is the hard road (a fall
    // restarts it at the deploy screen, where a different choice is open).
    const ends = (await p3EndStates({ policy: 'intended' })).map((u) =>
      afterWatchtower(u, { rest: false }),
    );
    const scav = await tally(intended, ends, { seeds: 100, deploy: WITH_GASPAR[0] });
    report('intended after intended P3, Scavenge, Edric+Gaspar+Sera', scav);
    expect(scav.wins).toBeGreaterThanOrEqual(80);
    for (const deploy of [WITH_GASPAR[1], WITH_GASPAR[2], ['Edric', 'Tamsin', 'Sera']]) {
      const t = await tally(intended, ends, { seeds: 50, deploy });
      report(`intended after intended P3, Scavenge, ${deploy.join('+')}`, t);
    }
    const rested = (await p3EndStates({ policy: 'intended' })).map((u) => afterWatchtower(u));
    const noGaspar = await tally(intended, rested, { seeds: 50, deploy: ['Edric', 'Tamsin', 'Sera'] }); // prettier-ignore
    report('intended after intended P3, Rest, Edric+Tamsin+Sera', noGaspar);
  }, 600000);
});
