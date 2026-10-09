// A weapon art's HP cost on the roster surfaces must be what THIS unit pays now.
// Bloodless Art (the run's playerArtHpCostDelta) takes 1 HP off a player unit's art; before this
// fix the roster's "bind a scroll" preview and the Weapon Arts rows of the unit sheet and the
// canvas roster printed the catalog figure while the battle menu charged the discounted one.
//
// Ways this can fail, a test each:
//   1. the bind-art preview (MobileRosterSheet) shows the base cost (no run options passed);
//   2. the unit sheet's art row (UnitDetailOverlay) prints art.hpCost;
//   3. the canvas roster's art row (RosterOverlay) prints art.hpCost;
//   4. the shared suffix helper ignores the unit's own reductions or hides a free art wrongly.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (value, min, max) => Math.min(max, Math.max(min, value)) },
  },
}));
vi.mock('../src/ui/serviceSave.js', () => ({ saveServiceRun: vi.fn(() => '') }));

import { installFakeDom } from './helpers/fakeDom.js';
import { loadGameData } from './testData.js';
import { MobileRosterSheet } from '../src/ui/MobileRosterSheet.js';
import { weaponArtHpSuffix } from '../src/ui/weaponArtDisplay.js';
import { RunManager } from '../src/engine/RunManager.js';
import { createRecruitUnit } from '../src/engine/UnitManager.js';
import { _resetInputFocus } from '../src/utils/inputFocus.js';

const gameData = loadGameData();
const cls = (name) => gameData.classes.find((c) => c.name === name);
const ART = gameData.weaponArts.arts.find((a) => a.id === 'sword_windsweep'); // HP cost 6
const SCROLL = gameData.weapons.find((w) => w.teachesWeaponArtId === ART.id);

let RosterOverlay;
let UnitDetailOverlay;
beforeAll(async () => {
  ({ RosterOverlay } = await import('../src/ui/RosterOverlay.js'));
  ({ UnitDetailOverlay } = await import('../src/ui/UnitDetailOverlay.js'));
});
beforeEach(() => {
  installFakeDom(vi);
  _resetInputFocus();
});
afterEach(() => {
  vi.unstubAllGlobals();
  _resetInputFocus();
});

/** A run holding one Myrmidon with a sword that already carries the art (and a spare scroll). */
function setup({ bloodless = true } = {}) {
  const run = new RunManager(gameData);
  run.startRun();
  if (bloodless) run.blessingRuntimeModifiers.playerArtHpCostDelta = -1;
  const unit = createRecruitUnit(
    { name: 'Daska', level: 10 },
    cls('Myrmidon'),
    gameData.weapons,
    undefined,
  );
  unit.faction = 'player';
  unit.proficiencies = [{ type: 'Sword', rank: 'Mast' }];
  const sword = structuredClone(
    gameData.weapons.find((w) => w.type === 'Sword' && w.tier === 'Iron'),
  );
  sword.uid = 'uid-sword';
  sword.weaponArtIds = [ART.id];
  sword.weaponArtSources = ['scroll'];
  unit.inventory = [sword];
  unit.weapon = sword;
  run.roster = [unit];
  run.scrolls = [structuredClone(SCROLL)];
  return { run, unit, sword };
}

const eventsFor = () => ({ once() {}, on() {}, off() {}, emit() {} });

/** A chainable fake text/rectangle: any Phaser display call returns the object itself. */
function fakeObject(seed = {}) {
  const target = { ...seed, width: 100, height: 12 };
  const self = new Proxy(target, {
    get: (t, key) => (key in t || key === 'then' ? t[key] : () => self),
  });
  return self;
}
function sceneStub(run, texts) {
  const make = fakeObject;
  return {
    gameData,
    runManager: run,
    turnManager: { turnNumber: 1 },
    events: eventsFor(),
    registry: { get: () => null },
    textures: { exists: () => false },
    sys: { settings: { key: 'NodeMap' } },
    add: {
      rectangle: (x, y, width, height) => make({ kind: 'rectangle', x, y, width, height }),
      text: (x, y, text) => {
        texts.push(String(text));
        return make({ kind: 'text', x, y, text });
      },
      image: () => make({ kind: 'image' }),
      graphics: () => make({ kind: 'graphics' }),
    },
    input: { keyboard: { on() {}, off() {} }, on() {}, off() {} },
    time: { delayedCall: () => ({ remove() {} }) },
    cameras: { main: { width: 640, height: 480 } },
  };
}

