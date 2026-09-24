import { afterEach, describe, expect, it, vi } from 'vitest';
import './JourneyTestSetup.js';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runJourney, assertJourneyCoverage } from './JourneyFuzzer.js';
import { showMinorHint, showImportantHint } from '../../src/ui/HintDisplay.js';
import { saveServiceRun } from '../../src/ui/serviceSave.js';
import { journeyBattleScene } from './JourneyBattleScene.js';
import { BattleScene } from '../../src/scenes/BattleScene.js';
import { ShopController } from '../../src/ui/ShopController.js';
import { randomInt } from 'node:crypto';
import { parseJourneyArgs } from '../agents/journey-runner.js';

const cli = process.env.JOURNEY_OPTIONS ? JSON.parse(process.env.JOURNEY_OPTIONS) : null;
const seeds = cli?.trace ? [cli.seed] : cli?.seeds || [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const artifactDir = cli?.out || 'tests/artifacts/replays/journey';
afterEach(() => vi.restoreAllMocks());
function artifact(report) {
  mkdirSync(artifactDir, { recursive: true });
  const file = resolve(artifactDir, `seed-${report.seed}-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  console.log(`Journey ${report.result}: npm run fuzz:journey -- --trace ${file}`);
  return file;
}
describe.skipIf(!!cli?.soakSeconds)('Journey fuzz: legal service journeys and persistence', () => {
  for (const seed of seeds)
    it(`seed ${seed}`, async () => {
      const replay = cli?.trace ? JSON.parse(readFileSync(cli.trace, 'utf8')) : null;
      const report = await runJourney({ seed, maxActions: cli?.maxActions || 600, replay });
      const file = report.failure || cli ? artifact(report) : '';
      if (cli) console.log(JSON.stringify({ seed, coverage: report.coverage }));
      if (report.failure)
        console.log(JSON.stringify({ failure: report.failure, coverage: report.coverage }));
      if (replay) expect(report.reproduced, `Replay mismatch: ${file}`).toBe(true);
      expect(report.failure, `Journey failed; replay ${file}`).toBeNull();
      expect(report.result).toBe('passed');
    }, 30000);
});
if (cli?.soakSeconds)
  it(
    'bounded journey soak (fresh seeds, fail fast)',
    async () => {
      const until = Date.now() + cli.soakSeconds * 1000;
      const summaries = [];
      const seen = new Set();
      do {
        const seed = randomInt(0x100000000);
        if (seen.has(seed)) continue;
        seen.add(seed);
        const report = await runJourney({ seed, maxActions: cli.maxActions });
        summaries.push({
          seed,
          result: report.result,
          coverage: report.coverage,
          heapUsedBytes: process.memoryUsage().heapUsed,
        });
        // Flush the seeds after each case so an interrupted soak is reproducible.
        mkdirSync(artifactDir, { recursive: true });
        writeFileSync(
          resolve(artifactDir, 'soak-summary.json'),
          JSON.stringify(summaries, null, 2) + '\n',
        );
        if (report.failure) {
          const file = artifact(report);
          console.log(JSON.stringify(report.failure));
          expect(report.failure, `Soak failure: ${file}`).toBeNull();
        }
      } while (Date.now() < until);
      console.log(
        `Journey soak: ${summaries.length} seeds passed; ${resolve(artifactDir, 'soak-summary.json')}`,
      );
    },
    cli.soakSeconds * 1000 + 30000,
  );
describe.skipIf(!!cli)('Journey replay integrity', () => {
  it('fresh-seed regression: hired Dancer has Dance before and after reload', async () => {
    const report = await runJourney({ seed: 1308702465 });
    expect(report.failure).toBeNull();
    expect(report.coverage.transactions['arena:hire']).toBeGreaterThan(0);
  });
  it('uses the existing trace, round-trips JSON and replays without invoking a chooser', async () => {
    const first = await runJourney({ seed: 42 });
    expect(first.failure).toBeNull();
    const trace = JSON.parse(JSON.stringify(first));
    const chooser = {
      chooseAction: () => {
        throw new Error('Replay must not choose actions');
      },
    };
    const replay = await runJourney({ seed: 42, replay: trace, agent: chooser });
    expect(replay.reproduced).toBe(true);
    expect(replay.actionTrace).toEqual(trace.actionTrace);
    expect(replay.stateHashes).toEqual(trace.stateHashes);
    expect(replay.coverage).toEqual(trace.coverage);
  });
  it('reproduces a targeted missing shop-leave save with the same failing action and diff', async () => {
    const persist = ShopController.prototype._persistVisit;
    vi.spyOn(ShopController.prototype, '_persistVisit').mockImplementation(function () {
      if (this.scene.shopOverlay) return persist.call(this);
    });
    const first = await runJourney({ seed: 42 });
    expect(first.failure?.invariant).toContain('Journey persistence:');
    expect(first.failure.stateDiff).toBeTruthy();
    const replay = await runJourney({ seed: 42, replay: JSON.parse(JSON.stringify(first)) });
    expect(replay.reproduced).toBe(true);
    expect(replay.failure).toEqual(first.failure);
  });
  it('calibrates the production popup save call and deterministically replays its failure', async () => {
    const persist = BattleScene.prototype._persistBattleRunState;
    vi.spyOn(BattleScene.prototype, '_persistBattleRunState').mockImplementation(function (
      ...args
    ) {
      if (this._pendingActionCompletion) return { ok: true };
      return persist.apply(this, args);
    });
    const report = await runJourney({ seed: 42 });
    expect(report.failure?.invariant).toContain('combat checkpoint units');
    expect(report.actionTrace.at(-1).type).toBe('combat-resolve');
    const replay = await runJourney({ seed: 42, replay: JSON.parse(JSON.stringify(report)) });
    expect(replay.reproduced).toBe(true);
  });
  it('requires both popup routes and repeated post-combat resume in the short tier', async () => {
    const report = await runJourney({ seed: 7 });
    expect(report.failure).toBeNull();
    expect(report.coverage.actions['combat-resolve']).toBe(4);
    expect(report.coverage.actions['combat-suspend-resume']).toBe(4);
    expect(report.coverage.actions['combat-popup-reload']).toBeGreaterThan(0);
    expect(report.coverage.actions['combat-popup-dismiss']).toBeGreaterThan(0);
  });
  it('rejects changed catalog/initial state and stale button targets rather than choosing again', async () => {
    const first = await runJourney({ seed: 42 });
    const changed = structuredClone(first);
    changed.dataHash = 'different-catalog';
    expect((await runJourney({ seed: 42, replay: changed })).failure.invariant).toContain(
      'catalog mismatch',
    );
    const stale = structuredClone(first);
    const action = stale.actionTrace.find((a) => a.type === 'press');
    action.label = 'No longer this target';
    const result = await runJourney({ seed: 42, replay: stale });
    expect(result.reproduced).toBe(false);
    expect(result.failure.invariant).toContain('unavailable action');
    const incomplete = structuredClone(first);
    incomplete.stateHashes.pop();
    await expect(runJourney({ seed: 42, replay: incomplete })).rejects.toThrow(
      'checkpoint sequence',
    );
  });
  it('rejects idle-only action budgets even when every save comparison passes', async () => {
    const report = await runJourney({
      seed: 4,
      maxActions: 8,
      agent: { chooseAction: () => ({ type: 'reload' }) },
    });
    expect(report.failure.invariant).toContain('Journey coverage missing');
    expect(report.coverage.actions.reload).toBe(8);
    expect(() => assertJourneyCoverage(report.coverage)).toThrow('shop:buy');
  });
  it('releases mocked scene/save arguments after every seed, including failures', async () => {
    for (let seed = 1; seed <= 12; seed++) {
      const report = await runJourney({ seed, ...(seed % 2 ? {} : { maxActions: 1 }) });
      expect(report.result).toBe(seed % 2 ? 'passed' : 'failed');
      for (const mock of [showMinorHint, showImportantHint, saveServiceRun]) {
        expect(mock.mock.calls).toHaveLength(0);
        expect(mock.mock.results).toHaveLength(0);
      }
    }
    const scene = journeyBattleScene({}, {});
    expect(vi.isMockFunction(scene.turnManager.unitActed)).toBe(false);
    expect(vi.isMockFunction(scene.turnManager.endPlayerPhase)).toBe(false);
  });
  it('validates CLI seed/action budgets rather than silently falling back to defaults', () => {
    expect(parseJourneyArgs(['--seed', '0', '--max-actions', '20']).seeds).toEqual([0]);
    expect(() => parseJourneyArgs(['--seed', 'oops'])).toThrow('integer');
    expect(() => parseJourneyArgs(['--seeds', '0'])).toThrow('1–1000');
    expect(() => parseJourneyArgs(['--max-actions', 'Infinity'])).toThrow('integer');
    expect(() => parseJourneyArgs(['--unknown'])).toThrow('Unknown');
  });
});
