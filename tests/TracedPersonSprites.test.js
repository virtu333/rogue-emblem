// The map sprite is the person the portrait shows (iOS report, 2026-09-26: "a sprite is
// black but the matching portrait is not"). The sprite and the portrait used to be picked
// by two independent hashes; now tracedKeyFor resolves the person through
// PortraitVariants.displayedPerson, the same function variantPortraitId uses, and every
// person is baked once per class with the skin, hair and design the catalogue gives them.
//
// The failure modes these tests catch:
//   - the sprite key comes from somewhere other than the displayed person (name hash,
//     stored variant ignoring the reclass counterpart, a preview that drops the person);
//   - a baked sprite records a different person, skin, hair or gender-design than the
//     catalogue describes (a wrong roster entry or a stale bake);
//   - promotion, reclass or recruitment changes the person;
//   - an unknown person or class leaves a unit without a traced sprite.
import { describe, it, expect } from 'vitest';
import {
  tracedKeyFor,
  isDerivedNpcKey,
  npcTexture,
  ensureTracedTexture,
  swapPixels,
  npcSwapMap,
  resolveSavedSpriteKey,
  TRACED_MANIFEST,
} from '../src/ui/TracedSprites.js';
import {
  PORTRAIT_VARIANTS,
  displayedPerson,
  variantPortraitId,
} from '../src/engine/PortraitVariants.js';
import { projectedSpriteUnit } from '../src/ui/growthSprites.js';
import { createRecruitUnit, promoteUnit, reclassUnit } from '../src/engine/UnitManager.js';
import { LINES } from '../tools/art/portrait-variants/catalog.mjs';
import { loadGameData } from './testData.js';

const data = loadGameData();
const sprites = TRACED_MANIFEST.sprites;
const table = PORTRAIT_VARIANTS;
const key = (name) => name.toLowerCase().replace(/ /g, '_');
const CATALOG = Object.fromEntries(
  Object.values(LINES).flatMap((line) => Object.entries(line.people)),
);
const CLASSES = Object.keys(table.classes);
const PEOPLE = Object.keys(table.identities);

/** The person whose drawing is `portraitId` in `className` (read from the table). */
function personOfPortrait(className, portraitId) {
  return PEOPLE.find((p) => table.identities[p].renders[className] === portraitId) || null;
}

const spriteOf = (unit) => sprites[tracedKeyFor(unit)];

// --- the catalogue's words, independently of the ramps chosen for them -------------------
const SKIN_WORDS = [
  [/(deep|dark) brown skin/, ['skinDeep']],
  [/light-tan/, ['skinWarm', 'skinFair']],
  [/\btan skin|weathered tan/, ['skinTan']],
  [/\bbrown skin/, ['skinTan', 'skinDeep']],
  [/olive skin/, ['skinOlive']],
  [/pale|fair|light skin|ruddy/, ['skinFair', 'skinWarm']],
];
const GREYS = ['hairSilver', 'hairGrey', 'hairSaltPepper', 'hairGreyAuburn'];
const HAIR_WORDS = [
  [/white hair|grey hair|going grey|greying|streaked with silver|ash-white|grey hair in/, GREYS],
  [/plum hair/, ['hairPlum']],
  [/copper|auburn|red-brown|ginger/, ['hairCopper', 'hairAuburn', 'hairChestnut']],
  [/blond|honey|sandy/, ['hairBlond', 'hairAsh', 'hairSandy', 'hairLightBrown']],
  [/light[- ]brown hair/, ['hairLightBrown', 'hairBrown', 'hairSandy']],
  [/chestnut/, ['hairChestnut', 'hairBrown']],
  [/dark brown hair|dark brown hair|brown hair/, ['hairDarkBrown', 'hairBrown', 'hairChestnut']],
  [/head scarf/, ['hairChestnut', 'hairDarkBrown', 'hairBlack']],
  [
    /black|blue-black|dark hair|dark curls|dark wavy|twisted locks/,
    ['hairBlack', 'hairBlueBlack', 'hairDarkBrown'],
  ],
];
const skinFor = (look) => SKIN_WORDS.find(([re]) => re.test(look))?.[1] || null;
const hairFor = (look) => HAIR_WORDS.find(([re]) => re.test(look))?.[1] || null;
const baldFor = (look) => /\bbald|shaved head/.test(look);

