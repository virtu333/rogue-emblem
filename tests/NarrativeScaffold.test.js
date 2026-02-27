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

  it('has lord recruit dialogue for all lords', () => {
    const dialogue = JSON.parse(fs.readFileSync('data/dialogue.json', 'utf8'));
    const lords = JSON.parse(fs.readFileSync('data/lords.json', 'utf8'));
    expect(dialogue.lordRecruitLines).toBeTypeOf('object');
    for (const lord of lords) {
      const lines = dialogue.lordRecruitLines[lord.name];
      expect(lines, `missing lordRecruitLines for ${lord.name}`).toBeTruthy();
      expect(Array.isArray(lines)).toBe(true);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) expect(typeof line).toBe('string');
    }
  });

  it('lord recruit lookup prefers lordRecruitLines over class recruitLines', () => {
    const dialogue = JSON.parse(fs.readFileSync('data/dialogue.json', 'utf8'));
    // Simulate the BattleScene lookup logic (BattleScene.js:6032-6038)
    const lordNpc = { isLord: true, name: 'Edric', className: 'Lord' };
    const lordLines = lordNpc.isLord ? dialogue.lordRecruitLines?.[lordNpc.name] : null;
    const result = lordLines || dialogue.recruitLines?.[lordNpc.className] || ['Joined the army!'];
    expect(result).toEqual(dialogue.lordRecruitLines['Edric']);

    // Non-lord falls back to class lines
    const regularNpc = { isLord: false, name: 'Bob', className: 'Fighter' };
    const regularLordLines = regularNpc.isLord
      ? dialogue.lordRecruitLines?.[regularNpc.name]
      : null;
    const regularResult = regularLordLines ||
      dialogue.recruitLines?.[regularNpc.className] || ['Joined the army!'];
    expect(regularResult).toEqual(dialogue.recruitLines['Fighter']);
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

describe('Node flavor (Surface 1)', () => {
  function makeScene(act, dialogueData) {
    return {
      gameData: { dialogue: dialogueData },
      runManager: { currentAct: act },
      showShopBanner: vi.fn(),
      _showNodeFlavor: NodeMapScene.prototype._showNodeFlavor,
    };
  }

  it('picks from correct act/type pool', () => {
    const scene = makeScene('act2', {
      nodeFlavor: {
        battle: { act2: ['frontier line'] },
        elite: { act2: ['elite line'] },
      },
    });
    scene._showNodeFlavor({ type: 'battle' });
    expect(scene.showShopBanner).toHaveBeenCalledWith('frontier line', '#aabbcc');
  });

  it('falls back to act3 when act key missing', () => {
    const scene = makeScene('finalBoss', {
      nodeFlavor: { battle: { act3: ['fallback line'] } },
    });
    scene._showNodeFlavor({ type: 'battle' });
    expect(scene.showShopBanner).toHaveBeenCalledWith('fallback line', '#aabbcc');
  });

  it('uses elite pool for elite nodes', () => {
    const scene = makeScene('act1', {
      nodeFlavor: {
        battle: { act1: ['battle line'] },
        elite: { act1: ['elite line'] },
      },
    });
    scene._showNodeFlavor({ type: 'battle', isElite: true });
    expect(scene.showShopBanner).toHaveBeenCalledWith('elite line', '#aabbcc');
  });

  it('swallows errors gracefully', () => {
    const scene = makeScene('act1', {
      nodeFlavor: { battle: { act1: ['line'] } },
    });
    scene.showShopBanner = vi.fn(() => {
      throw new Error('boom');
    });
    expect(() => scene._showNodeFlavor({ type: 'battle' })).not.toThrow();
  });

  it('onNodeClick still launches battle when flavor path throws', () => {
    const node = { id: 'battle-1', type: 'battle' };
    const scene = {
      isTransitioning: false,
      battleLaunchInFlight: false,
      isSceneReady: true,
      shopOverlay: null,
      churchOverlay: null,
      colosseumOverlay: null,
      rosterOverlay: null,
      pauseOverlay: null,
      input: { enabled: true },
      _sceneLifecycleGeneration: 9,
      _showNodeFlavor: vi.fn(() => {
        throw new Error('flavor failed');
      }),
      handleBattle: vi.fn(),
    };

    expect(() => NodeMapScene.prototype.onNodeClick.call(scene, node)).not.toThrow();
    expect(scene.battleLaunchInFlight).toBe(true);
    expect(scene.isTransitioning).toBe(true);
    expect(scene.isSceneReady).toBe(false);
    expect(scene.handleBattle).toHaveBeenCalledWith(node, 9);
  });
});

describe('Lord farewell (Surface 2)', () => {
  function makeBattleScene(unitOverrides) {
    const unit = {
      faction: 'player',
      isLord: false,
      name: 'Bob',
      className: 'Fighter',
      col: 0,
      row: 0,
      currentHP: 0,
      ...unitOverrides,
    };
    const scene = {
      registry: { get: () => null },
      removeUnitGraphic: vi.fn(),
      playerUnits: [unit],
      enemyUnits: [],
      npcUnits: [],
      _playerDeathsThisBattle: 0,
      dangerZoneStale: false,
      battleConfig: { objective: 'rout' },
      gameData: {
        dialogue: {
          lordFarewell: {
            Kira: ['Farewell line'],
          },
        },
        lords: [{ name: 'Kira' }],
        classes: [],
        affixes: { affixes: [] },
      },
      dialogueOverlay: { show: vi.fn(async () => {}) },
      _getPortraitKey: vi.fn(() => 'portrait_lord_kira'),
      updateObjectiveText: vi.fn(),
      updateHPBar: vi.fn(),
      _showBossDefeatedBanner: vi.fn(),
      grid: { gridToPixel: () => ({ x: 0, y: 0 }) },
      add: { text: () => ({ setOrigin: () => ({ setDepth: () => ({}) }) }) },
      tweens: { add: vi.fn() },
    };
    return { scene, unit };
  }

  it('shows farewell for non-Edric lord', async () => {
    const { scene, unit } = makeBattleScene({ isLord: true, name: 'Kira' });
    await BattleScene.prototype.removeUnit.call(scene, unit);
    expect(scene.dialogueOverlay.show).toHaveBeenCalledWith(
      'Kira',
      'Farewell line',
      'portrait_lord_kira',
    );
  });

  it('skips farewell for Edric', async () => {
    const { scene, unit } = makeBattleScene({ isLord: true, name: 'Edric' });
    await BattleScene.prototype.removeUnit.call(scene, unit);
    expect(scene.dialogueOverlay.show).not.toHaveBeenCalled();
  });

  it('skips farewell for non-lord', async () => {
    const { scene, unit } = makeBattleScene({ isLord: false, name: 'Kira' });
    await BattleScene.prototype.removeUnit.call(scene, unit);
    expect(scene.dialogueOverlay.show).not.toHaveBeenCalled();
  });
});

describe('Church revival flavor (Surface 3)', () => {
  function makeChurchScene(churchFlavorData) {
    const shownMessages = [];
    const scene = {
      runManager: { currentAct: 'act1' },
      gameData: { dialogue: { churchFlavor: churchFlavorData } },
      churchOverlay: [{}],
      _sceneTimers: new Set(),
      scene: { isActive: () => true },
      time: {
        delayedCall: (ms, cb) => {
          const id = setTimeout(cb, ms);
          return { remove: () => clearTimeout(id) };
        },
      },
      refreshChurchOverlay: vi.fn(() => {
        scene.churchOverlay = [{}];
      }),
      showChurchMessage: vi.fn((text) => {
        shownMessages.push(text);
      }),
      _scheduleChurchFlavor: NodeMapScene.prototype._scheduleChurchFlavor,
    };
    return { scene, shownMessages };
  }

  it('revive success shows functional message first, then delayed flavor', async () => {
    vi.useFakeTimers();
    const { scene, shownMessages } = makeChurchScene({
      revival: { act1: ['Light returns.'] },
    });

    NodeMapScene.prototype._showChurchSuccessMessage.call(
      scene,
      { id: 'church-1' },
      'Kira revived!',
      '#44ff44',
      'revival',
    );

    expect(scene.refreshChurchOverlay).toHaveBeenCalledWith({ id: 'church-1' });
    expect(shownMessages).toEqual(['Kira revived!']);
    await vi.advanceTimersByTimeAsync(600);
    expect(shownMessages).toEqual(['Kira revived!', 'Light returns.']);
  });

  it('delayed flavor is skipped safely if church overlay closes first', async () => {
    vi.useFakeTimers();
    const { scene, shownMessages } = makeChurchScene({
      revival: { act1: ['Light returns.'] },
    });

    NodeMapScene.prototype._showChurchSuccessMessage.call(
      scene,
      { id: 'church-1' },
      'Kira revived!',
      '#44ff44',
      'revival',
    );
    scene.churchOverlay = null;

    await vi.advanceTimersByTimeAsync(600);
    expect(shownMessages).toEqual(['Kira revived!']);
  });
});

describe('Church promotion flavor (Surface 4)', () => {
  it('promotion success shows functional message first, then delayed flavor', async () => {
    vi.useFakeTimers();
    const shownMessages = [];
    const scene = {
      runManager: { currentAct: 'act1' },
      gameData: {
        dialogue: {
          churchFlavor: { promotion: { act1: ['Power awakens.'] } },
        },
      },
      churchOverlay: [{}],
      _sceneTimers: new Set(),
      scene: { isActive: () => true },
      time: {
        delayedCall: (ms, cb) => {
          const id = setTimeout(cb, ms);
          return { remove: () => clearTimeout(id) };
        },
      },
      refreshChurchOverlay: vi.fn(() => {
        scene.churchOverlay = [{}];
      }),
      showChurchMessage: vi.fn((text) => {
        shownMessages.push(text);
      }),
      _scheduleChurchFlavor: NodeMapScene.prototype._scheduleChurchFlavor,
    };

    NodeMapScene.prototype._showChurchSuccessMessage.call(
      scene,
      { id: 'church-1' },
      'Sera promoted to Saint!',
      '#ffdd44',
      'promotion',
    );

    expect(shownMessages).toEqual(['Sera promoted to Saint!']);
    await vi.advanceTimersByTimeAsync(600);
    expect(shownMessages).toEqual(['Sera promoted to Saint!', 'Power awakens.']);
  });

  it('showChurchMessage exits safely when scene is inactive or overlay missing', () => {
    const addText = vi.fn();
    const baseScene = {
      churchOverlay: null,
      scene: { isActive: () => true },
      add: { text: addText },
      time: { delayedCall: vi.fn() },
    };
    expect(() =>
      NodeMapScene.prototype.showChurchMessage.call(baseScene, 'Should not render', '#aabbcc'),
    ).not.toThrow();
    expect(addText).not.toHaveBeenCalled();

    const inactiveScene = {
      churchOverlay: [{}],
      scene: { isActive: () => false },
      add: { text: addText },
      time: { delayedCall: vi.fn() },
    };
    expect(() =>
      NodeMapScene.prototype.showChurchMessage.call(inactiveScene, 'Should not render', '#aabbcc'),
    ).not.toThrow();
    expect(addText).not.toHaveBeenCalled();
  });
});

describe('Shop entry flavor (Surface 5)', () => {
  function createOverlayObject() {
    return {
      setDepth() {
        return this;
      },
      setOrigin() {
        return this;
      },
      setStrokeStyle() {
        return this;
      },
      setInteractive() {
        return this;
      },
      setColor() {
        return this;
      },
      setBackgroundColor() {
        return this;
      },
      on() {
        return this;
      },
      destroy: vi.fn(),
    };
  }

  it('triggers flavor banner from showShopOverlay', () => {
    const scene = {
      runManager: { currentAct: 'act1', gold: 120 },
      gameData: {
        dialogue: {
          shopFlavor: { act1: ['Merchant eyes your purse.'] },
        },
      },
      registry: { get: vi.fn(() => null) },
      add: {
        rectangle: () => createOverlayObject(),
        text: () => createOverlayObject(),
      },
      drawShopTabs: vi.fn(),
      drawActiveTabContent: vi.fn(),
      leaveShopNode: vi.fn(),
      _enterShopMapView: vi.fn(),
      _hideForgeTooltip: vi.fn(),
      _hideShopItemTooltip: vi.fn(),
      _setShopOverlayVisibility: vi.fn(),
      _openRoster: vi.fn(),
      showShopBanner: vi.fn(),
      shopRerollCount: 0,
    };

    NodeMapScene.prototype.showShopOverlay.call(scene, { id: 'shop-1' }, []);

    expect(scene.showShopBanner).toHaveBeenCalledWith('Merchant eyes your purse.', '#aabbcc');
  });
});

describe('Elite victory flavor (Surface 6)', () => {
  function makeEliteVictoryScene(overrides = {}) {
    const order = [];
    const pending = [];
    const sceneState = { active: true };
    const scene = {
      battleState: 'PLAYER_IDLE',
      battleParams: { tutorialMode: false, act: 'act1' },
      scene: { isActive: () => sceneState.active },
      cameras: { main: { centerX: 320, centerY: 240 } },
      add: {
        text: vi.fn(() => ({
          setOrigin() {
            return this;
          },
          setDepth() {
            return this;
          },
          destroy: vi.fn(),
        })),
      },
      _pinToScreen: vi.fn(),
      time: {
        delayedCall: vi.fn((_ms, cb) => {
          pending.push(cb());
        }),
      },
      registry: { get: vi.fn(() => ({ playMusic: vi.fn() })) },
      clearBattleScopedDeltas: vi.fn(),
      playerUnits: [{ name: 'Edric', stats: { HP: 20 } }],
      nonDeployedUnits: [],
      getTurnPressureState: vi.fn(() => ({ goldMultiplier: 1 })),
      goldEarned: 50,
      nodeId: 'node-1',
      isBoss: false,
      isElite: true,
      gameData: {
        dialogue: {
          eliteVictory: { act1: ['Stronger ones fall.'] },
        },
      },
      runManager: {
        completeBattle: vi.fn(() => true),
        isRunComplete: vi.fn(() => false),
        shouldTriggerThirdLord: vi.fn(() => false),
      },
      dialogueOverlay: {
        show: vi.fn(async () => {
          order.push('dialogue');
        }),
      },
      showLootScreen: vi.fn(() => {
        order.push('loot');
      }),
    };
    Object.assign(scene, overrides);
    return { scene, pending, order, sceneState };
  }

  it('shows dialogue before loot for elite battles', async () => {
    const { scene, pending, order } = makeEliteVictoryScene();

    BattleScene.prototype.onVictory.call(scene);
    await Promise.all(pending);

    expect(scene.dialogueOverlay.show).toHaveBeenCalledWith(null, 'Stronger ones fall.', null);
    expect(order).toEqual(['dialogue', 'loot']);
  });

  it('skips dialogue for non-elite', async () => {
    const { scene, pending } = makeEliteVictoryScene({ isElite: false });

    BattleScene.prototype.onVictory.call(scene);
    await Promise.all(pending);

    expect(scene.dialogueOverlay.show).not.toHaveBeenCalled();
    expect(scene.showLootScreen).toHaveBeenCalledTimes(1);
  });

  it('guards inactive scene after dialogue', async () => {
    const { scene, pending, sceneState } = makeEliteVictoryScene();
    scene.dialogueOverlay = {
      show: vi.fn(async () => {
        sceneState.active = false;
      }),
    };

    BattleScene.prototype.onVictory.call(scene);
    await Promise.all(pending);

    expect(scene.dialogueOverlay.show).toHaveBeenCalled();
    expect(scene.showLootScreen).not.toHaveBeenCalled();
  });
});

describe('Narrative data — flavor content', () => {
  it('dialogue.json has all 5 flavor keys with valid structure', () => {
    const dialogue = JSON.parse(fs.readFileSync('data/dialogue.json', 'utf8'));
    const ACTS = ['act1', 'act2', 'act3', 'act4', 'finalBoss'];

    // nodeFlavor
    for (const type of ['battle', 'elite', 'boss', 'recruit']) {
      for (const act of ACTS) {
        const lines = dialogue.nodeFlavor?.[type]?.[act];
        expect(Array.isArray(lines), `nodeFlavor.${type}.${act}`).toBe(true);
        expect(lines.length, `nodeFlavor.${type}.${act} non-empty`).toBeGreaterThan(0);
      }
    }

    // lordFarewell — all non-Edric lords
    const lords = JSON.parse(fs.readFileSync('data/lords.json', 'utf8'));
    for (const lord of lords) {
      if (lord.name === 'Edric') continue;
      const lines = dialogue.lordFarewell?.[lord.name];
      expect(Array.isArray(lines), `lordFarewell.${lord.name}`).toBe(true);
      expect(lines.length).toBeGreaterThan(0);
    }

    // churchFlavor
    for (const type of ['revival', 'promotion']) {
      for (const act of ACTS) {
        const lines = dialogue.churchFlavor?.[type]?.[act];
        expect(Array.isArray(lines), `churchFlavor.${type}.${act}`).toBe(true);
        expect(lines.length).toBeGreaterThan(0);
      }
    }

    // shopFlavor
    for (const act of ACTS) {
      const lines = dialogue.shopFlavor?.[act];
      expect(Array.isArray(lines), `shopFlavor.${act}`).toBe(true);
      expect(lines.length).toBeGreaterThan(0);
    }

    // eliteVictory
    for (const act of ACTS) {
      const lines = dialogue.eliteVictory?.[act];
      expect(Array.isArray(lines), `eliteVictory.${act}`).toBe(true);
      expect(lines.length).toBeGreaterThan(0);
    }
  });
});
