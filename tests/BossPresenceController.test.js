import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadGameData } from './testData.js';
import { BossPresenceController, BOSS_BAR_DEPTH } from '../src/ui/BossPresenceController.js';

const gameData = loadGameData();

function emitter() {
  const map = new Map();
  const set = (name) => map.get(name) || map.set(name, new Set()).get(name);
  return {
    on: (name, fn) => set(name).add(fn),
    once: (name, fn) => set(name).add(fn),
    off: (name, fn) => set(name).delete(fn),
    emit: (name) => [...set(name)].forEach((fn) => fn()),
    count: (name) => set(name).size,
  };
}

function displayObject(extra = {}) {
  const obj = {
    x: 0,
    y: 0,
    alpha: 1,
    visible: true,
    active: true,
    depth: 0,
    calls: [],
    setDepth(d) {
      obj.depth = d;
      return obj;
    },
    setVisible(v) {
      obj.visible = v;
      return obj;
    },
    setAlpha(a) {
      obj.alpha = a;
      return obj;
    },
    setPosition(x, y) {
      obj.x = x;
      obj.y = y;
      return obj;
    },
    destroy: vi.fn(() => {
      obj.active = false;
    }),
    ...extra,
  };
  return obj;
}

function graphics() {
  const g = displayObject();
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
  ])
    g[name] = (...args) => g.calls.push([name, ...args]);
  g.clear = () => (g.calls = []);
  return g;
}

