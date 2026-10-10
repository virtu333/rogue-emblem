// Every event x every choice x every outcome, resolved on a real run (docs/specs/event-nodes.md
// §9): the shipped content cannot strand or corrupt a run.
//
// The run: a fallen ally, a Vulnerary, 2000 gold, and a unit of each weapon type (sword,
// lance, axe, bow, tome, light, staff). For each choice, seeds are walked until each of its
// outcomes has been drawn (so a rare branch is exercised too), then the run is checked:
//   - the choice resolves (no refusal, no exception);
//   - gold is never negative; no living unit is at 0 HP; no unit holds more than its bags, no
//     more than five equipped skills; the convoy is within capacity; shadow stays 0..100;
//   - a consumable is never left in a bag with no uses; the story flags and results are plain
//     JSON; the log gained exactly one entry; the outcome text has no unfilled `{token}`;
//   - the run survives a save/load round trip with the same event record;
//   - a fight is winnable through completeBattle + completeEventBattle, and Continue then
//     opens the forward edges.
// Failure modes: an effect that needs a unit the run lacks; a text with a stray token; a
// choice that leaves an unleavable node; a battle whose spoils leave the army over its bag
// limits; a state that does not survive a reload.
import { describe, expect, it } from 'vitest';
import {
  arriveAtEvent,
  chooseEventOption,
  completeEventBattle,
  eventChoiceBlock,
  eventState,
  eventView,
  leaveEvent,
} from '../src/engine/EventCommands.js';
import { choiceMayGrantItem } from '../src/engine/EventSystem.js';
import { RunManager } from '../src/engine/RunManager.js';
import { CONSUMABLE_MAX, INVENTORY_MAX, MAX_SKILLS } from '../src/utils/constants.js';
import { applyWear } from '../src/engine/WeaponWear.js';
import { addUnit, arriveAs, baseData, eventNode, fallAlly, newRun } from './eventKit.js';
import { eventTriples, pickTargetUid, routesToPages, takeAnExit, walkRoute } from './eventWalk.js';
import { START_PAGE, pageOf } from '../src/engine/EventSystem.js';

const MAX_SEEDS = 400;

function buildRun(seed, { difficulty = 'normal', act = 0 } = {}) {
  const run = newRun({ seed, difficulty, gold: 2000 });
  run.actSequence = ['act1', 'act2', 'act3', 'act4'];
  run.actIndex = act;
  for (const [className, name] of [
    ['Archer', 'Hale'],
    ['Fighter', 'Brant'],
    ['Mage', 'Iona'],
    ['Cleric', 'Mara'],
    ['Knight', 'Dov'],
  ])
    addUnit(run, className, { name, level: 3 });
  const fallen = addUnit(run, 'Cavalier', { name: 'Rook', level: 5 });
  fallen.skills = ['pavise', 'wrath', 'guard'];
  fallAlly(run, fallen);
  run.roster[0].consumables = [{ ...run.getConsumableTemplate('Vulnerary') }];
  // A spare blade in Brant's bag, worn: the Wandering Smith has something to mend and the
  // equipped weapons stay forgeable.
  const brant = run.roster.find((u) => u.name === 'Brant');
  const spare = structuredClone(brant.inventory[0]);
  delete spare.uid;
  expect(applyWear(spare, 'might').success).toBe(true);
  brant.inventory.push(spare);
  return run;
}

function integrityProblems(run, before) {
  const problems = [];
  if (!(run.gold >= 0)) problems.push(`gold ${run.gold}`);
  for (const unit of run.roster) {
    if (before.alive.has(unit.name) && !(unit.currentHP >= 1))
      problems.push(`${unit.name} at ${unit.currentHP} HP`);
    if (unit.currentHP > unit.stats.HP) problems.push(`${unit.name} over max HP`);
    if ((unit.inventory || []).length > INVENTORY_MAX)
      problems.push(`${unit.name} bag over ${INVENTORY_MAX}`);
    if ((unit.consumables || []).length > CONSUMABLE_MAX)
      problems.push(`${unit.name} consumables over`);
    if ((unit.skills || []).length > MAX_SKILLS)
      problems.push(`${unit.name} skills over ${MAX_SKILLS}`);
    for (const item of unit.consumables || [])
      if (!(item.uses > 0)) problems.push(`${unit.name} holds a spent ${item.name}`);
  }
  const caps = run.getConvoyCapacities();
  if (run.convoy.weapons.length > caps.weapons) problems.push('convoy weapons over capacity');
  if (run.convoy.consumables.length > caps.consumables)
    problems.push('convoy consumables over capacity');
  for (const item of run.convoy.consumables)
    if (!(item.uses > 0)) problems.push(`convoy holds a spent ${item.name}`);
  if (run.eclipse.shadow < 0 || run.eclipse.shadow > 100)
    problems.push(`shadow ${run.eclipse.shadow}`);
  if (JSON.stringify(run.storyFlags) !== JSON.stringify(JSON.parse(JSON.stringify(run.storyFlags))))
    problems.push('story flags are not plain JSON');
  if (run.visionChargesRemaining < 0) problems.push('negative vision');
  return problems;
}

