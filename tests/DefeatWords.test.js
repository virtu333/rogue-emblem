// The defeat objective's words (act-v-descent §9.4; large-maps 03 §5.4 and §11.2): every reader
// that puts an objective into words must show a defeat map as one, and show every other map
// exactly as before. A defeat map's legacy string is `rout`, so a reader that keeps asking the
// string tells the player to "defeat every enemy" on a map that needs four Voices.
//
// Ways this goes wrong, a test each:
//   - the strip counts enemies ("Rout: 9 enemies remaining") instead of the targets;
//   - the compact label mangles "Defeat · the Voices (2/4)" (the rout regex, the ": " swap);
//   - the help sentence, the deploy banner and the party menu's line still say rout;
//   - the route map's node card and tooltip call a defeat set piece a rout or a seize;
//   - the felled band never shows for a target that is no boss, says "foes remain", or shows when
//     the last target fell (SLAIN follows);
//   - the words reveal a target's tile, or a name the objective does not give (fog);
//   - a rout, seize or escape config changes by a character (the unchanged-output pins).
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (value, min, max) => Math.min(max, Math.max(min, value)) },
  },
}));

import { readFileSync } from 'node:fs';
import { installFakeDom } from './helpers/fakeDom.js';
import { loadGameData } from './testData.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { NodeMapScene } from '../src/scenes/NodeMapScene.js';
import { DeployScreenOverlay } from '../src/ui/DeployScreenOverlay.js';
import { deployObjectiveLine } from '../src/ui/PartyMenus.js';
import { objectiveRail } from '../src/ui/MobileBattleHUD.js';
import { describeLoomNode } from '../src/ui/loomModel.js';
import { compactBattleObjective } from '../src/ui/battleSidebarDisplay.js';
import { objectiveHelp } from '../src/ui/helpTopics.js';
import {
  felledContent,
  shouldShowFelled,
  targetsRemainText,
  victoryContent,
} from '../src/ui/ceremonyContent.js';
import {
  BOSS_REF,
  felledObjectiveView,
  isObjectiveTarget,
  objectiveGoalSentences,
  objectiveKindOf,
  objectiveTargetUnits,
  statusView,
} from '../src/engine/BattleObjectives.js';
import { paramsObjectiveKind, previewObjectives } from '../src/engine/ObjectivePreview.js';
import { DEFEAT_FIXTURE, GATE_FIXTURE, SEIZE_FIXTURE, withSetPieces } from './setPieceFixtures.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const data = withSetPieces(loadGameData(), SEIZE_FIXTURE, DEFEAT_FIXTURE, GATE_FIXTURE);
const voicesModel = {
  version: 1,
  primary: [
    {
      id: 'voices',
      kind: 'defeat',
      targets: ['voice_a', 'voice_b', 'voice_c', 'voice_d'],
      label: 'the Voices',
    },
  ],
};
const voice = (id) => ({ authoredId: id, name: `Voice ${id}`, faction: 'enemy', currentHP: 9 });
const guard = (n = 1) => ({ name: `Guard ${n}`, faction: 'enemy', currentHP: 20 });
const fourVoices = ['a', 'b', 'c', 'd'].map((c) => voice(`voice_${c}`));
const defeatConfig = { objective: 'rout', objectives: voicesModel };

