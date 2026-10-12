// What the Descent's authored nodes refuse (docs/specs/act-v-descent.md §2.3 rules 5-6) and its
// event pools (§9.6): the Eclipse takes only the Mortuary Column; Pilgrim's Road, a start gift's
// fall, the Cartographer and the Old Sanctum leave the route alone; a pooled event is met only at
// a node naming its pool, and such a node meets only that pool.
import { describe, it, expect } from 'vitest';
import { loadGameData } from './testData.js';
import { RunManager } from '../src/engine/RunManager.js';
import { applyEclipse, nodeFallExemption } from '../src/engine/EclipseSystem.js';
import { extraShopCandidates, stampExtraShops } from '../src/engine/ExtraShopPass.js';
import { giftFallableNodes } from '../src/engine/StartGifts.js';
import { isRedrawable, roadCandidates } from '../src/engine/RouteEdit.js';
import { eliteDropDue } from '../src/engine/EarnedBlessings.js';
import {
  eventBlock,
  hasDarkOmen,
  pickEvent,
  FALLBACK_EVENT_ID,
} from '../src/engine/EventSystem.js';
import { arriveAtEvent } from '../src/engine/EventCommands.js';
import { validateEventsConfig } from '../src/engine/EventValidation.js';

const baseData = loadGameData();
const descentData = (patch = {}) => ({
  ...baseData,
  descent: { ...structuredClone(baseData.descent), enabled: true },
  ...patch,
});

function runIntoFinalAct(difficultyId = 'hard', { runSeed = 13, data = descentData() } = {}) {
  const rm = new RunManager(data);
  rm.startRun({ runSeed, difficultyId, applyBlessingsAtStart: false });
  rm.actIndex = rm.actSequence.indexOf('finalBoss') - 1;
  rm.advanceAct();
  return rm;
}

const nodeOf = (rm, key) => rm.nodeMap.nodes.find((n) => n.descentKey === key);
const exemption = (rm, node) => nodeFallExemption(node, { nodeMap: rm.nodeMap });

describe('the Eclipse in the Descent (§2.3 rule 5)', () => {
  it('every authored node is exempt but the Mortuary Column', () => {
    const rm = runIntoFinalAct();
    const reasons = Object.fromEntries(
      rm.nodeMap.nodes.map((n) => [n.descentKey, exemption(rm, n)]),
    );
    expect(reasons).toEqual({
      stair: 'start',
      column: null,
      side_stair: 'authored',
      vigil: 'authored',
      landing: 'authored',
      gate: 'boss',
      ruins: 'ruins',
      entity: 'boss',
    });
  });

  it('a deep act shadow takes the Column alone, which keeps its set piece as an eclipsed elite', () => {
    const rm = runIntoFinalAct();
    rm.eclipse = { ...rm.eclipse, actShadow: 9999, shadow: 100 };
    const fallen = rm.applyEclipseNow();
    expect(fallen.map((n) => n.descentKey)).toEqual(['column']);
    const column = nodeOf(rm, 'column');
    expect(column.type).toBe('battle');
    expect(column.battleParams).toMatchObject({
      setPiece: 'mortuary_column',
      isEclipsed: true,
      isElite: true,
    });
    // An eclipsed elite as anywhere (§2.3 rule 5): its victory may owe the elite's earned drop.
    expect(eliteDropDue(rm, column)).toBe(true);
    // Idempotent: nothing more falls.
    expect(rm.applyEclipseNow()).toEqual([]);
  });

  it('today’s 2-node final act still never falls', () => {
    const rm = runIntoFinalAct('hard', { data: { ...baseData, descent: undefined } });
    const fallen = applyEclipse({
      state: { ...rm.eclipse, actShadow: 9999 },
      config: rm.getEclipseConfig(),
      nodeMap: rm.nodeMap,
      runSeed: rm.runSeed,
    });
    expect(fallen).toEqual([]);
  });

  it('a node the route did not mark fallable never falls, whatever its type', () => {
    const rm = runIntoFinalAct();
    const event = nodeOf(rm, 'side_stair');
    expect(exemption(rm, event)).toBe('authored');
    expect(exemption(rm, { ...event, fallable: true })).toBeNull();
    // And an unauthored event of the same shape could fall (the exemption is the stamp's).
    const { authored: _authored, ...plain } = event;
    expect(exemption(rm, plain)).toBeNull();
  });
});

