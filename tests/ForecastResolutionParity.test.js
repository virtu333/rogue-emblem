// Property test: the combat forecast is the source of truth the player reads,
// so for any matchup the per-hit damage, Hit, Crit and number of strikes it
// shows must be exactly what resolveCombat applies. Playtest 2026-09-25:
// "damage preview on myrmidon attack doesn't work (I'm guessing doesn't take
// disadvantage into account)".
//
// Seeded random matchups across every combat weapon type (triangle advantage /
// disadvantage, reavers, brave, effective, magic swords, Sunder, stat-bonus
// weapons), weapon ranks, class skills, mastery perks, traits, affixes,
// combat accessories, imbues, weapon arts, terrain and range. Per-strike procs
// (Luna, Sol, Pavise, ...) are outside the displayed numbers by design and are
// not rolled here; everything the forecast folds in is.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCombatForecast, resolveCombat, parseRange, isStaff } from '../src/engine/Combat.js';
import { getSkillCombatMods, applyAccessoryPhaseCombatMods } from '../src/engine/SkillSystem.js';
import { getWeaponArtCombatMods } from '../src/engine/WeaponArtSystem.js';
import { forecastProjection } from '../src/ui/forecastDisplay.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const SAMPLES = 2500;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COMBAT_WEAPONS = data.weapons.filter(
  (w) => !isStaff(w) && !['Scroll', 'Consumable'].includes(w.type) && w.range,
);
const CLASSES = data.classes.filter((c) => c.tier !== 'boss' && c.moveType);
const COMBAT_ACCESSORIES = data.accessories.filter((a) => a.combatEffects);
const TERRAIN = data.terrain.filter((t) => t && t.name);
const PASSIVE_SKILLS = data.skills.filter((s) =>
  ['passive', 'passive-aura', 'on-combat-start'].includes(s.trigger),
);
const PROC_SKILLS = data.skills.filter((s) => ['on-attack', 'on-defend'].includes(s.trigger));
const ARTS = data.weaponArts.arts || data.weaponArts;
const AFFIXES = (data.affixes.affixes || data.affixes).filter?.((a) => a?.id) || [];
const IMBUES = (data.imbues.imbues || data.imbues).filter?.((i) => i?.id) || [];
const TRAITS = (data.traits.traits || data.traits).filter?.((t) => t?.id) || [];
const STAT_KEYS = ['STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK'];

function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

function makeUnit(rng, name, faction, col, row) {
  const cls = pick(rng, CLASSES);
  const base = cls.baseStats || data.classes.find((c) => c.name === cls.promotesFrom)?.baseStats;
  const stats = { HP: 999, MOV: base?.MOV || 5 };
  for (const key of STAT_KEYS)
    stats[key] = Math.max(0, (base?.[key] || 3) + Math.floor(rng() * 14));
  const weapon = structuredClone(pick(rng, COMBAT_WEAPONS));
  if (IMBUES.length && rng() < 0.12) weapon._imbueId = pick(rng, IMBUES).id;
  const skills = [];
  for (let i = 0; i < 3; i++) if (rng() < 0.45) skills.push(pick(rng, PASSIVE_SKILLS).id);
  // Proc skills only matter for the "simple exchange" gate, never for numbers.
  if (rng() < 0.2) skills.push(pick(rng, PROC_SKILLS).id);
  const unit = {
    name,
    faction,
    className: cls.name,
    tier: cls.tier,
    level: 1 + Math.floor(rng() * 20),
    moveType: rng() < 0.15 ? 'Flying' : cls.moveType,
    stats,
    // Large HP pool so nothing dies mid-exchange; HP-conditional skills still vary.
    currentHP: 300 + Math.floor(rng() * 700),
    weapon,
    inventory: [weapon],
    weaponRank: rng() < 0.4 ? 'Mast' : 'Prof',
    skills: [...new Set(skills)],
    affixes: faction === 'enemy' && AFFIXES.length && rng() < 0.25 ? [pick(rng, AFFIXES).id] : [],
    accessory: rng() < 0.3 ? structuredClone(pick(rng, COMBAT_ACCESSORIES)) : null,
    traits: TRAITS.length && rng() < 0.4 ? [pick(rng, TRAITS).id] : [],
    isBoss: faction === 'enemy' && rng() < 0.1,
    col,
    row,
    battleMastery: rng() < 0.3 ? { [cls.name]: 99 } : undefined,
  };
  if (unit.skills.includes('miracle')) unit._miracleUsed = false;
  return unit;
}

