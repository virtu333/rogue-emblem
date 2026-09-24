// A1/A2: deterministic service journeys through shipping menu callbacks and
// lifecycle methods. Rendering is supplied by JourneyPresentation in Vitest.
// No command reimplementation and no implicit save in reload/assertions.
import { RunManager, saveRun, loadRun } from '../../src/engine/RunManager.js';
import { MetaProgressionManager } from '../../src/engine/MetaProgressionManager.js';
import { createUnit } from '../../src/engine/UnitManager.js';
import { ShopController } from '../../src/ui/ShopController.js';
import { ChurchController } from '../../src/ui/ChurchController.js';
import { ColosseumOverlay } from '../../src/ui/ColosseumOverlay.js';
import { NodeMapScene } from '../../src/scenes/NodeMapScene.js';
import { loadGameData } from '../testData.js';
import { createHash } from 'node:crypto';

const targetHash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const nodeText = (node) =>
  [node.textContent, ...(node.children || []).map(nodeText)].filter(Boolean).join(' ');
import {
  journeySnapshot,
  assertJourneyEqual,
  assertNodeMonotonic,
  assertAbandonPayout,
  assertCaravanEntry,
  assertServiceLeave,
} from './JourneyInvariants.js';

export class JourneyStorage {
  values = new Map();
  writes = 0;
  failedWrites = 0;
  failWrites = false;
  getItem(key) {
    return this.values.get(key) ?? null;
  }
  setItem(key, value) {
    if (this.failWrites) {
      this.failedWrites++;
      const error = new Error('Injected storage quota failure');
      error.name = 'QuotaExceededError';
      throw error;
    }
    this.writes++;
    this.values.set(key, String(value));
  }
  removeItem(key) {
    this.values.delete(key);
  }
}

export const JOURNEY_BOUNDARIES = Object.freeze({
  shop: 'entry, successful transaction, leave',
  caravan: 'entry consumes pending reward and caches stock; transaction; leave',
  church: 'successful heal/revive/promote; leave (entry is read-only)',
  arena: 'mercenary generation; fight settlement before log; hire; leave',
  back: 'no transaction; last persisted gameplay state retained',
  reload: 'read existing storage only; recreate controllers without leave/save',
  abandon: 'run save removed; meta payout persisted exactly once',
});