const pickTarget = pickTargetUid;

/** Every [eventId, pageId, choiceId, outcomeId] the shipped events can produce, pages included. */
const triples = baseData.events.events.flatMap((event) =>
  eventTriples(event).map(([pageId, choiceId, outcomeId]) => [
    event.id,
    pageId,
    choiceId,
    outcomeId,
  ]),
);

describe('every shipped outcome resolves cleanly', () => {
  it('lists the outcomes (a sanity check on the table itself)', () => {
    expect(triples.length).toBeGreaterThanOrEqual(85);
    // The pages of the multi-page events are in it.
    expect(
      triples.filter(([id, page]) => id === 'sunken_mine' && page === 'level_three'),
    ).not.toHaveLength(0);
    expect(
      triples.filter(([id, page]) => id === 'plague_village' && page === 'ward'),
    ).not.toHaveLength(0);
  });

  it.each(triples)('%s [%s] / %s / %s', (eventId, pageId, choiceId, outcomeId) => {
    const event = baseData.events.events.find((e) => e.id === eventId);
    const choiceDef = pageOf(event, pageId).choices.find((c) => c.id === choiceId);
    const outcomeDef = choiceDef.outcomes.find((o) => o.id === outcomeId);
    const route = routesToPages(event).get(pageId);
    // An outcome only a rung brings (weight 0 below it: Black Sun's lying stranger) is reached there.
    const difficulty = outcomeDef.weight === 0 ? 'lunatic' : 'normal';
    for (let seed = 1; seed <= MAX_SEEDS; seed++) {
      const run = buildRun(seed, { difficulty });
      const node = arriveAs(run, eventId);
      if (!walkRoute(run, node.id, route)) continue;
      const block = eventChoiceBlock(run, node.id, choiceId);
      expect(block, `${eventId}.${choiceId} blocked on a fully stocked army`).toBe('');
      const before = {
        alive: new Set(run.roster.map((u) => u.name)),
        log: run.eventLog.length,
        gold: run.gold,
        fallen: run.fallenUnits.length,
      };
      const result = chooseEventOption(run, node.id, choiceId, {
        targetUid: pickTarget(run, node.id, choiceId),
      });
      expect(result.ok, `${eventId}.${choiceId}: ${result.reason}`).toBe(true);
      if (result.outcomeId !== outcomeId) continue;

      // The record.
      expect(integrityProblems(run, before)).toEqual([]);
      expect(run.eventLog).toHaveLength(before.log + 1);
      expect(run.eventLog.at(-1)).toEqual({
        eventId,
        choiceId,
        outcomeId,
        act: 'act1',
        ...(pageId === START_PAGE ? {} : { page: pageId }),
      });
      expect(result.text.length).toBeGreaterThan(0);
      expect(result.text).not.toMatch(/\{[a-z]+\}/);
      for (const record of result.results) {
        expect(typeof record.kind).toBe('string');
        expect(JSON.parse(JSON.stringify(record))).toEqual(record);
      }
      // A step that leads on moves the event to the next page and keeps the step behind it; a
      // step that ends the page leaves its choice on the record.
      if (outcomeDef.next) {
        expect(result.next).toBe(outcomeDef.next);
        expect(eventState(run, node.id)).toMatchObject({ eventId, page: outcomeDef.next });
        expect(eventState(run, node.id).choiceId).toBeUndefined();
        expect(eventState(run, node.id).path.at(-1)).toMatchObject({
          page: pageId,
          choiceId,
          outcomeId,
        });
      } else {
        expect(eventState(run, node.id)).toMatchObject({ choiceId, outcomeId, eventId });
      }
      // A cost is always paid, an outcome with a battle starts one, and nothing else does.
      const cost = choiceDef.cost ? result.results.find((r) => r.cost) : null;
      expect(Boolean(cost)).toBe(Boolean(choiceDef.cost));
      const hasBattleEffect = outcomeDef.effects.some((e) => e.type === 'battle');
      expect(result.battle).toBe(hasBattleEffect);

      // A save/load round trip keeps the record and the page.
      const loaded = RunManager.fromJSON(JSON.parse(JSON.stringify(run.toJSON())), run.gameData);
      expect(eventState(loaded, node.id)).toEqual(eventState(run, node.id));
      if (!outcomeDef.next) expect(eventView(loaded, node.id).outcome.text).toBe(result.text);
      expect(integrityProblems(loaded, before)).toEqual([]);

      // Walk on to the end: a step that led deeper takes an exit; win a fight; leave.
      let last = result;
      if (outcomeDef.next) {
        last = takeAnExit(run, node.id, event);
        expect(last?.ok, `${eventId} has no exit on ${outcomeDef.next}`).toBe(true);
        expect(integrityProblems(run, before)).toEqual([]);
      }
      if (last.battle) {
        expect(node.type).toBe('event');
        expect(run.completeBattle(run.getRoster(), node.id, 80, { turnCount: 6, turnPar: 6 })).toBe(
          true,
        );
        const settled = completeEventBattle(run, node.id);
        expect(settled.ok, settled.reason).toBe(true);
        expect(settled.text.length).toBeGreaterThan(0);
        expect(integrityProblems(run, before)).toEqual([]);
        expect(completeEventBattle(run, node.id).ok).toBe(false);
      }
      expect(leaveEvent(run, node.id)).toEqual({ ok: true, nodeId: node.id });
      expect(node.completed).toBe(true);
      expect(run.getAvailableNodes().map((n) => n.id)).toEqual(node.edges);
      expect(integrityProblems(run, before)).toEqual([]);
      return;
    }
    throw new Error(
      `${eventId}[${pageId}].${choiceId}.${outcomeId} never came up in ${MAX_SEEDS} seeds`,
    );
  });
});

