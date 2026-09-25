import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGameData } from './testData.js';
import {
  applyPromotionOath,
  beginBattleDeeds,
  bossPhrase,
  commitBattleDeeds,
  deedsForDisplay,
  deedTallyText,
  emptyBattleDeeds,
  epithetText,
  evaluateDeedCondition,
  normalizeUnitDeeds,
  pickEpithet,
  promotionOath,
  recordCombat,
  recordEnemyPhaseEnd,
  recordHeal,
  recordKill,
  recordRefresh,
  sanitizeUnitDeeds,
  sentenceName,
  titledName,
  unitDisplayName,
} from '../src/engine/DeedSystem.js';

const gameData = loadGameData();
const deedsData = gameData.deeds;

let seq = 0;
function unit(over = {}) {
  seq++;
  return {
    name: `Unit${seq}`,
    faction: 'player',
    className: 'Myrmidon',
    tier: 'base',
    level: 5,
    currentHP: 20,
    stats: { HP: 20 },
    skills: [],
    weapon: { type: 'Sword' },
    col: 0,
    row: 0,
    ...over,
  };
}
const foe = (over = {}) => unit({ faction: 'enemy', name: `Foe${seq}`, ...over });
const strike = (side, over = {}) => ({
  type: 'strike',
  attackerSide: side,
  miss: false,
  isCrit: false,
  damage: 3,
  skillActivations: [],
  ...over,
});
const commit = (units, ctx = {}) => commitBattleDeeds(units, deedsData, ctx);
const earned = (u) => (u.deeds?.earned || []).map((e) => e.id);

afterEach(() => vi.restoreAllMocks());

describe('data', () => {
  it('has a strong set of 16–20 deeds with unique ids and single-line lore', () => {
    const ids = deedsData.deeds.map((d) => d.id);
    expect(ids.length).toBeGreaterThanOrEqual(16);
    expect(ids.length).toBeLessThanOrEqual(20);
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of deedsData.deeds) {
      expect(d.lore.length).toBeLessThanOrEqual(85);
      expect(d.lore).not.toMatch(/\n/);
      expect(d.prestige).toBeGreaterThanOrEqual(1);
      expect(d.prestige).toBeLessThanOrEqual(5);
    }
  });

  it('Oath skills exist and are taught by no scroll or level-up curriculum', () => {
    const scrollSkills = new Set(gameData.weapons.map((w) => w.skillId).filter(Boolean));
    const learnable = new Set(
      gameData.classes.flatMap((c) => (c.learnableSkills || []).map((l) => l.skillId)),
    );
    for (const d of deedsData.deeds.filter((x) => x.oathSkill)) {
      expect(gameData.skills.some((s) => s.id === d.oathSkill)).toBe(true);
      expect(scrollSkills.has(d.oathSkill)).toBe(false);
      expect(learnable.has(d.oathSkill)).toBe(false);
    }
  });
});

