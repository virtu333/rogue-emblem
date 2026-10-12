// Deathburst settlement: the one rule BattleScene.removeUnit drives with presentation and the
// headless harness (tests/harness/HeadlessBattle.js `_removeUnit`) drives without.
//
// A unit that falls carrying an on-death `aoe_damage` affix (Deathburst) bursts where it fell:
// for each such effect, every unit within its range of that tile (AffixSystem.deathburstVictims,
// measured by combatDistance, so the Entity is caught beside any tile of its 3x3 body), allies
// and foes alike, still standing when its turn comes, takes the effect's amount through
// UnitHealth.damageUnitDetailed (no hit roll, no Miracle): a Revival Stone refills a bar and the
// Unbroken Banner holds a player unit at 1 (`world.battleBlessings`).
//
// A generator: each blow is yielded after its HP change and before the next victim is read, so
// the caller presents it and removes a fallen victim (killer: the unit that burst) first; a
// victim that fall's own Deathburst already felled is skipped. The victims of an effect are read
// from `world.units()` when that effect begins. No draw is taken.
//
// Yields
//   { kind: 'blow', victim, effect, damage, lost, stoneBroken, bannerHeld, fell }
//   { kind: 'burst', effect }       after each effect's last blow (the scene's pause)
// and returns the plain record { blows } (every blow, in order).
//
// world: { affixes (gameData.affixes), units() (every unit on the field), battleBlessings? }

import { deathburstVictims, getOnDeathAffixes } from './AffixSystem.js';
import { damageUnitDetailed } from './UnitHealth.js';

/** The on-death area effects `unit` carries (Deathburst), in affix order. */
export function deathburstEffects(unit, affixes) {
  return getOnDeathAffixes(unit, affixes).filter((effect) => effect?.type === 'aoe_damage');
}

export function* deathburst(unit, tile, world) {
  const blows = [];
  if (!unit || !tile) return { blows };
  for (const effect of deathburstEffects(unit, world?.affixes)) {
    const victims = deathburstVictims(tile, world.units(), effect.range || 1);
    for (const victim of victims) {
      if (victim === unit || victim.currentHP <= 0) continue;
      const damage = effect.amount;
      const { lost, stoneBroken, bannerHeld } = damageUnitDetailed(victim, damage, {
        blessings: world.battleBlessings ?? null,
      });
      const blow = {
        kind: 'blow',
        victim,
        effect,
        damage,
        lost,
        stoneBroken: Boolean(stoneBroken),
        bannerHeld: Boolean(bannerHeld),
        fell: victim.currentHP <= 0,
      };
      blows.push(blow);
      yield blow;
    }
    yield { kind: 'burst', effect };
  }
  return { blows };
}

/**
 * Drive a Deathburst without presentation (the harness): a fallen victim is removed through
 * `remove(victim, { killer: unit })` before the next one is read, as the scene does. Returns
 * the step's record.
 */
export function runDeathburstSync(unit, tile, world, { remove } = {}) {
  const steps = deathburst(unit, tile, world);
  for (;;) {
    const { value, done } = steps.next();
    if (done) return value;
    if (value.kind === 'blow' && value.victim.currentHP <= 0)
      remove?.(value.victim, { killer: unit });
  }
}
