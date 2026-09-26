import { describe, it, expect } from 'vitest';
import fs from 'fs';
import {
  RALLY_MAX_LINES,
  composeFinaleRally,
  finaleRallySpeakers,
} from '../src/engine/FinaleRally.js';
import { TEMPERAMENT_IDS } from '../src/engine/UnitVoice.js';

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
      for (const cat of ['memory', 'wounded', 'fallen']) {
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