describe('recording', () => {
  it('records crits, strikes faced, wounds and the enemy-phase attack count', () => {
    const hero = unit();
    const enemy = foe();
    recordCombat(
      { events: [strike('attacker'), strike('defender', { isCrit: true }), strike('attacker', { miss: true, damage: 0 })] }, // prettier-ignore
      enemy,
      hero,
      { phase: 'enemy' },
    );
    const b = hero._battleDeeds;
    expect(b.crits).toBe(1);
    expect(b.strikesFaced).toBe(2);
    expect(b.woundsTaken).toBe(1);
    expect(b.phaseAttacks).toBe(1);
    expect(enemy._battleDeeds).toBeUndefined();
  });

  it('counts no phase attack in the player phase or for units not attacked', () => {
    const hero = unit();
    recordCombat({ events: [strike('defender')] }, hero, foe(), { phase: 'player' });
    expect(hero._battleDeeds.phaseAttacks).toBe(0);
  });

  it('brink: wounded to 1 HP, or saved by Miracle; not merely standing at 1 HP', () => {
    const wounded = unit({ currentHP: 1 });
    recordCombat({ events: [strike('attacker')] }, foe(), wounded, {});
    expect(wounded._battleDeeds.brink).toBe(1);
    const miracle = unit({ currentHP: 1 });
    recordCombat(
      { events: [strike('attacker', { skillActivations: [{ id: 'miracle' }] })] },
      foe(),
      miracle,
    );
    expect(miracle._battleDeeds.brink).toBe(1);
    const untouched = unit({ currentHP: 1 });
    recordCombat({ events: [strike('attacker', { miss: true, damage: 0 })] }, foe(), untouched);
    expect(untouched._battleDeeds.brink).toBe(0);
  });

  it('records kills with terrain, weapon, level gap, bosses and avenging', () => {
    const hero = unit({ level: 2 });
    const killer = foe({ level: 3 });
    const fallen = unit({ name: 'Mira' });
    recordKill(fallen, killer, {});
    expect(killer._slewAllies).toEqual(['Mira']);
    recordKill(killer, hero, { terrain: 'Forest' });
    recordKill(foe({ isBoss: true, name: 'Warchief', tier: 'promoted', level: 1 }), hero, {
      terrain: 'Mountain',
    });
    const b = hero._battleDeeds;
    expect(b.kills).toBe(2);
    expect(b.killsByTerrain).toEqual({ Forest: 1, Mountain: 1 });
    expect(b.killsByWeapon).toEqual({ Sword: 2 });
    expect(b.maxKillLevelGap).toBe(11); // promoted Lv1 = effective 13 vs 2
    expect(b.bossKills).toBe(1);
    expect(b.bossNames).toEqual(['Warchief']);
    expect(b.avenged).toBe(1);
  });

  it('ignores NPC and enemy-on-enemy outcomes; heals and dances only count for players', () => {
    const enemy = foe();
    recordKill(foe(), enemy, {});
    recordHeal(enemy, 10);
    recordRefresh(enemy);
    expect(enemy._battleDeeds).toBeUndefined();
    const cleric = unit();
    recordHeal(cleric, 7);
    recordHeal(cleric, -3);
    recordRefresh(cleric);
    expect(cleric._battleDeeds.healed).toBe(7);
    expect(cleric._battleDeeds.refreshes).toBe(1);
  });

  it('enemy-phase end: held phases with place, the lord’s shield; idempotent per turn', () => {
    const commander = unit({ isCommander: true, isLord: true, col: 5, row: 5 });
    const guard = unit({ col: 5, row: 6 });
    beginBattleDeeds(guard).phaseAttacks = 2;
    const ctx = { turn: 3, commander, terrainAt: () => 'Bridge', deedsData };
    recordEnemyPhaseEnd([commander, guard], ctx);
    recordEnemyPhaseEnd([commander, guard], ctx); // replay (resume): no double count
    expect(guard._battleDeeds.heldPhases).toBe(1);
    expect(guard._battleDeeds.heldPlaces).toEqual(['Bridge']);
    expect(guard._battleDeeds.shieldPhases).toBe(1);
    expect(guard._battleDeeds.phaseAttacks).toBe(0);
    // One attack: shield yes, held no; not adjacent: no shield.
    beginBattleDeeds(guard).phaseAttacks = 1;
    recordEnemyPhaseEnd([commander, guard], { ...ctx, turn: 4 });
    expect(guard._battleDeeds.heldPhases).toBe(1);
    expect(guard._battleDeeds.shieldPhases).toBe(2);
    guard.col = 9;
    beginBattleDeeds(guard).phaseAttacks = 3;
    recordEnemyPhaseEnd([commander, guard], { ...ctx, turn: 5 });
    expect(guard._battleDeeds.shieldPhases).toBe(2);
    // The one-attack phase broke the hold: a new streak starts, the best stays.
    expect(guard._battleDeeds.heldStreak).toBe(1);
    expect(guard._battleDeeds.heldPhases).toBe(1);
  });

  it('held counts enemy phases in a row, and the place of the longest hold', () => {
    const hero = unit({ col: 2, row: 2 });
    const places = ['Fort', 'Fort', 'Plain', 'Bridge', 'Bridge', 'Bridge'];
    const attacks = [2, 2, 0, 3, 2, 2];
    places.forEach((place, i) => {
      beginBattleDeeds(hero).phaseAttacks = attacks[i];
      recordEnemyPhaseEnd([hero], { turn: i + 2, terrainAt: () => place, deedsData });
    });
    expect(hero._battleDeeds).toMatchObject({ heldPhases: 3, heldStreak: 3 });
    expect(hero._battleDeeds.heldBestPlaces).toEqual(['Bridge', 'Bridge', 'Bridge']);
    commitBattleDeeds([hero], deedsData, {});
    expect(epithetText(hero)).toBe('Who Held the Bridge');
    // Two and two, broken in the middle, never makes three.
    const broken = unit();
    for (const [i, n] of [2, 2, 1, 2, 2].entries()) {
      beginBattleDeeds(broken).phaseAttacks = n;
      recordEnemyPhaseEnd([broken], { turn: i + 2, deedsData });
    }
    expect(broken._battleDeeds.heldPhases).toBe(2);
  });

  it('repairs partial scratch instead of counting into NaN', () => {
    const hero = unit();
    hero._battleDeeds = { v: 1, crits: 2 };
    recordCombat({ events: [strike('attacker', { isCrit: true })] }, hero, foe(), {});
    expect(hero._battleDeeds.crits).toBe(3);
    expect(hero._battleDeeds.kills).toBe(0);
  });

  it('never draws from Math.random', () => {
    const spy = vi.spyOn(Math, 'random');
    const hero = unit();
    recordCombat({ events: [strike('attacker', { isCrit: true })] }, hero, foe(), {});
    recordKill(foe({ isBoss: true }), hero, { terrain: 'Plain' });
    recordEnemyPhaseEnd([hero], { turn: 2 });
    commit([hero], { battleKey: 'k', deployedCount: 1 });
    applyPromotionOath(hero, gameData);
    expect(spy).not.toHaveBeenCalled();
  });
});

