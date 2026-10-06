// Forced slides in the battle scene (rules: tests/ForcedSlide.test.js): Shove and Smite
// through their real entry points on a real Grid with ice, what the player is shown
// before choosing (PlayerKnowledge pairing: worlds that differ only by a hidden unit),
// what the action really does when the board differs from what they knew, the slide as
// it is drawn, and that drawing it changes nothing. Positions are worked out by hand.
import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { Grid } from '../src/engine/Grid.js';
import { AbilityController } from '../src/ui/AbilityController.js';
import { postCombatEffects } from '../src/engine/PostCombatEffects.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const skillById = new Map(gameData.skills.map((skill) => [skill.id, skill]));
const T = Object.fromEntries(gameData.terrain.map((t, i) => [t.name, i]));
const GLYPH = { '.': T.Plain, i: T.Ice, L: T['Lava Crack'], '#': T.Wall };

function unit(name, col, row, extra = {}) {
  const stats = { HP: 24, STR: 8, MAG: 4, SKL: 6, SPD: 7, LCK: 3, DEF: 4, RES: 2, MOV: 5 };
  return {
    name,
    faction: 'player',
    col,
    row,
    currentHP: 24,
    stats,
    mov: 5,
    moveType: 'Infantry',
    weapon: null,
    inventory: [],
    consumables: [],
    skills: [],
    proficiencies: [],
    _conditions: [],
    graphic: { name: `${name} graphic` },
    label: { name: `${name} label` },
    ...extra,
  };
}
const foe = (name, col, row, extra = {}) => unit(name, col, row, { faction: 'enemy', ...extra });

function mockGfx() {
  const stub = new Proxy({}, { get: (t, p) => (p === 'destroy' ? () => {} : () => stub) });
  return {
    cameras: { main: { width: 640, height: 480 } },
    add: { rectangle: () => stub, image: () => stub, text: () => stub, container: () => stub },
    textures: { exists: () => false },
  };
}

/** A real Grid of one row of glyphs ('.' plain, 'i' ice, 'L' lava); `hidden` tiles are fogged. */
function board(line, hidden = []) {
  const map = [[...line].map((ch) => GLYPH[ch])];
  const grid = new Grid(mockGfx(), map[0].length, 1, gameData.terrain, map, true);
  const fogged = new Set(hidden.map((col) => `${col},0`));
  grid.isVisible = (col, row) => !fogged.has(`${col},${row}`);
  grid.gridToPixel = (col, row) => ({ x: col * 32, y: row * 32 });
  for (const name of ['showAttackRange', 'clearAttackHighlights', 'clearHighlights'])
    grid[name] = vi.fn();
  return grid;
}

function sceneWith({ grid, players, enemies = [], npcs = [], history = false }) {
  const scene = new BattleScene();
  Object.assign(scene, {
    _battleSession: 1,
    gameData: { skills: gameData.skills, affixes: gameData.affixes, classes: [], lords: [] },
    turnManager: { turnNumber: 1, currentPhase: 'player' },
    grid,
    playerUnits: players,
    enemyUnits: enemies,
    npcUnits: npcs,
    registry: { get: vi.fn(() => null) },
    updateHPBar: vi.fn(),
    showMinorHintAt: vi.fn(),
    updateUnitPosition: vi.fn(),
    commitVisionSnapshotIfPending: vi.fn(),
    finishUnitAction: vi.fn(),
    _refreshPostCombatMovementState: vi.fn(),
    _combatFx: { playBuff: vi.fn(), playHeal: vi.fn(), playStatus: vi.fn() },
    _awaitSceneTween: vi.fn(async () => {}),
    hideActionMenu: vi.fn(() => {
      scene.actionMenu = [];
    }),
    showActionMenu: vi.fn(),
    dimUnit: vi.fn(),
    selectedUnit: players[0],
    ...(history
      ? { runManager: { battleInProgress: true }, _captureSuspendCheckpoint: vi.fn(() => true) }
      : {}),
  });
  scene._abilityController = new AbilityController(scene);
  return scene;
}

