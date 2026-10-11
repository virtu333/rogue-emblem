// engine/Rite.js (docs/specs/act-v-descent.md §4, §9.5): the run's count of the court circle's
// words, pure. Ways this breaks:
//   - a lowering takes the words below 0, or changes the Rite it was handed
//   - a save's broken or older record loads as a Rite (or a whole one loads as none)
//   - the tiers' edges are off by one, or the start ignores the Eclipse's phase
//   - a boss is handed another boss's mods, a non-boss node gets mods, a tier with nothing still
//     writes a key, or an Entity mod that touches its HP or stones gets through
//   - the Mortuary Column's par rule fires over par or on another node
//   - the validator lets a bad `rite` block into validate:data
import { describe, it, expect } from 'vitest';
import { loadGameData } from './testData.js';
import {
  DEFAULT_RITE_CONFIG,
  RITE_LOG_MAX,
  applyRiteDelta,
  createRite,
  riteBand,
  riteModsFor,
  riteStartFromEclipse,
  riteTargetOf,
  riteUnderParDelta,
  riteView,
  sanitizeRite,
  sanitizeRiteMods,
} from '../src/engine/Rite.js';
import { validateDescentConfig } from '../src/engine/Descent.js';

const data = loadGameData();
const RITE = data.descent.rite;

/** A run that only carries what Rite.js reads. */
const runWith = (words, { finale = 'entity' } = {}) => ({
  rite: { ...createRite({ start: 0 }), words },
  gameData: data,
  nodeMap: { descent: { v: 1, finale } },
});
const bossNode = (bossName, role = 'finale', extra = {}) => ({
  id: 'finalBoss_4_2',
  type: 'boss',
  riteTarget: true,
  battleParams: { act: 'finalBoss', bossName, bossRole: role, isBoss: true },
  ...extra,
});
const LIEUTENANT = bossNode('The Lieutenant', 'gate');
const ENTITY = bossNode('The Entity');

describe('the Rite’s state', () => {
  it('starts at the Eclipse’s words, logged as the first entry', () => {
    expect(createRite({ start: 4 })).toEqual({
      v: 1,
      words: 4,
      start: 4,
      log: [{ source: 'eclipse', delta: 4 }],
    });
    expect(createRite({ start: -3 }).words).toBe(0);
  });

  it('a change never takes the words below 0, and the log keeps what was asked', () => {
    const rite = createRite({ start: 2 });
    const frozen = structuredClone(rite);
    const after = applyRiteDelta(rite, -5, { source: 'event', eventId: 'seers_last_page' });
    expect(rite).toEqual(frozen); // the input is untouched
    expect(after.words).toBe(0);
    expect(after.log.at(-1)).toEqual({
      source: 'event',
      delta: -2,
      requested: -5,
      eventId: 'seers_last_page',
    });
    const up = applyRiteDelta(after, 7, { source: 'vigil', nodeId: 'finalBoss_2_2' });
    expect(up.words).toBe(7);
    expect(up.log.at(-1)).toEqual({ source: 'vigil', delta: 7, nodeId: 'finalBoss_2_2' });
  });

  it('the log keeps the newest entries only', () => {
    let rite = createRite({ start: 0 });
    for (let i = 0; i < RITE_LOG_MAX + 10; i++) rite = applyRiteDelta(rite, 1, { source: 'vigil' });
    expect(rite.log).toHaveLength(RITE_LOG_MAX);
    expect(rite.words).toBe(RITE_LOG_MAX + 10);
  });

  it('a save without a whole v1 record loads as no Rite; a whole one is made sound', () => {
    for (const raw of [null, undefined, 3, [], {}, { words: 4 }, { v: 2, words: 4 }])
      expect(sanitizeRite(raw)).toBeNull();
    expect(
      sanitizeRite({
        v: 1,
        words: -2,
        start: '3',
        log: [{ source: 'vigil', delta: 2 }, { source: 'nonsense', delta: 1 }, 'x'],
      }),
    ).toEqual({ v: 1, words: 0, start: 3, log: [{ source: 'vigil', delta: 2 }] });
  });
});

