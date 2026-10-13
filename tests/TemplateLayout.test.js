// Procedural templates that vary per battle and split their enemies into groups
// (engine/TemplateLayout.js, docs/specs/map-variety.md). Ways it can go wrong, one test each:
//   - a template that names none of the new fields takes a draw or changes shape (every map
//     already played for a seed would move);
//   - a mirror is not an exact flip of the tiles (off by one at some map size), or leaves a
//     feature, an edge or the spawn zone where it was;
//   - a template switched off is drawn for a node or a battle, or a battle that names it
//     cannot play it;
//   - the group split loses or invents enemies, or makes a hold pack of one;
//   - a group's foes stand outside their zone, or carry the wrong orders;
//   - a template hold pack shares an id with the rung's own packs (HoldActivation), or the
//     rung's pass strips a template guard;
//   - a hold pack on a rout map never wakes, or wakes before its turn with the army away;
//   - the same seed draws a different map, or a new map breaks validateBattleConfig;
//   - a dense template's extra foes are lost, or break the density cap;
//   - a group's role does not change what its foes are, or leaks into another group;
//   - the validator lets a broken layout through.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { generateBattle, pickTemplate, validateBattleConfig } from '../src/engine/MapGenerator.js';
import { pickTemplateForNode } from '../src/engine/NodeMapGenerator.js';
import { generateSeededBattle } from '../src/engine/BattleScout.js';
import { validateMapTemplatesConfig } from '../src/engine/MapTemplateEngine.js';
import {
  GROUP_ROLES,
  MIN_HOLD_GROUP,
  TEMPLATE_GROUP_PACK_BASE,
  mirrorRectY,
  mirrorTemplateY,
  planGroupCounts,
  resolveTemplateLayout,
} from '../src/engine/TemplateLayout.js';
import { wakeHolders } from '../src/engine/HoldActivation.js';
import { DEPLOY_LIMITS } from '../src/utils/constants.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const NEW_TEMPLATES = [
  'corner_camp',
  'three_roads',
  'three_roads_keep',
  'caught_in_the_open',
  'two_camps',
];
const allTemplates = () => Object.values(data.mapTemplates).flat();
const byId = (id) => allTemplates().find((t) => t.id === id);
const objectiveOf = (id) =>
  Object.keys(data.mapTemplates).find((k) => data.mapTemplates[k].some((t) => t.id === id));
const SIZES = data.mapSizes.map((s) => s.mapSize.split('x').map(Number));

afterEach(() => restoreMathRandom());

/** A rect's tiles, rounded as MapGenerator rounds a zone. */
function tilesOf(rect, cols, rows) {
  const [x1, y1, x2, y2] = rect;
  const out = new Set();
  for (let r = Math.floor(y1 * rows); r < Math.min(Math.ceil(y2 * rows), rows); r++)
    for (let c = Math.floor(x1 * cols); c < Math.min(Math.ceil(x2 * cols), cols); c++)
      out.add(`${c},${r}`);
  return out;
}

function countingRandom(values = [0.25, 0.75, 0.6, 0.1]) {
  let i = 0;
  const fn = () => values[i++ % values.length];
  fn.calls = () => i;
  return fn;
}

describe('templates that name none of the new fields', () => {
  it('come back as they are, with no draw', () => {
    for (const template of allTemplates()) {
      if (template.mirror || template.choices) continue;
      const random = countingRandom();
      const { template: shaped, layout } = resolveTemplateLayout(template, random);
      expect(shaped, template.id).toBe(template);
      expect(layout, template.id).toBeNull();
      expect(random.calls(), template.id).toBe(0);
    }
  });
});

