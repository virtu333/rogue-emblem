// A template's captains (engine/TemplateLayout.js, docs/specs/map-variety.md): a rout template
// whose groups name a `captain` becomes a defeat of the captains (BattleObjectives.js). Ways it
// can go wrong, one test each:
//   - a captain group fields no captain (its share rounds to nothing, its hold pack is too small),
//     or a group names two; the captain is not the group's strongest, or is a healer or a Zombie
//     while the group has someone else;
//   - naming the captains takes a draw, so every other foe, tile and roll moves;
//   - the map's model is missing, names a spawn that does not exist, or changes the legacy family
//     an older client plays (rout);
//   - the battle ends before every captain falls, or not once they have with others standing;
//   - the route map and the deploy screen say Rout (or name other captains) where the battle
//     will say Defeat the captains;
//   - a captain carries an item (the Steal pass skips authored foes) or loses its name;
//   - a run that locked a captains map is not marked for the defeat model (an older client would
//     load it and play the map as a plain rout);
//   - a boss's map, a seize template or a choice's zone grows a captain;
//   - the group split for templates without captains changes.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { generateBattle } from '../src/engine/MapGenerator.js';
import { generateSeededBattle } from '../src/engine/BattleScout.js';
import { validateMapTemplatesConfig } from '../src/engine/MapTemplateEngine.js';
import {
  TEMPLATE_CAPTAIN_PREFIX,
  appointTemplateCaptains,
  planGroupCounts,
  templateCaptainObjectives,
} from '../src/engine/TemplateLayout.js';
import { captainLevelFor } from '../src/engine/CaptainLevel.js';
import { objectivesOf, statusView } from '../src/engine/BattleObjectives.js';
import { previewObjectives } from '../src/engine/ObjectivePreview.js';
import { deployObjectiveLine } from '../src/ui/PartyMenus.js';
import { requiredRunFormat } from '../src/engine/RunFormat.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const warband = () => data.mapTemplates.rout.find((t) => t.id === 'warband');
const captainGroups = () => warband().zones.filter((z) => z.group?.captain);

afterEach(() => restoreMathRandom());

const params = (extra = {}) => ({
  act: 'act3',
  objective: 'rout',
  templateId: 'warband',
  deployCount: 6,
  difficultyId: 'hard',
  row: 4,
  levelRange: [5, 8],
  ...extra,
});

function rectTiles(rect, cols, rows) {
  const [x1, y1, x2, y2] = rect;
  return {
    c0: Math.floor(x1 * cols),
    c1: Math.min(Math.ceil(x2 * cols), cols),
    r0: Math.floor(y1 * rows),
    r1: Math.min(Math.ceil(y2 * rows), rows),
  };
}

