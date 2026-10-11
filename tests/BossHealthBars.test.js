// A boss with Revival Stones has more than one health bar. Playtest (2026-10): that was
// easy to miss, on the map and in the unit details. Each surface now says how many bars
// are left: "×3" beside HP (unit details, the phone's unit card and forecast, the desktop
// forecast and hover line), "Health bars: 2 of 3" in the details, and the map's boss bar
// shows the next bar through the part of this one already lost.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/ui/serviceSave.js', () => ({ saveServiceRun: vi.fn(() => '') }));

import { healthBars, healthBarsBadge, revivalStonesLine } from '../src/engine/RevivalStones.js';
import { BossPresenceController } from '../src/ui/BossPresenceController.js';
import { MobileRosterSheet } from '../src/ui/MobileRosterSheet.js';
import { RunManager } from '../src/engine/RunManager.js';
import { createRecruitUnit } from '../src/engine/UnitManager.js';
import { UI_HEX } from '../src/utils/uiStyles.js';
import { _resetInputFocus } from '../src/utils/inputFocus.js';
import { installFakeDom } from './helpers/fakeDom.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();

const stoned = (remaining, max) => ({
  name: 'Warchief',
  isBoss: true,
  faction: 'enemy',
  currentHP: 30,
  stats: { HP: 30 },
  ...(max > 0 ? { revivalStones: remaining, revivalStonesMax: max } : {}),
});

describe('health bars of a stoned unit', () => {
  it('counts the bar it is on plus one per stone, out of one plus the stones it began with', () => {
    expect(healthBars(stoned(2, 2))).toEqual({ left: 3, total: 3 });
    expect(healthBars(stoned(1, 2))).toEqual({ left: 2, total: 3 });
    expect(healthBars(stoned(0, 1))).toEqual({ left: 1, total: 2 });
    expect(healthBars(stoned(0, 0))).toBeNull();
    expect(healthBars(null)).toBeNull();
  });

  it('badges HP only while more than one bar is left', () => {
    expect(healthBarsBadge(stoned(2, 2))).toBe('×3');
    expect(healthBarsBadge(stoned(1, 2))).toBe('×2');
    expect(healthBarsBadge(stoned(0, 2))).toBe('');
    expect(healthBarsBadge(stoned(0, 0))).toBe('');
  });

  it('the detail line names bars left of all', () => {
    expect(revivalStonesLine(stoned(1, 1))).toBe('Health bars: 2 of 2');
    expect(revivalStonesLine(stoned(0, 1))).toBe('Health bars: 1 of 2');
    expect(revivalStonesLine(stoned(0, 0))).toBe('');
  });
});

describe("the map's boss bar", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function sceneWith(boss) {
    const made = [];
    const obj = (extra = {}) => {
      const o = {
        x: 0,
        y: 0,
        alpha: 1,
        visible: true,
        active: true,
        setDepth: () => o,
        setVisible: (v) => ((o.visible = v), o),
        setAlpha: (a) => ((o.alpha = a), o),
        setPosition: (x, y) => ((o.x = x), (o.y = y), o),
        destroy() {},
        ...extra,
      };
      return o;
    };
    const graphics = () => {
      const g = obj();
      g.calls = [];
      for (const name of [
        'fillStyle',
        'fillRect',
        'lineStyle',
        'beginPath',
        'moveTo',
        'lineTo',
        'closePath',
        'strokePath',
        'fillPoints',
        'strokePoints',
      ])
        g[name] = (...args) => g.calls.push([name, ...args]);
      g.clear = () => (g.calls = []);
      made.push(g);
      return g;
    };
    Object.assign(boss, {
      battleEntityId: 'u9',
      col: 3,
      row: 4,
      graphic: obj(),
      hpBar: { bg: obj({ x: 112, y: 156 }), fill: obj() },
    });
    return {
      made,
      gameData,
      enemyUnits: [boss],
      antiTurtleState: { turnEnrageActive: false },
      turnPar: 10,
      turnBonusConfig: { latePressure: { bossEnrageTurn: 12, bossEnrageOverPar: 5 } },
      getCurrentTurnNumber: () => 3,
      grid: { fogEnabled: false },
      battleState: 'PLAYER_IDLE',
      registry: { get: () => ({ getReduceMotion: () => true }) },
      events: { on() {}, once() {}, off() {} },
      add: { graphics },
    };
  }

  // The full-width layer in the info colour, laid before the crimson fill.
  const nextBarLayers = (g) =>
    g.calls.filter(
      (c, i) =>
        c[0] === 'fillRect' &&
        c[1] < 0 &&
        c[4] === 4 &&
        g.calls[i - 1]?.[0] === 'fillStyle' &&
        g.calls[i - 1][1] === UI_HEX.info,
    );

  it('shows the next bar under a wounded boss that still holds a stone', () => {
    const boss = stoned(1, 1);
    boss.currentHP = 10;
    const scene = sceneWith(boss);
    const presence = new BossPresenceController(scene).create();
    presence.sync({ silent: true });
    expect(nextBarLayers(scene.made[0])).toHaveLength(1);
    expect(presence.summaryLine()).toContain('Health bars 2/2');
    presence.destroy();
  });

  it('shows none on its last bar, and none for a boss without stones', () => {
    for (const boss of [stoned(0, 1), stoned(0, 0)]) {
      boss.currentHP = 10;
      const scene = sceneWith(boss);
      const presence = new BossPresenceController(scene).create();
      presence.sync({ silent: true });
      expect(nextBarLayers(scene.made[0])).toHaveLength(0);
      presence.destroy();
    }
  });
});

describe("the phone's unit card", () => {
  beforeEach(() => {
    installFakeDom(vi);
    _resetInputFocus();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    _resetInputFocus();
  });

  function render(unit) {
    const run = new RunManager(gameData);
    run.startRun();
    const scene = {
      gameData,
      runManager: run,
      events: { once() {}, on() {}, off() {}, emit() {} },
      registry: { get: () => null },
      textures: { exists: () => false },
      sys: { settings: { key: 'Battle' } },
    };
    const sheet = new MobileRosterSheet({
      scene,
      units: [unit],
      run,
      gameData,
      onClose: vi.fn(),
    });
    sheet.render();
    const badges = sheet.root.querySelectorAll('.mb-hp-bars').map((n) => n.textContent);
    const text = sheet.root.textContent;
    sheet.destroy();
    return { badges, text };
  }

  const fighter = (extra) =>
    Object.assign(
      createRecruitUnit(
        { name: 'Brakka', level: 5 },
        gameData.classes.find((c) => c.name === 'Fighter'),
        gameData.weapons,
      ),
      { faction: 'enemy', isBoss: true },
      extra,
    );

  it('badges a stoned boss beside its HP and names its bars', () => {
    const { badges, text } = render(fighter({ revivalStones: 2, revivalStonesMax: 2 }));
    expect(badges).toEqual(['×3']);
    expect(text).toContain('Health bars: 3 of 3');
  });

  it('shows neither for a boss without stones', () => {
    const { badges, text } = render(fighter({}));
    expect(badges).toEqual([]);
    expect(text).not.toContain('Health bars');
  });
});
