// The Old Sanctum (docs/specs/blessings-v3.md §6.3, decisions D-5 and D-6) and the Tithe Box: a
// church stamped from the run's second act on its own seeded stream, whose vow offers a pair of
// earned blessings in place of the tier I three. Real runs on the shipped data; the church menu
// through the journey driver (tests/harness/RunDriver.js: the real controller and menu, a
// recorded save).
//
// Each test names the realistic failure it catches.
import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';
import { RunDriver, JourneyStorage } from './harness/RunDriver.js';
import { RunManager, loadRun } from '../src/engine/RunManager.js';
import { isSanctum, sanctumCandidates, stampSanctum } from '../src/engine/SanctumPass.js';
import { extraShopCandidates } from '../src/engine/ExtraShopPass.js';
import { earnedPoolFor, openSanctum, sanctumLedgerKey } from '../src/engine/EarnedBlessings.js';
import {
  churchBlessingOffers,
  churchVow,
  sanctumBlessingBlock,
  sanctumBlessingOffers,
  sanctumEntry,
  sanctumStatus,
  takeChurchBlessing,
  takeSanctumBlessing,
} from '../src/engine/ChurchVow.js';
import { churchPromotionBlock } from '../src/engine/ChurchCommands.js';
import { payChurchTithe, sanitizeChurchTithes } from '../src/engine/ChurchTithe.js';
import { nodeLabel } from '../src/ui/RouteGraph.js';
import {
  describeLoomNode,
  loomShortLabel,
  SANCTUM_EMPTY_TEXT,
  SANCTUM_SPENT_TEXT,
  SANCTUM_TAKEN_TEXT,
  SANCTUM_TEXT,
} from '../src/ui/loomModel.js';
import { createUnit } from '../src/engine/UnitManager.js';
import { chooseEventOption } from '../src/engine/EventCommands.js';
import { isRedrawable, serviceStreakProblems } from '../src/engine/RouteEdit.js';
import { rebuildNodeAs } from '../src/engine/NodeMapGenerator.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { arriveAs } from './eventKit.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
afterEach(() => restoreMathRandom());

/** The game data with the sanctum's stamp chance set (1: every act from the second has one). */
function dataWithChance(chance) {
  const copy = structuredClone(data);
  copy.blessings.earnedOffer.sanctum = { chance };
  return copy;
}
function freshRun(seed = 7, { difficultyId = 'normal', gameData = dataWithChance(1) } = {}) {
  const rm = new RunManager(gameData);
  rm.startRun({ runSeed: seed, difficultyId, applyBlessingsAtStart: false });
  rm.blessingHistory = [];
  return rm;
}
const roundTrip = (rm) => RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), rm.gameData);
const sanctumOf = (rm) => rm.nodeMap.nodes.find((n) => n.sanctum === true) || null;
/** Advance to Act II (a seed whose Act II map holds a church to stamp). */
function inActTwo(seed, options) {
  const rm = freshRun(seed, options);
  rm.advanceAct();
  return rm;
}
function sanctumRun(seed = 7, options) {
  for (let s = seed; s < seed + 50; s++) {
    const rm = inActTwo(s, options);
    if (sanctumOf(rm)) return rm;
  }
  throw new Error('no sanctum stamped');
}

// ── Where it appears (D-5) ────────────────────────────────────────────────

