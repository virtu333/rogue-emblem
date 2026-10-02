#!/usr/bin/env node
// npm run sim:meta-balance -- --help
import { fork, execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { loadGameData } from '../tests/testData.js';
import {
  PROFILES,
  UNMEASURED,
  BUY_ORDERS,
  buildVariant,
  makeMeta,
  buyBetweenRuns,
  purchaseCost,
  priceSchedule,
} from './lib/MetaBalance.js';
import { ROUTES } from './lib/MetaBalanceDriver.js';
import {
  auditSeed,
  campaignSeed,
  summarizeAudit,
  summarizeCampaign,
  campaignComparisons,
  portfolioComparisons,
} from './lib/MetaBalanceExperiment.js';

const DEFAULT_VARIANTS = [
  'extra_starting_unit_pool',
  'deploy_limit',
  'recruit_skill',
  'recruit_accessory',
  'veteran_recruits',
  'recruit_spd_growth',
  'recruit_def_growth',
  'lord_spd_growth',
  'lord_def_growth',
  'weapon_tier',
  'extra_starting_unit_pool+deploy_limit',
];
export function parseOptions(args) {
  const opts = {
    mode: 'audit',
    seeds: 100,
    seedStart: 1,
    workers: 4,
    difficulty: 'normal',
    agent: 'rescue',
    route: 'recruit',
    profile: 'act1',
    variants: DEFAULT_VARIANTS,
    runs: 20,
    fractions: [0.5, 0.65, 0.8, 1],
    deployCosts: [150],
    buyPolicy: 'battalion',
    buying: 'save',
    commander: 'Edric',
    partner: 'Sera',
    maxActions: 2600,
    starters: [],
    supplyBudget: 800,
    valorBudget: 800,
    loadout: null,
    out: null,
    rawOut: null,
    help: false,
  };
  const numbers = {
    '--seeds': 'seeds',
    '--seed-start': 'seedStart',
    '--workers': 'workers',
    '--runs': 'runs',
    '--max-actions': 'maxActions',
    '--supply-budget': 'supplyBudget',
    '--valor-budget': 'valorBudget',
  };
  const strings = {
    '--mode': 'mode',
    '--difficulty': 'difficulty',
    '--agent': 'agent',
    '--route': 'route',
    '--profile': 'profile',
    '--buy-policy': 'buyPolicy',
    '--buying': 'buying',
    '--commander': 'commander',
    '--partner': 'partner',
    '--loadout': 'loadout',
    '--out': 'out',
    '--raw-out': 'rawOut',
  };
  const lists = {
    '--variants': 'variants',
    '--fractions': 'fractions',
    '--deploy-costs': 'deployCosts',
    '--starter-ids': 'starters',
  };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--help') {
      opts.help = true;
      continue;
    }
    if (!numbers[flag] && !strings[flag] && !lists[flag])
      throw new Error(`Unknown argument: ${flag}`);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (numbers[flag]) opts[numbers[flag]] = Number(value);
    else if (strings[flag]) opts[strings[flag]] = value;
    else
      opts[lists[flag]] = value
        .split(',')
        .map((v) => (['fractions', 'deployCosts'].includes(lists[flag]) ? Number(v) : v));
  }
  for (const key of Object.values(numbers))
    if (!Number.isInteger(opts[key]) || opts[key] < (key.endsWith('Budget') ? 0 : 1))
      throw new Error(`Invalid ${key}`);
  if (opts.seedStart + opts.seeds > 0xffffffff) throw new Error('Seed range exceeds uint32.');
  if (!['audit', 'campaign', 'portfolios'].includes(opts.mode)) throw new Error('Invalid mode.');
  if (!['normal', 'dusk', 'hard', 'lunatic'].includes(opts.difficulty))
    throw new Error('Invalid difficulty.');
  if (!['rescue', 'scripted', 'tactician'].includes(opts.agent)) throw new Error('Invalid agent.');
  if (!['save', 'affordable'].includes(opts.buying)) throw new Error('Invalid buying mode.');
  if (!ROUTES[opts.route] || !PROFILES[opts.profile] || !BUY_ORDERS[opts.buyPolicy])
    throw new Error('Invalid route, profile, or buy policy.');
  if (opts.commander === opts.partner) throw new Error('Starting lords must differ.');
  if (
    opts.fractions.some((n) => !Number.isFinite(n) || n <= 0) ||
    opts.deployCosts.some((n) => !Number.isInteger(n) || n <= 0)
  )
    throw new Error('Invalid price schedule.');
  if (!opts.fractions.length || !opts.deployCosts.length || !opts.variants.length)
    throw new Error('Empty list.');
  return opts;
}