const smiteSkill = skillById.get('smite');
/** Tap the foe the caster aims at, and wait for the action to finish. */
async function smiteFoe(scene, caster, col) {
  scene._abilityController._selectAbility(caster, smiteSkill);
  scene.handleAbilityTileClick({ col, row: 0 });
  await vi.waitFor(() => expect(scene.finishUnitAction).toHaveBeenCalled());
}
async function shoveAlly(scene, shover, ally) {
  const target = scene.findShoveTargets(shover).find((t) => t.ally === ally);
  expect(target, 'the shove is offered').toBeTruthy();
  await scene.executeShove(shover, target);
  expect(scene.finishUnitAction).toHaveBeenCalled();
}
const at = (u) => [u.col, u.row];

describe('Smite onto ice, through the scene', () => {
  // Caster (4,0), Brigand (5,0). Ice on 6 and 7, plain after: the push puts it on 6, the
  // slide runs through 7 and ends on 8.
  const setup = (line = '......ii....', extra = {}) => {
    const caster = unit('Caster', 4, 0, { skills: ['smite'] });
    const brigand = foe('Brigand', 5, 0, extra);
    const scene = sceneWith({ grid: board(line), players: [caster], enemies: [brigand] });
    return { scene, caster, brigand };
  };

  it('the foe ends on the first tile off the ice, the caster stays, the action ends', async () => {
    const { scene, caster, brigand } = setup();
    await smiteFoe(scene, caster, 5);
    expect(at(brigand)).toEqual([8, 0]);
    expect(at(caster)).toEqual([4, 0]);
    expect(brigand.currentHP).toBe(24);
    expect(scene.finishUnitAction).toHaveBeenCalledWith(caster, { session: 1 });
  });

  it('the slide is drawn tile by tile: each tween to the next tile, at slide speed', async () => {
    const { scene, caster, brigand } = setup();
    await smiteFoe(scene, caster, 5);
    // Path (5,0) -> (6,0) -> (7,0) -> (8,0): pixels are 32 per tile, the ice entry and the
    // slid tiles at the walking slide's 60 ms.
    const tweens = scene._awaitSceneTween.mock.calls.map(([config]) => config);
    expect(tweens.map((c) => [c.x, c.y, c.duration])).toEqual([
      [192, 0, 60],
      [224, 0, 60],
      [256, 0, 60],
    ]);
    for (const config of tweens) expect(config.targets).toEqual([brigand.graphic, brigand.label]);
  });

  it('without ice the push is one tween to the landing, as before', async () => {
    const { scene, caster, brigand } = setup('............');
    await smiteFoe(scene, caster, 5);
    expect(at(brigand)).toEqual([7, 0]);
    expect(scene._awaitSceneTween.mock.calls.map(([c]) => [c.x, c.duration])).toEqual([[224, 120]]);
  });

  it('drawing the slide changes nothing: shown, failing or with no sprites, the same board', async () => {
    const worlds = {
      shown: () => {},
      'tween throws': (scene) => {
        scene._awaitSceneTween = vi.fn(async () => {
          throw new Error('renderer fault');
        });
      },
      'no sprites': (scene) => {
        for (const u of [...scene.playerUnits, ...scene.enemyUnits]) {
          u.graphic = undefined;
          u.label = undefined;
        }
      },
    };
    const outcomes = {};
    for (const [name, change] of Object.entries(worlds)) {
      const { scene, caster, brigand } = setup('......ii....', {
        aiMode: 'hold',
        holdPack: 3,
        holdPackSize: 2,
      });
      change(scene);
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await smiteFoe(scene, caster, 5);
      outcomes[name] = [at(brigand), at(caster), brigand.currentHP, brigand.holdDisturbed];
    }
    expect(outcomes.shown).toEqual([[8, 0], [4, 0], 24, 'moved']);
    expect(outcomes['tween throws']).toEqual(outcomes.shown);
    expect(outcomes['no sprites']).toEqual(outcomes.shown);
    vi.restoreAllMocks();
  });

  it('a foe smitten onto ice that ends on lava is on lava and unhurt (the phase end burns it)', async () => {
    const { scene, caster, brigand } = setup('......iL....');
    await smiteFoe(scene, caster, 5);
    expect(at(brigand)).toEqual([7, 0]);
    expect(brigand.currentHP).toBe(24);
  });

  it('a boss on the ice is still not smitten, and a flier is smitten without sliding', async () => {
    const boss = setup('......ii....', { isBoss: true });
    const [entry] = boss.scene._abilityController._getAbilityEntries(boss.caster);
    expect(entry.hasTargets).toBe(false);
    const flier = setup('......ii....', { moveType: 'Flying' });
    await smiteFoe(flier.scene, flier.caster, 5);
    expect(at(flier.brigand)).toEqual([7, 0]);
  });
});

