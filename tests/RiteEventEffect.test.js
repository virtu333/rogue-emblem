// The `rite: { delta }` event effect (docs/specs/act-v-descent.md §9.6, §7): planned, applied,
// previewed and worded like every effect, valid only in a pooled Descent event. Ways this breaks:
//   - a choice moves the Rite by another amount, below 0, or with no log entry naming the event
//   - a run with no Rite (an old save) gains one, or the page words a change that never happened
//   - a failed event command leaves the Rite moved (the rollback forgets it)
//   - the preview or the result line says the wrong number or the wrong direction
//   - the validator lets a rite effect into an ordinary act's event, or a delta out of range
//   - the sims' policy walks past the choice that quiets the circle
import { describe, it, expect } from 'vitest';
import { loadGameData } from './testData.js';
import { RunManager } from '../src/engine/RunManager.js';
import { arriveAtEvent, chooseEventOption } from '../src/engine/EventCommands.js';
import {
  RUN_FIELDS,
  applyPlan,
  planEffects,
  restoreRunState,
  snapshotRunState,
} from '../src/engine/EventEffects.js';
import { effectPreview } from '../src/engine/EventChoicePreview.js';
import { describeResult } from '../src/engine/EventResultWords.js';
import { validateEventsConfig } from '../src/engine/EventValidation.js';
import { createRite } from '../src/engine/Rite.js';
import { chooseEventPlan } from './sim/RunPolicies.js';
import { unitHasStaff } from '../src/engine/EventSystem.js';
import { addUnit } from './eventKit.js';

const baseData = loadGameData();
const descentData = () => ({
  ...baseData,
  descent: { ...structuredClone(baseData.descent), enabled: true },
});
const eventById = (id) => baseData.events.events.find((e) => e.id === id);

function descentRun(seed = 13) {
  const rm = new RunManager(descentData());
  rm.startRun({ runSeed: seed, difficultyId: 'hard', applyBlessingsAtStart: false });
  rm.actIndex = rm.actSequence.indexOf('finalBoss') - 1;
  rm.advanceAct();
  return rm;
}

/** Arrive at the fork's event node holding `eventId` (the pick is EventSystem's, tested elsewhere). */
function atEvent(rm, eventId) {
  const node = rm.nodeMap.nodes.find((n) => n.descentKey === 'side_stair');
  arriveAtEvent(rm, node.id);
  rm.eventStateByNodeId[node.id] = { ...rm.eventStateByNodeId[node.id], eventId };
  return node;
}

const plan = (run, effects) =>
  planEffects({ run, nodeId: 'finalBoss_1_3', event: { id: 'test_event' }, phase: 'o' }, effects);