describe('mirroring', () => {
  it('flips every zone rect to exactly the mirrored tiles at every map size', () => {
    const rects = allTemplates().flatMap((t) => [
      ...t.zones.map((z) => z.rect),
      ...(t.choices || []).flatMap((c) => c.options.flatMap((o) => o.zones.map((z) => z.rect))),
    ]);
    for (const rect of rects) {
      for (const [cols, rows] of SIZES) {
        const flipped = new Set(
          [...tilesOf(rect, cols, rows)].map((k) => {
            const [c, r] = k.split(',').map(Number);
            return `${c},${rows - 1 - r}`;
          }),
        );
        expect(tilesOf(mirrorRectY(rect), cols, rows), `${rect} at ${cols}x${rows}`).toEqual(
          flipped,
        );
      }
    }
  });

  it('flips features, reinforcement edges and the escape zone, and never writes the catalog', () => {
    const template = {
      zones: [{ rect: [0, 0, 0.3, 0.4], terrain: { Plain: 1 }, role: 'playerSpawn' }],
      features: [
        { type: 'Ballista', position: 'topRight' },
        { type: 'Throne', position: 'right' },
      ],
      escapeZone: { rect: [0.9, 0, 1, 0.25] },
      reinforcements: {
        spawnEdges: ['right', 'top'],
        waves: [{ turn: 5, count: [1, 2], edges: ['top'] }],
        repeatingWaves: [{ startTurn: 4, every: 2, count: [1, 1], edges: ['bottom', 'left'] }],
        extraWavesByDifficulty: { lunatic: [{ turn: 9, count: [1, 1], edges: ['top', 'right'] }] },
      },
    };
    const before = structuredClone(template);
    const flipped = mirrorTemplateY(template);
    expect(template).toEqual(before);
    expect(flipped.zones[0].rect).toEqual([0, 0.6, 0.3, 1]);
    expect(flipped.features.map((f) => f.position)).toEqual(['bottomRight', 'right']);
    expect(flipped.escapeZone.rect).toEqual([0.9, 0.75, 1, 1]);
    expect(flipped.reinforcements.spawnEdges).toEqual(['right', 'bottom']);
    expect(flipped.reinforcements.waves[0].edges).toEqual(['bottom']);
    expect(flipped.reinforcements.repeatingWaves[0].edges).toEqual(['top', 'left']);
    expect(flipped.reinforcements.extraWavesByDifficulty.lunatic[0].edges).toEqual([
      'bottom',
      'right',
    ]);
  });

  it('a mirrored Corner Camp starts the army in the flipped corner', () => {
    const corner = byId('corner_camp');
    const playerRect = corner.zones.find((z) => z.role === 'playerSpawn').rect;
    const seen = { true: 0, false: 0 };
    for (let seed = 1; seed <= 24; seed++) {
      const config = generateSeededBattle(
        { act: 'act2', objective: 'rout', templateId: 'corner_camp', deployCount: 5, row: 3 },
        data,
        seed * 131,
      );
      seen[config.mirrored]++;
      const zone = tilesOf(
        config.mirrored ? mirrorRectY(playerRect) : playerRect,
        config.cols,
        config.rows,
      );
      for (const p of config.playerSpawns)
        expect(zone.has(`${p.col},${p.row}`), `seed ${seed}`).toBe(true);
    }
    // Both shapes turn up.
    expect(seen.true).toBeGreaterThan(0);
    expect(seen.false).toBeGreaterThan(0);
  });
});

describe('switched-off templates', () => {
  it('are never drawn for a node or a battle, and a battle that names one plays it', () => {
    const off = new Set(
      allTemplates()
        .filter((t) => t.enabled === false)
        .map((t) => t.id),
    );
    expect([...off].sort()).toEqual([...NEW_TEMPLATES].sort());
    for (const act of ['act1', 'act2', 'act3', 'act4']) {
      for (const objective of ['rout', 'seize']) {
        for (let seed = 1; seed <= 60; seed++) {
          installSeed(seed);
          const forNode = pickTemplateForNode(objective, data.mapTemplates, act, false, null);
          const forBattle = pickTemplate(objective, data.mapTemplates, act, {});
          restoreMathRandom();
          expect(off.has(forNode?.id), `${act} ${objective} ${seed}`).toBe(false);
          expect(off.has(forBattle?.id), `${act} ${objective} ${seed}`).toBe(false);
        }
      }
    }
    for (const id of NEW_TEMPLATES) {
      installSeed(3);
      const config = generateBattle(
        { act: 'act3', objective: objectiveOf(id), templateId: id, deployCount: 6, row: 3 },
        data,
      );
      expect(config.templateId).toBe(id);
    }
  });
});