describe('Shove onto ice, through the scene', () => {
  const setup = (
    line = '......ii....',
    { hidden = [], enemies = [], npcs = [], ally = {} } = {},
  ) => {
    const shover = unit('Shover', 4, 0, { skills: ['shove'] });
    const friend = unit('Friend', 5, 0, ally);
    const scene = sceneWith({
      grid: board(line, hidden),
      players: [shover, friend],
      enemies,
      npcs,
      history: true,
    });
    return { scene, shover, friend };
  };

  it('the ally slides from the first ice tile to the first plain one', async () => {
    const { scene, shover, friend } = setup();
    await shoveAlly(scene, shover, friend);
    expect(at(friend)).toEqual([8, 0]);
    expect(at(shover)).toEqual([4, 0]);
    expect(scene._awaitSceneTween.mock.calls.map(([c]) => [c.x, c.duration])).toEqual([
      [192, 60],
      [224, 60],
      [256, 60],
    ]);
  });

  it('on plain ground it is one tile, as before', async () => {
    const { scene, shover, friend } = setup('............');
    await shoveAlly(scene, shover, friend);
    expect(at(friend)).toEqual([6, 0]);
    expect(scene._awaitSceneTween.mock.calls.map(([c]) => [c.x, c.duration])).toEqual([[192, 80]]);
  });

  it('an ally of any flying kind goes one tile and stays', async () => {
    const { scene, shover, friend } = setup('......ii....', { ally: { moveType: 'Flying' } });
    await shoveAlly(scene, shover, friend);
    expect(at(friend)).toEqual([6, 0]);
  });

  it('the slide ends on the ice, not off it, when the tile past it is held by a seen unit', async () => {
    const wall = foe('Wall', 7, 0);
    const { scene, shover, friend } = setup('......ii....', { enemies: [wall] });
    await shoveAlly(scene, shover, friend);
    expect(at(friend)).toEqual([6, 0]);
    // Seen: no ambush, nothing to report.
    expect(scene.showMinorHintAt).not.toHaveBeenCalled();
  });

  it('drawing it changes nothing: the same board with the tween failing or no sprites', async () => {
    const results = [];
    for (const change of [
      () => {},
      (scene) => {
        scene._awaitSceneTween = vi.fn(async () => {
          throw new Error('renderer fault');
        });
      },
      (scene) => {
        for (const u of scene.playerUnits) {
          u.graphic = undefined;
          u.label = undefined;
        }
      },
    ]) {
      const { scene, shover, friend } = setup();
      change(scene);
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await shoveAlly(scene, shover, friend);
      results.push([at(friend), at(shover)]);
    }
    expect(results).toEqual(
      Array(3).fill([
        [8, 0],
        [4, 0],
      ]),
    );
    vi.restoreAllMocks();
  });
});

