// Guided, seeded journeys through enabled production service-menu callbacks.
// Requires the rendering substitutes installed by JourneyTestSetup (Vitest).
import { createHash } from 'node:crypto';
import { vi } from 'vitest';
import { JourneyBattleDriver } from './JourneyBattleDriver.js';
import { RunDriver, JourneyStorage } from './RunDriver.js';
import { journeySnapshot } from './JourneyInvariants.js';
import { createSeededRng } from '../../src/engine/BlessingEngine.js';
import { _resetUidCounter } from '../../src/utils/itemUid.js';

export const JOURNEY_FORMAT = 1;
export const JOURNEY_FIXTURE = 'service-combat-route-v2';
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const increment = (map, key) => {
  map[key] = (map[key] || 0) + 1;
};
const GOALS = {
  shop: ['buy', 'sell', 'forge'],
  caravan: ['buy'],
  church: ['heal', 'promote', 'revive'],
  arena: ['fight', 'hire'],
};
let running = false;

function operation(driver, action) {
  const text = action.type === 'confirm' ? driver.menu.child.options.title : action.label || '';
  if (/^(Buy |Give )/.test(text)) return 'buy';
  if (/^Sell /.test(text)) return 'sell';
  if (/^(Forge |Choose forge)/.test(text)) return 'forge';
  if (/^Restock/.test(text)) return 'restock';
  if (/^Heal all/.test(text)) return 'heal';
  if (/^Promote /.test(text) || (driver.service === 'church' && / · Lv /.test(text)))
    return 'promote';
  if (/^Revive /.test(text) || / · Revive /.test(text)) return 'revive';
  if (text === 'Fight') return 'fight';
  if (text === 'Confirm hire') return 'hire';
  return null;
}
function serviceGoalsMet(service, coverage) {
  return GOALS[service]?.every((goal) => coverage.transactions[`${service}:${goal}`] > 0);
}
function isRoot(driver) {
  return driver.service !== 'arena' || driver.menu?.surface.title === 'Colosseum';
}
export class JourneyFuzzAgent {
  constructor(seed) {
    this.random = createSeededRng((seed ^ 0x9e3779b9) >>> 0);
  }
  chooseAction(actions, driver, coverage) {
    const last = driver.trace.at(-1);
    if (actions[0]?.type.startsWith('combat-'))
      return actions[Math.floor(this.random() * actions.length)];
    const weighted = actions.map((action) => {
      let weight = 2;
      const op = operation(driver, action);
      const done = serviceGoalsMet(driver.service, coverage);
      if (action.type === 'abandon')
        weight = 0; // isolated S1 contracts cover early termination
      else if (action.type === 'enter') weight = 14;
      else if (action.type === 'reload') weight = last?.type === 'reload' ? 0 : 1;
      else if (action.type === 'back')
        weight = driver.menu?.child ? 1 : isRoot(driver) ? (done ? 25 : 0) : 6;
      else if (op) weight = coverage.transactions[`${driver.service}:${op}`] ? 0.2 : 18;
      else if (['Buy', 'Sell', 'Forge'].includes(action.label))
        weight = coverage.transactions[`${driver.service}:${action.label.toLowerCase()}`]
          ? 0.3
          : 12;
      else if (action.label === 'Arena') weight = coverage.transactions['arena:fight'] ? 0.2 : 15;
      else if (action.label === 'Mercenary board')
        weight = coverage.transactions['arena:hire'] ? 0.2 : 15;
      else if (['Continue', 'Back to colosseum'].includes(action.label)) weight = 12;
      else if (action.label === 'Fight again') weight = 0.1;
      return { action, weight };
    });
    const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
    if (!total) throw new Error('Journey policy has no weighted action');
    let pick = this.random() * total;
    for (const entry of weighted) {
      pick -= entry.weight;
      if (pick < 0) return entry.action;
    }
    return weighted.at(-1).action;
  }
}
export function assertJourneyCoverage(coverage) {
  const missing = [];
  for (const [service, goals] of Object.entries(GOALS)) {
    for (const goal of goals)
      if (!coverage.transactions[`${service}:${goal}`]) missing.push(`${service}:${goal}`);
    if (!coverage.leaves[service]) missing.push(`${service}:leave`);
  }
  if (!coverage.actions['combat-resolve']) missing.push('combat:resolve');
  if (!coverage.actions['combat-popup-dismiss']) missing.push('combat:popup-dismiss');
  if (!coverage.actions['combat-suspend-resume']) missing.push('combat:suspend-resume');
  if (!coverage.actions['combat-popup-reload']) missing.push('combat:popup-reload');
  if (!coverage.reloadsAfterTransaction) missing.push('reload-after-transaction');
  if (missing.length) throw new Error(`Journey coverage missing: ${missing.join(', ')}`);
}
function driverHash(driver) {
  const picker = driver.menu?.child?.options;
  return hash({
    run: journeySnapshot(driver.run),
    combat: driver.combat?.snapshot() || null,
    service: driver.service,
    title: driver.menu?.surface?.title || null,
    picker: picker ? { title: picker.title, choices: picker.choices } : null,
    selected: driver.menu?.selected || null,
    challenger: driver.service === 'arena' ? driver.arena._challenger : null,
  });
}
function canonicalAction(action) {
  return JSON.stringify(action);
}
export async function runJourney({ seed = 1, maxActions = 600, replay = null, agent = null } = {}) {
  if (running) throw new Error('Journey runner uses isolated globals; do not run concurrently');
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new Error('Seed must be a uint32');
  if (!Number.isInteger(maxActions) || maxActions < 1 || maxActions > 10000)
    throw new Error('Invalid action budget');
  if (
    replay &&
    (replay.formatVersion !== JOURNEY_FORMAT ||
      replay.fixtureId !== JOURNEY_FIXTURE ||
      replay.seed !== seed)
  )
    throw new Error('Replay format, fixture or seed mismatch');
  if (
    replay &&
    (!Array.isArray(replay.actionTrace) ||
      replay.actionTrace.length > 10000 ||
      !Array.isArray(replay.stateHashes))
  )
    throw new Error('Invalid replay trace');
  if (replay) {
    const completed = replay.stateHashes.length;
    const total = replay.actionTrace.length;
    if (
      !['passed', 'failed'].includes(replay.result) ||
      (replay.result === 'passed' && (completed !== total || replay.failure)) ||
      (replay.result === 'failed' &&
        (!replay.failure || completed > total || completed < total - 1)) ||
      replay.stateHashes.some((value) => !/^[a-f0-9]{64}$/.test(value))
    )
      throw new Error('Invalid replay checkpoint sequence');
  }
  running = true;
  const previousRandom = Math.random;
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const report = {
    formatVersion: JOURNEY_FORMAT,
    fixtureId: JOURNEY_FIXTURE,
    seed,
    maxActions,
    dataHash: null,
    initialHash: null,
    actionTrace: [],
    stateHashes: [],
    coverage: { actions: {}, transactions: {}, leaves: {}, reloadsAfterTransaction: 0 },
    result: null,
    failure: null,
  };
  let driver;
  let actionIndex = -1;
  try {
    Math.random = createSeededRng(seed);
    _resetUidCounter();
    const storage = new JourneyStorage();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { activeElement: null },
    });
    driver = new RunDriver(storage, { seed, caravan: true });
    report.actionTrace = driver.trace; // the A1 trace remains the authoritative record
    report.dataHash = hash(driver.data);
    report.initialHash = driverHash(driver);
    if (
      replay &&
      (replay.dataHash !== report.dataHash || replay.initialHash !== report.initialHash)
    )
      throw new Error('Replay initial state or catalog mismatch');
    const chooser = replay ? null : agent || new JourneyFuzzAgent(seed);
    let dirtySinceReload = false;
    const limit = replay ? replay.actionTrace.length : maxActions;
    for (actionIndex = 0; actionIndex < limit; actionIndex++) {
      let actions = driver.listLegalActions();
      const allDone = Object.keys(GOALS).every(
        (service) => serviceGoalsMet(service, report.coverage) && report.coverage.leaves[service],
      );
      if (allDone && report.coverage.reloadsAfterTransaction && !driver.service) {
        driver.combat ||= new JourneyBattleDriver(driver);
        if (!replay && driver.combat.phase === 'done') break;
        actions = driver.combat.actions();
        // Ensure the critical reload window is covered in every short-tier seed.
        if (driver.combat.phase === 'popup') {
          if (driver.combat.round >= 2 && !report.coverage.actions['combat-popup-reload'])
            actions = actions.filter((a) => a.type === 'combat-popup-reload');
          else if (driver.combat.round === 3 && !report.coverage.actions['combat-popup-dismiss'])
            actions = actions.filter((a) => a.type === 'combat-popup-dismiss');
        }
      }
      const action = replay
        ? replay.actionTrace[actionIndex]
        : chooser.chooseAction(actions, driver, report.coverage);
      if (!actions.some((legal) => canonicalAction(legal) === canonicalAction(action)))
        throw new Error(`Replay or agent selected an unavailable action at ${actionIndex}`);
      const service = driver.service;
      const op = operation(driver, action);
      const before = hash(journeySnapshot(driver.run));
      const previousTraceLength = driver.trace.length;
      try {
        if (action.type.startsWith('combat-')) await driver.combat.step(action);
        else await driver.step(action);
      } catch (error) {
        if (driver.trace.length === previousTraceLength) driver.trace.push(action);
        throw error;
      }
      increment(report.coverage.actions, action.type);
      if (op && before !== hash(journeySnapshot(driver.run))) {
        increment(report.coverage.transactions, `${service}:${op}`);
        dirtySinceReload = true;
      }
      if (service && !driver.service && action.type !== 'reload')
        increment(report.coverage.leaves, service);
      if (action.type === 'reload' && dirtySinceReload) {
        report.coverage.reloadsAfterTransaction++;
        dirtySinceReload = false;
      }
      const stateHash = driverHash(driver);
      report.stateHashes.push(stateHash);
      if (
        replay &&
        replay.stateHashes[actionIndex] &&
        replay.stateHashes[actionIndex] !== stateHash
      )
        throw new Error(`Replay state diverged at action ${actionIndex}`);
    }
    assertJourneyCoverage(report.coverage);
    report.result = 'passed';
  } catch (error) {
    report.result = 'failed';
    report.failure = { actionIndex, invariant: error.message, stateDiff: error.stateDiff || null };
  } finally {
    driver?.combat?.closePopup?.();
    // Module-level rendering/persistence spies otherwise retain every scene and
    // run passed to them across all seeds in one long Vitest soak. Clear history
    // only: calibration mock implementations must survive deterministic replay.
    vi.clearAllMocks();
    Math.random = previousRandom;
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else delete globalThis.localStorage;
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else delete globalThis.document;
    running = false;
  }
  if (replay)
    report.reproduced =
      replay.result === report.result &&
      (report.result === 'passed' ||
        JSON.stringify(replay.failure) === JSON.stringify(report.failure));
  return report;
}
