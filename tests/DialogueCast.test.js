import { describe, it, expect } from 'vitest';
import {
  resolveDialogueCast,
  adaptDialogueLine,
  adaptDialogueEntries,
} from '../src/engine/DialogueCast.js';
import { readFileSync } from 'fs';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const dialogue = JSON.parse(
  readFileSync(new URL('../data/dialogue.json', import.meta.url), 'utf-8'),
);

const entry = (speaker, line, portrait = `portrait_lord_${speaker?.toLowerCase()}`) => ({
  speaker,
  portrait,
  line,
});

describe('resolveDialogueCast', () => {
  it('default pair: Edric is the hero, Sera the seer', () => {
    expect(resolveDialogueCast(['Edric', 'Sera'])).toEqual({
      commander: 'Edric',
      partner: 'Sera',
      hero: 'Edric',
      seer: 'Sera',
    });
    // Invalid inputs fall back to the default pair
    expect(resolveDialogueCast(null).hero).toBe('Edric');
    expect(resolveDialogueCast(['Cael', 'Cael']).hero).toBe('Edric');
  });

  it('absent script voices move to the stand-ins from the pair', () => {
    expect(resolveDialogueCast(['Cael', 'Kira'])).toMatchObject({ hero: 'Cael', seer: 'Kira' });
    expect(resolveDialogueCast(['Cael', 'Sera'])).toMatchObject({ hero: 'Cael', seer: 'Sera' });
  });

  it('present script voices always keep their own lines', () => {
    // Edric as partner still speaks Edric's lines; the seer is the other member
    expect(resolveDialogueCast(['Cael', 'Edric'])).toMatchObject({ hero: 'Edric', seer: 'Cael' });
    // Sera commanding: she stays the seer, the partner becomes the hero
    expect(resolveDialogueCast(['Sera', 'Kira'])).toMatchObject({ hero: 'Kira', seer: 'Sera' });
  });
});

describe('adaptDialogueLine', () => {
  it('resolves {commander} to the hero voice', () => {
    const cast = resolveDialogueCast(['Sera', 'Kira']);
    expect(adaptDialogueLine('Stay close, {commander}.', cast)).toBe('Stay close, Kira.');
  });

  it('passes through non-strings and token-free lines', () => {
    const cast = resolveDialogueCast(null);
    expect(adaptDialogueLine('No token here.', cast)).toBe('No token here.');
    expect(adaptDialogueLine(null, cast)).toBe(null);
  });
});

describe('adaptDialogueEntries', () => {
  it('default pair passes entries through by reference', () => {
    const entries = [entry('Sera', 'Stay close, {commander}.'), entry('Edric', 'Onward.')];
    const adapted = adaptDialogueEntries(entries, ['Edric', 'Sera']);
    expect(adapted[1]).toBe(entries[1]); // untouched entry keeps its reference
    expect(adapted[0].line).toBe('Stay close, Edric.');
    expect(adapted[0].speaker).toBe('Sera');
    expect(adapted[0].portrait).toBe('portrait_lord_sera');
  });

  it('recasts both voices with matching portraits for a custom pair', () => {
    const entries = [entry('Sera', 'I can feel it.'), entry('Edric', 'Then we go, {commander}.')];
    const adapted = adaptDialogueEntries(entries, ['Cael', 'Kira']);
    expect(adapted[0]).toMatchObject({ speaker: 'Kira', portrait: 'portrait_lord_kira' });
    expect(adapted[1]).toMatchObject({
      speaker: 'Cael',
      portrait: 'portrait_lord_cael',
      line: 'Then we go, Cael.',
    });
  });

  it('a Sera commander never addresses herself via the token', () => {
    const entries = [entry('Sera', 'Stay close, {commander}.')];
    const adapted = adaptDialogueEntries(entries, ['Sera', 'Astrid']);
    expect(adapted[0].speaker).toBe('Sera');
    expect(adapted[0].line).toBe('Stay close, Astrid.');
  });

  it('tolerates malformed input', () => {
    expect(adaptDialogueEntries(null, ['Cael', 'Kira'])).toBe(null);
    const adapted = adaptDialogueEntries([null, 'junk', entry('Boss', 'Rawr')], ['Cael', 'Kira']);
    expect(adapted[0]).toBe(null);
    expect(adapted[1]).toBe('junk');
    expect(adapted[2].speaker).toBe('Boss'); // non-lord speakers untouched
  });
});

describe('dialogue.json content', () => {
  it('Edric has farewell lines for when he falls as a non-commander', () => {
    const pool = dialogue.lordFarewell?.Edric;
    expect(Array.isArray(pool)).toBe(true);
    expect(pool.length).toBeGreaterThanOrEqual(3);
  });

  it('every lord has both a recruit line and a farewell pool', () => {
    const lords = gameData.lords.map((l) => l.name);
    for (const name of lords) {
      expect(dialogue.lordRecruitLines[name]?.length).toBeGreaterThan(0);
      expect(dialogue.lordFarewell[name]?.length).toBeGreaterThan(0);
    }
  });

  it('story lines no longer hardcode Edric outside speaker fields', () => {
    const scanLines = (entries) => {
      for (const e of entries) expect(e.line).not.toMatch(/Edric/);
    };
    // Sections may be a plain entry array or { base, variants } (see
    // NarrativeDirector). Scan every pool either way.
    const scanSection = (value) => {
      if (Array.isArray(value)) {
        scanLines(value);
        return;
      }
      if (Array.isArray(value?.base)) scanLines(value.base);
      for (const variant of value?.variants || []) {
        if (Array.isArray(variant?.entries)) scanLines(variant.entries);
      }
    };
    for (const value of Object.values(dialogue.actTransitions)) scanSection(value);
    for (const value of Object.values(dialogue.runComplete)) scanSection(value);
    for (const pool of Object.values(dialogue.lordFarewell)) {
      for (const line of pool) expect(line).not.toMatch(/Edric/);
    }
  });
});
