// Prologue P4, "The Quarry Gate" (docs/specs/prologue-chapter.md §6 P4, §8): the harness
// owns the final tiles and numbers. Four units for three spawns (the first deploy screen;
// Edric always fields), then the first formation; Captain Varro, the prologue's own
// boss, holds the throne (a Fighter at level 1 with the boss bonus and STR 7, an Iron
// Axe), a Fighter guards the gate's approach and another comes for the army. Seize:
// Varro falls, then a lord takes the gate. Played through the real engine (HeadlessBattle
// on the locked config) from the replay's canned roster and from P3's real end states
// (both policies), after the watchtower's Rest, with every deploy the screen allows, and
// before the boss's enrage turn. The watchtower's Scavenge (HP carries) is
// PrologueP4Scavenge.test.js.
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
  reckless,
  gasparAlone,
  equipAgainstAxes,
  p3EndStates,
  afterWatchtower,
  tally,
  enrageTurn,
  report,
  PROTECTED,
  DEPLOYS,
} from './prologueP4Policies.js';
import { finishPhase, moveAndWait } from './prologueP3Policies.js';
import { buildPrologueRoster } from '../../src/engine/Prologue.js';

afterEach(() => restoreMathRandom());

const terrain = (name) => data.terrain.find((t) => t.name === name);
const weapon = (name) => data.weapons.find((w) => w.name === name);
const RECOMMENDED = ['Edric', 'Gaspar', 'Sera'];
const label = (deploy) => deploy.join('+');
// Measured floors (the spec's §6 P4 table records the numbers): the seeds the sword wins
// over the lance, and the seeds a reckless play loses with each three-unit deploy.
const LANCE_GAP = 8;
const RECKLESS_LOSSES = { 'Edric+Gaspar+Sera': 5, 'Edric+Gaspar+Tamsin': 4, 'Edric+Tamsin+Sera': 25 }; // prettier-ignore