describe('the catalogue: every person has a map look that matches their description', () => {
  it.each(PEOPLE)('%s', (person) => {
    const c = CATALOG[person];
    expect(c?.sprite, `${person} has no sprite look`).toBeTruthy();
    expect(c.g).toBe(table.identities[person].gender);
    const skins = skinFor(c.look);
    if (skins) expect(skins, `${person} skin: ${c.look}`).toContain(c.sprite.skin);
    else expect(['skinFair', 'skinWarm', 'skinTan'], `${person} skin`).toContain(c.sprite.skin);
    expect(Boolean(c.sprite.bald), `${person} bald: ${c.look}`).toBe(baldFor(c.look));
    const hairs = hairFor(c.look);
    if (hairs && !c.sprite.bald)
      expect(hairs, `${person} hair: ${c.look}`).toContain(c.sprite.hair);
  });
});

describe('every generic unit wears the sprite of the person its portrait shows', () => {
  // every person in every class: their own class line (renders) and every other class
  // (a reclass seal: the portrait shows a same-gender counterpart)
  const cases = PEOPLE.flatMap((person) => CLASSES.map((className) => [person, className]));

  it(`covers ${cases.length} person x class pairs`, () => {
    const wrong = [];
    for (const [person, className] of cases) {
      const unit = { name: 'Ren', className, faction: 'player', portraitVariant: person };
      const shown = personOfPortrait(className, variantPortraitId(unit));
      const k = tracedKeyFor(unit);
      const s = sprites[k];
      if (!shown || !s?.person || s.person.id !== shown || !k.startsWith(`${key(className)}-`))
        wrong.push(`${person} as ${className}: portrait ${shown}, sprite ${k} (${s?.person?.id})`);
    }
    expect(wrong).toEqual([]);
  });

  it('the recorded look of every person sprite is the catalogue look, on the design of their gender', () => {
    const wrong = [];
    for (const [k, s] of Object.entries(sprites)) {
      if (!s.person) continue;
      const c = CATALOG[s.person.id];
      const expected = { skin: c.sprite.skin, hair: c.sprite.hair, g: c.g, bald: !!c.sprite.bald };
      const got = {
        skin: s.person.skin,
        hair: s.person.hair,
        g: s.person.g,
        bald: !!s.person.bald,
      };
      if (JSON.stringify(got) !== JSON.stringify(expected))
        wrong.push(`${k}: ${JSON.stringify(got)}`);
    }
    expect(wrong).toEqual([]);
  });

  it('bakes exactly one sprite per portrait person of every class', () => {
    const baked = Object.entries(sprites).filter(([, s]) => s.person);
    const expected = CLASSES.flatMap((c) => table.classes[c].map((p) => `${key(c)}-${p}`));
    expect(baked.map(([k]) => k).sort()).toEqual(expected.sort());
    for (const [k, s] of baked) expect(k).toBe(`${k.split('-')[0]}-${s.person.id}`);
  });

  it('each class draws its men and its women on different designs', () => {
    for (const className of CLASSES) {
      const people = table.classes[className];
      const design = (g) =>
        new Set(
          people
            .filter((p) => table.identities[p].gender === g)
            .map((p) => sprites[`${key(className)}-${p}`].person.design),
        );
      const m = design('m'),
        f = design('f');
      expect(m.size, className).toBeLessThanOrEqual(1);
      expect(f.size, className).toBeLessThanOrEqual(1);
      if (m.size && f.size) expect([...m][0], className).not.toBe([...f][0]);
    }
  });

  it('units without a stored person (previews) use the portrait fallback person', () => {
    const names = ['Aldo', 'Hedda', 'Kiran', 'Bram', 'Wren', 'Lark', 'Io', 'Sigrid', 'Ottar'];
    for (const className of CLASSES)
      for (const name of names) {
        const unit = { name, className, faction: 'player' };
        const shown = personOfPortrait(className, variantPortraitId(unit));
        expect(spriteOf(unit)?.person?.id, `${name} ${className}`).toBe(shown);
      }
  });
});