describe('the strip: statusView and the scene line', () => {
  const lineOf = (config, enemyUnits, extra = {}) => {
    const scene = Object.create(BattleScene.prototype);
    Object.assign(scene, {
      battleConfig: config,
      enemyUnits,
      npcUnits: [],
      playerUnits: [],
      escapedUnits: [],
      _zombieTombstones: [],
      objectiveText: { setText: vi.fn(), setColor: vi.fn() },
      ...extra,
    });
    scene.updateObjectiveText();
    return {
      text: scene.objectiveText.setText.mock.calls.at(-1)[0],
      color: scene.objectiveText.setColor.mock.calls.at(-1)[0],
    };
  };

  it('counts the targets, never the enemies, and ignores the guards', () => {
    const guards = [guard(1), guard(2), guard(3), guard(4), guard(5)];
    expect(lineOf(defeatConfig, [...fourVoices, ...guards]).text).toBe('Defeat · the Voices (0/4)');
    // Two Voices fall; nine foes (guards among them) stand: the line moves with the Voices only.
    expect(lineOf(defeatConfig, [...fourVoices.slice(2), ...guards]).text).toBe(
      'Defeat · the Voices (2/4)',
    );
    expect(lineOf(defeatConfig, [...fourVoices.slice(2), guard(1)]).text).toBe(
      'Defeat · the Voices (2/4)',
    );
  });

  it('turns good when the targets are down, and shows the ladder line under the strip', () => {
    const done = lineOf(defeatConfig, [guard(1)]);
    expect(done.text).toBe('Defeat · the Voices (4/4)');
    expect(done.color).not.toBe(lineOf(defeatConfig, fourVoices).color);
  });

  it('a lone target is named; a labelless group is a count; "some must fall" says so', () => {
    const gate = { objective: 'rout', objectives: { version: 1, primary: [{ id: 'g', kind: 'defeat', targets: [BOSS_REF] }] } }; // prettier-ignore
    const lieutenant = { name: 'The Lieutenant', isBoss: true, faction: 'enemy', currentHP: 40 };
    expect(lineOf(gate, [lieutenant, guard()]).text).toBe('Defeat · The Lieutenant');
    const group = (extra) => ({ version: 1, primary: [{ id: 'g', kind: 'defeat', targets: ['voice_a', 'voice_b', 'voice_c'], ...extra }] }); // prettier-ignore
    const field = { enemyUnits: [voice('voice_a'), voice('voice_b'), voice('voice_c')] };
    expect(statusView(group({}), field).primary[0].compact).toBe('Defeat · 3 targets (0/3)');
    expect(statusView(group({ need: 2 }), field).primary[0]).toMatchObject({
      compact: 'Defeat · 2 of 3 targets (0/2)',
      text: 'Defeat 2 of 3 targets. The rest need not fall.',
      left: 2,
    });
    // Several bosses behind one '@boss' ref are never named as if there were one.
    const twins = [{ ...lieutenant }, { ...lieutenant, name: 'Other' }];
    expect(statusView(gate.objectives, { enemyUnits: twins }).primary[0].label).toBe('the bosses');
  });

  it('rout, seize and escape lines are untouched (a model-less config reads the legacy rules)', () => {
    const foes = [guard(1), guard(2)];
    expect(lineOf({ objective: 'rout' }, foes).text).toBe('Rout: 2 enemies remaining');
    const seizeBoss = { name: 'Varro', isBoss: true, currentHP: 30, faction: 'enemy' };
    expect(lineOf({ objective: 'seize' }, [seizeBoss]).text).toBe(
      'Seize: Defeat boss, then capture throne',
    );
    expect(lineOf({ objective: 'seize' }, []).text).toBe('Seize: Capture throne with a Lord!');
    expect(
      lineOf({ objective: 'escape' }, foes, {
        _escapeController: { getObjectiveLabel: () => 'Escape: Only Lords must exit (0/1)' },
      }).text,
    ).toBe('Escape: Only Lords must exit (0/1)');
  });

  it('a model this build cannot play is read as its legacy string', () => {
    const newer = { objective: 'rout', objectives: { version: 2, primary: voicesModel.primary } };
    expect(lineOf(newer, [guard(1)]).text).toBe('Rout: 1 enemy remaining');
  });
});

