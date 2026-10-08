import { installSeed, restoreMathRandom } from './SeededRNG.js';
import { MetaBalanceDriver } from './MetaBalanceDriver.js';
import {
  activeEffects,
  makeMeta,
  buyBetweenRuns,
  purchaseCost,
  pairedStats,
} from './MetaBalance.js';

export const OUTCOMES = [
  'win',
  'act1Clear',
  'act2Clear',
  'battles',
  'unitsLost',
  'turns',
  'overParTurns',
  'shadow',
  'valor',
  'supply',
  'recruitDeployments',
  'extraSlotFilled',
];

export async function simulateRun(data, meta, seed, opts = {}) {
  const effects = activeEffects(meta, data, opts.commander, opts.partner);
  const log = { log: console.log, warn: console.warn, info: console.info };
  installSeed(seed);
  Object.keys(log).forEach((k) => {
    console[k] = () => {};
  });
  try {
    const driver = new MetaBalanceDriver(data, {
      metaEffects: effects,
      agent: opts.agent,
      route: opts.route,
      maxBattleActions: opts.maxActions || 2600,
      runOptions: {
        runSeed: seed,
        difficultyId: opts.difficulty || 'normal',
        autoSelectBlessing: false,
      },
    });
    const result = await driver.run();
    const rewards = driver.runManager.previewEndRunRewards(result.result);
    return {
      driver,
      row: {
        seed,
        result: result.result,
        censored: !['victory', 'defeat'].includes(result.result),
        win: Number(result.result === 'victory'),
        act1Clear: Number(result.actIndex >= 1),
        act2Clear: Number(result.actIndex >= 2),
        battles: result.completedBattles,
        act: result.act,
        actIndex: result.actIndex,
        unitsLost: result.exposure.unitDeaths,
        turns: result.metrics.totalTurns,
        overParTurns: result.exposure.overParTurns,
        shadow: result.metrics.eclipseShadowFinal,
        valor: rewards.valor,
        supply: rewards.supply,
        recruitDeployments: result.exposure.recruitDeployments,
        extraSlotFilled: result.exposure.extraSlotFilled,
        exposure: result.exposure,
        gold: result.gold,
        shopSpent: result.metrics.shopGoldSpent,
        churchSpent: result.metrics.churchGoldSpent,
        assignments: structuredClone(meta.skillAssignments),
      },
    };
  } finally {
    Object.assign(console, log);
    restoreMathRandom();
  }
}

export async function auditSeed(data, opts, loadout, variants, seed) {
  const rows = [];
  for (const variant of [{ expression: 'baseline', purchases: loadout.purchases }, ...variants]) {
    const meta = makeMeta(data.metaUpgrades, { ...loadout, purchases: variant.purchases });
    const { row } = await simulateRun(data, meta, seed, opts);
    rows.push({ ...row, variant: variant.expression });
  }
  return rows;
}

export async function campaignSeed(data, opts, schedule, cohortSeed) {
  const meta = makeMeta(data.metaUpgrades);
  const history = [];
  let firstAct1 = null,
    firstWin = null;
  for (let run = 1; run <= opts.runs; run++) {
    // The same cohort/run gets the same seed under every schedule. Purchasing never
    // peeks at it. Separate runs do not continue a variant's consumed random stream.
    const seed = (Math.imul(cohortSeed, 1000003) + run) >>> 0;
    const before = structuredClone(meta.purchasedUpgrades);
    meta.incrementRunsStarted();
    const { row, driver } = await simulateRun(data, meta, seed, opts);
    if (!row.censored) {
      driver.runManager.settleEndRunRewards(meta, row.result);
      if (meta.hasMilestone('beatAct1') && firstAct1 === null) firstAct1 = run;
      if (row.win && firstWin === null) firstWin = run;
    }
    const buys = row.censored ? [] : buyBetweenRuns(meta, opts.buyPolicy, opts.buying);
    history.push({
      ...row,
      run,
      purchasesBefore: before,
      bought: buys,
      purchasesAfter: structuredClone(meta.purchasedUpgrades),
      milestones: meta.getMilestones(),
      balance: { supply: meta.totalSupply, valor: meta.totalValor },
      spent: purchaseCost(data.metaUpgrades, meta.purchasedUpgrades),
    });
    // A harness timeout is not a player loss and earns no currency. Stop the cohort.
    if (row.censored) break;
  }
  return {
    seed: cohortSeed,
    schedule,
    firstAct1,
    firstWin,
    history,
    censored: history.at(-1)?.censored || false,
  };
}