export class RunDriver {
  constructor(storage, { seed = 42, caravan = false } = {}) {
    this.storage = storage;
    this.data = loadGameData();
    this.trace = [];
    this.run = new RunManager(this.data);
    this.run.startRun({ runSeed: seed });
    this.run.gold = 20000;
    this.run.completedBattles = 2;
    this.run.roster[0].level = 10;
    this.run.roster[0].currentHP = 1;
    this.run.fallenUnits.push(
      createUnit(
        this.data.classes.find((c) => c.name === 'Fighter'),
        1,
        this.data.weapons,
        { name: 'Journey Fallen' },
      ),
    );
    this.run.fallenUnits[0].currentHP = 0;
    // A fixed route provides deterministic coverage independent of map rolls.
    this.run.nodeMap.nodes = ['shop', 'church', 'arena'].map((kind, i) => ({
      id: `journey-${kind}`,
      type: kind,
      row: i,
      col: 0,
      completed: false,
      connections: i < 2 ? [`journey-${['shop', 'church', 'arena'][i + 1]}`] : [],
    }));
    this.run.currentNodeId = null;
    if (caravan) this.run.pendingCaravanShop = { actId: this.run.currentAct };
    this.meta = new MetaProgressionManager(this.data.metaUpgrades, 'journey_meta');
    // Fixture setup is the ONLY driver-owned run write.
    if (!saveRun(this.run, null, 1).ok) throw new Error('Fixture save failed');
    this.bindScene();
    this.lastDurable = journeySnapshot(this.run);
  }
  bindScene() {
    this.scene = {
      runManager: this.run,
      gameData: this.data,
      registry: { get: (key) => (key === 'activeSlot' ? 1 : key === 'meta' ? this.meta : null) },
      events: { once() {}, off() {} },
      checkActComplete() {},
      drawMap() {},
      // Scene's real delegating wrappers, without constructing a Phaser game.
      persistRunSave: () => NodeMapScene.prototype.persistRunSave.call(this.scene),
    };
    this.shop = new ShopController(this.scene);
    this.church = new ChurchController(this.scene);
    for (const [controller, methods] of [
      [
        this.shop,
        [
          'showShopOverlay',
          'closeShopOverlay',
          'applyDifficultyShopPricing',
          'applyRuinsMarkup',
          'applyAmbushDiscount',
          '_saveShopState',
          'refreshShop',
        ],
      ],
      [this.church, ['showChurchOverlay', 'closeChurchOverlay']],
    ])
      for (const method of methods) this.scene[method] = controller[method].bind(controller);
    this.arena = new ColosseumOverlay(this.scene, this.run, this.data);
    this.scene.showShopBanner = () => {}; // presentation only
    this.service = null;
  }
  get menu() {
    return this.service === 'arena'
      ? this.arena.nativeMenu
      : this.service === 'church'
        ? this.church.nativeMenu
        : this.shop.nativeMenu;
  }
  node(kind) {
    return this.run.nodeMap.nodes.find((n) => n.id === `journey-${kind}`);
  }
  enter(kind) {
    if (this.service) throw new Error('Leave the current service before entering another');
    this.service = kind;
    if (kind === 'shop' || kind === 'caravan')
      this.shop.handleShop(kind === 'caravan' ? null : this.node(kind), {
        caravan: kind === 'caravan',
      });
    else if (kind === 'church') this.church.handleChurch(this.node(kind));
    else if (kind === 'arena') {
      this.scene.colosseumOverlay = this.arena;
      this.arena.show(this.node(kind), () =>
        NodeMapScene.prototype.leaveColosseumNode.call(this.scene, this.node(kind)),
      );
    } else throw new Error(`Unknown service ${kind}`);
  }
  buttons() {
    return (this.menu?.surface.root.all() || []).filter((n) => n.tag === 'button');
  }
  press(label) {
    const candidates = this.buttons().filter((b) =>
      typeof label === 'string' ? nodeText(b) === label : label.test(nodeText(b)),
    );
    if (candidates.length !== 1)
      throw new Error(`Expected one button ${label}, found ${candidates.length}`);
    if (candidates[0].disabled) throw new Error(`Disabled button ${label}`);
    return candidates[0].onclick();
  }
  confirm(index = 0) {
    const child = this.menu?.child;
    if (!child) throw new Error('No pending picker');
    const { choices, blocked, apply } = child.options;
    const choice = choices[index];
    if (choice === undefined) throw new Error('Missing choice');
    const reason = blocked?.(choice);
    if (reason) throw new Error(reason);
    const result = apply(choice);
    if (result?.ok) child.close();
    return result;
  }
  back() {
    if (this.menu?.child) this.menu.child.close();
    else {
      this.menu.surface.onClose();
      const closed =
        this.service === 'arena'
          ? !this.arena.visible
          : this.service === 'church'
            ? !this.scene.churchOverlay
            : !this.scene.shopOverlay;
      if (closed) {
        assertServiceLeave(this.run, this.service);
        this.service = null;
      }
    }
  }
  leave() {
    if (this.menu?.child) throw new Error('Back out of the picker before leaving');
    if (this.service === 'arena') this.arena.leave();
    else this.menu.surface.onClose();
    assertServiceLeave(this.run, this.service);
    this.service = null;
  }
  // Do not call teardown callbacks: browser termination cannot run a service
  // leave hook. Do not serialize the live run or add any save here.
  reload() {
    const beforeWrites = this.storage.writes;
    this.run = null;
    this.scene = this.shop = this.church = this.arena = null;
    this.run = loadRun(this.data, 1);
    if (!this.run) throw new Error('No persisted run to reload');
    this.meta = new MetaProgressionManager(this.data.metaUpgrades, 'journey_meta');
    this.bindScene();
    if (this.storage.writes !== beforeWrites) throw new Error('Reload unexpectedly wrote storage');
  }
  assertPersisted(boundary) {
    const current = journeySnapshot(this.run);
    const restored = journeySnapshot(loadRun(this.data, 1));
    assertJourneyEqual(current, restored, boundary);
    assertNodeMonotonic(this.lastDurable, restored);
    this.lastDurable = restored;
    return restored;
  }
  async abandon() {
    const before = {
      totalValor: this.meta.totalValor,
      totalSupply: this.meta.totalSupply,
      runsCompleted: this.meta.runsCompleted,
    };
    const expected = this.run.previewEndRunRewards();
    NodeMapScene.prototype.showPauseMenu.call(this.scene);
    await this.scene.pauseOverlay.options.onAbandon();
    const restored = new MetaProgressionManager(this.data.metaUpgrades, 'journey_meta');
    assertAbandonPayout(before, expected, restored, loadRun(this.data, 1));
  }
  async step(action, { boundary = true } = {}) {
    const resolved = this.resolveAction(action);
    this.trace.push(resolved);
    const failures = this.storage.failedWrites;
    const prior = this.lastDurable;
    let result;
    if (action.type === 'enter') result = this.enter(action.service);
    else if (action.type === 'press') {
      const button = this.buttons()[resolved.buttonIndex];
      if (button.disabled) throw new Error('Recorded button is disabled');
      result = button.onclick();
      if (this.service && !this.isServiceVisible()) {
        assertServiceLeave(this.run, this.service);
        this.service = null;
      }
    } else if (action.type === 'confirm') result = this.confirm(action.index);
    else if (action.type === 'back') result = this.back();
    else if (action.type === 'leave') result = this.leave();
    else if (action.type === 'reload') result = this.reload();
    else if (action.type === 'abandon') return this.abandon();
    else throw new Error(`Unknown action ${action.type}`);
    if (action.type === 'enter' && action.service === 'caravan') assertCaravanEntry(this.run);
    if (this.storage.failedWrites > failures) {
      // Keep the previous durable oracle. A warned write failure permits live
      // state to differ, but never advances what we promise will survive reload.
      assertJourneyEqual(
        prior,
        journeySnapshot(loadRun(this.data, 1)),
        'failed write preserved previous save',
      );
      return { result, persistence: 'failed' };
    }
    if (action.type === 'reload') assertJourneyEqual(prior, journeySnapshot(this.run), 'reload');
    if (boundary) this.assertPersisted(action.type);
    return { result, persistence: boundary ? 'verified' : 'unchecked' };
  }
  isServiceVisible() {
    return this.service === 'arena'
      ? this.arena.visible
      : this.service === 'church'
        ? !!this.scene.churchOverlay
        : !!this.scene.shopOverlay;
  }
  resolveAction(action) {
    if (action.type === 'press') {
      const buttons = this.buttons();
      let index = action.buttonIndex;
      if (index == null) {
        const matches = buttons
          .map((b, i) => ({ label: nodeText(b), i }))
          .filter(({ label }) =>
            typeof action.label === 'string' ? label === action.label : action.label.test(label),
          );
        if (matches.length !== 1) throw new Error(`Ambiguous or missing button ${action.label}`);
        index = matches[0].i;
      }
      const label = buttons[index] && nodeText(buttons[index]);
      if (!label || (typeof action.label === 'string' && label !== action.label))
        throw new Error('Replay target mismatch: button');
      return { type: 'press', label, buttonIndex: index };
    }
    if (action.type === 'confirm') {
      const index = action.index ?? 0;
      const options = this.menu?.child?.options;
      if (!options || options.choices[index] === undefined)
        throw new Error('Replay target mismatch: choice missing');
      const target = targetHash(options.choices[index]);
      if (action.target && action.target !== target)
        throw new Error('Replay target mismatch: choice content');
      return { type: 'confirm', index, target };
    }
    return JSON.parse(JSON.stringify(action));
  }
  listLegalActions() {
    if (this.run.status !== 'active') return [];
    if (!this.service) {
      const entries = this.run.getPendingCaravanShop()
        ? [{ type: 'enter', service: 'caravan' }]
        : ['shop', 'church', 'arena']
            .filter((kind) => !this.node(kind).completed)
            .map((service) => ({ type: 'enter', service }));
      return [...entries, { type: 'reload' }, { type: 'abandon' }];
    }
    const options = this.menu?.child?.options;
    if (options)
      return [
        ...options.choices.flatMap((choice, index) =>
          options.blocked?.(choice) ? [] : [this.resolveAction({ type: 'confirm', index })],
        ),
        { type: 'back' },
        { type: 'reload' },
      ];
    return [
      ...this.buttons().flatMap((button, buttonIndex) => {
        const label = nodeText(button);
        // These lead to other surfaces outside this service-only fixture.
        if (
          button.disabled ||
          ['View map', 'Roster'].includes(label) ||
          button.attributes['aria-pressed'] === 'true'
        )
          return [];
        if (['Leave', 'Back', 'Close'].includes(label)) return []; // represented by semantic Back below
        return [{ type: 'press', label, buttonIndex }];
      }),
      { type: 'back' },
      { type: 'reload' },
    ];
  }
}