describe('the phone rail and the help sentence', () => {
  it('the compact label passes a defeat strip through untouched, whatever the label holds', () => {
    expect(compactBattleObjective('Defeat · the Voices (2/4)')).toBe('Defeat · the Voices (2/4)');
    expect(compactBattleObjective('Defeat · Varro')).toBe('Defeat · Varro');
    // The rout regex and the ": " swap must not reach a label.
    expect(compactBattleObjective('Defeat · Warden: 3 foes remaining (1/2)')).toBe(
      'Defeat · Warden: 3 foes remaining (1/2)',
    );
    expect(compactBattleObjective('Defeat · the Voices (2/4)\nWave 2 in 1 turn')).toBe(
      'Defeat · the Voices (2/4)',
    );
    // The others, as they were.
    expect(compactBattleObjective('Rout: 2 enemies remaining')).toBe('Rout · 2 enemies remain');
    expect(compactBattleObjective('Seize: Defeat boss, then capture throne')).toBe(
      'Seize · Defeat the boss',
    );
    expect(compactBattleObjective('Escape: Only Lords must exit (1/2)')).toBe('Escape · Lords 1/2');
  });

  it('the help names the battle’s own sentence; a rout and a seize keep theirs', () => {
    const goal = objectiveGoalSentences(defeatConfig, { enemyUnits: fourVoices }).join(' ');
    expect(goal).toBe('Defeat the Voices. The rest need not fall.');
    const help = objectiveHelp('Defeat · the Voices (0/4)', '', 'defeat', goal);
    expect(help[0]).toEqual({ lead: 'Defeat · the Voices (0/4)' });
    expect(help[1].points).toEqual([goal]);
    // The kind alone still has words.
    expect(objectiveHelp('Defeat · the Voices (0/4)', '', 'defeat')[1].points[0]).toMatch(
      /^Defeat the targets\. The rest need not fall\./,
    );
    expect(objectiveHelp('Rout: 2 enemies remaining', '', 'rout')[1].points).toEqual([
      'Defeat every enemy on the map.',
    ]);
    expect(objectiveHelp('Seize: Capture throne', '', 'seize')[1].points).toEqual([
      'Defeat the boss, then move a Lord onto the throne and choose Seize.',
    ]);
  });

  it('the rail button shows the compact strip and opens the battle’s own sentence', () => {
    const scene = Object.create(BattleScene.prototype);
    Object.assign(scene, {
      battleConfig: defeatConfig,
      enemyUnits: fourVoices,
      objectiveText: { text: 'Defeat · the Voices (0/4)' },
      _bossPresence: null,
    });
    const rail = objectiveRail(scene);
    expect(rail.compact).toBe('Defeat · the Voices (0/4)');
    expect(rail.help()[1].points).toEqual(['Defeat the Voices. The rest need not fall.']);
    // A rout through the same path: its strip shortened, its stock sentence.
    const rout = { battleConfig: { objective: 'rout' }, objectiveText: { text: 'Rout: 3 enemies remaining' } }; // prettier-ignore
    expect(objectiveRail(rout).compact).toBe('Rout · 3 enemies remain');
    expect(objectiveRail(rout).help()[1].points).toEqual(['Defeat every enemy on the map.']);
  });

  it('the scene’s goal line is the model’s sentence, and none for a legacy map', () => {
    const scene = Object.create(BattleScene.prototype);
    Object.assign(scene, { battleConfig: defeatConfig, enemyUnits: fourVoices });
    expect(scene.objectiveGoalLine()).toBe('Defeat the Voices. The rest need not fall.');
    scene.battleConfig = { objective: 'rout' };
    expect(scene.objectiveGoalLine()).toBeNull();
  });
});

