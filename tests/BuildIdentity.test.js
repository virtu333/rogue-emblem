// The build identity a bug report carries (utils/buildIdentity.js, tools/build/buildStamp.mjs).
// Ways it can fail, each caught below:
//   - the stamp names the wrong commit (CI's variable ignored, a branch name taken for a
//     SHA, a full SHA not shortened) or a build without git fails to build;
//   - vite's define never reaches the game (the report says "unknown" on every build);
//   - the native app's version/build is missing, or a bridge that throws or never answers
//     hangs or breaks Settings;
//   - the run line names the wrong difficulty, act or node (the last completed node shown
//     as the battle's, a prologue run named as Act I);
//   - Copy throws where the Clipboard API is refused instead of falling back or saying so.
import { describe, expect, it } from 'vitest';
import { resolveBuildStamp } from '../tools/build/buildStamp.mjs';
import {
  BUILD_STAMP,
  buildPlatformLabel,
  formatBuildReport,
  readNativeAppInfo,
  runContextOf,
} from '../src/utils/buildIdentity.js';
import { copyText } from '../src/utils/copyText.js';
import { RunManager } from '../src/engine/RunManager.js';
import { loadGameData } from './testData.js';

const SHA = '2fd284746137104d86907c299b61ee01f1dea992';
const NOON = new Date('2026-10-12T12:00:00Z');

describe('resolveBuildStamp', () => {
  it("prefers GitHub Actions' SHA, then Netlify's, then the checkout's HEAD", () => {
    const git = () => 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    expect(
      resolveBuildStamp({ env: { GITHUB_SHA: SHA, COMMIT_REF: 'b'.repeat(40) }, git, now: NOON }),
    ).toEqual({ sha: '2fd2847', date: '2026-10-12' });
    expect(resolveBuildStamp({ env: { COMMIT_REF: 'B'.repeat(40) }, git, now: NOON }).sha).toBe(
      'bbbbbbb',
    );
    expect(resolveBuildStamp({ env: {}, git, now: NOON }).sha).toBe('aaaaaaa');
  });

  it('never takes a branch name for a commit, and never throws without git', () => {
    const noGit = () => {
      throw new Error('git missing');
    };
    expect(
      resolveBuildStamp({
        env: { GITHUB_SHA: 'main', COMMIT_REF: 'refs/heads/x' },
        git: () => '',
        now: NOON,
      }).sha,
    ).toBe('unknown');
    expect(resolveBuildStamp({ env: {}, git: noGit, now: NOON }).sha).toBe('unknown');
    expect(
      resolveBuildStamp({ env: {}, git: () => 'fatal: not a git repository', now: NOON }).sha,
    ).toBe('unknown');
  });

  it('the date is the UTC day', () => {
    expect(
      resolveBuildStamp({ env: { GITHUB_SHA: SHA }, now: new Date('2026-10-12T23:30:00-05:00') })
        .date,
    ).toBe('2026-10-13');
  });

  it("vite's define hands the game this checkout's stamp", () => {
    expect(BUILD_STAMP.sha).toBe(resolveBuildStamp().sha);
    expect(BUILD_STAMP.sha).not.toBe('unknown');
  });
});

/** A window with a Capacitor bridge as the iOS/Android apps inject it. */
function nativeWindow(platform, { plugins = ['App'], getInfo } = {}) {
  return {
    Capacitor: {
      isNativePlatform: () => true,
      getPlatform: () => platform,
      PluginHeaders: plugins.map((name) => ({ name })),
      nativePromise: (plugin, method) => {
        if (plugin === 'App' && method === 'getInfo') return getInfo();
        return Promise.reject(new Error('unexpected call'));
      },
    },
  };
}

describe('platform and native app info', () => {
  it('names the app or the web', () => {
    const getInfo = () => Promise.resolve({});
    expect(buildPlatformLabel({ win: nativeWindow('ios', { getInfo }) })).toBe('iOS app');
    expect(buildPlatformLabel({ win: nativeWindow('android', { getInfo }) })).toBe('Android app');
    expect(buildPlatformLabel({ win: {}, mobile: true })).toBe('web (phone)');
    expect(buildPlatformLabel({ win: {}, mobile: false })).toBe('web (desktop)');
  });

  it("reads the app's version and build number", async () => {
    const win = nativeWindow('ios', {
      getInfo: () => Promise.resolve({ version: '0.1.0', build: 37 }),
    });
    expect(await readNativeAppInfo({ win })).toEqual({ version: '0.1.0', build: '37' });
  });

  it('is null on the web, without the App plugin, on an error or when the bridge never answers', async () => {
    expect(await readNativeAppInfo({ win: {} })).toBeNull();
    const info = () => Promise.resolve({ version: '1', build: '2' });
    expect(
      await readNativeAppInfo({ win: nativeWindow('ios', { plugins: [], getInfo: info }) }),
    ).toBeNull();
    const fails = () => Promise.reject(new Error('bridge down'));
    expect(
      await readNativeAppInfo({ win: nativeWindow('android', { getInfo: fails }) }),
    ).toBeNull();
    const hangs = () => new Promise(() => {});
    expect(
      await readNativeAppInfo({ win: nativeWindow('android', { getInfo: hangs }), timeoutMs: 5 }),
    ).toBeNull();
  });
});