describe('enemy groups', () => {
  it('split every filler, largest remainder first, and never leave a hold pack of one', () => {
    const hold = (share) => ({ id: 'h', share, ai: 'hold', wakeTurn: 4 });
    const chase = (share) => ({ id: 'c', share, ai: 'chase' });
    // 7 × 0.6 = 4.2 and 7 × 0.4 = 2.8: 4 + 2, then the larger remainder (.8) takes the last.
    expect(planGroupCounts([chase(0.6), hold(0.4)], 7)).toEqual([4, 3]);
    // 3 × 0.4 = 1.2 → 1, too few to hold: it charges with the main body.
    expect(planGroupCounts([chase(0.6), hold(0.4)], 3)).toEqual([3, 0]);
    expect(planGroupCounts([chase(0.6), hold(0.4)], 0)).toEqual([0, 0]);
    // A guard group is never folded away, even alone.
    expect(planGroupCounts([{ id: 'g', share: 0.3, ai: 'guard' }, chase(0.7)], 4)).toEqual([1, 3]);
    for (let n = 0; n <= 20; n++) {
      const counts = planGroupCounts(
        [chase(0.5), hold(0.3), { id: 'g', share: 0.2, ai: 'guard' }],
        n,
      );
      expect(counts.reduce((s, v) => s + v, 0)).toBe(n);
      expect(counts[1] === 0 || counts[1] >= MIN_HOLD_GROUP).toBe(true);
    }
  });

  it("stand in their own zone with their group's orders", () => {
    let holds = 0;
    let guards = 0;
    for (const id of NEW_TEMPLATES) {
      for (const act of ['act2', 'act3', 'act4']) {
        for (let seed = 1; seed <= 15; seed++) {
          installSeed(seed * 17);
          const config = generateBattle(
            {
              act,
              objective: objectiveOf(id),
              templateId: id,
              deployCount: 6,
              row: 3,
              difficultyId: 'hard',
            },
            data,
          );
          restoreMathRandom();
          // The zones this battle played: its choices taken, maybe flipped.
          const template = byId(id);
          let zones = [...template.zones];
          for (const choice of template.choices || [])
            zones = zones.concat(choice.options[config.templateChoices[choice.id]].zones);
          if (config.mirrored) zones = zones.map((z) => ({ ...z, rect: mirrorRectY(z.rect) }));
          const groups = zones.filter((z) => z.group);
          for (const spawn of config.enemySpawns.filter((s) => !s.isBoss)) {
            const where = `${id} ${act} seed ${seed} ${spawn.className}`;
            expect(typeof spawn.templateGroup, where).toBe('string');
            const zone = groups.find((z) => z.group.id === spawn.templateGroup);
            expect(zone, where).toBeTruthy();
            expect(
              tilesOf(zone.rect, config.cols, config.rows).has(`${spawn.col},${spawn.row}`),
              where,
            ).toBe(true);
            const ai = zone.group.ai;
            if (spawn.className === 'Cleric') expect(spawn.aiMode, where).toBe('heal');
            else if (ai === 'guard') {
              expect(spawn.aiMode, where).toBe('guard');
              guards++;
            }
            if (spawn.aiMode === 'hold') {
              holds++;
              expect(ai, where).toBe('hold');
              const pack = config.enemySpawns.filter((s) => s.holdPack === spawn.holdPack);
              expect(spawn.holdPack, where).toBeGreaterThanOrEqual(TEMPLATE_GROUP_PACK_BASE);
              expect(spawn.holdPackSize, where).toBe(pack.length);
              expect(pack.length, where).toBeGreaterThanOrEqual(MIN_HOLD_GROUP);
              expect(spawn.holdWakeTurn, where).toBe(zone.group.wakeTurn);
            }
          }
        }
      }
    }
    expect(holds).toBeGreaterThan(0);
    expect(guards).toBeGreaterThan(0);
  });

  it("keep their orders beside the rung's own hold packs on a seize map", () => {
    let rungPacks = 0;
    for (let seed = 1; seed <= 30; seed++) {
      installSeed(seed);
      const config = generateBattle(
        {
          act: 'act3',
          objective: 'seize',
          templateId: 'three_roads_keep',
          deployCount: 6,
          row: 3,
          difficultyId: 'lunatic',
          holdShare: { seize: 0.55 },
        },
        data,
      );
      restoreMathRandom();
      const roadGuards = config.enemySpawns.filter(
        (s) =>
          s.templateGroup === 'road' && s.className !== 'Cleric' && s.className !== 'Necromancer',
      );
      for (const s of roadGuards) expect(s.aiMode, `seed ${seed}`).toBe('guard');
      // The rung's packs (if any) never take a template group's member or its pack ids.
      for (const s of config.enemySpawns.filter((e) => e.aiMode === 'hold')) {
        rungPacks++;
        expect(s.templateGroup, `seed ${seed}`).toBeUndefined();
        expect(s.holdPack).toBeLessThan(TEMPLATE_GROUP_PACK_BASE);
      }
    }
    // Every filler belongs to a group on this map, so the rung forms no pack of its own.
    expect(rungPacks).toBe(0);
  });
});

