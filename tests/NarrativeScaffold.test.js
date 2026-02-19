import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import { RunManager, getActTransitionKey } from '../src/engine/RunManager.js';
import { loadGameData } from './testData.js';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: {
      Clamp: (v, min, max) => Math.min(max, Math.max(min, v)),
    },
  },
}));

const { BattleScene } = await import('../src/scenes/BattleScene.js');
const { NodeMapScene } = await import('../src/scenes/NodeMapScene.js');
const { RunCompleteScene } = await import('../src/scenes/RunCompleteScene.js');
const { DialogueOverlay } = await import('../src/ui/DialogueOverlay.js');
const gameData = loadGameData();

afterEach(() => {
  vi.useRealTimers();
});

describe('Narrative scaffold helpers', () => {
  it('resolves act-transition keys', () => {
    expect(getActTransitionKey('act1', 'act2')).toBe('act1_to_act2');
    expect(getActTransitionKey('act2', 'act3')).toBe('act2_to_act3');
    expect(getActTransitionKey('act3', 'finalBoss')).toBe('act3_to_finalBoss_normal');
    expect(getActTransitionKey('act3', 'act4')).toBe('act3_to_act4');
    expect(getActTransitionKey('act4', 'finalBoss')).toBe('act4_to_finalBoss');
  });

  it('tracks shownDialogueKeys with round-trip persistence', () => {
    const rm = new RunManager(gameData);
    expect(rm.shownDialogueKeys).toEqual([]);
    rm.markDialogueShown('runStart');
    rm.markDialogueShown('runStart');
    expect(rm.hasShownDialogue('runStart')).toBe(true);
    expect(rm.shownDialogueKeys).toEqual(['runStart']);

    const restored = RunManager.fromJSON(rm.toJSON(), gameData);
    expect(restored.shownDialogueKeys).toEqual(['runStart']);
  });

  it('seeds runStart as already shown for legacy in-progress saves', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    rm.completedBattles = 1;
    const json = rm.toJSON();
    delete json.shownDialogueKeys;

    const restored = RunManager.fromJSON(json, gameData);
    expect(restored.hasShownDialogue('runStart')).toBe(true);
  });
});

describe('Narrative data', () => {
  it('keeps data/public dialogue in sync and structurally valid', () => {
    const dialogueRaw = fs.readFileSync('data/dialogue.json', 'utf8');
    const publicDialogueRaw = fs.readFileSync('public/data/dialogue.json', 'utf8');
    expect(publicDialogueRaw).toBe(dialogueRaw);

    const dialogue = JSON.parse(dialogueRaw);
    expect(dialogue.recruitLines).toBeTypeOf('object');
    for (const lines of Object.values(dialogue.recruitLines || {})) {
      expect(Array.isArray(lines)).toBe(true);
      for (const line of lines) expect(typeof line).toBe('string');
    }

    for (const entries of Object.values(dialogue.actTransitions || {})) {
      expect(Array.isArray(entries)).toBe(true);
      for (const entry of entries) {
        expect(entry).toBeTypeOf('object');
        expect(entry.line).toBeTypeOf('string');
        expect(entry.speaker === null || typeof entry.speaker === 'string').toBe(true);
      }
    }

    for (const boss of Object.values(dialogue.bossEncounters || {})) {
      expect(Array.isArray(boss.preBattle)).toBe(true);
      expect(Array.isArray(boss.defeat)).toBe(true);
    }

    expect(Array.isArray(dialogue.runComplete?.victory_normal)).toBe(true);
    expect(Array.isArray(dialogue.runComplete?.victory_hard)).toBe(true);
    expect(Array.isArray(dialogue.runComplete?.victory_lunatic)).toBe(true);
    expect(Array.isArray(dialogue.runComplete?.defeat)).toBe(true);
  });

  it('keeps data/public enemies in sync and uses The Lieutenant final boss', () => {
    const enemiesRaw = fs.readFileSync('data/enemies.json', 'utf8');
    const publicEnemiesRaw = fs.readFileSync('public/data/enemies.json', 'utf8');
    expect(publicEnemiesRaw).toBe(enemiesRaw);

    const enemies = JSON.parse(enemiesRaw);
    const names = (enemies?.bosses?.finalBoss || []).map((b) => b?.name);
    expect(names).toContain('The Lieutenant');
  });

  it('has boss encounter dialogue entries for all configured bosses', () => {
    const dialogue = JSON.parse(fs.readFileSync('data/dialogue.json', 'utf8'));
    const enemies = JSON.parse(fs.readFileSync('data/enemies.json', 'utf8'));
    const bossNames = [];
    for (const list of Object.values(enemies?.bosses || {})) {
      for (const boss of list || []) {
        if (boss?.name) bossNames.push(boss.name);
      }
    }
    for (const name of bossNames) {
      const resolved = name === 'Dark Champion' ? 'The Lieutenant' : name;
      expect(dialogue.bossEncounters?.[resolved]).toBeTruthy();
    }
  });
});

