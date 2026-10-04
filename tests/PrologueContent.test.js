// The prologue's copy: every beat names copy that exists, spoken lines follow the voice
// sheet (docs/lore-style-guide.md), and touch/desktop read their own verbs.
import { describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import {
  NOTE_HINT_IDS,
  PROLOGUE_COACH,
  PROLOGUE_NOTES,
  prologueHandoff,
  prologueNoteText,
  prologueNudgeText,
} from '../src/data/prologueContent.js';

import { readFileSync } from 'fs';

const data = {
  ...loadGameData(),
  dialogue: JSON.parse(readFileSync(new URL('../data/dialogue.json', import.meta.url), 'utf8')),
};
const chapters = data.prologue.chapters;
const actionsOf = (chapter) => chapter.beats.flatMap((beat) => beat.do);

describe('prologue copy', () => {
  it('every coach, note and dialogue id a beat names has copy', () => {
    for (const chapter of chapters) {
      for (const action of actionsOf(chapter)) {
        if ('coach' in action)
          expect(PROLOGUE_COACH[action.coach], action.coach).toBeTypeOf('function');
        if ('note' in action)
          expect(PROLOGUE_NOTES[action.note], action.note).toBeTypeOf('function');
        if ('dialogue' in action)
          expect(data.dialogue.prologue[action.dialogue], action.dialogue).toBeInstanceOf(Array);
      }
    }
    // The chapter's restart line exists even though no beat names it.
    expect(data.dialogue.prologue.not_this_thread.length).toBeGreaterThan(0);
  });

  it('spoken lines keep to the voice sheet: one line, 90 characters, no double quotes', () => {
    for (const [key, entries] of Object.entries(data.dialogue.prologue)) {
      expect(entries.length, key).toBeGreaterThan(0);
      for (const { speaker, line } of entries) {
        expect(typeof speaker, key).toBe('string');
        expect(line.length, `${key}: ${line}`).toBeLessThanOrEqual(90);
        expect(line, key).not.toMatch(/["\n]/);
      }
    }
    // Sera's voice stays unnamed on a restart; Gaspar rides in at P1's end.
    expect(data.dialogue.prologue.not_this_thread.every((e) => e.speaker === '???')).toBe(true);
    expect(data.dialogue.prologue.p1_gaspar_arrives.map((e) => e.speaker)).toEqual([
      'Edric',
      'Gaspar',
    ]);
  });

  it('phrases taps on touch and clicks on desktop', () => {
    expect(PROLOGUE_COACH.p1_select_edric({ touch: true }).detail).toContain('Tap Edric');
    expect(PROLOGUE_COACH.p1_select_edric({ touch: false }).detail).toContain('Click Edric');
    expect(prologueNoteText('battle_terrain', { touch: true })).toContain('tile you tap');
    expect(prologueNoteText('battle_terrain', { touch: false })).toContain('tile you point at');
    expect(prologueNoteText('p1_wait_or_end_turn', { touch: false })).toContain('Danger [D]');
    expect(prologueNoteText('p1_wait_or_end_turn', { touch: true })).not.toContain('[D]');
  });

  it('notes read real numbers, never a hardcoded example', () => {
    const fort = prologueNoteText('battle_terrain', {
      terrain: { name: 'Fort', defBonus: 2, avoidBonus: 20 },
    });
    expect(fort).toContain('Fort tile reached — Defense +2, Avoid +20.');
    const vulnerary = data.consumables.find((c) => c.name === 'Vulnerary');
    expect(prologueNoteText('battle_consumable_supply', { consumable: vulnerary })).toContain(
      `Vulnerary heals ${vulnerary.value} HP`,
    );
    expect(prologueNoteText('nope')).toBe('');
    expect(prologueNudgeText('gate_select', { lord: 'Kira' })).toBe('Select Kira first.');
  });

  it("P4's deploy note: who fights, the axes, the reach, and Gaspar's lesson as it was meant", () => {
    const run = prologueNoteText('p4_deploy', { slots: 3, boss: 'Captain Varro', equip: true });
    const lines = run.split('\n');
    expect(lines).toEqual([
      'Your commander always deploys. Choose who fights: 3 slots.',
      'Captain Varro and his men carry axes, and swords beat axes: Roster equips before you deploy.',
      "Captain Varro's axe reaches 1 tile: who can hit from 2?",
      'Gaspar still fights well: let him weaken foes, and let the others finish them.',
    ]);
    // P2's veteran note was about kills, never about leaving him out: the deploy note
    // says he fights, and repeats the kill rule rather than a new one.
    expect(prologueNoteText('p2_veteran_kills')).toContain('Weaken enemies with Gaspar');
    // A replay's deploy screen has no Roster button: no equip clause.
    expect(prologueNoteText('p4_deploy', { boss: 'Captain Varro' })).toContain(
      'carry axes, and swords beat axes.\n',
    );
    expect(prologueNoteText('p4_deploy', { veteran: 'Brann' })).toContain(
      'Brann still fights well',
    );
  });

  it('the handoff names the chapter and the fresh player route', () => {
    expect(prologueHandoff({ title: 'Banner at Dawn', startRun: true })).toContain(
      'Banner at Dawn is yours.\nYour first run starts',
    );
    expect(prologueHandoff({ title: 'Banner at Dawn' })).toContain('waiting on the title');
  });

  it('a note that stands in for an in-run hint only does so for a hint it teaches', () => {
    expect(NOTE_HINT_IDS.p1_wait_or_end_turn).toEqual(['battle_danger_zone']);
    expect(prologueNoteText('p1_wait_or_end_turn', {})).toMatch(/Danger/);
    expect(NOTE_HINT_IDS.p1_level_up).toBeUndefined();
  });
});
