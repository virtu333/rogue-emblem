import { describe, it, expect, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { Grid } from '../src/engine/Grid.js';
import { readFileSync } from 'node:fs';
import { BattleScene } from '../src/scenes/BattleScene.js';
import {
  enemyThreatTiles,
  computeDangerTiles,
  moverReachSignature,
  threatsOnTile,
  threatSummaryText,
  threatSummaryTone,
  threatWorldSignature,
} from '../src/engine/ThreatForecast.js';
import {
  entityCounterOnlyDistances,
  entityCounterOnlyTiles,
  entityCounterNote,
  entityReachInfo,
} from '../src/engine/EntityReach.js';
import { getCombatForecast } from '../src/engine/Combat.js';
import { forecastNotes } from '../src/ui/forecastDisplay.js';
import { DangerZoneOverlay, dangerTier, dashSpans } from '../src/ui/DangerZoneOverlay.js';
import { HELP_TABS } from '../src/data/helpContent.js';
import { ENTITY_PRIMARY_ATTACK_RANGE } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const PLAIN = gameData.terrain.findIndex((t) => t.name === 'Plain');

function mockScene() {
  const stub = new Proxy(
    {},
    { get: (target, prop) => (prop === 'destroy' ? () => {} : () => stub) },
  );
  return {
    cameras: { main: { width: 640, height: 480 } },
    add: { rectangle: () => stub, image: () => stub, text: () => stub, container: () => stub },
    textures: { exists: () => false },
  };
}
const plainGrid = (cols, rows, { fog = false } = {}) =>
  new Grid(
    mockScene(),
    cols,
    rows,
    gameData.terrain,
    Array.from({ length: rows }, () => Array(cols).fill(PLAIN)),
    fog,
  );

const weapon = (name) => structuredClone(gameData.weapons.find((w) => w.name === name));
const ordinary = (col, row, extra = {}) => ({
  name: 'Fighter',
  faction: 'enemy',
  col,
  row,
  currentHP: 20,
  mov: 4,
  stats: { MOV: 4, HP: 20 },
  moveType: 'Infantry',
  weapon: { name: 'Iron Axe', type: 'Axe', range: '1' },
  ...extra,
});
const entityAt = (col, row, extra = {}) => ({
  name: 'The Entity',
  faction: 'enemy',
  isEntity: true,
  col,
  row,
  currentHP: 300,
  mov: 0,
  stats: { MOV: 0, HP: 300 },
  moveType: 'Infantry',
  weapon: weapon('Eldritch Grasp'),
  inventory: [weapon('Eldritch Grasp'), weapon('Twisting Vortex')],
  ...extra,
});
const ctxFor = (g, units) => ({
  grid: g,
  enemyUnits: units.filter((u) => u.faction === 'enemy'),
  ballistas: [],
  positions: () => new Map(units.map((u) => [`${u.col},${u.row}`, { faction: u.faction }])),
  costModifier: () => 0,
});
const sorted = (set) => [...set].sort((a, b) => a.localeCompare(b));

describe('pinned behaviour: threat tiles before the counter band', () => {
  it('an ordinary unit threatens movement plus weapon range, nothing else', () => {
    const g = plainGrid(11, 7);
    const lancer = ordinary(5, 3, { mov: 2, stats: { MOV: 2, HP: 20 } });
    const { damage, status } = enemyThreatTiles(ctxFor(g, [lancer]), lancer);
    // Reach 2 moves + range 1: every tile within Manhattan 3 of (5,3), the unit's own tile included.
    const expected = new Set();
    for (let c = 0; c < 11; c++)
      for (let r = 0; r < 7; r++)
        if (Math.abs(c - 5) + Math.abs(r - 3) <= 3) expected.add(`${c},${r}`);
    expect(sorted(damage)).toEqual(sorted(expected));
    expect(status.size).toBe(0);
  });

  it('the Entity strikes within 3 of its body and the body tiles are part of it', () => {
    const g = plainGrid(13, 13);
    const entity = entityAt(5, 5);
    const { damage } = enemyThreatTiles(ctxFor(g, [entity]), entity);
    const expected = new Set();
    for (let c = 0; c < 13; c++)
      for (let r = 0; r < 13; r++) {
        const dc = Math.max(5 - c, 0, c - 7);
        const dr = Math.max(5 - r, 0, r - 7);
        if (dc + dr <= 3) expected.add(`${c},${r}`);
      }
    expect(sorted(damage)).toEqual(sorted(expected));
  });

  it("computeDangerTiles lists an ordinary unit's tiles with the same shape as always", () => {
    const g = plainGrid(9, 5);
    const archer = ordinary(4, 2, {
      mov: 1,
      stats: { MOV: 1, HP: 20 },
      weapon: { name: 'Iron Bow', type: 'Bow', range: '2' },
    });
    const tiles = computeDangerTiles(ctxFor(g, [archer]));
    for (const t of tiles) {
      expect(Object.keys(t).sort((a, b) => a.localeCompare(b))).toEqual(
        ['col', 'count', 'damageThreat', 'row', 'statusThreat'].sort((a, b) => a.localeCompare(b)),
      );
    }
    expect(tiles.length).toBeGreaterThan(0);
  });
});

// The distance the rules measure: the nearest body tile of a 3x3 body anchored at (bc, br),
// written as the gap to the rectangle (an independent form of EntitySystem.entityDistanceTo).
const gapToBody = (bc, br, c, r) =>
  Math.max(bc - c, 0, c - (bc + 2)) + Math.max(br - r, 0, r - (br + 2));
const keysWhere = (cols, rows, test) => {
  const out = new Set();
  for (let c = 0; c < cols; c++)
    for (let r = 0; r < rows; r++) if (test(c, r)) out.add(`${c},${r}`);
  return out;
};

describe('the Entity counter-only band', () => {
  it('is exactly distance 4 from the body: edges, corners, never a body or strike tile', () => {
    const g = plainGrid(15, 15);
    const entity = entityAt(6, 6);
    const { damage, counter } = enemyThreatTiles(ctxFor(g, [entity]), entity);
    const expected = keysWhere(15, 15, (c, r) => gapToBody(6, 6, c, r) === 4);
    expect(sorted(counter)).toEqual(sorted(expected));
    // Straight out from each side (4 away), and the diagonal corners of the band.
    for (const key of ['2,6', '12,7', '6,2', '8,12']) expect(counter.has(key), key).toBe(true);
    for (const key of ['4,4', '10,10', '4,10', '3,5', '10,4'])
      expect(counter.has(key), key).toBe(true);
    // Five away, and one to three away (strike tiles): not in the band.
    for (const key of ['1,6', '13,7', '6,1', '4,3', '8,4', '5,6', '4,6', '8,9', '5,5'])
      expect(counter.has(key), key).toBe(false);
    for (const key of ['3,6', '11,7', '6,3', '8,11']) expect(counter.has(key), key).toBe(false);
    // Disjoint from the strike zone, and no body tile.
    for (const key of counter) expect(damage.has(key)).toBe(false);
    for (let c = 6; c <= 8; c++)
      for (let r = 6; r <= 8; r++) expect(counter.has(`${c},${r}`)).toBe(false);
  });

  it('leaves the strike tiles exactly as they were', () => {
    const g = plainGrid(15, 15);
    const entity = entityAt(6, 6);
    const { damage } = enemyThreatTiles(ctxFor(g, [entity]), entity);
    expect(sorted(damage)).toEqual(sorted(keysWhere(15, 15, (c, r) => gapToBody(6, 6, c, r) <= 3)));
  });

  it('is clipped to the map and does not fall off a corner', () => {
    const g = plainGrid(8, 8);
    const entity = entityAt(0, 0);
    const { counter } = enemyThreatTiles(ctxFor(g, [entity]), entity);
    expect(sorted(counter)).toEqual(sorted(keysWhere(8, 8, (c, r) => gapToBody(0, 0, c, r) === 4)));
    expect(counter.has('6,0')).toBe(true); // four across from the body's right edge
    expect(counter.has('5,3')).toBe(true); // four: three across, one below the body
    expect(counter.has('5,0')).toBe(false); // three across: a strike tile
    expect(counter.size).toBeGreaterThan(0);
  });

  it('reads the reach from the weapon, through the rule counters use', () => {
    const w13 = { ...weapon('Eldritch Grasp'), range: '1-3' };
    const w15 = { ...weapon('Eldritch Grasp'), range: '1-5' };
    const w25 = { ...weapon('Eldritch Grasp'), range: '2-5' };
    const staff = { name: 'Heal', type: 'Staff', range: '1-4' };
    expect(entityCounterOnlyDistances(entityAt(2, 2, { weapon: w13 }))).toEqual([]);
    expect(entityCounterOnlyDistances(entityAt(2, 2, { weapon: w15 }))).toEqual([4, 5]);
    expect(entityCounterOnlyDistances(entityAt(2, 2, { weapon: w25 }))).toEqual([4, 5]);
    expect(entityCounterOnlyDistances(entityAt(2, 2, { weapon: staff }))).toEqual([]);
    expect(entityCounterOnlyDistances(entityAt(2, 2, { weapon: null }))).toEqual([]);
    expect(entityCounterOnlyDistances(ordinary(2, 2, { weapon: weapon('Longbow') }))).toEqual([]);
    // A per-battle weapon with no uses left answers nothing (Combat.canCounter).
    const perBattle = { ...weapon('Eldritch Grasp'), perBattleUses: true, uses: 2 };
    expect(entityCounterOnlyDistances(entityAt(2, 2, { weapon: perBattle }))).toEqual([4]);
    expect(
      entityCounterOnlyDistances(entityAt(2, 2, { weapon: { ...perBattle, _usesSpent: 2 } })),
    ).toEqual([]);
    // A 1-5 weapon shows distances 4 and 5, on the map; a 1-3 one no band at all.
    const g = plainGrid(15, 15);
    const reach5 = entityAt(5, 5, { weapon: w15 });
    const { counter } = enemyThreatTiles(ctxFor(g, [reach5]), reach5);
    expect(sorted(counter)).toEqual(
      sorted(keysWhere(15, 15, (c, r) => [4, 5].includes(gapToBody(5, 5, c, r)))),
    );
    const reach3 = entityAt(5, 5, { weapon: w13 });
    expect(enemyThreatTiles(ctxFor(g, [reach3]), reach3).counter.size).toBe(0);
  });

  it('is empty for every ordinary unit, whatever its weapon', () => {
    const g = plainGrid(11, 7);
    for (const w of [weapon('Longbow'), weapon('Iron Sword'), weapon('Thunder')]) {
      const unit = ordinary(5, 3, { weapon: w });
      expect(enemyThreatTiles(ctxFor(g, [unit]), unit).counter.size).toBe(0);
    }
  });

  it('is invisible to the AI-facing threat readers', () => {
    // The enemy AI, hold activation and the sim agent read damage/status only; the new set
    // must not be named there.
    for (const file of [
      'src/engine/AIController.js',
      'src/engine/HoldActivation.js',
      'sim/lib/TacticianAgent.js',
    ]) {
      const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
      expect(text, file).not.toMatch(/counterThreat|EntityReach|\.counter\b/);
    }
  });
});

describe('computeDangerTiles with the counter band', () => {
  it('lists only the threat unless the display asks for the band', () => {
    const g = plainGrid(13, 13);
    const entity = entityAt(5, 5);
    const threatOnly = computeDangerTiles(ctxFor(g, [entity]));
    expect(threatOnly.some((t) => t.counterThreat)).toBe(false);
    expect(threatOnly.every((t) => t.damageThreat)).toBe(true);
    const shown = computeDangerTiles(ctxFor(g, [entity]), { counter: true });
    const bandTiles = shown.filter((t) => t.counterThreat);
    expect(bandTiles.length).toBe(keysWhere(13, 13, (c, r) => gapToBody(5, 5, c, r) === 4).size);
    for (const t of bandTiles)
      expect(t).toEqual({
        col: t.col,
        row: t.row,
        count: 0,
        statusThreat: false,
        damageThreat: false,
        counterThreat: true,
      });
    // The strike tiles of the two lists are the same tiles with the same counts.
    const strike = (list) =>
      list
        .filter((t) => t.damageThreat)
        .map((t) => `${t.col},${t.row}:${t.count}`)
        .sort((a, b) => a.localeCompare(b));
    expect(strike(shown)).toEqual(strike(threatOnly));
  });

  it("another foe's strike on a band tile makes it a strike tile, counted for that foe alone", () => {
    const g = plainGrid(14, 13);
    const entity = entityAt(3, 5); // body columns 3..5
    const archer = ordinary(12, 6, {
      mov: 0,
      stats: { MOV: 0, HP: 20 },
      weapon: weapon('Longbow'), // range 2-3
    });
    const tiles = computeDangerTiles(ctxFor(g, [entity, archer]), { counter: true });
    const at = (c, r) => tiles.find((t) => t.col === c && t.row === r);
    // (4, 1) is 4 from the body (band), far from the archer: no strike.
    expect(at(4, 1)).toMatchObject({ counterThreat: true, damageThreat: false, count: 0 });
    // (9, 6) is 4 from the body (band) and 3 from the archer: a strike tile that is also band.
    expect(at(9, 6)).toMatchObject({ counterThreat: true, damageThreat: true, count: 1 });
    // (8, 6) is 3 from the body, 4 from the archer: struck by the Entity only.
    expect(at(8, 6)).toMatchObject({ damageThreat: true, count: 1 });
    expect(at(8, 6).counterThreat).toBeUndefined();
  });

  it('shows nothing for an Entity the fog hides', () => {
    const g = plainGrid(13, 13, { fog: true });
    g.isVisible = () => false;
    const entity = entityAt(5, 5);
    expect(computeDangerTiles(ctxFor(g, [entity]), { counter: true })).toEqual([]);
  });

  it('BattleScene: a unit in the band is not "in danger", and the display list carries the band', () => {
    const g = plainGrid(13, 13);
    const entity = entityAt(5, 5);
    const scene = new BattleScene();
    scene.grid = g;
    scene.enemyUnits = [entity];
    scene.npcUnits = [];
    scene.ballistas = [];
    scene.gameData = { skills: [] };
    scene.playerUnits = [{ name: 'Bowyer', faction: 'player', col: 5, row: 11, currentHP: 10 }];
    // Body rows 5..7: (5, 11) is four below it, inside the band only.
    expect(scene.calculateDangerZone().find((t) => t.col === 5 && t.row === 11)).toMatchObject({
      counterThreat: true,
      damageThreat: false,
    });
    expect(scene._anyPlayerInDanger()).toBe(false);
    scene.playerUnits[0].row = 10; // three below the body: struck
    expect(scene._anyPlayerInDanger()).toBe(true);
  });
});

describe('Threat Sight: the band under a mover', () => {
  it('names the Entity only for a mover whose weapon reaches it from that tile', () => {
    const g = plainGrid(13, 13);
    const entity = entityAt(5, 5);
    const ctx = ctxFor(g, [entity]);
    // A bow that reaches 4 (no catalog weapon does; a reach bonus can: WeaponReach.js).
    const bow = {
      name: 'Archer',
      faction: 'player',
      col: 1,
      row: 1,
      weapon: { ...weapon('Longbow'), range: '2-4' },
      inventory: [],
    };
    const sword = { ...bow, weapon: weapon('Iron Sword') };
    // (11, 6) is four from the body.
    const withBow = threatsOnTile(ctx, 11, 6, { mover: bow });
    expect(withBow.counter).toEqual([entity]);
    expect(withBow.count).toBe(0);
    expect(threatSummaryText(withBow)).toBe('No foe can reach · The Entity counters from here');
    expect(threatSummaryTone(withBow)).toBe('counter');
    expect(threatsOnTile(ctx, 11, 6, { mover: sword }).counter).toEqual([]);
    // No mover: the tile's answer is the Entity's.
    expect(threatsOnTile(ctx, 11, 6).counter).toEqual([entity]);
    // A tile it strikes is a strike (never also a counter); five away is nothing.
    expect(threatsOnTile(ctx, 10, 6, { mover: bow })).toMatchObject({ count: 1, counter: [] });
    const far = threatsOnTile(ctx, 12, 6, { mover: bow });
    expect(far).toMatchObject({ count: 0, counter: [] });
    expect(threatSummaryText(far)).toBe('No foe can reach');
    expect(threatSummaryTone(far)).toBe('clear');
  });
});

describe('Threat Sight: the memo key carries what the mover can reach with', () => {
  const archer = (extra = {}) => ({
    name: 'Archer',
    faction: 'player',
    col: 11,
    row: 6,
    currentHP: 18,
    weapon: weapon('Iron Sword'),
    inventory: [weapon('Iron Sword')],
    ...extra,
  });

  it('a Trade or Equip that changes the mover reach changes the signature, and the answer', () => {
    const g = plainGrid(13, 13);
    const entity = entityAt(5, 5);
    const mover = archer();
    const units = [mover, entity];
    const ctx = ctxFor(g, units);
    const sword = threatWorldSignature(ctx, units);
    expect(threatsOnTile(ctx, 11, 6, { mover }).counter).toEqual([]);
    // A bow that reaches 4 comes into the bag and into the hand; the unit has not moved.
    const bow = { ...weapon('Longbow'), range: '2-4' };
    mover.inventory.push(bow);
    mover.weapon = bow;
    const armed = threatWorldSignature(ctx, units);
    expect(armed).not.toBe(sword);
    expect(threatsOnTile(ctx, 11, 6, { mover }).counter).toEqual([entity]);
    // It trades the bow away again: back to the first signature, back to the first answer.
    mover.inventory = [mover.inventory[0]];
    mover.weapon = mover.inventory[0];
    expect(threatWorldSignature(ctx, units)).toBe(sword);
    expect(threatsOnTile(ctx, 11, 6, { mover }).counter).toEqual([]);
  });

  it('keys on reach, not on which weapon is in hand or how the bag is ordered', () => {
    const bow = weapon('Longbow');
    const sword = weapon('Iron Sword');
    const lance = weapon('Iron Lance');
    const a = archer({ weapon: sword, inventory: [sword, bow] });
    const b = archer({ weapon: bow, inventory: [bow, sword] });
    expect(moverReachSignature(a)).toBe(moverReachSignature(b));
    // Another weapon of the same reach adds nothing; a staff and a scroll are not combat weapons.
    const c = archer({ weapon: sword, inventory: [sword, lance, bow] });
    expect(moverReachSignature(c)).toBe(moverReachSignature(a));
    const staff = { name: 'Heal', type: 'Staff', range: '1-3' };
    const scroll = { name: 'Some Scroll', type: 'Scroll', range: '1-3' };
    const d = archer({ weapon: sword, inventory: [sword, staff, scroll] });
    expect(moverReachSignature(d)).toBe(moverReachSignature(archer()));
    expect(moverReachSignature(a)).not.toBe(moverReachSignature(archer()));
    // An unarmed unit is a signature of its own, not an error.
    expect(moverReachSignature(archer({ weapon: null, inventory: [] }))).toBe('');
  });

  it('only a living player unit adds its reach: a foe and a fallen ally do not', () => {
    const g = plainGrid(13, 13);
    const ctx = ctxFor(g, []);
    const mover = archer();
    const foeUnit = ordinary(2, 2);
    const base = threatWorldSignature(ctx, [mover, foeUnit]);
    foeUnit.inventory = [weapon('Longbow')];
    expect(threatWorldSignature(ctx, [mover, foeUnit])).toBe(base);
    // A fallen ally can never be the mover: its bag is not read.
    const fallen = archer({ currentHP: 0 });
    const withFallen = threatWorldSignature(ctx, [mover, fallen]);
    fallen.inventory.push(weapon('Longbow'));
    expect(threatWorldSignature(ctx, [mover, fallen])).toBe(withFallen);
  });
});

describe('the forecast says when the Entity counters from beyond its strike', () => {
  const plain = gameData.terrain.find((t) => t.name === 'Plain');
  const archer = {
    name: 'Bowyer',
    className: 'Archer',
    faction: 'player',
    stats: { HP: 60, STR: 10, MAG: 0, SKL: 12, SPD: 10, DEF: 6, RES: 4, LCK: 5 },
    currentHP: 60,
    weapon: weapon('Longbow'),
    proficiencies: [{ type: 'Bow', rank: 'Mast' }],
    skills: [],
    moveType: 'Infantry',
  };
  const bigStats = { HP: 300, STR: 20, MAG: 20, SKL: 20, SPD: 12, DEF: 10, RES: 10, LCK: 5 };
  const forecastAt = (distance, defender = entityAt(0, 0, { stats: bigStats })) =>
    getCombatForecast(archer, archer.weapon, defender, defender.weapon, distance, plain, plain);
  const counterLine = (forecast, attacking) =>
    forecastNotes(forecast, attacking, 60).find((n) => n.startsWith('Counters from'));

  it('appears on the Entity side exactly when it counters at distance > 3', () => {
    for (const [distance, counters, noted] of [
      [1, true, false],
      [2, true, false],
      [3, true, false],
      [4, true, true],
      [5, false, false],
    ]) {
      const forecast = forecastAt(distance);
      expect(forecast.defender.canCounter, `canCounter at ${distance}`).toBe(counters);
      expect(forecast.display.entityCounterAt, `display at ${distance}`).toBe(
        noted ? distance : null,
      );
      expect(Boolean(counterLine(forecast, false)), `note at ${distance}`).toBe(noted);
      if (noted)
        expect(counterLine(forecast, false)).toBe(
          `Counters from ${distance} tiles · it strikes within ${ENTITY_PRIMARY_ATTACK_RANGE}`,
        );
      // The attacker's own side never carries it.
      expect(counterLine(forecast, true)).toBeUndefined();
      expect(entityCounterNote(forecast) !== '').toBe(noted);
    }
  });

  it('is silent for an ordinary defender, at any distance it counters', () => {
    const knight = {
      ...entityAt(0, 0, { stats: bigStats }),
      isEntity: false,
      name: 'Knight',
      weapon: { ...weapon('Eldritch Grasp'), range: '1-4' },
    };
    const forecast = forecastAt(3, knight);
    expect(forecast.defender.canCounter).toBe(true);
    expect(forecast.display.entityCounterAt).toBeNull();
    expect(counterLine(forecast, false)).toBeUndefined();
  });

  it('is silent when the Entity cannot counter (a weapon that stops at 3)', () => {
    const short = entityAt(0, 0, {
      stats: bigStats,
      weapon: { ...weapon('Eldritch Grasp'), range: '1-3' },
    });
    const forecast = forecastAt(4, short);
    expect(forecast.defender.canCounter).toBe(false);
    expect(entityCounterNote(forecast)).toBe('');
    expect(counterLine(forecast, false)).toBeUndefined();
  });
});

describe('the Entity info line', () => {
  it('reads both reaches, from the weapon', () => {
    expect(entityReachInfo(entityAt(0, 0))).toEqual({
      strike: 3,
      counter: 4,
      text: 'Strikes within 3 · Counters within 4',
    });
    const reaching = (range) => entityAt(0, 0, { weapon: { ...weapon('Eldritch Grasp'), range } });
    expect(entityReachInfo(reaching('1-5')).text).toBe('Strikes within 3 · Counters within 5');
    expect(entityReachInfo(reaching('1-3')).text).toBe('Strikes and counters within 3');
    expect(entityReachInfo(ordinary(0, 0))).toBeNull();
    expect(entityReachInfo(null)).toBeNull();
  });

  it('both Entity weapons carry the reach the line and the help say', () => {
    for (const name of ['Eldritch Grasp', 'Twisting Vortex'])
      expect(weapon(name).range, name).toBe('1-4');
    const page = HELP_TABS.find((t) => t.label === 'Combat').pages.find(
      (p) => p.title === "The Entity's Reach",
    );
    const text = page.lines.map((l) => l.text).join(' ');
    expect(text).toMatch(/3 tiles/);
    expect(text).toMatch(/from 4/);
  });
});

describe('the Danger overlay draws the band as its own thing', () => {
  function fixture() {
    const layers = [];
    const makeGraphics = () => {
      const g = {
        calls: [],
        setDepth: () => g,
        fillStyle: (c, a) => g.calls.push(['fillStyle', c, a]),
        fillRect: (...a) => g.calls.push(['fillRect', ...a]),
        lineStyle: (w, c, a) => g.calls.push(['lineStyle', w, c, a]),
        lineBetween: (...a) => g.calls.push(['line', ...a]),
        strokeRect: (...a) => g.calls.push(['strokeRect', ...a]),
        clear: () => (g.calls = []),
        destroy: () => {},
      };
      layers.push(g);
      return g;
    };
    const scene = { add: { graphics: makeGraphics } };
    const grid = { gridToPixel: (col, row) => ({ x: col * 32 + 16, y: row * 32 + 16 }) };
    return { overlay: new DangerZoneOverlay(scene, grid), layers };
  }
  const COUNTER = 0xe6a98a; // uiPalette.json threatCounter
  const strikeTile = { col: 3, row: 3, count: 1, damageThreat: true, statusThreat: false };
  const bandTile = { col: 4, row: 3, count: 0, damageThreat: false, counterThreat: true };

  it('is tier 0 (so never "in reach"), faint, and not hatched', () => {
    expect(dangerTier({ count: 0, damageThreat: false, counterThreat: true })).toBe(0);
    expect(dangerTier({ count: 2, damageThreat: true, counterThreat: true })).toBe(2);
    const { overlay, layers } = fixture();
    overlay.show([strikeTile, bandTile]);
    expect(overlay.tiles.map((t) => [t.tier, t.counterThreat])).toEqual([
      [1, false],
      [0, true],
    ]);
    const fills = layers[0].calls.filter((c) => c[0] === 'fillStyle');
    expect(fills).toHaveLength(2);
    expect(fills[1][1]).toBe(COUNTER);
    expect(fills[1][2]).toBeLessThan(fills[0][2]); // fainter than the lightest strike tile
    // Hatch lines belong to the strike tile alone: none starts inside the band tile's box.
    const hatch = layers[0].calls.filter((c) => c[0] === 'line');
    expect(hatch.length).toBeGreaterThan(0);
    expect(hatch.every((c) => c[1] < 4 * 32 || c[1] > 5 * 32)).toBe(true);
  });

  it('dashes its outer edge but not the border it shares with the strike zone', () => {
    const { overlay, layers } = fixture();
    overlay.show([strikeTile, bandTile]);
    const dashed = [];
    let color = null;
    for (const c of layers[1].calls) {
      if (c[0] === 'lineStyle') color = c[2];
      else if (c[0] === 'line' && color === COUNTER) dashed.push(c.slice(1));
    }
    const perEdge = dashSpans(32).length;
    // The band tile has four edges; the one it shares with (3, 3) is the crimson line's.
    expect(dashed).toHaveLength(3 * perEdge);
    const shared = 4 * 32;
    expect(dashed.some(([x1, , x2]) => x1 === shared && x2 === shared)).toBe(false);
    // Every dash lies inside the band tile.
    for (const [x1, y1, x2, y2] of dashed) {
      expect(Math.min(x1, x2)).toBeGreaterThanOrEqual(4 * 32);
      expect(Math.max(x1, x2)).toBeLessThanOrEqual(5 * 32);
      expect(Math.min(y1, y2)).toBeGreaterThanOrEqual(3 * 32);
      expect(Math.max(y1, y2)).toBeLessThanOrEqual(4 * 32);
    }
  });

  it('draws its dashes when the band is all there is', () => {
    const { overlay, layers } = fixture();
    overlay.show([{ col: 1, row: 1, count: 0, counterThreat: true }]);
    expect(layers[1].calls.some((c) => c[0] === 'line')).toBe(true);
  });
});
