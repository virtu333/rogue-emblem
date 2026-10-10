// A foe's status staff (Sleep / Silence) rides `unit.statusStaff`, beside its weapon and
// outside its inventory. A playtester saw the Danger zone's violet outline after the Sleep
// Staff was spent and could not find which foe still held a staff: a Silence Staff (2 uses)
// on another caster, one use left. Ways this can fail, one test each:
//   * a resume after the cast refills the staff (the checkpoint drops `_usesSpent`), or a
//     rewind to before it leaves the staff spent;
//   * a battle fields two casters only where its rung allows two (Black Sun), and a
//     reinforcement brings a staff in (waves never carry one);
//   * a surface that lists a foe's gear leaves the staff out, keeps "0/1 uses" for a spent
//     one, or shows a fogged caster's;
//   * the map pip shows for a spent staff or a caster in fog, or stays after the cast.
// Expected lines are written out by hand.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { Grid } from '../src/engine/Grid.js';
import { captureBattleState } from '../src/ui/BattleCheckpointAdapter.js';
import { BattleSuspendController } from '../src/ui/BattleSuspendController.js';
import { serializeBattleUnit, restoreEquippedReference } from '../src/engine/BattleUnitState.js';
import { registerBattleEntity, resetBattleIdentities } from '../src/engine/BattleEntityIdentity.js';
import { validateBattleState } from '../src/engine/BattleStateSnapshot.js';
import {
  statusStaffInfo,
  statusStaffPipShown,
  statusStaffThreat,
} from '../src/engine/BattleInformation.js';
import { spendStaffUse } from '../src/engine/Combat.js';
import { assignCasterGear, mulberry32 } from '../src/engine/CasterGear.js';
import { buildReinforcementSpawnSpec } from '../src/engine/ReinforcementSpawns.js';
import { statusStaffGearLine } from '../src/ui/MobileBattleHUD.js';
import { UnitDetailOverlay } from '../src/ui/UnitDetailOverlay.js';
import { UI_PALETTE } from '../src/utils/uiStyles.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const catalog = (name) => structuredClone(gameData.weapons.find((w) => w.name === name));
const T = Object.fromEntries(gameData.terrain.map((t, i) => [t.name, i]));

function caster(name, col, row, staffName, extra = {}) {
  return {
    name,
    className: 'Mage',
    faction: 'enemy',
    col,
    row,
    currentHP: 18,
    stats: { HP: 18, STR: 1, MAG: 8, SKL: 6, SPD: 6, LCK: 3, DEF: 2, RES: 5, MOV: 5 },
    mov: 5,
    moveType: 'Infantry',
    proficiencies: [{ type: 'Tome', rank: 'Prof' }],
    inventory: [catalog('Wildfire')],
    consumables: [],
    weapon: null,
    statusStaff: staffName ? catalog(staffName) : undefined,
    ...extra,
  };
}
function hero() {
  return {
    name: 'Edric',
    className: 'Lord',
    faction: 'player',
    col: 1,
    row: 1,
    currentHP: 20,
    stats: { HP: 20, STR: 7, MAG: 1, SKL: 7, SPD: 8, LCK: 6, DEF: 6, RES: 2, MOV: 5 },
    proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    inventory: [catalog('Iron Sword')],
    consumables: [],
    weapon: null,
    _conditions: [],
  };
}
const armed = (u) => ((u.weapon = u.inventory[0]), u);