function makeScene({ hp = 52, reduceMotion = true } = {}) {
  const boss = {
    name: 'Dark Rider',
    className: 'Dark Knight',
    isBoss: true,
    faction: 'enemy',
    battleEntityId: 'u9',
    currentHP: hp,
    stats: { HP: 52 },
    col: 3,
    row: 4,
    graphic: displayObject(),
    hpBar: { bg: displayObject({ x: 112, y: 156 }), fill: displayObject() },
  };
  const made = [];
  return {
    boss,
    made,
    gameData,
    enemyUnits: [boss, { name: 'Fighter', faction: 'enemy', currentHP: 20, stats: { HP: 20 } }],
    antiTurtleState: { turnEnrageActive: false },
    turnPar: 10,
    turnBonusConfig: { latePressure: { bossEnrageTurn: 12, bossEnrageOverPar: 5 } },
    getCurrentTurnNumber: () => 3,
    grid: { fogEnabled: false },
    battleState: 'PLAYER_IDLE',
    registry: { get: () => ({ getReduceMotion: () => reduceMotion }) },
    events: emitter(),
    add: {
      graphics: () => {
        const g = graphics();
        made.push(g);
        return g;
      },
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const fillWidth = (g, w) =>
  g.calls.filter((c) => c[0] === 'fillRect' && c[4] === 4).map((c) => Math.round((c[3] / w) * 100));

describe('BossPresenceController (world bar on the boss)', () => {
  it('rides the boss in place of its ordinary HP bar, above bars and pips', () => {
    const scene = makeScene();
    const presence = new BossPresenceController(scene).create();
    presence.sync({ silent: true });
    const [bar] = scene.made;
    expect(bar.depth).toBe(BOSS_BAR_DEPTH);
    expect(BOSS_BAR_DEPTH).toBeGreaterThan(14);
    expect(bar.visible).toBe(true);
    expect([bar.x, bar.y]).toEqual([112, 157]);
    // The ordinary bar steps aside (alpha only; fog still owns its visibility).
    expect(scene.boss.hpBar.bg.alpha).toBe(0);
    expect(scene.boss.hpBar.fill.alpha).toBe(0);
    expect(presence.summaryLine()).toBe('Dark Rider · 52/52 HP');
    // Moves with the boss's own bar (move tweens drive that one).
    scene.boss.hpBar.bg.setPosition(200, 60);
    scene.events.emit('postupdate');
    expect([bar.x, bar.y]).toEqual([200, 61]);
    presence.destroy();
    expect(scene.boss.hpBar.bg.alpha).toBe(1);
  });

  it('damage shows a gold chunk that drains after a beat; other units never move it', () => {
    const scene = makeScene();
    const presence = new BossPresenceController(scene).create();
    presence.sync({ silent: true });
    scene.boss.currentHP = 26;
    presence.onUnitHp(scene.boss);
    expect(presence.view().fillPct).toBe(50);
    expect(presence.view().lostPct).toBe(100);
    vi.advanceTimersByTime(460);
    expect(presence.view().lostPct).toBe(50);
    presence.onUnitHp(scene.enemyUnits[1]);
    expect(presence.view().fillPct).toBe(50);
    const bar = scene.made[0];
    // One crimson fill at half width; no gold chunk left after the drain.
    expect(fillWidth(bar, 36)).toContain(50);
  });

  it('resume / rewind restore silently: no chunk', () => {
    const scene = makeScene({ hp: 30 });
    const presence = new BossPresenceController(scene).create();
    presence.sync({ silent: true });
    scene.boss.currentHP = 12;
    presence.sync({ silent: true });
    expect(presence.view().lostPct).toBeCloseTo((12 / 52) * 100);
  });

  it('enrage turns the frame ember with a halo; the reading says when', () => {
    const scene = makeScene();
    const presence = new BossPresenceController(scene).create();
    presence.sync();
    scene.getCurrentTurnNumber = () => 11;
    presence.sync();
    expect(presence.summaryLine()).toBe('Dark Rider · 52/52 HP · Enrages on turn 12');
    scene.getCurrentTurnNumber = () => 12;
    scene.antiTurtleState.turnEnrageActive = true;
    presence.sync();
    expect(presence.view().tone).toBe('ember');
    const [, glow] = scene.made;
    expect(glow.visible).toBe(true);
    expect(presence.summaryLine()).toBe('Dark Rider · 52/52 HP · Enraged · Turn 12');
    scene.antiTurtleState.turnEnrageActive = false;
    scene.getCurrentTurnNumber = () => 5;
    presence.sync({ silent: true });
    expect(presence.view().tone).toBe('crimson');
    expect(glow.visible).toBe(false);
  });

  it('the boss dying drains the bar where it stood, then takes it down; a rewind brings it back', () => {
    const scene = makeScene({ hp: 8 });
    const presence = new BossPresenceController(scene).create();
    presence.sync({ silent: true });
    const [bar] = scene.made;
    scene.enemyUnits.shift();
    scene.boss.hpBar = null; // the fallen unit's graphics are gone
    presence.onBossDefeated();
    expect(presence.view().fillPct).toBe(0);
    expect(bar.visible).toBe(true);
    vi.advanceTimersByTime(460 + 650 + 50);
    expect(presence.view().visible).toBe(false);
    expect(bar.visible).toBe(false);
    expect(presence.summaryLine()).toBe('');
    scene.boss.hpBar = { bg: displayObject({ x: 5, y: 6 }), fill: displayObject() };
    scene.enemyUnits.unshift(scene.boss);
    presence.sync({ silent: true });
    expect(bar.visible).toBe(true);
  });

  it('holds its last seen reading while fog hides the boss, and hides with it', () => {
    const scene = makeScene();
    const presence = new BossPresenceController(scene).create();
    presence.sync({ silent: true });
    scene.grid = { fogEnabled: true, isVisible: () => false };
    scene.boss.currentHP = 40;
    scene.boss.graphic.setVisible(false);
    presence.sync();
    expect(presence.view().hpText).toBe('52 / 52');
    expect(scene.made[0].visible).toBe(false);
  });

  it('the Entity bar has no name or numbers and spans its footprint', () => {
    const scene = makeScene();
    Object.assign(scene.boss, { name: 'The Entity', isEntity: true });
    const presence = new BossPresenceController(scene).create();
    presence.sync({ silent: true });
    expect(presence.view().name).toBe('· · ·');
    expect(presence.view().hpText).toBe('');
    expect(presence.view().tone).toBe('unlight');
    expect(presence._width()).toBeGreaterThan(36);
  });

  it('shutdown removes objects, listeners and timers', () => {
    const scene = makeScene();
    const presence = new BossPresenceController(scene).create();
    presence.sync({ silent: true });
    scene.boss.currentHP = 10;
    presence.onUnitHp(scene.boss);
    expect(scene.events.count('postupdate')).toBe(1);
    scene.events.emit('shutdown');
    expect(scene.made.every((g) => g.destroy.mock.calls.length === 1)).toBe(true);
    expect(scene.events.count('postupdate')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    presence.sync();
    presence.destroy();
  });

  it('is inert without a renderer', () => {
    const scene = makeScene();
    delete scene.add;
    const presence = new BossPresenceController(scene).create();
    expect(() => {
      presence.sync();
      presence.onBossDefeated();
      presence.hide();
      presence.destroy();
    }).not.toThrow();
  });
});
