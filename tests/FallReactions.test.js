// Deaths on the field are answered (playtest 2026-09-28: nobody reacted to an ally's
// death, and the commander's fall ended the run in silence), and the roads that
// never fight the Lieutenant meet him once, as a vision, in an Act III boss battle.
import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { BattleBeatsController } from '../src/ui/BattleBeatsController.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { evaluateWhen } from '../src/engine/NarrativeDirector.js';

const lord = (name, col, row, extra = {}) => ({
  name,
  faction: 'player',
  isLord: true,
  currentHP: 20,
  col,
  row,
  ...extra,
});

function beatsScene({ playerUnits, dialogue = {}, tutorial = false } = {}) {
  const shown = [];
  const scene = {
    _battleSession: 1,
    playerUnits,
    battleParams: tutorial ? { prologueChapter: 'p1_banner_at_dawn' } : {},
    gameData: { dialogue },
    time: { now: 0 },
    runManager: { pickNarrativeLine: (pool) => pool[0] },
  };
  const beats = new BattleBeatsController(scene, () => 0);
  beats._showQuipText = (speaker, line) => shown.push([speaker.name, line]);
  return { beats, shown };
}
const ALLY_FALL = {
  lordQuips: {
    onAllyFall: {
      Edric: ['Not {fallen}. Not like this.'],
      Kira: ['I had a better move for {fallen}.'],
      Voss: ['Another name for the ledger.'],
    },
  },
};

describe('an ally falls', () => {
  it('the commander answers when it stands, naming the fallen', () => {
    const fallen = { name: 'Galvin', faction: 'player', col: 9, row: 9, currentHP: 0 };
    const { beats, shown } = beatsScene({
      playerUnits: [lord('Kira', 9, 8), lord('Edric', 0, 0, { isCommander: true })],
      dialogue: ALLY_FALL,
    });
    expect(beats.onAllyFall(fallen)).toEqual({
      speaker: 'Edric',
      line: 'Not Galvin. Not like this.',
    });
    expect(shown).toEqual([['Edric', 'Not Galvin. Not like this.']]);
  });

  it('otherwise the nearest living lord; ties go by name', () => {
    const fallen = { name: 'Galvin', faction: 'player', col: 5, row: 5, currentHP: 0 };
    const { beats } = beatsScene({
      playerUnits: [lord('Voss', 5, 7), lord('Kira', 5, 6), lord('Edric', 9, 9, { currentHP: 0 })],
      dialogue: ALLY_FALL,
    });
    expect(beats.onAllyFall(fallen)?.speaker).toBe('Kira');
    const tie = beatsScene({
      playerUnits: [lord('Voss', 5, 6), lord('Kira', 6, 5)],
      dialogue: ALLY_FALL,
    });
    expect(tie.beats.onAllyFall(fallen)?.speaker).toBe('Kira');
  });

  it('silent for the commander’s own fall, in the tutorial, or with no lord left', () => {
    const fallen = { name: 'Edric', faction: 'player', isCommander: true, col: 0, row: 0 };
    const { beats } = beatsScene({ playerUnits: [lord('Kira', 1, 0)], dialogue: ALLY_FALL });
    expect(beats.onAllyFall(fallen)).toBeNull();
    const tut = beatsScene({
      playerUnits: [lord('Kira', 1, 0)],
      dialogue: ALLY_FALL,
      tutorial: true,
    });
    expect(tut.beats.onAllyFall({ name: 'Bob', faction: 'player', col: 0, row: 0 })).toBeNull();
    const none = beatsScene({ playerUnits: [], dialogue: ALLY_FALL });
    expect(none.beats.onAllyFall({ name: 'Bob', faction: 'player', col: 0, row: 0 })).toBeNull();
  });
});

describe('the commander falls', () => {
  it('speaks its last words before the run ends', async () => {
    const unit = lord('Edric', 0, 0, { isCommander: true, currentHP: 0, className: 'Lord' });
    const scene = {
      _battleSession: 1,
      registry: { get: () => null },
      removeUnitGraphic: vi.fn(),
      playerUnits: [unit],
      enemyUnits: [],
      npcUnits: [],
      battleParams: {},
      battleConfig: { objective: 'rout' },
      gameData: {
        dialogue: { commanderFall: { Edric: ['Count them for me. All of them.'] } },
        lords: [{ name: 'Edric' }],
        classes: [],
        affixes: { affixes: [] },
      },
      runManager: { pickNarrativeLine: (pool) => pool[0] },
      dialogueOverlay: { show: vi.fn(async () => {}) },
      _getPortraitKey: vi.fn(() => 'portrait_lord_edric'),
      updateObjectiveText: vi.fn(),
      grid: { gridToPixel: () => ({ x: 0, y: 0 }) },
      tweens: { add: vi.fn() },
    };
    await BattleScene.prototype.removeUnit.call(scene, unit);
    expect(scene.dialogueOverlay.show).toHaveBeenCalledWith(
      'Edric',
      'Count them for me. All of them.',
      'portrait_lord_edric',
    );
  });
});