describe('the felled band', () => {
  it('says how many targets remain, with a regular singular, and never a foe count', () => {
    expect(targetsRemainText({ left: 2, label: 'the Voices' })).toBe('2 Voices remain');
    expect(targetsRemainText({ left: 1, label: 'the Voices' })).toBe('1 Voice remains');
    expect(targetsRemainText({ left: 3, label: 'the targets' })).toBe('3 targets remain');
    expect(targetsRemainText({ left: 1, label: 'the targets' })).toBe('1 target remains');
    expect(targetsRemainText({ left: 1, label: 'the bosses' })).toBe('1 boss remains');
    expect(targetsRemainText({ left: 1, label: 'the Wardens of Glass' })).toBe(
      '1 of the Wardens of Glass remains',
    );
    // A label with no plural to undo is kept whole rather than guessed at.
    expect(targetsRemainText({ left: 1, label: 'the Magus' })).toBe('1 of the Magus remains');
    expect(targetsRemainText({ left: 0, label: 'the Voices' })).toBe('');
    expect(
      felledContent({
        objective: 'defeat',
        remaining: 9,
        targetsLeft: 2,
        targetsLabel: 'the Voices',
      }),
    ).toEqual({ word: 'FOE VANQUISHED', sub: '2 Voices remain' });
  });

  it('the rout, seize and escape bands are unchanged', () => {
    expect(felledContent({ objective: 'rout', remaining: 1 }).sub).toBe('1 foe remains');
    expect(felledContent({ objective: 'rout', remaining: 3 }).sub).toBe('3 foes remain');
    expect(felledContent({ objective: 'seize' }).sub).toBe('Seize the throne with a Lord');
    expect(felledContent({ objective: 'escape' }).sub).toBe('Make for the exit');
    expect(shouldShowFelled({ objective: 'rout', remaining: 0 })).toBe(false);
    expect(shouldShowFelled({ objective: 'seize', remaining: 0 })).toBe(true);
  });

  it('the view counts what must still fall, not what stands', () => {
    expect(felledObjectiveView(defeatConfig, { enemyUnits: [...fourVoices, guard()] })).toEqual({
      left: 4,
      label: 'the Voices',
    });
    expect(
      felledObjectiveView(defeatConfig, {
        enemyUnits: [...fourVoices.slice(3), guard(), guard(2)],
      }),
    ).toEqual({ left: 1, label: 'the Voices' });
    expect(felledObjectiveView(defeatConfig, { enemyUnits: [guard()] })).toBeNull();
    expect(felledObjectiveView({ objective: 'rout' }, { enemyUnits: [guard()] })).toBeNull();
    // `need` 2 of 4: two fell, the rest may stand, so nothing is left to fall.
    const some = { objective: 'rout', objectives: { version: 1, primary: [{ ...voicesModel.primary[0], need: 2 }] } }; // prettier-ignore
    expect(felledObjectiveView(some, { enemyUnits: fourVoices.slice(2) })).toBeNull();
  });

  /** A scene where `fallen` has just left the field of `others`, bar the presentation. */
  function fall(fallen, others, config = defeatConfig) {
    const scene = Object.create(BattleScene.prototype);
    Object.assign(scene, {
      _battleSession: 1,
      registry: { get: () => null },
      enemyUnits: [fallen, ...others],
      playerUnits: [],
      npcUnits: [],
      battleConfig: config,
      gameData: { affixes: { affixes: [] } },
      grid: { gridToPixel: () => ({ x: 0, y: 0 }) },
      _bossPresence: { onBossDefeated: vi.fn() },
      _showBossDefeatedBanner: vi.fn(),
      _applyKillRewards: vi.fn(),
      removeUnitGraphic: vi.fn(),
      updateObjectiveText: vi.fn(),
      _combatFx: { deathFade: vi.fn(async () => {}) },
      _battleBeats: { onKill: vi.fn() },
    });
    return scene;
  }

  it('a fallen target is no boss yet gets the band while targets remain; the last gets SLAIN', async () => {
    const [a, b, c, d] = fourVoices;
    const first = fall(a, [b, c, d, guard()]);
    await first.removeUnit(a);
    expect(first._showBossDefeatedBanner).toHaveBeenCalledTimes(1);
    expect(first._bossPresence.onBossDefeated).not.toHaveBeenCalled(); // no boss bar for a Voice
    const last = fall(d, [guard(), guard(2)]);
    await last.removeUnit(d);
    expect(last._showBossDefeatedBanner).not.toHaveBeenCalled(); // the victory band follows
    // A guard's fall is no event.
    const g = guard();
    const plain = fall(g, [...fourVoices]);
    await plain.removeUnit(g);
    expect(plain._showBossDefeatedBanner).not.toHaveBeenCalled();
  });

  it('a boss that is no target still gets its band on a defeat map, with the targets counted', async () => {
    const warden = { name: 'Warden', isBoss: true, faction: 'enemy', currentHP: 30 };
    const scene = fall(warden, [...fourVoices]);
    await scene.removeUnit(warden);
    expect(scene._bossPresence.onBossDefeated).toHaveBeenCalledTimes(1);
    expect(scene._showBossDefeatedBanner).toHaveBeenCalledTimes(1);
  });

  it('the banner is handed the kind, the count and the label (and a rout’s call is unchanged)', () => {
    installFakeDom(vi);
    const scene = Object.create(BattleScene.prototype);
    const showBossFelled = vi.fn(() => ({ destroy: vi.fn() }));
    Object.assign(scene, {
      _getCeremonies: () => ({ showBossFelled }),
      battleConfig: defeatConfig,
      enemyUnits: [...fourVoices.slice(2), guard(), guard(2)],
      npcUnits: [],
      playerUnits: [],
      escapedUnits: [],
      tweens: { add: vi.fn() },
    });
    scene._showBossDefeatedBanner();
    expect(showBossFelled).toHaveBeenCalledWith({
      objective: 'defeat',
      remaining: 4,
      targetsLeft: 2,
      targetsLabel: 'the Voices',
    });
    scene.battleConfig = { objective: 'rout' };
    scene._showBossDefeatedBanner();
    expect(showBossFelled).toHaveBeenLastCalledWith({ objective: 'rout', remaining: 4 });
  });

  it('the victory word is SLAIN for the kind a defeat config is played as', () => {
    expect(victoryContent({ objective: objectiveKindOf(defeatConfig), turn: 4 }).word).toBe(
      'SLAIN',
    );
    expect(
      victoryContent({ objective: objectiveKindOf({ objective: 'rout' }), turn: 4 }).word,
    ).toBe('ROUTED');
  });
});