// One battle whose scratch meets exactly one condition (plus the negative).
const battleCases = [
  ['held_the_line', { heldPhases: 3, heldPlaces: ['Bridge', 'Fort', 'Bridge'] }, { heldPhases: 2 }],
  ['untouched', { strikesFaced: 5, woundsTaken: 0 }, { strikesFaced: 5, woundsTaken: 1 }],
  ['would_not_fall', { brink: 1 }, { brink: 0 }],
  ['red_harvest', { kills: 5 }, { kills: 4 }],
  ['giantslayer', { maxKillLevelGap: 6 }, { maxKillLevelGap: 5 }],
  ['bossbane', { bossKills: 1, bossNames: ['The Emperor'] }, { bossKills: 0 }],
  ['avenger', { avenged: 1 }, { avenged: 0 }],
  ['lordshield', { shieldPhases: 3 }, { shieldPhases: 2 }],
  ['keen_edge', { crits: 3 }, { crits: 2 }],
];

describe('battle deeds', () => {
  it.each(battleCases)('%s: awarded when met, not otherwise', (id, yes, no) => {
    const a = unit({ isLord: true });
    a._battleDeeds = { ...emptyBattleDeeds(), ...yes };
    commit([a]);
    expect(earned(a)).toContain(id);
    const b = unit({ isLord: true });
    b._battleDeeds = { ...emptyBattleDeeds(), ...no };
    commit([b]);
    expect(earned(b)).not.toContain(id);
  });

  it('resolves tokens once, at award: the place held most (ties: latest) and the boss', () => {
    const a = unit({ isLord: true });
    a._battleDeeds = { ...emptyBattleDeeds(), heldPhases: 3, heldPlaces: ['Fort', 'Forest', 'Forest'] }; // prettier-ignore
    commit([a]);
    expect(a.deeds.earned[0].epithet).toBe('Who Held the Wood');
    expect(a.deeds.earned[0].oath).toBe('Oath of the Wood');
    const tie = unit({ isLord: true });
    tie._battleDeeds = { ...emptyBattleDeeds(), heldPhases: 3, heldPlaces: ['Fort', 'Bridge', null] }; // prettier-ignore
    commit([tie]);
    expect(tie.deeds.earned[0].epithet).toBe('Who Held the Line');
    expect(bossPhrase('The Emperor', deedsData)).toBe('the Emperor');
    expect(bossPhrase('Iron Captain', deedsData)).toBe('the Iron Captain');
    expect(bossPhrase('The Entity', deedsData)).toBe('the Sleeper');
    expect(bossPhrase('Dark Champion', deedsData)).toBe('the Lieutenant');
  });

  it('the Last: the only non-lord standing after a battle with four or more deployed', () => {
    const lord = unit({ isLord: true });
    const last = unit();
    commit([lord, last], { deployedCount: 4 });
    expect(earned(last)).toContain('last_of_them');
    expect(earned(lord)).not.toContain('last_of_them');
    const few = unit();
    commit([unit({ isLord: true }), few], { deployedCount: 3 });
    expect(earned(few)).not.toContain('last_of_them');
    const two = [unit(), unit()];
    commit(two, { deployedCount: 6 });
    for (const u of two) expect(earned(u)).not.toContain('last_of_them');
  });
});