describe('Scene wiring', () => {
  it('NodeMap finalizeSceneReady runs run-start story before startup hints', async () => {
    const order = [];
    const scene = {
      ensureAudioUnlocked: vi.fn(async () => {}),
      sys: { isActive: () => true },
      input: { enabled: false },
      runManager: {
        hasShownDialogue: vi.fn(() => false),
        markDialogueShown: vi.fn((key) => order.push(`mark:${key}`)),
      },
      gameData: {
        dialogue: {
          actTransitions: { runStart: [{ speaker: 'Sera', line: 'x', portrait: null }] },
        },
      },
      dialogueOverlay: {
        showSequence: vi.fn(async () => {
          order.push('story');
        }),
      },
      persistRunSave: vi.fn(() => order.push('save')),
      _showPendingNodeMapHints: vi.fn(async () => {
        order.push('hints');
      }),
      _consumePendingNodeSelection: vi.fn(() => false),
      _storyDialogueActive: false,
      isSceneReady: false,
    };

    await NodeMapScene.prototype.finalizeSceneReady.call(scene);

    expect(order).toEqual(['mark:runStart', 'save', 'story', 'hints']);
    expect(scene.input.enabled).toBe(true);
    expect(scene.isSceneReady).toBe(true);
    expect(scene._storyDialogueActive).toBe(false);
  });

  it('run-complete dialogue key derivation follows result and difficulty', () => {
    const base = {
      gameData: {
        dialogue: {
          runComplete: {
            victory_normal: [{ speaker: 'Sera', line: 'n' }],
            victory_hard: [{ speaker: 'Sera', line: 'h' }],
            victory_lunatic: [{ speaker: 'Sera', line: 'l' }],
            defeat: [{ speaker: 'Sera', line: 'd' }],
          },
        },
      },
      runManager: { difficultyId: 'normal' },
      result: 'defeat',
    };

    expect(RunCompleteScene.prototype._getRunCompleteDialogue.call(base)?.[0]?.line).toBe('d');
    base.result = 'victory';
    base.runManager.difficultyId = 'normal';
    expect(RunCompleteScene.prototype._getRunCompleteDialogue.call(base)?.[0]?.line).toBe('n');
    base.runManager.difficultyId = 'hard';
    expect(RunCompleteScene.prototype._getRunCompleteDialogue.call(base)?.[0]?.line).toBe('h');
    base.runManager.difficultyId = 'lunatic';
    expect(RunCompleteScene.prototype._getRunCompleteDialogue.call(base)?.[0]?.line).toBe('l');
  });

  it('maps Dark Champion alias to The Lieutenant for boss dialogue lookup', () => {
    const scene = new BattleScene();
    expect(BattleScene.prototype._resolveBossDialogueName.call(scene, 'Dark Champion')).toBe(
      'The Lieutenant',
    );
    expect(BattleScene.prototype._resolveBossDialogueName.call(scene, 'The Lieutenant')).toBe(
      'The Lieutenant',
    );
  });

  it('post-loot fallback does not preempt while story lock is active', async () => {
    vi.useFakeTimers();

    let storyLocked = true;
    const scene = {
      _postLootTransitionStarted: false,
      _postLootTransitionCompleted: false,
      _postLootTransitionStartedAt: 0,
      _postLootTransitionTimer: null,
      _transitionAfterBattlePromise: null,
      isStoryInputLocked: vi.fn(() => storyLocked),
      transitionAfterBattle: vi.fn(async () => {
        await new Promise(() => {});
      }),
      forceTransitionAfterBattle: vi.fn(),
      _clearPostLootTransitionFallback: BattleScene.prototype._clearPostLootTransitionFallback,
    };
    scene._startPostLootTransition = BattleScene.prototype._startPostLootTransition;

    scene._startPostLootTransition.call(scene);
    await vi.advanceTimersByTimeAsync(8100);
    expect(scene.forceTransitionAfterBattle).not.toHaveBeenCalled();

    storyLocked = false;
    await vi.advanceTimersByTimeAsync(300);
    expect(scene.forceTransitionAfterBattle).toHaveBeenCalledTimes(1);

    scene._clearPostLootTransitionFallback.call(scene);
  });
});

