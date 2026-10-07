// The area preview reads the board as the player knows it (CLAUDE.md "Previews read what
// the player knows"; docs/specs/aoe-weapon-arts.md §5). Each pair of worlds differs only
// by a unit the fog hides, and every preview the player sees must be identical in both.
// Numbers are worked by hand from catalog stats quoted inline.
import { describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import { areaForecastLines, previewAreaArt } from '../src/engine/AreaPreview.js';
import { combatStrikeMods } from '../src/engine/Combat.js';
import { getWeaponArtCombatMods } from '../src/engine/WeaponArtSystem.js';
import { createPlayerKnowledge } from '../src/engine/PlayerKnowledge.js';
import { resolvePostCombatMove } from '../src/engine/WeaponArtPostCombat.js';
import { HeadlessGrid } from './harness/HeadlessGrid.js';
import { AttackFlowController } from '../src/ui/AttackFlowController.js';
import { forecastNotes } from '../src/ui/forecastDisplay.js';

const data = loadGameData();
const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));
const art = (id) => data.weaponArts.arts.find((a) => a.id === id);

const unit = (name, faction, col, row, stats = {}, extra = {}) => ({
  name,
  faction,
  col,
  row,
  level: 5,
  moveType: 'Infantry',
  currentHP: stats.HP ?? 30,
  stats: { HP: 30, STR: 0, MAG: 0, SKL: 0, SPD: 0, DEF: 0, RES: 0, LCK: 0, MOV: 5, ...stats },
  ...extra,
});

/** Fog on: tiles in `fogged` ("col,row") are hidden. */
const fogGrid = (fogged = []) => ({
  fogEnabled: true,
  cols: 8,
  rows: 8,
  isVisible: (col, row) => !fogged.includes(`${col},${row}`),
  getMoveCost: () => 1,
  getTerrainAt: () => null,
});
const world = {
  cols: 8,
  rows: 8,
  getMoveCost: () => 1,
  getTerrainAt: () => null,
  affixes: data.affixes,
};

function preview({ attacker, artId, target, units, fogged, ...rest }) {
  const knowledge = createPlayerKnowledge({ grid: fogGrid(fogged), units });
  const a = art(artId);
  return previewAreaArt({
    attacker,
    art: a,
    target,
    knowledge,
    world,
    strikeMods: combatStrikeMods({ atkWeaponArtMods: getWeaponArtCombatMods(a) }, attacker.weapon),
    ...rest,
  });
}
const visible = (p) => ({
  tiles: p.tiles,
  victims: p.victims.map((v) => [v.unit.name, v.damage, v.kills]),
  heals: (p.heals || []).map((h) => [h.unit.name, h.amount]),
  push: p.push && { ...p.push, obstacle: p.push.obstacle?.name ?? null },
  lines: areaForecastLines(p),
});

describe('area preview numbers', () => {
  it('a Burning Quake preview names each known foe with its blow and KO', () => {
    // Fire 4 + MAG 20 − RES 4 = 20, × 0.6 = 12: the 10-HP foe falls, the 30-HP one takes 12.
    const mage = unit('Mage', 'player', 1, 1, { MAG: 20 }, { weapon: weapon('Fire') });
    const target = unit('Target', 'enemy', 2, 1, { RES: 4 });
    const frail = unit('Frail', 'enemy', 3, 1, { RES: 4, HP: 10 });
    const sturdy = unit('Sturdy', 'enemy', 2, 2, { RES: 4 });
    const p = preview({
      attacker: mage,
      artId: 'magic_burning_quake',
      target,
      units: [mage, target, frail, sturdy],
    });
    expect(visible(p).victims).toEqual([
      ['Frail', 10, true],
      ['Sturdy', 12, false],
    ]);
    expect(visible(p).lines).toEqual([
      'Area if it hits: 2 foes, 1 KO',
      'Frail −10 KO',
      'Sturdy −12',
    ]);
    // The forecast lists them with the attacker's notes.
    const forecast = { attacker: { areaNotes: visible(p).lines }, defender: {} };
    expect(forecastNotes(forecast, true, 30)).toEqual(expect.arrayContaining(visible(p).lines));
  });
});