describe('Prologue P4: The Quarry Gate', () => {
  it("the spec's numbers hold: Varro's kit and stats, the throne, his blows, par 10 and enrage on 12", () => {
    const battle = startP4(prologue.seed, { deploy: RECOMMENDED });
    const v = boss(battle);
    // The prologue's own boss: in no act pool, a level 1 Fighter with the boss bonus,
    // and the STR and SKL the chapter is tuned on (authored: `stats` on his spawn).
    expect(JSON.stringify(data.enemies)).not.toContain('Captain Varro');
    expect([v.name, v.className, v.level, v.weapon.name]).toEqual(['Captain Varro', 'Fighter', 1, 'Iron Axe']); // prettier-ignore
    const fighter = data.classes.find((c) => c.name === 'Fighter').baseStats;
    expect(v.stats).toEqual({ ...Object.fromEntries(Object.entries(fighter).map(([k, x]) => [k, x + 2])), STR: 7, SKL: 3 }); // prettier-ignore
    expect(v.stats).toMatchObject({ HP: 24, STR: 7, SKL: 3, SPD: 7, DEF: 6, RES: 3, LCK: 4 });
    expect(v.currentHP).toBe(24);
    expect(throne(battle)).toEqual({ col: 9, row: 0 });
    expect(onThrone(battle, v)).toBe(true);
    const seat = battle.grid.getTerrainAt(9, 0);
    expect(seat.name).toBe('Throne');
    expect([Number(seat.defBonus), Number(seat.avoidBonus)]).toEqual([3, 15]);
    expect(seat.special).toContain('Heals 10%');
    // His blow on plain ground: STR + the axe's might - DEF, a sword's triangle edge
    // taking 1 off (swords beat axes). The chapter's whole garrison carries axes.
    const axe = weapon('Iron Axe');
    const blow = (u) =>
      getCombatForecast(v, v.weapon, u, u.weapon, 1, terrain('Plain'), terrain('Plain')).attacker
        .damage;
    const edric = unit(battle, 'Edric');
    const gaspar = unit(battle, 'Gaspar');
    const sera = unit(battle, 'Sera');
    expect(blow(edric)).toBe(7 + axe.might - edric.stats.DEF - 1);
    expect(blow(gaspar)).toBe(7 + axe.might - gaspar.stats.DEF - 1);
    expect(blow(sera)).toBe(7 + axe.might - sera.stats.DEF);
    expect([blow(edric), blow(gaspar), blow(sera)]).toEqual([8, 7, 11]);
    // Three enemies on a 13 × 7 seize map: par 10, the boss enrages on turn 12
    // (max(10 + 1, min(12, 10 + 2)): the par + 1 floor does not bind).
    expect(battle.turnPar).toBe(10);
    expect(enrageTurn(battle)).toBe(12);
    // The rest of the garrison: the gate's guard and one Fighter that comes. No bow, no
    // lance: every foe the army meets carries an axe.
    const kit = (id) => {
      const e = enemy(battle, id);
      return [e.className, e.level, e.weapon.name, e.aiMode || 'chase', e.col, e.row];
    };
    expect(battle.enemyUnits.map((e) => e.authoredId).sort()).toEqual(['a', 'k', 'v']);
    expect(kit('k')).toEqual(['Fighter', 1, 'Iron Axe', 'guard', 9, 3]);
    expect(kit('a')).toEqual(['Fighter', 1, 'Iron Axe', 'chase', 8, 6]);
    expect(battle.enemyUnits.every((e) => e.weapon.type === 'Axe')).toBe(true);
    // Only Varro's stats are authored: the Fighters are the class at level 1.
    for (const id of ['k', 'a']) expect(enemy(battle, id).stats).toEqual(fighter);
  });

  it('the deploy screen: four units, three spawns, Edric fields first, nearest the road the Fighter comes by', () => {
    expect(chapter.roster).toEqual(['Edric', 'old_knight', 'Tamsin', 'Sera']);
    expect(chapter.playerSpawns).toEqual([
      { col: 0, row: 6 },
      { col: 0, row: 5 },
      { col: 0, row: 4 },
    ]);
    expect(chapter.deploy).toEqual({ min: 2, note: 'p4_deploy' });
    const roster = buildPrologueRoster(prologue, data, chapter);
    expect(roster.map((u) => `${u.name} L${u.level}`)).toEqual(['Edric L3', 'Gaspar L1', 'Tamsin L1', 'Sera L2']); // prettier-ignore
    // The replay's Gaspar holds his sword (what the roster lesson and the deploy note
    // have the run's Gaspar do): swords beat axes.
    expect(roster.find((u) => u.name === 'Gaspar').weapon.name).toBe('Iron Sword');
    expect(roster.find((u) => u.name === 'Tamsin').weapon.name).toBe('Iron Bow');
    // Every fielded unit is protected (its fall restarts the chapter at the deploy screen).
    expect([...PROTECTED()].sort()).toEqual(['Edric', 'Gaspar', 'Sera', 'Tamsin']);
    // The deploy screen fields in roster order, so the commander takes the first spawn:
    // the bottom one, on the row the Fighter walks in by. The last unit picked (Sera or
    // Tamsin) stands furthest from it.
    for (const deploy of DEPLOYS) {
      const battle = startP4(prologue.seed, { deploy });
      const at = (name) => {
        const u = unit(battle, name);
        return { col: u.col, row: u.row };
      };
      expect(at('Edric'), label(deploy)).toEqual({ col: 0, row: 6 });
      const chaser = enemy(battle, 'a');
      expect(chaser.row).toBe(6);
      const last = deploy.at(-1);
      if (last !== 'Edric' && deploy.length === 3)
        expect(at(last), label(deploy)).toEqual({ col: 0, row: 4 });
    }
  });

  it("Sera's Glimmer from 2 tiles hits Varro on the throne and draws no counter", () => {
    const battle = startP4(prologue.seed, { deploy: RECOMMENDED });
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

  it("the gate's guard holds its post until someone comes within 3 tiles; the other Fighter comes", async () => {
    const battle = startP4(prologue.seed, { deploy: RECOMMENDED });
    const post = (id) => ({ col: enemy(battle, id).col, row: enemy(battle, id).row });
    const posts = { k: post('k'), a: post('a') };
    // Everyone waits on the spawns: the guard holds, Varro keeps the throne, `a` comes.
    for (const name of RECOMMENDED) {
      battle.selectUnit(name);
      moveAndWait(battle, unit(battle, name));
    }
    await finishPhase(battle);
    expect(post('k')).toEqual(posts.k);
    expect(onThrone(battle, boss(battle))).toBe(true);
    expect(post('a')).not.toEqual(posts.a);
    // Gaspar stands 3 tiles from the gate's guard: it answers.
    const gaspar = unit(battle, 'Gaspar');
    Object.assign(gaspar, { col: 9, row: 6 });
    expect(gridDistance(9, 6, posts.k.col, posts.k.row)).toBe(3);
    for (const name of RECOMMENDED) {
      battle.selectUnit(name);
      moveAndWait(battle, unit(battle, name));
    }
    const hp = gaspar.currentHP;
    await finishPhase(battle);
    // It came for him: off its post, or fallen to his counter.
    const k = enemy(battle, 'k');
    expect(!k || k.currentHP <= 0 || k.col !== posts.k.col || k.row !== posts.k.row).toBe(true);
    expect(!k || k.currentHP <= 0 || gaspar.currentHP < hp || gridDistance(k.col, k.row, 9, 6) === 1).toBe(true); // prettier-ignore
  });

  it('the intended play wins with every deploy, before the enrage turn (Rest)', async () => {
    const replay = await tally(intended, null, { deploy: RECOMMENDED });
    report(`intended, replay, ${label(RECOMMENDED)}`, replay);
    expect(replay.wins).toBeGreaterThanOrEqual(SEEDS * 0.95);
    expect(replay.enraged).toBe(0);
    for (const deploy of DEPLOYS.slice(1)) {
      const t = await tally(intended, null, { seeds: 100, deploy });
      report(`intended, replay, ${label(deploy)}`, t);
      expect(t.wins, label(deploy)).toBeGreaterThanOrEqual(t.total * 0.95);
    }
    for (const policyEnds of ['intended', 'naive']) {
      const ends = (await p3EndStates({ policy: policyEnds })).map((u) => afterWatchtower(u));
      for (const deploy of DEPLOYS) {
        const t = await tally(intended, ends, { seeds: 100, deploy });
        report(`intended after ${policyEnds} P3, Rest, ${label(deploy)}`, t);
        expect(t.wins, label(deploy)).toBeGreaterThanOrEqual(t.total * 0.95);
        expect(t.deaths.Edric || 0, label(deploy)).toBeLessThanOrEqual(1);
      }
    }
  }, 1800000);

  it('the naive play wins with every deploy, before the enrage turn (Rest)', async () => {
    for (const deploy of DEPLOYS) {
      const replay = await tally(naive, null, { seeds: 100, deploy });
      report(`naive, replay, ${label(deploy)}`, replay);
      expect(replay.wins, label(deploy)).toBeGreaterThanOrEqual(replay.total * 0.95);
    }
    for (const policyEnds of ['intended', 'naive']) {
      const ends = (await p3EndStates({ policy: policyEnds })).map((u) => afterWatchtower(u));
      for (const deploy of DEPLOYS) {
        const t = await tally(naive, ends, { seeds: 100, deploy });
        report(`naive after ${policyEnds} P3, Rest, ${label(deploy)}`, t);
        // Every deploy clears §8's forgiving bar with room; with Gaspar fielded the
        // naive play still wins as it did before the retune.
        expect(t.wins, label(deploy)).toBeGreaterThanOrEqual(t.total * 0.92);
      }
    }
  }, 1800000);

  it("the deploy note's sword matters: Gaspar on his lance against the axes loses the naive play seeds", async () => {
    // Without the note's habit (the lance P3's naive play leaves in his hand), the naive
    // play loses more seeds: the reason the note says it and the replay holds the sword.
    const ends = (await p3EndStates({ policy: 'naive' })).map((u) => afterWatchtower(u));
    expect(ends.every((r) => r.find((u) => u.name === 'Gaspar').weapon.name === 'Steel Lance')).toBe(true); // prettier-ignore
    const bare = Object.assign((b, u, tiles) => naive(b, u, tiles), { orderFor: naive.orderFor });
    const deploy = ['Edric', 'Gaspar', 'Tamsin'];
    const lance = await tally(bare, ends, { seeds: 100, deploy });
    report(`naive after naive P3, Rest, ${label(deploy)}, Gaspar on his lance`, lance);
    const sword = await tally(naive, ends, { seeds: 100, deploy });
    report(`naive after naive P3, Rest, ${label(deploy)}, Gaspar on his sword`, sword);
    expect(sword.wins).toBeGreaterThan(lance.wins + LANCE_GAP);
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
    await tally(intended, null, { seeds: 100, deploy: RECOMMENDED, onPhaseEnd: guard });
    const ends = (await p3EndStates({ policy: 'intended' })).map((u) => afterWatchtower(u));
    await tally(intended, ends, { seeds: 100, deploy: RECOMMENDED, onPhaseEnd: guard });
  }, 600000);

  it('the chapter still needs positioning: reckless play loses units, and Gaspar alone falls', async () => {
    // §2 "the veteran supports, never solves", and the forgiving bar is not a free win:
    // a play that ignores the forecast, Danger and healing (every unit strikes the
    // nearest foe from the cheapest tile) loses a share of seeds with every deploy, and
    // Gaspar riding at the garrison alone falls in a share of them.
    const rested = (await p3EndStates({ policy: 'intended' })).map((u) => afterWatchtower(u));
    for (const deploy of DEPLOYS.slice(0, 3)) {
      const t = await tally(reckless, rested, { seeds: 100, deploy });
      report(`reckless after intended P3, Rest, ${label(deploy)}`, t);
      expect(t.total - t.wins, label(deploy)).toBeGreaterThanOrEqual(RECKLESS_LOSSES[label(deploy)]); // prettier-ignore
    }
    for (const roster of [null, rested]) {
      const t = await tally(gasparAlone, roster, { seeds: 100, deploy: RECOMMENDED });
      report(`Gaspar alone, ${roster ? 'after intended P3, Rest' : 'replay'}`, t);
      expect(t.deaths.Gaspar || 0).toBeGreaterThanOrEqual(5);
    }
  }, 600000);
});
