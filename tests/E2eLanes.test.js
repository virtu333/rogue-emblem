import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CONFIG,
  LANE_ENV,
  SHARD_ENV,
  checkRepository,
  ciMatrix,
  laneCommand,
  mergeDurations,
  parseShard,
  planShards,
  readDurations,
  readLanes,
  specSelection,
  validateDurations,
  validateLanes,
  DEFAULT_SPEC_SECONDS,
} from '../tools/e2eLanes.js';

// A small, valid manifest; each test breaks one thing and expects the checker to say so.
function manifest() {
  return {
    lanes: [
      { name: 'smoke', description: 'Boot', specs: ['boot.spec.js', 'title.spec.js'] },
      {
        name: 'battle',
        description: 'Battle',
        workers: 2,
        shards: 2,
        specs: ['attack.spec.js', 'sub/heal.spec.js'],
      },
      {
        name: 'release',
        description: 'Production build',
        config: 'playwright.release.config.js',
        build: true,
        specs: ['release.spec.js'],
      },
    ],
    excluded: [{ spec: 'manual.spec.js', reason: 'Needs a real device' }],
  };
}
const SPECS = [
  'attack.spec.js',
  'boot.spec.js',
  'manual.spec.js',
  'release.spec.js',
  'sub/heal.spec.js',
  'title.spec.js',
];