describe('the same on every rung and in every act', () => {
  const rungs = ['normal', 'dusk', 'hard', 'lunatic'];
  it('every event resolves its first open choice on every rung', () => {
    for (const difficulty of rungs)
      for (const event of baseData.events.events) {
        if (event.acts && !event.acts.includes('act1')) continue;
        const run = buildRun(7, { difficulty });
        const node = arriveAs(run, event.id);
        const view = eventView(run, node.id);
        const open = view.choices.find((c) => !c.block);
        expect(open, `${event.id} on ${difficulty}`).toBeTruthy();
        const result = chooseEventOption(run, node.id, open.id, {
          targetUid: pickTarget(run, node.id, open.id),
        });
        expect(result.ok, `${event.id}.${open.id} on ${difficulty}: ${result.reason}`).toBe(true);
      }
  });

  it('every event resolves in each act it appears in, with scaled costs paid from the purse', () => {
    for (let act = 0; act < 4; act++)
      for (const event of baseData.events.events) {
        const acts = event.acts || ['act1', 'act2', 'act3', 'act4'];
        if (!acts.includes(`act${act + 1}`)) continue;
        for (const choice of event.choices) {
          const run = buildRun(11, { difficulty: 'hard', act });
          const node = arriveAs(
            run,
            event.id,
            run.nodeMap.nodes.find((n) => n.row === 4 && !n.completed),
          );
          // A guide is offered only where a road can be drawn (requires.roadAhead): on this map there
          // may be none, and then the choice is greyed with exactly her reason, nothing else.
          if (choice.requires?.roadAhead) {
            const block = eventChoiceBlock(run, node.id, choice.id);
            if (block) {
              expect(block, `${event.id}.${choice.id} in act${act + 1}`).toBe(
                choice.requires.reason,
              );
              continue;
            }
          }
          const result = chooseEventOption(run, node.id, choice.id, {
            targetUid: pickTarget(run, node.id, choice.id),
          });
          expect(result.ok, `${event.id}.${choice.id} in act${act + 1}: ${result.reason}`).toBe(
            true,
          );
          expect(run.gold, `${event.id}.${choice.id}`).toBeGreaterThanOrEqual(0);
          if (choice.cost) {
            // The act's amount (base + perAct x n, by hand from the data) x 1.25 on Nightfall,
            // rounded to 10. Gold the outcome itself pays is added back in.
            const amount = choice.cost.gold;
            const base = (amount.base + amount.perAct * (act + 1)) * 1.25;
            const paid = result.results.find((r) => r.cost);
            expect(-paid.value, `${event.id}.${choice.id}`).toBe(Math.round(base / 10) * 10);
          }
        }
      }
  });

  it('with the choice a player has no way to take, the node is still leavable (no soft-lock)', () => {
    // A broke army: no gold, no Vulnerary, nobody fallen, every bag full, convoy full.
    for (const event of baseData.events.events) {
      const run = newRun({ seed: 5, gold: 0 });
      for (const unit of run.roster) {
        unit.consumables = [];
        while (unit.inventory.length < INVENTORY_MAX)
          unit.inventory.push(structuredClone(unit.inventory[0]));
        while (unit.consumables.length < CONSUMABLE_MAX)
          unit.consumables.push({ ...run.getConsumableTemplate('Herb') });
      }
      const caps = run.getConvoyCapacities();
      run.convoy.weapons = Array.from({ length: caps.weapons }, () =>
        structuredClone(run.roster[0].inventory[0]),
      );
      run.convoy.consumables = Array.from({ length: caps.consumables }, () => ({
        ...run.getConsumableTemplate('Herb'),
      }));
      const node = eventNode(run);
      if (event.requires?.fallen) continue; // needs a fallen ally to be offered at all
      arriveAs(run, event.id, node);
      const open = eventView(run, node.id).choices.find((c) => !c.block);
      expect(open, `${event.id} has no choice for a broke, full army`).toBeTruthy();
      const result = chooseEventOption(run, node.id, open.id, {
        targetUid: pickTarget(run, node.id, open.id),
      });
      expect(result.ok, `${event.id}.${open.id}: ${result.reason}`).toBe(true);
      if (result.battle) continue;
      expect(leaveEvent(run, node.id).ok).toBe(true);
    }
  });
});