describe('area preview and Revival Stones', () => {
  it('a blow that would fell a stoned foe previews as breaking a bar, not a KO', () => {
    // As above: the 10-HP foes take 12 and would fall. One holds a Revival Stone.
    const mage = unit('Mage', 'player', 1, 1, { MAG: 20 }, { weapon: weapon('Fire') });
    const target = unit('Target', 'enemy', 2, 1, { RES: 4 });
    const frail = unit('Frail', 'enemy', 3, 1, { RES: 4, HP: 10 });
    const warchief = unit(
      'Warchief',
      'enemy',
      2,
      2,
      { RES: 4, HP: 10 },
      { isBoss: true, revivalStones: 1, revivalStonesMax: 1 },
    );
    const p = preview({
      attacker: mage,
      artId: 'magic_burning_quake',
      target,
      units: [mage, target, frail, warchief],
    });
    expect(p.victims.map((v) => [v.unit.name, v.damage, v.kills, Boolean(v.breaks)])).toEqual([
      ['Frail', 10, true, false],
      ['Warchief', 10, false, true],
    ]);
    expect(areaForecastLines(p)).toEqual([
      'Area if it hits: 2 foes, 1 KO',
      'Frail −10 KO',
      'Warchief −10 breaks a bar',
    ]);
  });
});

describe("the preview strikes with the art's weapon", () => {
  it('a Sweeping Cleave on a held Steel Sword previews the sword, not the equipped axe', () => {
    // Confirming equips the art's weapon. Steel Sword 8 + STR 12 − DEF 5 = 15, × 0.5 = 7;
    // the equipped Steel Axe (10) would have shown 8.
    const sword = weapon('Steel Sword');
    const axe = weapon('Steel Axe');
    const hero = unit(
      'Hero',
      'player',
      2,
      2,
      { STR: 12 },
      { weapon: axe, inventory: [axe, sword] },
    );
    const target = unit('Target', 'enemy', 3, 2, { DEF: 5 });
    const side = unit('Side', 'enemy', 2, 1, { DEF: 5 });
    const p = preview({
      attacker: hero,
      artId: 'axe_sweeping_cleave',
      target,
      units: [hero, target, side],
      weapon: sword,
    });
    expect(visible(p).victims).toEqual([['Side', 7, false]]);
  });
});

describe("the attack flow previews with the art's weapon", () => {
  it('target selection reads the selected art entry, not the equipped weapon', () => {
    const sword = weapon('Steel Sword');
    const axe = weapon('Steel Axe');
    const hero = unit(
      'Hero',
      'player',
      2,
      2,
      { STR: 12 },
      { weapon: axe, inventory: [axe, sword] },
    );
    const target = unit('Target', 'enemy', 3, 2, { DEF: 5 });
    const side = unit('Side', 'enemy', 2, 1, { DEF: 5 });
    const scene = {
      battleState: 'SELECTING_TARGET',
      selectedUnit: hero,
      playerUnits: [hero],
      enemyUnits: [target, side],
      npcUnits: [],
      gameData: data,
      grid: { ...fogGrid(), gridToPixel: (c, r) => ({ x: c * 32, y: r * 32 }) },
      add: {
        graphics: () => new Proxy({}, { get: (_, __, g) => () => g }),
        text: () => {
          const t = { setOrigin: () => t, setDepth: () => t, destroy: () => {} };
          return t;
        },
      },
      _getSelectedWeaponArtForUnit: () => art('axe_sweeping_cleave'),
      _resolveSelectedWeaponArtEntry: () => ({ weapon: sword, art: art('axe_sweeping_cleave') }),
    };
    const flow = new AttackFlowController(scene);
    flow.focusTarget(target);
    expect(flow._areaPreview.preview.victims.map((v) => [v.unit.name, v.damage])).toEqual([
      ['Side', 7],
    ]);
  });
});

