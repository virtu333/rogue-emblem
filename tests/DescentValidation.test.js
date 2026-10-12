// validateDescentConfig (docs/specs/act-v-descent.md §9.1): the shipped route passes, and each
// check refuses one planted bad entry (so a broken route can never reach validate:data green).
import { describe, it, expect } from 'vitest';
import { loadGameData } from './testData.js';
import { validateDescentConfig } from '../src/engine/Descent.js';

const data = loadGameData();
const validate = (config, overrides = {}) =>
  validateDescentConfig(config, { ...data, ...overrides });
const lieutenant = (config) => config.routes.lieutenant;
const entity = (config) => config.routes.entity;

/** Plant one bug; the validator must refuse it with a message containing `needle`. */
function plant(mutate, needle, overrides = {}) {
  const config = structuredClone(data.descent);
  const extra = mutate(config) || {};
  const result = validate(config, { ...overrides, ...extra });
  expect(result.valid, `expected a refusal containing "${needle}"`).toBe(false);
  expect(result.errors.join('\n')).toContain(needle);
}

describe('the shipped descent.json', () => {
  it('passes, and ships switched off', () => {
    const result = validate(structuredClone(data.descent));
    expect(result.errors).toEqual([]);
    expect(data.descent.enabled).toBe(false);
  });

  it('passes with Dusk reaching the Descent (as #315 makes it)', () => {
    const difficulty = structuredClone(data.difficulty);
    difficulty.modes.dusk.actsIncluded = ['act1', 'act2', 'act3', 'act4', 'finalBoss'];
    expect(validate(structuredClone(data.descent), { difficulty }).errors).toEqual([]);
  });
});

describe('rungs and finales', () => {
  it('refuses a rung that reaches the Descent with no route', () => {
    plant((c) => delete c.routeByRung.hard, 'hard reaches the Descent and needs a route');
  });

  it('refuses a route id that names no route, and an unknown rung', () => {
    plant((c) => (c.routeByRung.hard = 'nowhere'), 'names no route "nowhere"');
    plant((c) => (c.routeByRung.heroic = 'entity'), 'routeByRung.heroic: is not a rung');
  });

  it('refuses a route whose finale is not the rung’s difficultyFilter pick', () => {
    plant((c) => (c.routeByRung.hard = 'lieutenant'), '"lieutenant" is not hard\'s finale pick');
    plant((c) => (c.routeByRung.normal = 'entity'), '"entity" is not normal\'s finale pick');
  });

  it('refuses a last node whose boss is not the route’s finale', () => {
    plant(
      (c) => (entity(c).rows.at(-1).nodes[0].boss = 'The Lieutenant'),
      'is not the route\'s "entity"',
    );
  });
});

describe('rows and nodes', () => {
  it('refuses a first or last row holding more than one node', () => {
    plant(
      (c) => lieutenant(c).rows[0].nodes.push({ key: 'extra', type: 'ruins' }),
      'the first row holds exactly one node',
    );
    plant(
      (c) => lieutenant(c).rows.at(-1).nodes.push({ key: 'extra', type: 'ruins' }),
      'the last row holds exactly one node',
    );
  });

  it('refuses a last node that is not the finale, and a finale anywhere else', () => {
    plant(
      (c) => (lieutenant(c).rows.at(-1).nodes[0].bossRole = 'gate'),
      'the last node is the finale',
    );
    plant(
      (c) => (entity(c).rows[4].nodes[0].bossRole = 'finale'),
      'only the last node is the finale',
    );
    plant(
      (c) => (lieutenant(c).rows.at(-1).nodes[0] = { key: 'ruins_end', type: 'ruins' }),
      'the last node is the finale boss',
    );
  });

  it('refuses a duplicate key, an unknown key and an unknown type', () => {
    plant((c) => (lieutenant(c).rows[2].nodes[0].key = 'stair'), 'key "stair" is used twice');
    plant((c) => (lieutenant(c).rows[2].nodes[0].colour = 'red'), 'unknown key "colour"');
    plant((c) => (lieutenant(c).rows[3].nodes[0].type = 'shop'), 'type must be one of');
  });

  it('refuses a field another node type owns', () => {
    plant(
      (c) => (lieutenant(c).rows[1].nodes[1].fallable = true),
      'a event node takes no fallable',
    );
    plant(
      (c) => (lieutenant(c).rows[0].nodes[0].eventPool = 'descent'),
      'a battle node takes no eventPool',
    );
    plant(
      (c) => (lieutenant(c).rows[2].nodes[0].bossRole = 'gate'),
      'a battle node takes no bossRole',
    );
  });

  it('refuses the start marked fallable (it can never fall)', () => {
    plant((c) => (lieutenant(c).rows[0].nodes[0].fallable = true), 'the first node can never fall');
  });

  it('refuses an event node with no pool, a boss with no role, a battle with no map', () => {
    plant(
      (c) => delete lieutenant(c).rows[1].nodes[1].eventPool,
      'an event node names its eventPool',
    );
    plant((c) => delete entity(c).rows[4].nodes[0].bossRole, 'bossRole must be one of');
    plant(
      (c) => delete lieutenant(c).rows[0].nodes[0].setPiece,
      'names one setPiece or one templateId',
    );
    plant(
      (c) => (lieutenant(c).rows[0].nodes[0].templateId = 'eldritch_sanctum'),
      'names one setPiece or one templateId',
    );
  });

  it('refuses text over its limit', () => {
    plant(
      (c) => (lieutenant(c).rows[0].nodes[0].title = 'x'.repeat(31)),
      'title is over 30 characters',
    );
    plant((c) => (lieutenant(c).rows[0].nodes[0].preview = 'x'.repeat(161)), 'preview is over 160');
  });

  it('refuses a malformed oneOf', () => {
    plant(
      (c) => (lieutenant(c).rows[2].nodes[0] = { oneOf: [lieutenant(c).rows[2].nodes[0]] }),
      'oneOf must list at least two nodes',
    );
    plant((c) => {
      const vigil = lieutenant(c).rows[2].nodes[0];
      lieutenant(c).rows[2].nodes[0] = {
        oneOf: [vigil, { ...vigil, key: 'vigil_b' }],
        weights: [1],
      };
    }, 'weights must give each oneOf node');
    plant((c) => {
      const stair = lieutenant(c).rows[0].nodes[0];
      lieutenant(c).rows[0].nodes[0] = { oneOf: [stair, { ...stair, key: 'stair_b' }] };
    }, "the first row's node is fixed (no oneOf)");
  });

  it('refuses a bad levelOffset', () => {
    plant((c) => (lieutenant(c).levelOffset = [3, 1]), 'levelOffset must be [lo, hi]');
    plant((c) => (lieutenant(c).levelOffset = [0, 11]), 'levelOffset must be [lo, hi]');
  });
});