describe('passes that rewrite nodes skip the route (§2.3 rule 6)', () => {
  it('Pilgrim’s Road finds no candidate and stamps no shop on entering the Descent', () => {
    const rm = new RunManager(descentData());
    rm.startRun({ runSeed: 13, difficultyId: 'hard', applyBlessingsAtStart: false });
    rm.blessingRuntimeModifiers.extraShopsPerAct = 2;
    rm.actIndex = rm.actSequence.indexOf('finalBoss') - 1;
    rm.advanceAct();
    expect(rm.nodeMap.nodes.some((n) => n.type === 'shop')).toBe(false);
    expect(extraShopCandidates(rm.nodeMap)).toEqual([]);
    expect(stampExtraShops(rm.nodeMap, { runSeed: rm.runSeed, count: 2 })).toEqual([]);
    expect(rm._stampExtraShops({ fromRow: 0 })).toEqual([]);
  });

  it('control: the same event node without the authored stamp would be turned into a shop', () => {
    const rm = runIntoFinalAct();
    const map = structuredClone(rm.nodeMap);
    for (const node of map.nodes) delete node.authored;
    expect(extraShopCandidates(map).map((n) => n.descentKey)).toEqual(['side_stair', 'landing']);
  });

  it('a start gift’s fall can take no Descent node, the fallable Column included', () => {
    const rm = runIntoFinalAct();
    expect(exemption(rm, nodeOf(rm, 'column'))).toBeNull();
    expect(giftFallableNodes(rm)).toEqual([]);
  });

  it('the Cartographer redraws no Descent node and draws no new road from one', () => {
    const rm = runIntoFinalAct();
    for (const node of rm.nodeMap.nodes) {
      expect(isRedrawable(rm, node), node.id).toBe(false);
      expect(roadCandidates(rm.nodeMap, node.id), node.id).toEqual([]);
    }
  });

  it('no Old Sanctum: the final act is the run’s last', () => {
    const rm = runIntoFinalAct();
    expect(rm._stampSanctum()).toBeNull();
    expect(rm.nodeMap.nodes.some((n) => n.sanctum)).toBe(false);
  });
});