describe('ram preview', () => {
  const ram = data.weaponArts.arts.find((a) => a.id === 'lance_battering_ram');
  const ramPreview = (lancerCol, extra = {}) => {
    const lancer = unit('Lancer', 'player', lancerCol, 1, {}, { weapon: weapon('Javelin') });
    const target = unit('Target', 'enemy', 3, 1, {}, extra);
    const knowledge = createPlayerKnowledge({ grid: fogGrid(), units: [lancer, target] });
    return previewAreaArt({ attacker: lancer, art: ram, target, knowledge, world });
  };

  it('from range 2 nothing is pushed, so nothing is promised (no "braces")', () => {
    const p = ramPreview(1);
    expect(p.push).toBeNull();
    expect(areaForecastLines(p)).toEqual([]);
  });

  it('an adjacent Anchored target braces', () => {
    const p = ramPreview(2, { affixes: ['anchored'] });
    expect(p.push).toMatchObject({ braced: true });
    expect(areaForecastLines(p)).toEqual(['Push: the target braces']);
  });
});

describe('blows per hit', () => {
  it('a line lands once per expected hit, a blast once whatever the hits', () => {
    // Oathlance 10 + STR 12 + Piercing Charge's +8 − DEF 5 = 25, × its 0.9 multi-hit = 22.
    const lancer = unit('Lancer', 'player', 0, 1, { STR: 12 }, { weapon: weapon('Oathlance') });
    const target = unit('Target', 'enemy', 1, 1, { DEF: 5 });
    const behind = unit('Behind', 'enemy', 2, 1, { DEF: 5, HP: 60 });
    const line = preview({
      attacker: lancer,
      artId: 'legend_piercing_charge',
      target,
      units: [lancer, target, behind],
      blows: 2,
    });
    expect(visible(line).victims).toEqual([['Behind', 44, false]]);

    // Barrage (radius 1, once): Oathbow 9 + STR 12 + 8 − DEF 5 = 24, × 0.9 = 21, × 0.5 = 10.
    const archer = unit('Archer', 'player', 0, 1, { STR: 12 }, { weapon: weapon('Oathbow') });
    const far = unit('Far', 'enemy', 2, 1, { DEF: 5 });
    const nextTo = unit('NextTo', 'enemy', 3, 1, { DEF: 5 });
    const blast = preview({
      attacker: archer,
      artId: 'legend_barrage',
      target: far,
      units: [archer, far, nextTo],
      blows: 2,
    });
    expect(visible(blast).victims).toEqual([['NextTo', 10, false]]);
  });
});

