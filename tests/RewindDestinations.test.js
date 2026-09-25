import { describe, expect, it } from 'vitest';
import {
  actionOutcomeChips,
  describeBefore,
  entryActionFact,
  listRewindDestinations,
  rewindGranularityForRun,
  summarizeActionFact,
} from '../src/engine/RewindDestinations.js';
import {
  appendBattleTimeline,
  branchBattleTimeline,
  createBattleTimeline,
} from '../src/engine/BattleTimeline.js';
import { captureBattleState } from '../src/ui/BattleCheckpointAdapter.js';

const names = { u1: 'Edric', u2: 'Sera', u3: 'Knight', u4: 'Patient', u5: 'Bandit', u6: 'Silas' };
const lookup = (id) => (names[id] ? { name: names[id], className: 'Class' } : null);
const beat = (type, actorId, targetId = null, extra = {}) => ({
  type,
  actorId,
  targetId,
  label: `${names[actorId] || 'Unseen enemy'} ${type}${targetId ? ` ${names[targetId]}` : ''}${extra.detail ? ` · ${extra.detail}` : ''}.`,
  ...(extra.outcome ? { outcome: extra.outcome } : {}),
});

describe('summarizing a player activation', () => {
  it('names an attack with its art, strikes, damage taken and KO', () => {
    const fact = summarizeActionFact(
      [
        { type: 'moved', actorId: 'u1', path: [] },
        beat('attacked', 'u1', 'u3', { detail: 'Wrath Strike' }),
        beat('hit', 'u1', 'u3', { outcome: { damage: 7, miss: false, critical: false } }),
        beat('hit', 'u3', 'u1', { outcome: { damage: 4, miss: false, critical: false } }),
        beat('critically hit', 'u1', 'u3', {
          outcome: { damage: 21, miss: false, critical: true },
        }),
        beat('defeated', 'u1', 'u3'),
      ],
      'u1',
      lookup,
    );
    expect(fact).toEqual({
      type: 'action',
      actorId: 'u1',
      actor: 'Edric',
      className: 'Class',
      verb: 'attack',
      target: 'Knight',
      targetId: 'u3',
      detail: 'Wrath Strike',
      outcome: { hits: 2, crits: 1, damage: 28, taken: 4 },
      ko: ['Knight'],
    });
    expect(describeBefore(fact)).toBe('Before Edric’s Wrath Strike on Knight');
    expect(actionOutcomeChips(fact).map((c) => c.text)).toEqual(['Crit 28', 'Took 4', 'KO']);
  });

  it('reports a whiff, a zero-damage hit and a counter-kill', () => {
    const miss = summarizeActionFact(
      [
        beat('attacked', 'u1', 'u3'),
        beat('missed', 'u1', 'u3', { outcome: { damage: 0, miss: true, critical: false } }),
      ],
      'u1',
      lookup,
    );
    expect(actionOutcomeChips(miss).map((c) => c.text)).toEqual(['Missed']);
    const plink = summarizeActionFact(
      [
        beat('attacked', 'u1', 'u3'),
        beat('hit', 'u1', 'u3', { outcome: { damage: 0, miss: false, critical: false } }),
        beat('missed', 'u1', 'u3', { outcome: { damage: 0, miss: true, critical: false } }),
        beat('defeated', 'u3', 'u1'),
      ],
      'u1',
      lookup,
    );
    expect(actionOutcomeChips(plink).map((c) => c.text)).toEqual(['Hit · no dmg · 1 miss', 'Fell']);
  });

  it.each([
    [
      [beat('healed', 'u2', 'u4', { detail: '9 HP', outcome: { amount: 9 } })],
      'Before Sera’s heal on Patient',
      ['+9 HP'],
    ],
    [[beat('danced for', 'u2', 'u4')], 'Before Sera’s dance on Patient', []],
    [
      [beat('traded with', 'u2', 'u4', { detail: 'Vulnerary' })],
      'Before Sera’s trade with Patient',
      [],
    ],
    [[beat('used', 'u2', null, { detail: 'Vulnerary' })], 'Before Sera’s Vulnerary', []],
    [
      [beat('relocated', 'u2', 'u4', { detail: 'Warp Staff' })],
      'Before Sera’s Warp Staff on Patient',
      [],
    ],
    [[beat('cured', 'u2', 'u4', { detail: 'Restore' })], 'Before Sera’s cure on Patient', []],
    [[beat('rallied', 'u2', 'u4'), beat('rallied', 'u2', 'u1')], 'Before Sera’s rally', []],
    [[beat('rooted', 'u2', 'u5')], 'Before Sera’s ensnare on Bandit', []],
    [[beat('shoved', 'u2', 'u4')], 'Before Sera’s shove on Patient', []],
    [[beat('pulled', 'u2', 'u4')], 'Before Sera’s pull on Patient', []],
    [[beat('swapped with', 'u2', 'u4')], 'Before Sera’s swap with Patient', []],
    [[beat('escaped', 'u2')], 'Before Sera’s escape', []],
    [[beat('captured a ballista', 'u2')], 'Before Sera’s ballista', []],
    [
      [beat('visited the village', 'u2', null, { detail: 'Got 500 gold' })],
      'Before Sera’s village visit',
      [],
    ],
    [[beat('recruited', 'u2', 'u6')], 'Before Sera’s talk on Silas', []],
    [[beat('waited', 'u2')], 'Before Sera’s wait', []],
    [[{ type: 'moved', actorId: 'u2', path: [] }, beat('waited', 'u2')], 'Before Sera’s move', []],
    [
      [beat('traded with', 'u2', 'u4'), beat('finished their action', 'u2')],
      'Before Sera’s trade with Patient',
      [],
    ],
  ])('%#: $1', (beats, title, chips) => {
    const fact = summarizeActionFact(beats, 'u2', lookup);
    expect(describeBefore(fact)).toBe(title);
    expect(actionOutcomeChips(fact).map((c) => c.text)).toEqual(chips);
  });

  it('never names what the recorder could not see', () => {
    expect(summarizeActionFact([beat('attacked', 'u1', null)], 'u1', lookup)).toMatchObject({
      verb: 'attack',
    });
    expect(
      summarizeActionFact([beat('attacked', 'u1', null)], 'u1', lookup).target,
    ).toBeUndefined();
    expect(summarizeActionFact([beat('waited', 'u1')], null, lookup)).toBeNull();
    expect(summarizeActionFact([beat('waited', 'u9')], 'u9', lookup)).toBeNull();
    expect(summarizeActionFact([], 'u1', lookup)).toBeNull();
  });

  it('picks the most consequential fact of a merged fragment', () => {
    const entry = {
      facts: [
        'Sera traded with Patient.',
        { type: 'action', verb: 'trade', actor: 'Sera' },
        { type: 'action', verb: 'heal', actor: 'Sera' },
      ],
    };
    expect(entryActionFact(entry).verb).toBe('heal');
    expect(describeBefore(null, 'Edric fell')).toBe('Before Edric fell');
  });
});