describe('weaponArtHpSuffix', () => {
  it('prints the cost this unit pays, not the catalog cost', () => {
    const { unit, run } = setup();
    const options = { playerArtHpCostDelta: -1, weaponArtHpCostDelta: 0, playerArtMapUsesBonus: 0 };
    expect(weaponArtHpSuffix(unit, ART, options)).toBe(` HP-${ART.hpCost - 1}`);
    expect(weaponArtHpSuffix(unit, ART, {})).toBe(` HP-${ART.hpCost}`);
    expect(run.blessingRuntimeModifiers.playerArtHpCostDelta).toBe(-1);
  });
  it('is empty for an art that costs nothing', () => {
    const { unit } = setup();
    expect(weaponArtHpSuffix(unit, { ...ART, hpCost: 0 }, {})).toBe('');
  });
});

describe('roster surfaces show the discounted art cost under Bloodless Art', () => {
  const discounted = `HP-${ART.hpCost - 1}`;
  const catalog = `HP-${ART.hpCost}`;

  it('the bind-art preview states the discounted HP cost', () => {
    const { run, unit } = setup();
    const scene = sceneStub(run, []);
    const sheet = new MobileRosterSheet({
      scene,
      units: run.roster,
      run,
      gameData,
      onClose: vi.fn(),
    });
    sheet.bindArt(run.scrolls[0]);
    const preview = sheet.picker.preview(sheet.picker.selected);
    expect(preview).toContain(`HP cost ${ART.hpCost - 1} (base ${ART.hpCost})`);
    expect(preview).not.toContain(`HP cost ${ART.hpCost}\n`);
    expect(unit.inventory).toHaveLength(1);
    sheet.destroy();
  });

  it('the bind-art preview shows the plain cost without the blessing', () => {
    const { run } = setup({ bloodless: false });
    const sheet = new MobileRosterSheet({
      scene: sceneStub(run, []),
      units: run.roster,
      run,
      gameData,
      onClose: vi.fn(),
    });
    sheet.bindArt(run.scrolls[0]);
    const preview = sheet.picker.preview(sheet.picker.selected);
    expect(preview).toContain(`HP cost ${ART.hpCost} ·`);
    expect(preview).not.toContain('base');
    sheet.destroy();
  });

  it('the unit sheet’s Weapon Arts row prints the discounted cost', () => {
    const { run, unit } = setup();
    const texts = [];
    const overlay = new UnitDetailOverlay(sceneStub(run, texts), gameData);
    overlay._unit = unit;
    overlay._drawGearTab(20, 20);
    const row = texts.find((t) => t.startsWith(ART.name));
    expect(row, texts.join('|')).toBeTruthy();
    expect(row).toContain(discounted);
    expect(row).not.toContain(catalog);
  });

  it('the canvas roster’s Weapon Arts row prints the discounted cost', () => {
    const { run, unit } = setup();
    const texts = [];
    const overlay = new RosterOverlay(sceneStub(run, texts), run, {
      lords: gameData.lords || [],
      classes: gameData.classes || [],
      skills: gameData.skills || [],
      accessories: gameData.accessories || [],
      weaponArts: gameData.weaponArts,
    });
    overlay._drawGearTab(20, 20, unit);
    const row = texts.find((t) => t.startsWith(ART.name));
    expect(row, texts.join('|')).toBeTruthy();
    expect(row).toContain(discounted);
    expect(row).not.toContain(catalog);
  });
});