describe('a hidden unit never changes the preview', () => {
  const pair = (build) => {
    const seen = build(false);
    const hidden = build(true);
    expect(visible(hidden)).toEqual(visible(seen));
    return visible(seen);
  };

  it('a fogged foe inside a blast', () => {
    const v = pair((withHidden) => {
      const mage = unit('Mage', 'player', 1, 1, { MAG: 20 }, { weapon: weapon('Fire') });
      const target = unit('Target', 'enemy', 2, 1, { RES: 4 });
      const units = [mage, target];
      if (withHidden) units.push(unit('Lurker', 'enemy', 3, 1));
      return preview({
        attacker: mage,
        artId: 'magic_burning_quake',
        target,
        units,
        fogged: ['3,1'],
      });
    });
    expect(v.victims).toEqual([]);
    // The footprint is geometry: the fogged tile is still drawn.
    expect(v.tiles).toContainEqual({ col: 3, row: 1 });
  });

  it('a fogged foe behind a pierce line', () => {
    const v = pair((withHidden) => {
      const lancer = unit('Lancer', 'player', 0, 1, { STR: 12 }, { weapon: weapon('Doomblade') });
      const target = unit('Target', 'enemy', 1, 1, { DEF: 5 });
      const units = [lancer, target];
      if (withHidden) units.push(unit('Lurker', 'enemy', 2, 1));
      return preview({
        attacker: lancer,
        artId: 'legend_doom_thrust',
        target,
        units,
        fogged: ['2,1'],
      });
    });
    expect(v.victims).toEqual([]);
  });

  it('a fogged lower-HP% foe beside a Radiant Burst target', () => {
    const v = pair((withHidden) => {
      const cleric = unit('Cleric', 'player', 1, 1, { MAG: 20 }, { weapon: weapon('Fire') });
      const target = unit('Target', 'enemy', 2, 1);
      const seenFoe = unit('Seen', 'enemy', 2, 2, { HP: 30 }, { currentHP: 20 });
      const units = [cleric, target, seenFoe];
      if (withHidden) units.push(unit('Lurker', 'enemy', 3, 1, { HP: 30 }, { currentHP: 1 }));
      return preview({
        attacker: cleric,
        artId: 'magic_radiant_burst',
        target,
        units,
        fogged: ['3,1'],
      });
    });
    expect(v.victims.map(([name]) => name)).toEqual(['Seen']);
  });

  it("a fogged foe in a ram's path", () => {
    const ram = {
      id: 'fixture_ram',
      targeting: 'normal_attack',
      effects: { afterCombat: [{ type: 'move', mode: 'ram', distance: 2, collisionDamage: 5 }] },
      combatMods: {},
    };
    const build = (withHidden) => {
      const lancer = unit('Lancer', 'player', 1, 1);
      const target = unit('Target', 'enemy', 2, 1);
      const units = [lancer, target];
      if (withHidden) units.push(unit('Lurker', 'enemy', 3, 1));
      const knowledge = createPlayerKnowledge({ grid: fogGrid(['3,1']), units });
      return previewAreaArt({ attacker: lancer, art: ram, target, knowledge, world });
    };
    const seen = build(false);
    expect(visible(build(true))).toEqual(visible(seen));
    expect(seen.push).toEqual({ to: { col: 4, row: 1 }, crash: false, damage: 0, obstacle: null });
  });

  it('a fogged foe on the ice a ram slides across (a forced slide reads known units only)', () => {
    // Row 1: plain 0, 1, 2; ice 3, 4; plain 5, 6, 7. The Lancer at 1 rams the Target at
    // 2 two tiles east: tile 3 is ice, so the slide goes 4 and lands on 5 (worked by
    // hand: three tiles moved against a push of two, no crash).
    const ram = {
      id: 'fixture_ram',
      targeting: 'normal_attack',
      effects: { afterCombat: [{ type: 'move', mode: 'ram', distance: 2, collisionDamage: 5 }] },
      combatMods: {},
    };
    const T = Object.fromEntries(data.terrain.map((t, i) => [t.name, i]));
    const layout = Array.from({ length: 8 }, (_, r) =>
      Array.from({ length: 8 }, (_, c) => (r === 1 && (c === 3 || c === 4) ? T.Ice : T.Plain)),
    );
    const iceGrid = new HeadlessGrid(8, 8, data.terrain, layout);
    const iceWorld = {
      cols: 8,
      rows: 8,
      getMoveCost: (c, r, moveType) => iceGrid.getMoveCost(c, r, moveType),
      getTerrainAt: (c, r) => iceGrid.getTerrainAt(c, r),
      affixes: data.affixes,
    };
    const build = (hiddenAt) => {
      const lancer = unit('Lancer', 'player', 1, 1);
      const target = unit('Target', 'enemy', 2, 1);
      const units = [lancer, target];
      const lurker = hiddenAt ? unit('Lurker', 'enemy', hiddenAt, 1) : null;
      if (lurker) units.push(lurker);
      const knowledge = createPlayerKnowledge({
        grid: fogGrid(hiddenAt ? [`${hiddenAt},1`] : []),
        units,
      });
      const shown = previewAreaArt({
        attacker: lancer,
        art: ram,
        target,
        knowledge,
        world: iceWorld,
      });
      // What execution does on the real board, for the same ram.
      const done = resolvePostCombatMove({
        sourceUnit: lancer,
        targetUnit: target,
        mode: 'ram',
        distance: 2,
        cols: 8,
        rows: 8,
        getMoveCost: iceWorld.getMoveCost,
        getTerrainAt: iceWorld.getTerrainAt,
        getUnitAt: (c, r) => units.find((u) => u.col === c && u.row === r) || null,
      });
      return { shown, done };
    };
    const seen = build(null);
    expect(seen.shown.push).toEqual({
      to: { col: 5, row: 1 },
      crash: false,
      damage: 0,
      obstacle: null,
    });
    expect(seen.done.assignments[0]).toMatchObject({ col: 5, row: 1, slid: true });
    // A Lurker the fog hides on the slide's landing (5) or beside the ice (4): the preview
    // is identical in every world...
    for (const hiddenAt of [4, 5]) {
      expect(visible(build(hiddenAt).shown)).toEqual(visible(seen.shown));
    }
    // ...and the real ram stops where the real board stops it: held on the ice at 4 by a
    // body on 5 (the push was spent: no crash), or at 3 by a body on 4 (stopped short: a
    // crash).
    const onLanding = build(5).done;
    expect(onLanding.assignments[0]).toMatchObject({ col: 4, row: 1 });
    expect(onLanding.collision).toBeNull();
    const onIce = build(4).done;
    expect(onIce.assignments[0]).toMatchObject({ col: 3, row: 1 });
    expect(onIce.collision).not.toBeNull();
  });
});