describe('planning and applying', () => {
  it('moves the Rite by the delta, logging the event and the node', () => {
    const run = descentRun();
    run.rite = createRite({ start: 4 });
    const planned = plan(run, [{ type: 'rite', delta: 2 }]);
    expect(planned.ok).toBe(true);
    const results = applyPlan(
      { run, nodeId: 'finalBoss_1_3', event: { id: 'test_event' } },
      planned.steps,
    );
    expect(run.rite.words).toBe(6);
    expect(run.rite.log.at(-1)).toEqual({
      source: 'event',
      delta: 2,
      nodeId: 'finalBoss_1_3',
      eventId: 'test_event',
    });
    expect(results).toEqual([{ kind: 'rite', delta: 2, requested: 2, words: 6, band: 'spoken' }]);
  });

  it('never below 0: the record says what happened, the line says unchanged', () => {
    const run = descentRun();
    run.rite = createRite({ start: 0 });
    const [record] = applyPlan(
      { run, nodeId: 'n' },
      plan(run, [{ type: 'rite', delta: -3 }]).steps,
    );
    expect(run.rite.words).toBe(0);
    expect(record).toMatchObject({ kind: 'rite', delta: 0, requested: -3, words: 0 });
    expect(describeResult(record).text).toBe('The rite: unchanged');
  });

  it('a run with no Rite keeps none, and the page says nothing', () => {
    const run = descentRun();
    run.rite = null;
    const [record] = applyPlan(
      { run, nodeId: 'n' },
      plan(run, [{ type: 'rite', delta: -1 }]).steps,
    );
    expect(run.rite).toBeNull();
    expect(record).toEqual({ kind: 'rite', delta: 0, requested: -1, words: null, band: null });
    expect(describeResult(record)).toBeNull();
  });

  it('is one of the run fields an event command rolls back', () => {
    const run = descentRun();
    run.rite = createRite({ start: 5 });
    expect(RUN_FIELDS).toContain('rite');
    const snapshot = snapshotRunState(run);
    applyPlan({ run, nodeId: 'n' }, plan(run, [{ type: 'rite', delta: 3 }]).steps);
    expect(run.rite.words).toBe(8);
    restoreRunState(run, snapshot);
    expect(run.rite.words).toBe(5);
  });

  it('through the event commands: the Last Lantern left burning lowers it by one', () => {
    const run = descentRun();
    run.rite = createRite({ start: 6 });
    const node = atEvent(run, 'last_lantern');
    const chosen = chooseEventOption(run, node.id, 'leave');
    expect(chosen.ok, chosen.reason).toBe(true);
    expect(run.rite.words).toBe(5);
    expect(run.rite.log.at(-1)).toEqual({
      source: 'event',
      delta: -1,
      nodeId: node.id,
      eventId: 'last_lantern',
    });
    expect(chosen.results.map((r) => describeResult(r)?.text)).toContain('The rite: −1 word');
  });

  it('the Seers’ Last Page: finished by a staff-bearer (−3), burned (−1 and a Lingering Injury)', () => {
    expect(eventById('seers_last_page').choices.find((c) => c.id === 'finish').requires).toEqual({
      roster: { staff: true },
    });
    // No one who can use a staff: Finish is closed, and Burn costs a word and a wound.
    const burned = descentRun();
    burned.rite = createRite({ start: 6 });
    burned.roster = burned.roster.filter((u) => !unitHasStaff(u));
    const n1 = atEvent(burned, 'seers_last_page');
    expect(chooseEventOption(burned, n1.id, 'finish').ok).toBe(false);
    expect(burned.rite.words).toBe(6);
    const burn = chooseEventOption(burned, n1.id, 'burn');
    expect(burn.ok, burn.reason).toBe(true);
    expect(burned.rite.words).toBe(5);
    expect(burned.burdens.some((b) => b.id === 'wounded')).toBe(true);
    // A Cleric in the army: Finish lowers it by three.
    const finished = descentRun();
    finished.rite = createRite({ start: 6 });
    addUnit(finished, 'Cleric', { name: 'Mara', level: 5 });
    const n2 = atEvent(finished, 'seers_last_page');
    const done = chooseEventOption(finished, n2.id, 'finish');
    expect(done.ok, done.reason).toBe(true);
    expect(finished.rite.words).toBe(3);
  });
});

describe('the words', () => {
  it('the preview names the change, signed, singular or plural', () => {
    const ctx = { run: descentRun(), event: eventById('last_lantern'), state: {} };
    expect(effectPreview({ type: 'rite', delta: -1 }, ctx).text).toBe('The rite: −1 word');
    expect(effectPreview({ type: 'rite', delta: 2 }, ctx).text).toBe('The rite: +2 words');
    expect(effectPreview({ type: 'rite', delta: -3 }, ctx).text).toBe('The rite: −3 words');
  });

  it('the result line: fewer words are good news, more are bad, with where it stands', () => {
    expect(
      describeResult({ kind: 'rite', delta: -1, requested: -1, words: 4, band: 'broken' }),
    ).toEqual({
      tone: 'good',
      text: 'The rite: −1 word',
      detail: 'The rite stands at 4 words · Broken.',
    });
    expect(
      describeResult({ kind: 'rite', delta: 2, requested: 2, words: 13, band: 'answered' }),
    ).toEqual({
      tone: 'bad',
      text: 'The rite: +2 words',
      detail: 'The rite stands at 13 words · Answered.',
    });
  });
});

describe('validation', () => {
  const withEvent = (mutate) => {
    const config = structuredClone(baseData.events);
    mutate(config);
    return validateEventsConfig(config, baseData);
  };

  it('the shipped events pass', () => {
    expect(validateEventsConfig(structuredClone(baseData.events), baseData).errors).toEqual([]);
  });

  it('refuses a rite effect in an ordinary act’s event', () => {
    const result = withEvent((config) => {
      const drill = config.events.find((e) => e.id === 'drill_yard');
      drill.choices[0].outcomes[0].effects.push({ type: 'rite', delta: -1 });
    });
    expect(result.errors.join('\n')).toContain('a rite effect belongs to a pooled Descent');
  });

  it('refuses a delta of 0 or beyond three', () => {
    for (const delta of [0, 4, -4, 1.5]) {
      const result = withEvent((config) => {
        config.events.find((e) => e.id === 'last_lantern').choices[1].outcomes[0].effects = [
          { type: 'rite', delta },
        ];
      });
      expect(result.errors.join('\n'), String(delta)).toContain('rite.delta must be');
    }
  });
});

describe('the sims’ policy', () => {
  it('takes the choice sure to quiet the circle, the surest first', () => {
    const run = descentRun();
    run.rite = createRite({ start: 6 });
    const node = atEvent(run, 'last_lantern');
    expect(chooseEventPlan(run, node.id).choiceId).toBe('leave');
  });
});