describe('naming the captains', () => {
  it('each captain group fields one captain: its strongest, in its zone, at the captain level', () => {
    let checked = 0;
    for (const act of ['act2', 'act3', 'act4']) {
      for (let seed = 1; seed <= 15; seed++) {
        const config = generateSeededBattle(params({ act }), data, 300 + seed);
        const captains = config.enemySpawns.filter((s) => s.authoredId);
        expect(captains.map((c) => c.authoredId).sort()).toEqual(
          captainGroups()
            .map((z) => `${TEMPLATE_CAPTAIN_PREFIX}${z.group.id}`)
            .sort(),
        );
        for (const zone of captainGroups()) {
          const captain = captains.find(
            (c) => c.authoredId === `${TEMPLATE_CAPTAIN_PREFIX}${zone.group.id}`,
          );
          expect(captain.name).toBe(zone.group.captain.name);
          expect(captain.templateGroup).toBe(zone.group.id);
          // The level range's top is 8; the elite captain's rule raises it by the act's offset.
          expect(captain.level).toBeGreaterThanOrEqual(captainLevelFor(act, 8));
          const mates = config.enemySpawns.filter(
            (s) => s.templateGroup === zone.group.id && s !== captain,
          );
          for (const m of mates) expect(m.level).toBeLessThanOrEqual(captain.level);
          // A mirrored map flips the zone's rows; either way the captain stands in its zone.
          const rect = config.mirrored
            ? [zone.rect[0], 1 - zone.rect[3], zone.rect[2], 1 - zone.rect[1]]
            : zone.rect;
          const b = rectTiles(rect, config.cols, config.rows);
          expect(captain.col).toBeGreaterThanOrEqual(b.c0);
          expect(captain.col).toBeLessThan(b.c1);
          expect(captain.row).toBeGreaterThanOrEqual(b.r0);
          expect(captain.row).toBeLessThan(b.r1);
          // The captain keeps its group's orders, and never carries (an authored foe).
          if (zone.group.ai === 'guard') expect(captain.aiMode).toBe('guard');
          if (zone.group.ai === 'hold') expect(captain.aiMode).toBe('hold');
          expect(captain.carries).toBeUndefined();
          checked++;
        }
      }
    }
    expect(checked).toBe(3 * 15 * captainGroups().length);
  });

  it('passes over a healer, a Necromancer and a Zombie while the group has anyone else', () => {
    const group = { id: 'g', share: 1, ai: 'chase', captain: { name: 'Boss Man' } };
    const spawns = [
      { className: 'Cleric', level: 9, templateGroup: 'g' },
      { className: 'Zombie', level: 9, templateGroup: 'g' },
      { className: 'Fighter', level: 4, templateGroup: 'g' },
      { className: 'Archer', level: 6, templateGroup: 'g' },
      { className: 'Knight', level: 6, templateGroup: 'g' },
      { className: 'Knight', level: 12, templateGroup: 'other' },
    ];
    expect(appointTemplateCaptains(spawns, [group], { act: 'act2', levelTop: 5 })).toEqual([
      'captain_g',
    ]);
    // The Archer: the strongest who is none of those, the earlier of the two at level 6.
    expect(spawns.filter((s) => s.authoredId).map((s) => s.className)).toEqual(['Archer']);
    // Act II raises a captain to the range top + 2 (CaptainLevel.js).
    expect(spawns[3].level).toBe(7);
    expect(spawns[3].name).toBe('Boss Man');
    // A group of none but a healer still has its captain.
    const lone = [{ className: 'Cleric', level: 3, templateGroup: 'g' }];
    expect(appointTemplateCaptains(lone, [group], { act: 'act2', levelTop: 5 })).toEqual([
      'captain_g',
    ]);
    // A group with nobody names nobody, and the map stays a rout.
    expect(appointTemplateCaptains([], [group], { act: 'act2', levelTop: 5 })).toEqual([]);
    expect(templateCaptainObjectives([])).toBeNull();
  });

  it('takes no draw: the map is the one drawn without captains, but for the captains themselves', () => {
    // Without formations: a formation seats its captain at its heart (EnemyFormations.test.js),
    // so there the captain's tile is the captain's own.
    const loose = structuredClone(data);
    for (const zone of loose.mapTemplates.rout.find((t) => t.id === 'warband').zones)
      if (zone.group) delete zone.group.formation;
    const plain = structuredClone(loose);
    for (const zone of plain.mapTemplates.rout.find((t) => t.id === 'warband').zones)
      if (zone.group) delete zone.group.captain;
    for (let seed = 1; seed <= 8; seed++) {
      const a = generateSeededBattle(params(), loose, 700 + seed);
      const b = generateSeededBattle(params(), plain, 700 + seed);
      expect(objectivesOf(b)).toBeNull();
      const strip = (config) => ({
        ...config,
        objectives: undefined,
        enemySpawns: config.enemySpawns.map(
          ({ authoredId: _id, name: _name, level: _level, ...rest }) => rest,
        ),
      });
      expect(JSON.stringify(strip(a))).toBe(JSON.stringify(strip(b)));
      // The captains' levels are the only levels raised.
      const raised = a.enemySpawns.filter((s, i) => s.level !== b.enemySpawns[i].level);
      expect(raised.every((s) => s.authoredId)).toBe(true);
    }
  });
});

describe("the captains' map", () => {
  it('is a defeat of every captain, its family the rout an older client plays', () => {
    const config = generateSeededBattle(params(), data, 41);
    expect(config.objective).toBe('rout');
    expect(objectivesOf(config)).toEqual({
      version: 1,
      primary: [
        {
          id: 'captains',
          kind: 'defeat',
          targets: ['captain_riders', 'captain_camp'],
          label: 'the captains',
        },
      ],
    });
  });

  it("marks a run that locked it for the defeat model, and a plain map's run not", () => {
    const captains = generateSeededBattle(params(), data, 41);
    const plain = generateSeededBattle(params({ templateId: 'two_camps' }), data, 41);
    const run = (config) => ({ battleConfigsByNodeId: { act3_4_1: config } });
    expect(requiredRunFormat(run(captains)).capabilities).toContain('defeatObjective');
    expect(requiredRunFormat(run(plain)).capabilities).toEqual([]);
  });

  it('a boss node never grows captains', () => {
    installSeed(5);
    const config = generateBattle(params({ isBoss: true }), data);
    restoreMathRandom();
    expect(config.objectives).toBeUndefined();
    expect(config.enemySpawns.some((s) => s.authoredId?.startsWith('captain_'))).toBe(false);
  });

  it('ends when both captains fall with others standing, and not while one stands', () => {
    let proved = 0;
    for (let seed = 1; seed <= 6; seed++) {
      installSeed(seed);
      const battle = new HeadlessBattle(data, { ...params(), battleSeed: 500 + seed });
      battle.init();
      restoreMathRandom();
      const captains = battle.enemyUnits.filter((u) => u.authoredId?.startsWith('captain_'));
      expect(captains.map((c) => c.name).sort()).toEqual(['Camp Captain', 'Rider Captain']);
      // The harness puts the spawn's name on the unit, and nothing in its carry slot.
      for (const c of captains) expect(c.carriedItem).toBeFalsy();
      const killer = battle.playerUnits[0];
      expect(battle._checkBattleEnd()).toBe(false);
      battle._removeUnit(captains[0], { killer });
      expect(battle._checkBattleEnd()).toBe(false);
      battle._removeUnit(captains[1], { killer });
      expect(battle.enemyUnits.length).toBeGreaterThan(0);
      expect(battle._checkBattleEnd()).toBe(true);
      expect(battle.result).toBe('victory');
      proved++;
    }
    expect(proved).toBe(6);
  });

  it('the route map and the deploy screen name the captains the battle will', () => {
    const p = params();
    const preview = previewObjectives(p, data.setPieces, data.mapTemplates);
    const config = generateSeededBattle(p, data, 77);
    const battleView = statusView(objectivesOf(config), {
      enemyUnits: config.enemySpawns,
      spawns: config.enemySpawns,
    });
    expect(preview.kind).toBe('defeat');
    expect(preview.view.primary.map((v) => v.text)).toEqual(battleView.primary.map((v) => v.text));
    expect(deployObjectiveLine(p, data.setPieces, data.mapTemplates)).toBe(
      'Defeat the captains. The rest need not fall.',
    );
    // Any other template is the rout its params say.
    const other = { ...p, templateId: 'two_camps' };
    expect(previewObjectives(other, data.setPieces, data.mapTemplates)).toBeNull();
    expect(deployObjectiveLine(other, data.setPieces, data.mapTemplates)).toBe(
      'Rout: defeat all enemies',
    );
    // A boss node draws no captains, so the preview says none either.
    expect(previewObjectives({ ...p, isBoss: true }, data.setPieces, data.mapTemplates)).toBeNull();
  });
});