describe('tiers and the start', () => {
  it('reads the bands of descent.json at their edges', () => {
    // Derived from the data, not from the code: each band's own min and max.
    for (const band of RITE.bands) {
      expect(riteBand(band.min, data.descent)).toBe(band.id);
      if (band.max !== undefined) {
        expect(riteBand(band.max, data.descent)).toBe(band.id);
        expect(riteBand(band.max + 1, data.descent)).not.toBe(band.id);
      }
    }
    expect(riteBand(999, data.descent)).toBe(RITE.bands.at(-1).id);
    expect(riteBand({ words: 5 }, data.descent)).toBe('spoken');
    // No rite block: the spec's own bands.
    expect(riteBand(12, null)).toBe(DEFAULT_RITE_CONFIG.bands.at(-1).id);
  });

  it('starts from the Eclipse’s phase, and at 0 with it off', () => {
    for (const [phaseId, words] of Object.entries(RITE.startByPhase))
      expect(riteStartFromEclipse({ active: true, phaseId }, data.descent)).toBe(words);
    expect(riteStartFromEclipse({ active: false, phaseId: 'hollow' }, data.descent)).toBe(0);
    expect(riteStartFromEclipse({ active: true, phaseId: 'dawn' }, data.descent)).toBe(0);
  });
});

describe('the mods a tier puts on a boss', () => {
  const at = (band) => RITE.bands.find((b) => b.id === band).min;

  it('a boss node of the Descent is the Lieutenant’s or the Entity’s; any other node none', () => {
    expect(riteTargetOf(LIEUTENANT, data)).toBe('lieutenant');
    expect(riteTargetOf(ENTITY, data)).toBe('entity');
    // The Vigil carries riteTarget but is no boss: the tier never touches it.
    expect(
      riteTargetOf({ type: 'battle', riteTarget: true, battleParams: { act: 'finalBoss' } }, data),
    ).toBeNull();
    // A boss node off the Descent (no role, no riteTarget) is none.
    expect(
      riteTargetOf({ type: 'boss', battleParams: { act: 'act3', bossName: 'Blade Lord' } }, data),
    ).toBeNull();
  });

  it('hands each boss its own band’s mods, and nothing when the band has none', () => {
    for (const band of ['broken', 'spoken', 'answered']) {
      for (const [node, target] of [
        [LIEUTENANT, 'lieutenant'],
        [ENTITY, 'entity'],
      ]) {
        const mods = riteModsFor(runWith(at(band)), node);
        const own = RITE.mods[band]?.[target] || {};
        if (Object.keys(own).length === 0) {
          expect(mods, `${band}/${target}`).toEqual({});
          continue;
        }
        const { band: b, target: t, waveLevelBonus, ...rest } = mods;
        expect([b, t]).toEqual([band, target]);
        expect(rest).toEqual(own);
        if (own.waveHollowed)
          expect(waveLevelBonus).toBe(
            Math.min(RITE.levelCap, Math.floor(at(band) / RITE.perWordLevel)),
          );
      }
    }
    expect(riteModsFor({ ...runWith(20), rite: null }, ENTITY)).toEqual({});
  });

  it('never lets an Entity mod past the two it may carry', () => {
    expect(
      sanitizeRiteMods(
        { splashDelta: 1, waveHollowed: 2, revivalStones: 3, hp: -40, hinge: 1, rally: 0 },
        'entity',
      ),
    ).toEqual({ splashDelta: 1, waveHollowed: 2 });
    // Even data that slipped past the validator: an Answered Entity carrying stones.
    const run = runWith(20);
    run.gameData = structuredClone(data);
    run.gameData.descent.rite.mods.answered.entity.revivalStones = 2;
    run.gameData.descent.rite.mods.answered.entity.hpBonus = 30;
    const mods = riteModsFor(run, ENTITY);
    expect(mods).not.toHaveProperty('revivalStones');
    expect(mods).not.toHaveProperty('hpBonus');
  });

  it('the Mortuary Column takes its change won at or under par, never over or elsewhere', () => {
    const column = { descentKey: 'column' };
    const delta = RITE.underPar.column;
    expect(delta).toBeLessThan(0);
    expect(riteUnderParDelta(data.descent, column, { turnCount: 8, turnPar: 8 })).toBe(delta);
    expect(riteUnderParDelta(data.descent, column, { turnCount: 5, turnPar: 8 })).toBe(delta);
    expect(riteUnderParDelta(data.descent, column, { turnCount: 9, turnPar: 8 })).toBe(0);
    expect(riteUnderParDelta(data.descent, column, { turnCount: 5, turnPar: null })).toBe(0);
    expect(
      riteUnderParDelta(data.descent, { descentKey: 'stair' }, { turnCount: 1, turnPar: 9 }),
    ).toBe(0);
  });
});