describe('the room check says what a commit would do (every shipped choice, short on room)', () => {
  const heldItem = (run) => structuredClone(run.roster[0].inventory[0]);
  const armies = {
    'weapon bags and weapon convoy full': (run) => {
      for (const unit of run.roster)
        while (unit.inventory.length < INVENTORY_MAX) unit.inventory.push(heldItem(run));
      const caps = run.getConvoyCapacities();
      run.convoy.weapons = Array.from({ length: caps.weapons }, () => heldItem(run));
    },
    'consumable bags and consumable convoy full': (run) => {
      for (const unit of run.roster)
        while (unit.consumables.length < CONSUMABLE_MAX)
          unit.consumables.push({ ...run.getConsumableTemplate('Herb') });
      const caps = run.getConvoyCapacities();
      run.convoy.consumables = Array.from({ length: caps.consumables }, () => ({
        ...run.getConsumableTemplate('Herb'),
      }));
    },
    'one weapon place left in the convoy': (run) => {
      armies['weapon bags and weapon convoy full'](run);
      run.convoy.weapons.pop();
    },
  };

  it('an open choice never fails for room, whichever outcome rolls; a granting choice that is shut says why', () => {
    for (const [label, shorten] of Object.entries(armies)) {
      for (const event of baseData.events.events) {
        for (const choice of event.choices) {
          for (let seed = 1; seed <= 6; seed++) {
            const run = buildRun(seed);
            shorten(run);
            const node = arriveAs(run, event.id);
            const block = eventChoiceBlock(run, node.id, choice.id);
            const where = `${label}: ${event.id}.${choice.id} seed ${seed}`;
            if (block) {
              if (/room/i.test(block)) expect(choiceMayGrantItem(choice), where).toBe(true);
              continue;
            }
            const result = chooseEventOption(run, node.id, choice.id, {
              targetUid: pickTarget(run, node.id, choice.id),
            });
            expect(result.ok, `${where}: ${result.reason}`).toBe(true);
          }
        }
      }
    }
    // Explicit timeout: a full sweep that takes seconds alone brushes the 5 s default under
    // full-suite parallel load.
  }, 30_000);

  it('a weapon shortage never leaves an event without an open choice', () => {
    for (const [label, shorten] of Object.entries(armies)) {
      for (const event of baseData.events.events) {
        const run = buildRun(7);
        run.gold = 0;
        shorten(run);
        const node = arriveAs(run, event.id);
        expect(
          eventView(run, node.id).choices.some((c) => !c.block),
          `${label}: ${event.id}`,
        ).toBe(true);
      }
    }
  });
});

describe('arrival on a stocked army never picks something unplayable', () => {
  it('over many seeds every pick has at least one open choice', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const run = buildRun(seed);
      const node = eventNode(run);
      const state = arriveAtEvent(run, node.id);
      expect(state, `seed ${seed}`).not.toBeNull();
      expect(
        eventView(run, node.id).choices.some((c) => !c.block),
        `seed ${seed} ${state.eventId}`,
      ).toBe(true);
    }
  });
});