describe('a spent staff stays spent across a resume; a rewind before the cast refills it', () => {
  function checkpointScene({ players = [], enemies = [] } = {}) {
    const scene = {
      _battleSession: 1,
      playerUnits: [],
      enemyUnits: [],
      npcUnits: [],
      escapedUnits: [],
      nonDeployedUnits: [],
      battleState: 'PLAYER_IDLE',
      turnManager: { currentPhase: 'player', turnNumber: 2 },
      grid: {
        mapLayout: Array.from({ length: 10 }, () => Array(12).fill(0)),
        temporaryTerrains: [],
      },
      runManager: {
        convoy: { weapons: [], consumables: [] },
        accessories: [],
        gold: 0,
        visionChargesRemaining: 2,
      },
      addUnitGraphic() {},
      dimUnit() {},
      gameData: {},
    };
    resetBattleIdentities(scene);
    for (const u of players) (scene.playerUnits.push(u), registerBattleEntity(scene, u));
    for (const u of enemies) (scene.enemyUnits.push(u), registerBattleEntity(scene, u));
    return scene;
  }

  it('the checkpoint after a Sleep Staff cast restores it with no use left and no reach', () => {
    const mage = armed(caster('Mage', 6, 4, 'Sleep Staff'));
    spendStaffUse(mage.statusStaff); // executeEnemyStatusStaff's spend
    expect(statusStaffThreat(mage)).toBeNull();
    const scene = checkpointScene({ players: [armed(hero())], enemies: [mage] });
    // The suspend checkpoint crosses a JSON boundary (localStorage).
    const state = JSON.parse(JSON.stringify(captureBattleState(scene, { rngSeed: 7 })));
    expect(validateBattleState(state)).toBe(true);
    const restored = checkpointScene();
    new BattleSuspendController(restored).applyUnits(state);
    const back = restored.enemyUnits[0];
    expect(back.statusStaff).toMatchObject({ name: 'Sleep Staff', uses: 1, _usesSpent: 1 });
    expect(statusStaffThreat(back)).toBeNull();
    expect(statusStaffInfo(back).text).toBe('Sleep Staff · Range 3-5 · spent');
  });

  it('a Silence Staff cast once keeps its last use (and its reach) across the resume', () => {
    const sage = armed(caster('Sage', 8, 2, 'Silence Staff'));
    spendStaffUse(sage.statusStaff);
    const scene = checkpointScene({ players: [armed(hero())], enemies: [sage] });
    const state = JSON.parse(JSON.stringify(captureBattleState(scene, { rngSeed: 7 })));
    const restored = checkpointScene();
    new BattleSuspendController(restored).applyUnits(state);
    expect(statusStaffThreat(restored.enemyUnits[0])).toMatchObject({ uses: 1, min: 3, max: 7 });
  });

  it('a Vision snapshot taken before the cast brings the unspent staff back', () => {
    const mage = armed(caster('Mage', 6, 4, 'Sleep Staff'));
    const snapshot = serializeBattleUnit(mage); // what VisionRewindController keeps
    spendStaffUse(mage.statusStaff);
    const restored = structuredClone(snapshot);
    restoreEquippedReference(restored);
    expect(statusStaffThreat(restored)).toMatchObject({ uses: 1, min: 3, max: 5 });
  });
});

describe('how many casters a battle fields', () => {
  // Garrisons of two Mages, two Sages and two non-casters at scattered tiles; each one is
  // its own roll stream (CasterGear hashes the garrison).
  const place = mulberry32(12345);
  const garrisons = Array.from({ length: 2000 }, () =>
    ['Mage', 'Fighter', 'Sage', 'Mage', 'Knight', 'Sage'].map((className) => ({
      className,
      col: Math.floor(place() * 20),
      row: Math.floor(place() * 12),
      level: 8 + Math.floor(place() * 5),
    })),
  );
  const garrison = (n) => structuredClone(garrisons[n]);
  const rung = (id) => gameData.difficulty.modes[id];
  const roll = (id, n) => {
    const spawns = garrison(n);
    assignCasterGear(spawns, {
      act: 'act3',
      difficultyId: id,
      templateId: 'open_field',
      statusStaffConfig: rung(id).statusStaffConfig,
    });
    return spawns.filter((s) => s.statusStaff).map((s) => s.statusStaff);
  };

  it('Black Sun may field a Sleep and a Silence caster together; Nightfall never two', () => {
    expect(rung('lunatic').statusStaffConfig.maxPerBattle).toBe(2);
    expect(rung('hard').statusStaffConfig.maxPerBattle).toBe(1);
    const both = Array.from({ length: 2000 }, (_, n) => roll('lunatic', n)).find(
      (kinds) => kinds.includes('sleep') && kinds.includes('silence'),
    );
    expect(both).toBeDefined();
    for (let n = 0; n < 2000; n++) expect(roll('hard', n).length).toBeLessThanOrEqual(1);
  });

  it('a reinforcement never brings a staff, even when its template carried one', () => {
    const spec = buildReinforcementSpawnSpec({
      scheduledSpawn: { col: 3, row: 3 },
      templates: [{ className: 'Mage', level: 8, statusStaff: 'silence' }],
      battleConfig: {},
      battleParams: { act: 'act3' },
      gameData,
    });
    expect(spec.className).toBe('Mage');
    expect(spec.statusStaff).toBeUndefined();
  });
});