// Mirrors BattleScene.buildSkillCtx without per-strike roll hooks.
function buildSkillCtx(rng, attacker, defender, allies, enemies, atkTerrain, defTerrain) {
  const ctx = { classesData: data.classes, traitsData: data.traits };
  const atkMods = getSkillCombatMods(
    attacker, defender, allies, enemies, data.skills, atkTerrain, true, data.affixes, ctx,
  ); // prettier-ignore
  const defMods = getSkillCombatMods(
    defender, attacker, enemies, allies, data.skills, defTerrain, false, data.affixes, ctx,
  ); // prettier-ignore
  const turnNumber = 1 + Math.floor(rng() * 6);
  const rollSession = { gamblerAtkDeltaByUnit: new Map() };
  const fixedRng = mulberry32(Math.floor(rng() * 1e9));
  applyAccessoryPhaseCombatMods(attacker, atkMods, { turnNumber, rollSession, rng: fixedRng });
  applyAccessoryPhaseCombatMods(defender, defMods, { turnNumber, rollSession, rng: fixedRng });
  const arts = ARTS.filter((a) => a.weaponType === attacker.weapon.type && a.combatMods);
  const art = arts.length && rng() < 0.25 ? pick(rng, arts) : null;
  return {
    atkMods,
    defMods,
    atkWeaponArtMods: art ? getWeaponArtCombatMods(art) : null,
    skillsData: data.skills,
    imbuesData: data.imbues,
    affixData: data.affixes,
  };
}

function makeMatchup(seed) {
  const rng = mulberry32(seed);
  const attacker = makeUnit(rng, 'A', 'player', 5, 5);
  const [min, max] = (() => {
    const r = parseRange(attacker.weapon.range);
    return [r.min, Math.min(r.max, 3)];
  })();
  const distance = min + Math.floor(rng() * (max - min + 1));
  const defender = makeUnit(rng, 'D', 'enemy', 5 + distance, 5);
  const allies = [attacker];
  const enemies = [defender];
  // A few bystanders for aura / adjacency / isolation conditions.
  if (rng() < 0.5) allies.push({ ...makeUnit(rng, 'A2', 'player', 5, 6) });
  if (rng() < 0.5) enemies.push({ ...makeUnit(rng, 'D2', 'enemy', 6 + distance, 5) });
  const atkTerrain = pick(rng, TERRAIN);
  const defTerrain = pick(rng, TERRAIN);
  const skillCtx = buildSkillCtx(rng, attacker, defender, allies, enemies, atkTerrain, defTerrain);
  return { attacker, defender, distance, atkTerrain, defTerrain, skillCtx };
}

// Constant Math.random: rollHit lands iff 100·c < hit, a crit iff 100·c < crit.
function resolveWith(c, m) {
  vi.spyOn(Math, 'random').mockReturnValue(Math.max(0, Math.min(0.999999, c)));
  const attacker = structuredClone(m.attacker);
  const defender = structuredClone(m.defender);
  return resolveCombat(
    attacker,
    attacker.weapon,
    defender,
    defender.weapon,
    m.distance,
    m.atkTerrain,
    m.defTerrain,
    m.skillCtx,
  );
}

function forecastOf(m) {
  const attacker = structuredClone(m.attacker);
  const defender = structuredClone(m.defender);
  return getCombatForecast(
    attacker,
    attacker.weapon,
    defender,
    defender.weapon,
    m.distance,
    m.atkTerrain,
    m.defTerrain,
    m.skillCtx,
  );
}

// A probe is inconclusive when a death (a Vengeance art at low HP, a triple
// crit) ended the exchange before the probed side struck.
const INCONCLUSIVE = Symbol('inconclusive');
const firstStrike = (result, side) =>
  result.events.find((e) => e.type === 'strike' && e.attackerSide === side) ||
  (result.attackerDied || result.defenderDied ? INCONCLUSIVE : undefined);
const strikes = (result, side) =>
  result.events.filter((e) => e.type === 'strike' && e.attackerSide === side);

afterEach(() => vi.restoreAllMocks());

