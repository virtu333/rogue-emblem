import { describe, it, expect } from 'vitest';
import {
  TEMPERAMENT_IDS,
  fallenLine,
  fillVoiceTokens,
  namesAbsentLord,
  levelBeatLine,
  levelUpLine,
  promotionLine,
  spotlightStat,
  strideLine,
  temperamentFor,
  voiceContext,
} from '../src/engine/UnitVoice.js';
import { levelUpContent } from '../src/ui/growthContent.js';

const pool = (tag, n) => Array.from({ length: n }, (_, i) => `${tag} ${i}`);

function makeVoice() {
  const temperaments = {};
  for (const id of TEMPERAMENT_IDS)
    temperaments[id] = {
      label: id,
      levelUp: { normal: pool(`T:${id}`, 6), perfect: pool(`TP:${id}`, 3), blank: pool(`TB:${id}`, 3) }, // prettier-ignore
      fallen: pool(`TF:${id}`, 3),
    };
  return {
    temperaments,
    classes: {
      Fighter: {
        levelUp: { normal: pool('C:Fighter', 7), perfect: pool('CP', 3), blank: pool('CB', 3) },
        fallen: pool('CF', 3),
      },
      Warrior: { levelUp: { normal: pool('C:Warrior', 7) }, promotion: ['Warrior at last.'] },
    },
    traits: { lazy: pool('TR:lazy', 4) },
    stats: { STR: pool('S:STR', 5), SPD: pool('S:SPD', 5) },
    milestones: { 10: pool('M10', 2), 20: pool('M20', 2), extended: pool('MX', 2) },
    skills: ['Learned {skill}.'],
    dejaVu: pool('DV', 3),
    beats: { perfect: pool('BP', 4), blank: pool('BB', 4) },
    lords: {
      Edric: {
        levelUp: {
          normal: pool('L:normal', 5),
          perfect: pool('L:perfect', 2),
          blank: pool('L:blank', 2),
          milestones: { 20: ['Edric at twenty.'] },
        },
        promotion: ['The crown fits.'],
      },
    },
  };
}

const classes = [{ name: 'Fighter' }, { name: 'Berserker', promotesFrom: 'Fighter' }];
const recruit = { name: 'Galvin', className: 'Fighter', traits: ['lazy'] };
const gains = (g) => ({ newLevel: 5, gains: g });
const ctx = (extra = {}) => ({ voice: makeVoice(), classes, seed: 7, leader: 'Edric', ...extra });