describe('stamping the Old Sanctum', () => {
  it('never moves the node-map stream or Math.random: the map is the same but for the flag', () => {
    // Failure: the stamp draws from the node-map stream (every later map changes) or from
    // Math.random (every battle after the act advance changes).
    for (const seed of [3, 4, 5, 6, 7]) {
      // `chance` 1 stamps; null takes the pass out altogether (the map as it was before it).
      const advance = (chance) => {
        const rm = freshRun(seed, { gameData: dataWithChance(chance ?? 0) });
        if (chance === null) rm._stampSanctum = () => null;
        installSeed(9000 + seed);
        rm.advanceAct();
        const cursor = [Math.random(), Math.random(), Math.random()];
        restoreMathRandom();
        rm.advanceAct();
        return { rm, cursor, act3: JSON.stringify(rm.nodeMap) };
      };
      const on = advance(1);
      const off = advance(null);
      expect(on.cursor).toEqual(off.cursor);
      const strip = ({ sanctumRolled: _r, ...map }) =>
        JSON.stringify({
          ...map,
          nodes: map.nodes.map(({ sanctum: _s, ...node }) => node),
        });
      expect(strip(JSON.parse(on.act3))).toBe(strip(JSON.parse(off.act3)));
    }
  });

  it('lands from the second act only: never Act I, the final boss or the prologue', () => {
    // Failure: a sanctum appears in Act I (or on the final boss's map), or the prologue gets one.
    let stamped = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const rm = freshRun(seed);
      expect(sanctumOf(rm), `act1 seed ${seed}`).toBeNull();
      while (rm.actIndex < rm.actSequence.length - 1) {
        rm.advanceAct();
        const sanctum = sanctumOf(rm);
        if (rm.currentAct === 'finalBoss') expect(sanctum).toBeNull();
        else if (
          sanctumCandidates({ nodes: rm.nodeMap.nodes.map((n) => ({ ...n, sanctum: false })) })
            .length
        )
          expect(sanctum, `${rm.currentAct} seed ${seed}`).not.toBeNull();
        if (sanctum) stamped++;
        expect(rm.nodeMap.nodes.filter((n) => n.sanctum)).toHaveLength(sanctum ? 1 : 0);
      }
    }
    expect(stamped).toBeGreaterThan(30);
    const prologue = new RunManager(dataWithChance(1));
    prologue.startPrologue(prologue.gameData);
    expect(prologue._stampSanctum()).toBeNull();
    expect(sanctumOf(prologue)).toBeNull();
  });

  it("never in the run's last act on any rung (Dusk's Act IV included), as the act boss's pick", () => {
    // Failure: the guard names the final boss's act only, so a rung whose run ends elsewhere
    // (Dusk ends at the Emperor, Act IV) stamps a sanctum in its last act, where an earned card
    // has almost no road left to pay off.
    const finals = {};
    for (const difficultyId of ['normal', 'dusk', 'hard', 'lunatic']) {
      let earlier = 0;
      for (let seed = 1; seed <= 12; seed++) {
        const rm = freshRun(seed, { difficultyId });
        while (rm.actIndex < rm.actSequence.length - 1) {
          rm.advanceAct();
          const last = rm.actIndex === rm.actSequence.length - 1;
          const sanctum = sanctumOf(rm);
          if (last) {
            finals[difficultyId] = rm.currentAct;
            expect(sanctum, `${difficultyId} ${rm.currentAct} seed ${seed}`).toBeNull();
            // A church stood for it: only the rule kept it off (not a map without one).
            if (rm.currentAct !== 'finalBoss')
              expect(sanctumCandidates(rm.nodeMap).length).toBeGreaterThan(0);
          } else if (sanctum) earlier++;
        }
      }
      expect(earlier, difficultyId).toBeGreaterThan(0);
    }
    expect(finals).toEqual({
      normal: 'finalBoss',
      dusk: 'act4',
      hard: 'finalBoss',
      lunatic: 'finalBoss',
    });
    // The pass itself: the last act of the run takes none, whatever its id.
    const map = () => ({
      actId: 'act4',
      nodes: [{ id: 'c', type: 'church', row: 2, col: 0, edges: [] }],
    });
    expect(stampSanctum(map(), { runSeed: 1, actIndex: 3, actCount: 4, chance: 1 })).toBeNull();
    expect(stampSanctum(map(), { runSeed: 1, actIndex: 3, actCount: 5, chance: 1 })).toBe('c');
  });

  it('about half the acts that could have one do, with the shipped chance', () => {
    // Failure: the chance is read wrong (always, or never), so the count leaves the spec's 3-4
    // earned blessings a run.
    let stamped = 0;
    let acts = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const rm = freshRun(seed, { gameData: data });
      rm.advanceAct();
      if (!sanctumCandidates(rm.nodeMap).length && !sanctumOf(rm)) continue;
      acts++;
      if (sanctumOf(rm)) stamped++;
    }
    expect(stamped / acts).toBeGreaterThan(0.4);
    expect(stamped / acts).toBeLessThan(0.6);
  });

  it('the same seed stamps the same church after a reload, and a reload never stamps again', () => {
    // Failure: the stamp is keyed by something a save does not keep, or runs again on load and
    // moves the sanctum to another church.
    for (const seed of [8, 9, 10, 11]) {
      const a = freshRun(seed);
      const b = roundTrip(a);
      a.advanceAct();
      b.advanceAct();
      expect(sanctumOf(b)?.id ?? null).toBe(sanctumOf(a)?.id ?? null);
      const loaded = roundTrip(a);
      expect(sanctumOf(loaded)?.id ?? null).toBe(sanctumOf(a)?.id ?? null);
      expect(loaded.nodeMap.sanctumRolled).toBe(true);
      expect(loaded._stampSanctum()).toBeNull();
      expect(loaded.nodeMap.nodes.filter((n) => n.sanctum)).toHaveLength(sanctumOf(a) ? 1 : 0);
    }
  });

  it('an old save gets no sanctum on its current map, and one from its next act', () => {
    // Failure: fromJSON stamps the map already being walked (a church the player passed becomes a
    // sanctum, or the stamp moves a stream on load).
    const rm = sanctumRun(12);
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    delete saved.nodeMap.sanctumRolled;
    for (const node of saved.nodeMap.nodes) delete node.sanctum;
    const loaded = RunManager.fromJSON(saved, rm.gameData);
    expect(sanctumOf(loaded)).toBeNull();
    loaded.advanceAct();
    expect(loaded.nodeMap.sanctumRolled).toBe(true);
  });

  it("a Pilgrim's Road shop is never the sanctum, and Pilgrim's Road never takes the sanctum", () => {
    // Failure: the stamp runs before the extra shop (a sanctum turned into a shop), or a
    // mid-run Pilgrim's Road converts the sanctum church.
    for (let seed = 20; seed < 40; seed++) {
      const rm = freshRun(seed);
      rm.addBlessingMidRun('pilgrim_coin');
      rm.advanceAct();
      const sanctum = sanctumOf(rm);
      if (!sanctum) continue;
      expect(sanctum.type).toBe('church');
      expect(sanctum.pilgrimShop).toBeUndefined();
      expect(extraShopCandidates(rm.nodeMap).map((n) => n.id)).not.toContain(sanctum.id);
    }
    const map = {
      actId: 'act2',
      nodes: [{ id: 'c', type: 'church', row: 2, col: 0, edges: [], sanctum: true }],
    };
    expect(extraShopCandidates(map)).toEqual([]);
  });

  it('a church the Eclipse took is no sanctum, and is never stamped', () => {
    // Failure: an eclipsed church (now a battle) still opens as a sanctum, or is stamped.
    const node = { id: 'c', type: 'church', sanctum: true };
    expect(isSanctum(node)).toBe(true);
    expect(isSanctum({ ...node, eclipse: { fromType: 'church' } })).toBe(false);
    expect(isSanctum({ ...node, type: 'battle' })).toBe(false);
    const map = {
      actId: 'act2',
      nodes: [
        { id: 'a', type: 'church', eclipse: { fromType: 'church' } },
        { id: 'b', type: 'church', completed: true },
      ],
    };
    expect(stampSanctum(map, { runSeed: 1, actIndex: 1, actCount: 4, chance: 1 })).toBeNull();
    expect(map.sanctumRolled).toBe(true);
  });

  it("a Cartographer's or a Bad Map's redraw never takes the sanctum (its own outcome on every rung)", () => {
    // Failure: a route edit redraws the sanctum church as a shop or a battle (the act's earned
    // card is gone), or a redrawn node keeps a stale `sanctum: true`. The real events on the
    // shipped data: the Cartographer's `ask` (First Light: `true_map`, a shop; Black Sun: `lied`,
    // a battle, too) and A Bad Map's `trust` (`misled`, a battle), from every node the sanctum is
    // in reach of (the next two rows).
    const outcomes = new Set();
    let inReach = 0;
    let redrawn = 0;
    for (const difficultyId of ['normal', 'lunatic']) {
      for (let seed = 1; seed <= 40; seed++) {
        const rm = inActTwo(seed, { difficultyId });
        const sanctum = sanctumOf(rm);
        if (!sanctum) continue;
        const byId = new Map(rm.nodeMap.nodes.map((n) => [n.id, n]));
        const reaches = (from) =>
          (from.edges || []).some(
            (id) => id === sanctum.id || (byId.get(id)?.edges || []).includes(sanctum.id),
          );
        const stands = rm.nodeMap.nodes.filter((n) => {
          if (n === sanctum || n.completed || !['battle', 'shop', 'church'].includes(n.type))
            return false;
          if (!reaches(n)) return false;
          const trial = structuredClone(rm.nodeMap);
          trial.nodes.find((t) => t.id === n.id).type = 'event';
          return serviceStreakProblems(trial).length === 0;
        });
        for (const stand of stands)
          for (const [eventId, choiceId] of [
            ['cartographer', 'ask'],
            ['bad_map', 'trust'],
          ]) {
            const run = roundTrip(rm);
            const node = run.nodeMap.nodes.find((n) => n.id === stand.id);
            arriveAs(run, eventId, node);
            run.currentNodeId = node.id;
            inReach++;
            const result = chooseEventOption(run, node.id, choiceId);
            expect(result.ok, result.reason).toBe(true);
            outcomes.add(`${eventId}:${result.outcomeId}`);
            if (result.results.some((r) => r.kind === 'route' && r.op === 'redraw')) redrawn++;
            const after = run.nodeMap.nodes.find((n) => n.id === sanctum.id);
            expect(after.type, `${difficultyId} seed ${seed} ${eventId} from ${stand.id}`).toBe(
              'church',
            );
            expect(isSanctum(after)).toBe(true);
            expect(run.nodeMap.nodes.filter((n) => n.sanctum === true)).toHaveLength(1);
          }
      }
    }
    expect(inReach).toBeGreaterThan(40);
    expect(redrawn).toBeGreaterThan(20);
    for (const seen of ['cartographer:true_map', 'cartographer:lied', 'bad_map:misled'])
      expect([...outcomes]).toContain(seen);
    // The two guards, each on its own: the sanctum is never a redraw candidate, and a node
    // rebuilt as another type loses the flag (a stale flag would make a shop "an old sanctum").
    const rm = sanctumRun(19);
    const sanctum = sanctumOf(rm);
    expect(isRedrawable(rm, sanctum)).toBe(false);
    expect(isRedrawable(rm, { ...sanctum, sanctum: false })).toBe(true);
    const rebuilt = rebuildNodeAs(structuredClone(sanctum), 'shop', 'act2', 10, data.mapTemplates);
    expect(rebuilt.type).toBe('shop');
    expect('sanctum' in rebuilt).toBe(false);
  });

  it('the route map names it: an Old sanctum, its short label and its inspect line', () => {
    // Failure: the sanctum looks like any church on the route map (the player cannot route to it).
    const rm = sanctumRun(13);
    const sanctum = sanctumOf(rm);
    expect(nodeLabel(sanctum)).toBe('Old sanctum');
    expect(loomShortLabel(sanctum)).toBe('SANCTUM');
    expect(SANCTUM_TEXT).toMatch(/earned blessing/);
    expect(nodeLabel({ ...sanctum, sanctum: false })).toBe('Church');
  });

  it('the inspect line follows the sanctum: its offer, a vow that took it, a vow spent, an empty altar', () => {
    // Failure: once its vow is made (or nothing is left) the route map still promises "its vow
    // offers an earned blessing", and the player walks back to an altar with nothing for them.
    const line = (rm, node) =>
      describeLoomNode(node, { state: 'done', sanctumStatus: sanctumStatus(rm, node.id) }).text;
    const rm = sanctumRun(20);
    const node = sanctumOf(rm);
    expect(sanctumStatus(rm, node.id)).toBe('unopened');
    expect(line(rm, node)).toBe(SANCTUM_TEXT);
    const entry = openSanctum(rm, node.id);
    expect(sanctumStatus(rm, node.id)).toBe('open');
    expect(line(rm, node)).toBe(SANCTUM_TEXT);
    // A promotion spent the vow.
    const spent = roundTrip(rm);
    spent.churchVowByNodeId[node.id] = 'promote';
    expect(sanctumStatus(spent, node.id)).toBe('spent');
    expect(line(spent, node)).toBe(SANCTUM_SPENT_TEXT);
    // Its vow took an earned card.
    expect(takeSanctumBlessing(rm, node.id, entry.offered[0], rm.gameData).ok).toBe(true);
    expect(sanctumStatus(rm, node.id)).toBe('taken');
    expect(line(rm, node)).toBe(SANCTUM_TAKEN_TEXT);
    // Nothing left: every card it offered is held elsewhere (or it rolled none).
    const empty = sanctumRun(20);
    const emptyNode = sanctumOf(empty);
    for (const id of openSanctum(empty, emptyNode.id).offered)
      empty.addBlessingMidRun(id, { earned: true });
    expect(sanctumStatus(empty, emptyNode.id)).toBe('none');
    expect(line(empty, emptyNode)).toBe(SANCTUM_EMPTY_TEXT);
    expect(churchBlessingOffers(empty, emptyNode.id, empty.gameData).length).toBe(3);
    // Not a sanctum: no status, the church's own line.
    const church = { ...node, sanctum: false };
    expect(sanctumStatus(rm, 'nowhere')).toBeNull();
    expect(describeLoomNode(church, { state: 'live' }).text).not.toMatch(/sanctum/);
    // The route map's card passes the status in.
    expect(fs.readFileSync('src/ui/LoomPanels.js', 'utf8')).toMatch(/sanctumStatus: /);
  });
});

