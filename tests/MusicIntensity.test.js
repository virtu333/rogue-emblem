import { describe, it, expect } from 'vitest';
import {
  INTENSITY,
  createIntensityState,
  initialIntensity,
  nextIntensity,
} from '../src/engine/MusicIntensity.js';

const combat = { type: 'combat' };
const phase = (p, playersInDanger = false) => ({ type: 'phase', phase: p, playersInDanger });

function run(events, start = createIntensityState()) {
  return events.reduce((s, e) => nextIntensity(s, e), start);
}

describe('MusicIntensity', () => {
  it('opens calm, or full when a battle resumes with units already under threat', () => {
    expect(createIntensityState().level).toBe(INTENSITY.CALM);
    expect(initialIntensity()).toBe(INTENSITY.CALM);
    expect(initialIntensity({ playersInDanger: true })).toBe(INTENSITY.FULL);
  });

  it('rises to full the moment blows are exchanged', () => {
    expect(run([combat]).level).toBe(INTENSITY.FULL);
  });

  it('rises at the enemy phase only when an enemy can reach a player unit', () => {
    expect(run([phase('enemy', false)]).level).toBe(INTENSITY.CALM);
    expect(run([phase('enemy', true)]).level).toBe(INTENSITY.FULL);
  });

  it('stays full into the next player phase after a round with combat', () => {
    const s = run([combat, phase('enemy'), phase('player', false)]);
    expect(s.level).toBe(INTENSITY.FULL);
    expect(s.combatThisRound).toBe(false);
  });

  it('settles to calm after a whole quiet round with nobody in danger', () => {
    const s = run([combat, phase('enemy'), phase('player'), phase('enemy'), phase('player')]);
    expect(s.level).toBe(INTENSITY.CALM);
  });

  it('never settles while a player unit stands in the threat range', () => {
    const s = run([
      combat,
      phase('enemy'),
      phase('player', true),
      phase('enemy', true),
      phase('player', true),
    ]);
    expect(s.level).toBe(INTENSITY.FULL);
  });

  it('does not mutate the state it was given', () => {
    const start = createIntensityState();
    nextIntensity(start, combat);
    expect(start).toEqual(createIntensityState());
  });

  it('ignores unknown events', () => {
    const start = createIntensityState();
    expect(nextIntensity(start, { type: 'weather' })).toEqual(start);
    expect(nextIntensity(start, null)).toEqual(start);
  });
});
