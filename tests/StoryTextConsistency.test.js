// The story's own facts, held across every line that states them. Ways this breaks:
//   - a lord's line describes a body the lord does not have (a horseman remembering the view
//     "from up there")
//   - the Lieutenant is "he" in one line and "they" in the next: the player cannot tell whether
//     Sera means one seer or several
//   - the Emperor dates his own throne room in two ways (a century, and the decades he says he
//     held the dark back)
//   - the capital's curfew notices read as if the curfew had been relaxed while the city emptied
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadGameData } from './testData.js';

const data = loadGameData();
const dialogue = JSON.parse(
  readFileSync(new URL('../data/dialogue.json', import.meta.url), 'utf-8'),
);

function stringsUnder(node, path = '', out = []) {
  if (typeof node === 'string') out.push({ path, text: node });
  else if (node && typeof node === 'object') {
    for (const key of Object.keys(node)) stringsUnder(node[key], `${path}/${key}`, out);
  }
  return out;
}

function spokenLines(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (typeof node.speaker === 'string' && typeof node.line === 'string') out.push(node);
  for (const key of Object.keys(node)) spokenLines(node[key], out);
  return out;
}

describe('story text agrees with itself', () => {
  it('only a flying lord speaks of the view from the sky', () => {
    const grounded = data.lords.filter((lord) => lord.moveType !== 'Flying').map((l) => l.name);
    expect(grounded).toContain('Rowan');
    const skyView = /\bfrom up (t?here)\b|\bthe sky was\b|\bmy wings?\b/i;
    const slips = [];
    for (const section of ['lordFarewell', 'commanderFall']) {
      for (const name of grounded) {
        for (const { path, text } of stringsUnder(
          dialogue[section]?.[name],
          `${section}/${name}`,
        )) {
          if (skyView.test(text)) slips.push(`${path}: ${text}`);
        }
      }
    }
    expect(slips).toEqual([]);
  });

  it('the Lieutenant is one man: no line gives him a plural sight', () => {
    const plural = /\b(their|theirs|they|they've|they're)\b[^.!?]*\b(visions?|sight|seen|see)\b/i;
    const slips = stringsUnder(dialogue)
      .filter(({ text }) => /\blieutenant\b/i.test(text) && plural.test(text))
      .map(({ path, text }) => `${path}: ${text}`);
    expect(slips).toEqual([]);
    // The line that carried the slip is still spoken, with his pronoun.
    const near = stringsUnder(dialogue.actTransitions).filter(({ text }) =>
      text.startsWith('The lieutenant is near.'),
    );
    expect(near.length).toBeGreaterThan(0);
    for (const { text } of near) expect(text).toMatch(/\b[Hh]is sight\b/);
  });

  it('the Emperor never dates his reign in centuries', () => {
    const emperor = spokenLines(dialogue).filter((entry) => entry.speaker === 'The Emperor');
    expect(emperor.length).toBeGreaterThan(0);
    expect(emperor.some((entry) => /\bdecades\b/.test(entry.line))).toBe(true);
    expect(emperor.filter((entry) => /\bcentur(y|ies)\b/i.test(entry.line))).toEqual([]);
  });

  it('the capital’s newer curfew notice is the stricter one', () => {
    const notices = dialogue.nodeFlavor.battle.act4.filter((line) => line.includes('CURFEW'));
    expect(notices).toHaveLength(1);
    const [line] = notices;
    expect(line.indexOf('DUSK')).toBeGreaterThan(-1);
    expect(line.indexOf('NOON')).toBeGreaterThan(line.indexOf('DUSK'));
    // Whatever is said of the noon notice, it is not the old one.
    expect(line.slice(line.indexOf('DUSK'))).not.toMatch(/\b(older|faded|old)\b/i);
  });
});