describe('run deeds', () => {
  const run = (stats) => {
    const u = unit({ isLord: true, deeds: { stats, earned: [] } });
    commit([u]);
    return u;
  };
  it.each([
    ['deathblow', { crits: 12 }, { crits: 11 }],
    ['mender', { healed: 150 }, { healed: 149 }],
    ['lantern', { healed: 400 }, { healed: 399 }],
    ['tempo', { refreshes: 12 }, { refreshes: 11 }],
    ['greenwood', { killsByTerrain: { Forest: 6 } }, { killsByTerrain: { Forest: 5, Plain: 9 } }],
    ['heights', { killsByTerrain: { Mountain: 6 } }, { killsByTerrain: { Mountain: 5 } }],
    ['mire', { killsByTerrain: { Swamp: 2, Bog: 2, 'Acidic Bog': 2 } }, { killsByTerrain: { Swamp: 5 } }], // prettier-ignore
    [
      'weapon_family',
      { killsByWeapon: { Lance: 25 } },
      { killsByWeapon: { Lance: 24, Sword: 24 } },
    ],
    ['veteran', { battles: 14 }, { battles: 13 }], // this victory is the 15th
  ])('%s: run tallies across battles', (id, yes, no) => {
    expect(earned(run(yes))).toContain(id);
    expect(earned(run(no))).not.toContain(id);
  });

  it('merges battle scratch into run tallies, and folds kills from every battle', () => {
    const hero = unit({ isLord: true });
    for (let i = 0; i < 3; i++) {
      recordKill(foe(), hero, { terrain: 'Forest' });
      recordKill(foe(), hero, { terrain: 'Forest' });
      commit([hero], { battleKey: `b${i}` });
    }
    expect(hero.deeds.stats).toMatchObject({ kills: 6, battles: 3, killsByTerrain: { Forest: 6 } }); // prettier-ignore
    expect(earned(hero)).toContain('greenwood');
    expect(hero._battleDeeds).toBeUndefined();
  });

  it('weapon family names the weapon with the most kills', () => {
    const u = run({ killsByWeapon: { Sword: 10, Bow: 30, Staff: 99 } });
    expect(u.deeds.earned.find((e) => e.id === 'weapon_family').epithet).toBe('Far-Sight');
  });

  it('legacy units seed battles from class-mastery counts', () => {
    const vet = unit({ isLord: true, classBattles: { Myrmidon: 10, Swordmaster: 4 } });
    commit([vet]);
    expect(vet.deeds.stats.battles).toBe(15);
    expect(earned(vet)).toContain('veteran');
  });
});

