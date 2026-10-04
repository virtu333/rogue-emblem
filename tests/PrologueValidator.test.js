// validatePrologueConfig (engine/Prologue.js, run by `npm run validate:data`): the
// shipped prologue passes, and each rule fails on its own bad input.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { loadGameData } from './testData.js';
import { validatePrologueConfig } from '../src/engine/Prologue.js';

const data = loadGameData();
const withLines = {
  ...data,
  dialogue: JSON.parse(readFileSync(new URL('../data/dialogue.json', import.meta.url), 'utf8')),
};
const P1 = 'chapters[0] (p1_banner_at_dawn)';

/** The validator's errors for the shipped prologue after one mutation. */
function errorsAfter(mutate, gameData = data) {
  const prologue = structuredClone(data.prologue);
  mutate(prologue);
  return validatePrologueConfig(prologue, gameData).errors;
}
const p1 = (p) => p.chapters[0];

describe('validatePrologueConfig', () => {
  it('the shipped prologue is valid', () => {
    expect(validatePrologueConfig(data.prologue, data)).toEqual({ valid: true, errors: [] });
    // With dialogue.json loaded, every line key it names has lines.
    expect(validatePrologueConfig(data.prologue, withLines)).toEqual({ valid: true, errors: [] });
  });

  describe('the map', () => {
    it('rows are rectangular', () => {
      expect(errorsAfter((p) => (p1(p).map.rows[1] = '. . . . F . .'))).toEqual([
        `${P1}.map row 1 has 7 tiles, expected 8 (rows must be rectangular)`,
      ]);
    });

    it('the legend names real terrain', () => {
      expect(errorsAfter((p) => (p1(p).map.legend.F = 'Woods'))).toEqual([
        `${P1}.map.legend "F" names unknown terrain "Woods"`,
      ]);
    });

    it('every tile is in the legend', () => {
      expect(errorsAfter((p) => (p1(p).map.rows[0] = '. . X . . . . .'))).toEqual([
        `${P1}.map tile (2,0) "X" is not in the legend`,
      ]);
    });
  });

  describe('spawns', () => {
    it('a player spawn is on the map', () => {
      expect(errorsAfter((p) => (p1(p).playerSpawns[0] = { col: 8, row: 2 }))).toContain(
        `${P1}.playerSpawns[0] is off the map`,
      );
    });

    it('a player spawn suits every ground move type (Gaspar rides)', () => {
      expect(
        errorsAfter((p) => {
          p1(p).map.legend.M = 'Mountain';
          p1(p).map.rows[2] = 'M . . T . F . .';
        }),
      ).toEqual([
        `${P1}.playerSpawns[0] (0,2) is impassable for Armored`,
        `${P1}.playerSpawns[0] (0,2) is impassable for Cavalry`,
      ]);
    });

    it('an enemy stands on ground its class can stand on', () => {
      expect(
        errorsAfter((p) => {
          p1(p).map.legend['~'] = 'Water';
          p1(p).map.rows[5] = '. . . . F . F ~';
        }),
      ).toContain(`${P1}.enemies[1] (b) (7,5) is impassable for Infantry`);
    });

    it('the built config passes validateBattleConfig (two enemies on one tile)', () => {
      expect(errorsAfter((p) => Object.assign(p1(p).enemies[1], { col: 4, row: 2 }))).toEqual([
        `${P1}: battle config: enemy spawn overlaps enemy at 4,2`,
      ]);
    });
  });

  describe('authored kits', () => {
    it("an enemy's weapon exists", () => {
      expect(errorsAfter((p) => (p1(p).enemies[0].weapon = 'Iron Axxe'))).toEqual([
        `${P1}.enemies[0] (a).weapon "Iron Axxe" is not in weapons.json`,
      ]);
    });

    it("an enemy's class can wield its weapon", () => {
      expect(errorsAfter((p) => (p1(p).enemies[0].weapon = 'Iron Lance'))).toEqual([
        `${P1}.enemies[0] (a): a Fighter can't wield "Iron Lance"`,
      ]);
    });

    it("an enemy's skills are real, and listed ([] for none)", () => {
      expect(errorsAfter((p) => (p1(p).enemies[0].skills = ['lunaa']))).toEqual([
        `${P1}.enemies[0] (a).skills: unknown skill "lunaa"`,
      ]);
      expect(errorsAfter((p) => delete p1(p).enemies[0].skills)).toEqual([
        `${P1}.enemies[0] (a).skills must be an array ([] for none)`,
      ]);
    });

    it("a hold pack's declared size is its holder count", () => {
      expect(errorsAfter((p) => (p1(p).enemies[1].holdPackSize = 2))).toEqual([
        `${P1}: hold pack 0 has 1 holders but holdPackSize 2`,
      ]);
    });

    it('a unit can wield what it carries', () => {
      expect(errorsAfter((p) => (p.units.Edric.inventory = ['Iron Axe', 'Vulnerary']))).toEqual([
        `units.Edric.inventory: Edric can't wield "Iron Axe" (Axe)`,
      ]);
    });

    it("a unit's items exist", () => {
      expect(
        errorsAfter((p) => (p.units.Edric.inventory = ['Iron Sword', 'Elixir of Plot'])),
      ).toEqual(['units.Edric.inventory: unknown item "Elixir of Plot"']);
    });

    it('a lord is in lords.json', () => {
      expect(errorsAfter((p) => (p.units.Edric.lord = 'Edwin'))).toEqual([
        'units.Edric.lord "Edwin" is not in lords.json',
      ]);
    });

    it('authored stats name every stat', () => {
      expect(errorsAfter((p) => delete p.units.Edric.stats.MOV)).toEqual([
        'units.Edric.stats.MOV must be an integer >= 0',
      ]);
    });
  });

  describe('beats', () => {
    it('use known triggers', () => {
      expect(errorsAfter((p) => (p1(p).beats[0].on = 'selected'))).toEqual([
        `${P1}.beats[0].on "selected" is not a known trigger`,
      ]);
    });

    it("use only their trigger's conditions", () => {
      expect(errorsAfter((p) => (p1(p).beats[0].unit = 'Edric'))).toEqual([
        `${P1}.beats[0]: trigger "battleStart" takes no condition "unit"`,
      ]);
    });

    it("name this chapter's units", () => {
      expect(errorsAfter((p) => (p1(p).beats[1].unit = 'Gaspar'))).toEqual([
        `${P1}.beats[1].unit "Gaspar" names no unit of this chapter`,
      ]);
    });

    it('use known actions, with valid arguments', () => {
      expect(errorsAfter((p) => (p1(p).beats[0].do = [{ shout: 'x' }]))).toEqual([
        `${P1}.beats[0].do[0] must have exactly one of: coach, note, dialogue, gateSelect, gateMove, gateConfirm, highlight, markLesson, grantVision, clearCoach`,
      ]);
      expect(errorsAfter((p) => (p1(p).beats[1].do[1] = { gateMove: { col: 9, row: 2 } }))).toEqual(
        [`${P1}.beats[1].do[1].gateMove is not a tile on the map`],
      );
      expect(
        errorsAfter(
          (p) => (p1(p).beats[2].do[1] = { markLesson: { id: 'terrain', kind: 'mastered' } }),
        ),
      ).toEqual([`${P1}.beats[2].do[1].markLesson.kind must be "shown" or "practised"`]);
    });

    it('have unique ids (once-state is kept by id)', () => {
      expect(errorsAfter((p) => (p1(p).beats[1].id = p1(p).beats[0].id))).toEqual([
        `${P1}.beats[1]: duplicate beat id "p1_select_edric"`,
      ]);
    });
  });

  describe('row 2 and P3 (Phase 2B)', () => {
    const P3 = 'chapters[2] (p3_seer_on_the_road)';
    const p3 = (p) => p.chapters[2];
    const node = (p, id) => p.route.nodes.find((n) => n.id === id);

    it('a line key must have lines in dialogue.json', () => {
      expect(errorsAfter((p) => (p.units.Tamsin.join.line = 'tamsin_mumbles'), withLines)).toEqual([
        'units.Tamsin.join.line "tamsin_mumbles" has no lines in dialogue.json prologue',
      ]);
      expect(errorsAfter((p) => (p3(p).npc.line = 'no_such_line'), withLines)).toEqual([
        `${P3}.npc.line "no_such_line" has no lines in dialogue.json prologue`,
      ]);
    });

    it('a join spec: needs a real item, and needs and lineIfGranted go together', () => {
      expect(errorsAfter((p) => (p.units.Tamsin.join.needs = 'Moon Bow'))).toEqual([
        'units.Tamsin.join.needs "Moon Bow" is not a weapon or consumable',
      ]);
      expect(errorsAfter((p) => delete p.units.Tamsin.join.lineIfGranted)).toEqual([
        'units.Tamsin.join: needs and lineIfGranted go together',
      ]);
      expect(errorsAfter((p) => (p.units.Tamsin.join.mood = 'x'))).toEqual([
        'units.Tamsin.join has unknown field "mood"',
      ]);
    });

    it('an arrival joins at a service node and has a join spec', () => {
      expect(errorsAfter((p) => (p.joins.atNode.prologue_3 = ['Tamsin']))).toEqual([
        'joins.atNode: "prologue_3" is a chapter node (arrivals join at service nodes)',
      ]);
      expect(errorsAfter((p) => delete p.units.Tamsin.join)).toEqual([
        'joins.atNode.prologue_2a: "Tamsin" needs a join spec (units.Tamsin.join)',
        'joins.atNode.prologue_2b: "Tamsin" needs a join spec (units.Tamsin.join)',
      ]);
      expect(errorsAfter((p) => (p.joins.atNode.prologue_9 = ['Tamsin']))).toEqual([
        'joins.atNode: unknown route node "prologue_9"',
      ]);
    });

    it("the NPC: the unit's class, on the map, not in the roster", () => {
      expect(errorsAfter((p) => (p3(p).npc.className = 'Cleric'))).toEqual([
        `${P3}.npc.className must be "Light Sage" (the unit's class)`,
      ]);
      expect(errorsAfter((p) => (p3(p).npc.col = 40))).toContain(`${P3}.npc is off the map`);
      expect(errorsAfter((p) => p3(p).roster.push('Sera'))).toContain(
        `${P3}.npc "Sera" is also in the roster`,
      );
      expect(errorsAfter((p) => (p3(p).npc.unit = 'Nobody'))).toEqual([
        `${P3}.npc.unit "Nobody" is not in units`,
      ]);
    });

    it('rosterItems: an authored unit of the roster, real items', () => {
      expect(errorsAfter((p) => (p3(p).rosterItems = { Tamsin: ['Moon Bow'] }))).toEqual([
        `${P3}.rosterItems.Tamsin: unknown item "Moon Bow"`,
      ]);
      expect(errorsAfter((p) => (p3(p).rosterItems = { Rowan: ['Iron Bow'] }))).toEqual([
        `${P3}.rosterItems: "Rowan" is not an authored unit of this roster`,
      ]);
      expect(errorsAfter((p) => (p3(p).rosterItems = { Tamsin: [] }))).toEqual([
        `${P3}.rosterItems.Tamsin must be a non-empty array of item names`,
      ]);
    });

    it("a route preview is short; a stock is a shop's, 1-8 priced items", () => {
      expect(errorsAfter((p) => (node(p, 'prologue_2b').preview = 'x'.repeat(161)))).toEqual([
        'route.nodes[3] (prologue_2b).preview must be a string of at most 160 characters',
      ]);
      expect(errorsAfter((p) => (node(p, 'prologue_2b').stock = ['Vulnerary']))).toEqual([
        'route.nodes[3] (prologue_2b): only a shop or a ruins node has a stock',
      ]);
      expect(errorsAfter((p) => node(p, 'prologue_2a').stock.push('Moon Bow'))).toEqual([
        'route.nodes[2] (prologue_2a).stock: unknown item "Moon Bow"',
      ]);
      expect(
        errorsAfter((p) => (node(p, 'prologue_2a').stock = Array(9).fill('Vulnerary'))),
      ).toEqual(['route.nodes[2] (prologue_2a).stock must be an array of 1 to 8 item names']);
    });

    it('grantVision and clearCoach take only true', () => {
      const rewind = (p) => p3(p).beats.find((b) => b.id === 'p3_rewind');
      expect(
        errorsAfter((p) => (rewind(p).do.find((a) => 'grantVision' in a).grantVision = 1)),
      ).toEqual([
        `${P3}.beats[${data.prologue.chapters[2].beats.findIndex((b) => b.id === 'p3_rewind')}].do[0].grantVision must be true`,
      ]);
    });
  });

  describe('the watchtower, P4 and the ending (Phase 3)', () => {
    const P4 = 'chapters[3] (p4_quarry_gate)';
    const p4 = (p) => p.chapters.find((c) => c.id === 'p4_quarry_gate');
    const node = (p, id) => p.route.nodes.find((n) => n.id === id);

    it('a deploy rule needs more units than spawns, a min within the spawns, a note id', () => {
      expect(errorsAfter((p) => delete p4(p).deploy)).toEqual([
        `${P4}.roster has more units than playerSpawns (and no deploy rule)`,
      ]);
      expect(errorsAfter((p) => (p4(p).deploy.min = 4))).toEqual([
        `${P4}.deploy.min must be an integer from 1 to the spawn count (3)`,
      ]);
      expect(errorsAfter((p) => (p4(p).deploy.note = 'Read me'))).toEqual([
        `${P4}.deploy.note must be a note id`,
      ]);
      expect(errorsAfter((p) => (p4(p).deploy.max = 3))).toEqual([
        `${P4}.deploy has unknown field "max"`,
      ]);
      expect(errorsAfter((p) => (p4(p).roster = p4(p).roster.slice(0, 3)))).toContain(
        `${P4}.deploy: the roster fits its spawns (nothing to choose)`,
      );
    });

    it('formation tiles are free, passable, on the map and never the throne', () => {
      expect(errorsAfter((p) => (p4(p).formation.tiles[0] = { col: 0, row: 4 }))).toEqual([
        `${P4}.formation.tiles[0] (0,4) is already taken`,
      ]);
      expect(errorsAfter((p) => (p4(p).formation.tiles[0] = { col: 9, row: 0 }))).toContain(
        `${P4}.formation.tiles[0] (9,0) is the throne`,
      );
      expect(errorsAfter((p) => (p4(p).formation.tiles[0] = { col: 0, row: 0 }))).toContain(
        `${P4}.formation.tiles[0] (0,0) is impassable for Infantry`,
      );
      expect(errorsAfter((p) => (p4(p).formation.tiles[0] = { col: 13, row: 4 }))).toEqual([
        `${P4}.formation.tiles[0] is off the map`,
      ]);
      expect(errorsAfter((p) => (p4(p).formation = { tiles: [] }))).toEqual([
        `${P4}.formation.tiles must be a non-empty array of tiles`,
      ]);
    });

    it("the chapter's boss is the prologue's boss, field by field", () => {
      const varro = (p) => p4(p).enemies.find((e) => e.isBoss);
      expect(errorsAfter((p) => (varro(p).weapon = 'Steel Axe'))).toEqual([
        `${P4}: boss weapon "Steel Axe" differs from boss.weapon "Iron Axe"`,
      ]);
      expect(errorsAfter((p) => (p.boss.epithet = ''))).toEqual([
        'boss.epithet must be a string of at most 60 characters',
      ]);
      expect(errorsAfter((p) => (p.boss.portrait = 'x'))).toEqual([
        'boss has unknown field "portrait"',
      ]);
      expect(errorsAfter((p) => (p4(p).enemies.find((e) => !e.isBoss).isBoss = true))).toContain(
        `${P4}: at most one enemy isBoss`,
      );
    });

    it('a ruins node may hold the stock; a node’s lines must have lines', () => {
      expect(node(data.prologue, 'prologue_4').type).toBe('ruins');
      expect(errorsAfter((p) => node(p, 'prologue_4').stock.push('Moon Bow'))).toEqual([
        'route.nodes[5] (prologue_4).stock: unknown item "Moon Bow"',
      ]);
      expect(errorsAfter((p) => (node(p, 'prologue_4').lines = 'no_vision'), withLines)).toEqual([
        'route.nodes[5] (prologue_4).lines "no_vision" has no lines in dialogue.json prologue',
      ]);
    });

    it('the ending: scenes with lines, a cue id, a boolean shake, a known veil, a track', () => {
      expect(errorsAfter((p) => (p.ending.scenes[0].veil = 'eclipse'))).toEqual([
        'ending.scenes[0].veil must be one of hollow_sun, thread',
      ]);
      expect(errorsAfter((p) => (p.ending.scenes[0].shake = 'hard'))).toEqual([
        'ending.scenes[0].shake must be true or false',
      ]);
      expect(errorsAfter((p) => (p.ending.scenes[0].cue = 'The Eclipse'))).toEqual([
        'ending.scenes[0].cue must be a stinger name',
      ]);
      expect(
        errorsAfter((p) => (p.ending.scenes[1].dialogue = 'ending_nowhere'), withLines),
      ).toEqual([
        'ending.scenes[1].dialogue "ending_nowhere" has no lines in dialogue.json prologue',
      ]);
      expect(errorsAfter((p) => (p.ending.scenes = []))).toEqual([
        'ending.scenes must be a non-empty array',
      ]);
      expect(errorsAfter((p) => (p.ending.dialogue = 'ending_east'))).toEqual([
        'ending has both dialogue and scenes (scenes replace the legacy dialogue)',
      ]);
      expect(errorsAfter((p) => (p.ending.music = 'Explore Deep'))).toEqual([
        'ending.music must be a music track key (music_...)',
      ]);
    });

    it("forecastOpened may name the target's terrain (the throne lesson)", () => {
      const throne = (p) => p4(p).beats.find((b) => b.id === 'p4_throne');
      expect(throne(data.prologue)).toMatchObject({ targetTerrain: 'Throne' });
      expect(errorsAfter((p) => (throne(p).targetTerrain = 'Seat'))).toHaveLength(1);
    });
  });

  describe('the rest of the file', () => {
    it('a prologue boss is in no real act boss pool', () => {
      const boss = (name, className, weapon) => ({
        name,
        className,
        level: 1,
        weapon,
        epithet: 'x',
      });
      expect(
        errorsAfter((p) => (p.boss = boss('Iron Captain', 'Cavalier', 'Iron Lance'))),
      ).toContain('boss "Iron Captain" is in the real act1 boss pool (prologue bosses stay out)');
      expect(errorsAfter((p) => (p.boss = boss('Captain Varro', 'Fighter', 'Iron Axe')))).toEqual(
        [],
      );
    });

    it('a chapter has no keys for unannounced arrivals', () => {
      expect(errorsAfter((p) => (p1(p).reinforcements = { waves: [] }))).toEqual([
        `${P1} has unknown field "reinforcements"`,
      ]);
    });

    it('joins name known units and chapters', () => {
      expect(
        errorsAfter((p) => (p.joins = { afterChapter: { p1_banner_at_dawn: ['old_knight'] } })),
      ).toEqual([]);
      expect(errorsAfter((p) => (p.joins = { afterChapter: { p9: ['Rowan'] } }))).toEqual([
        'joins.afterChapter: unknown chapter "p9"',
        'joins.afterChapter.p9: unknown unit "Rowan"',
      ]);
    });

    it('the seed is an integer', () => {
      expect(errorsAfter((p) => (p.seed = 'x'))).toEqual(['seed must be an integer']);
    });
  });
});