describe('a template hold pack in the headless battle', () => {
  function cornerBattle(seed) {
    installSeed(seed);
    const battle = new HeadlessBattle(data, {
      act: 'act3',
      objective: 'rout',
      templateId: 'corner_camp',
      battleSeed: 900 + seed,
      deployCount: 6,
      row: 3,
      difficultyId: 'hard',
    });
    battle.init();
    restoreMathRandom();
    return battle;
  }

  it('wakes on its turn at the latest, as the whole pack', () => {
    let proved = 0;
    for (let seed = 1; seed <= 20 && proved < 3; seed++) {
      const battle = cornerBattle(seed);
      const pack = battle.enemyUnits.filter((e) => e.holdPack >= TEMPLATE_GROUP_PACK_BASE);
      if (pack.length < MIN_HOLD_GROUP) continue;
      const wakeTurn = pack[0].holdWakeTurn;
      const holdGroup = byId('corner_camp')
        .choices.flatMap((c) => c.options.flatMap((o) => o.zones))
        .find((z) => z.group?.ai === 'hold').group;
      expect(wakeTurn).toBe(holdGroup.wakeTurn);
      // No threat, no blow: before its turn it holds; on its turn it wakes, every member.
      const quiet = { enemyUnits: battle.enemyUnits, playerUnits: [], threatContext: null };
      expect(wakeHolders({ ...quiet, turn: wakeTurn - 1 })).toEqual([]);
      const woken = wakeHolders({ ...quiet, turn: wakeTurn });
      expect(woken.map((w) => w.unit).sort()).toEqual([...pack].sort());
      expect(woken.every((w) => w.reason === 'turn')).toBe(true);
      proved++;
    }
    expect(proved).toBeGreaterThan(0);
  });
});

describe('generation', () => {
  it('draws the same map for the same seed', () => {
    for (const id of NEW_TEMPLATES) {
      const params = {
        act: 'act3',
        objective: objectiveOf(id),
        templateId: id,
        deployCount: 6,
        row: 3,
      };
      const a = generateSeededBattle(params, data, 4242);
      const b = generateSeededBattle(params, data, 4242);
      expect(JSON.stringify(a), id).toBe(JSON.stringify(b));
    }
  });

  it('every new map passes validateBattleConfig across acts, rungs, seeds and node kinds', () => {
    const failures = [];
    const variants = [{}, { isRecruitBattle: true }, { hasCaravan: true }, { hasVillage: true }];
    let generated = 0;
    for (const id of NEW_TEMPLATES) {
      const template = byId(id);
      for (const act of template.acts || ['act1', 'act2', 'act3', 'act4']) {
        const deployCount = (DEPLOY_LIMITS[act]?.max || 4) + 2;
        for (const difficultyId of ['normal', 'dusk', 'hard', 'lunatic']) {
          for (const variant of variants) {
            for (let seed = 1; seed <= 6; seed++) {
              installSeed(seed * 101 + generated);
              let config;
              try {
                config = generateBattle(
                  {
                    act,
                    objective: objectiveOf(id),
                    templateId: id,
                    deployCount,
                    difficultyId,
                    row: 3,
                    ...variant,
                  },
                  data,
                );
              } catch (error) {
                failures.push(`${id} ${act} ${difficultyId} threw: ${error.message}`);
                continue;
              } finally {
                restoreMathRandom();
              }
              generated++;
              const violations = validateBattleConfig(config, data, {
                expectedPlayerSpawns: deployCount,
              });
              if (violations.length)
                failures.push(`${id} ${act} ${difficultyId}: ${violations.join('; ')}`);
            }
          }
        }
      }
    }
    expect(failures).toEqual([]);
    expect(generated).toBeGreaterThan(500);
  });
});