describe('validateLanes', () => {
  it('accepts a manifest that places every spec exactly once', () => {
    expect(validateLanes(manifest(), SPECS)).toEqual([]);
  });

  it('fails when a spec file is in no lane and not excluded', () => {
    const errors = validateLanes(manifest(), [...SPECS, 'new-feature.spec.js']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/tests\/e2e\/new-feature\.spec\.js is in no CI lane/);
  });

  it('fails when a lane names a spec that does not exist', () => {
    const m = manifest();
    m.lanes[0].specs.push('renamed-away.spec.js');
    expect(validateLanes(m, SPECS)).toEqual([
      'lane "smoke": names tests/e2e/renamed-away.spec.js, which does not exist',
    ]);
  });

  it('fails when an exclusion names a spec that does not exist', () => {
    const m = manifest();
    m.excluded.push({ spec: 'gone.spec.js', reason: 'old' });
    expect(validateLanes(m, SPECS).join('\n')).toMatch(/gone\.spec\.js, which does not exist/);
  });

  it('fails when a spec is in two lanes, twice in one lane, or both laned and excluded', () => {
    const m = manifest();
    m.lanes[1].specs.push('boot.spec.js');
    m.lanes[0].specs.push('title.spec.js');
    m.excluded.push({ spec: 'attack.spec.js', reason: 'flaky' });
    const errors = validateLanes(m, SPECS).join('\n');
    expect(errors).toMatch(/boot\.spec\.js is in both lane "smoke" and lane "battle"/);
    expect(errors).toMatch(/lane "smoke": lists title\.spec\.js twice/);
    expect(errors).toMatch(/attack\.spec\.js is in both lane "battle" and the exclusion list/);
  });

  it('requires a reason for every exclusion', () => {
    const m = manifest();
    m.excluded[0].reason = '  ';
    expect(validateLanes(m, SPECS)).toEqual(['excluded #1 (manual.spec.js): needs a reason']);
  });

  it('rejects malformed lanes', () => {
    const m = manifest();
    m.lanes.push({ name: 'smoke', description: 'dup', specs: ['x.txt'] });
    m.lanes.push({ name: 'Bad Name', description: '', specs: [] });
    m.lanes.push({
      name: 'odd',
      description: 'odd',
      workers: 0,
      shards: 3,
      build: 'yes',
      retries: 2,
      specs: ['manual.spec.js'],
    });
    m.excluded = [];
    const errors = validateLanes(m, SPECS).join('\n');
    expect(errors).toMatch(/lane "smoke": duplicate lane name/);
    expect(errors).toMatch(/"x\.txt" is not a \*\.spec\.js file name/);
    expect(errors).toMatch(/lane "Bad Name": name must be lower-case kebab-case/);
    expect(errors).toMatch(/lane "Bad Name": needs a description/);
    expect(errors).toMatch(/lane "Bad Name": needs a non-empty "specs" array/);
    expect(errors).toMatch(/lane "odd": workers must be a positive integer/);
    expect(errors).toMatch(/lane "odd": build must be true or false/);
    expect(errors).toMatch(/lane "odd": unknown key "retries"/);
    expect(errors).toMatch(/lane "odd": 3 shards for 1 specs/);
  });

  it('fails when a lane config file does not exist', () => {
    const errors = validateLanes(manifest(), SPECS, {
      fileExists: (file) => file !== 'playwright.release.config.js',
    });
    expect(errors).toEqual(['lane "release": config playwright.release.config.js does not exist']);
  });

  it('fails when package.json or a workflow keeps its own spec list', () => {
    const errors = validateLanes(manifest(), SPECS, {
      sources: [
        { name: 'package.json script "test:e2e:lane"', text: 'node tools/e2eLanes.js run' },
        {
          name: '.github/workflows/ci.yml',
          text: 'run: npx playwright test tests/e2e/boot.spec.js tests/e2e/sub/heal.spec.js',
        },
      ],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(
      /^\.github\/workflows\/ci\.yml names e2e specs directly \(tests\/e2e\/boot\.spec\.js, tests\/e2e\/sub\/heal\.spec\.js\)/,
    );
  });

  it('rejects a manifest without a lanes array', () => {
    expect(validateLanes({}, SPECS)).toEqual([
      'tests/e2e/lanes.json must be an object with a "lanes" array',
    ]);
  });
});

describe('specSelection', () => {
  it('runs exactly the selected lane, with the config that lane names', () => {
    const env = { [LANE_ENV]: 'battle' };
    expect(specSelection(DEFAULT_CONFIG, { manifest: manifest(), env })).toEqual({
      testMatch: ['attack.spec.js', 'sub/heal.spec.js'],
      testIgnore: [],
    });
    // Another config selects nothing for this lane (it may import this one as a base).
    expect(specSelection('playwright.release.config.js', { manifest: manifest(), env })).toEqual({
      testMatch: [],
      testIgnore: [],
    });
    expect(() =>
      specSelection(DEFAULT_CONFIG, { manifest: manifest(), env: { [LANE_ENV]: 'nope' } }),
    ).toThrow(/Unknown e2e lane "nope"/);
  });

  it('without a lane, the default config skips specs owned by other configs', () => {
    expect(specSelection(DEFAULT_CONFIG, { manifest: manifest(), env: {} })).toEqual({
      testIgnore: ['release.spec.js'],
    });
    expect(
      specSelection('playwright.release.config.js', { manifest: manifest(), env: {} }),
    ).toEqual({ testMatch: ['release.spec.js'], testIgnore: [] });
  });
});

describe('ciMatrix and laneCommand', () => {
  it('expands sharded lanes into one CI job per shard', () => {
    expect(ciMatrix(manifest())).toEqual([
      { id: 'smoke', lane: 'smoke', shard: '', build: false },
      { id: 'battle-1of2', lane: 'battle', shard: '1/2', build: false },
      { id: 'battle-2of2', lane: 'battle', shard: '2/2', build: false },
      { id: 'release', lane: 'release', shard: '', build: true },
    ]);
  });

  it('runs Playwright with the lane config, workers and the lane selected by env', () => {
    expect(laneCommand(manifest(), 'battle', ['--shard=1/2'])).toEqual({
      command: 'npx',
      // The shard goes to the config through the env (split by time), never to
      // Playwright's own --shard (split by test count).
      args: ['playwright', 'test', '--config', DEFAULT_CONFIG, '--workers=2'],
      env: { [LANE_ENV]: 'battle', [SHARD_ENV]: '1/2' },
    });
    expect(laneCommand(manifest(), 'smoke').env).toEqual({ [LANE_ENV]: 'smoke' });
    expect(() => laneCommand(manifest(), 'battle', ['--shard=3/2'])).toThrow(/Bad shard/);
    // An explicit --workers from the caller wins over the lane default.
    expect(laneCommand(manifest(), 'battle', ['--workers=1']).args).toEqual([
      'playwright',
      'test',
      '--config',
      DEFAULT_CONFIG,
      '--workers=1',
    ]);
    expect(laneCommand(manifest(), 'release').args).toEqual([
      'playwright',
      'test',
      '--config',
      'playwright.release.config.js',
    ]);
  });
});

describe('the repository', () => {
  it('places every tests/e2e spec in a CI lane or a stated exclusion', () => {
    expect(checkRepository()).toEqual([]);
  });

  it('keeps the production-build specs out of the dev-server config', () => {
    const release = readLanes().lanes.filter((l) => l.config === 'playwright.release.config.js');
    expect(release.length).toBeGreaterThan(0);
    for (const lane of release) expect(lane.build).toBe(true);
    const { testIgnore } = specSelection(DEFAULT_CONFIG, { env: {} });
    for (const lane of release) for (const spec of lane.specs) expect(testIgnore).toContain(spec);
  });
});

describe('shards split by measured time', () => {
  const specs = ['a.spec.js', 'b.spec.js', 'c.spec.js', 'd.spec.js', 'e.spec.js'];

  it('balances the work: longest first, each to the lightest shard', () => {
    // Taken in lane order, d and e would share a shard with a small spec each (310 s and
    // 410 s against 10 s). By time: e | d | a+b+c.
    const durations = { 'a.spec.js': 10, 'b.spec.js': 10, 'c.spec.js': 10 };
    Object.assign(durations, { 'd.spec.js': 300, 'e.spec.js': 400 });
    expect(planShards(specs, 3, durations)).toEqual([
      { specs: ['e.spec.js'], seconds: 400 },
      { specs: ['d.spec.js'], seconds: 300 },
      { specs: ['a.spec.js', 'b.spec.js', 'c.spec.js'], seconds: 30 },
    ]);
  });

  it('puts every spec in exactly one shard, none empty, the same on every call', () => {
    const durations = { 'b.spec.js': 50, 'd.spec.js': 50 };
    for (let total = 1; total <= specs.length; total++) {
      const plan = planShards(specs, total, durations);
      expect(plan).toEqual(
        planShards([...specs].reverse(), total, durations).map((shard) => ({
          ...shard,
          specs: specs.filter((s) => shard.specs.includes(s)),
        })),
      );
      expect(plan.every((shard) => shard.specs.length > 0)).toBe(true);
      expect(plan.flatMap((shard) => shard.specs).sort()).toEqual(specs);
    }
  });

  it('counts an unmeasured spec at the default', () => {
    const plan = planShards(['new.spec.js', 'old.spec.js'], 1, { 'old.spec.js': 5 });
    expect(plan[0].seconds).toBe(5 + DEFAULT_SPEC_SECONDS);
  });

  it("selects the shard's specs from the env", () => {
    const lane = {
      name: 'big',
      description: 'Big',
      shards: 2,
      specs: ['x.spec.js', 'y.spec.js', 'z.spec.js'],
    };
    const durations = () => ({ 'x.spec.js': 100, 'y.spec.js': 60, 'z.spec.js': 50 });
    const select = (shard) =>
      specSelection(DEFAULT_CONFIG, {
        manifest: { lanes: [lane] },
        env: { [LANE_ENV]: 'big', [SHARD_ENV]: shard },
        durations,
      }).testMatch;
    expect(select('1/2')).toEqual(['x.spec.js']);
    expect(select('2/2')).toEqual(['y.spec.js', 'z.spec.js']);
    expect(() => select('1/4')).toThrow(/3 specs for 4 shards/);
  });

  it('parses i/n shards only', () => {
    expect(parseShard('2/6')).toEqual({ index: 2, total: 6 });
    for (const bad of ['0/6', '7/6', '2', '', undefined, 'a/b']) expect(parseShard(bad)).toBe(null);
  });

  it('refreshes durations from reports, keeping unmeasured specs and dropping deleted ones', () => {
    const merged = mergeDurations(
      { 'a.spec.js': 10, 'gone.spec.js': 5, 'b.spec.js': 7 },
      [{ files: { 'a.spec.js': { seconds: 20.4 } } }, { files: { 'c.spec.js': { seconds: 3.6 } } }],
      ['a.spec.js', 'b.spec.js', 'c.spec.js'],
    );
    expect(merged).toEqual({ 'a.spec.js': 20, 'b.spec.js': 7, 'c.spec.js': 4 });
  });

  it('flags durations for specs that do not exist', () => {
    expect(validateDurations({ 'a.spec.js': 1, 'x.spec.js': 2 }, ['a.spec.js'])).toEqual([
      'tests/e2e/durations.json names x.spec.js, which does not exist',
    ]);
    expect(validateDurations({ 'a.spec.js': 'slow' }, ['a.spec.js'])).toHaveLength(1);
  });

  it('has a measurement for most of the real suite', () => {
    const durations = readDurations();
    const measured = readLanes()
      .lanes.flatMap((lane) => lane.specs)
      .filter((s) => s in durations);
    expect(measured.length).toBeGreaterThan(0);
  });
});
