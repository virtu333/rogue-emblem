import { describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import {
  CLASS_CREST_SPECS,
  CREST_LINE_IDS,
  WEAPON_GLYPH,
  crestForUnit,
  crestId,
  crestLabel,
  crestSpecForClass,
} from '../src/ui/classCrests.js';
import {
  crestLayers,
  crestSvg,
  crestDataUrl,
  chargeDataUrl,
  CREST_PALETTE,
} from '../src/ui/crestArt.js';
import { parseWeaponProficiencies } from '../src/engine/UnitManager.js';

const gameData = loadGameData();
// Line glyphs that stand for a weapon type (the rest are WEAPON_GLYPH values).
const PRIMARY_TYPE = { curved: 'Sword', dagger: 'Sword', fan: 'Sword', sword: 'Sword' };
const glyphType = Object.fromEntries(Object.entries(WEAPON_GLYPH).map(([t, g]) => [g, t]));
const typeOf = (glyph) => PRIMARY_TYPE[glyph] || glyphType[glyph];

describe('class crests — mapping', () => {
  it('every class in classes.json has exactly one crest, and nothing else does', () => {
    const names = gameData.classes.map((c) => c.name).sort();
    expect(Object.keys(CLASS_CREST_SPECS).sort()).toEqual(names);
    expect(names).toHaveLength(52);
  });

  it('the frame shows the tier from classes.json', () => {
    for (const cls of gameData.classes)
      expect(crestSpecForClass(cls.name).tier, cls.name).toBe(cls.tier);
  });

  it('charges tell the weapons: primary + secondaries are the class proficiencies', () => {
    for (const cls of gameData.classes) {
      const spec = CLASS_CREST_SPECS[cls.name];
      if (spec.primary === 'eclipse') continue; // the Entity has no heraldry of its own
      const types = new Set(parseWeaponProficiencies(cls.weaponProficiencies).map((p) => p.type));
      const drawn = new Set([typeOf(spec.primary), ...spec.secondary.map(typeOf)]);
      expect([...drawn].sort(), cls.name).toEqual([...types].sort());
    }
  });

  it('promoted crests keep their line: same primary charge as the base class', () => {
    for (const cls of gameData.classes.filter((c) => c.tier === 'promoted')) {
      const base = CLASS_CREST_SPECS[cls.promotesFrom];
      const spec = CLASS_CREST_SPECS[cls.name];
      expect(spec.line, cls.name).toBe(base.line);
      expect(spec.primary, cls.name).toBe(base.primary);
    }
  });

  it('mounts follow move type (horse = cavalry, wings = flying, tower = armoured)', () => {
    for (const cls of gameData.classes) {
      const { mount } = CLASS_CREST_SPECS[cls.name];
      if (cls.moveType === 'Cavalry') expect(mount, cls.name).toBe('horse');
      if (cls.moveType === 'Flying') expect(['wing', 'wyvern'], cls.name).toContain(mount);
      if (cls.moveType === 'Armored') expect(mount, cls.name).toBe('tower');
      if (cls.moveType === 'Infantry') expect(mount, cls.name).toBeNull();
    }
  });

  it('lord lines carry the gold star; promotion paths of one base differ visibly', () => {
    for (const lord of gameData.lords) {
      expect(CLASS_CREST_SPECS[lord.class].mark, lord.class).toBe('star');
      expect(CLASS_CREST_SPECS[lord.promotedClass].mark, lord.promotedClass).toBe('star');
    }
    for (const base of gameData.classes.filter((c) => c.tier === 'base' && c.promotesTo)) {
      const paths = (Array.isArray(base.promotesTo) ? base.promotesTo : base.promotesTo.split(','))
        .map((n) => CLASS_CREST_SPECS[n.trim()])
        .filter(Boolean)
        .map((s) => JSON.stringify(s));
      expect(new Set(paths).size, base.name).toBe(paths.length);
    }
    expect(CREST_LINE_IDS.length).toBeGreaterThanOrEqual(20);
  });

  it('crestForUnit falls back to the base class and labels are readable', () => {
    expect(crestForUnit({ className: 'Paladin' }).id).toBe('paladin');
    expect(crestForUnit({ className: 'Mystery' }, [{ name: 'Mystery', promotesFrom: 'Knight' }]).className).toBe('Knight'); // prettier-ignore
    expect(crestForUnit({ className: 'Mystery' })).toBeNull();
    expect(crestForUnit(null)).toBeNull();
    expect(crestId('Great Knight')).toBe('great_knight');
    expect(crestLabel('Great Knight')).toBe('Great Knight crest · promoted');
    expect(crestLabel('Knight')).toBe('Knight crest · base');
  });
});

describe('class crests — drawing', () => {
  const palette = new Set(Object.values(CREST_PALETTE).flat());

  it('every crest renders a self-contained 64×64 SVG in the art palette only', () => {
    for (const name of Object.keys(CLASS_CREST_SPECS)) {
      const svg = crestSvg(name);
      expect(svg.startsWith('<svg'), name).toBe(true);
      expect(svg).toContain('viewBox="0 0 64 64"');
      expect(svg).not.toMatch(/<script|href=|url\(/);
      for (const [, hex] of svg.matchAll(/(?:fill|stroke)="(#[0-9a-f]{6})"/gi))
        expect(palette.has(hex.toLowerCase()), `${name} ${hex}`).toBe(true);
      expect(crestDataUrl(name)).toMatch(/^data:image\/svg\+xml/);
    }
    expect(crestSvg('Nobody')).toBe('');
  });

  it('the promoted frame adds the crown; base and promoted share the shield box', () => {
    const base = crestSvg('Myrmidon');
    const promoted = crestSvg('Swordmaster');
    const box = /<g transform="([^"]+)"/;
    expect(base.match(box)[1]).toBe(promoted.match(box)[1]);
    expect(promoted.length).toBeGreaterThan(base.length);
    expect(promoted.split('</g>')[1]).toContain('<polygon'); // the crown rides outside the shield
    expect(base.split('</g>')[1]).toBe('</svg>');
  });

  it('layers: supporter, secondaries, primary (twin = two), then the mark', () => {
    const kinds = (name) => crestLayers(CLASS_CREST_SPECS[name]).map((l) => l.kind);
    expect(kinds('Holy Knight')).toEqual(['mount', 'secondary', 'secondary', 'primary', 'mark']);
    expect(kinds('Swordmaster')).toEqual(['primary', 'primary']);
    expect(kinds('Vanguard')).toEqual(['secondary', 'secondary', 'primary', 'mark']);
  });

  it('crests are deterministic (no RNG) and cached', () => {
    const random = Math.random;
    let calls = 0;
    Math.random = () => {
      calls++;
      return random();
    };
    try {
      const a = crestSvg('Paladin');
      const b = crestSvg('Paladin');
      expect(a).toBe(b);
      expect(chargeDataUrl('lance')).toMatch(/^data:image\/svg\+xml/);
      expect(chargeDataUrl('nothing')).toBe('');
    } finally {
      Math.random = random;
    }
    expect(calls).toBe(0);
  });
});