describe('what the player is shown ignores a unit the fog hides (PlayerKnowledge)', () => {
  // Two worlds the player cannot tell apart, differing only by a Lurker on a fogged ice
  // tile in the slide's path. Ice on 6 and 7 (7 fogged), plain from 8.
  const LINE = '......ii....';
  const worlds = (build) =>
    [false, true].map((withLurker) => {
      const lurker = withLurker ? [foe('Lurker', 7, 0)] : [];
      return build(lurker);
    });

  it('Smite: the landing shown, the highlight and the menu are identical in both worlds', () => {
    const [empty, occupied] = worlds((lurker) => {
      const caster = unit('Caster', 4, 0, { skills: ['smite'] });
      const scene = sceneWith({
        grid: board(LINE, [7]),
        players: [caster],
        enemies: [foe('Brigand', 5, 0), ...lurker],
      });
      return { scene, caster };
    });
    const preview = ({ scene, caster }) => {
      const [entry] = scene._abilityController._getAbilityEntries(caster);
      scene._abilityController._selectAbility(caster, smiteSkill);
      return {
        entry: [entry.hasTargets, scene._abilityController._statusLine(caster, entry)],
        tiles: scene.abilityTiles,
        landings: scene._abilityController
          ._targeting()
          .find(caster, smiteSkill)
          .map((t) => [t.destCol, t.destRow, t.steps, t.slid]),
      };
    };
    const a = preview(empty);
    // The slide the player can know: 5 -> 6 (ice) -> 7 (ice, fogged but known free) -> 8.
    expect(a.landings).toEqual([[8, 0, 3, true]]);
    expect(preview(occupied)).toEqual(a);
  });

  it('Smite: the real slide stops where the real world stops it', async () => {
    const [empty, occupied] = worlds((lurker) => {
      const caster = unit('Caster', 4, 0, { skills: ['smite'] });
      const brigand = foe('Brigand', 5, 0);
      const scene = sceneWith({
        grid: board(LINE, [7]),
        players: [caster],
        enemies: [brigand, ...lurker],
      });
      return { scene, caster, brigand };
    });
    await smiteFoe(empty.scene, empty.caster, 5);
    await smiteFoe(occupied.scene, occupied.caster, 5);
    expect(at(empty.brigand)).toEqual([8, 0]);
    // Stopped on the ice before the unit nobody saw; nothing else says why.
    expect(at(occupied.brigand)).toEqual([6, 0]);
    expect(occupied.scene.showMinorHintAt).not.toHaveBeenCalled();
  });

  it('Shove: the option and its landing are identical in both worlds', () => {
    const [empty, occupied] = worlds((lurker) => {
      const shover = unit('Shover', 4, 0, { skills: ['shove'] });
      const friend = unit('Friend', 5, 0);
      const scene = sceneWith({
        grid: board(LINE, [7]),
        players: [shover, friend],
        enemies: lurker,
      });
      return { scene, shover, friend };
    });
    const offered = ({ scene, shover }) =>
      scene.findShoveTargets(shover).map((t) => [t.ally.name, t.destCol, t.destRow, t.slid]);
    expect(offered(empty)).toEqual([['Friend', 8, 0, true]]);
    expect(offered(occupied)).toEqual(offered(empty));
  });

  it('Shove: a hidden foe stops the slide, is named an ambush, and the ally can still act', async () => {
    const lurker = foe('Lurker', 7, 0);
    const { scene, shover, friend } = (() => {
      const shover = unit('Shover', 4, 0, { skills: ['shove'] });
      const friend = unit('Friend', 5, 0, { battleEntityId: 'ally' });
      shover.battleEntityId = 'shover';
      const scene = sceneWith({
        grid: board(LINE, [7]),
        players: [shover, friend],
        enemies: [lurker],
        history: true,
      });
      return { scene, shover, friend };
    })();
    await shoveAlly(scene, shover, friend);
    expect(at(friend)).toEqual([6, 0]);
    expect(scene.showMinorHintAt).toHaveBeenCalledWith(7 * 32, 0, 'Ambush!', expect.anything());
    // The timeline records it as it records a walk's ambush.
    expect(scene._historyBeats.map((b) => b.type)).toEqual(['shoved', 'was ambushed by']);
  });

  it('Shove: a hidden neutral stops it too, as a plain block with no ambush on record', async () => {
    const merchant = { ...unit('Merchant', 7, 0), faction: 'npc', isCaravan: true };
    const shover = unit('Shover', 4, 0, { skills: ['shove'] });
    const friend = unit('Friend', 5, 0);
    const scene = sceneWith({
      grid: board(LINE, [7]),
      players: [shover, friend],
      npcs: [merchant],
      history: true,
    });
    await shoveAlly(scene, shover, friend);
    expect(at(friend)).toEqual([6, 0]);
    expect(scene.showMinorHintAt).toHaveBeenCalledWith(7 * 32, 0, 'Blocked', expect.anything());
    expect(scene._historyBeats.map((b) => b.type)).toEqual(['shoved']);
  });

  it('control: the same unit on a tile the player can see is part of what they are shown', async () => {
    const lurker = foe('Lurker', 7, 0);
    const shover = unit('Shover', 4, 0, { skills: ['shove'] });
    const friend = unit('Friend', 5, 0);
    const scene = sceneWith({
      grid: board(LINE, []),
      players: [shover, friend],
      enemies: [lurker],
    });
    // Seen: the preview already ends on the ice at 6, held there (no slide) by the Lurker.
    expect(scene.findShoveTargets(shover).map((t) => [t.destCol, t.slid])).toEqual([[6, false]]);
  });

  it('a fogged first tile still counts as taken: no option, as before', () => {
    const shover = unit('Shover', 4, 0, { skills: ['shove'] });
    const friend = unit('Friend', 5, 0);
    const scene = sceneWith({ grid: board(LINE, [6]), players: [shover, friend] });
    expect(scene.findShoveTargets(shover)).toEqual([]);
  });
});