describe('Input gate', () => {
  it('blocks E/R/O/D action methods while story lock is active', () => {
    const scene = {
      isStoryInputLocked: () => true,
      battleState: 'PLAYER_IDLE',
      dangerZoneStale: false,
      dangerZoneCache: [],
      dangerZone: { toggle: vi.fn() },
      playerUnits: [{ currentHP: 10 }],
      pauseOverlay: null,
      lootSettingsOverlay: null,
      unitDetailOverlay: { visible: false, hide: vi.fn() },
      inspectionPanel: { visible: false, _unit: null, hide: vi.fn() },
      grid: {
        mapLayout: [[0]],
        clearHighlights: vi.fn(),
        clearAttackHighlights: vi.fn(),
        clearPath: vi.fn(),
      },
      gameData: { terrain: [{}] },
      selectedUnit: null,
      refreshEndTurnControl: vi.fn(),
      turnManager: { currentPhase: 'player', endPlayerPhase: vi.fn(), unitActed: vi.fn() },
      hideForecast: vi.fn(),
      hideActionMenu: vi.fn(),
      cleanupTradeUI: vi.fn(),
      _clearSelectedWeaponArt: vi.fn(),
      requestVisionRewind: BattleScene.prototype.requestVisionRewind,
      _onDangerClick: BattleScene.prototype._onDangerClick,
      _onRosterClick: BattleScene.prototype._onRosterClick,
      forceEndTurn: BattleScene.prototype.forceEndTurn,
      canUseVisionNow: () => true,
      visionSnapshot: {},
      getVisionChargesRemaining: () => 1,
      showVisionDialog: vi.fn(),
    };

    BattleScene.prototype._onDangerClick.call(scene);
    expect(scene.dangerZone.toggle).not.toHaveBeenCalled();

    BattleScene.prototype._onRosterClick.call(scene);
    expect(scene.unitDetailOverlay.hide).not.toHaveBeenCalled();

    BattleScene.prototype.forceEndTurn.call(scene);
    expect(scene.turnManager.endPlayerPhase).not.toHaveBeenCalled();

    const rewound = BattleScene.prototype.requestVisionRewind.call(scene);
    expect(rewound).toBe(false);
    expect(scene.showVisionDialog).not.toHaveBeenCalled();
  });
});

describe('DialogueOverlay lifecycle', () => {
  function createDisplayObject() {
    return {
      setDepth() {
        return this;
      },
      setInteractive() {
        return this;
      },
      setStrokeStyle() {
        return this;
      },
      setOrigin() {
        return this;
      },
      setDisplaySize() {
        return this;
      },
      destroy: vi.fn(),
      on: vi.fn(),
    };
  }

  function createKey() {
    const listeners = [];
    return {
      listeners,
      once(_event, fn) {
        listeners.push(fn);
        return this;
      },
      off(_event, fn) {
        if (!fn) {
          listeners.length = 0;
          return this;
        }
        const idx = listeners.indexOf(fn);
        if (idx >= 0) listeners.splice(idx, 1);
        return this;
      },
    };
  }

  it('hide removes only overlay key listeners and resolves pending promise', async () => {
    const esc = createKey();
    const space = createKey();
    const enter = createKey();
    const external = () => {};
    esc.listeners.push(external);
    space.listeners.push(external);
    enter.listeners.push(external);

    const scene = {
      events: { once: vi.fn() },
      cameras: { main: { centerX: 320, centerY: 240, width: 640, height: 480 } },
      textures: { exists: () => false },
      add: {
        rectangle: () => createDisplayObject(),
        image: () => createDisplayObject(),
        text: () => createDisplayObject(),
      },
      time: {
        delayedCall: () => ({ remove: vi.fn() }),
      },
      input: {
        keyboard: {
          addKey: (key) => ({ ESC: esc, SPACE: space, ENTER: enter })[key],
        },
      },
    };

    const overlay = new DialogueOverlay(scene);
    const pending = overlay.show('Sera', 'line', null);
    overlay.hide();
    await pending;

    expect(esc.listeners).toContain(external);
    expect(space.listeners).toContain(external);
    expect(enter.listeners).toContain(external);
  });
});