describe('extra foes (extraEnemies)', () => {
  it('adds its foes over the rolled count, never past the cap, and only for that template', () => {
    const extra = byId('corner_camp').extraEnemies;
    expect(extra).toBeGreaterThan(0);
    // The same template with the field removed: the count the battle rolled on its own.
    const plain = structuredClone(data.mapTemplates);
    delete plain.rout.find((t) => t.id === 'corner_camp').extraEnemies;
    const plainData = { ...data, mapTemplates: plain };
    const foes = (config) => config.enemySpawns.filter((s) => !s.isBoss).length;
    const diffs = [];
    for (const act of ['act2', 'act3', 'act4']) {
      for (let seed = 1; seed <= 12; seed++) {
        const params = {
          act,
          objective: 'rout',
          templateId: 'corner_camp',
          deployCount: 6,
          row: 3,
        };
        const withExtra = generateSeededBattle(params, data, 700 + seed);
        const without = generateSeededBattle(params, plainData, 700 + seed);
        diffs.push(foes(withExtra) - foes(without));
      }
    }
    // Every battle gains the extra foes unless the map's density cap stops them.
    expect(diffs.every((d) => d >= 0 && d <= extra)).toBe(true);
    expect(diffs.filter((d) => d === extra).length).toBeGreaterThan(diffs.length / 2);
  });
});

describe('group roles', () => {
  const tags = (className) => {
    const cd = data.classes.find((c) => c.name === className);
    const profs = (cd?.weaponProficiencies || '').split(',').map((p) => p.trim().split(' ')[0]);
    return {
      ranged: profs.includes('Bows') || profs.includes('Tomes') || profs.includes('Light'),
      mounted: cd?.moveType === 'Cavalry' || cd?.moveType === 'Flying',
      armored: cd?.moveType === 'Armored',
    };
  };
  // Every slot of a template, by group, over many seeds: [group id] -> class names.
  function classesByGroup(id, act) {
    const out = {};
    for (let seed = 1; seed <= 60; seed++) {
      const config = generateSeededBattle(
        { act, objective: objectiveOf(id), templateId: id, deployCount: 6, row: 3 },
        data,
        3000 + seed,
      );
      for (const s of config.enemySpawns.filter((sp) => sp.templateGroup))
        (out[s.templateGroup] ||= []).push(s.className);
    }
    return out;
  }
  const share = (names, tag) => names.filter((n) => tags(n)[tag]).length / names.length;

  it('a ranged group fields far more archers and mages than the groups beside it', () => {
    const byGroup = classesByGroup('three_roads', 'act3');
    expect(share(byGroup.road, 'ranged')).toBeGreaterThan(0.6);
    expect(share(byGroup.main, 'ranged')).toBeLessThan(0.35);
  });

  it('a flank group rides, and a front group wears armour more than the rest', () => {
    const open = classesByGroup('caught_in_the_open', 'act3');
    expect(share([...(open.podTop || []), ...(open.podBottom || [])], 'mounted')).toBeGreaterThan(
      0.6,
    );
    expect(share(open.main, 'mounted')).toBeLessThan(0.45);
    const camps = classesByGroup('two_camps', 'act3');
    expect(share(camps.camp, 'armored')).toBeGreaterThan(share(camps.raiders, 'armored') + 0.15);
  });

  it('every role names only weight tags the generator reads', () => {
    const known = [
      'infantry',
      'cavalry',
      'archer',
      'mage',
      'knight',
      'armored',
      'lance',
      'flying',
      'healer',
    ];
    for (const weights of Object.values(GROUP_ROLES))
      for (const key of Object.keys(weights)) expect(known).toContain(key);
  });
});