describe('Pull: neither unit slides', () => {
  it('the puller steps back and the ally takes its tile, ice or not', async () => {
    // Puller (4,0) on ice, ally (5,0); ice also behind the puller on 3. The puller's own
    // step is not forced; the ally lands on 4 beside the puller, who holds the next tile.
    const puller = unit('Puller', 4, 0, { skills: ['pull'] });
    const friend = unit('Friend', 5, 0);
    const scene = sceneWith({ grid: board('...ii.......'), players: [puller, friend] });
    const target = scene.findPullTargets(puller)[0];
    expect(target).toMatchObject({ retreatCol: 3, retreatRow: 0 });
    await scene.executePull(puller, target);
    expect(at(puller)).toEqual([3, 0]);
    expect(at(friend)).toEqual([4, 0]);
  });
});

describe('a weapon-art push or ram onto ice, through the scene', () => {
  // Lancer (4,0) beside Target (5,0), ice on 6 and 7, plain after. The art's own beats are
  // played by the scene (_playPostCombatBeats), as after a real combat.
  const art = (mode, distance) => ({
    id: `fixture_${mode}`,
    targeting: 'normal_attack',
    effects: { afterCombat: [{ type: 'move', mode, distance, collisionDamage: 5 }] },
    combatMods: {},
  });
  const hit = { events: [{ type: 'strike', attackerSide: 'attacker', miss: false, damage: 1 }] };
  const playArt = async (mode, distance, line = '......ii....', change = () => {}) => {
    const lancer = unit('Lancer', 4, 0);
    const target = foe('Target', 5, 0);
    const scene = sceneWith({ grid: board(line), players: [lancer], enemies: [target] });
    change(scene);
    const combat = {
      attacker: lancer,
      defender: target,
      result: hit,
      attackerWeaponArt: art(mode, distance),
    };
    await scene._playPostCombatBeats(postCombatEffects(combat, scene._postCombatWorld()));
    return { scene, lancer, target };
  };

  it('a push slides the target on, drawn tile by tile at the slide speed', async () => {
    const { scene, lancer, target } = await playArt('push', 1);
    expect(at(target)).toEqual([8, 0]);
    expect(at(lancer)).toEqual([4, 0]);
    expect(scene._awaitSceneTween.mock.calls.map(([c]) => [c.x, c.duration])).toEqual([
      [192, 60],
      [224, 60],
      [256, 60],
    ]);
    expect(scene._refreshPostCombatMovementState).toHaveBeenCalledWith([target]);
  });

  it('a ram with ice on its first tile slides on and is no crash; on plain ground it is as before', async () => {
    const onIce = await playArt('ram', 2);
    expect(at(onIce.target)).toEqual([8, 0]);
    expect(onIce.target.currentHP).toBe(24);
    const plain = await playArt('ram', 2, '............');
    expect(at(plain.target)).toEqual([7, 0]);
    expect(plain.scene._awaitSceneTween).not.toHaveBeenCalled();
  });

  it('drawing it changes nothing: the same board with the tween failing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { target } = await playArt('push', 1, '......ii....', (scene) => {
      scene._awaitSceneTween = vi.fn(async () => {
        throw new Error('renderer fault');
      });
    });
    expect(at(target)).toEqual([8, 0]);
    vi.restoreAllMocks();
  });
});