describe('edges and reachability', () => {
  /** The lieutenant road with a second fork right after the first: two multi-node rows meet. */
  const twoForks = (c) => {
    const battle = (key) => ({ key, type: 'battle', setPiece: 'old_kings_stair' });
    lieutenant(c).rows.splice(2, 0, { nodes: [battle('a'), battle('b')] });
    lieutenant(c).rows[1].nodes[0].edges = ['a'];
    lieutenant(c).rows[1].nodes[1].edges = ['b'];
    return lieutenant(c).rows;
  };

  it('accepts two forks joined by their own edges', () => {
    const config = structuredClone(data.descent);
    twoForks(config);
    expect(validate(config).errors).toEqual([]);
  });

  it('refuses two multi-node rows with no edges between them', () => {
    plant((c) => {
      const rows = twoForks(c);
      delete rows[1].nodes[1].edges;
    }, 'needs edges: the next row holds more than one node');
  });

  it('refuses an edge to an unknown key and a lane jump', () => {
    plant((c) => (twoForks(c)[1].nodes[0].edges = ['nowhere']), 'edge "nowhere" names no node');
    plant((c) => {
      const rows = twoForks(c);
      rows[1].nodes[0].edges = ['b'];
      rows[1].nodes[1].edges = ['a'];
    }, 'more than one lane away');
  });

  it('refuses crossing edges between two three-node rows', () => {
    const battle = (key, edges) => ({ key, type: 'battle', setPiece: 'old_kings_stair', edges });
    const threeRows = (c, crossing) => {
      const rows = lieutenant(c).rows;
      // fork (lanes 1, 3) -> x y z (lanes 1, 2, 3) -> p q r -> the Vigil
      rows[1].nodes[0].edges = ['x', 'y'];
      rows[1].nodes[1].edges = ['z'];
      rows.splice(
        2,
        0,
        {
          nodes: [
            battle('x', crossing ? ['q'] : ['p']),
            battle('y', crossing ? ['p'] : ['q']),
            battle('z', ['r']),
          ],
        },
        {
          nodes: ['p', 'q', 'r'].map((key) => ({
            key,
            type: 'battle',
            setPiece: 'old_kings_stair',
          })),
        },
      );
    };
    const fine = structuredClone(data.descent);
    threeRows(fine, false);
    expect(validate(fine).errors).toEqual([]);
    plant((c) => threeRows(c, true), 'crosses another edge');
  });

  it('refuses an edge on a row that fans out (a single node joins every node)', () => {
    plant((c) => (lieutenant(c).rows[0].nodes[0].edges = ['column']), 'a single node fans out');
  });

  it('refuses a node that cannot be reached', () => {
    plant((c) => {
      const rows = twoForks(c);
      rows[1].nodes[0].edges = ['a'];
      rows[1].nodes[1].edges = ['a'];
    }, 'cannot be reached from the start');
  });
});

