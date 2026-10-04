// The prologue's instructional density (docs/specs/prologue-chapter.md §2 "Core and
// reinforcement"; the design review of 2026-10-04): each chapter keeps a small core of
// blocking notes at their decision points, everything else is a non-blocking tip that
// only shows when its situation arises, and what the prologue no longer says is left
// to a note that teaches it at its point of use in Act 1. The slot's hints stay
// truthful: a lesson marks its in-run hint only when the player actually read it.
import { describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import { prologueBeatsFor, prologueNoteBudget } from '../src/engine/Prologue.js';
import { NOTE_HINT_IDS, PROLOGUE_NOTES, prologueNoteText } from '../src/data/prologueContent.js';
import { TUTORIAL_HINT_IDS } from '../src/ui/prologueLessons.js';
import { readFileSync } from 'fs';

const data = loadGameData();
const chapter = (id) => data.prologue.chapters.find((c) => c.id === id);
const P1 = chapter('p1_banner_at_dawn');
const P2 = chapter('p2_old_hands');
const P3 = chapter('p3_seer_on_the_road');
const P4 = chapter('p4_quarry_gate');

/** The note and tip actions one event raises (the event as the controller raises it). */
function says(ch, event, state = {}, oneNote = false) {
  const { actions } = prologueBeatsFor(ch, event, state, { oneNote });
  return actions.filter((a) => 'note' in a || 'tip' in a).map(({ beat: _b, ...a }) => a);
}

describe('each chapter keeps a small core of blocking notes', () => {
  // Before the density pass (2026-10-04): P1 7 modal notes (plus the enemy-phase nudge),
  // P2 8, P3 10 (9 beats; the threat count twice), P4 4 with the deploy note.
  it('the blocking notes are exactly the core, at most three a chapter', () => {
    expect(prologueNoteBudget(P1).blocking).toEqual(['battle_forecast', 'p1_wait_or_end_turn']);
    expect(prologueNoteBudget(P2).blocking).toEqual(['p2_veteran_kills', 'battle_doubling']);
    expect(prologueNoteBudget(P3).blocking).toEqual(['p3_recruit', 'p3_heal', 'p3_range']);
    expect(prologueNoteBudget(P4).blocking).toEqual(['p4_deploy', 'p4_seize_par']);
    for (const ch of data.prologue.chapters)
      expect(prologueNoteBudget(ch).blocking.length, ch.id).toBeLessThanOrEqual(3);
  });

  it('the reinforcement is non-blocking tips', () => {
    expect(prologueNoteBudget(P1).tips).toEqual([
      'p1_holding_enemy',
      'battle_terrain',
      'p1_enemy_phase',
      'p1_level_up',
      'battle_triangle',
      'battle_consumable_supply',
    ]);
    expect(prologueNoteBudget(P2).tips).toEqual([
      'p2_lances_beat_swords',
      'battle_danger_zone',
      'p2_village_visit',
    ]);
    expect(prologueNoteBudget(P3).tips).toEqual([
      'p3_fragile',
      'p3_fragile',
      'p3_plan_cancel',
      'p3_aura',
      'p3_rewind',
      'p3_better_plan',
    ]);
    expect(prologueNoteBudget(P4).tips).toEqual(['p4_throne', 'p4_seize_now']);
  });

  it('cut lessons are gone from every chapter, and their copy with them', () => {
    const named = data.prologue.chapters.flatMap((ch) => {
      const b = prologueNoteBudget(ch);
      return [...b.blocking, ...b.tips];
    });
    for (const id of ['p2_forecast_chances', 'battle_no_counter', 'p3_magic', 'battle_loot']) {
      expect(named, id).not.toContain(id);
      expect(PROLOGUE_NOTES[id], id).toBeUndefined();
    }
    // Every note copy is named by a beat or the deploy screen: nothing orphaned.
    for (const id of Object.keys(PROLOGUE_NOTES)) expect(named, id).toContain(id);
  });
});

describe('the core notes still fire at their decision points', () => {
  it('P1: reading the first forecast (with its confirm gate), and the turn passing to the enemy', () => {
    const { actions } = prologueBeatsFor(P1, { type: 'forecastOpened', unit: 'Edric', target: 'a', nth: 1, concepts: ['triangle'] }, {}, { oneNote: true }); // prettier-ignore
    expect(actions.map(({ beat: _b, ...a }) => a)).toEqual(
      expect.arrayContaining([{ note: 'battle_forecast' }, { gateConfirm: true }]),
    );
    expect(says(P1, { type: 'unitActed', unit: 'Edric', turn: 1 })).toEqual([
      { note: 'p1_wait_or_end_turn' },
    ]);
    expect(says(P1, { type: 'unitActed', unit: 'Edric', turn: 2 })).toEqual([]);
  });

  it('P2: the veteran when Gaspar is first selected, weapon choice on his forecast at the Archer', () => {
    expect(says(P2, { type: 'unitSelected', unit: 'Gaspar', turn: 1 })).toEqual([
      { note: 'p2_veteran_kills' },
    ]);
    expect(says(P2, { type: 'forecastOpened', unit: 'Gaspar', target: 'a', nth: 1, concepts: ['noCounter', 'uncertainHit'] }, {}, true)).toEqual([{ note: 'battle_doubling' }]); // prettier-ignore
  });

  it('P3: the recruit at the start, the heal when Sera is selected with someone hurt, range at 2 tiles', () => {
    expect(says(P3, { type: 'battleStart' })).toEqual([{ note: 'p3_recruit' }]);
    expect(says(P3, { type: 'unitSelected', unit: 'Sera', hurt: false })).toEqual([]);
    expect(says(P3, { type: 'unitSelected', unit: 'Sera', hurt: true })).toEqual([
      { note: 'p3_heal' },
    ]);
    expect(says(P3, { type: 'afterMove', unit: 'Sera', dangerFrom: [], inRange: true, foeDistances: [2], besideAlly: false }, {}, true)).toEqual([{ note: 'p3_range' }]); // prettier-ignore
  });

  it('P4: the seize and par at the start (after the deploy screen note)', () => {
    expect(P4.deploy.note).toBe('p4_deploy');
    expect(says(P4, { type: 'battleStart' })).toEqual([{ note: 'p4_seize_par' }]);
  });
});

describe('demoted lessons are conditional, and leave their hint to Act 1 until read', () => {
  it('a tip fires only in its situation', () => {
    // The village only when a unit stands on it; the throne only on Varro's throne.
    expect(says(P2, { type: 'afterMove', unit: 'Edric', terrain: 'Plain', dangerFrom: [] })).toEqual([]); // prettier-ignore
    expect(says(P2, { type: 'afterMove', unit: 'Edric', terrain: 'Village', dangerFrom: [] })).toEqual([{ tip: 'p2_village_visit' }]); // prettier-ignore
    expect(says(P4, { type: 'forecastOpened', unit: 'Edric', target: 'v', targetTerrain: 'Plain' }, {}, true)).toEqual([]); // prettier-ignore
    expect(says(P4, { type: 'forecastOpened', unit: 'Edric', target: 'v', targetTerrain: 'Throne' }, {}, true)).toEqual([{ tip: 'p4_throne' }]); // prettier-ignore
    // The rewind exercise only with someone hurt on turn 2.
    expect(says(P3, { type: 'turnStart', phase: 'player', turn: 2, hurt: false })).toEqual([]);
  });

  it('every in-run hint a tip stands in for is one a new slot may inherit, and has an Act 1 teacher', () => {
    const tipHints = new Set(
      data.prologue.chapters.flatMap((ch) =>
        prologueNoteBudget(ch).tips.flatMap((id) => NOTE_HINT_IDS[id] || []),
      ),
    );
    expect([...tipHints].sort()).toEqual([
      'battle_consumable_supply',
      'battle_danger_zone',
      'battle_terrain',
      'battle_triangle',
      'battle_village',
      'guide_fragile_in_reach',
      'guide_no_attack',
      'guide_objective_changed',
    ]);
    for (const id of tipHints) expect(TUTORIAL_HINT_IDS.has(id), id).toBe(true);
    // Each is taught again in a real run where it matters, if the tip was never read
    // (the coach's Fort step already says what cover does, so terrain has no Act 1 copy).
    const src = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
    const teachers = {
      battle_consumable_supply: 'ui/MobileBattleHUD.js',
      battle_danger_zone: 'scenes/BattleScene.js',
      battle_triangle: 'ui/forecastDisplay.js',
      battle_village: 'ui/VillageController.js',
      guide_fragile_in_reach: 'ui/GuidanceController.js',
      guide_no_attack: 'ui/GuidanceController.js',
      guide_objective_changed: 'ui/GuidanceController.js',
    };
    for (const [id, path] of Object.entries(teachers)) expect(src(path), id).toContain(`'${id}'`);
  });

  it("what the prologue no longer says is taught at its point of use: the forecast's no-counter line, the loot screen", () => {
    const src = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
    expect(src('ui/forecastDisplay.js')).toContain("id: 'battle_no_counter'");
    expect(src('ui/LootScreenController.js')).toContain("shouldShow('battle_loot')");
    expect(NOTE_HINT_IDS.battle_loot).toBeUndefined();
    // P3's range note still teaches the no-counter rule where it is the lesson.
    expect(NOTE_HINT_IDS.p3_range).toEqual(['battle_no_counter']);
  });

  it('a forecast tip is one short line; a map tip reads as one paragraph', () => {
    const forecastTips = ['battle_triangle', 'p2_lances_beat_swords', 'p4_throne'];
    for (const id of forecastTips) {
      const text = prologueNoteText(id, { boss: 'Captain Varro' });
      expect(text, id).not.toMatch(/\n/);
      expect(text.length, `${id}: ${text}`).toBeLessThanOrEqual(90);
    }
  });
});