// ── Destination list ────────────────────────────────────────────────────────
function state(turn, phase = 'player', acted = []) {
  return captureBattleState(
    {
      playerUnits: ['u1', 'u2', 'u4'].map((id, i) => ({
        battleEntityId: id,
        name: names[id],
        col: i,
        row: 0,
        stats: { HP: 20, STR: 5, MAG: 5, SKL: 5, SPD: 5, DEF: 5, RES: 5, LCK: 5, MOV: 5 },
        currentHP: 20,
        inventory: [],
        consumables: [],
        hasActed: acted.includes(id),
      })),
      enemyUnits: [],
      npcUnits: [],
      _battleRewindPolicy: 'fixed-v1',
      _battleRng: {
        getState: () => ({ algorithm: 'mulberry32-v1', cursor: turn * 10 + acted.length }),
      },
      turnManager: { currentPhase: phase, turnNumber: turn },
      grid: { mapLayout: [[0, 0, 0]], temporaryTerrains: [] },
      _nextBattleEntityId: 10,
    },
    { rngSeed: 42 },
  );
}
const act = (actor, verb, target) => ({
  type: 'action',
  actorId: actor,
  actor: names[actor],
  verb,
  ...(target ? { target: names[target], targetId: target } : {}),
});

function battle() {
  let h = createBattleTimeline();
  const add = (kind, turn, extra = {}) => {
    const phase = kind === 'enemy_action' ? 'enemy' : 'player';
    const destination = ['turn_start', 'player_action'].includes(kind) && !extra.noSnapshot;
    const snap = state(turn, phase, extra.acted || []);
    h = appendBattleTimeline(h, {
      kind,
      turnNumber: turn,
      phase,
      facts: extra.facts || [],
      preview: { enemiesActNext: Boolean(extra.enemiesActNext) },
      snapshot: destination ? snap : null,
      destination,
    });
    return h.entries.at(-1).id;
  };
  const ids = {};
  ids.t1 = add('turn_start', 1);
  ids.a1 = add('player_action', 1, { acted: ['u4'], facts: [act('u4', 'wait')] });
  ids.a2 = add('player_action', 1, { acted: ['u4', 'u1'], facts: [act('u1', 'attack', 'u3')] });
  ids.a3 = add('player_action', 1, {
    acted: ['u4', 'u1', 'u2'],
    enemiesActNext: true,
    facts: [act('u2', 'heal', 'u4')],
  });
  add('enemy_action', 1);
  ids.t2 = add('turn_start', 2);
  ids.b1 = add('player_action', 2, { acted: ['u1'], facts: [act('u1', 'attack', 'u3')] });
  ids.b2 = add('player_action', 2, { acted: ['u1', 'u2'], facts: [act('u2', 'dance', 'u1')] });
  return { h, ids };
}