describe('the person survives promotion, previews, reclass and recruitment', () => {
  const classOf = (name) => data.classes.find((c) => c.name === name);
  const recruit = (className, person, name = 'Ansa') => {
    const unit = createRecruitUnit(
      { name, className, level: 10 },
      classOf(className),
      data.weapons,
      null,
      null,
      null,
      data.classes,
    );
    unit.faction = 'player';
    unit.portraitVariant = person;
    return unit;
  };

  it('promotion (every branch of every base class) keeps the person', () => {
    let checked = 0;
    for (const base of data.classes.filter((c) => c.tier === 'base' && c.promotesTo)) {
      for (const person of table.classes[base.name] || []) {
        for (const to of [base.promotesTo].flat()) {
          const unit = recruit(base.name, person);
          expect(spriteOf(unit).person.id).toBe(person);
          promoteUnit(unit, classOf(to), classOf(to).promotionBonuses, data.skills);
          expect(unit.className).toBe(to);
          const shown = personOfPortrait(to, variantPortraitId(unit));
          expect(spriteOf(unit).person.id, `${person} ${base.name} -> ${to}`).toBe(shown);
          // inside the line the portrait is the same person too
          if (table.identities[person].renders[to]) expect(shown).toBe(person);
          checked++;
        }
      }
    }
    // 11 lines x 5 people x 2 branches (the Dancer's line promotes once)
    expect(checked).toBeGreaterThanOrEqual(100);
  });

  it('the promotion preview (projectedSpriteUnit) keeps the person', () => {
    for (const person of table.classes.Fighter) {
      const unit = recruit('Fighter', person);
      for (const to of ['Warrior', 'Berserker']) {
        const preview = projectedSpriteUnit(unit, to);
        expect(preview.portraitVariant).toBe(person);
        expect(tracedKeyFor(preview)).toBe(`${key(to)}-${person}`);
      }
    }
  });

  it('a reclass shows the portrait counterpart on the map', () => {
    const unit = recruit('Fighter', 'fighter_e');
    reclassUnit(unit, classOf('Mage'), classOf('Fighter'), data.classes, data.skills);
    expect(unit.className).toBe('Mage');
    const shown = personOfPortrait('Mage', variantPortraitId(unit));
    expect(table.identities[shown].gender).toBe('f');
    expect(tracedKeyFor(unit)).toBe(`mage-${shown}`);
    expect(displayedPerson(unit)).toBe(shown);
  });

  it('an NPC is its person in verdigris, and stays that person when it joins', () => {
    const unit = recruit('Cavalier', 'cavalier_e');
    unit.faction = 'npc';
    const npcKey = tracedKeyFor(unit);
    expect(npcKey).toBe('npc_cavalier-cavalier_e');
    expect(isDerivedNpcKey(npcKey)).toBe(true);
    unit.faction = 'player';
    expect(tracedKeyFor(unit)).toBe('cavalier-cavalier_e');
  });
});

describe('fallbacks: every lookup still has a traced sprite', () => {
  it('an unknown stored person falls back to the portrait fallback person', () => {
    const unit = {
      name: 'Bram',
      className: 'Knight',
      faction: 'player',
      portraitVariant: 'nobody_x',
    };
    expect(spriteOf(unit)?.person?.id).toBe(personOfPortrait('Knight', variantPortraitId(unit)));
  });

  it('a class without people (reclass into a creature) uses the class sprite', () => {
    expect(tracedKeyFor({ name: 'Bram', className: 'Zombie', faction: 'player' })).toBe('zombie');
  });

  it('a manifest without the person sprite still gives a sprite of the class', () => {
    const few = { 'knight-knight_a': sprites['knight-knight_a'] };
    const unit = { name: 'X', className: 'Knight', faction: 'player', portraitVariant: 'knight_d' };
    expect(tracedKeyFor(unit, few)).toBe('knight-knight_a');
    // an NPC without the swap table or its own sprite wears the player person
    expect(tracedKeyFor({ ...unit, faction: 'npc' }, few, { npcSwap: [] })).toBe('knight-knight_a');
  });
});