describe('before the map exists: the deploy screen, the party menu, the route map', () => {
  const vigilParams = { act: 'act2', objective: 'rout', setPiece: 'fixture_vigil' };
  const setPieces = data.setPieces;

  it('a node that names a defeat set piece plays as defeat, its targets named from the data', () => {
    const preview = previewObjectives(vigilParams, setPieces);
    expect(preview.kind).toBe('defeat');
    expect(preview.view.primary[0]).toMatchObject({
      compact: 'Defeat · the Voices (0/2)',
      text: 'Defeat the Voices. The rest need not fall.',
    });
    expect(paramsObjectiveKind(vigilParams, setPieces)).toBe('defeat');
    // A template map, a legacy set piece and one this build lacks keep the params' string.
    expect(previewObjectives({ objective: 'rout' }, setPieces)).toBeNull();
    expect(paramsObjectiveKind({ objective: 'seize', setPiece: 'fixture_throne' }, setPieces)).toBe(
      'seize',
    );
    expect(paramsObjectiveKind({ objective: 'rout', setPiece: 'nope' }, setPieces)).toBe('rout');
    expect(paramsObjectiveKind({ objective: 'escape' }, setPieces)).toBe('escape');
  });

  it('the gate names its boss from the params, since the slot has no name', () => {
    const params = { act: 'finalBoss', objective: 'rout', setPiece: 'fixture_gate', bossName: 'The Lieutenant' }; // prettier-ignore
    expect(previewObjectives(params, setPieces).view.primary[0]).toMatchObject({
      compact: 'Defeat · The Lieutenant',
      text: 'Defeat The Lieutenant. The rest need not fall.',
    });
    expect(previewObjectives({ ...params, bossName: undefined }, setPieces).view.primary[0].label).toBe('the boss'); // prettier-ignore
  });

  it('the party menu line reads the set piece; the other kinds are as they were', () => {
    expect(deployObjectiveLine(vigilParams, setPieces)).toBe(
      'Defeat the Voices. The rest need not fall.',
    );
    expect(deployObjectiveLine({ objective: 'rout' }, setPieces)).toBe('Rout: defeat all enemies');
    expect(deployObjectiveLine({ objective: 'seize' }, setPieces)).toBe(
      'Seize: defeat the boss, then capture the throne with a Lord',
    );
    expect(deployObjectiveLine({ objective: 'escape' }, setPieces)).toBe(
      'Escape: only Lords must exit; others retreat safely',
    );
    expect(deployObjectiveLine(undefined, setPieces)).toBe('Rout: defeat all enemies');
  });

  it('the canvas deploy banner says Defeat the Voices, and keeps the others', () => {
    const bannerOf = (battleParams, gameData = data) => {
      const texts = [];
      const stub = new Proxy({}, { get: (t, p) => (p === 'destroy' ? () => {} : () => stub) });
      const scene = {
        battleParams,
        cameras: { main: { centerX: 320, centerY: 240, width: 640, height: 480 } },
        registry: { get: () => null },
        add: {
          rectangle: () => stub,
          text: (x, y, text) => {
            texts.push(text);
            return stub;
          },
        },
        _pinToScreen: vi.fn(),
      };
      new DeployScreenOverlay(scene, { getRoster: () => [] }, gameData).show([], { min: 1, max: 3 }, vi.fn()); // prettier-ignore
      return texts.filter((t) => /Defeat|ROUT|SEIZE|ESCAPE/.test(t));
    };
    expect(bannerOf(vigilParams)).toContain('Defeat the Voices. The rest need not fall.');
    expect(bannerOf({ objective: 'rout' })).toEqual(['ROUT: Defeat all enemies']);
    expect(bannerOf({ objective: 'seize' })[0]).toMatch(/^SEIZE:/);
    expect(bannerOf({ objective: 'escape' })[0]).toMatch(/^ESCAPE:/);
  });

  it('the loom card names the kind and the targets; a rout and a boss node are as before', () => {
    const node = (extra = {}) => ({ id: 'n1', type: 'battle', row: 3, battleParams: { ...vigilParams }, ...extra }); // prettier-ignore
    const card = describeLoomNode(node(), { state: 'live', actId: 'act2', setPieces });
    expect(card.objective).toBe('DEFEAT');
    expect(card.text).toBe('Defeat the Voices. The rest need not fall.');
    // Without the data (an old caller) the legacy family stands.
    expect(describeLoomNode(node(), { state: 'live', actId: 'act2' }).objective).toBe('ROUT');
    const rout = describeLoomNode(node({ battleParams: { act: 'act2', objective: 'rout' } }), {
      state: 'live',
      actId: 'act2',
      setPieces,
    });
    expect(rout).toMatchObject({ objective: 'ROUT', text: 'Defeat all enemies on the map.' });
    const boss = describeLoomNode({ id: 'b', type: 'boss', row: 8, battleParams: { act: 'act2' } }, { state: 'live', actId: 'act2', setPieces }); // prettier-ignore
    expect(boss.objective).toBe('SEIZE');
  });

  it('the node tooltip says Defeat for a defeat set piece, boss and elite included', () => {
    const tip = (node, gameData = data) => {
      const scene = {
        hideNodeTooltip: vi.fn(),
        gameData,
        cameras: { main: { width: 640 } },
        add: { text: (x, y, text) => ({ x, y, text, width: 200, setOrigin() { return this; }, setDepth() { return this; } }) }, // prettier-ignore
      };
      NodeMapScene.prototype.showNodeTooltip.call(scene, node, { x: 100, y: 100 });
      return scene.nodeTooltip.text;
    };
    const params = (extra = {}) => ({ ...vigilParams, ...extra });
    expect(tip({ type: 'battle', battleParams: params() })).toBe('Battle (defeat)');
    expect(tip({ type: 'boss', battleParams: params() })).toBe('Boss Battle (Defeat)');
    expect(tip({ type: 'battle', battleParams: params({ isElite: true }) })).toBe(
      'Elite Battle (Defeat) — Harder fight, better loot',
    );
    // Unchanged: a template rout, the plain boss, elite seize and elite escape.
    expect(tip({ type: 'battle', battleParams: { objective: 'rout' } })).toBe('Battle (rout)');
    expect(tip({ type: 'battle', battleParams: { objective: 'seize' } })).toBe('Battle (seize)');
    expect(tip({ type: 'boss', battleParams: { objective: 'seize' } })).toBe('Boss Battle (Seize)');
    expect(tip({ type: 'boss' })).toBe('Boss Battle (Seize)');
    expect(tip({ type: 'battle', battleParams: { objective: 'rout', isElite: true } })).toMatch(
      /^Elite Battle \(Seize\)/,
    );
    expect(tip({ type: 'battle', battleParams: { objective: 'escape', isElite: true } })).toMatch(
      /^Elite Battle \(Escape\)/,
    );
    expect(tip({ type: 'battle' })).toBe('Battle (rout)');
  });
});