// ── Its vow (D-6) ───────────────────────────────────────────────────────

describe("the sanctum's vow", () => {
  it('rolls its pair when the door opens and keeps it: a reload and a later earned card change nothing', () => {
    // Failure: the pair is rolled on every visit (re-enter to re-roll), or reads what the run
    // holds now (taking an elite's card reshuffles the sanctum).
    const rm = sanctumRun(14);
    const id = sanctumOf(rm).id;
    const entry = openSanctum(rm, id);
    expect(entry).toMatchObject({ key: sanctumLedgerKey(id), source: 'sanctum', status: 'open' });
    expect(entry.offered).toHaveLength(2);
    expect(entry.offered[0]).toBe('tithe_box'); // the sanctum's own card is drawn first
    const back = roundTrip(rm);
    expect(openSanctum(back, id)).toEqual(entry);
    back.addBlessingMidRun('hollow_hourglass', { earned: true });
    expect(openSanctum(back, id).offered).toEqual(entry.offered);
  });

  it('fills past its own card from the pure boss and elite cards, never a held one', () => {
    // Failure: a sanctum with one card of its own offers one (or a twisted, or a held, card).
    const rm = sanctumRun(15);
    rm.addBlessingMidRun('ember_lantern', { earned: true });
    const pure = new Set(
      [...earnedPoolFor(rm, 'act_boss'), ...earnedPoolFor(rm, 'eclipsed_elite')].map((b) => b.id),
    );
    const entry = openSanctum(rm, sanctumOf(rm).id);
    expect(entry.offered[0]).toBe('tithe_box');
    expect(pure.has(entry.offered[1])).toBe(true);
    expect(entry.offered).not.toContain('ember_lantern');
  });

  it("offers the earned pair instead of the tier I three, never both; with nothing left, the church's own", () => {
    // Failure: the sanctum offers tier I and earned cards together (two blessings for one vow),
    // or a sanctum with nothing left offers no blessing at all.
    const rm = sanctumRun(16);
    const id = sanctumOf(rm).id;
    expect(churchBlessingOffers(rm, id, rm.gameData).length).toBe(3); // before the door opens
    openSanctum(rm, id);
    expect(churchBlessingOffers(rm, id, rm.gameData)).toEqual([]);
    expect(sanctumBlessingOffers(rm, id, rm.gameData).map((b) => b.id)).toEqual(
      rm.earnedBlessingPicks[sanctumLedgerKey(id)].offered,
    );
    // Every card it could offer already held: 'none', and the tier I offers return.
    const empty = sanctumRun(16);
    for (const b of empty.gameData.blessings.blessings.filter((x) => x.earned))
      empty.addBlessingMidRun(b.id, { earned: true });
    const none = openSanctum(empty, sanctumOf(empty).id);
    expect(none).toMatchObject({ status: 'none', offered: [] });
    expect(sanctumEntry(empty, sanctumOf(empty).id)).toBeNull();
    expect(churchBlessingOffers(empty, sanctumOf(empty).id, empty.gameData).length).toBe(3);
  });

  it('a take is the vow: one earned card, then no promotion and no second blessing here', () => {
    // Failure: the take does not commit the vow (a promotion, or the second card, follows).
    const rm = sanctumRun(17);
    rm.gold = 99999;
    const id = sanctumOf(rm).id;
    const [first, second] = openSanctum(rm, id).offered;
    const unit = createUnit(
      rm.gameData.classes.find((c) => c.name === 'Fighter'),
      10,
      rm.gameData.weapons,
      { name: 'Bram' },
    );
    unit.faction = 'player';
    rm.roster.push(unit);
    expect(churchPromotionBlock(rm, unit, id, rm.gameData)).toBe('');
    const result = takeSanctumBlessing(rm, id, second, rm.gameData);
    expect(result.ok, result.reason).toBe(true);
    expect(rm.getActiveBlessingIds()).toContain(second);
    expect(churchVow(rm, id)).toBe('blessing');
    expect(rm.earnedBlessingPicks[sanctumLedgerKey(id)]).toMatchObject({
      status: 'taken',
      chosen: second,
    });
    expect(churchPromotionBlock(rm, unit, id, rm.gameData)).toMatch(/Blessing/);
    expect(takeSanctumBlessing(rm, id, first, rm.gameData)).toMatchObject({
      ok: false,
      reason: 'This altar has already blessed you.',
    });
    expect(takeChurchBlessing(rm, id, 'steady_hands', rm.gameData).ok).toBe(false);
    // Saved: a reload keeps the vow and the ledger.
    const back = roundTrip(rm);
    expect(sanctumBlessingBlock(back, id, first, back.gameData)).toBe(
      'This altar has already blessed you.',
    );
  });

  it('a promotion first closes the sanctum blessing, as at any church', () => {
    const rm = sanctumRun(18);
    const id = sanctumOf(rm).id;
    const entry = openSanctum(rm, id);
    rm.churchVowByNodeId[id] = 'promote';
    expect(sanctumBlessingBlock(rm, id, entry.offered[0], rm.gameData)).toMatch(/Promotion/);
    expect(takeSanctumBlessing(rm, id, entry.offered[0], rm.gameData).ok).toBe(false);
    expect(rm.getActiveBlessingIds()).toEqual([]);
  });
});