describe('commit', () => {
  it('is idempotent per battle key and clears the scratch', () => {
    const hero = unit({ isLord: true });
    hero._battleDeeds = { ...emptyBattleDeeds(), crits: 3 };
    const first = commit([hero], { battleKey: 'act1:n3:2', act: 'act1', battle: 3 });
    expect(first.map((a) => a.deedId)).toEqual(['keen_edge']);
    expect(hero._battleDeeds).toBeUndefined();
    const snapshot = structuredClone(hero.deeds);
    hero._battleDeeds = { ...emptyBattleDeeds(), crits: 9 };
    expect(commit([hero], { battleKey: 'act1:n3:2' })).toEqual([]);
    expect(hero.deeds).toEqual(snapshot);
    expect(hero._battleDeeds).toBeUndefined();
    expect(hero.deeds.earned[0].awardedAt).toEqual({ act: 'act1', battle: 3 });
  });

  it('never awards the same deed twice and skips the fallen', () => {
    const hero = unit({ isLord: true });
    hero._battleDeeds = { ...emptyBattleDeeds(), crits: 3 };
    commit([hero], { battleKey: 'a' });
    hero._battleDeeds = { ...emptyBattleDeeds(), crits: 5 };
    expect(commit([hero], { battleKey: 'b' })).toEqual([]);
    const dead = unit({ currentHP: 0 });
    dead._battleDeeds = { ...emptyBattleDeeds(), crits: 5 };
    commit([dead]);
    expect(dead.deeds).toBeUndefined();
  });

  it('prestige picks the title; ties go to the most recent', () => {
    const hero = unit({ isLord: true });
    hero._battleDeeds = { ...emptyBattleDeeds(), crits: 3 }; // keen_edge (2)
    commit([hero], { battleKey: '1' });
    expect(epithetText(hero)).toBe('the Keen Edge');
    hero._battleDeeds = { ...emptyBattleDeeds(), kills: 5 }; // red_harvest (3)
    const [announcement] = commit([hero], { battleKey: '2' });
    expect(announcement.isTitle).toBe(true);
    expect(epithetText(hero)).toBe('of the Red Harvest');
    hero._battleDeeds = { ...emptyBattleDeeds(), brink: 1 }; // would_not_fall (3), newer
    commit([hero], { battleKey: '3' });
    expect(epithetText(hero)).toBe('Who Would Not Fall');
    hero._battleDeeds = { ...emptyBattleDeeds(), crits: 0, strikesFaced: 0 };
    commit([hero], { battleKey: '4' });
    expect(epithetText(hero)).toBe('Who Would Not Fall');
    expect(pickEpithet([])).toBeNull();
  });

  it('announcements carry the rite’s words', () => {
    const hero = unit({ name: 'Elara', isLord: true });
    hero._battleDeeds = { ...emptyBattleDeeds(), heldPhases: 3, heldPlaces: ['Bridge'] };
    const [a] = commit([hero]);
    expect(a).toMatchObject({
      unit: hero,
      unitName: 'Elara',
      deedId: 'held_the_line',
      name: 'Held the Line',
      epithet: 'Who Held the Bridge',
      titled: 'Elara, Who Held the Bridge',
      oath: 'Oath of the Bridge',
      oathSkill: 'pavise',
      isTitle: true,
    });
  });
});

describe('display', () => {
  const titled = (text, form) => ({ deeds: { epithet: { id: 'x', text, form } } });
  it('joins titles by form and never touches the name', () => {
    const cases = [
      ['Who Held the Bridge', 'who', 'Elara, Who Held the Bridge', 'Elara, Who Held the Bridge,'],
      ['the Untouched', 'the', 'Elara the Untouched', 'Elara the Untouched'],
      ['of the Mire', 'of', 'Elara of the Mire', 'Elara of the Mire'],
      ['Bane of the Emperor', 'bane', 'Elara, Bane of the Emperor', 'Elara, Bane of the Emperor,'],
      ['Lantern of the March', 'title', 'Elara, Lantern of the March', 'Elara, Lantern of the March,'], // prettier-ignore
      ['Deathblow', 'name', 'Elara Deathblow', 'Elara Deathblow'],
    ];
    for (const [text, form, full, sentence] of cases) {
      const u = { name: 'Elara', ...titled(text, form) };
      expect(unitDisplayName(u, { epithet: true })).toBe(full);
      expect(unitDisplayName(u)).toBe('Elara');
      expect(sentenceName(u)).toBe(sentence);
      expect(u.name).toBe('Elara');
    }
    expect(unitDisplayName({ name: 'Kai' }, { epithet: true })).toBe('Kai');
    expect(sentenceName({ name: 'Kai' })).toBe('Kai');
    expect(titledName('Kai', null)).toBe('Kai');
  });

  it('lists deeds with the title first and tallies the march', () => {
    const hero = unit({ isLord: true });
    hero._battleDeeds = { ...emptyBattleDeeds(), bossKills: 1, bossNames: ['Warchief'], crits: 3, kills: 2 }; // prettier-ignore
    commit([hero], { act: 'act2', battle: 7 });
    const list = deedsForDisplay(hero, deedsData);
    expect(list.map((d) => d.id)).toEqual(['bossbane', 'keen_edge']);
    expect(list[0]).toMatchObject({ isTitle: true, epithet: 'Bane of the Warchief', awardedAt: { act: 'act2', battle: 7 } }); // prettier-ignore
    expect(list[0].lore).toBeTruthy();
    expect(deedTallyText(hero)).toBe('2 kills · 3 critical hits · 1 battle');
    expect(deedTallyText(unit())).toBe('');
  });
});