describe('fog: the words give what the objective gives, and no tile', () => {
  // The objective names its targets from the start (a set piece's slot names, the strip's label);
  // what a hidden target must not give away is where it stands, or that it stands apart from the
  // fog. The words are built from refs, names and counts only.
  const withTile = (u, col, row) => ({ ...u, col, row });

  it('two worlds that differ only by where (and whether seen) a target stands read the same', () => {
    const hiddenWorld = fourVoices.map((u, i) => withTile(u, 9 + i, 0));
    const seenWorld = fourVoices.map((u, i) => withTile(u, 1 + i, 3));
    const view = (units) => statusView(voicesModel, { enemyUnits: units, spawns: units });
    expect(view(hiddenWorld)).toEqual(view(seenWorld));
    expect(JSON.stringify(view(hiddenWorld))).not.toMatch(/"(col|row|x|y)"/);
    // The scene’s line and the felled view too.
    const line = (units, grid) => {
      const scene = Object.create(BattleScene.prototype);
      Object.assign(scene, {
        battleConfig: defeatConfig,
        enemyUnits: units,
        npcUnits: [],
        playerUnits: [],
        escapedUnits: [],
        grid,
        objectiveText: { setText: vi.fn(), setColor: vi.fn() },
      });
      scene.updateObjectiveText();
      return scene.objectiveText.setText.mock.calls.at(-1)[0];
    };
    const fogged = { fogEnabled: true, isVisible: () => false };
    const clear = { fogEnabled: false, isVisible: () => true };
    expect(line(hiddenWorld, fogged)).toBe(line(seenWorld, clear));
    expect(felledObjectiveView(defeatConfig, { enemyUnits: hiddenWorld })).toEqual(
      felledObjectiveView(defeatConfig, { enemyUnits: seenWorld }),
    );
  });

  it('a group’s words never name a member (a band after a fall in the fog names none)', () => {
    const labelless = { objective: 'rout', objectives: { version: 1, primary: [{ id: 'g', kind: 'defeat', targets: ['voice_a', 'voice_b', 'voice_c'] }] } }; // prettier-ignore
    const units = [voice('voice_a'), voice('voice_b'), voice('voice_c')];
    const words = [
      ...statusView(labelless.objectives, { enemyUnits: units }).primary.flatMap((p) => [p.compact, p.text, p.label]), // prettier-ignore
      targetsRemainText(felledObjectiveView(labelless, { enemyUnits: units.slice(1) })),
    ].join(' ');
    for (const u of units) expect(words).not.toContain(u.name);
    expect(targetsRemainText(felledObjectiveView(labelless, { enemyUnits: units.slice(1) }))).toBe(
      '2 targets remain',
    );
  });

  it('the words and the agents’ list are the only readers of the target set, and the words read no tile', () => {
    // BattleObjectives never asks a unit where it is or a grid what it sees: the strip's data is
    // names, refs and counts (an agent plays no fog and reads positions itself).
    const source = readFileSync(
      new URL('../src/engine/BattleObjectives.js', import.meta.url),
      'utf8',
    )
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    expect(source).not.toMatch(/\.(col|row)\b|isVisible|canInspectUnit|\bgrid\b|foesShown/);
  });
});

