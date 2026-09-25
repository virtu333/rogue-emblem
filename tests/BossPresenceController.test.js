import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeDom } from './helpers/fakeDom.js';
import { loadGameData } from './testData.js';
import { BossPresenceController } from '../src/ui/BossPresenceController.js';

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

function makeScene({ hp = 52, reduceMotion = false, mobile = true } = {}) {
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
  };
  return {
    boss,
    gameData,
    isMobileInput: mobile,
    enemyUnits: [boss, { name: 'Fighter', faction: 'enemy', currentHP: 20, stats: { HP: 20 } }],
    antiTurtleState: { turnEnrageActive: false },
    turnPar: 10,
    turnBonusConfig: { latePressure: { bossEnrageTurn: 12, bossEnrageOverPar: 5 } },
    getCurrentTurnNumber: () => 3,
    grid: { fogEnabled: false },
    battleState: 'PLAYER_IDLE',
    registry: { get: () => ({ getReduceMotion: () => reduceMotion }) },
    events: emitter(),
  };
}

let dom;
beforeEach(() => {
  vi.useFakeTimers();
  dom = installFakeDom(vi);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const bar = () => dom.doc.querySelector('.ce-bossbar');
const pct = (node) => parseFloat(node.style.width);

describe('BossPresenceController', () => {
  it('docks a named crimson bar at the bottom of the map frame', () => {
    const scene = makeScene();
    const presence = new BossPresenceController(scene).create();
    presence.sync({ silent: true });
    const layer = dom.doc.querySelector('.ce-bossbar-layer');
    expect(layer.dataset.frame).toBe('map');
    expect(layer.classList.contains('ce-bossbar-layer--desktop')).toBe(false);
    expect(bar().hidden).toBe(false);
    expect(bar().querySelector('.ce-bossbar-name').textContent).toBe('Dark Rider');
    expect(bar().querySelector('.ce-bossbar-hp').textContent).toBe('52 / 52');
    expect(bar().getAttribute('aria-valuenow')).toBe('52');
    // The status line appears only as enrage nears.
    expect(bar().querySelector('.ce-bossbar-status').hidden).toBe(true);
    presence.destroy();
  });

  it('desktop docks above the in-canvas command row', () => {
    new BossPresenceController(makeScene({ mobile: false })).create();
    expect(
      dom.doc.querySelector('.ce-bossbar-layer').classList.contains('ce-bossbar-layer--desktop'),
    ).toBe(true);
  });

  it('damage shows a gold chunk that drains after a beat', () => {
    const scene = makeScene();
    const presence = new BossPresenceController(scene).create();
    presence.sync({ silent: true });
    scene.boss.currentHP = 26;
    presence.onUnitHp(scene.boss);
    const fill = bar().querySelector('.ce-bossbar-fill');
    const lost = bar().querySelector('.ce-bossbar-lost');
    expect(pct(fill)).toBe(50);
    expect(pct(lost)).toBe(100);
    vi.advanceTimersByTime(460);
    expect(pct(lost)).toBe(50);
    // Other units never move the bar.
    presence.onUnitHp(scene.enemyUnits[1]);
    expect(pct(fill)).toBe(50);
  });

  it('resume / rewind restore silently: no chunk, no entrance motion', () => {
    const scene = makeScene({ hp: 30 });
    const presence = new BossPresenceController(scene).create();
    presence.sync({ silent: true });
    expect(bar().classList.contains('is-entering')).toBe(false);
    expect(bar().classList.contains('is-static')).toBe(true);
    // A rewind to a lower-HP point: straight to the value.
    scene.boss.currentHP = 12;
    presence.sync({ silent: true });
    expect(pct(bar().querySelector('.ce-bossbar-lost'))).toBeCloseTo((12 / 52) * 100);
    // A fresh battle raises it with motion.
    const fresh = makeScene();
    dom.doc.querySelector('.ce-bossbar-layer').remove();
    new BossPresenceController(fresh).create().sync();
    expect(bar().classList.contains('is-entering')).toBe(true);
  });

  it('enrage turns it ember with the turn it began', () => {
    const scene = makeScene();
    const presence = new BossPresenceController(scene).create();
    presence.sync();
    scene.getCurrentTurnNumber = () => 11;
    presence.sync();
    expect(bar().querySelector('.ce-bossbar-status').textContent).toBe('Enrages on turn 12');
    scene.getCurrentTurnNumber = () => 12;
    scene.antiTurtleState.turnEnrageActive = true;
    presence.sync();
    expect(bar().classList.contains('is-ember')).toBe(true);
    expect(bar().querySelector('.ce-bossbar-status').textContent).toBe('Enraged · Turn 12');
    // A rewind to before the enrage undoes it.
    scene.antiTurtleState.turnEnrageActive = false;
    scene.getCurrentTurnNumber = () => 5;
    presence.sync({ silent: true });
    expect(bar().classList.contains('is-ember')).toBe(false);
    expect(bar().querySelector('.ce-bossbar-status').hidden).toBe(true);
  });

  it('the boss dying drains the bar and takes it down; a rewind brings it back', () => {
    const scene = makeScene({ hp: 8 });
    const presence = new BossPresenceController(scene).create();
    presence.sync({ silent: true });
    scene.enemyUnits.shift();
    presence.onBossDefeated();
    expect(pct(bar().querySelector('.ce-bossbar-fill'))).toBe(0);
    vi.advanceTimersByTime(460 + 650 + 950);
    expect(bar().hidden).toBe(true);
    scene.enemyUnits.unshift(scene.boss);
    presence.sync({ silent: true });
    expect(bar().hidden).toBe(false);
    expect(bar().classList.contains('is-leaving')).toBe(false);
  });

  it('holds its last seen reading while fog hides the boss', () => {
    const scene = makeScene();
    const presence = new BossPresenceController(scene).create();
    presence.sync({ silent: true });
    scene.grid = { fogEnabled: true, isVisible: () => false };
    scene.boss.currentHP = 52;
    scene.boss.currentHP = 40;
    presence.sync();
    expect(bar().querySelector('.ce-bossbar-hp').textContent).toBe('52 / 52');
  });

  it('steps aside for canvas panels and paused states', () => {
    const scene = makeScene();
    const presence = new BossPresenceController(scene).create();
    presence.sync({ silent: true });
    scene._forecastOverlay = {};
    scene.events.emit('postupdate');
    expect(bar().classList.contains('is-suppressed')).toBe(true);
    scene._forecastOverlay = null;
    scene.events.emit('postupdate');
    expect(bar().classList.contains('is-suppressed')).toBe(false);
    scene.battleState = 'PAUSED';
    scene.events.emit('postupdate');
    expect(bar().classList.contains('is-suppressed')).toBe(true);
  });

  it('the Entity bar has no name or numbers', () => {
    const scene = makeScene();
    Object.assign(scene.boss, { name: 'The Entity', isEntity: true });
    new BossPresenceController(scene).create().sync({ silent: true });
    expect(bar().querySelector('.ce-bossbar-name').textContent).toBe('· · ·');
    expect(bar().querySelector('.ce-bossbar-hp').textContent).toBe('');
    expect(bar().classList.contains('is-unlight')).toBe(true);
  });

  it('shutdown removes DOM, listeners and timers', () => {
    const scene = makeScene();
    const presence = new BossPresenceController(scene).create();
    presence.sync({ silent: true });
    scene.boss.currentHP = 10;
    presence.onUnitHp(scene.boss);
    expect(scene.events.count('postupdate')).toBe(1);
    scene.events.emit('shutdown');
    expect(dom.doc.querySelector('.ce-bossbar-layer')).toBeNull();
    expect(scene.events.count('postupdate')).toBe(0);
    expect(dom.win.listenerCount('resize')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    presence.sync();
    presence.destroy();
  });

  it('is inert without a DOM host', () => {
    vi.unstubAllGlobals();
    const presence = new BossPresenceController(makeScene()).create();
    expect(() => {
      presence.sync();
      presence.onBossDefeated();
      presence.hide();
      presence.destroy();
    }).not.toThrow();
  });
});