function buildPlan(data, opts) {
  const lordNames = data.lords.map((l) => l.name);
  if (![opts.commander, opts.partner].every((n) => lordNames.includes(n)))
    throw new Error('Unknown starting lord.');
  if (opts.starters.some((id) => !data.metaUpgrades.some((u) => u.id === id)))
    throw new Error('Unknown starter exception.');
  if (opts.mode === 'campaign' && opts.loadout)
    throw new Error('Campaigns start fresh; --loadout is for audits/portfolios.');
  const loadout =
    opts.mode === 'campaign'
      ? structuredClone(PROFILES.fresh)
      : opts.loadout
        ? JSON.parse(readFileSync(opts.loadout, 'utf8'))
        : structuredClone(PROFILES[opts.profile]);
  makeMeta(data.metaUpgrades, loadout);
  const skipped = [],
    variants = [];
  if (opts.mode === 'portfolios') {
    for (const policy of Object.keys(BUY_ORDERS)) {
      const meta = makeMeta(data.metaUpgrades, loadout);
      meta.totalSupply = opts.supplyBudget;
      meta.totalValor = opts.valorBudget;
      buyBetweenRuns(meta, policy, opts.buying);
      const before = purchaseCost(data.metaUpgrades, loadout.purchases);
      const after = purchaseCost(data.metaUpgrades, meta.purchasedUpgrades);
      variants.push({
        expression: policy,
        purchases: meta.purchasedUpgrades,
        changes: Object.entries(meta.purchasedUpgrades)
          .filter(([id, n]) => n !== (loadout.purchases[id] || 0))
          .map(([id, to]) => ({ id, from: loadout.purchases[id] || 0, to })),
        gaps: [],
        costs: { supply: after.supply - before.supply, valor: after.valor - before.valor },
        unusedBudget: { supply: meta.totalSupply, valor: meta.totalValor },
      });
    }
  } else if (opts.mode === 'audit') {
    for (const expression of [...new Set(opts.variants)]) {
      // Typos/invalid targets fail loudly; legitimate milestone locks/maxed tracks are recorded.
      const tokens = expression.split('+');
      if (tokens.some((t) => !data.metaUpgrades.some((u) => u.id === t.split('=')[0])))
        throw new Error(`Unknown variant: ${expression}`);
      if (
        tokens.some(
          (t) =>
            t.split('=').length > 2 ||
            (t.includes('=') &&
              (!Number.isInteger(Number(t.split('=')[1])) || Number(t.split('=')[1]) < 1)),
        )
      )
        throw new Error(`Invalid variant: ${expression}`);
      try {
        const variant = buildVariant(data.metaUpgrades, loadout, expression);
        if (variant.gaps.length)
          skipped.push({ expression, status: 'unmeasured', reason: variant.gaps.join('; ') });
        else variants.push(variant);
      } catch (err) {
        if (!/Milestone locked|Invalid target tier|must increase/.test(err.message)) throw err;
        skipped.push({ expression, status: 'unavailable', reason: err.message });
      }
    }
  }
  const schedules = [...new Set(opts.fractions)].flatMap((fraction) =>
    [...new Set(opts.deployCosts)].map((deployCost) => ({
      fraction,
      deployCost,
      name: `battalion_${fraction}_deploy_${deployCost}`,
    })),
  );
  return { loadout, variants, skipped, schedules };
}

async function runChunk(opts, plan, seeds) {
  const data = loadGameData();
  const rows = [];
  for (const seed of seeds) {
    if (opts.mode === 'campaign') {
      for (const schedule of plan.schedules) {
        const pricedData = {
          ...data,
          metaUpgrades: priceSchedule(data.metaUpgrades, schedule.fraction, schedule.deployCost),
        };
        rows.push(await campaignSeed(pricedData, opts, schedule.name, seed));
      }
    } else rows.push(...(await auditSeed(data, opts, plan.loadout, plan.variants, seed)));
    process.send?.({ progress: seed });
  }
  return rows;
}

function worker(opts, plan, seeds) {
  return new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), ['--child'], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    let done = false;
    child.on('message', (msg) => {
      if (msg.progress !== undefined) return;
      done = true;
      child.disconnect();
      if (msg.error) reject(new Error(msg.error));
      else resolve(msg.rows);
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (!done) reject(new Error(`Simulation worker exited early (${code ?? signal}).`));
    });
    child.send({ opts, plan, seeds });
  });
}