describe('the model’s helpers', () => {
  it('isObjectiveTarget: a ref’s unit, or any boss for @boss, on the enemy side only', () => {
    const gate = { objectives: { version: 1, primary: [{ id: 'g', kind: 'defeat', targets: [BOSS_REF, 'voice_a'] }] } }; // prettier-ignore
    expect(isObjectiveTarget(gate, voice('voice_a'))).toBe(true);
    expect(isObjectiveTarget(gate, voice('voice_b'))).toBe(false);
    expect(isObjectiveTarget(gate, { isBoss: true, faction: 'enemy' })).toBe(true);
    expect(isObjectiveTarget(gate, { isBoss: true, faction: 'player' })).toBe(false);
    expect(isObjectiveTarget({ objective: 'rout' }, { isBoss: true, faction: 'enemy' })).toBe(
      false,
    );
  });

  it('objectiveTargetUnits lists the open primaries’ standing targets, none once met', () => {
    const field = { enemyUnits: [fourVoices[1], fourVoices[3], guard()] };
    expect(objectiveTargetUnits(defeatConfig, field)).toEqual([fourVoices[1], fourVoices[3]]);
    expect(objectiveTargetUnits(defeatConfig, { enemyUnits: [guard()] })).toEqual([]);
    expect(objectiveTargetUnits({ objective: 'rout' }, field)).toEqual([]);
    const some = { objective: 'rout', objectives: { version: 1, primary: [{ ...voicesModel.primary[0], need: 2 }] } }; // prettier-ignore
    // Two of four are down: met, though two Voices stand, so nothing is a mark any more.
    expect(objectiveTargetUnits(some, { enemyUnits: fourVoices.slice(2) })).toEqual([]);
  });
});