describe('the run line', () => {
  const data = loadGameData();
  const freshRun = (difficultyId = 'normal') => {
    const rm = new RunManager(data);
    rm.startRun({ difficultyId });
    return rm;
  };

  it('names the rung by its label and the act, with no node at an act start', () => {
    const run = runContextOf(freshRun('hard'));
    expect(run).toMatchObject({
      difficulty: 'Nightfall',
      act: 'Act I',
      nodeId: null,
      inBattle: false,
    });
    expect(runContextOf(null)).toBeNull();
  });

  it('on the route map names the last completed node; in a battle the node fought and the turn', () => {
    const rm = freshRun();
    const [done, fought] = rm.nodeMap.nodes;
    rm.currentNodeId = done.id;
    expect(runContextOf(rm)).toMatchObject({
      nodeId: done.id,
      nodeType: done.type,
      inBattle: false,
      turn: null,
    });
    rm.battleInProgress = { nodeId: fought.id };
    expect(runContextOf(rm, { turn: 4 })).toMatchObject({
      nodeId: fought.id,
      nodeType: fought.type,
      inBattle: true,
      turn: 4,
    });
  });

  it('a prologue run is named the Prologue', () => {
    const rm = new RunManager(data);
    rm.startPrologue(data);
    expect(runContextOf(rm).act).toBe('Prologue');
  });
});

describe('formatBuildReport', () => {
  const stamp = { sha: '2fd2847', date: '2026-10-12' };

  it('the app build, the commit and where the battle stands, one fact per line', () => {
    const text = formatBuildReport({
      stamp,
      platform: 'iOS app',
      native: { version: '0.1.0', build: '37' },
      run: {
        difficulty: 'Dusk',
        act: 'Act II',
        inBattle: true,
        nodeId: 'act2_3_1',
        nodeType: 'battle',
        turn: 4,
      },
    });
    expect(text.split('\n')).toEqual([
      'Rogue Dawn · iOS app',
      'App: version 0.1.0, build 37',
      'Commit: 2fd2847 (built 2026-10-12)',
      'Run: Dusk · Act II',
      'Battle at: act2_3_1 (battle), turn 4',
    ]);
  });

  it('the web, between battles, and with no run', () => {
    const between = formatBuildReport({
      stamp,
      platform: 'web (phone)',
      run: {
        difficulty: 'First Light',
        act: 'Act I',
        inBattle: false,
        nodeId: 'act1_0_2',
        nodeType: 'shop',
        turn: null,
      },
    });
    expect(between).toBe(
      'Rogue Dawn · web (phone)\nCommit: 2fd2847 (built 2026-10-12)\nRun: First Light · Act I\nLast node: act1_0_2 (shop)',
    );
    expect(formatBuildReport({ stamp, platform: 'web (desktop)' }).split('\n').at(-1)).toBe(
      'Run: none in progress',
    );
  });
});

describe('copyText', () => {
  it('uses the Clipboard API when it is allowed', async () => {
    let copied = null;
    const nav = { clipboard: { writeText: async (t) => (copied = t) } };
    expect(await copyText('build', { nav, doc: null })).toBe(true);
    expect(copied).toBe('build');
  });

  it('falls back to select-and-copy when the API is refused, and reports a refusal of both', async () => {
    const nav = { clipboard: { writeText: () => Promise.reject(new Error('denied')) } };
    const appended = [];
    const doc = {
      body: { append: (el) => appended.push(el) },
      createElement: () => ({
        style: {},
        setAttribute() {},
        select() {},
        remove() {
          appended.pop();
        },
      }),
      execCommand: (cmd) => cmd === 'copy',
    };
    expect(await copyText('build', { nav, doc })).toBe(true);
    expect(appended).toHaveLength(0);
    expect(await copyText('build', { nav, doc: { ...doc, execCommand: () => false } })).toBe(false);
    expect(await copyText('build', { nav: {}, doc: null })).toBe(false);
  });
});
