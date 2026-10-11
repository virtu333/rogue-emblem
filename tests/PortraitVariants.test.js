// Portrait variety: assignment (deterministic, de-duplicated, gender-aware,
// never Math.random), legacy load, promotion continuity, the one resolver,
// enemy faces, and the lazy canvas textures.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PORTRAIT_VARIANTS as table,
  assignPortraitVariant,
  assignPortraitVariants,
  backfillPortraitVariants,
  choosePortraitPerson,
  displayedPerson,
  isFemaleOnlyClass,
  chooseEnemyFace,
  nameGender,
  portraitPeopleForClass,
  stableHash,
  variantPortraitId,
} from '../src/engine/PortraitVariants.js';
import { RunManager } from '../src/engine/RunManager.js';
import { createUnit, promoteUnit } from '../src/engine/UnitManager.js';
import {
  PC98_MANIFEST,
  isVariantPortrait,
  portraitCanvasFrame,
  portraitIdForUnit,
  setPortraitArtMode,
  variantDefaultId,
  variantTextureKey,
} from '../src/ui/portraitArt.js';
import { dialoguePortraitKey, unitPortraitKey } from '../src/ui/RebuiltPortraits.js';
import { ceremonyPortrait } from '../src/ui/ceremonyDom.js';
import { unitPortrait } from '../src/ui/unitPortrait.js';
import {
  loadVariantTexture,
  releaseVariantTextures,
  variantTextureKeys,
} from '../src/ui/portraitTextures.js';
import { battleSpawnKey, placeBattlePortrait } from '../src/ui/BattlePortraitVariants.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const classData = (name) => data.classes.find((c) => c.name === name);
const person = (id) => table.identities[id];

function unitOf(className, name, extra = {}) {
  return { name, className, faction: 'player', tier: classData(className)?.tier, ...extra };
}