describe('riteView (the chip and the finale preview)', () => {
  it('is null without a Rite', () => {
    expect(riteView({ rite: null, gameData: data })).toBeNull();
  });

  it('names the words, the tier, the next tier and what the tier does to the route’s bosses', () => {
    const view = riteView(runWith(12));
    expect(view).toMatchObject({
      words: 12,
      band: 'answered',
      label: 'Answered',
      chip: 'The Rite: 12 words · Answered',
      next: null,
    });
    expect(view.effects.map((e) => e.target)).toEqual(['lieutenant', 'entity']);
    expect(view.effects[0].lines).toEqual([
      'The Lieutenant carries 1 more Revival Stone',
      '2 Hollowed join him on turn 4',
    ]);
    expect(view.effects[1].lines).toEqual([
      "The Entity's splash strikes 1 tile more",
      'Each of its waves brings 2 Hollowed',
    ]);
    const spoken = riteView(runWith(5, { finale: 'lieutenant' }));
    expect(spoken.chip).toBe('The Rite: 5 words · Spoken');
    expect(spoken.next).toEqual({ band: 'answered', label: 'Answered', at: 10 });
    expect(spoken.effects).toEqual([{ target: 'lieutenant', lines: ['No change'] }]);
    const broken = riteView(runWith(1), { node: ENTITY });
    expect(broken.chip).toBe('The Rite: 1 word · Broken');
    expect(broken.effects).toEqual([
      { target: 'entity', lines: ["The Entity's splash strikes 1 tile fewer"] },
    ]);
  });
});

describe('validating the rite block (validate:data)', () => {
  const plant = (mutate, needle) => {
    const config = structuredClone(data.descent);
    mutate(config.rite);
    const result = validateDescentConfig(config, data);
    expect(result.valid, `expected a refusal containing "${needle}"`).toBe(false);
    expect(result.errors.join('\n')).toContain(needle);
  };

  it('the shipped block passes', () => {
    expect(validateDescentConfig(structuredClone(data.descent), data).errors).toEqual([]);
  });

  it('refuses any mod that reaches the Entity’s HP, stones, hinge, hum or rally', () => {
    const refusal = "the Rite never touches the Entity's HP, stones, hinge, hum or rally";
    for (const key of ['revivalStones', 'hp', 'hpBonus', 'hinge', 'hum', 'rally', 'enrage'])
      plant((rite) => (rite.mods.answered.entity[key] = 1), refusal);
  });

  it('refuses a mod a boss does not take, out of bounds, or for no boss', () => {
    plant((rite) => (rite.mods.broken.lieutenant.splashDelta = -1), 'not a mod the lieutenant');
    plant((rite) => (rite.mods.answered.entity.splashDelta = 5), 'from -4 to 4');
    plant((rite) => (rite.mods.answered.emperor = {}), '"emperor" is not a boss');
    plant((rite) => delete rite.mods.answered.lieutenant.waveHollowed, 'waveTurn needs');
  });

  it('refuses an underPar key that names no battle node, or a change out of range', () => {
    plant((rite) => (rite.underPar.vigl = -1), '"vigl" is no battle node');
    plant((rite) => (rite.underPar.column = 0), 'from -3 to 3, not 0');
    plant((rite) => (rite.underPar.column = -4), 'from -3 to 3, not 0');
  });
});