describe('the runtime NPC texture', () => {
  // a fake Phaser texture manager and DOM canvas: enough to see what npcTexture registers
  function fakeScene(pageLoaded = true) {
    const made = new Map();
    const textures = {
      exists: (k) => made.has(k) || (pageLoaded && k.startsWith('traced-page-')),
      get: (k) => made.get(k) || { getSourceImage: () => ({ page: k }) },
      create(k, source, w, h) {
        const frames = {};
        const t = {
          source,
          w,
          h,
          frames,
          add(name, _s, x, y, fw, fh) {
            const f = { x, y, fw, fh, setTrim: (...trim) => (f.trim = trim) };
            frames[name] = f;
            return f;
          },
        };
        made.set(k, t);
        return t;
      },
    };
    return { textures, made };
  }
  const withCanvas = (fn) => {
    const prev = globalThis.document;
    const drawn = [];
    globalThis.document = {
      createElement: () => {
        const canvas = { width: 0, height: 0 };
        let pixels = null;
        canvas.getContext = () => ({
          drawImage: (...a) => drawn.push(a),
          getImageData: (x, y, w, h) => {
            // every pixel is the player's mid steel blue
            pixels = new Uint8ClampedArray(w * h * 4);
            for (let i = 0; i < pixels.length; i += 4) pixels.set([0x45, 0x74, 0xa0, 255], i);
            return { data: pixels };
          },
          putImageData: (img) => (canvas.pixels = img.data),
        });
        return canvas;
      },
    };
    try {
      return fn(drawn);
    } finally {
      globalThis.document = prev;
    }
  };

  it('recolours the person frames into one texture with the atlas frames and trims', () =>
    withCanvas((drawn) => {
      const { textures, made } = fakeScene();
      const k = 'npc_archer-archer_c';
      expect(npcTexture({ textures }, k)).toBe(true);
      const e = sprites['archer-archer_c'];
      const t = made.get(`traced-${k}`);
      expect(t.source.width).toBe((TRACED_MANIFEST.frames.length - 1) * e.step + e.w);
      expect(t.source.height).toBe(e.h);
      // cut from the person's strip on its page
      expect(drawn[0].slice(1, 5)).toEqual([e.x, e.y, t.source.width, e.h]);
      expect(Object.keys(t.frames)).toEqual(['__BASE', ...TRACED_MANIFEST.frames]);
      expect(t.frames.strike.x).toBe(5 * e.step);
      expect(t.frames.idle0.trim).toEqual([e.size, e.size, e.ox, e.oy, e.w, e.h]);
      // steel blue became verdigris
      expect([...t.source.pixels.slice(0, 4)]).toEqual([0x4d, 0x8b, 0x66, 255]);
      // once per battle: the second call reuses it
      expect(npcTexture({ textures }, k)).toBe(true);
      expect(drawn).toHaveLength(1);
      // a replay after a reload remakes it from the recorded key
      made.clear();
      expect(ensureTracedTexture({ textures }, `traced-${k}`)).toBe(true);
    }));

  it('falls back when the page is not loaded or there is no canvas', () => {
    const { textures } = fakeScene(false);
    expect(withCanvas(() => npcTexture({ textures }, 'npc_archer-archer_c'))).toBe(false);
    // no DOM canvas (a headless run): the caller falls back to the baked sprites
    expect(npcTexture({ textures: fakeScene().textures }, 'npc_archer-archer_c')).toBe(false);
  });
});

describe('the NPC colour swap', () => {
  it('turns the player steel-blue cloth into verdigris and leaves skin and hair alone', () => {
    const map = npcSwapMap();
    expect(map.size).toBeGreaterThanOrEqual(5);
    // Art Bible ramps (tools/art/sprite-trace/lib/ramps.mjs): steelCloth -> verdigris
    const steel = ['1c2f4f', '2c4c77', '4574a0', '77a5c6', 'b8d8e6'];
    const verdigris = ['1b4239', '2d6450', '4d8b66', '86b27b', 'c3d69a'];
    steel.forEach((c, i) => expect(map.get(parseInt(c, 16))).toBe(parseInt(verdigris[i], 16)));
    const px = new Uint8ClampedArray([0x45, 0x74, 0xa0, 255, 0xe6, 0xb0, 0x88, 255, 0, 0, 0, 0]);
    expect(swapPixels(px, map)).toBe(1);
    expect([...px.slice(0, 4)]).toEqual([0x4d, 0x8b, 0x66, 255]);
    expect([...px.slice(4, 8)]).toEqual([0xe6, 0xb0, 0x88, 255]);
  });
});

describe('sprite keys saved in rewind history before this change', () => {
  const scene = (keys) => ({ textures: { exists: (k) => keys.has(k) } });
  it('an old seeded-identity key draws a person of the same class, not a placeholder', () => {
    const baked = new Set(Object.keys(TRACED_MANIFEST.sprites).map((k) => `traced-${k}`));
    const key = resolveSavedSpriteKey(scene(baked), 'traced-fighter-2');
    expect(key).toMatch(/^traced-fighter-fighter_[a-e]$/);
    expect(baked.has(key)).toBe(true);
  });
  it('a current key is kept as is; an unknown one gives the caller its placeholder', () => {
    const baked = new Set(['traced-fighter-fighter_d']);
    expect(resolveSavedSpriteKey(scene(baked), 'traced-fighter-fighter_d')).toBe(
      'traced-fighter-fighter_d',
    );
    expect(resolveSavedSpriteKey(scene(baked), 'traced-nope-3')).toBeNull();
    expect(resolveSavedSpriteKey(scene(baked), 'classic_key')).toBeNull();
    expect(resolveSavedSpriteKey(scene(baked), '')).toBeNull();
  });
});
