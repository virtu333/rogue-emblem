import { describe, it, expect } from 'vitest';
import {
  buildWeaponArtVisibilityRows,
  formatWeaponArtActLabel,
  getWeaponArtTooltipLines,
  hasWeaponArt,
  resolveWeaponArtIds,
  resolveWeaponArtStatus,
  summarizeWeaponArtEffect,
} from '../src/ui/WeaponArtVisibility.js';

function makeArt(overrides = {}) {
  return {
    id: 'art_1',
    name: 'Art One',
    weaponType: 'Sword',
    unlockAct: 'act2',
    requiredRank: 'Prof',
    hpCost: 2,
    perTurnLimit: 1,
    perMapLimit: 3,
    combatMods: { hitBonus: 15, critBonus: 5 },
    ...overrides,
  };
}

describe('WeaponArt visibility helpers', () => {
  it('formats act labels', () => {
    expect(formatWeaponArtActLabel('act3')).toBe('Act 3');
    expect(formatWeaponArtActLabel('epilogue')).toBe('epilogue');
  });

  it('renders exact status labels', () => {
    const unlocked = resolveWeaponArtStatus(makeArt({ id: 'u', unlockAct: 'act3' }), {
      unlockedIds: ['u'],
      currentAct: 'act1',
    });
    const byAct = resolveWeaponArtStatus(makeArt({ id: 'a', unlockAct: 'act3' }), {
      unlockedIds: [],
      currentAct: 'act1',
    });
    const prof = resolveWeaponArtStatus(
      makeArt({ id: 'p', unlockAct: 'act1', requiredRank: 'Prof' }),
      {
        unlockedIds: [],
        currentAct: 'act2',
        actSequence: ['act1', 'act2', 'act3'],
      },
    );
    const mast = resolveWeaponArtStatus(
      makeArt({ id: 'm', unlockAct: 'act1', requiredRank: 'Mast' }),
      {
        unlockedIds: [],
        currentAct: 'act2',
        actSequence: ['act1', 'act2', 'act3'],
      },
    );
    const invalid = resolveWeaponArtStatus(makeArt({ id: 'x', unlockAct: 'ac2' }), {
      unlockedIds: [],
      currentAct: 'act2',
      actSequence: ['act1', 'act2', 'act3'],
    });

    expect(unlocked.label).toBe('Unlocked');
    expect(unlocked.sourceLabel).toBe('Act');
    expect(byAct.label).toBe('Unlocks in Act 3');
    expect(byAct.sourceLabel).toBe('Act');
    expect(prof.label).toBe('Requires Prof');
    expect(prof.sourceLabel).toBe('Rank');
    expect(mast.label).toBe('Requires Mast');
    expect(mast.sourceLabel).toBe('Rank');
    expect(invalid.label).toBe('Invalid unlock act');
    expect(invalid.sourceLabel).toBe('Data');
  });

  it('summarizes combat mods and falls back to description', () => {
    expect(summarizeWeaponArtEffect(makeArt({ combatMods: { atkBonus: 4, hitBonus: -10 } }))).toBe(
      'Mt +4, Hit -10',
    );
    expect(
      summarizeWeaponArtEffect(makeArt({ combatMods: {}, description: 'Fallback text' })),
    ).toBe('Fallback text');
  });

  it('sorts rows by status then unlock act then weapon/name', () => {
    const rows = buildWeaponArtVisibilityRows(
      [
        makeArt({ id: 'c', name: 'C', unlockAct: 'act3', weaponType: 'Bow' }),
        makeArt({ id: 'a', name: 'A', unlockAct: 'act1', weaponType: 'Sword' }),
        makeArt({ id: 'b', name: 'B', unlockAct: 'act2', weaponType: 'Axe' }),
        makeArt({
          id: 'd',
          name: 'D',
          unlockAct: 'unknown',
          requiredRank: 'Mast',
          weaponType: 'Lance',
        }),
      ],
      {
        unlockedIds: ['a'],
        currentAct: 'act1',
        actSequence: ['act1', 'act2', 'act3'],
      },
    );

    expect(rows.map((r) => `${r.id}:${r.status}`)).toEqual([
      'a:Unlocked',
      'b:Unlocks in Act 2',
      'c:Unlocks in Act 3',
      'd:Invalid unlock act',
    ]);
  });

  it('shows Meta Unlocked precedence and optional act detail when both sources apply', () => {
    const row = buildWeaponArtVisibilityRows([makeArt({ id: 'meta_both', unlockAct: 'act2' })], {
      unlockedIds: ['meta_both'],
      metaUnlockedIds: ['meta_both'],
      actUnlockedIds: ['meta_both'],
      currentAct: 'act3',
      actSequence: ['act1', 'act2', 'act3'],
    })[0];

    expect(row.status).toBe('Meta Unlocked');
    expect(row.statusDetail).toBe('Also Act 2');
    expect(row.statusSource).toBe('Meta');
  });

  it('resolveWeaponArtIds supports explicit, legacy, and legendary bindings', () => {
    const arts = [
      makeArt({ id: 'explicit_art', name: 'Explicit Art' }),
      makeArt({ id: 'legacy_art', name: 'Legacy Art' }),
      makeArt({ id: 'legend_art', name: 'Legend Art', legendaryWeaponIds: ['Gemini'] }),
    ];

    expect(
      resolveWeaponArtIds({ name: 'Iron Sword', weaponArtIds: ['explicit_art'] }, arts),
    ).toEqual(['explicit_art']);
    expect(resolveWeaponArtIds({ name: 'Iron Sword', weaponArtId: 'legacy_art' }, arts)).toEqual([
      'legacy_art',
    ]);
    expect(resolveWeaponArtIds({ name: 'Gemini' }, arts)).toEqual(['legend_art']);
  });

  it('resolveWeaponArtIds fails closed for unresolved IDs when catalog is provided', () => {
    const arts = [makeArt({ id: 'known_art', name: 'Known Art' })];
    const weapon = { name: 'Iron Sword', weaponArtIds: ['missing_art'] };
    expect(resolveWeaponArtIds(weapon, arts)).toEqual([]);
    expect(hasWeaponArt(weapon, arts)).toBe(false);
  });

  it('getWeaponArtTooltipLines returns formatted art summary lines', () => {
    const arts = [
      makeArt({
        id: 'curved',
        name: 'Curved Shot',
        combatMods: { rangeBonus: 1, hitBonus: 15 },
      }),
    ];
    const lines = getWeaponArtTooltipLines({ name: 'Short Bow', weaponArtId: 'curved' }, arts);
    expect(lines).toEqual(['Art: Curved Shot - Hit +15, Range +1']);
  });
});