export async function runExperiment(opts) {
  const data = loadGameData();
  const plan = buildPlan(data, opts);
  const seeds = Array.from({ length: opts.seeds }, (_, i) => opts.seedStart + i);
  const chunks = Array.from({ length: Math.min(opts.workers, opts.seeds) }, (_, w) =>
    seeds.filter((_, i) => i % Math.min(opts.workers, opts.seeds) === w),
  );
  const rows = (await Promise.all(chunks.map((chunk) => worker(opts, plan, chunk)))).flat();
  const names = plan.schedules.map((s) => s.name);
  let sourceCommit = 'unknown';
  try {
    sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    /* exported source */
  }
  return {
    schemaVersion: 1,
    sourceCommit,
    options: opts,
    plan,
    coverage: Object.fromEntries(
      data.metaUpgrades.map((u) => [
        u.id,
        UNMEASURED[u.id]
          ? { status: 'unmeasured', reason: UNMEASURED[u.id] }
          : { status: 'modeled_with_policy_limits' },
      ]),
    ),
    limitations: [
      'Seed pairing shares initial seeds, not identical subsequent events: upgrades can change RNG consumption and routes.',
      'No consumable use, weapon-art decisions, rewinds, reclassing, caravan trades, colosseum transactions, or loot-equipment use.',
      'Gold/team-XP or skip reward policy; church-only promotion; lords-first deployment; limited weapon switching; no skill bench decisions.',
      'Tactician uses the simple rescue agent on seize/escape; rescue/scripted agents charge enemies.',
      'No blessings selected. Results condition on fixed difficulty/pair/routing and saving or opportunistic buying; difficulty unlock progression is not modeled.',
      'Timeout/stuck cohorts are censored, not defeats, and receive no payout; report their counts before interpreting complete pairs.',
      'Normal approximate paired intervals are screening diagnostics; zero discordant pairs do not establish equivalence.',
      'Starter exemptions are owner-supplied labels, not inferred recommendations. No production prices change.',
    ],
    summary:
      opts.mode === 'campaign'
        ? summarizeCampaign(rows, names, opts.runs)
        : summarizeAudit(rows, plan.variants, opts.starters),
    comparisons:
      opts.mode === 'campaign'
        ? campaignComparisons(rows, names)
        : opts.mode === 'portfolios'
          ? portfolioComparisons(rows, plan.variants)
          : null,
    rows: rows.sort(
      (a, b) => a.seed - b.seed || (a.variant || a.schedule).localeCompare(b.variant || b.schedule),
    ),
  };
}

function printReport(report) {
  console.log(
    `Meta balance ${report.options.mode}: ${report.options.seeds} seeds, ${report.options.agent}, ${report.options.difficulty}, route=${report.options.route}`,
  );
  if (report.options.mode === 'campaign') {
    console.table(
      report.summary.map((s) => ({
        schedule: s.schedule,
        cohorts: s.cohorts,
        censored: s.censoredCohorts,
        act1: s.act1ReachedByEnd,
        wins: s.victoriesByEnd,
        finalBattles: s.checkpoints.at(-1).battles?.toFixed(2),
        tiers: s.checkpoints.at(-1).meanOwnedTiers?.toFixed(1),
      })),
    );
  } else {
    console.table(
      report.summary.map((s) => ({
        variant: s.expression,
        status: s.status,
        supply: s.costs.supply,
        valor: s.costs.valor,
        pairs: s.eligiblePairs,
        censored: s.censoredPairs,
        dBattles: s.deltas.battles?.mean.toFixed(3),
        se: s.deltas.battles?.se?.toFixed(3),
        dWinPP: s.deltas.win ? (100 * s.deltas.win.mean).toFixed(2) : null,
      })),
    );
    for (const s of report.plan.skipped) console.log(`${s.expression}: ${s.status} (${s.reason})`);
  }
}

if (process.argv.includes('--child')) {
  process.once('message', async ({ opts, plan, seeds }) => {
    try {
      process.send({ rows: await runChunk(opts, plan, seeds) });
    } catch (err) {
      process.send({ error: err.stack || String(err) });
    }
  });
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const opts = parseOptions(process.argv.slice(2));
  if (opts.help) {
    console.log(`Usage: node sim/metaBalance.js [--mode audit|campaign|portfolios]
  --seeds 100 --seed-start 1 --workers 4 --difficulty normal|dusk|hard|lunatic
  --agent rescue|scripted|tactician --route recruit|battle|services
  Audit: --profile fresh|act1|mid|late --variants id,id=2,id+other --loadout file.json
  Campaign: --runs 20 --fractions 0.5,0.65,0.8,1 --deploy-costs 150,250,500
            --buy-policy battalion|stats|economy --buying save|affordable (fresh profiles)
  Portfolios: --profile act1 --supply-budget 800 --valor-budget 800
  --commander Edric --partner Sera --max-actions 2600 --starter-ids id,id --out report.json
  --raw-out rows.json.gz (optional compressed raw rows; --out then contains summary only)`);
  } else {
    runExperiment(opts)
      .then((report) => {
        if (opts.rawOut) {
          mkdirSync(dirname(opts.rawOut), { recursive: true });
          writeFileSync(
            opts.rawOut,
            gzipSync(
              JSON.stringify({
                schemaVersion: report.schemaVersion,
                sourceCommit: report.sourceCommit,
                options: report.options,
                rows: report.rows,
              }),
            ),
          );
        }
        if (opts.out) {
          mkdirSync(dirname(opts.out), { recursive: true });
          const output = opts.rawOut
            ? { ...report, rows: undefined, rowCount: report.rows.length, rawArtifact: opts.rawOut }
            : report;
          writeFileSync(opts.out, JSON.stringify(output, null, 2) + '\n');
        }
        printReport(report);
      })
      .catch((err) => {
        console.error(err);
        process.exitCode = 1;
      });
  }
}
