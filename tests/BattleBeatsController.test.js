import { describe, it, expect, vi, afterEach } from 'vitest';
import { BattleBeatsController } from '../src/ui/BattleBeatsController.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const HALF_HEALTH = {
  base: [
    {
      speaker: 'Iron Captain',
      portrait: 'portrait_boss_iron_captain',
      line: 'Half my guard... gone?',
    },
  ],
};

const DIALOGUE = {
  bossEncounters: {
    'Iron Captain': {
      preBattle: [
        { speaker: 'Iron Captain', portrait: 'portrait_boss_iron_captain', line: 'Halt.' },
      ],
      halfHealth: HALF_HEALTH,
    },
    'The Lieutenant': {
      preBattle: [{ speaker: 'The Lieutenant', portrait: 'p', line: 'I have seen this.' }],
      preBattleReply: {
        variants: [
          {
            when: { commander: 'Kira' },
            entries: [
              {
                speaker: 'Kira',
                portrait: 'portrait_lord_kira',
                line: 'Then you know how it ends.',
              },
            ],
          },
        ],
      },
      halfHealth: HALF_HEALTH,
    },
  },
  lordQuips: {
    onCrit: { Edric: ['Stay down!', 'For the banner!'] },
    onKill: { Edric: ['One less.'] },
  },
};

function makeScene(overrides = {}) {
  const shown = [];
  const scene = {
    isBoss: true,
    _bossName: 'Iron Captain',
    _resolveBossDialogueName: (name) => (name === 'Dark Champion' ? 'The Lieutenant' : name),
    enemyUnits: [{ isBoss: true, currentHP: 9, stats: { HP: 20 }, name: 'Iron Captain' }],
    runManager: {
      hasShownDialogue: vi.fn(() => false),
      markDialogueShown: vi.fn((key) => shown.push(key)),
      getStartingLordNames: () => ['Edric', 'Sera'],
    },
    registry: { get: vi.fn(() => null) },
    gameData: { dialogue: DIALOGUE },
    dialogueOverlay: { show: vi.fn(async () => {}) },
    _reduceMotion: vi.fn(() => false),
    time: { now: 100000 },
    grid: { gridToPixel: vi.fn(() => ({ x: 100, y: 100 })) },
    add: {
      text: vi.fn(() => makeTextObj()),
    },
    tweens: { add: vi.fn() },
    ...overrides,
  };
  return { scene, shown };
}

function makeTextObj() {
  const obj = {
    setOrigin: () => obj,
    setDepth: () => obj,
    setAlpha: () => obj,
    destroy: vi.fn(),
    scene: {},
  };
  return obj;
}

const LORD = { isLord: true, faction: 'player', name: 'Edric', currentHP: 15, col: 1, row: 1 };