export function mean(rows, key) {
  return rows.length ? rows.reduce((s, r) => s + r[key], 0) / rows.length : null;
}

export function summarizeAudit(rows, variants, starters = []) {
  const base = rows.filter((r) => r.variant === 'baseline').sort((a, b) => a.seed - b.seed);
  return variants.map((v) => {
    const treatment = rows
      .filter((r) => r.variant === v.expression)
      .sort((a, b) => a.seed - b.seed);
    const pairs = treatment.map((r, i) => ({ r, b: base[i] }));
    if (pairs.some(({ r, b }) => !b || r.seed !== b.seed)) throw new Error('Audit seed mismatch.');
    const valid = pairs.filter(({ r, b }) => !r.censored && !b.censored);
    const measured = valid.map(({ r }) => r),
      baseline = valid.map(({ b }) => b);
    const recruitDependent = v.changes.some(
      ({ id }) =>
        id.startsWith('recruit_') ||
        [
          'veteran_recruits',
          'lethal_armory',
          'lethal_armory_killer',
          'lethal_armory_silver',
          'master_of_arms',
        ].includes(id),
    );
    const growthOnly = v.changes.every(({ id }) => id.endsWith('_growth'));
    const exposed = valid.some(({ r, b }) =>
      growthOnly
        ? r.recruitDeployments + b.recruitDeployments > 0
        : r.exposure.ordinaryRecruitDeployments + b.exposure.ordinaryRecruitDeployments > 0,
    );
    const slotUnused =
      v.changes.some(({ id }) => id === 'deploy_limit') &&
      !valid.some(({ r }) => r.extraSlotFilled > 0);
    const unusedComponents = [
      ...(recruitDependent && !exposed ? ['No eligible recruit deployed.'] : []),
      ...(slotUnused ? ['The extra deployment slot was never filled.'] : []),
    ];
    const status = v.gaps.length
      ? 'unmeasured'
      : !valid.length
        ? 'censored'
        : unusedComponents.length
          ? 'partially_exercised'
          : 'measured_with_policy_limits';
    const deltas = Object.fromEntries(
      OUTCOMES.map((k) => [k, valid.length ? pairedStats(baseline, measured, k) : null]),
    );
    // Mixed-currency bundles get no invented exchange rate. Ratios are screening
    // diagnostics only, not a ranking of unsupported effects or an optimizer objective.
    const currencies = Object.entries(v.costs).filter(([, n]) => n > 0);
    const efficiency =
      status.startsWith('measured') && currencies.length === 1
        ? {
            currency: currencies[0][0],
            battlesPer100: (deltas.battles.mean * 100) / currencies[0][1],
            winPercentagePointsPer100: (deltas.win.mean * 10000) / currencies[0][1],
          }
        : null;
    return {
      ...v,
      starterException: v.changes.every(({ id }) => starters.includes(id)),
      status,
      unusedComponents,
      exposureSummary: {
        pairsWithOrdinaryRecruits: valid.filter(
          ({ r, b }) =>
            r.exposure.ordinaryRecruitDeployments + b.exposure.ordinaryRecruitDeployments > 0,
        ).length,
        pairsFillingExtraSlot: valid.filter(({ r }) => r.extraSlotFilled > 0).length,
        baselineRecruitDeployments: mean(baseline, 'recruitDeployments'),
        treatmentRecruitDeployments: mean(measured, 'recruitDeployments'),
      },
      eligiblePairs: valid.length,
      censoredPairs: pairs.length - valid.length,
      baselineWinRate: mean(baseline, 'win'),
      treatmentWinRate: mean(measured, 'win'),
      baselineBattles: mean(baseline, 'battles'),
      treatmentBattles: mean(measured, 'battles'),
      baselineOutcomes: Object.fromEntries(OUTCOMES.map((key) => [key, mean(baseline, key)])),
      treatmentOutcomes: Object.fromEntries(OUTCOMES.map((key) => [key, mean(measured, key)])),
      deltas,
      efficiency,
    };
  });
}

