import { describe, expect, it } from 'vitest';
import { battleItemBrief, battleItemSummary } from '../src/ui/battleItemSummary.js';

describe('battleItemSummary', () => {
  it('includes weapon mechanics instead of showing only stats', () => {
    const text = battleItemSummary({
      name: 'Rapier',
      type: 'Sword',
      might: 5,
      hit: 95,
      crit: 10,
      weight: 2,
      range: '1',
      special: 'Effective vs Armored/Cavalry (2x)',
    });

    expect(text).toContain('Might 5 · Hit 95 · Crit 10');
    expect(text).toContain('Effective vs Armored/Cavalry (2x)');
  });

  it('shows staff mechanics and MAG-adjusted range', () => {
    const text = battleItemSummary(
      {
        name: 'Physic',
        type: 'Staff',
        range: '2',
        uses: 1,
        perBattleUses: true,
        special: 'Ranged heal, MAG + 5 HP',
        rangeBonuses: [
          { mag: 10, bonus: 1 },
          { mag: 18, bonus: 1 },
        ],
      },
      { stats: { MAG: 18 } },
    );

    expect(text).toContain('Ranged heal, MAG + 5 HP');
    expect(text).toContain('Range 2-4');
    expect(text).toContain('Refills each battle');
  });
});

describe('battleItemBrief (one line per menu row; the rest on a long press)', () => {
  const handAxe = {
    name: 'Hand Axe',
    type: 'Axe',
    might: 5,
    hit: 65,
    crit: 0,
    weight: 8,
    range: '1-2',
    special: 'Throwable, lower stats',
  };
  it('keeps the numbers that decide a pick and marks an effect with ✦', () => {
    expect(battleItemBrief(handAxe)).toBe('Mt 5 · Hit 65 · Rng 1-2\u00a0✦');
    // weight and the effect text live in the full detail
    expect(battleItemSummary(handAxe)).toContain('Weight 8');
    expect(battleItemSummary(handAxe)).toContain('Throwable, lower stats');
  });
  it('shows crit only when the weapon has some, and no ✦ without an effect', () => {
    expect(
      battleItemBrief({
        name: 'Keen Sword',
        type: 'Sword',
        might: 9,
        hit: 75,
        crit: 30,
        range: '1',
      }),
    ).toBe('Mt 9 · Hit 75 · Crt 30 · Rng 1');
  });
  it('is far shorter than the full detail for every weapon in the game', async () => {
    const { loadGameData } = await import('./testData.js');
    const weapons = loadGameData().weapons.filter((w) => !['Staff', 'Scroll'].includes(w.type));
    expect(weapons.length).toBeGreaterThan(50);
    for (const w of weapons) {
      const brief = battleItemBrief(w);
      expect(brief, w.name).not.toContain('\n');
      expect(brief.length, w.name).toBeLessThanOrEqual(36);
    }
  });
  it('briefs consumables and staves by what they do and what is left', () => {
    expect(
      battleItemBrief({ name: 'Vulnerary', type: 'Consumable', effect: 'heal', value: 10 }),
    ).toBe('Restore 10 HP');
    expect(
      battleItemBrief(
        { name: 'Heal', type: 'Staff', range: '1', uses: 3, perBattleUses: true },
        { stats: { MAG: 5 } },
      ),
    ).toMatch(/^Rng 1 · \d+\/\d+ uses$/);
    expect(battleItemBrief(null)).toBe('');
  });
});