describe('the template validator', () => {
  const zone = (extra = {}) => ({ rect: [0, 0, 1, 1], terrain: { Plain: 1 }, ...extra });
  const rout = (template) => ({
    rout: [
      {
        id: 't',
        name: 'T',
        zones: [zone({ role: 'playerSpawn', rect: [0, 0, 0.2, 1] }), ...template.zones],
        ...Object.fromEntries(Object.entries(template).filter(([k]) => k !== 'zones')),
      },
    ],
    seize: [byId('castle_assault')],
    escape: [byId('pursuit_road')],
  });
  const errorsOf = (config) => validateMapTemplatesConfig(config, { strict: false }).errors;

  it('accepts the shipped templates', () => {
    expect(validateMapTemplatesConfig(data.mapTemplates).errors).toEqual([]);
  });

  it('refuses a rout hold group with no wake turn', () => {
    const errors = errorsOf(
      rout({ zones: [zone({ role: 'enemySpawn', group: { id: 'a', share: 1, ai: 'hold' } })] }),
    );
    expect(errors.some((e) => e.includes('wakeTurn is required'))).toBe(true);
  });

  it('refuses several enemy zones where one has no group', () => {
    const errors = errorsOf(
      rout({
        zones: [
          zone({ role: 'enemySpawn', group: { id: 'a', share: 0.5, ai: 'chase' } }),
          zone({ role: 'enemySpawn' }),
        ],
      }),
    );
    expect(errors.some((e) => e.includes('each needs a group'))).toBe(true);
  });

  it('refuses a choice that adds a player zone, a Throne, or a lone option', () => {
    const errors = errorsOf(
      rout({
        zones: [zone({ role: 'enemySpawn' })],
        choices: [
          { id: 'a', options: [{ zones: [zone({ role: 'playerSpawn' })] }, { zones: [] }] },
          {
            id: 'b',
            options: [
              { zones: [], features: [{ type: 'Throne', position: 'right' }] },
              { zones: [] },
            ],
          },
          { id: 'c', options: [{ zones: [] }] },
        ],
      }),
    );
    expect(errors.some((e) => e.includes('may only add an enemySpawn zone with a group'))).toBe(
      true,
    );
    expect(errors.some((e) => e.includes('may not add a Throne'))).toBe(true);
    expect(errors.some((e) => e.includes('at least two options'))).toBe(true);
  });

  it('refuses an unknown group role', () => {
    const errors = errorsOf(
      rout({
        zones: [
          zone({ role: 'enemySpawn', group: { id: 'a', share: 1, ai: 'chase', role: 'sniper' } }),
        ],
      }),
    );
    expect(errors.some((e) => e.includes('.role must be one of'))).toBe(true);
  });

  it('refuses extra foes that are not a whole number from 1 to 4', () => {
    for (const extraEnemies of [0, 5, 1.5, '2']) {
      const errors = errorsOf(rout({ zones: [zone({ role: 'enemySpawn' })], extraEnemies }));
      expect(
        errors.some((e) => e.includes('extraEnemies must be an integer')),
        String(extraEnemies),
      ).toBe(true);
    }
    expect(errorsOf(rout({ zones: [zone({ role: 'enemySpawn' })], extraEnemies: 3 }))).toEqual([]);
  });

  it('refuses a mirror on an unknown axis or over absolute tiles', () => {
    const errors = errorsOf(
      rout({
        zones: [zone({ role: 'enemySpawn' })],
        mirror: 'x',
        reinforcements: { spawnEdges: ['right'], scriptedWaves: [{ turn: 2, spawns: [] }] },
      }),
    );
    expect(errors.some((e) => e.includes('.mirror must be one of'))).toBe(true);
    expect(errors.some((e) => e.includes('scriptedWaves'))).toBe(true);
  });
});