/** Math.random must never be read by portrait code (it is the battle RNG). */
function forbidRandom() {
  return vi.spyOn(Math, 'random').mockImplementation(() => {
    throw new Error('portrait code read Math.random');
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  setPortraitArtMode(null);
});

describe('variant table', () => {
  const playerClasses = data.classes
    .filter(
      (c) =>
        ![
          'Lord',
          'Tactician',
          'Ranger',
          'Light Sage',
          'Chevalier',
          'Sky Lancer',
          'Sentinel',
        ].includes(c.name),
    )
    .filter(
      (c) =>
        !c.promotesFrom ||
        ![
          'Lord',
          'Tactician',
          'Ranger',
          'Light Sage',
          'Chevalier',
          'Sky Lancer',
          'Sentinel',
        ].includes(c.promotesFrom),
    )
    .filter(
      (c) =>
        ![
          'Zombie',
          'Revenant',
          'Dragon',
          'Dragon Lord',
          'Necromancer',
          'Skeleton',
          'Entity',
        ].includes(c.name),
    )
    .map((c) => c.name);

  it('gives every recruitable class four to six people (ten where two lines promote into it)', () => {
    // Cross promotions: flyers (Pegasus Knight <-> Wyvern Rider) and the Soldier, whose
    // Duelists and Paladins keep their own faces beside the myrmidon and cavalier lines.
    const shared = ['Falcon Knight', 'Wyvern Lord', 'Duelist', 'Paladin'];
    for (const name of playerClasses) {
      const people = portraitPeopleForClass(name);
      const max = shared.includes(name) ? 10 : 6;
      expect(people.length, name).toBeGreaterThanOrEqual(4);
      expect(people.length, name).toBeLessThanOrEqual(max);
      expect(new Set(people).size, name).toBe(people.length);
    }
  });

  it('draws each person in every class of their line (promotion keeps the face)', () => {
    for (const [id, p] of Object.entries(table.identities)) {
      const line = data.classes.find((c) => c.name === Object.keys(p.renders)[0]);
      expect(line, id).toBeTruthy();
      const base = line.promotesFrom ? classData(line.promotesFrom) : line;
      const promotions = [base.promotesTo].flat().filter(Boolean);
      for (const cls of [base.name, ...promotions])
        expect(p.renders[cls], `${id} as ${cls}`).toBeTruthy();
    }
  });

  it('gives every enemy class with a portrait four faces', () => {
    for (const [cls, faces] of Object.entries(table.enemy)) {
      expect(faces.length, cls).toBe(4);
      expect(faces[0]).toBe(`enemy_${cls.toLowerCase().replace(/ /g, '_')}`);
    }
  });

  it('points only at portraits that exist, variants lazily loaded', () => {
    const ids = [
      ...Object.values(table.identities).flatMap((p) => Object.values(p.renders)),
      ...Object.values(table.enemy).flat(),
    ];
    for (const id of ids) {
      expect(PC98_MANIFEST.portraits[id], id).toBeTruthy();
      if (id.includes('__')) {
        expect(isVariantPortrait(id), id).toBe(true);
        expect(PC98_MANIFEST.portraits[id].frame, id).toBeUndefined();
      }
    }
  });

  it('knows the gender of every recruit pool name (or lists it as either)', async () => {
    const { NAME_GENDERS } = await import('../tools/art/portrait-variants/catalog.mjs');
    const listed = new Set([...NAME_GENDERS.m, ...NAME_GENDERS.f, ...NAME_GENDERS.n]);
    const names = Object.values(data.recruits.namePool).flat();
    expect(names.filter((n) => !listed.has(n))).toEqual([]);
    expect(nameGender('Bram')).toBe('m');
    expect(nameGender('Hedda')).toBe('f');
    expect(nameGender('Bram 2')).toBe('m');
    expect(nameGender('Shade')).toBeNull();
  });
});

describe('assignment', () => {
  it('is a stable hash of seed, name and class', () => {
    const spy = forbidRandom();
    const a = choosePortraitPerson({ name: 'Bram', className: 'Fighter', seed: 7 });
    const b = choosePortraitPerson({ name: 'Bram', className: 'Fighter', seed: 7 });
    expect(a).toBe(b);
    expect(stableHash('x')).toBe(stableHash('x'));
    expect(spy).not.toHaveBeenCalled();
  });

  it('spreads across the pool over runs', () => {
    const seen = new Set();
    for (let seed = 0; seed < 200; seed++)
      seen.add(choosePortraitPerson({ name: 'Ren', className: 'Archer', seed }));
    expect(seen.size).toBe(portraitPeopleForClass('Archer').length);
  });

  it('matches the face to the name (Bram and Roderick are men, Hedda a woman)', () => {
    for (let seed = 0; seed < 50; seed++) {
      expect(
        person(choosePortraitPerson({ name: 'Bram', className: 'Fighter', seed })).gender,
      ).toBe('m');
      expect(
        person(choosePortraitPerson({ name: 'Roderick', className: 'Warrior', seed })).gender,
      ).toBe('m');
      expect(
        person(choosePortraitPerson({ name: 'Hedda', className: 'Fighter', seed })).gender,
      ).toBe('f');
    }
  });

  it('never repeats a face in the roster while the class has another', () => {
    const spy = forbidRandom();
    const roster = [];
    const names = ['Kestrel', 'Hollis', 'Morrow', 'Rook', 'Lark'];
    for (const name of names) {
      const unit = unitOf('Mercenary', name);
      assignPortraitVariant(unit, { roster, seed: 3 });
      roster.push(unit);
    }
    const people = roster.map((u) => u.portraitVariant);
    expect(new Set(people).size).toBe(
      Math.min(names.length, portraitPeopleForClass('Mercenary').length),
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("Bram and Roderick (the playtest pair) get different Fighters' faces", () => {
    for (let seed = 0; seed < 100; seed++) {
      const bram = unitOf('Fighter', 'Bram');
      const roderick = unitOf('Fighter', 'Roderick');
      assignPortraitVariants([bram, roderick], { roster: [], seed });
      expect(bram.portraitVariant).not.toBe(roderick.portraitVariant);
      expect(portraitIdForUnit(bram, data)).not.toBe(portraitIdForUnit(roderick, data));
    }
  });

  it('prefers a face nobody fell wearing, but repeats rather than fail', () => {
    const fallen = [unitOf('Thief', 'Nyx', { portraitVariant: 'thief_c' })];
    const u = unitOf('Thief', 'Tess');
    assignPortraitVariant(u, { roster: [], fallen, seed: 1 });
    expect(u.portraitVariant).not.toBe('thief_c');
    const crowd = portraitPeopleForClass('Thief').map((p, i) =>
      unitOf('Thief', `T${i}`, { portraitVariant: p }),
    );
    const extra = unitOf('Thief', 'Pim');
    assignPortraitVariant(extra, { roster: crowd, seed: 1 });
    expect(portraitPeopleForClass('Thief')).toContain(extra.portraitVariant);
  });

  it('backfills a roster in order without repeating a face', () => {
    const roster = ['Galvin', 'Bram', 'Halvar'].map((n) => unitOf('Fighter', n));
    expect(backfillPortraitVariants(roster, { seed: 2 })).toBe(3);
    expect(new Set(roster.map((u) => u.portraitVariant)).size).toBe(3);
    expect(backfillPortraitVariants(roster, { seed: 2 })).toBe(0);
  });

  it('is idempotent and leaves lords and bosses alone', () => {
    const u = unitOf('Cleric', 'Iona', { portraitVariant: 'cleric_b' });
    expect(assignPortraitVariant(u, { seed: 9 })).toBe('cleric_b');
    const lord = { name: 'Edric', className: 'Lord', isLord: true, faction: 'player' };
    expect(assignPortraitVariant(lord, { seed: 9 })).toBeNull();
    expect(lord.portraitVariant).toBeUndefined();
    const boss = { name: 'Warchief', className: 'Berserker', isBoss: true, faction: 'enemy' };
    expect(assignPortraitVariant(boss, { spawnKey: 'x' })).toBeNull();
    expect(portraitIdForUnit(boss, data)).toBe('boss_warchief');
  });
});

describe('promotion and reclass', () => {
  it('keeps the same person through promotion (base and cross promotions)', () => {
    const fighter = createUnit(classData('Fighter'), 5, data.weapons, { name: 'Bram' });
    fighter.portraitVariant = 'fighter_b';
    expect(portraitIdForUnit(fighter, data)).toBe(person('fighter_b').renders.Fighter);
    promoteUnit(
      fighter,
      classData('Warrior'),
      classData('Warrior').promotionBonuses || {},
      data.skills,
    );
    expect(fighter.className).toBe('Warrior');
    expect(fighter.portraitVariant).toBe('fighter_b');
    expect(portraitIdForUnit(fighter, data)).toBe('generic_warrior');
    const peg = unitOf('Pegasus Knight', 'Elysia', { portraitVariant: 'pegasus_c' });
    peg.className = 'Wyvern Lord';
    expect(portraitIdForUnit(peg, data)).toBe(person('pegasus_c').renders['Wyvern Lord']);
  });

  it('the promotion rite and path chooser show this unit, before and after', async () => {
    const { projectUnit } = await import('../src/ui/growthContent.js');
    const u = unitOf('Fighter', 'Hedda', { portraitVariant: 'fighter_d' });
    expect(portraitIdForUnit(projectUnit(u), data)).toBe(person('fighter_d').renders.Fighter);
    const src = (await import('fs')).readFileSync('src/ui/PromotionPathChooser.js', 'utf8');
    expect(src).toMatch(/portraitVariant: unit\.portraitVariant/);
  });

  it("a reclass across lines keeps the unit's own face (a Hero sealed into a Swordmaster)", () => {
    const hero = unitOf('Hero', 'Gaspar', { portraitVariant: 'mercenary_b', tier: 'promoted' });
    const before = portraitIdForUnit(hero, data);
    expect(before).toBe(person('mercenary_b').renders.Hero);
    hero.className = 'Swordmaster';
    expect(portraitIdForUnit(hero, data)).toBe(before);
    expect(variantPortraitId(hero)).toBe(before);
    expect(hero.portraitVariant).toBe('mercenary_b');
    // back into the line: the drawing for that class again
    hero.className = 'Mercenary';
    expect(variantPortraitId(hero)).toBe(person('mercenary_b').renders.Mercenary);
  });

  it("the kept face matches the unit's tier, base or promoted", () => {
    const merc = unitOf('Mercenary', 'Kestrel', { portraitVariant: 'mercenary_a' });
    merc.className = 'Myrmidon';
    expect(variantPortraitId(merc)).toBe(person('mercenary_a').renders.Mercenary);
    const hero = unitOf('Hero', 'Gaspar', { portraitVariant: 'mercenary_a' });
    hero.className = 'Duelist';
    expect(variantPortraitId(hero)).toBe(person('mercenary_a').renders.Hero);
  });

  it('a promoted unit sealed out of its line keeps the drawing of the class it held', async () => {
    const { reclassUnit } = await import('../src/engine/UnitManager.js');
    const cases = [
      ['Berserker', 'Swordmaster', 'fighter_a'],
      ['Dark Knight', 'Duelist', 'cavalier_a'],
      ['Bishop', 'Sage', 'cleric_b'],
    ];
    for (const [from, to, id] of cases) {
      const base = classData(classData(from).promotesFrom);
      const u = createUnit(base, 10, data.weapons, { name: 'Ren' });
      promoteUnit(u, classData(from), classData(from).promotionBonuses || {}, data.skills);
      u.portraitVariant = id;
      const held = person(id).renders[from];
      expect(portraitIdForUnit(u, data)).toBe(held);
      reclassUnit(u, classData(to), classData(from), data.classes, data.skills);
      expect(u.className).toBe(to);
      expect(variantPortraitId(u), `${from} sealed to ${to}`).toBe(held);
      // back into a drawn class: the class's own drawing, the memory cleared
      reclassUnit(u, classData(from), classData(to), data.classes, data.skills);
      expect(u.portraitFaceClass).toBeUndefined();
      expect(variantPortraitId(u)).toBe(held);
    }
  });

  it('every person keeps the same face across every other class line', () => {
    const faces = new Set();
    for (const [id, p] of Object.entries(table.identities)) {
      for (const cls of Object.keys(table.classes)) {
        if (isFemaleOnlyClass(cls) && p.gender !== 'f') continue;
        const u = unitOf(cls, 'Ren', { portraitVariant: id });
        const shown = variantPortraitId(u);
        expect(Object.values(p.renders), `${id} as ${cls}`).toContain(shown);
        faces.add(shown);
      }
    }
    expect(faces.size).toBeGreaterThan(0);
  });

  it('a man in a female-only class still shows a woman', () => {
    const u = unitOf('Pegasus Knight', 'Evin', { portraitVariant: 'mercenary_b' });
    const shown = variantPortraitId(u);
    const wearer = Object.values(table.identities).find(
      (p) => p.renders['Pegasus Knight'] === shown,
    );
    expect(wearer.gender).toBe('f');
  });

  it('the map sprite person stays the class-line counterpart (sprites exist only per line)', () => {
    const hero = unitOf('Swordmaster', 'Gaspar', { portraitVariant: 'mercenary_b' });
    const sprite = displayedPerson(hero);
    expect(person(sprite).renders.Swordmaster).toBeTruthy();
    expect(person(sprite).gender).toBe(person('mercenary_b').gender);
  });
});

describe('legacy saves', () => {
  function legacySave(seed = 99) {
    const run = new RunManager(data);
    run.startRun({ runSeed: seed });
    const make = (name, cls) => {
      const base = classData(cls).promotesFrom
        ? classData(classData(cls).promotesFrom)
        : classData(cls);
      const u = createUnit(base, 3, data.weapons, { name });
      if (base.name !== cls)
        promoteUnit(u, classData(cls), classData(cls).promotionBonuses || {}, data.skills);
      return u;
    };
    run.roster.push(
      make('Bram', 'Fighter'),
      make('Galvin', 'Fighter'),
      make('Halvar', 'Warrior'),
      make('Kestrel', 'Mercenary'),
    );
    const saved = run.toJSON();
    for (const u of saved.roster) delete u.portraitVariant;
    return saved;
  }

  it('gives every legacy unit a stable, de-duplicated face on load, idempotently', () => {
    const saved = legacySave();
    const spy = forbidRandom();
    const a = RunManager.fromJSON(structuredClone(saved), data);
    const b = RunManager.fromJSON(structuredClone(saved), data);
    const faces = (rm) => rm.roster.map((u) => u.portraitVariant ?? null);
    expect(faces(a)).toEqual(faces(b));
    const generic = a.roster.filter((u) => !u.isLord && !u.specialCharId);
    expect(generic.every((u) => typeof u.portraitVariant === 'string')).toBe(true);
    const fighterLine = generic.filter((u) => ['Fighter', 'Warrior'].includes(u.className));
    expect(new Set(fighterLine.map((u) => u.portraitVariant)).size).toBe(fighterLine.length);
    expect(a.roster.filter((u) => u.isLord).every((u) => u.portraitVariant === undefined)).toBe(
      true,
    );
    const again = RunManager.fromJSON(a.toJSON(), data);
    expect(faces(again)).toEqual(faces(a));
    expect(spy).not.toHaveBeenCalled();
  });

  it('is stable for saves that predate the run seed', () => {
    const saved = legacySave();
    delete saved.runSeed;
    const a = RunManager.fromJSON(structuredClone(saved), data);
    const b = RunManager.fromJSON(structuredClone(saved), data);
    expect(a.roster.map((u) => u.portraitVariant)).toEqual(b.roster.map((u) => u.portraitVariant));
  });

  it('new runs and candidates offered together get faces the army lacks', () => {
    const run = new RunManager(data);
    run.startRun({ runSeed: 5 });
    const offered = ['Bram', 'Galvin', 'Halvar'].map((n) =>
      createUnit(classData('Fighter'), 2, data.weapons, { name: n }),
    );
    run.assignPortraitVariants(offered);
    expect(new Set(offered.map((u) => u.portraitVariant)).size).toBe(3);
  });
});

describe('enemies', () => {
  it('wear a stable face per spawn, varied across spawns, without Math.random', () => {
    const spy = forbidRandom();
    const scene = { runManager: { runSeed: 12 }, nodeId: 'n3' };
    const faces = new Set();
    for (let i = 1; i <= 24; i++) {
      const enemy = {
        name: 'Fighter',
        className: 'Fighter',
        faction: 'enemy',
        battleEntityId: `u${i}`,
      };
      const key = battleSpawnKey(scene, enemy);
      const a = assignPortraitVariant(enemy, { spawnKey: key });
      expect(a).toBe(chooseEnemyFace('Fighter', key));
      expect(portraitIdForUnit(enemy, data)).toBe(a);
      faces.add(a);
    }
    expect(faces.size).toBe(4);
    expect(spy).not.toHaveBeenCalled();
  });

  it('are placed on the map with their face (battle hook) and restored as saved', () => {
    const scene = {
      _battleSession: 1,
      runManager: { runSeed: 4, roster: [], fallenUnits: [] },
      nodeId: 'n1',
      playerUnits: [],
      npcUnits: [],
      gameData: data,
    };
    const enemy = { name: 'Archer', className: 'Archer', faction: 'enemy', battleEntityId: 'u9' };
    placeBattlePortrait(scene, enemy);
    const saved = structuredClone(enemy);
    placeBattlePortrait({ ...scene, nodeId: 'other' }, saved);
    expect(saved.portraitVariant).toBe(enemy.portraitVariant);
    const recruit = unitOf('Myrmidon', 'Hana', { faction: 'npc' });
    placeBattlePortrait(scene, recruit);
    expect(portraitPeopleForClass('Myrmidon')).toContain(recruit.portraitVariant);
  });
});

describe('one resolver, every surface', () => {
  const unit = unitOf('Fighter', 'Bram', { portraitVariant: 'fighter_d' });
  const id = () => person('fighter_d').renders.Fighter;

  function fakeScene(extra = {}) {
    return {
      _battleSession: 1,
      gameData: data,
      runManager: { roster: [unit] },
      playerUnits: [unit],
      enemyUnits: [],
      textures: { exists: () => false, get: () => ({ has: () => false }) },
      ...extra,
    };
  }

  it('portraitIdForUnit returns the unit face for the roster, HUD, rites and chips', () => {
    expect(portraitIdForUnit(unit, data)).toBe(id());
    expect(portraitIdForUnit({ ...unit, faction: 'npc' }, data)).toBe(id());
  });

  it('texture keys, dialogue and ceremonies resolve through it', () => {
    const scene = fakeScene();
    expect(unitPortraitKey(scene, unit)).toBe(`portrait_${id()}`);
    expect(dialoguePortraitKey(scene, 'Bram', 'portrait_generic_fighter')).toBe(`portrait_${id()}`);
    const c = ceremonyPortrait(scene, unit);
    expect(c.id).toBe(id());
    expect(c.src).toMatch(new RegExp(`/192/${id()}\\.png$`));
  });

  it('DOM rows (roster, deploy, party, arrival) use the same face', () => {
    const make = (tag) => {
      const node = {
        tagName: tag.toUpperCase(),
        children: [],
        dataset: {},
        classList: { add() {} },
        style: { setProperty() {} },
        append: (...c) => node.children.push(...c),
        addEventListener() {},
        querySelector: () => null,
      };
      return node;
    };
    const original = globalThis.document;
    globalThis.document = { createElement: make };
    try {
      const img = unitPortrait(fakeScene(), data, unit, 'mr-unit-face');
      expect(img.dataset.portraitId).toBe(id());
      expect(img.src).toMatch(/\/32\//);
    } finally {
      globalThis.document = original;
    }
  });

  it('no surface builds class portrait keys on its own', async () => {
    const { readFileSync, readdirSync } = await import('fs');
    const files = [
      ...readdirSync('src/ui').map((f) => `src/ui/${f}`),
      ...readdirSync('src/scenes').map((f) => `src/scenes/${f}`),
    ].filter((f) => f.endsWith('.js'));
    const allowed = new Set([
      'src/ui/RebuiltPortraits.js',
      'src/ui/unitPortrait.js',
      'src/ui/portraitArt.js',
    ]);
    const offenders = files.filter(
      (f) =>
        !allowed.has(f) &&
        /portrait_(generic|enemy)_\$\{|rebuilt-portrait-generic_/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
    for (const f of [
      'src/scenes/BattleScene.js',
      'src/ui/RosterOverlay.js',
      'src/ui/UnitDetailOverlay.js',
    ]) {
      const src = readFileSync(f, 'utf8');
      const body = src.slice(
        src.indexOf('_getPortraitKey(unit) {'),
        src.indexOf('_getPortraitKey(unit) {') + 200,
      );
      expect(body, f).toMatch(/return unitPortraitKey\(/);
    }
    expect(readFileSync('src/scenes/BattleScene.js', 'utf8')).toMatch(
      /registerBattleEntity\(this, unit\);\s*\n\s*placeBattlePortrait\(this, unit\)/,
    );
  });
});

describe('lazy canvas textures', () => {
  let added;
  let scene;
  beforeEach(() => {
    added = new Map();
    scene = {
      textures: {
        exists: (k) => added.has(k) || k === 'pc98-portraits-40',
        get: (k) => ({
          has: (frame) =>
            k === 'pc98-portraits-40' && Boolean(PC98_MANIFEST.portraits[frame]?.frame >= 0),
        }),
        addCanvas: (k, c) => added.set(k, c),
        remove: (k) => added.delete(k),
        getTextureKeys: () => [...added.keys()],
      },
    };
    class FakeImage {
      set src(v) {
        this._src = v;
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', FakeImage);
    vi.stubGlobal('document', {
      createElement: () => ({
        getContext: () => ({ drawImage() {}, imageSmoothingEnabled: true }),
      }),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('stands the class default in, then draws the variant once loaded', async () => {
    const variant = person('fighter_d').renders.Warrior;
    expect(isVariantPortrait(variant)).toBe(true);
    const first = portraitCanvasFrame(scene, `portrait_${variant}`, 40);
    expect(first).toEqual({ key: 'pc98-portraits-40', frame: variantDefaultId(variant) });
    await loadVariantTexture(scene, variant, 40);
    expect(portraitCanvasFrame(scene, `portrait_${variant}`, 40)).toEqual({
      key: variantTextureKey(variant, 40),
    });
  });

  it('releases faces nobody keeps', async () => {
    const a = person('fighter_d').renders.Warrior;
    const b = person('fighter_e').renders.Warrior;
    await loadVariantTexture(scene, a, 40);
    await loadVariantTexture(scene, b, 40);
    expect(variantTextureKeys(scene.textures)).toHaveLength(2);
    releaseVariantTextures(scene.textures, new Set([a]));
    expect(variantTextureKeys(scene.textures)).toEqual([variantTextureKey(a, 40)]);
  });

  it('shows the variant id through variantPortraitId for units without a stored face', () => {
    const u = unitOf('Mage', 'Lira');
    const v = variantPortraitId(u);
    expect(portraitPeopleForClass('Mage').some((p) => person(p).renders.Mage === v)).toBe(true);
    expect(u.portraitVariant).toBeUndefined(); // previews never persist a choice
  });
});

describe('the base Pegasus Knight is women only', () => {
  const FEMALE_ONLY = ['Pegasus Knight'];

  it('names the class in the table and its recruit pool holds only women', () => {
    expect(table.femaleOnlyClasses).toEqual(FEMALE_ONLY);
    for (const name of data.recruits.namePool['Pegasus Knight'])
      expect(nameGender(name), name).toBe('f');
  });

  it('its promotions and the Wyvern line stay open to both genders', () => {
    for (const cls of ['Falcon Knight', 'Wyvern Lord', 'Wyvern Rider']) {
      const genders = new Set(portraitPeopleForClass(cls).map((p) => person(p).gender));
      expect([...genders].sort(), cls).toEqual(['f', 'm']);
    }
    // A man named for the Falcon Knight pool gets a man's face and sprite there.
    const emeric = choosePortraitPerson({ name: 'Emeric', className: 'Falcon Knight', seed: 4 });
    expect(person(emeric).gender).toBe('m');
    expect(person(emeric).renders['Falcon Knight']).toBeTruthy();
  });

  it('every Pegasus Knight recruit gets a woman, whatever the seed or the name', () => {
    for (let seed = 0; seed < 40; seed++)
      for (const name of ['Bram', 'Evin', 'Shade', 'Elysia']) {
        const p = choosePortraitPerson({ name, className: 'Pegasus Knight', seed });
        expect(person(p).gender, `${name} ${seed}`).toBe('f');
      }
  });

  it('a stored person is never rewritten: assign and backfill keep a man in the class', () => {
    const man = unitOf('Pegasus Knight', 'Elysia', { portraitVariant: 'pegasus_d' });
    expect(assignPortraitVariant(man, { seed: 3 })).toBe('pegasus_d');
    const evin = unitOf('Pegasus Knight', 'Evin', { portraitVariant: 'pegasus_d' });
    expect(backfillPortraitVariants([evin, man], { seed: 5 })).toBe(0);
    expect(evin.portraitVariant).toBe('pegasus_d');
    expect(evin.name).toBe('Evin');
  });

  it('a man saved as a Pegasus Knight shows one woman, the same after a reload', () => {
    const evin = unitOf('Pegasus Knight', 'Evin', { portraitVariant: 'pegasus_d' });
    const shown = variantPortraitId(evin);
    const owner = Object.values(table.identities).find(
      (p) => p.renders['Pegasus Knight'] === shown,
    );
    expect(owner.gender).toBe('f');
    const reloaded = JSON.parse(JSON.stringify(evin));
    backfillPortraitVariants(
      [reloaded, unitOf('Pegasus Knight', 'Iris', { portraitVariant: 'pegasus_a' })],
      {
        seed: 99,
      },
    );
    expect(variantPortraitId(reloaded)).toBe(shown);
  });

  it('a man promoted to Falcon Knight keeps his own face and sprite', () => {
    for (const man of Object.keys(table.identities).filter((id) => person(id).gender === 'm')) {
      if (!person(man).renders['Falcon Knight']) continue;
      const u = unitOf('Wyvern Rider', 'Draven', { portraitVariant: man });
      u.className = 'Falcon Knight';
      expect(variantPortraitId(u)).toBe(person(man).renders['Falcon Knight']);
    }
  });

  it('a man forced into the class shows a woman and gets his face back on leaving', () => {
    const u = unitOf('Wyvern Rider', 'Draven', { portraitVariant: 'wyvern_a' });
    const before = variantPortraitId(u);
    u.className = 'Pegasus Knight';
    const owner = Object.values(table.identities).find(
      (p) => p.renders['Pegasus Knight'] === variantPortraitId(u),
    );
    expect(owner.gender).toBe('f');
    expect(u.portraitVariant).toBe('wyvern_a');
    u.className = 'Wyvern Rider';
    expect(variantPortraitId(u)).toBe(before);
  });

  it('the map sprite follows the same woman as the portrait', async () => {
    const { tracedKeyFor, personSpriteKey } = await import('../src/ui/TracedSprites.js');
    const sprites = Object.fromEntries(
      Object.entries(table.classes)
        .flatMap(([cls, people]) => people.map((p) => personSpriteKey(cls, p)))
        .map((k) => [k, {}]),
    );
    const u = unitOf('Pegasus Knight', 'Evin', { portraitVariant: 'pegasus_d' });
    const personId = tracedKeyFor(u, sprites).replace('pegasus_knight-', '');
    expect(person(personId).gender).toBe('f');
  });

  it('enemy Pegasus Knights wear only the women faces; Falcon Knights keep all four', () => {
    const faces = new Set();
    for (let i = 0; i < 200; i++) faces.add(chooseEnemyFace('Pegasus Knight', `spawn-${i}`));
    expect(faces.size).toBeGreaterThan(1);
    for (const id of faces) expect(table.enemyGender[id], id).toBe('f');
    const falcon = new Set();
    for (let i = 0; i < 200; i++) falcon.add(chooseEnemyFace('Falcon Knight', `spawn-${i}`));
    expect(falcon.size).toBe(4);
  });

  it('a stored male enemy face on a Pegasus Knight is replaced, a woman face kept', () => {
    const e = { faction: 'enemy', className: 'Pegasus Knight', name: 'Pegasus Knight', level: 3 };
    e.portraitVariant = 'enemy_pegasus_knight__b'; // a man
    expect(table.enemyGender[assignPortraitVariant(e, { spawnKey: 'x' })]).toBe('f');
    e.portraitVariant = 'enemy_pegasus_knight__c';
    expect(assignPortraitVariant(e, { spawnKey: 'y' })).toBe('enemy_pegasus_knight__c');
  });

  it('a man cannot reclass into the Pegasus Knight; a woman and promotions are unaffected', async () => {
    const { getReclassTargets } = await import('../src/engine/UnitManager.js');
    const targets = (u, seal) => getReclassTargets(u, data.classes, seal).map((c) => c.name);
    const fighters = portraitPeopleForClass('Fighter');
    const menId = fighters.find((p) => person(p).gender === 'm');
    const womenId = fighters.find((p) => person(p).gender === 'f');
    const man = unitOf('Fighter', 'Bram', { portraitVariant: menId });
    expect(targets(man, 'mounted')).not.toContain('Pegasus Knight');
    expect(targets(man, 'mounted')).toContain('Cavalier');
    const woman = unitOf('Fighter', 'Hedda', { portraitVariant: womenId });
    expect(targets(woman, 'mounted')).toContain('Pegasus Knight');
    // No stored person: the name decides.
    expect(targets(unitOf('Fighter', 'Galvin'), 'mounted')).not.toContain('Pegasus Knight');
    // A promoted man may take the Mounted Seal into Falcon Knight.
    const promotedMan = unitOf('Warrior', 'Bram', { portraitVariant: menId });
    expect(targets(promotedMan, 'mounted')).toContain('Falcon Knight');
  });
});