describe('every place that lists a foe’s gear names its staff', () => {
  it('reads uses left and range, "spent" at 0, and nothing without a staff', () => {
    const sage = caster('Sage', 8, 2, 'Silence Staff');
    expect(statusStaffInfo(sage).text).toBe('Silence Staff · Range 3-7 · 2/2 uses');
    spendStaffUse(sage.statusStaff);
    expect(statusStaffInfo(sage).text).toBe('Silence Staff · Range 3-7 · 1/2 uses');
    spendStaffUse(sage.statusStaff);
    expect(statusStaffInfo(sage).text).toBe('Silence Staff · Range 3-7 · spent');
    expect(statusStaffInfo(caster('Plain', 1, 1, null))).toBeNull();
  });

  it('the phone card names the staff under the class and weapon line', () => {
    const doc = { createElement: (tag) => ({ tag, className: '', textContent: '' }) };
    vi.stubGlobal('document', doc);
    try {
      const line = statusStaffGearLine(caster('Mage', 6, 4, 'Sleep Staff'));
      expect([line.tag, line.className, line.textContent]).toEqual([
        'p',
        'mb-gear',
        'Sleep Staff · Range 3-5 · 1/1 uses',
      ]);
      expect(statusStaffGearLine(caster('Plain', 1, 1, null))).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
    // The card shows only an inspectable unit (`unit` is canInspectUnit-gated) and puts the
    // line in the card itself, not under the collapsed "Battle details".
    const hud = readFileSync(new URL('../src/ui/MobileBattleHUD.js', import.meta.url), 'utf8');
    expect(hud).toMatch(/const unit = canInspectUnit\(s\.grid, candidate\) \? candidate : null;/);
    expect(hud).toMatch(/this\.summary\.append\(staffLine\)/);
    expect(hud).not.toMatch(/detailContent\.append\(el\('p', '', staffInfo\.text\)\)/);
  });

  it('the detail overlay’s Gear tab lists it as an item: uses and range, then "spent"', () => {
    const gear = (unit) => {
      const lines = [];
      const node = { setInteractive: () => node, on: () => node };
      const overlay = Object.create(UnitDetailOverlay.prototype);
      Object.assign(overlay, {
        _unit: unit,
        gameData,
        scene: {},
        _tabSep() {},
        _tabText: (_x, _y, text, color) => (lines.push({ text, color }), node),
        _getInspectableWeaponArtChoicesForInventory: () => [],
      });
      overlay._drawGearTab(0, 0);
      return lines;
    };
    const sage = { ...caster('Sage', 8, 2, 'Silence Staff'), inventory: [] };
    spendStaffUse(sage.statusStaff);
    expect(gear(sage).find((l) => /Staff/.test(l.text))).toEqual({
      text: ' Silence Staff (1/2) Rng3-7',
      color: UI_PALETTE.bad,
    });
    spendStaffUse(sage.statusStaff);
    expect(gear(sage).find((l) => /Staff/.test(l.text))).toEqual({
      text: ' Silence Staff (spent) Rng3-7',
      color: UI_PALETTE.lineStrong,
    });
    const plain = { ...caster('Plain', 1, 1, null), inventory: [] };
    expect(gear(plain).some((l) => /Staff/.test(l.text))).toBe(false);
  });

  it('the detail overlay, the inspection panel, the phone HUD and the roster read one line', () => {
    for (const name of [
      'UnitDetailOverlay',
      'UnitInspectionPanel',
      'MobileBattleHUD',
      'MobileRosterSheet',
    ]) {
      const source = readFileSync(new URL(`../src/ui/${name}.js`, import.meta.url), 'utf8');
      expect(source, name).toMatch(/statusStaffInfo\(/);
    }
  });
});

function mockGfx() {
  const stub = new Proxy({}, { get: (t, p) => (p === 'destroy' ? () => {} : () => stub) });
  return {
    cameras: { main: { width: 640, height: 480 } },
    add: { rectangle: () => stub, image: () => stub, text: () => stub, container: () => stub },
    textures: { exists: () => false },
  };
}
function fogRow(width, hidden) {
  const map = [Array(width).fill(T.Plain)];
  const grid = new Grid(mockGfx(), width, 1, gameData.terrain, map, true);
  grid.isVisible = (col, row) => !hidden.has(`${col},${row}`);
  return grid;
}

describe('the staff pip on the map', () => {
  it('shows for a staff with uses left, only while its caster is in view', () => {
    const mage = caster('Mage', 6, 0, 'Sleep Staff');
    expect(statusStaffPipShown(fogRow(12, new Set()), mage)).toBe(true);
    expect(statusStaffPipShown(fogRow(12, new Set(['6,0'])), mage)).toBe(false);
    expect(statusStaffPipShown(fogRow(12, new Set()), { ...mage, currentHP: 0 })).toBe(false);
    expect(statusStaffPipShown(fogRow(12, new Set()), caster('Plain', 6, 0, null))).toBe(false);
    spendStaffUse(mage.statusStaff);
    expect(statusStaffPipShown(fogRow(12, new Set()), mage)).toBe(false);
  });

  function pipScene(hidden) {
    const drawn = [];
    const rect = (x, y, w, h, color) => {
      const pip = { x, y, w, h, color, visible: true, destroyed: false };
      const chain = {
        setStrokeStyle: () => chain,
        setAngle: () => chain,
        setDepth: () => chain,
        setVisible: (v) => ((pip.visible = v), chain),
        destroy: () => {
          pip.destroyed = true;
        },
        pip,
      };
      drawn.push(chain);
      return chain;
    };
    const scene = Object.create(BattleScene.prototype);
    Object.assign(scene, {
      grid: Object.assign(fogRow(12, hidden), { gridToPixel: (c, r) => ({ x: c * 32, y: r * 32 }) }), // prettier-ignore
      gameData: { affixes: gameData.affixes },
      add: { rectangle: rect },
    });
    return { scene, drawn };
  }
  const STATUS_VIOLET = 0xb98ee0; // uiPalette.json threatStatus, the Danger zone's outline

  it('the scene draws a violet pip at the end of the row, hidden in fog', () => {
    const affix = gameData.affixes.affixes[0].id;
    const mage = caster('Mage', 6, 0, 'Silence Staff', { affixes: [affix] });
    const { scene, drawn } = pipScene(new Set());
    scene.updateAffixPips(mage);
    expect(mage.affixPips).toHaveLength(2);
    const staffPip = drawn[1].pip;
    expect(staffPip.color).toBe(STATUS_VIOLET);
    expect(staffPip.x).toBeGreaterThan(drawn[0].pip.x);
    expect(staffPip.visible).toBe(true);

    const fogged = pipScene(new Set(['6,0']));
    fogged.scene.updateAffixPips(mage);
    expect(fogged.drawn.find((d) => d.pip.color === STATUS_VIOLET).pip.visible).toBe(false);
  });

  it('the cast that spends the last use takes the pip away (a miss too)', async () => {
    const mage = armed(caster('Mage', 6, 0, 'Sleep Staff'));
    const target = armed({ ...hero(), col: 2, row: 0 });
    const { scene, drawn } = pipScene(new Set());
    Object.assign(scene, {
      _battleSession: 1,
      showBriefBanner: async () => {},
      _addConditionIcon: () => {},
      refreshVisibleDangerZone: vi.fn(),
      turnManager: { turnNumber: 2 },
    });
    scene.updateAffixPips(mage);
    expect(drawn.filter((d) => d.pip.color === STATUS_VIOLET)).toHaveLength(1);
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.999); // the roll misses
    try {
      await scene.executeEnemyStatusStaff(mage, target);
    } finally {
      random.mockRestore();
    }
    expect(target._conditions).toEqual([]);
    expect(mage.statusStaff._usesSpent).toBe(1);
    expect(drawn.find((d) => d.pip.color === STATUS_VIOLET).pip.destroyed).toBe(true);
    expect(mage.affixPips).toEqual([]);
    expect(scene.refreshVisibleDangerZone).toHaveBeenCalled();
  });
});