describe('the attack flow draws the preview from known units only', () => {
  function recorderScene({ withHidden }) {
    const drawn = { rings: 0, chips: [] };
    // Any Graphics call chains; strokeRect (the preview's victim ring) is counted.
    const graphics = () => {
      const g = new Proxy(
        {},
        {
          get: (_, key) =>
            key === 'strokeRect'
              ? () => {
                  drawn.rings += 1;
                  return g;
                }
              : () => g,
        },
      );
      return g;
    };
    const mage = unit('Mage', 'player', 1, 1, { MAG: 20 }, { weapon: weapon('Fire') });
    const target = unit('Target', 'enemy', 2, 1, { RES: 4 });
    const seen = unit('Seen', 'enemy', 2, 2, { RES: 4 });
    const enemies = [target, seen];
    if (withHidden) enemies.push(unit('Lurker', 'enemy', 3, 1));
    const scene = {
      battleState: 'SELECTING_TARGET',
      selectedUnit: mage,
      playerUnits: [mage],
      enemyUnits: enemies,
      npcUnits: [],
      gameData: data,
      grid: { ...fogGrid(['3,1']), gridToPixel: (c, r) => ({ x: c * 32, y: r * 32 }) },
      add: {
        graphics,
        text: (x, y, text) => {
          drawn.chips.push(text);
          const t = { setOrigin: () => t, setDepth: () => t, destroy: () => {} };
          return t;
        },
      },
      _getSelectedWeaponArtForUnit: () => art('magic_burning_quake'),
    };
    return { scene, target, drawn };
  }

  it('target selection rings only the seen neighbour, the same with a foe in the fog', () => {
    const results = [false, true].map((withHidden) => {
      const { scene, target, drawn } = recorderScene({ withHidden });
      const flow = new AttackFlowController(scene);
      flow.focusTarget(target);
      return { drawn, names: flow._areaPreview.preview.victims.map((v) => v.unit.name) };
    });
    // Target selection: the reticle draws its own brackets through a different graphics
    // object; the ring count is the preview's own (one victim). No numbers yet.
    expect(results[0].names).toEqual(['Seen']);
    expect(results[1].names).toEqual(['Seen']);
    expect(results[1].drawn.chips).toEqual(results[0].drawn.chips);
    expect(results[0].drawn.rings).toBe(1);
    expect(results[1].drawn.rings).toBe(1);
    expect(results[0].drawn.chips).toEqual([]);
  });

  it('rings the Entity on every tile of its footprint, and destroy() clears the preview', () => {
    const { scene, target, drawn } = recorderScene({ withHidden: false });
    // A 3x3 Entity anchored beside the target, within the blast (radius 1 of (2,1)).
    scene.enemyUnits.push(unit('Entity', 'enemy', 2, 0, {}, { isEntity: true }));
    scene.enemyUnits = scene.enemyUnits.filter((u) => u.name !== 'Seen');
    const flow = new AttackFlowController(scene);
    flow.focusTarget(target);
    expect(flow._areaPreview.preview.victims.map((v) => v.unit.name)).toEqual(['Entity']);
    expect(drawn.rings).toBe(9);
    const preview = flow._areaPreview;
    expect(preview.objects.length).toBeGreaterThan(0);
    flow.destroy();
    expect(preview.objects).toEqual([]);
    expect(preview.preview).toBeNull();
    expect(flow._areaPreview).toBeNull();
  });
});