describe('persistence', () => {
  it('sanitizes saved deeds idempotently and drops garbage', () => {
    const raw = {
      stats: { kills: 3, crits: -2, killsByTerrain: { Forest: 2, '': 4, Bog: 'x' }, junk: 1 },
      earned: [
        { id: 'keen_edge', epithet: 'the Keen Edge', form: 'the', prestige: 2, seq: 1 },
        { id: 'keen_edge', epithet: 'dupe', form: 'the', prestige: 2, seq: 2 },
        { id: 'bad' },
        { id: 'untouched', epithet: 'the Untouched', form: 'nope', prestige: 9, seq: 2 },
      ],
      epithet: { id: 'forged', text: 'Emperor', form: 'the' },
      lastBattle: 'act1:n1:0',
    };
    const once = sanitizeUnitDeeds(raw);
    expect(once.stats).toEqual({ kills: 3, killsByTerrain: { Forest: 2 } });
    expect(once.earned.map((e) => e.id)).toEqual(['keen_edge', 'untouched']);
    expect(once.earned[1]).toMatchObject({ form: 'the', prestige: 5 });
    expect(once.epithet).toEqual({ id: 'untouched', text: 'the Untouched', form: 'the' });
    expect(sanitizeUnitDeeds(once)).toEqual(once);
    expect(sanitizeUnitDeeds(null)).toBeNull();
  });

  it('legacy units stay without deeds; broken deeds are removed', () => {
    const legacy = { name: 'Old', stats: {} };
    expect(normalizeUnitDeeds(legacy)).toBe(legacy);
    expect('deeds' in legacy).toBe(false);
    const broken = normalizeUnitDeeds({ name: 'B', deeds: 'x' });
    expect('deeds' in broken).toBe(false);
  });
});

describe('Oaths', () => {
  const sworn = (deedId, extra = {}) => {
    const def = deedsData.deeds.find((d) => d.id === deedId);
    return unit({
      isLord: true,
      ...extra,
      deeds: sanitizeUnitDeeds({
        stats: {},
        earned: [
          { id: deedId, epithet: def.epithet.text, form: def.epithet.form, prestige: def.prestige, seq: 1, oath: 'Oath of the Bridge' }, // prettier-ignore
        ],
      }),
    });
  };

  it('swears the highest-prestige deed’s skill once', () => {
    const u = sworn('held_the_line');
    const oath = applyPromotionOath(u, gameData);
    expect(oath).toMatchObject({ skillId: 'pavise', name: 'Oath of the Bridge', learned: true });
    expect(u.skills).toContain('pavise');
    expect(u.deeds.oath).toMatchObject({ deedId: 'held_the_line', skillId: 'pavise' });
    expect(applyPromotionOath(u, gameData)).toBeNull();
  });

  it('falls through to the next deed when the skill is already known', () => {
    const u = sworn('held_the_line', { skills: ['pavise'] });
    u.deeds.earned.push({ id: 'keen_edge', epithet: 'the Keen Edge', form: 'the', prestige: 2, seq: 2, oath: 'Oath of the Edge' }); // prettier-ignore
    expect(promotionOath(u, deedsData, gameData.skills).skillId).toBe('crit_plus_15');
  });

  it('reports a dropped Oath at the skill cap and does not record it', () => {
    const u = sworn('held_the_line', { skills: ['a', 'b', 'c', 'd', 'e'] });
    const oath = applyPromotionOath(u, gameData);
    expect(oath).toMatchObject({ learned: false, dropped: true });
    expect(u.deeds.oath).toBeUndefined();
  });

  it('nothing to swear without deeds, or for deeds without an Oath', () => {
    expect(applyPromotionOath(unit(), gameData)).toBeNull();
    expect(applyPromotionOath(sworn('tempo'), gameData)).toBeNull();
  });

  it('conditions of unknown types never match', () => {
    expect(evaluateDeedCondition({ type: 'mystery' }, { battle: {}, run: {} })).toBeNull();
    expect(evaluateDeedCondition({ type: 'all', of: [] }, { battle: {}, run: {} })).toBeNull();
  });
});