describe('checkBossHalfHealth', () => {
  it('fires once when boss is strictly below half, marking before showing', async () => {
    const order = [];
    const { scene } = makeScene();
    scene.runManager.markDialogueShown = vi.fn(() => order.push('mark'));
    scene.dialogueOverlay.show = vi.fn(async () => order.push('show'));
    const beats = new BattleBeatsController(scene, () => Math.random());
    await beats.checkBossHalfHealth();
    expect(order).toEqual(['mark', 'show']);
    expect(scene.runManager.markDialogueShown).toHaveBeenCalledWith('boss_half_Iron Captain');
    expect(scene.dialogueOverlay.show).toHaveBeenCalledWith(
      'Iron Captain',
      'Half my guard... gone?',
      'portrait_boss_iron_captain',
    );
  });

  it('does not fire at exactly half HP', async () => {
    const { scene } = makeScene({
      enemyUnits: [{ isBoss: true, currentHP: 10, stats: { HP: 20 } }],
    });
    await new BattleBeatsController(scene, () => Math.random()).checkBossHalfHealth();
    expect(scene.dialogueOverlay.show).not.toHaveBeenCalled();
  });

  it('does not fire when the boss is dead or gone', async () => {
    const dead = makeScene({ enemyUnits: [{ isBoss: true, currentHP: 0, stats: { HP: 20 } }] });
    await new BattleBeatsController(dead.scene).checkBossHalfHealth();
    expect(dead.scene.dialogueOverlay.show).not.toHaveBeenCalled();

    const gone = makeScene({ enemyUnits: [] });
    await new BattleBeatsController(gone.scene).checkBossHalfHealth();
    expect(gone.scene.dialogueOverlay.show).not.toHaveBeenCalled();
  });

  it('does not fire twice (key already shown)', async () => {
    const { scene } = makeScene();
    scene.runManager.hasShownDialogue = vi.fn(() => true);
    await new BattleBeatsController(scene, () => Math.random()).checkBossHalfHealth();
    expect(scene.dialogueOverlay.show).not.toHaveBeenCalled();
    expect(scene.runManager.markDialogueShown).not.toHaveBeenCalled();
  });

  it('skips silently in tutorial/standalone battles (no runManager)', async () => {
    const { scene } = makeScene({ runManager: null });
    await expect(
      new BattleBeatsController(scene, () => Math.random()).checkBossHalfHealth(),
    ).resolves.toBeUndefined();
    expect(scene.dialogueOverlay.show).not.toHaveBeenCalled();
  });

  it('skips silently when the halfHealth section is missing', async () => {
    const { scene } = makeScene({
      gameData: { dialogue: { bossEncounters: { 'Iron Captain': { preBattle: [] } } } },
    });
    await new BattleBeatsController(scene, () => Math.random()).checkBossHalfHealth();
    expect(scene.dialogueOverlay.show).not.toHaveBeenCalled();
    expect(scene.runManager.markDialogueShown).not.toHaveBeenCalled();
  });

  it('resolves the Dark Champion alias to The Lieutenant', async () => {
    const { scene } = makeScene({
      _bossName: 'Dark Champion',
      enemyUnits: [{ isBoss: true, currentHP: 5, stats: { HP: 20 } }],
    });
    await new BattleBeatsController(scene, () => Math.random()).checkBossHalfHealth();
    expect(scene.runManager.markDialogueShown).toHaveBeenCalledWith('boss_half_The Lieutenant');
  });

  it('a throwing overlay does not propagate', async () => {
    const { scene } = makeScene();
    scene.dialogueOverlay.show = vi.fn(async () => {
      throw new Error('boom');
    });
    await expect(
      new BattleBeatsController(scene, () => Math.random()).checkBossHalfHealth(),
    ).resolves.toBeUndefined();
  });

  it('shows even in reduced-effects mode (story, not flair)', async () => {
    const { scene } = makeScene({ _reduceMotion: vi.fn(() => true) });
    await new BattleBeatsController(scene, () => Math.random()).checkBossHalfHealth();
    expect(scene.dialogueOverlay.show).toHaveBeenCalled();
  });
});