describe('the group split with captains', () => {
  const g = (id, share, ai = 'chase', captain) => ({
    id,
    share,
    ai,
    ...(ai === 'hold' ? { wakeTurn: 4 } : {}),
    ...(captain ? { captain: { name: captain } } : {}),
  });

  it("a captain's group always fields its captain, a hold group a pack of two", () => {
    // Shares 0.8 / 0.1 / 0.1 of 5: by remainder 4 / 1 / 0 (the earlier on a tie) ...
    expect(planGroupCounts([g('a', 0.8), g('b', 0.1), g('c', 0.1)], 5)).toEqual([4, 1, 0]);
    // ... and with captains on b and c, each takes one from the largest group.
    expect(
      planGroupCounts([g('a', 0.8), g('b', 0.1, 'chase', 'B'), g('c', 0.1, 'guard', 'C')], 5),
    ).toEqual([3, 1, 1]);
    // A hold captain's group is a pack of two, never sunk into another group.
    expect(planGroupCounts([g('a', 0.9), g('b', 0.1, 'hold', 'B')], 6)).toEqual([4, 2]);
    // Without its captain the same hold group of one is folded into the charge.
    expect(planGroupCounts([g('a', 0.9), g('b', 0.1, 'hold')], 6)).toEqual([6, 0]);
    // Too few foes to go round: the captains take what there is, nothing is invented.
    expect(planGroupCounts([g('a', 0.5, 'chase', 'A'), g('b', 0.5, 'chase', 'B')], 1)).toEqual([
      1, 0,
    ]);
  });
});

describe('the validator', () => {
  const zone = (extra = {}) => ({ rect: [0, 0, 1, 1], terrain: { Plain: 1 }, ...extra });
  const player = zone({ role: 'playerSpawn', rect: [0, 0, 0.2, 1] });
  const base = (objective, template) => ({
    rout: [],
    seize: [data.mapTemplates.seize.find((t) => t.id === 'castle_assault')],
    escape: [data.mapTemplates.escape.find((t) => t.id === 'pursuit_road')],
    [objective]: [
      { id: 't', name: 'T', zones: [player, ...template.zones], ...(template.extra || {}) },
    ],
  });
  const errorsOf = (config) => validateMapTemplatesConfig(config, { strict: false }).errors;
  const captain = (name = 'Captain') => ({
    role: 'enemySpawn',
    group: { id: 'camp', share: 1, ai: 'chase', captain: { name } },
  });

  it('accepts a captain on a rout template', () => {
    expect(errorsOf(base('rout', { zones: [zone(captain())] }))).toEqual([]);
  });

  it('refuses a captain on a seize map, on a choice, or with no name or a long one', () => {
    const seize = errorsOf(
      base('seize', {
        zones: [zone(captain())],
        extra: { features: [{ type: 'Throne', position: 'right_center' }] },
      }),
    );
    expect(seize.some((e) => e.includes('captain is only for a rout template'))).toBe(true);
    const inOption = errorsOf(
      base('rout', {
        zones: [zone({ role: 'enemySpawn', group: { id: 'a', share: 1, ai: 'chase' } })],
        extra: {
          choices: [
            {
              id: 'x',
              options: [{ zones: [zone({ ...captain(), rect: [0.5, 0, 1, 0.5] })] }, { zones: [] }],
            },
          ],
        },
      }),
    );
    expect(inOption.some((e) => e.includes("captain may not be on a choice's zone"))).toBe(true);
    for (const name of ['', '   ', 'A Very Long Captain Name']) {
      const errors = errorsOf(base('rout', { zones: [zone(captain(name))] }));
      expect(
        errors.some((e) => e.includes('captain.name must be')),
        name,
      ).toBe(true);
    }
  });
});
