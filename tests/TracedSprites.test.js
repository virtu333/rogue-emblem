import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import {
  tracedKeyFor,
  idleFrameAt,
  TRACED_MANIFEST,
  tracedSpritesEnabled,
  startTracedIdle,
} from '../src/ui/TracedSprites.js';
import { battleRenderScale } from '../src/ui/BattlefieldLab.js';
import { loadGameData } from './testData.js';
import { displayedPerson } from '../src/engine/PortraitVariants.js';

const sprites = TRACED_MANIFEST.sprites;
const data = loadGameData();
const key = (name) => name.toLowerCase().replace(/ /g, '_');

// Classes only a named lord can hold (lords.json class / promotedClass).
const LORD_CLASSES = new Set(data.lords.flatMap((l) => [l.class, l.promotedClass]));

describe('traced sprites are the battlefield default', () => {
  it('is on without any flag (tests run as a non-dev build)', () => {
    expect(tracedSpritesEnabled('')).toBe(true);
  });
});

describe('traced sprite coverage (every unit the game can spawn)', () => {
  const generic = data.classes.filter((c) => !LORD_CLASSES.has(c.name) && c.tier !== 'boss');

  it('every class a player unit can hold (recruits, promotions, reclass seals, boss recruits)', () => {
    const missing = [];
    for (const c of generic) {
      for (const name of ['Aldo', 'Brin', 'Cato', 'Dara', 'Esk', 'Fen', 'Gil', 'Hana']) {
        const k = tracedKeyFor({ name, className: c.name, faction: 'player' }, sprites);
        if (!k || !(k === key(c.name) || k.startsWith(`${key(c.name)}-`))) missing.push(c.name);
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it('every class as an enemy and as a corrupted (affixed) enemy', () => {
    const missing = [];
    for (const c of generic) {
      const enemy = { name: c.name, className: c.name, faction: 'enemy' };
      if (tracedKeyFor(enemy, sprites) !== `enemy_${key(c.name)}`) missing.push(c.name);
      if (
        tracedKeyFor({ ...enemy, affixes: ['vampiric'] }, sprites) !==
        `enemy_${key(c.name)}-corrupt`
      )
        missing.push(`${c.name} (corrupted)`);
    }
    expect(missing).toEqual([]);
  });

  it('every class an NPC can hold has a verdigris sprite (its person, else the class)', () => {
    const recruitClasses = new Set(
      Object.entries(data.recruits)
        .filter(([k]) => k.startsWith('act'))
        .flatMap(([, pool]) => pool.classPool),
    );
    // recruit pools plus their promotions (later-act NPCs can be promoted)
    for (const c of data.classes)
      if (recruitClasses.has(c.name))
        for (const p of [c.promotesTo].flat().filter(Boolean)) recruitClasses.add(p);
    const missing = [...recruitClasses].filter((name) => {
      const unit = { name: 'Villager', className: name, faction: 'npc' };
      const person = displayedPerson(unit);
      return (
        tracedKeyFor(unit, sprites) !== `npc_${key(name)}-${person}` ||
        !sprites[`${key(name)}-${person}`] ||
        !sprites[`npc_${key(name)}`]
      );
    });
    expect(missing).toEqual([]);
  });

  it('all seven lords, base and promoted', () => {
    expect(data.lords).toHaveLength(7);
    for (const lord of data.lords) {
      const base = { name: lord.name, className: lord.class, faction: 'player', isLord: true };
      expect(tracedKeyFor({ ...base, tier: 'base' }, sprites)).toBe(`lord_${key(lord.name)}`);
      expect(
        tracedKeyFor({ ...base, className: lord.promotedClass, tier: 'promoted' }, sprites),
      ).toBe(`lord_${key(lord.name)}_promoted`);
    }
  });

  it('every named boss (enemies.json) has its own sprite', () => {
    const bosses = Object.values(data.enemies.bosses).flat();
    expect(bosses.length).toBeGreaterThanOrEqual(11);
    const missing = bosses.filter(
      (b) =>
        tracedKeyFor(
          { name: b.name, className: b.className, faction: 'enemy', isBoss: true },
          sprites,
        ) !== `boss_${key(b.name)}`,
    );
    expect(missing.map((b) => b.name)).toEqual([]);
  });

  it('boss-tier classes (the Entity) exist as enemies', () => {
    for (const c of data.classes.filter((x) => x.tier === 'boss'))
      expect(tracedKeyFor({ name: 'x', className: c.name, faction: 'enemy' }, sprites)).toBe(
        `enemy_${key(c.name)}`,
      );
  });

  it('keys stay inside the battle-history spriteKey alphabet', () => {
    for (const k of Object.keys(sprites)) expect(`traced-${k}`).toMatch(/^[a-zA-Z0-9_-]+$/);
  });
});

describe('traced sprite keys', () => {
  it('maps lords, enemies, corrupted enemies, NPCs and bosses', () => {
    expect(
      tracedKeyFor({ name: 'Edric', className: 'Lord', faction: 'player', isLord: true }, sprites),
    ).toBe('lord_edric');
    expect(
      tracedKeyFor(
        { name: 'Knight', className: 'Knight', faction: 'enemy', affixes: ['vampiric'] },
        sprites,
      ),
    ).toBe('enemy_knight-corrupt');
    const villager = { name: 'Villager', className: 'Cleric', faction: 'npc' };
    expect(tracedKeyFor(villager, sprites)).toBe(`npc_cleric-${displayedPerson(villager)}`);
    // without the runtime colour swap the class's baked NPC is used
    expect(tracedKeyFor(villager, sprites, { npcSwap: [] })).toBe('npc_cleric');
    expect(
      tracedKeyFor(
        { name: 'Blade Lord', className: 'Swordmaster', faction: 'enemy', isBoss: true },
        sprites,
      ),
    ).toBe('boss_blade_lord');
  });

  it('falls back to the closest traced sprite, then to nothing', () => {
    const few = { 'knight-knight_a': sprites['knight-knight_a'] };
    // corrupted and boss fall back to the class enemy
    const enemies = { enemy_knight: sprites.enemy_knight };
    expect(
      tracedKeyFor({ name: 'K', className: 'Knight', faction: 'enemy', affixes: ['x'] }, enemies),
    ).toBe('enemy_knight');
    expect(
      tracedKeyFor(
        { name: 'Iron Wall', className: 'Knight', faction: 'enemy', isBoss: true },
        enemies,
      ),
    ).toBe('enemy_knight');
    // an NPC without its own sprite wears the player design
    expect(
      tracedKeyFor({ name: 'V', className: 'Knight', faction: 'npc' }, few, { npcSwap: [] }),
    ).toBe('knight-knight_a');
    // a promoted lord without promoted art keeps the base lord sprite
    expect(
      tracedKeyFor(
        {
          name: 'Edric',
          className: 'Great Lord',
          faction: 'player',
          isLord: true,
          tier: 'promoted',
        },
        { lord_edric: sprites.lord_edric },
      ),
    ).toBe('lord_edric');
    // unknown classes return null (BattleUnitVisuals then uses the classic sprite)
    expect(tracedKeyFor({ name: 'M', className: 'Merchant', faction: 'npc' }, sprites)).toBe(null);
    expect(tracedKeyFor({ name: 'X', className: 'Nobody', faction: 'enemy' }, sprites)).toBe(null);
  });

  it('gives a recruit the person its portrait shows (tests/TracedPersonSprites.test.js)', () => {
    const unit = {
      name: 'Aldo',
      className: 'Myrmidon',
      faction: 'player',
      portraitVariant: 'myrmidon_c',
    };
    expect(tracedKeyFor(unit, sprites)).toBe('myrmidon-myrmidon_c');
    for (const cls of ['Swordmaster', 'Duelist'])
      expect(tracedKeyFor({ ...unit, className: cls }, sprites)).toBe(`${key(cls)}-myrmidon_c`);
  });
});

describe('traced atlas pages and manifest', () => {
  it('every sprite sits inside its page with a trim inside the logical frame', () => {
    const { frames, footRow, density, pages } = TRACED_MANIFEST;
    expect(TRACED_MANIFEST.version).toBe(2);
    expect(footRow).toBe(Math.round(44 * density));
    expect(frames).toEqual(['idle0', 'idle1', 'idle2', 'idle3', 'windup', 'strike']);
    const sizes = pages.map((file) => {
      const path = `public/assets/sprites/traced/${file}`;
      expect(existsSync(path)).toBe(true);
      expect(existsSync(`assets/sprites/traced/${file}`)).toBe(true);
      const png = readFileSync(path);
      return { w: png.readUInt32BE(16), h: png.readUInt32BE(20) };
    });
    for (const { w, h } of sizes) {
      expect(w).toBeLessThanOrEqual(2048);
      expect(h).toBeLessThanOrEqual(2048);
    }
    for (const [k, s] of Object.entries(sprites)) {
      const page = sizes[s.page];
      expect(page, k).toBeTruthy();
      expect(s.x + (frames.length - 1) * s.step + s.w).toBeLessThanOrEqual(page.w);
      expect(s.y + s.h).toBeLessThanOrEqual(page.h);
      expect(s.ox + s.w).toBeLessThanOrEqual(s.size);
      expect(s.oy + s.h).toBeLessThanOrEqual(s.size);
      // every sprite stands on the shared baseline: the trim ends on the foot row
      const foot = s.size === Math.round(64 * density) ? footRow : Math.round(106 * density);
      // (a strike can carry a blade a few pixels below the feet, never above them)
      expect(s.oy + s.h, k).toBeGreaterThanOrEqual(foot);
      expect(s.oy + s.h, k).toBeLessThanOrEqual(foot + 12);
    }
  });

  it('cycles four idle frames at map tempo, phase-offset per unit', () => {
    expect(idleFrameAt(0)).toBe('idle0');
    expect(idleFrameAt(260)).toBe('idle1');
    expect(idleFrameAt(260 * 4)).toBe('idle0');
    expect(idleFrameAt(0, 2)).toBe('idle2');
  });
});

describe('map idle loop vs the combat choreography', () => {
  // a fake battle scene: one ticking timer, units whose graphic records setFrame calls
  const stage = (graphics) => {
    let tick = null;
    const scene = {
      time: { now: 260, addEvent: (e) => ((tick = e.callback), { remove() {} }) },
      events: { once() {} },
      playerUnits: graphics.map((g, i) => ({ col: i, graphic: g })),
    };
    startTracedIdle(scene);
    return () => tick();
  };
  const unit = (frame, extra = {}) => ({
    texture: { key: 'traced-myrmidon-myrmidon_a' },
    frame: { name: frame },
    setFrame(name) {
      this.frame = { name };
    },
    ...extra,
  });

  it('advances idle frames on resting units', () => {
    const g = unit('idle0');
    stage([g])();
    expect(g.frame.name).toBe('idle1');
  });

  it('never repaints a unit whose strike holds a pose (CombatFxController _fxPose)', () => {
    // the pose is claimed before the lunge paints it: the idle frame must survive too
    const posed = unit('idle2', { _fxPose: 'windup' });
    const striking = unit('strike');
    const tagged = unit('idle3', { data: { get: (k) => k === 'tracedPose' } });
    stage([posed, striking, tagged])();
    expect(posed.frame.name).toBe('idle2');
    expect(striking.frame.name).toBe('strike');
    expect(tagged.frame.name).toBe('idle3');
  });
});

describe('phone canvas backing scale (?renderScale)', () => {
  it('is 1 in production and without the flag', () => {
    expect(battleRenderScale(390, 3, '?renderScale=device', false)).toBe(1);
    expect(battleRenderScale(390, 3, '', true)).toBe(1);
  });

  it('matches device pixels with renderScale=device (DPR capped at 3)', () => {
    expect(battleRenderScale(390, 3, '?renderScale=device', true)).toBeCloseTo(2.4375, 4);
    expect(battleRenderScale(375, 2, '?renderScale=device', true)).toBeCloseTo(1.5625, 4);
    expect(battleRenderScale(390, 4, '?renderScale=device', true)).toBeCloseTo(2.4375, 4);
    // never below 1 (a DPR 1 phone keeps the 480 px canvas)
    expect(battleRenderScale(390, 1, '?renderScale=device', true)).toBe(1);
    expect(battleRenderScale(390, 3, '?renderScale=2', true)).toBe(2);
  });
});