describe('lord quips', () => {
  it('crit quip fires under the 20% chance and renders above the lord', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    const { scene } = makeScene();
    const beats = new BattleBeatsController(scene, () => Math.random());
    beats.onCritStrike(LORD);
    expect(scene.add.text).toHaveBeenCalledTimes(1);
    const [x, y, line] = scene.add.text.mock.calls[0];
    expect(x).toBe(100);
    expect(y).toBe(100 - 58);
    expect(DIALOGUE.lordQuips.onCrit.Edric).toContain(line);
  });

  it('crit quip skipped when the roll misses', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const { scene } = makeScene();
    new BattleBeatsController(scene, () => Math.random()).onCritStrike(LORD);
    expect(scene.add.text).not.toHaveBeenCalled();
  });

  it('second quip within the 10s cooldown is suppressed', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    const { scene } = makeScene();
    const beats = new BattleBeatsController(scene, () => Math.random());
    beats.onCritStrike(LORD);
    scene.time.now += 5000;
    beats.onCritStrike(LORD);
    expect(scene.add.text).toHaveBeenCalledTimes(1);
    scene.time.now += 6000; // past cooldown from first quip
    beats.onCritStrike(LORD);
    expect(scene.add.text).toHaveBeenCalledTimes(2);
  });

  it('boss-kill quip is guaranteed: bypasses chance and cooldown', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const { scene } = makeScene();
    const beats = new BattleBeatsController(scene, () => Math.random());
    beats._lastQuipAt = scene.time.now; // cooldown active
    beats.onKill({ isBoss: true }, LORD);
    expect(scene.add.text).toHaveBeenCalledTimes(1);
    expect(scene.add.text.mock.calls[0][2]).toBe('One less.');
  });

  it('regular kill uses the chance roll', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const { scene } = makeScene();
    new BattleBeatsController(scene, () => Math.random()).onKill({ isBoss: false }, LORD);
    expect(scene.add.text).not.toHaveBeenCalled();
  });

  it('quips remain visible in reduced-motion mode', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.0);
    const { scene } = makeScene({ _reduceMotion: vi.fn(() => true) });
    const beats = new BattleBeatsController(scene, () => Math.random());
    beats.onCritStrike(LORD);
    beats.onKill({ isBoss: true }, LORD);
    expect(scene.add.text).toHaveBeenCalledTimes(2);
  });

  it('non-lords, enemy units, dead killers, and null killers never quip', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.0);
    const { scene } = makeScene();
    const beats = new BattleBeatsController(scene, () => Math.random());
    beats.onCritStrike({ isLord: false, faction: 'player', name: 'Bob' });
    beats.onCritStrike({ isLord: true, faction: 'enemy', name: 'Edric' });
    beats.onKill({ isBoss: true }, null);
    beats.onKill({ isBoss: true }, { ...LORD, currentHP: 0 });
    expect(scene.add.text).not.toHaveBeenCalled();
  });

  it('missing lordQuips section or unknown lord never throws', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.0);
    const { scene } = makeScene({ gameData: { dialogue: {} } });
    const beats = new BattleBeatsController(scene, () => Math.random());
    expect(() => beats.onCritStrike(LORD)).not.toThrow();
    const { scene: scene2 } = makeScene();
    expect(() =>
      new BattleBeatsController(scene2).onCritStrike({ ...LORD, name: 'Nobody' }),
    ).not.toThrow();
  });

  it('a guaranteed quip replaces any live quip instead of stacking', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.0);
    const { scene } = makeScene();
    const beats = new BattleBeatsController(scene, () => Math.random());
    beats.onCritStrike(LORD);
    const firstQuip = scene.add.text.mock.results[0].value;
    scene.time.now += 20000;
    beats.onKill({ isBoss: true }, LORD);
    expect(firstQuip.destroy).toHaveBeenCalled();
    expect(scene.add.text).toHaveBeenCalledTimes(2);
  });

  it('destroy() cleans up live quip texts', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.0);
    const { scene } = makeScene();
    const beats = new BattleBeatsController(scene, () => Math.random());
    beats.onCritStrike(LORD);
    const quip = scene.add.text.mock.results[0].value;
    beats.destroy();
    expect(quip.destroy).toHaveBeenCalled();
  });
});

describe('getBossPreBattleEntries', () => {
  it('composes preBattle + commander-matched reply in order', () => {
    const { scene } = makeScene({
      _bossName: 'The Lieutenant',
      runManager: {
        hasShownDialogue: () => false,
        markDialogueShown: () => {},
        getStartingLordNames: () => ['Kira', 'Voss'],
      },
    });
    const entries = new BattleBeatsController(scene, () => Math.random()).getBossPreBattleEntries(
      'The Lieutenant',
    );
    expect(entries.map((e) => e.line)).toEqual(['I have seen this.', 'Then you know how it ends.']);
  });

  it('reply is skipped when the commander has no variant', () => {
    const { scene } = makeScene({
      runManager: {
        hasShownDialogue: () => false,
        markDialogueShown: () => {},
        getStartingLordNames: () => ['Edric', 'Sera'],
      },
    });
    const entries = new BattleBeatsController(scene, () => Math.random()).getBossPreBattleEntries(
      'The Lieutenant',
    );
    expect(entries.map((e) => e.line)).toEqual(['I have seen this.']);
  });

  it('bosses without a preBattleReply get just their preBattle lines', () => {
    const { scene } = makeScene();
    const entries = new BattleBeatsController(scene, () => Math.random()).getBossPreBattleEntries(
      'Iron Captain',
    );
    expect(entries.map((e) => e.line)).toEqual(['Halt.']);
  });

  it('unknown boss returns an empty array', () => {
    const { scene } = makeScene();
    expect(
      new BattleBeatsController(scene, () => Math.random()).getBossPreBattleEntries('Nobody'),
    ).toEqual([]);
  });
});

