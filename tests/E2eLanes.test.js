import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CONFIG,
  LANE_ENV,
  checkRepository,
  ciMatrix,
  laneCommand,
  readLanes,
  specSelection,
  validateLanes,
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
      args: ['playwright', 'test', '--config', DEFAULT_CONFIG, '--workers=2', '--shard=1/2'],
      env: { [LANE_ENV]: 'battle' },
    });
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