describe('UnitVoice', () => {
  it('strideLine walks a pool without repeats until exhausted', () => {
    const list = pool('x', 7);
    const seen = new Set();
    for (let i = 0; i < 7; i++) seen.add(strideLine(list, 'k', i));
    expect(seen.size).toBe(7);
    expect(strideLine([], 'k', 0)).toBeNull();
  });

  it('temperament is stable per run and name, and varies across runs', () => {
    const voice = makeVoice();
    const a = temperamentFor(recruit, { voice, seed: 1 });
    expect(TEMPERAMENT_IDS).toContain(a);
    expect(temperamentFor({ ...recruit, className: 'Warrior' }, { voice, seed: 1 })).toBe(a);
    const across = new Set();
    for (let seed = 0; seed < 64; seed++) across.add(temperamentFor(recruit, { voice, seed }));
    expect(across.size).toBeGreaterThan(4);
    expect(temperamentFor(recruit, { voice: null })).toBeNull();
  });

  it('tokens resolve, and lines with unresolvable tokens are skipped', () => {
    expect(fillVoiceTokens('For {leader}!', { leader: 'Kira' })).toBe('For Kira!');
    expect(fillVoiceTokens('For {leader}!', {})).toBeNull();
    const voice = makeVoice();
    voice.classes.Fighter.levelUp.normal = ['Only {leader}.'];
    for (const id of TEMPERAMENT_IDS) voice.temperaments[id].levelUp.normal = ['Plain.'];
    voice.traits = {};
    voice.dejaVu = [];
    const content = levelUpContent(recruit, gains({ HP: 1, DEF: 1 }));
    for (let lv = 2; lv < 9; lv++) {
      const line = levelUpLine(recruit, { ...content, levelTo: String(lv) }, { voice, classes, leader: null }); // prettier-ignore
      expect(line.line).toBe('Plain.');
    }
  });

  it('is deterministic and never touches Math.random', () => {
    const content = levelUpContent(recruit, gains({ HP: 1, STR: 1, SKL: 1 }));
    const original = Math.random;
    Math.random = () => {
      throw new Error('RNG touched');
    };
    try {
      const a = levelUpLine(recruit, content, ctx());
      const b = levelUpLine(recruit, content, ctx());
      expect(a).toEqual(b);
      expect(a.line).toBeTruthy();
    } finally {
      Math.random = original;
    }
  });

  it('draws recruit lines from class, temperament, trait and stat layers', () => {
    const sources = new Set();
    for (let seed = 0; seed < 40; seed++)
      for (let lv = 2; lv < 20; lv++) {
        if (lv === 10) continue;
        const content = {
          ...levelUpContent(recruit, gains({ STR: 2, HP: 1 })),
          levelTo: String(lv),
        };
        sources.add(levelUpLine(recruit, content, ctx({ seed }))?.source.split(':')[0]);
      }
    expect(sources).toEqual(new Set(['class', 'temper', 'trait', 'stat', 'dejaVu']));
  });

  it('perfect and blank levels speak from their own pools', () => {
    const perfect = levelUpContent(recruit, gains({ HP: 1, STR: 1, MAG: 1, SKL: 1, SPD: 1, DEF: 1, RES: 1, LCK: 1 })); // prettier-ignore
    expect(levelUpLine(recruit, perfect, ctx()).line).toMatch(/^(CP|TP:)/);
    const blank = levelUpContent(recruit, gains({ DEF: 1 }));
    expect(levelUpLine(recruit, blank, ctx()).line).toMatch(/^(CB|TB:)/);
  });

  it('milestones win at 10, 20 and the first extended level', () => {
    const at = (levelTo) => ({ ...levelUpContent(recruit, gains({ HP: 1, STR: 1 })), levelTo });
    expect(levelUpLine(recruit, at('10'), ctx()).line).toMatch(/^M10/);
    expect(levelUpLine(recruit, at('20'), ctx()).line).toMatch(/^M20/);
    expect(levelUpLine(recruit, at('20+1'), ctx()).line).toMatch(/^MX/);
  });

  it('promoted classes without lines fall back to their base class', () => {
    const berserker = { ...recruit, className: 'Berserker', traits: [] };
    const voice = makeVoice();
    for (const id of TEMPERAMENT_IDS) voice.temperaments[id].levelUp.normal = [];
    voice.stats = {};
    voice.dejaVu = [];
    const content = levelUpContent(berserker, gains({ HP: 1, STR: 1 }));
    expect(levelUpLine(berserker, content, { voice, classes }).line).toMatch(/^C:Fighter/);
  });

  it('lords speak only their own lines', () => {
    const edric = { name: 'Edric', className: 'Lord', isLord: true, traits: ['lazy'] };
    for (let lv = 2; lv < 20; lv++) {
      const content = { ...levelUpContent(edric, gains({ STR: 3, HP: 1 })), levelTo: String(lv) };
      expect(levelUpLine(edric, content, ctx()).line).toMatch(/^L:/);
    }
    const at20 = { ...levelUpContent(edric, gains({ HP: 1, STR: 1 })), levelTo: '20' };
    expect(levelUpLine(edric, at20, ctx()).line).toBe('Edric at twenty.');
    expect(promotionLine(edric, 'Great Lord', ctx())).toBe('The crown fits.');
    // A lord without voice data says nothing rather than borrowing a recruit's.
    const kira = { name: 'Kira', className: 'Tactician', isLord: true };
    expect(levelUpLine(kira, levelUpContent(kira, gains({ HP: 1, STR: 1 })), ctx())).toBeNull();
  });

  it('lines naming another lord play only when that lord is present', () => {
    const lordNames = ['Edric', 'Voss', 'Rowan'];
    const line = 'Voss says it was luck.';
    expect(namesAbsentLord(line, { name: 'Rowan', lordNames, present: null })).toBe(true);
    expect(namesAbsentLord(line, { name: 'Rowan', lordNames, present: new Set(['Edric']) })).toBe(true); // prettier-ignore
    expect(namesAbsentLord(line, { name: 'Rowan', lordNames, present: new Set(['Voss']) })).toBe(false); // prettier-ignore
    expect(namesAbsentLord('Vossian steel.', { name: 'Rowan', lordNames })).toBe(false);
    const voice = makeVoice();
    voice.lords.Edric.levelUp.normal = ['Voss would laugh.', 'Onward.'];
    voice.lords.Voss = { levelUp: { normal: ['Still standing.'] } };
    const edric = { name: 'Edric', className: 'Lord', isLord: true };
    const said = new Set();
    for (let lv = 2; lv < 9; lv++) {
      const content = { ...levelUpContent(edric, gains({ HP: 1, STR: 1 })), levelTo: String(lv) };
      said.add(levelUpLine(edric, content, { voice }).line);
    }
    expect(said).toEqual(new Set(['Onward.']));
    const withVoss = { voice, present: new Set(['Edric', 'Voss']) };
    const both = new Set();
    for (let lv = 2; lv < 9; lv++) {
      const content = { ...levelUpContent(edric, gains({ HP: 1, STR: 1 })), levelTo: String(lv) };
      both.add(levelUpLine(edric, content, withVoss).line);
    }
    expect(both).toEqual(new Set(['Onward.', 'Voss would laugh.']));
  });

  it('skill lines name the learned skill', () => {
    let found = null;
    for (let seed = 0; seed < 20 && !found; seed++) {
      const content = levelUpContent(recruit, gains({ HP: 1, STR: 1 }), ['Vantage']);
      const hit = levelUpLine(recruit, content, ctx({ seed }));
      if (hit.source === 'skill') found = hit.line;
    }
    expect(found).toBe('Learned Vantage.');
  });

  it('spotlights the biggest gain of two or more', () => {
    expect(spotlightStat({ rows: [{ stat: 'STR', gain: 2 }, { stat: 'SPD', gain: 3 }] })).toBe('SPD'); // prettier-ignore
    expect(spotlightStat({ rows: [{ stat: 'STR', gain: 1 }] })).toBeNull();
  });

  it('beats, promotion and fallen lines', () => {
    const perfect = levelUpContent(recruit, gains({ HP: 1, STR: 1, MAG: 1, SKL: 1, SPD: 1, DEF: 1, RES: 1, LCK: 1 })); // prettier-ignore
    expect(levelBeatLine(recruit, perfect, ctx())).toMatch(/^BP/);
    expect(levelBeatLine(recruit, levelUpContent(recruit, gains({ HP: 1, STR: 1 })), ctx())).toBeNull(); // prettier-ignore
    expect(promotionLine({ ...recruit, className: 'Warrior' }, 'Warrior', ctx())).toBe('Warrior at last.'); // prettier-ignore
    expect(fallenLine(recruit, ctx())).toMatch(/^(CF|TF:)/);
    expect(fallenLine({ ...recruit, isLord: true }, ctx())).toBeNull();
  });

  it('malformed data fails toward silence, never throws', () => {
    const content = levelUpContent(recruit, gains({ HP: 1, STR: 1 }));
    expect(levelUpLine(recruit, content, { voice: { classes: 5, temperaments: 'x' } })).toBeNull();
    expect(levelUpLine(null, content, ctx())).toBeNull();
    expect(fallenLine(recruit, { voice: { temperaments: null } })).toBeNull();
  });

  it('levelUpContent carries the quote and a varied beat caption', () => {
    const perfect = levelUpContent(
      recruit,
      gains({ HP: 1, STR: 1, MAG: 1, SKL: 1, SPD: 1, DEF: 1, RES: 1, LCK: 1 }),
      [],
      ctx(),
    );
    expect(perfect.quote).toBeTruthy();
    expect(perfect.beat.word).toBe('A PERFECT LEVEL');
    expect(perfect.beat.line).toMatch(/^BP/);
    expect(levelUpContent(recruit, gains({ HP: 1 })).quote).toBeNull();
  });

  it('voiceContext reads the run commander and seed', () => {
    const runManager = { runSeed: 42, getStartingLordNames: () => ['Kira', 'Edric'] };
    const c = voiceContext({ gameData: { dialogue: { unitVoice: {} }, classes }, runManager });
    expect(c).toMatchObject({ seed: 42, leader: 'Kira', classes, present: null });
    const withRoster = voiceContext({
      runManager: { ...runManager, roster: [{ name: 'Kira' }] },
      units: [{ name: 'Galvin' }],
    });
    expect([...withRoster.present]).toEqual(['Kira', 'Galvin']);
    expect(voiceContext({}).voice).toBeNull();
  });
});
