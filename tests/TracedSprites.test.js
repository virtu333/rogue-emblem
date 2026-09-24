import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import {
  tracedKeyFor,
  idleFrameAt,
  hashName,
  TRACED_MANIFEST,
  tracedSpritesEnabled,
} from '../src/ui/TracedSprites.js';
import { battleRenderScale } from '../src/ui/BattlefieldLab.js';

const sprites = TRACED_MANIFEST.sprites;

describe('traced sprite keys (?spriteArt=traced)', () => {
  it('is off unless the dev flag asks for it', () => {
    expect(tracedSpritesEnabled('')).toBe(false);
  });

  it('maps lords, enemies, corrupted enemies, NPCs and bosses', () => {
    expect(
      tracedKeyFor({ name: 'Edric', className: 'Lord', faction: 'player', isLord: true }, sprites),
    ).toBe('lord_edric');
    expect(
      tracedKeyFor(
        {
          name: 'Edric',
          className: 'Great Lord',
          faction: 'player',
          isLord: true,
          tier: 'promoted',
        },
        sprites,
      ),
    ).toBe('lord_edric_promoted');
    expect(
      tracedKeyFor(
        { name: 'Rowan', className: 'Chevalier', faction: 'player', isLord: true },
        sprites,
      ),
    ).toBe(null);
    expect(tracedKeyFor({ name: 'Knight', className: 'Knight', faction: 'enemy' }, sprites)).toBe(
      'enemy_knight',
    );
    expect(
      tracedKeyFor(
        { name: 'Knight', className: 'Knight', faction: 'enemy', affixes: ['vampiric'] },
        sprites,
      ),
    ).toBe('enemy_knight~corrupt');
    expect(tracedKeyFor({ name: 'Villager', className: 'Cleric', faction: 'npc' }, sprites)).toBe(
      'npc_cleric',
    );
    expect(
      tracedKeyFor(
        { name: 'Blade Lord', className: 'Swordmaster', faction: 'enemy', isBoss: true },
        sprites,
      ),
    ).toBe('boss_blade_lord');
    expect(
      tracedKeyFor({ name: 'Wyvern', className: 'Wyvern Rider', faction: 'enemy' }, sprites),
    ).toBe(null);
    expect(
      tracedKeyFor({ name: 'Pat', className: 'Pegasus Knight', faction: 'player' }, sprites),
    ).toBe('pegasus_knight');
  });

  it('gives a recruit the same seeded person before and after promotion', () => {
    const base = tracedKeyFor({ name: 'Aldo', className: 'Myrmidon', faction: 'player' }, sprites);
    const promoted = tracedKeyFor(
      { name: 'Aldo', className: 'Swordmaster', faction: 'player' },
      sprites,
    );
    expect(base).toMatch(/^myrmidon#\d$/);
    expect(promoted).toBe(base.replace('myrmidon', 'swordmaster'));
    expect(base).toBe(`myrmidon#${hashName('Aldo') % 6}`);
  });

  it('every manifest entry is inside the atlas and on the foot baseline contract', () => {
    const { cell, frames, footRow, density } = TRACED_MANIFEST;
    expect(cell).toBe(Math.round(64 * density));
    expect(footRow).toBe(Math.round(44 * density));
    expect(frames).toHaveLength(6);
    const atlas = 'public/assets/sprites/traced/traced-atlas.png';
    expect(existsSync(atlas)).toBe(true);
    const png = readFileSync(atlas);
    const width = png.readUInt32BE(16),
      height = png.readUInt32BE(20);
    expect(width).toBeLessThanOrEqual(2048);
    expect(height).toBeLessThanOrEqual(2048);
    for (const s of Object.values(sprites)) {
      expect(s.x + cell * frames.length).toBeLessThanOrEqual(width);
      expect(s.y + cell).toBeLessThanOrEqual(height);
    }
  });

  it('cycles four idle frames at map tempo, phase-offset per unit', () => {
    expect(idleFrameAt(0)).toBe('idle0');
    expect(idleFrameAt(260)).toBe('idle1');
    expect(idleFrameAt(260 * 4)).toBe('idle0');
    expect(idleFrameAt(0, 2)).toBe('idle2');
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