describe('attack speed in the equip rows (the brief and the full detail)', () => {
  // Hand-computed from the GDD rule the engine implements (Combat.js):
  //   AS = SPD − max(0, weight − floor(STR / 5)) + weapon SPD bonus ("when equipped")
  // Unit: SPD 10, STR 7 → floor(7/5) = 1 weight offset.
  //   Iron Sword  weight 5 → 10 − 4 = 6   (equipped)
  //   Hand Axe    weight 8 → 10 − 7 = 3   (−3)
  //   Slim Sword  weight 2 → 10 − 1 = 9   (+3)
  //   Wind Edge   weight 4, +3 SPD when equipped → 10 − 3 + 3 = 10 (+4)
  const ironSword = {
    name: 'Iron Sword',
    type: 'Sword',
    might: 5,
    hit: 90,
    crit: 0,
    weight: 5,
    range: '1',
  };
  const handAxe = {
    name: 'Hand Axe',
    type: 'Axe',
    might: 5,
    hit: 65,
    crit: 0,
    weight: 8,
    range: '1-2',
    special: 'Throwable, lower stats',
  };
  const slimSword = {
    name: 'Slim Sword',
    type: 'Sword',
    might: 3,
    hit: 100,
    crit: 5,
    weight: 2,
    range: '1',
  };
  const windEdge = {
    name: 'Wind Edge',
    type: 'Sword',
    might: 6,
    hit: 80,
    crit: 0,
    weight: 4,
    range: '1',
    special: '+3 SPD when equipped',
  };
  const makeUnit = () => ({
    name: 'Kira',
    stats: { HP: 20, STR: 7, MAG: 0, SKL: 6, SPD: 10, LCK: 4, DEF: 5, RES: 2 },
    weapon: ironSword,
    inventory: [ironSword, handAxe, slimSword, windEdge],
    proficiencies: [
      { type: 'Sword', rank: 'Prof' },
      { type: 'Axe', rank: 'Prof' },
    ],
  });

  it('adds the attack speed line, with the change from the held weapon on the other rows', () => {
    const unit = makeUnit();
    expect(battleItemBrief(ironSword, unit)).toBe('Mt 5 · Hit 90 · Rng 1\nAttack speed 6');
    expect(battleItemBrief(handAxe, unit)).toBe(
      'Mt 5 · Hit 65 · Rng 1-2\u00a0✦\nAttack speed 3 (\u22123)',
    );
    expect(battleItemBrief(slimSword, unit)).toBe(
      'Mt 3 · Hit 100 · Crt 5 · Rng 1\nAttack speed 9 (+3)',
    );
    expect(battleItemBrief(windEdge, unit)).toBe(
      'Mt 6 · Hit 80 · Rng 1\u00a0✦\nAttack speed 10 (+4)',
    );
    // Rendering never equips anything.
    expect(unit.weapon).toBe(ironSword);
    expect(unit.inventory).toEqual([ironSword, handAxe, slimSword, windEdge]);
  });

  it('the full detail reads the change as held → this weapon; the held weapon shows its own', () => {
    const unit = makeUnit();
    expect(battleItemSummary(handAxe, unit)).toBe(
      'Might 5 · Hit 65 · Crit 0\nWeight 8 · Range 1-2\nAttack speed 6 → 3\nThrowable, lower stats',
    );
    expect(battleItemSummary(ironSword, unit)).toBe(
      'Might 5 · Hit 90 · Crit 0\nWeight 5 · Range 1\nAttack speed 6',
    );
    expect(unit.weapon).toBe(ironSword);
  });

  it('counts forged weight and a stronger arm, and compares against a held staff as bare SPD', () => {
    const unit = makeUnit();
    const forgedAxe = { ...handAxe, weight: 6 }; // a Weight whetstone: 10 − (6 − 1) = 5
    unit.inventory.push(forgedAxe);
    expect(battleItemBrief(forgedAxe, unit).split('\n')[1]).toBe('Attack speed 5 (\u22121)');
    unit.stats.STR = 10; // floor(10/5) = 2: Hand Axe 10 − 6 = 4, Iron Sword 10 − 3 = 7
    expect(battleItemBrief(handAxe, unit).split('\n')[1]).toBe('Attack speed 4 (\u22123)');
    const heal = { name: 'Heal', type: 'Staff', range: '1', uses: 3, perBattleUses: true };
    unit.weapon = heal; // a staff in hand: attack speed is bare SPD (10)
    expect(battleItemBrief(handAxe, unit).split('\n')[1]).toBe('Attack speed 4 (\u22126)');
    expect(battleItemBrief(heal, unit)).not.toContain('Attack speed');
  });

  it('leaves consumables, staves and unit-less briefs alone', () => {
    const unit = makeUnit();
    const vulnerary = { name: 'Vulnerary', type: 'Consumable', effect: 'heal', value: 10 };
    expect(battleItemBrief(vulnerary, unit)).toBe('Restore 10 HP');
    expect(battleItemSummary(vulnerary, unit)).not.toContain('Attack speed');
    expect(battleItemBrief(handAxe)).toBe('Mt 5 · Hit 65 · Rng 1-2\u00a0✦');
    expect(battleItemSummary(handAxe)).not.toContain('Attack speed');
  });

  it('keeps each line of every weapon brief short', async () => {
    const { loadGameData } = await import('./testData.js');
    const weapons = loadGameData().weapons.filter((w) => !['Staff', 'Scroll'].includes(w.type));
    const unit = makeUnit();
    unit.stats.SPD = 3; // the widest case: two-digit negative attack speeds
    for (const w of weapons) {
      const lines = battleItemBrief(w, unit).split('\n');
      expect(lines, w.name).toHaveLength(2);
      expect(lines[0].length, w.name).toBeLessThanOrEqual(36);
      expect(lines[1], w.name).toMatch(/^Attack speed \u2212?\d+( \((\+|\u2212)\d+\))?$/);
      expect(lines[1].length, w.name).toBeLessThanOrEqual(24);
    }
  });
});