describe('listing rewind destinations', () => {
  it('lists "before" points newest first, skipping now and enemy handoffs', () => {
    const { h, ids } = battle();
    const { rows, currentTurn } = listRewindDestinations(h, { currentEntryId: ids.b2 });
    expect(currentTurn).toBe(2);
    expect(rows.map((r) => [r.id, r.kind, r.title])).toEqual([
      [ids.b1, 'action', 'Before Sera’s dance on Edric'],
      [ids.t2, 'turn_start', 'Before Edric’s attack on Knight'],
      [ids.a2, 'action', 'Before Sera’s heal on Patient'],
      [ids.a1, 'action', 'Before Edric’s attack on Knight'],
      [ids.t1, 'turn_start', 'Before Patient’s wait'],
    ]);
    expect(rows.every((r) => r.available && !r.reason)).toBe(true);
    expect(rows.filter((r) => r.currentTurn).map((r) => r.id)).toEqual([ids.b1, ids.t2]);
  });

  it('after a rewind the landing point is "now" and later points are gone', () => {
    const { h, ids } = battle();
    const branch = branchBattleTimeline(h, ids.b1);
    const { rows } = listRewindDestinations(branch, { currentEntryId: ids.b1 });
    expect(rows.map((r) => r.id)).toEqual([ids.t2, ids.a2, ids.a1, ids.t1]);
    expect(rows[0].title).toBe('Before Edric’s attack on Knight');
  });

  it('explains points a difficulty or the budget does not allow', () => {
    const { h, ids } = battle();
    const lunatic = listRewindDestinations(h, { currentEntryId: ids.b2, difficulty: 'lunatic' });
    expect(lunatic.granularity).toBe('turn');
    expect(lunatic.rows.filter((r) => r.available).map((r) => r.id)).toEqual([ids.t2, ids.t1]);
    expect(lunatic.rows.find((r) => r.id === ids.b1).reason).toMatch(/Turn starts only/);
    const opened = listRewindDestinations(h, {
      currentEntryId: ids.b2,
      difficulty: 'lunatic',
      granularity: 'action',
    });
    expect(opened.rows.every((r) => r.available)).toBe(true);
    const evicted = structuredClone(h);
    const row = evicted.entries.find((e) => e.id === ids.a1);
    delete evicted.snapshots[row.snapshotId];
    row.snapshotId = null;
    row.destination = false;
    const listing = listRewindDestinations(evicted, { currentEntryId: ids.b2 });
    expect(listing.rows.find((r) => r.id === ids.a1)).toMatchObject({
      available: false,
      reason: 'Too far back. This moment is no longer stored.',
    });
  });

  it('labels a point by what followed it even without structured facts', () => {
    let h = createBattleTimeline();
    h = appendBattleTimeline(h, {
      kind: 'turn_start',
      turnNumber: 1,
      phase: 'player',
      facts: ['Player turn begins.'],
      snapshot: state(1),
      destination: true,
    });
    h = appendBattleTimeline(h, {
      kind: 'recovery',
      turnNumber: 1,
      phase: 'player',
      facts: [
        'Action resolved.',
        'Edric fell.',
        'The commander fell. Choose whether to rewind or accept defeat.',
      ],
    });
    const { rows } = listRewindDestinations(h, { currentEntryId: h.entries.at(-1).id });
    expect(rows.map((r) => r.title)).toEqual(['Before Edric fell']);
    expect(listRewindDestinations(createBattleTimeline()).rows).toEqual([]);
  });

  it('a re-recorded turn start supersedes the earlier one', () => {
    let h = createBattleTimeline();
    for (const kind of ['turn_start', 'turn_start'])
      h = appendBattleTimeline(h, {
        kind,
        turnNumber: 1,
        phase: 'player',
        snapshot: state(1),
        destination: true,
      });
    h = appendBattleTimeline(h, {
      kind: 'player_action',
      turnNumber: 1,
      phase: 'player',
      facts: [act('u4', 'wait')],
      snapshot: state(1, 'player', ['u4']),
      destination: true,
    });
    const { rows } = listRewindDestinations(h, { currentEntryId: 3 });
    expect(rows.map((r) => [r.id, r.title])).toEqual([[2, 'Before Patient’s wait']]);
  });

  it('reads the run’s difficulty data before the difficulty default', () => {
    expect(rewindGranularityForRun({ difficultyId: 'lunatic', difficultyModifiers: {} })).toBe(
      'turn',
    );
    expect(
      rewindGranularityForRun({
        difficultyId: 'lunatic',
        difficultyModifiers: { rewindGranularity: 'action' },
      }),
    ).toBe('action');
    expect(
      rewindGranularityForRun({
        difficultyId: 'normal',
        difficultyModifiers: { rewindGranularity: 'turn' },
      }),
    ).toBe('turn');
    expect(rewindGranularityForRun(null)).toBe('action');
  });
});
