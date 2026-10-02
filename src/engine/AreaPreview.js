// AreaPreview — what an area weapon art will do, as the player knows the board
// (docs/specs/aoe-weapon-arts.md §5). Pure: no Phaser, no RNG.
//
// It runs the same shapes and blows as execution (AreaShapes, AreaDamage) over the units
// in a PlayerKnowledge view only: a unit the fog hides is never a victim, never a ram's
// obstacle and never the most-wounded pick. The footprint is geometry and terrain, which
// the player always knows, so it never depends on a hidden unit either. Execution can
// still differ because of a hidden unit (a crash the preview did not show); that is the
// rule working.

import { areaBounds, planAreaBlows } from './AreaDamage.js';
import { areaTilesFor } from './AreaShapes.js';
import { gridDistance } from './Combat.js';
import {
  getWeaponArtArea,
  getWeaponArtTargeting,
  getWeaponArtTier2Effects,
  getWeaponArtTier5Effects,
} from './WeaponArtSystem.js';
import { resolvePostCombatMove } from './WeaponArtPostCombat.js';
import { isDisplacementImmune } from './AffixSystem.js';

const isHostile = (a, b) => {
  if (!a || !b || a === b) return false;
  if (a.faction === 'enemy') return b.faction === 'player';
  return b.faction === 'enemy';
};

/**
 * @param {object} p
 * @param {object} p.attacker     the art's user, on the tile it attacks from
 * @param {object} p.art          the weapon art
 * @param {object|null} p.target  the combat's target (normal_attack)
 * @param {object|null} p.center  the aimed tile (chosen_center)
 * @param {object} p.knowledge    createPlayerKnowledge(...) for the player's previews
 * @param {object} p.world        { cols, rows, getMoveCost, getTerrainAt?, affixes? }
 * @param {object|null} p.strikeMods the attacker's merged combat mods (Combat.combatStrikeMods)
 * @param {object|null} [p.weapon] the weapon the art strikes with (the art's weapon, which
 *                                confirming equips; default: the equipped one)
 * @param {number} [p.blows]      how many blows a per-hit area lands (the forecast's hits)
 * @param {number} [p.dealt]      the damage the forecast says the target takes (for heals)
 * @returns {{ tiles: object[], victims: object[], heals: object[], push: object|null } | null}
 */
export function previewAreaArt({
  attacker,
  art,
  target = null,
  center = null,
  knowledge,
  world,
  strikeMods = null,
  weapon = null,
  blows = 1,
  dealt = 0,
}) {
  if (!attacker || !art) return null;
  const known = (knowledge?.units || []).filter((u) => u.currentHP > 0);
  const area = getWeaponArtArea(art);
  const targeting = getWeaponArtTargeting(art);
  const out = { target, center, tiles: [], victims: [], heals: [], push: null };

  if (area) {
    out.tiles = areaTilesFor(area, { attacker, target, center }, areaBounds(world));
    const count = area.strikes === 'each_landed' ? Math.max(1, Math.trunc(blows) || 1) : 1;
    const floor = area.nonLethal ? 1 : 0;
    const plan = planAreaBlows({
      source: attacker,
      primary: targeting === 'normal_attack' ? target : null,
      center,
      area,
      units: known.filter((u) => isHostile(attacker, u)),
      world,
      strikeMods,
      weapon,
    });
    out.victims = plan.map(({ unit, damage }) => {
      const hpAfter = Math.max(Math.min(floor, unit.currentHP), unit.currentHP - damage * count);
      return { unit, damage: unit.currentHP - hpAfter, hpAfter, kills: hpAfter <= 0 };
    });
  }

  const { allyHeal } = getWeaponArtTier5Effects(art);
  if (allyHeal) {
    const amount = Math.floor((Math.max(0, dealt) * allyHeal.percentOfDamage) / 100);
    out.heals = known
      .filter((u) => u !== attacker && u.faction === attacker.faction)
      .filter((u) => gridDistance(attacker.col, attacker.row, u.col, u.row) <= allyHeal.radius)
      .map((unit) => ({
        unit,
        amount: Math.max(0, Math.min(amount, (unit.stats?.HP ?? unit.currentHP) - unit.currentHP)),
      }));
  }

  const ram = (getWeaponArtTier2Effects(art).postCombatMove || []).find((m) => m.mode === 'ram');
  if (ram && target) {
    const knownAt = (col, row) => known.find((u) => u.col === col && u.row === row) || null;
    const move = resolvePostCombatMove({
      sourceUnit: attacker,
      targetUnit: target,
      mode: 'ram',
      distance: ram.distance,
      cols: world.cols,
      rows: world.rows,
      getMoveCost: world.getMoveCost,
      getUnitAt: knownAt,
      isImmovable: (unit) => isDisplacementImmune(unit, world.affixes),
    });
    if (move.ok) {
      const to = move.assignments[0] || { col: target.col, row: target.row };
      const obstacle = move.collision?.obstacle || null;
      out.push = {
        to: { col: to.col, row: to.row },
        crash: Boolean(move.collision),
        damage: move.collision ? ram.collisionDamage : 0,
        obstacle: obstacle && isHostile(attacker, obstacle) ? obstacle : null,
      };
    } else if (move.reason === 'rooted' || move.reason === 'immovable') {
      out.push = {
        to: { col: target.col, row: target.row },
        crash: false,
        damage: 0,
        braced: true,
      };
    }
  }
  return out;
}

/**
 * The forecast's Area lines: a summary, then up to `max` victims, then "+N more". A
 * normal attack's area lands only if a strike does, so its summary says so, as the heals
 * line does; a chosen-center strike (`onHit: false`) always lands. Only units in the
 * preview (the known ones) are named.
 */
export function areaForecastLines(preview, { max = 3, onHit = true } = {}) {
  if (!preview) return [];
  const lines = [];
  const { victims = [], heals = [], push = null } = preview;
  if (victims.length > 0) {
    const kos = victims.filter((v) => v.kills).length;
    const count = `${victims.length} ${victims.length === 1 ? 'foe' : 'foes'}${kos ? `, ${kos} KO` : ''}`;
    lines.push(onHit ? `Area if it hits: ${count}` : `Area: ${count}`);
    for (const v of victims.slice(0, max))
      lines.push(`${v.unit.name} −${v.damage}${v.kills ? ' KO' : ''}`);
    if (victims.length > max) lines.push(`+${victims.length - max} more`);
  }
  const healing = heals.filter((h) => h.amount > 0);
  if (healing.length > 0)
    lines.push(`If it hits: ${healing.map((h) => `${h.unit.name} +${h.amount}`).join(', ')}`);
  if (push?.braced) lines.push('Push: the target braces');
  else if (push?.crash)
    lines.push(
      `Push: crash −${push.damage}${push.obstacle ? ` (and ${push.obstacle.name} −${push.damage})` : ''}`,
    );
  return lines;
}