describe('the Lieutenant’s vision', () => {
  const VISION = {
    bossEncounters: {
      'The Lieutenant': {
        vision: { base: [{ speaker: 'The Lieutenant', portrait: 'p', line: 'Hello, Sera.' }] },
      },
    },
  };
  const scene = (act, actSequence, difficultyId = 'hard') => ({
    isBoss: true,
    battleParams: { act },
    gameData: {
      dialogue: VISION,
      enemies: {
        bosses: {
          finalBoss: [
            { name: 'The Lieutenant', difficultyFilter: ['normal', 'dusk'] },
            { name: 'The Entity', isEntity: true, difficultyFilter: ['hard', 'lunatic'] },
          ],
        },
      },
    },
    runManager: { actSequence, difficultyId },
    registry: { get: () => null },
  });
  const beats = (s) => new BattleBeatsController(s, () => 0);

  it('plays in an Act III boss battle on roads that never meet him', () => {
    expect(
      beats(scene('act3', ['act1', 'act2', 'act3', 'act4'], 'dusk')).getLieutenantVisionEntries(),
    ).toHaveLength(1);
    expect(
      beats(
        scene('act3', ['act1', 'act2', 'act3', 'act4', 'finalBoss']),
      ).getLieutenantVisionEntries(),
    ).toHaveLength(1);
  });

  it('never on First Light (it ends at him), outside Act III, or in a non-boss battle', () => {
    expect(
      beats(
        scene('act3', ['act1', 'act2', 'act3', 'finalBoss'], 'normal'),
      ).getLieutenantVisionEntries(),
    ).toEqual([]);
    expect(
      beats(scene('act2', ['act1', 'act2', 'act3', 'act4'], 'dusk')).getLieutenantVisionEntries(),
    ).toEqual([]);
    const plain = scene('act3', ['act1', 'act2', 'act3', 'act4'], 'dusk');
    plain.isBoss = false;
    expect(beats(plain).getLieutenantVisionEntries()).toEqual([]);
  });
});

it('maxRunsStarted: the first run only (runs are counted as they start)', () => {
  expect(evaluateWhen({ maxRunsStarted: 1 }, { runsStarted: 1 })).toBe(true);
  expect(evaluateWhen({ maxRunsStarted: 1 }, { runsStarted: 2 })).toBe(false);
});

describe('Wave D lines in the real dialogue', async () => {
  const { readFileSync } = await import('node:fs');
  const { selectDialogueEntries } = await import('../src/engine/NarrativeDirector.js');
  const d = JSON.parse(readFileSync(new URL('../data/dialogue.json', import.meta.url), 'utf8'));
  const LORDS = ['Edric', 'Kira', 'Voss', 'Sera', 'Rowan', 'Astrid', 'Cael'];

  it('every lord reacts to a fall and has last words as commander, within 90 chars', () => {
    for (const lord of LORDS) {
      for (const pool of [d.lordQuips.onAllyFall[lord], d.commanderFall[lord]]) {
        expect(pool.length, lord).toBeGreaterThanOrEqual(3);
        for (const line of pool) {
          expect(line.length, line).toBeLessThanOrEqual(90);
          expect(line).not.toContain('"');
        }
      }
      expect(d.lordRecruitLines[lord].length).toBeGreaterThanOrEqual(3);
    }
  });

  it('the first run opens on Sera’s cold open; later runs keep their own lines', () => {
    const first = selectDialogueEntries(d.actTransitions.runStart, {
      runsStarted: 1,
      lastRunResult: 'none',
    });
    expect(first.length).toBeGreaterThanOrEqual(3);
    expect(first.every((e) => e.speaker === 'Sera')).toBe(true);
    const later = selectDialogueEntries(d.actTransitions.runStart, {
      runsStarted: 2,
      lastRunResult: 'none',
    });
    expect(later).toEqual(d.actTransitions.runStart.base);
  });

  it('a boss that killed you before says so at half health; the Lieutenant has a vision', () => {
    const half = selectDialogueEntries(d.bossEncounters['Iron Captain'].halfHealth, {
      bossKilledYouCount: 1,
      bossSlainCount: 0,
    });
    expect(half[0].line).not.toBe(d.bossEncounters['Iron Captain'].halfHealth.base[0].line);
    expect(d.bossEncounters['The Lieutenant'].vision.base.length).toBeGreaterThanOrEqual(3);
  });

  it('the Emperor and Entity endings end on the commander’s own reply', () => {
    for (const key of ['victory_emperor', 'victory_entity']) {
      const entries = selectDialogueEntries(d.runComplete[key], { commander: 'Cael' });
      expect(entries.at(-1).speaker).toBe('Cael');
      expect(selectDialogueEntries(d.runComplete[key], { commander: 'Nobody' })).toEqual(
        d.runComplete[key].base,
      );
    }
  });
});