describe('forecast equals resolution for random matchups', () => {
  it(`per-hit damage, Hit, Crit and strike count match (${SAMPLES} seeded matchups)`, () => {
    const mismatches = [];
    let triangleCases = 0;
    for (let seed = 1; seed <= SAMPLES; seed++) {
      const m = makeMatchup(seed);
      const f = forecastOf(m);
      if (f.display?.triangle?.damage) triangleCases++;
      for (const side of ['attacker', 'defender']) {
        const info = f[side];
        if (side === 'defender' && !info.canCounter) continue;
        const critMult = m.defender.className === 'Entity' ? 1.5 : 3;
        // Hit: lands at 100·c = hit − 0.5, misses at hit + 0.5.
        const landed = firstStrike(resolveWith((info.hit - 0.5) / 100, m), side);
        const missed = firstStrike(resolveWith((info.hit + 0.5) / 100, m), side);
        const hitOk =
          landed === INCONCLUSIVE || missed === INCONCLUSIVE
            ? true
            : info.hit <= 0
              ? landed?.miss !== false
              : info.hit >= 100
                ? landed?.miss === false && missed?.miss === false
                : landed?.miss === false && missed?.miss === true;
        // Damage: at 100·c just above Crit (and below Hit) a strike lands
        // without a critical and deals exactly the shown damage; when Crit is
        // at least Hit, a landed strike always crits for the shown damage × 3.
        let damageOk = true;
        let critOk = true;
        const shownDamage = info.damage;
        if (info.hit > 0) {
          if (info.crit < info.hit) {
            const s = firstStrike(resolveWith((Math.max(info.crit, 0) + 0.5) / 100, m), side);
            damageOk =
              s === INCONCLUSIVE ||
              (Boolean(s) && !s.miss && !s.isCrit && s.damage === shownDamage);
            // Crit: a landed strike at 100·c = crit − 0.5 is critical.
            if (info.crit > 0) {
              const c = firstStrike(resolveWith((info.crit - 0.5) / 100, m), side);
              critOk =
                c === INCONCLUSIVE ||
                (Boolean(c) &&
                  !c.miss &&
                  c.isCrit &&
                  c.damage === Math.floor(shownDamage * critMult));
            }
          } else {
            const c = firstStrike(resolveWith((info.hit - 0.5) / 100, m), side);
            critOk =
              c === INCONCLUSIVE ||
              (Boolean(c) &&
                !c.miss &&
                c.isCrit &&
                c.damage === Math.floor(shownDamage * critMult));
          }
        }
        // Strike count: all strikes miss at c ≈ 1, so nobody dies and every
        // planned strike is attempted.
        const allMiss = resolveWith(0.999999, m);
        const countOk = info.hit >= 100 || strikes(allMiss, side).length === info.attackCount;
        if (!hitOk || !damageOk || !critOk || !countOk) {
          mismatches.push({
            seed,
            side,
            hitOk,
            damageOk,
            critOk,
            countOk,
            shown: { damage: info.damage, hit: info.hit, crit: info.crit, count: info.attackCount },
            weapons: [m.attacker.weapon.name, m.defender.weapon.name],
          });
        }
      }
    }
    expect(triangleCases).toBeGreaterThan(SAMPLES / 10);
    expect(mismatches.slice(0, 5)).toEqual([]);
  });

  it('the "if all hits land" projection equals the resolved HP when shown', () => {
    const mismatches = [];
    let shown = 0;
    for (let seed = 1; seed <= SAMPLES; seed++) {
      const m = makeMatchup(seed + 100_000);
      // Realistic HP so exchanges can be lethal.
      for (const u of [m.attacker, m.defender]) {
        u.stats.HP = 15 + (seed % 40);
        u.currentHP = 1 + ((seed * 7) % u.stats.HP);
      }
      m.skillCtx = buildSkillCtx(
        mulberry32(seed),
        m.attacker,
        m.defender,
        [m.attacker],
        [m.defender],
        m.atkTerrain,
        m.defTerrain,
      );
      const f = forecastOf(m);
      const projection = forecastProjection(f);
      if (!projection) continue;
      if (f.attacker.crit >= 100 || f.defender.crit >= 100) continue;
      if (f.attacker.hit <= 0 || (f.defender.canCounter && f.defender.hit <= 0)) continue;
      // Every strike lands (both Hit > c), none crit (both Crit ≤ c).
      const c = Math.max(f.attacker.crit, f.defender.canCounter ? f.defender.crit : 0);
      const lowestHit = Math.min(f.attacker.hit, f.defender.canCounter ? f.defender.hit : 100);
      if (c >= lowestHit) continue;
      shown++;
      const result = resolveWith((c + 0.5) / 100, m);
      if (
        result.attackerHP !== projection.attackerHP ||
        result.defenderHP !== projection.defenderHP
      )
        mismatches.push({
          seed,
          projection,
          resolved: { attackerHP: result.attackerHP, defenderHP: result.defenderHP },
          weapons: [m.attacker.weapon.name, m.defender.weapon.name],
        });
    }
    expect(shown).toBeGreaterThan(40);
    expect(mismatches.slice(0, 5)).toEqual([]);
  });
});