export function portfolioComparisons(rows, variants) {
  const first = variants[0];
  if (!first) return [];
  const remapped = rows
    .filter((r) => r.variant !== 'baseline')
    .map((r) => ({ ...r, variant: r.variant === first.expression ? 'baseline' : r.variant }));
  return summarizeAudit(remapped, variants.slice(1)).map((s) => ({
    baseline: first.expression,
    portfolio: s.expression,
    eligiblePairs: s.eligiblePairs,
    censoredPairs: s.censoredPairs,
    deltas: s.deltas,
  }));
}

export function summarizeCampaign(cohorts, schedules, runs) {
  return schedules.map((schedule) => {
    const group = cohorts.filter((c) => c.schedule === schedule);
    const at = (run) => group.map((c) => c.history[run - 1]).filter((r) => r && !r.censored);
    return {
      schedule,
      cohorts: group.length,
      censoredCohorts: group.filter((c) => c.censored).length,
      act1ReachedByEnd: group.filter((c) => c.firstAct1 !== null).length,
      victoriesByEnd: group.filter((c) => c.firstWin !== null).length,
      // Successful-cohort median must be reported with the success denominator.
      firstAct1Runs: group.map((c) => c.firstAct1),
      firstVictoryRuns: group.map((c) => c.firstWin),
      checkpoints: [...new Set([1, 3, 5, 10, 20, runs])]
        .filter((r) => r <= runs)
        .sort((a, b) => a - b)
        .map((run) => {
          const rs = at(run);
          return {
            run,
            observed: rs.length,
            winRate: mean(rs, 'win'),
            battles: mean(rs, 'battles'),
            supplyBalance: mean(
              rs.map((r) => r.balance),
              'supply',
            ),
            valorBalance: mean(
              rs.map((r) => r.balance),
              'valor',
            ),
            supplySpent: mean(
              rs.map((r) => r.spent),
              'supply',
            ),
            valorSpent: mean(
              rs.map((r) => r.spent),
              'valor',
            ),
            // Levels describe ownership independently of the schedule's changing prices.
            meanOwnedTiers: rs.length
              ? rs.reduce(
                  (n, r) => n + Object.values(r.purchasesBefore).reduce((a, b) => a + b, 0),
                  0,
                ) / rs.length
              : null,
          };
        }),
    };
  });
}

export function campaignComparisons(cohorts, schedules) {
  const baseline = cohorts
    .filter((c) => c.schedule === schedules[0])
    .sort((a, b) => a.seed - b.seed);
  return schedules.slice(1).map((schedule) => {
    const rows = cohorts.filter((c) => c.schedule === schedule).sort((a, b) => a.seed - b.seed);
    const pairs = rows.map((r, i) => ({ r, b: baseline[i] }));
    if (pairs.some(({ r, b }) => !b || r.seed !== b.seed))
      throw new Error('Campaign seed mismatch.');
    const valid = pairs.filter(({ r, b }) => !r.censored && !b.censored);
    const project = (c) => ({
      seed: c.seed,
      wins: c.history.reduce((n, r) => n + r.win, 0),
      battles: c.history.reduce((n, r) => n + r.battles, 0),
      act1ByEnd: Number(c.firstAct1 !== null),
      victoryByEnd: Number(c.firstWin !== null),
      supplyBalance: c.history.at(-1).balance.supply,
      valorBalance: c.history.at(-1).balance.valor,
    });
    const bs = valid.map(({ b }) => project(b)),
      rs = valid.map(({ r }) => project(r));
    return {
      baseline: schedules[0],
      schedule,
      eligiblePairs: valid.length,
      censoredPairs: pairs.length - valid.length,
      deltas: Object.fromEntries(
        ['wins', 'battles', 'act1ByEnd', 'victoryByEnd', 'supplyBalance', 'valorBalance'].map(
          (key) => [key, valid.length ? pairedStats(bs, rs, key) : null],
        ),
      ),
    };
  });
}
