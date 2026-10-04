// Prologue P3, "The Seer on the Road" (docs/specs/prologue-chapter.md §6 P3, §8): the
// harness owns the final tiles. Edric, Gaspar and Tamsin (fixed spawns, no formation)
// reach Sera, a green authored lord (buildPrologueNpcUnit: the builder BattleScene uses),
// Talk her into the army and rout the soldiers on her heels, through the real engine
// (HeadlessBattle on the locked config). Policies: the intended play (Talk, Sera heals
// and strikes from 2 tiles, Edric and Gaspar hold a line, Tamsin shoots from behind)
// and the naive play (walk Edric to Sera and Talk as the coach says, then attack the
// nearest enemy with the equipped weapon; Sera heals a hurt ally next to her; an unarmed
// unit waits). The chapter is entered as P2 and the row-2 fork can leave it: P2's real
// end states (both policies, both Edric levels), a full heal at the Chapel, the floor of
// what P2 can hand over, and Tamsin with and without her bow.
import { afterEach, describe, expect, it } from 'vitest';
import { HEADLESS_STATES } from './HeadlessBattle.js';
import { restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import { getCombatForecast, gridDistance } from '../../src/engine/Combat.js';
import {
  prologue,
  chapter,
  SEEDS,
  FOREST_PAIR,
  SAFE_TILE,
  key,
  enemy,
  unit,
  sera,
  terrain,
  startP3,
  stoppableTiles,
  forecastAt,
  worstDamage,
  reachers,
  exposure,
  talkTiles,
  naive,
  intended,
  PROTECTED,
  p2EndStates,
  enteringRoster,
  tally,
  report,
} from './prologueP3Policies.js';

afterEach(() => restoreMathRandom());

describe('Prologue P3: The Seer on the Road', () => {
  it("the spec's numbers hold: Glimmer 9 with no counter, a Soldier's 9 on Sera, magic past armour", () => {
    const battle = startP3(prologue.seed);
    const seer = sera(battle);
    const s = enemy(battle, 's');
    const plain = terrain('Plain');
    expect(seer.faction).toBe('npc');
    expect(seer.isLord).toBe(true);
    expect(seer.level).toBe(1);
    expect(seer.stats.HP).toBe(18);
    expect(seer.weapon.name).toBe('Glimmer');
    expect(seer.proficiencies.map((p) => p.type)).toEqual(['Light', 'Staff']);
    expect(seer.inventory.map((w) => w.name)).toEqual(['Glimmer', 'Heal']);
    expect(seer.consumables.map((c) => c.name)).toEqual(['Vulnerary']);
    expect(seer.skills).toContain('renewal_aura');
    // Glimmer from 2 tiles: 9 against a Soldier, and its lance can't answer.
    const glimmer = getCombatForecast(seer, seer.weapon, s, s.weapon, 2, plain, plain);
    expect(glimmer.attacker.damage).toBe(9);
    expect(glimmer.defender.canCounter).toBe(false);
    // Magic past armour: Edric's sword does 4 (DEF 6, the triangle against him).
    const edric = unit(battle, 'Edric');
    const sword = getCombatForecast(edric, edric.weapon, s, s.weapon, 1, plain, plain);
    expect(sword.attacker.damage).toBe(4);
    expect(glimmer.attacker.damage).toBeGreaterThan(sword.attacker.damage * 2);
    // One Soldier hit on Sera is 9 of her 18, no double, no crit: one hit never kills.
    const onSera = getCombatForecast(s, s.weapon, seer, seer.weapon, 1, plain, plain);
    expect([onSera.attacker.damage, onSera.attacker.attackCount, onSera.attacker.crit]).toEqual([9, 1, 0]); // prettier-ignore
    // Every enemy is a Soldier at level 1 with an Iron Lance, melee only.
    for (const e of battle.enemyUnits) {
      expect([e.className, e.level, e.weapon.name, e.weapon.range]).toEqual(['Soldier', 1, 'Iron Lance', '1']); // prettier-ignore
    }
  });

  it('fixed spawns: three units on three spawns (no formation), Sera green and authored', () => {
    expect(chapter.roster).toEqual(['Edric', 'old_knight', 'Tamsin']);
    expect(chapter.playerSpawns).toHaveLength(chapter.roster.length);
    const battle = startP3(prologue.seed);
    expect(battle.playerUnits.map((u) => [u.name, u.col, u.row])).toEqual(
      chapter.roster.map((key, i) => [
        key === 'old_knight' ? 'Gaspar' : key,
        chapter.playerSpawns[i].col,
        chapter.playerSpawns[i].row,
      ]),
    );
    expect(battle.npcUnits.map((u) => [u.name, u.col, u.row])).toEqual([
      ['Sera', chapter.npc.col, chapter.npc.row],
    ]);
    expect(PROTECTED.sort()).toEqual(['Edric', 'Gaspar', 'Sera', 'Tamsin']);
  });

  it('Edric reaches a tile next to Sera on turn 1 from his fixed spawn, and Talk is offered there', () => {
    const battle = startP3(prologue.seed);
    battle.selectUnit('Edric');
    const tiles = talkTiles(battle, stoppableTiles(battle));
    expect(tiles.length).toBeGreaterThan(0);
    battle.moveTo(tiles[0].col, tiles[0].row);
    expect(battle.getAvailableActions().map((a) => a.label)).toContain('Talk');
    battle.chooseAction('Talk');
    // She joins blue and acts at once.
    const seer = unit(battle, 'Sera');
    expect(seer?.faction).toBe('player');
    expect(seer.hasActed).toBe(false);
    expect(battle.battleState).toBe(HEADLESS_STATES.PLAYER_IDLE);
    battle.selectUnit('Sera');
    expect(battle.movementRange.size).toBeGreaterThan(1);
  });

  it('on enemy phase 1 only the Soldier reaches Sera, and no other enemy reaches the Talk tile', () => {
    const battle = startP3(prologue.seed);
    const seer = sera(battle);
    expect(reachers(battle, seer).map((e) => e.authoredId)).toEqual(['s']);
    battle.selectUnit('Edric');
    for (const t of talkTiles(battle, stoppableTiles(battle)))
      expect(
        reachers(battle, t).map((e) => e.authoredId),
        key(t),
      ).toEqual(['s']);
  });

  it('the threat exercise: the forest at the front is reached by exactly two far Soldiers, the safe tile by none', () => {
    const battle = startP3(prologue.seed);
    const far = (tile) => reachers(battle, tile).filter((e) => e.authoredId !== 's');
    for (const t of FOREST_PAIR) {
      expect(battle.grid.getTerrainAt(t.col, t.row).name, key(t)).toBe('Forest');
      expect(
        far(t)
          .map((e) => e.authoredId)
          .sort(),
        key(t),
      ).toEqual(['a', 'b']);
    }
    expect(battle.grid.getTerrainAt(SAFE_TILE.col, SAFE_TILE.row).name).toBe('Plain');
    expect(far(SAFE_TILE)).toEqual([]);
    // Both are 2 tiles from the Soldier at Sera's side (a Glimmer with no counter), and
    // within Sera's move once she joins.
    const s = enemy(battle, 's');
    expect(gridDistance(SAFE_TILE.col, SAFE_TILE.row, s.col, s.row)).toBe(2);
    expect(FOREST_PAIR.some((t) => gridDistance(t.col, t.row, s.col, s.row) === 2)).toBe(true);
    const seer = sera(battle);
    const reach = battle.grid.getMovementRange(
      seer.col,
      seer.row,
      seer.mov,
      seer.moveType,
      null,
      null,
    );
    expect(reach.has(key(SAFE_TILE))).toBe(true);
    expect(FOREST_PAIR.some((t) => reach.has(key(t)))).toBe(true);
    // In the forest, those two together can take Sera from full: count the eyes.
    const worst = far(FOREST_PAIR[0]).reduce((sum, e) => {
      Object.assign(seer, FOREST_PAIR[0]);
      return sum + worstDamage(forecastAt(battle, e, e, e.weapon, seer).attacker, { crits: false });
    }, 0);
    expect(worst).toBeGreaterThanOrEqual(seer.stats.HP - 2);
  });

  it('the intended script wins every seed from the replay, and (almost) every P2 end state', async () => {
    const replay = await tally(intended, null);
    report('intended, replay', replay);
    expect(replay.wins).toBe(replay.total);
    for (const name of ['Edric', 'Gaspar', 'Sera'])
      expect(replay.lows[name]).toBeGreaterThanOrEqual(5);
    // Entered as the intended P2 leaves it, through the Market (HP carries: Gaspar
    // often enters on a third of his HP) and through the Chapel (healed).
    const ends = await p2EndStates({ policy: 'intended' });
    const market = await tally(
      intended,
      ends.map((u) => enteringRoster(u)),
    );
    report('intended after intended P2, Market', market);
    expect(market.wins).toBeGreaterThanOrEqual(market.total * 0.99);
    const chapel = await tally(intended, ends.map((u) => enteringRoster(u, { chapel: true })), { seeds: 100 }); // prettier-ignore
    report('intended after intended P2, Chapel', chapel);
    expect(chapel.wins).toBe(chapel.total);
  }, 600000);

  it('safety: no run of hits and crits kills Edric or Sera from where the intended script leaves them', async () => {
    const guard = (b, seed) => {
      for (const name of ['Edric', 'Sera']) {
        const u = unit(b, name);
        if (!u) continue;
        const worst = exposure(b, u, u, { crits: true });
        expect(worst, `seed ${seed}, turn ${b.turnManager.turnNumber}, ${name}`).toBeLessThan(u.currentHP); // prettier-ignore
      }
    };
    await tally(intended, null, { seeds: 100, onPhaseEnd: guard });
  }, 300000);

  it('the naive policy wins (almost) every seed with nobody falling, entering as P2 leaves it', async () => {
    const replay = await tally(naive, null);
    report('naive, replay', replay);
    expect(replay.wins).toBeGreaterThanOrEqual(SEEDS * 0.98);
    // Entered as the naive P2 leaves it (Edric often on 5 HP with no Vulnerary left),
    // through either branch, Tamsin armed or not. P2's own "Edric at P1 stats" floor is
    // no state P3 can be entered with: P1 is Edric's alone, so he always leaves it at
    // level 2 (both Fighters' XP is his).
    const ends = await p2EndStates({ policy: 'naive' });
    for (const [label, opts, bound] of [
      ['Market, Tamsin armed', { armed: true }, 0.95],
      ['Market, Tamsin unarmed', { armed: false }, 0.95],
      ['Chapel', { chapel: true }, 0.98],
    ]) {
      const t = await tally(
        naive,
        ends.map((u) => enteringRoster(u, opts)),
        { seeds: 100 },
      );
      report(`naive after naive P2, ${label}`, t);
      expect(t.wins, label).toBeGreaterThanOrEqual(t.total * bound);
    }
  }, 600000);
});