describe('event pools (§9.6)', () => {
  const pooled = baseData.events.events.find((e) => e.id === 'came_this_far');

  it('the route’s event nodes meet the pool’s events, the Landing too (it never runs out)', () => {
    const poolIds = baseData.events.events.filter((e) => e.pool === 'descent').map((e) => e.id);
    expect(poolIds.sort()).toEqual(['came_this_far', 'last_lantern', 'seers_last_page']);
    for (const seed of [11, 12, 13, 14, 15, 16]) {
      const rm = runIntoFinalAct('hard', { runSeed: seed });
      const side = nodeOf(rm, 'side_stair');
      const landing = nodeOf(rm, 'landing');
      expect(poolIds).toContain(pickEvent(rm, side, rm.gameData.events).id);
      expect(arriveAtEvent(rm, side.id)).toBeTruthy();
      const met = rm.eventStateByNodeId[side.id].eventId;
      expect(poolIds).toContain(met);
      // Met once already: came_this_far stays eligible (not once per run), so the Landing never
      // falls back, whatever the fork met.
      expect(eventBlock(rm, pooled, landing, rm.gameData.events)).toBe('');
      const next = pickEvent(rm, landing, rm.gameData.events).id;
      expect(poolIds).toContain(next);
      if (met !== 'came_this_far') expect(next).not.toBe(met);
    }
  });

  it('an unpooled event is never met at a pooled node, even one that names the Descent', () => {
    const rm = runIntoFinalAct();
    const side = nodeOf(rm, 'side_stair');
    const stray = { id: 'stray', acts: ['finalBoss'], weight: 1, choices: [] };
    expect(eventBlock(rm, stray, side, rm.gameData.events)).toBe('pool');
    // Only the pool refused it: the same node without its pool would take it.
    expect(eventBlock(rm, stray, { ...side, eventPool: undefined }, rm.gameData.events)).toBe('');
    // And every shipped unpooled event is refused there.
    for (const event of baseData.events.events.filter((e) => !e.pool && !e.fallback))
      expect(eventBlock(rm, event, side, rm.gameData.events), event.id).toBe('pool');
  });

  it('a pooled event is met at no node without its pool, nor at one naming another pool', () => {
    const rm = runIntoFinalAct();
    const side = nodeOf(rm, 'side_stair');
    expect(eventBlock(rm, pooled, { ...side, eventPool: undefined }, rm.gameData.events)).toBe(
      'pool',
    );
    expect(eventBlock(rm, pooled, { ...side, eventPool: 'elsewhere' }, rm.gameData.events)).toBe(
      'pool',
    );
    // An ordinary run's event nodes never draw it, in any act.
    const early = new RunManager(descentData());
    early.startRun({ runSeed: 3, difficultyId: 'hard', applyBlessingsAtStart: false });
    for (let act = 0; act < 4; act++) {
      for (const node of early.nodeMap.nodes.filter((n) => n.type === 'event'))
        expect(eventBlock(early, pooled, node, early.gameData.events), node.id).toBe('pool');
      early.advanceAct();
    }
  });

  it('a pooled node with nothing eligible falls back to the fallback event (never a stray)', () => {
    const events = structuredClone(baseData.events);
    for (const event of events.events.filter((e) => e.pool === 'descent')) event.weight = 0;
    const rm = runIntoFinalAct('hard', { data: descentData({ events }) });
    expect(pickEvent(rm, nodeOf(rm, 'side_stair'), events).id).toBe(FALLBACK_EVENT_ID);
  });

  it('a Dark Omen never comes from the pool’s nodes (none has a dark face, none can fall)', () => {
    const rm = runIntoFinalAct();
    expect(hasDarkOmen(rm, nodeOf(rm, 'side_stair'))).toBe(false);
  });
});

describe('event validation: pools (§9.6)', () => {
  const validate = (config) => validateEventsConfig(config, baseData);
  const plant = (mutate, needle) => {
    const config = structuredClone(baseData.events);
    mutate(
      config.events.find((e) => e.id === 'came_this_far'),
      config,
    );
    const result = validate(config);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain(needle);
  };

  it('the shipped catalog passes', () => {
    expect(validate(structuredClone(baseData.events)).errors).toEqual([]);
  });

  it('refuses an event in the Descent with no pool', () => {
    plant((e) => delete e.pool, 'names its `pool`');
  });

  it('refuses a pooled event met in another act', () => {
    plant((e) => (e.acts = ['act3']), 'a pooled event is met only in the Descent');
    plant((e) => (e.acts = ['act4', 'finalBoss']), 'a pooled event is met only in the Descent');
    plant((e) => delete e.acts, 'a pooled event is met only in the Descent');
  });

  it('refuses a malformed pool id', () => {
    plant((e) => (e.pool = 'Descent Pool'), '`pool` must be lower_snake_case');
  });

  it('refuses a route edit, a contract or a join in a pooled event', () => {
    plant(
      (e) => (e.choices[0].outcomes[0].effects = [{ type: 'routeEdit', op: 'addRoad' }]),
      'cannot hold a routeEdit effect',
    );
    plant(
      (e) =>
        (e.choices[0].outcomes[0].effects = [
          { type: 'contract', goal: 'underPar', battles: 1, reward: [], penalty: [] },
        ]),
      'cannot hold a contract effect',
    );
    plant(
      (e) => (e.choices[0].outcomes[0].effects = [{ type: 'join', class: 'Myrmidon' }]),
      'cannot hold a join effect',
    );
  });
});