// ── The Tithe Box ─────────────────────────────────────────────────────────

describe('the Tithe Box', () => {
  const holding = (seed = 30) => {
    const rm = sanctumRun(seed);
    rm.addBlessingMidRun('tithe_box', { earned: true });
    return rm;
  };
  const churches = (rm) => rm.nodeMap.nodes.filter((n) => n.type === 'church');

  it('pays 200 once a church: a second entry and a reload never pay again', () => {
    // Failure: re-entering a church (or reloading in it) pays the tithe again.
    const rm = holding();
    const church = churches(rm)[0];
    const gold = rm.gold;
    expect(payChurchTithe(rm, church.id)).toMatchObject({ paid: 200 });
    expect(rm.gold).toBe(gold + 200);
    expect(payChurchTithe(rm, church.id).paid).toBe(0);
    const back = roundTrip(rm);
    expect(payChurchTithe(back, church.id).paid).toBe(0);
    expect(back.gold).toBe(gold + 200);
  });

  it('never at the Ruins, an event or a shop; nothing without the box', () => {
    // Failure: the Ruins' sanctuary (or any node) pays as a church.
    const rm = holding(31);
    for (const node of rm.nodeMap.nodes.filter((n) => n.type !== 'church'))
      expect(payChurchTithe(rm, node.id).paid, node.type).toBe(0);
    const without = sanctumRun(31);
    expect(payChurchTithe(without, churches(without)[0].id).paid).toBe(0);
  });

  it("each act's churches pay anew (the record goes with the act's map); a bad save loads empty", () => {
    const rm = holding(32);
    payChurchTithe(rm, churches(rm)[0].id);
    rm.advanceAct();
    expect(rm.churchTitheByNodeId).toEqual({});
    expect(sanitizeChurchTithes({ a: true, b: 'yes', c: 1, '': true })).toEqual({ a: true });
    expect(sanitizeChurchTithes(null)).toEqual({});
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    delete saved.churchTitheByNodeId;
    expect(RunManager.fromJSON(saved, rm.gameData).churchTitheByNodeId).toEqual({});
  });

  it('taken at the sanctum, it pays that church at once (the box is in hand), and only once', () => {
    // Failure: the sanctum where the box is taken never pays (the door already opened), or pays
    // again when the party re-enters.
    let rm = null;
    let id = null;
    for (let seed = 33; seed < 80 && !rm; seed++) {
      const candidate = sanctumRun(seed);
      const node = sanctumOf(candidate);
      if (openSanctum(candidate, node.id).offered.includes('tithe_box')) {
        rm = candidate;
        id = node.id;
      }
    }
    const gold = rm.gold;
    expect(takeSanctumBlessing(rm, id, 'tithe_box', rm.gameData)).toMatchObject({ ok: true });
    expect(rm.gold).toBe(gold + 200);
    expect(payChurchTithe(rm, id).paid).toBe(0);
  });
});