describe('references', () => {
  it('refuses an unknown set piece, template and boss', () => {
    plant(
      (c) => (lieutenant(c).rows[0].nodes[0].setPiece = 'no_such_piece'),
      'unknown set piece "no_such_piece"',
    );
    plant(
      (c) => (entity(c).rows.at(-1).nodes[0].templateId = 'no_such_map'),
      'template "no_such_map" is not a seize template',
    );
    plant(
      (c) => (entity(c).rows[4].nodes[0].boss = 'The Emperor'),
      'boss "The Emperor" is not in enemies.json',
    );
  });

  it('refuses a set piece not fought in the Descent (its acts)', () => {
    const setPieces = structuredClone(data.setPieces);
    setPieces.setPieces.find((p) => p.id === 'old_kings_stair').acts = ['act4'];
    plant(() => ({ setPieces }), 'old_kings_stair is not fought in finalBoss');
  });

  it('refuses a set piece broken at a rung the route serves (a class gate)', () => {
    // A gate the Descent reaches is fine; one past every act refuses the class on that rung.
    const reached = structuredClone(data.difficulty);
    reached.modes.lunatic.enemyClassEarliestAct = { Sage: 'postAct' };
    expect(validate(structuredClone(data.descent), { difficulty: reached }).errors).toEqual([]);
    const never = structuredClone(data.difficulty);
    never.modes.lunatic.enemyClassEarliestAct = { Sage: 'never' };
    plant(() => ({ difficulty: never }), "Sage in finalBoss breaks lunatic's gate");
  });

  it('refuses a template for another objective or act, and a boss-only map off a boss', () => {
    plant(
      (c) => (entity(c).rows.at(-1).nodes[0].templateId = 'act4_boss_intent_bastion'),
      'is not fought in finalBoss',
    );
    plant((c) => {
      entity(c).rows[2].nodes[0] = {
        key: 'vigil',
        type: 'battle',
        templateId: 'eldritch_sanctum',
        objective: 'seize',
      };
    }, 'is for boss nodes only');
  });

  it('refuses an objective the set piece cannot serve', () => {
    // The stair has no boss seat: a defeat of its boss cannot be fought there.
    plant((c) => {
      entity(c).rows[4].nodes[0].setPiece = 'old_kings_stair';
    }, 'as a defeat of its boss');
    plant((c) => {
      lieutenant(c).rows.at(-1).nodes[0].setPiece = 'old_kings_stair';
    }, 'is not a seize map');
    plant(
      (c) => (lieutenant(c).rows[0].nodes[0].objective = 'escape'),
      'objective must be one of seize, defeat',
    );
    plant(
      (c) => (lieutenant(c).rows[2].nodes[0].objective = 'defeat'),
      'only a boss node is fought as a defeat',
    );
  });
});

describe('event pools', () => {
  it('refuses a pool no event can fill on every path', () => {
    const events = structuredClone(data.events);
    // Once per run, the Entity road's two pooled nodes (the fork and the Landing) need two.
    events.events.find((e) => e.id === 'came_this_far').oncePerRun = true;
    events.events = events.events.filter(
      (e) => !['last_lantern', 'seers_last_page'].includes(e.id),
    );
    plant(
      () => ({ events }),
      'event pool "descent" has 1 event(s) every run can meet; a path can hold 2',
    );
  });

  it('a pool on one row only needs one once-per-run event (the Lieutenant road)', () => {
    const events = structuredClone(data.events);
    events.events.find((e) => e.id === 'came_this_far').oncePerRun = true;
    const config = structuredClone(data.descent);
    delete config.routes.entity;
    config.routeByRung.hard = 'lieutenant';
    config.routeByRung.lunatic = 'lieutenant';
    const result = validate(config, { events });
    expect(result.errors.filter((e) => e.includes('event pool'))).toEqual([]);
  });

  it('refuses a pool whose events all carry a requirement, or name no such pool', () => {
    const events = structuredClone(data.events);
    for (const event of events.events.filter((e) => e.pool === 'descent'))
      event.requires = { minRow: 1 };
    plant(() => ({ events }), 'event pool "descent" has 0 event(s)');
    plant(
      (c) => (lieutenant(c).rows[1].nodes[1].eventPool = 'elsewhere'),
      'event pool "elsewhere" has 0 event(s)',
    );
  });
});

describe('the rite block (§4: numbers only, read later)', () => {
  it('refuses tiers that are not contiguous from 0, an open tier with a max, an unknown phase', () => {
    // The expected min is the data's (the first tier's max + 1), so a retune of the bands moves
    // no assertion; the plant skips one word past it.
    const contiguous = data.descent.rite.bands[0].max + 1;
    plant((c) => (c.rite.bands[1].min = contiguous + 1), `min must be ${contiguous}`);
    plant((c) => (c.rite.bands.at(-1).max = 99), 'the last tier is open');
    plant((c) => (c.rite.startByPhase.dusk = 1), '"dusk" is not a phase');
    plant((c) => delete c.rite.startByPhase.hollow, 'names no words for "hollow"');
    plant((c) => (c.rite.mods.shattered = {}), '"shattered" is not a tier');
    plant((c) => (c.rite.perWordLevel = 0), 'rite.perWordLevel: must be a whole number > 0');
  });
});
