import { describe, it, expect } from 'vitest';
import fs from 'fs';
import {
  RALLY_MAX_LINES,
  composeFinaleRally,
  finaleRallySpeakers,
  heraldHeard,
} from '../src/engine/FinaleRally.js';
import { TEMPERAMENT_IDS } from '../src/engine/UnitVoice.js';
import { BattleBeatsController } from '../src/ui/BattleBeatsController.js';

const dialogue = JSON.parse(fs.readFileSync('data/dialogue.json', 'utf8'));
const lordsData = JSON.parse(fs.readFileSync('data/lords.json', 'utf8'));
const LORDS = Array.isArray(lordsData) ? lordsData.map((l) => l.name) : Object.keys(lordsData);
const POOL = dialogue.finaleRally;
const VOICE = dialogue.unitVoice;

const lord = (name, extra = {}) => ({
  isLord: true,
  faction: 'player',
  name,
  currentHP: 30,
  stats: { HP: 30 },
  ...extra,
});
const recruit = (name, level, extra = {}) => ({
  isLord: false,
  faction: 'player',
  name,
  level,
  currentHP: 20,
  stats: { HP: 20 },
  ...extra,
});

describe('finale rally lines (dialogue.json finaleRally)', () => {
  const allLines = [];
  for (const [name, cats] of Object.entries(POOL.lords)) {
    for (const [cat, v] of Object.entries(cats)) {
      for (const line of Array.isArray(v) ? v : Object.values(v))
        allLines.push({ name, cat, line });
    }
  }
  for (const [temper, lines] of Object.entries(POOL.recruits)) {
    for (const line of lines) allLines.push({ name: temper, cat: 'recruit', line });
  }

  it('every lord has a full voice: opening, lines, a reply to each other lord, memory, wounds, the fallen', () => {
    expect(Object.keys(POOL.lords).sort()).toEqual([...LORDS].sort());
    for (const name of LORDS) {
      const p = POOL.lords[name];
      expect(p.open.length, `${name}.open`).toBeGreaterThanOrEqual(3);
      expect(p.lines.length, `${name}.lines`).toBeGreaterThanOrEqual(5);
      expect(Object.keys(p.reply).sort(), `${name}.reply`).toEqual(
        LORDS.filter((l) => l !== name).sort(),
      );
      for (const [to, line] of Object.entries(p.reply)) {
        expect(line.includes(to), `${name} replies to ${to} by name`).toBe(true);
      }
      for (const cat of [
        'memory',
        'wounded',
        'fallen',
        'herald',
        'glass',
        'riteBroken',
        'riteAnswered',
      ]) {
        expect(p[cat].length, `${name}.${cat}`).toBeGreaterThanOrEqual(2);
      }
    }
    expect(POOL.lords.Sera.close.length).toBeGreaterThanOrEqual(3);
    expect(Object.keys(POOL.recruits).sort()).toEqual([...TEMPERAMENT_IDS].sort());
    for (const lines of Object.values(POOL.recruits))
      expect(lines.length).toBeGreaterThanOrEqual(3);
  });

  it('keeps to the voice rules: one line, 90 chars, no double quotes, known tokens only', () => {
    for (const { name, cat, line } of allLines) {
      const where = `${name}.${cat}: ${line}`;
      expect(typeof line, where).toBe('string');
      expect(line.length, where).toBeLessThanOrEqual(90);
      expect(line.includes('"'), where).toBe(false);
      expect(line.includes('\n'), where).toBe(false);
      const tokens = line.match(/\{[a-z]+\}/g) || [];
      for (const t of tokens) expect(['{fallen}', '{leader}', '{name}'], where).toContain(t);
      expect(line.includes('{fallen}'), where).toBe(cat === 'fallen');
      if (line.includes('{leader}')) expect(cat, where).toBe('recruit');
    }
    // no line repeats anywhere in the rally
    const texts = allLines.map((l) => l.line);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('never names a lord outside a reply to that lord', () => {
    for (const { name, cat, line } of allLines) {
      if (cat === 'reply') continue;
      for (const other of LORDS) {
        if (other === name) continue;
        expect(new RegExp(`\\b${other}\\b`).test(line), `${name}.${cat} names ${other}`).toBe(
          false,
        );
      }
    }
  });
});

describe('composeFinaleRally', () => {
  it('opens with the commander, answers in field order, lets recruits in, and Sera closes', () => {
    const units = [
      lord('Sera'),
      recruit('Anna', 12),
      lord('Kira'),
      recruit('Bram', 18),
      lord('Edric'),
      recruit('Cora', 3),
      { ...lord('Voss'), faction: 'enemy' },
      lord('Cael', { currentHP: 0 }),
    ];
    const rally = composeFinaleRally({
      units,
      pool: POOL,
      voice: VOICE,
      commander: 'Edric',
      seed: 1,
    });
    expect(rally.map((r) => r.speaker)).toEqual(['Edric', 'Kira', 'Bram', 'Anna', 'Sera']);
    expect(rally[0].category).toBe('open');
    expect(POOL.lords.Edric.open).toContain(rally[0].line);
    expect(rally.at(-1).category).toBe('close');
    for (const r of rally.filter((x) => x.category === 'recruit')) {
      expect(
        Object.values(POOL.recruits)
          .flat()
          .map((l) => l.replace('{leader}', 'Edric')),
      ).toContain(r.line);
    }
  });

  it('is the same rally for the same run, and varies across runs', () => {
    const units = [lord('Edric'), lord('Kira'), lord('Rowan'), lord('Astrid'), lord('Sera')];
    const a = composeFinaleRally({ units, pool: POOL, voice: VOICE, commander: 'Edric', seed: 42 });
    const b = composeFinaleRally({ units, pool: POOL, voice: VOICE, commander: 'Edric', seed: 42 });
    expect(a.map((r) => r.line)).toEqual(b.map((r) => r.line));
    const seen = new Set();
    for (let seed = 0; seed < 40; seed++) {
      const r = composeFinaleRally({ units, pool: POOL, voice: VOICE, commander: 'Edric', seed });
      seen.add(r.map((x) => x.line).join('|'));
    }
    expect(seen.size).toBeGreaterThan(20);
  });

  it('answers the lord who just spoke, by name, often', () => {
    let replies = 0;
    for (let seed = 0; seed < 60; seed++) {
      const rally = composeFinaleRally({
        units: [lord('Kira'), lord('Voss')],
        pool: POOL,
        voice: VOICE,
        commander: 'Kira',
        seed,
      });
      if (rally[1].category === 'reply') {
        replies++;
        expect(rally[1].line).toBe(POOL.lords.Voss.reply.Kira);
      }
    }
    expect(replies).toBeGreaterThan(25);
    expect(replies).toBeLessThan(60);
  });

  it('remembers the fallen, the loop and wounds, once each', () => {
    const cats = new Set();
    for (let seed = 0; seed < 80; seed++) {
      const rally = composeFinaleRally({
        units: [
          lord('Edric'),
          lord('Voss', { currentHP: 5 }),
          lord('Rowan'),
          lord('Cael'),
          lord('Astrid'),
        ],
        pool: POOL,
        voice: VOICE,
        commander: 'Edric',
        seed,
        memory: true,
        fallen: ['Kira', 'Anna'],
      });
      const counts = {};
      for (const r of rally) {
        cats.add(r.category);
        counts[r.category] = (counts[r.category] || 0) + 1;
        expect(r.line.includes('{')).toBe(false);
        if (r.category === 'fallen') expect(r.line).toContain('Kira');
      }
      // with lords answering, the fallen and the loop are always remembered, once each
      expect(counts.fallen).toBe(1);
      expect(counts.memory).toBe(1);
    }
    for (const c of ['open', 'reply', 'wounded', 'fallen', 'memory', 'lines'])
      expect(cats).toContain(c);
  });

  it('never says the Entity is bleeding before anyone has wounded it', () => {
    for (let seed = 0; seed < 80; seed++) {
      const rally = composeFinaleRally({
        units: [lord('Edric', { currentHP: 3 }), lord('Voss'), lord('Sera'), recruit('Anna', 5)],
        pool: POOL,
        voice: VOICE,
        commander: 'Edric',
        seed,
        hurt: false,
      });
      for (const r of rally) expect(/\bbl(e|ee)d/i.test(r.line), r.line).toBe(false);
      expect(rally.length).toBe(4);
    }
  });

  it('caps the rally so it ends inside the first strain, and keeps Sera last', () => {
    const units = [
      ...['Edric', 'Kira', 'Voss', 'Rowan', 'Astrid', 'Cael', 'Sera'].map((n) => lord(n)),
      recruit('Anna', 9),
    ];
    const speakers = finaleRallySpeakers(units, { pool: POOL, commander: 'Kira' });
    expect(speakers).toHaveLength(RALLY_MAX_LINES);
    expect(speakers[0].unit.name).toBe('Kira');
    expect(speakers.at(-1).unit.name).toBe('Sera');
  });

  it('works without a commander, without Sera, and with nothing to say', () => {
    const r = composeFinaleRally({
      units: [recruit('Anna', 3), lord('Cael')],
      pool: POOL,
      voice: VOICE,
    });
    expect(r.map((x) => x.speaker)).toEqual(['Cael', 'Anna']);
    // Sera alone opens, she does not also close
    const s = composeFinaleRally({
      units: [lord('Sera')],
      pool: POOL,
      voice: VOICE,
      commander: 'Edric',
    });
    expect(s.map((x) => x.category)).toEqual(['open']);
    expect(composeFinaleRally({ units: [lord('Edric')], pool: null })).toEqual([]);
    expect(composeFinaleRally({ units: null, pool: POOL })).toEqual([]);
  });
});

describe('the Herald of the Hollow Sun in the rally (events.json hollow_herald)', () => {
  const army = () => [
    lord('Edric'),
    lord('Voss'),
    lord('Rowan'),
    lord('Cael'),
    lord('Astrid'),
    lord('Sera'),
  ];

  it('one answering lord speaks the Herald line, from their own herald pool', () => {
    for (let seed = 0; seed < 60; seed++) {
      const rally = composeFinaleRally({
        units: army(),
        pool: POOL,
        voice: VOICE,
        commander: 'Edric',
        seed,
        herald: true,
      });
      const heard = rally.filter((r) => r.category === 'herald');
      expect(heard, `seed ${seed}`).toHaveLength(1);
      expect(POOL.lords[heard[0].speaker].herald).toContain(heard[0].line);
      expect(heard[0].speaker).not.toBe('Edric'); // the commander opens
      expect(heard[0].speaker).not.toBe('Sera'); // Sera closes
    }
  });

  it('is silent without the flag, and never displaces the fallen or the loop', () => {
    const quiet = composeFinaleRally({
      units: army(),
      pool: POOL,
      voice: VOICE,
      commander: 'Edric',
      seed: 3,
    });
    expect(quiet.some((r) => r.category === 'herald')).toBe(false);
    for (let seed = 0; seed < 60; seed++) {
      const rally = composeFinaleRally({
        units: army(),
        pool: POOL,
        voice: VOICE,
        commander: 'Edric',
        seed,
        herald: true,
        memory: true,
        fallen: ['Kira'],
      });
      const counts = {};
      for (const r of rally) counts[r.category] = (counts[r.category] || 0) + 1;
      expect(counts.fallen).toBe(1);
      expect(counts.memory).toBe(1);
      expect(counts.herald).toBe(1);
    }
  });

  it('plays only for a run that listened, on Black Sun', () => {
    const heard = { heard_herald: { value: true, act: 'act2' } };
    expect(heraldHeard(heard, 'lunatic')).toBe(true);
    expect(heraldHeard(heard, 'hard')).toBe(false);
    expect(heraldHeard(heard, 'normal')).toBe(false);
    expect(heraldHeard({}, 'lunatic')).toBe(false);
    expect(heraldHeard({ heard_herald: true }, 'lunatic')).toBe(true); // a plain value from an old save
    expect(heraldHeard(undefined, 'lunatic')).toBe(false);
  });
});

describe('the Descent in the rally: the glass broken at the gate, the Rite’s tier', () => {
  // Failures: the glass or the Rite is never said (no speaker given it), said twice, said over
  // a memory the run is owed (the fallen), or the rally runs past seven lines; Spoken (the tier
  // that changes nothing) gets a line; a rally without the Descent changes at all.
  const army = () => [
    lord('Edric'),
    lord('Kira'),
    lord('Voss'),
    lord('Rowan'),
    lord('Astrid'),
    lord('Cael'),
    lord('Sera'),
    recruit('Anna', 14),
    recruit('Bram', 18),
  ];
  const rally = (units, opts) =>
    composeFinaleRally({ units, pool: POOL, voice: VOICE, commander: 'Edric', ...opts });
  const count = (r, cat) => r.filter((x) => x.category === cat).length;
  const riteLines = (band) =>
    new Set(Object.values(POOL.lords).flatMap((p) => p[band === 'broken' ? 'riteBroken' : 'riteAnswered'])); // prettier-ignore

  it('no glass and no tier: exactly the rally it was before, for every seed', () => {
    for (let seed = 0; seed < 40; seed++) {
      const before = rally(army(), { seed, memory: true, fallen: ['Lia'] });
      const after = rally(army(), { seed, memory: true, fallen: ['Lia'], glass: false, riteBand: null }); // prettier-ignore
      expect(after).toEqual(before);
      expect(rally(army(), { seed, riteBand: 'spoken' })).toEqual(rally(army(), { seed }));
    }
  });

  it('with lords answering: the glass and the tier are each said once, never instead of the fallen', () => {
    for (let seed = 0; seed < 60; seed++) {
      for (const band of ['broken', 'answered']) {
        const r = rally(army(), {
          seed,
          glass: true,
          riteBand: band,
          fallen: ['Lia'],
          memory: true,
        });
        expect(r.length).toBeLessThanOrEqual(RALLY_MAX_LINES);
        expect(count(r, 'fallen'), `seed ${seed}`).toBe(1);
        expect(count(r, 'memory'), `seed ${seed}`).toBe(1);
        expect(count(r, 'glass'), `seed ${seed}`).toBe(1);
        expect(count(r, 'rite'), `seed ${seed}`).toBe(1);
        const rite = r.find((x) => x.category === 'rite');
        expect(riteLines(band).has(rite.line)).toBe(true);
        expect(POOL.lords[rite.speaker][band === 'broken' ? 'riteBroken' : 'riteAnswered']).toContain(rite.line); // prettier-ignore
        const glass = r.find((x) => x.category === 'glass');
        expect(POOL.lords[glass.speaker].glass).toContain(glass.line);
        expect(glass.speaker).not.toBe(rite.speaker);
      }
    }
  });

  it('with no lord left to answer, Sera closes on the Rite; the glass waits for a speaker', () => {
    for (let seed = 0; seed < 30; seed++) {
      const r = rally([lord('Edric'), lord('Sera')], { seed, glass: true, riteBand: 'answered' });
      expect(r.map((x) => x.speaker)).toEqual(['Edric', 'Sera']);
      expect(r[1].category).toBe('rite');
      expect(POOL.lords.Sera.riteAnswered).toContain(r[1].line);
      expect(count(r, 'glass')).toBe(0);
    }
    // Without Sera and with nobody answering, the tier goes unsaid rather than displacing the open.
    const alone = rally([lord('Edric')], { seed: 3, glass: true, riteBand: 'broken' });
    expect(alone.map((x) => x.category)).toEqual(['open']);
  });

  it('BattleBeatsController hands the rally the run’s glass and the battle’s tier', () => {
    // Failure: the scene never passes them, so the lines are dead data.
    const rallied = [];
    const speakers = (glass, riteBand) => {
      const units = [lord('Edric'), lord('Kira'), lord('Sera')];
      const entity = { faction: 'enemy', isEntity: true, isBoss: true, currentHP: 50, stats: { HP: 100 } }; // prettier-ignore
      return { units, entity, glass, riteBand };
    };
    for (const [glass, riteBand] of [
      [true, 'answered'],
      [false, 'spoken'],
    ]) {
      const { units, entity } = speakers(glass, riteBand);
      const nodes = glass
        ? [{ id: 'g', type: 'boss', completed: true, battleParams: { bossRole: 'gate' } }]
        : [];
      const scene = {
        playerUnits: units,
        enemyUnits: [entity],
        gameData: { dialogue },
        battleParams: { bossRole: 'finale', riteBand },
        registry: { get: () => null },
        runManager: {
          runSeed: 11,
          difficultyId: 'hard',
          roster: units,
          fallenUnits: [],
          storyFlags: {},
          actSequence: ['act1', 'act2', 'act3', 'act4', 'finalBoss'],
          nodeMap: {
            descent: { v: 1, routeId: 'entity', finale: 'entity' },
            bossNodeId: 'e',
            nodes,
          },
          getStartingLordNames: () => ['Edric', 'Kira'],
        },
      };
      const beats = new BattleBeatsController(scene, () => 0);
      beats._showRallyText = () => {};
      const r = beats.entityRally({ leadMs: 0 });
      beats.destroy();
      rallied.push(r.map((x) => x.category));
    }
    expect(rallied[0]).toContain('glass');
    expect(rallied[0]).toContain('rite');
    expect(rallied[1]).not.toContain('glass');
    expect(rallied[1]).not.toContain('rite');
  });
});