// ── The church menu (the real controller and menu) ──────────────────────

describe('the church menu at the Old Sanctum', () => {
  let d;
  beforeEach(() => {
    const storage = new JourneyStorage();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('document', { activeElement: null });
    d = new RunDriver(storage);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const labels = () => d.buttons().map((b) => b.textContent);
  const bodyText = () =>
    d.church.nativeMenu.surface.body
      .all()
      .map((n) => n.textContent)
      .join(' | ');

  function enterSanctum() {
    d.node('church').sanctum = true;
    d.run.currentNodeId = d.node('church').id;
    d.church.handleChurch(d.node('church'));
    d.service = 'church';
  }

  it('is titled Old Sanctum and offers its earned pair, saved the moment the door opens', () => {
    // Failure: the sanctum renders as a church with the tier I rows, or its pair is not saved
    // (a refresh before the vow re-rolls it).
    enterSanctum();
    expect(d.church.nativeMenu.surface.title).toBe('Old Sanctum');
    const entry = d.run.earnedBlessingPicks[sanctumLedgerKey(d.node('church').id)];
    expect(entry.status).toBe('open');
    const rows = labels().filter((l) => / · Earned$/.test(l));
    expect(rows).toHaveLength(2);
    const names = entry.offered.map(
      (id) => d.data.blessings.blessings.find((b) => b.id === id).name,
    );
    for (const name of names) expect(rows.some((r) => r.startsWith(`${name} · `))).toBe(true);
    expect(bodyText()).toContain('Earned blessing · Free');
    expect(bodyText()).not.toContain('Blessing · Free |');
    expect(loadRun(d.data, 1).earnedBlessingPicks[sanctumLedgerKey(d.node('church').id)]).toEqual(
      entry,
    );
  });

  it('takes one behind the confirmation; a reload and a re-entry say the altar has blessed you', () => {
    // Failure: the take is lost on reload, or re-entering offers the other card.
    enterSanctum();
    const entry = d.run.earnedBlessingPicks[sanctumLedgerKey(d.node('church').id)];
    const target = d.data.blessings.blessings.find((b) => b.id === entry.offered[1]);
    d.press(new RegExp(`^${target.name} · `));
    expect(d.church.nativeMenu.child.options.confirmation).toBe(true);
    expect(d.confirm(0).ok).toBe(true);
    expect(d.run.getActiveBlessingIds()).toContain(target.id);
    d.leave();
    d.reload();
    expect(d.run.getActiveBlessingIds()).toContain(target.id);
    expect(d.run.earnedBlessingPicks[sanctumLedgerKey(d.node('church').id)].status).toBe('taken');
    d.run.currentNodeId = d.node('church').id;
    d.church.handleChurch(d.node('church'));
    d.service = 'church';
    expect(labels().filter((l) => / · Earned$/.test(l))).toEqual([]);
    expect(bodyText()).toContain('Your vow here was a Blessing');
  });

  it('a plain church keeps its title and its tier I rows; the Tithe Box pays at its door', () => {
    // Failure: every church reads Old Sanctum, or the tithe never reaches the menu or the save.
    d.run.addBlessingMidRun('tithe_box', { earned: true });
    const gold = d.run.gold;
    d.run.currentNodeId = d.node('church').id;
    d.church.handleChurch(d.node('church'));
    d.service = 'church';
    expect(d.church.nativeMenu.surface.title).toBe('Church');
    expect(bodyText()).toContain('Blessing · Free');
    expect(bodyText()).toContain('Tithe Box: the priests add 200 G.');
    expect(d.run.gold).toBe(gold + 200);
    expect(loadRun(d.data, 1).gold).toBe(gold + 200);
    d.leave();
    d.run.currentNodeId = d.node('church').id;
    d.church.handleChurch(d.node('church'));
    expect(d.run.gold).toBe(gold + 200);
  });
});