it('default quip randomness does not draw from the combat stream', () => {
  const random = vi.spyOn(Math, 'random').mockReturnValue(0);
  const { scene } = makeScene();
  new BattleBeatsController(scene).onKill({ isBoss: true }, LORD);
  expect(random).not.toHaveBeenCalled();
  expect(scene.add.text).toHaveBeenCalled();
});

it.each([
  { x: 0, y: 0 },
  { x: 640, y: 0 },
  { x: 640, y: 480 },
])('keeps crit quips and their entire drift inside the viewport: %j', (point) => {
  const { scene } = makeScene({
    cameras: { main: { width: 640, height: 480 } },
    _worldToScreen: () => point,
    _pinToScreen: vi.fn(),
  });
  const text = { ...makeTextObj(), width: 200, height: 36 };
  text.setOrigin = text.setDepth = text.setAlpha = () => text;
  scene.add.text.mockReturnValue(text);
  new BattleBeatsController(scene)._showQuipText(LORD, 'For the banner!');
  expect(text.x - 100).toBeGreaterThanOrEqual(8);
  expect(text.x + 100).toBeLessThanOrEqual(632);
  expect(text.y + 18).toBeLessThanOrEqual(472);
  expect(scene.tweens.add.mock.calls[1][0].y - 18).toBeGreaterThanOrEqual(8);
  expect(scene._pinToScreen).toHaveBeenCalledWith(text);
});

// ---------------------------------------------------------------- the Entity's finale rally

describe("entityRally — the army answers the Entity's finale", () => {
  const RALLY = {
    lords: {
      Edric: { open: ['Everyone, with me.'], lines: ['Hold together.'], reply: {} },
      Kira: { lines: ['Every piece moves.'], reply: { Edric: 'Your banner, my board, Edric.' } },
      Sera: { lines: ['A thread.'], close: ['It all led here.'], reply: {} },
    },
    recruits: {},
  };
  const unit = (name, extra = {}) => ({
    isLord: true,
    faction: 'player',
    name,
    currentHP: 20,
    stats: { HP: 20 },
    col: 2,
    row: 3,
    ...extra,
  });

  function rallyScene(playerUnits) {
    return makeScene({
      playerUnits,
      enemyUnits: [{ isEntity: true, isBoss: true, currentHP: 70, stats: { HP: 80 } }],
      gameData: { dialogue: { ...DIALOGUE, finaleRally: RALLY } },
      runManager: { getStartingLordNames: () => ['Edric', 'Sera'], runSeed: 7, fallenUnits: [] },
    }).scene;
  }

  it('speaks each line over its unit, on the downbeat and every two bars', () => {
    vi.useFakeTimers();
    try {
      const scene = rallyScene([unit('Sera'), unit('Kira'), unit('Edric')]);
      const beats = new BattleBeatsController(scene, () => 0);
      const rally = beats.entityRally({ leadMs: 3000, barMs: 1765 });
      expect(rally.map((r) => r.speaker)).toEqual(['Edric', 'Kira', 'Sera']);
      expect(scene.add.text).not.toHaveBeenCalled();
      vi.advanceTimersByTime(3000);
      // each line: the line, then its speaker's name tab
      const said = () => scene.add.text.mock.calls.map((c) => c[2]);
      expect(said()).toEqual(['Everyone, with me.', 'Edric']);
      vi.advanceTimersByTime(3530);
      expect(said()).toHaveLength(4);
      expect(said()[3]).toBe('Kira');
      // Sera falls before her line: it goes unsaid
      scene.playerUnits[0].currentHP = 0;
      vi.advanceTimersByTime(3530);
      expect(said()).toHaveLength(4);
      // once per battle
      expect(beats.entityRally({ leadMs: 0 })).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('destroy() cancels lines still to come', () => {
    vi.useFakeTimers();
    try {
      const scene = rallyScene([unit('Edric'), unit('Kira')]);
      const beats = new BattleBeatsController(scene, () => 0);
      beats.entityRally({ leadMs: 0, barMs: 1000 });
      vi.advanceTimersByTime(0);
      expect(scene.add.text).toHaveBeenCalledTimes(2);
      beats.destroy();
      vi.advanceTimersByTime(10000);
      expect(scene.add.text).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays silent without rally lines', () => {
    const { scene } = makeScene({ playerUnits: [unit('Edric')] });
    expect(new BattleBeatsController(scene, () => 0).entityRally()).toEqual([]);
  });
});
