// The battle as text, for an agent playing through the headless harness (tools/play).
//
// Everything here reads what the player knows (engine/PlayerKnowledge.js, the Danger
// overlay's ThreatForecast) and never what the fog hides. Nothing here mutates the
// battle or draws from the battle's random stream: a forecast that would roll (the
// Gambler accessory) is computed on a throwaway stream and says so.

import {
  calculateEffectiveSpeed,
  forecastStrikeGroups,
  getCombatForecast,
  getEffectiveStaffRange,
  getPerBattleRemainingUses,
  getStaffMaxUses,
  getStaffRemainingUses,
  isStaff,
  parseRange,
  resolveHeal,
} from '../../src/engine/Combat.js';
import { getAttackWeapons } from '../../src/engine/AttackOptions.js';
import { combatDistance, getFootprint, isEntity } from '../../src/engine/EntitySystem.js';
import { createPlayerKnowledge } from '../../src/engine/PlayerKnowledge.js';
import { computeDangerTiles, threatsOnTile } from '../../src/engine/ThreatForecast.js';
import { statusDescriptions, terrainRuleLines } from '../../src/engine/BattleInformation.js';
import { findRecruitNpc, isRecruitNpc } from '../../src/engine/RecruitNpc.js';
import { getTerrainCostReduction, getWeaponRangeBonus } from '../../src/engine/SkillSystem.js';
import { getLatePressureState, getBossEnrageTurn } from '../../src/engine/TurnBonusCalculator.js';
import { isAreaStrikeCenter } from '../../src/engine/AreaStrike.js';
import { isRooted } from '../../src/engine/StatusConditionSystem.js';
import { PlayError } from './parse.js';
import { hitChancePercent } from '../../src/ui/forecastDisplay.js';

export const TERRAIN_GLYPHS = Object.freeze({
  Plain: '.',
  Forest: 'f',
  Mountain: '^',
  Fort: 'F',
  Throne: '*',
  Wall: '#',
  Water: '~',
  Bridge: '=',
  Sand: ':',
  Village: 'V',
  Ice: '_',
  'Lava Crack': '%',
  Floor: ',',
  Pillar: 'I',
  Ballista: 'B',
  Swamp: 's',
  Bog: 'b',
  'Acidic Swamp': 'S',
  'Acidic Bog': 'x',
});

const OBJECTIVE_TEXT = {
  rout: 'Rout: defeat every enemy.',
  seize: 'Seize: defeat the boss, then move a lord onto the throne and Seize.',
  escape:
    'Escape: move your commander onto an escape tile (X) and Escape. Others may escape first (gold for each).',
};

export const tileKey = (col, row) => `${col},${row}`;

/**
 * Stable short ids for the units of one battle: P1.. for the army, E1.. for enemies,
 * N1.. for NPCs. An enemy gets its id the first time the player can see it, so an id
 * never reveals a unit the fog hides. Ids are assigned only by `sync` (after each
 * committed step), never by a view, so replaying a session assigns the same ids.
 */
export class UnitIds {
  constructor() {
    this.byUnit = new Map();
    this.aliases = new Map();
    this.next = { P: 1, E: 1, N: 1 };
  }

  /** Assigns new ids; returns the units that changed id (a recruit that joined). */
  sync(battle) {
    const known = knowledgeOf(battle);
    const renamed = [];
    for (const u of battle.playerUnits) {
      const old = this.byUnit.get(u);
      if (old && !old.startsWith('P')) {
        // A recruit joined: it answers to its army id now, and still to its old one.
        this.byUnit.delete(u);
        this._assign(u, 'P');
        this.aliases.set(old.toLowerCase(), u);
        renamed.push({ unit: u, from: old, to: this.byUnit.get(u) });
      }
      this._assign(u, 'P');
    }
    for (const u of battle.escapedUnits || []) this._assign(u, 'P');
    for (const u of battle.npcUnits) if (known.isKnown(u)) this._assign(u, 'N');
    for (const u of battle.enemyUnits) if (known.isKnown(u)) this._assign(u, 'E');
    return renamed;
  }

  _assign(unit, prefix) {
    if (!this.byUnit.has(unit)) this.byUnit.set(unit, `${prefix}${this.next[prefix]++}`);
  }

  id(unit) {
    return this.byUnit.get(unit) || '??';
  }

  /** The unit a token names among `pool`: an id (P1), or a name or unique name prefix. */
  resolve(token, pool, what = 'unit') {
    const t = String(token || '')
      .trim()
      .toLowerCase();
    if (!t) throw new PlayError(`Name a ${what}.`);
    const byId = pool.filter(
      (u) => this.byUnit.get(u)?.toLowerCase() === t || this.aliases.get(t) === u,
    );
    if (byId.length === 1) return byId[0];
    const byName = pool.filter((u) => String(u.name).toLowerCase() === t);
    if (byName.length === 1) return byName[0];
    const byPrefix = pool.filter((u) => String(u.name).toLowerCase().startsWith(t));
    const matches = byName.length > 1 ? byName : byPrefix;
    if (matches.length === 1) return matches[0];
    const names = pool.map((u) => `${this.id(u)} ${u.name}`).join(', ');
    if (matches.length > 1)
      throw new PlayError(
        `"${token}" is ambiguous (${matches.map((u) => `${this.id(u)} ${u.name}`).join(', ')}): use the id.`,
      );
    throw new PlayError(`No ${what} "${token}". Choose from: ${names || 'none'}.`);
  }
}

/** The board the player knows (BattleScene.threatContext's knowledge). */
export function knowledgeOf(battle) {
  return createPlayerKnowledge({
    grid: battle.grid,
    units: [...battle.playerUnits, ...battle.enemyUnits, ...battle.npcUnits],
    revealed: [findRecruitNpc(battle.npcUnits)],
  });
}

/**
 * The tiles a unit can stop on, as BattleScene.selectUnit shows them: from the
 * positions the player knows of (a unit the fog hides never shapes it).
 */
export function movementTiles(battle, unit) {
  const knowledge = knowledgeOf(battle);
  const range = battle.grid.getMovementRange(
    unit.col,
    unit.row,
    isRooted(unit) ? 0 : (unit.mov ?? unit.stats.MOV),
    unit.moveType,
    knowledge.positions(),
    unit.faction,
    getTerrainCostReduction(unit, battle.gameData?.skills),
  );
  const tiles = new Map();
  for (const [key, entry] of range) {
    if (entry && entry.stoppable === false) continue;
    tiles.set(key, entry);
  }
  tiles.set(tileKey(unit.col, unit.row), tiles.get(tileKey(unit.col, unit.row)) || { cost: 0 });
  return tiles;
}

/** Map "col,row" -> number of visible damage sources (the Danger overlay). */
export function dangerMap(battle) {
  const map = new Map();
  const status = new Set();
  for (const t of computeDangerTiles(battle._playerThreatContext())) {
    if (t.count > 0) map.set(tileKey(t.col, t.row), t.count);
    if (t.statusThreat) status.add(tileKey(t.col, t.row));
  }
  return { damage: map, status };
}

/** Visible enemies that could strike (col,row) next enemy phase if `mover` stood there. */
export function threatsAt(battle, col, row, mover = null) {
  return threatsOnTile(battle._playerThreatContext(), col, row, { mover });
}

function terrainName(battle, col, row) {
  return battle.grid.getTerrainAt(col, row)?.name || '?';
}

function glyph(terrain) {
  return TERRAIN_GLYPHS[terrain?.name] || '?';
}

function cell(text) {
  const s = String(text);
  return s.length >= 3 ? s.slice(0, 3) : s.padStart(2).padEnd(3);
}

function header(cols) {
  let line = '    ';
  for (let c = 0; c < cols; c++) line += String(c).padStart(2).padEnd(3);
  return line.trimEnd();
}

/** Known units by tile ("col,row" -> unit), entities on every footprint tile. */
function knownUnitsByTile(battle) {
  const known = knowledgeOf(battle);
  const map = new Map();
  for (const u of known.units) {
    for (const t of isEntity(u) ? getFootprint(u) : [u]) map.set(tileKey(t.col, t.row), u);
  }
  return map;
}

/**
 * The board: terrain glyphs, unit ids on their tiles, escape tiles (X), remains (r),
 * and fog in parentheses. `overlay(col,row)` may replace an empty tile's text.
 */
export function renderBoard(battle, ids, { overlay = null } = {}) {
  const { grid, battleConfig: bc } = battle;
  const units = knownUnitsByTile(battle);
  const escape = new Set((bc.escapeTiles || []).map((t) => tileKey(t.col, t.row)));
  const remains = new Set(
    (battle._zombieTombstones || [])
      .filter((r) => r.seen !== false)
      .map((r) => tileKey(r.col, r.row)),
  );
  const lines = [header(grid.cols)];
  for (let r = 0; r < grid.rows; r++) {
    let line = String(r).padStart(3) + ' ';
    for (let c = 0; c < grid.cols; c++) {
      const key = tileKey(c, r);
      const unit = units.get(key);
      const visible = grid.isVisible(c, r);
      let text;
      if (unit) text = ids.id(unit);
      else if (overlay && overlay(c, r) != null) text = overlay(c, r);
      else if (remains.has(key)) text = 'r';
      else if (escape.has(key)) text = 'X';
      else text = glyph(grid.getTerrainAt(c, r));
      line += !unit && !visible ? `(${String(text).slice(0, 1)})` : cell(text);
    }
    lines.push(line.trimEnd());
  }
  return lines.join('\n');
}

/** The Danger overlay: how many visible enemies can strike each tile next enemy phase. */
export function renderDanger(battle, ids) {
  const { damage, status } = dangerMap(battle);
  const units = knownUnitsByTile(battle);
  const lines = [header(battle.grid.cols)];
  for (let r = 0; r < battle.grid.rows; r++) {
    let line = String(r).padStart(3) + ' ';
    for (let c = 0; c < battle.grid.cols; c++) {
      const key = tileKey(c, r);
      const unit = units.get(key);
      const terrain = battle.grid.getTerrainAt(c, r);
      if (unit && unit.faction === 'enemy') line += cell(ids.id(unit));
      else if (terrain?.defBonus === '--') line += cell('#');
      else if (!battle.grid.isVisible(c, r)) line += cell('?');
      else if (damage.has(key)) line += cell(String(Math.min(9, damage.get(key))));
      else if (status.has(key)) line += cell('s');
      else line += cell('.');
    }
    lines.push(line.trimEnd());
  }
  return lines.join('\n');
}

export function terrainLegend(battle, units = battle.playerUnits) {
  const seen = new Map();
  for (let r = 0; r < battle.grid.rows; r++)
    for (let c = 0; c < battle.grid.cols; c++) {
      const t = battle.grid.getTerrainAt(c, r);
      if (t && !seen.has(t.name)) seen.set(t.name, t);
    }
  const moveTypes = [...new Set(units.map((u) => u.moveType).filter(Boolean))];
  return [...seen.values()]
    .map((t) => {
      const cost = moveTypes
        .map((m) => `${m.slice(0, 3)} ${t.moveCost?.[m] === '--' ? '-' : t.moveCost?.[m]}`)
        .join('/');
      const bonus =
        t.defBonus === '--'
          ? 'impassable'
          : `def ${signed(t.defBonus)} avo ${signed(t.avoidBonus)}`;
      const rules = terrainRuleLines(t);
      return `  ${glyph(t)} ${t.name}: ${bonus}, move ${cost}${rules.length ? ` · ${rules.join(' ')}` : ''}`;
    })
    .join('\n');
}

function signed(value) {
  const n = Number(value) || 0;
  return n >= 0 ? `+${n}` : `${n}`;
}

export function weaponText(weapon, unit) {
  if (!weapon) return '(none)';
  if (weapon.type === 'Scroll') return `${weapon.name} (scroll)`;
  const parts = [weapon.type];
  if (isStaff(weapon)) {
    parts.push(`Rng ${weapon.range}`);
    if (unit)
      parts.push(`uses ${getStaffRemainingUses(weapon, unit)}/${getStaffMaxUses(weapon, unit)}`);
  } else {
    parts.push(
      `Mt${weapon.might ?? 0} Hit${weapon.hit ?? 0} Crt${weapon.crit ?? 0} Wt${weapon.weight ?? 0} Rng${weapon.range ?? 1}`,
    );
    if (weapon.perBattleUses && unit)
      parts.push(`${getPerBattleRemainingUses(weapon, unit)}/${weapon.perBattleUses} this battle`);
  }
  if (weapon._forgeLevel) parts.push(`forged +${weapon._forgeLevel}`);
  if (weapon._imbueId) parts.push(`imbued ${weapon._imbueId}`);
  if (weapon.special) parts.push(weapon.special);
  return `${weapon.name} (${parts.join(' · ')})`;
}

export function itemText(item) {
  if (!item) return '?';
  const uses = item.uses !== undefined ? ` x${item.uses}` : '';
  return `${item.name}${uses}`;
}

export function skillNames(unit, gameData) {
  const byId = new Map((gameData.skills || []).map((s) => [s.id, s.name]));
  return (unit.skills || []).map((id) => byId.get(id) || id);
}

function affixNames(unit, gameData) {
  const list = gameData.affixes?.affixes || [];
  return (unit.affixes || []).map((a) => {
    const id = typeof a === 'string' ? a : a?.id;
    return list.find((x) => x.id === id)?.name || id;
  });
}

const STAT_ORDER = ['STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK', 'MOV'];

export function statsText(unit) {
  const s = unit.stats || {};
  const as = calculateEffectiveSpeed(unit, unit.weapon);
  return `${STAT_ORDER.map((k) => `${k} ${s[k] ?? 0}`).join(' ')} · AS ${Number.isFinite(as) ? as : s.SPD}`;
}

function flags(unit) {
  const f = [];
  if (unit.isCommander) f.push('commander');
  else if (unit.isLord) f.push('lord');
  if (unit.isBoss) f.push('BOSS');
  if (unit.isElite) f.push('elite');
  if (unit.isCaravan) f.push('caravan');
  if (unit.faction === 'npc' && isRecruitNpc(unit)) f.push('recruitable: Talk with a lord');
  return f;
}

export function unitLines(battle, ids, unit, { detail = false, danger = null } = {}) {
  const gd = battle.gameData;
  const terrain = terrainName(battle, unit.col, unit.row);
  const state = unit.faction === 'player' ? (unit.hasActed ? ' [done]' : ' [ready]') : '';
  const tags = flags(unit);
  const head = `${ids.id(unit)} ${unit.name} (${unit.className}${tags.length ? `, ${tags.join(', ')}` : ''}) Lv${unit.level}${unit.faction === 'player' ? ` ${unit.xp || 0}xp` : ''} HP ${unit.currentHP}/${unit.stats.HP} @${unit.col},${unit.row} ${terrain}${state}`;
  const lines = [head];
  const pad = '    ';
  lines.push(`${pad}${statsText(unit)}`);
  const bag = (unit.inventory || []).filter((w) => w !== unit.weapon);
  lines.push(
    `${pad}Equipped: ${weaponText(unit.weapon, unit)}${bag.length ? ` · Bag: ${bag.map((w) => weaponText(w, unit)).join('; ')}` : ''}`,
  );
  const extras = [];
  if ((unit.consumables || []).length)
    extras.push(`Items: ${unit.consumables.map(itemText).join(', ')}`);
  if (unit.accessory) extras.push(`Accessory: ${unit.accessory.name}`);
  const skills = skillNames(unit, gd);
  if (skills.length) extras.push(`Skills: ${skills.join(', ')}`);
  const affixes = affixNames(unit, gd);
  if (affixes.length) extras.push(`Affixes: ${affixes.join(', ')}`);
  if (unit.statusStaff) extras.push(`Status staff: ${unit.statusStaff.name}`);
  if (extras.length) lines.push(`${pad}${extras.join(' · ')}`);
  const status = statusDescriptions(unit);
  if (status.length) lines.push(`${pad}Status: ${status.join(' | ')}`);
  if (danger) lines.push(`${pad}${danger}`);
  if (detail) {
    if (unit.growths && unit.faction === 'player')
      lines.push(
        `${pad}Growths: ${Object.entries(unit.growths)
          .map(([k, v]) => `${k} ${v}%`)
          .join(' ')}`,
      );
    const descs = (unit.skills || [])
      .map((id) => gd.skills?.find((s) => s.id === id))
      .filter(Boolean)
      .map((s) => `${s.name}: ${s.description}`);
    for (const d of descs) lines.push(`${pad}- ${d}`);
    const affixDefs = (unit.affixes || [])
      .map((a) => gd.affixes?.affixes?.find((x) => x.id === (typeof a === 'string' ? a : a?.id)))
      .filter(Boolean);
    for (const a of affixDefs) lines.push(`${pad}- ${a.name}: ${a.description}`);
    if (unit.accessory?.description || unit.accessory?.special)
      lines.push(
        `${pad}- ${unit.accessory.name}: ${unit.accessory.description || unit.accessory.special}`,
      );
  }
  return lines;
}

function objectiveLines(battle, ids) {
  const bc = battle.battleConfig;
  const lines = [OBJECTIVE_TEXT[bc.objective] || bc.objective];
  if (bc.objective === 'seize' && bc.thronePos)
    lines.push(`Throne at ${bc.thronePos.col},${bc.thronePos.row}.`);
  if (bc.objective === 'escape' && bc.escapeTiles?.length)
    lines.push(`Escape tiles: ${bc.escapeTiles.map((t) => `${t.col},${t.row}`).join(' ')}.`);
  const village = battle._villageState;
  if (village)
    lines.push(
      `Village at ${village.col},${village.row}: ${village.status}. End a unit's action on it to visit (gold and an item) before bandits raze it.`,
    );
  for (const npc of battle.npcUnits) {
    if (isRecruitNpc(npc) && knowledgeOf(battle).isKnown(npc))
      lines.push(
        `${ids.id(npc)} ${npc.name} can be recruited: end a lord's move beside them and Talk.`,
      );
    if (npc.isCaravan)
      lines.push(
        `${ids.id(npc)} Merchant Caravan: keep it alive until it leaves the map for a shop.`,
      );
  }
  const state = battle.routObjectiveState?.();
  if (state?.requiredRecruits?.length)
    lines.push(`Must recruit before the rout ends: ${state.requiredRecruits.join(', ')}.`);
  return lines;
}

function turnLine(battle) {
  const turn = battle.turnManager?.turnNumber || 0;
  const par = battle.turnPar;
  const parts = [`Turn ${turn}`];
  if (Number.isFinite(par)) {
    parts.push(`par ${par}`);
    const pressure = getLatePressureState(turn, par, battle.gameData.turnBonus);
    if (pressure?.active)
      parts.push(
        `late pressure: XP x${pressure.xpMultiplier.toFixed(2)}, gold x${pressure.goldMultiplier.toFixed(2)}`,
      );
    if (battle.enemyUnits.some((u) => u.isBoss)) {
      const enrage = getBossEnrageTurn(par, battle.gameData.turnBonus);
      if (Number.isFinite(enrage)) parts.push(`boss enrages from turn ${enrage}`);
    }
  }
  if (battle.grid.fogEnabled) parts.push('fog of war');
  return parts.join(' · ');
}

/** The full battle observation. */
export function battleView(battle, ids, { title = '' } = {}) {
  const known = knowledgeOf(battle);
  const { damage } = dangerMap(battle);
  const out = [];
  out.push(`== BATTLE${title ? ` · ${title}` : ''} · ${turnLine(battle)} ==`);
  out.push(...objectiveLines(battle, ids));
  out.push('');
  out.push(
    `Map ${battle.grid.cols}x${battle.grid.rows}. Coordinates are x,y (x = column, y = row).`,
  );
  out.push(renderBoard(battle, ids));
  out.push('Terrain:');
  out.push(terrainLegend(battle));
  const enemies = battle.enemyUnits.filter((u) => known.isKnown(u));
  if (enemies.length) {
    out.push(
      'Danger (visible enemies able to strike each tile next enemy phase; s = status staff only; # impassable; ? fog, unknown):',
    );
    out.push(renderDanger(battle, ids));
  }
  out.push('');
  out.push('YOUR ARMY');
  for (const u of battle.playerUnits) {
    const n = damage.get(tileKey(u.col, u.row)) || 0;
    const threat = n ? threatsAt(battle, u.col, u.row, u).damage.map((e) => ids.id(e)) : [];
    out.push(
      ...unitLines(battle, ids, u, {
        danger: n ? `In danger here from ${threat.join(', ')}` : null,
      }),
    );
  }
  if (battle.escapedUnits?.length)
    out.push(`Escaped: ${battle.escapedUnits.map((u) => `${ids.id(u)} ${u.name}`).join(', ')}`);
  const npcs = battle.npcUnits.filter((u) => known.isKnown(u));
  if (npcs.length) {
    out.push('NPCS (green)');
    for (const u of npcs) out.push(...unitLines(battle, ids, u));
  }
  out.push(
    `ENEMIES (${enemies.length} visible${battle.grid.fogEnabled ? '; more may hide in fog' : ''})`,
  );
  for (const u of enemies) out.push(...unitLines(battle, ids, u));
  return out.join('\n');
}

/**
 * Run `fn` with the unit standing on (col,row) holding `weapon`, then put everything
 * back. The battle's random stream is swapped for a throwaway one and the roll
 * session restored, so a preview never changes what a commit will roll.
 */
export function withPreview(battle, unit, { col, row, weapon }, fn) {
  const saved = {
    col: unit.col,
    row: unit.row,
    weapon: unit.weapon,
    session: battle._combatRollSession,
    random: Math.random,
  };
  let rolled = 0;
  Math.random = () => {
    rolled++;
    return 0.5;
  };
  try {
    unit.col = col;
    unit.row = row;
    if (weapon !== undefined) unit.weapon = weapon;
    battle._combatRollSession = null;
    const value = fn();
    return { value, rolled: rolled > 0 };
  } finally {
    unit.col = saved.col;
    unit.row = saved.row;
    unit.weapon = saved.weapon;
    battle._combatRollSession = saved.session;
    Math.random = saved.random;
  }
}

/** Weapons this unit could strike `target` with from (col,row) (rank, silence, shots left). */
export function weaponsReaching(battle, unit, target, col, row) {
  return withPreview(battle, unit, { col, row }, () => {
    const dist = combatDistance(unit, target);
    return getAttackWeapons(unit).filter((w) => {
      const bonus = getWeaponRangeBonus(unit, w, battle.gameData.skills);
      const { min, max } = parseRange(w.range);
      return dist >= min && dist <= max + bonus;
    });
  }).value;
}

/** The weapon the harness would strike with (the equipped one if it reaches, else the first). */
export function defaultWeapon(unit, reaching) {
  return reaching.includes(unit.weapon) ? unit.weapon : reaching[0] || null;
}

/**
 * The combat forecast for `unit` attacking `target` from (col,row) with `weapon` and
 * an optional weapon art: the same skill context the commit builds.
 */
export function forecastAttack(battle, unit, target, { col, row, weapon, art = null }) {
  const { value, rolled } = withPreview(battle, unit, { col, row, weapon }, () => {
    const dist = combatDistance(unit, target);
    const skillCtx = battle._buildSkillCtx(unit, target, art);
    return getCombatForecast(
      unit,
      weapon,
      target,
      target.weapon,
      dist,
      battle.grid.getTerrainAt(col, row),
      battle.grid.getTerrainAt(target.col, target.row),
      skillCtx,
    );
  });
  return { forecast: value, rolled };
}

function sideText(side) {
  const groups = forecastStrikeGroups(side);
  if (!groups.length) return 'no strike';
  const strikes = groups
    .map((g) => `${g.damage} dmg x${g.count} @ ${hitChancePercent(g.hit)}% hit, ${g.crit}% crit`)
    .join(' then ');
  return strikes;
}

function totalIfAllHit(side) {
  return forecastStrikeGroups(side).reduce((sum, g) => sum + Math.max(0, g.damage) * g.count, 0);
}

/** One line: "Steel Lance: 14x1 88% hit 4% crit | counter 10x1 75% 0% | if all land 22->8, 18->8". */
export function compactForecast(battle, unit, target, opts) {
  const { forecast: f, rolled } = forecastAttack(battle, unit, target, opts);
  const side = (s) =>
    forecastStrikeGroups(s)
      .map((g) => `${g.damage}x${g.count} ${hitChancePercent(g.hit)}%/${g.crit}%c`)
      .join(' + ') || 'none';
  const dealt = Math.min(target.currentHP, totalIfAllHit(f.attacker));
  const taken = f.defender?.canCounter ? Math.min(unit.currentHP, totalIfAllHit(f.defender)) : 0;
  return `${opts.weapon?.name}${opts.art ? ` + ${opts.art.name}` : ''}: you ${side(f.attacker)} | counter ${f.defender?.canCounter ? side(f.defender) : 'none'} | all land: foe ${target.currentHP}->${target.currentHP - dealt}${dealt >= target.currentHP ? ' KO' : ''}, you ${unit.currentHP}->${unit.currentHP - taken}${taken >= unit.currentHP && taken > 0 ? ' KO' : ''}${rolled ? ' (accessory roll varies)' : ''}`;
}

/** What a unit's affixes do, as the inspection panel words them. */
export function affixLines(unit, gameData) {
  return (unit.affixes || [])
    .map((a) =>
      gameData.affixes?.affixes?.find((x) => x.id === (typeof a === 'string' ? a : a?.id)),
    )
    .filter(Boolean)
    .map((a) => `${a.name}: ${a.description}`);
}

export function forecastText(battle, ids, unit, target, opts) {
  const { forecast: f, rolled } = forecastAttack(battle, unit, target, opts);
  const atk = f.attacker;
  const def = f.defender;
  const dealt = Math.min(target.currentHP, totalIfAllHit(atk));
  const taken = def?.canCounter ? Math.min(unit.currentHP, totalIfAllHit(def)) : 0;
  const lines = [
    `${ids.id(unit)} ${unit.name} from ${opts.col},${opts.row} (${terrainName(battle, opts.col, opts.row)}) with ${opts.weapon?.name}${opts.art ? ` + art ${opts.art.name}` : ''} vs ${ids.id(target)} ${target.name} (${terrainName(battle, target.col, target.row)})`,
    `  You:  ${sideText(atk)}${atk.doubles ? ' (doubles)' : ''}${atk.brave ? ' (brave)' : ''}`,
    `  Them: ${def?.canCounter ? sideText(def) + (def.doubles ? ' (doubles)' : '') : `no counter${f.display?.counterReason ? ` (${f.display.counterReason})` : ''}`}`,
    `  If every strike lands: ${target.name} ${target.currentHP}->${target.currentHP - dealt}${dealt >= target.currentHP ? ' (KO)' : ''}; ${unit.name} ${unit.currentHP}->${unit.currentHP - taken}${taken >= unit.currentHP && taken > 0 ? ' (KO)' : ''}. Combat stops when either falls.`,
  ];
  const skills = [...(atk.skills || []), ...(def?.skills || [])]
    .map((s) => (typeof s === 'string' ? s : s?.name))
    .filter(Boolean);
  if (skills.length) lines.push(`  Skills in play: ${[...new Set(skills)].join(', ')}`);
  for (const line of affixLines(target, battle.gameData)) lines.push(`  Foe affix ${line}`);
  for (const line of affixLines(unit, battle.gameData)) lines.push(`  Your affix ${line}`);
  if (rolled) lines.push('  (An accessory rolls at combat: this preview shows one possible roll.)');
  if (!movementTiles(battle, unit).has(tileKey(opts.col, opts.row)))
    lines.push(`  Note: ${unit.name} cannot reach ${opts.col},${opts.row} this turn.`);
  return lines.join('\n');
}

/** Usable weapon arts for a strike with `weapon` (canUse and why not). */
export function artChoices(battle, unit, weapon) {
  return battle._getWeaponArtChoices(unit, weapon, {}, { restrictToWeapon: true });
}

function healTargetsFrom(battle, unit, col, row) {
  const staves = battle._getUsableStaves(unit);
  if (!staves.length) return [];
  return withPreview(battle, unit, { col, row }, () => battle._findHealTargets(unit)).value;
}

/**
 * Everything one ready unit can do this turn: where it can stop (with danger), whom it
 * can strike from where (best tiles first, with the forecast), heals, Talk, objectives.
 */
export function optionsView(battle, ids, unit, { limit = 3 } = {}) {
  const tiles = movementTiles(battle, unit);
  const { damage } = dangerMap(battle);
  const known = knowledgeOf(battle);
  const out = [];
  out.push(
    `${ids.id(unit)} ${unit.name} @${unit.col},${unit.row} HP ${unit.currentHP}/${unit.stats.HP} MOV ${unit.stats.MOV}${unit.hasActed ? ' (already acted this turn)' : ''}`,
  );
  out.push(
    'Reachable tiles (digit = enemies able to strike there now, o = safe; @ = current tile):',
  );
  out.push(
    renderBoard(battle, ids, {
      overlay: (c, r) => {
        const key = tileKey(c, r);
        if (!tiles.has(key)) return null;
        if (c === unit.col && r === unit.row) return '@';
        const n = damage.get(key) || 0;
        return n ? String(Math.min(9, n)) : 'o';
      },
    }),
  );
  const tileList = [...tiles.keys()].map((k) => k.split(',').map(Number));
  const dangerHere = (c, r) => threatsAt(battle, c, r, unit).count;
  const avoidOf = (c, r) => Number(battle.grid.getTerrainAt(c, r)?.avoidBonus) || 0;

  const attacks = [];
  for (const enemy of battle.enemyUnits.filter((e) => known.isKnown(e))) {
    const from = [];
    for (const [c, r] of tileList) {
      const reaching = weaponsReaching(battle, unit, enemy, c, r);
      if (reaching.length) from.push({ c, r, reaching });
    }
    if (!from.length) continue;
    for (const f of from) f.danger = dangerHere(f.c, f.r);
    from.sort((a, b) => a.danger - b.danger || avoidOf(b.c, b.r) - avoidOf(a.c, a.r));
    attacks.push({ enemy, from });
  }
  if (attacks.length) {
    out.push(
      'Attacks, one line per weapon from its safest tile (danger dN = visible foes that could strike that tile next enemy phase, the target included; hit% is the real chance to land, as the forecast shows it; "forecast" checks any other tile):',
    );
    for (const { enemy, from } of attacks) {
      const affixes = affixLines(enemy, battle.gameData).map((l) => l.split(':')[0]);
      out.push(
        `- ${ids.id(enemy)} ${enemy.name} HP ${enemy.currentHP}/${enemy.stats.HP} @${enemy.col},${enemy.row}${affixes.length ? ` [${affixes.join(', ')}]` : ''}:`,
      );
      // For each weapon: its safest tile and that forecast, then every other tile it reaches from.
      const weapons = [...new Set(from.flatMap((f) => f.reaching))];
      for (const weapon of weapons) {
        const tiles = from.filter((f) => f.reaching.includes(weapon));
        const best = tiles[0];
        out.push(`  ${compactForecast(battle, unit, enemy, { col: best.c, row: best.r, weapon })}`);
        out.push(
          `    from ${best.c},${best.r} (${terrainName(battle, best.c, best.r)}, danger ${best.danger})${
            tiles.length > 1
              ? `; also ${tiles
                  .slice(1, 1 + limit * 4)
                  .map((f) => `${f.c},${f.r}(d${f.danger})`)
                  .join(
                    ' ',
                  )}${tiles.length > 1 + limit * 4 ? ` +${tiles.length - 1 - limit * 4} more` : ''}`
              : ''
          }`,
        );
      }
    }
    const arts = (unit.inventory || [])
      .filter((w) => !isStaff(w))
      .flatMap((w) => artChoices(battle, unit, w).map((a) => ({ ...a, weapon: w })));
    if (arts.length)
      out.push(
        `Weapon arts: ${arts.map((a) => `${a.art.id} "${a.art.name}" (${a.weapon.name}, ${a.art.targeting === 'chosen_center' ? 'area: strike <art> at x,y' : 'add "art <id>" to an attack'}, HP cost ${a.art.hpCost ?? 0})${a.canUse ? '' : ` unavailable: ${a.reason}`}`).join('; ')}`,
      );
  } else out.push('No visible enemy can be attacked this turn.');

  const heals = new Map();
  for (const [c, r] of tileList) {
    for (const t of healTargetsFrom(battle, unit, c, r)) {
      if (!heals.has(t)) heals.set(t, []);
      heals.get(t).push(`${c},${r}`);
    }
  }
  if (heals.size) {
    const staff = battle._getActiveHealStaff(unit);
    out.push(
      `Heals (${staff ? weaponText(staff, unit) : 'staff'}, range ${staff ? `${getEffectiveStaffRange(staff, unit).min}-${getEffectiveStaffRange(staff, unit).max}` : '?'}):`,
    );
    for (const [t, from] of heals) {
      const amount = staff ? resolveHeal(staff, unit, t, battle._healOptions()).healAmount : '?';
      out.push(
        `- ${ids.id(t)} ${t.name} HP ${t.currentHP}/${t.stats.HP} (+${amount}) from ${from.slice(0, 8).join(' ')}${from.length > 8 ? ' ...' : ''}`,
      );
    }
  }
  if (unit.isLord) {
    for (const npc of battle.npcUnits.filter((n) => isRecruitNpc(n) && known.isKnown(n))) {
      const beside = tileList
        .filter(([c, r]) => Math.abs(c - npc.col) + Math.abs(r - npc.row) === 1)
        .map(([c, r]) => `${c},${r}`);
      out.push(
        beside.length
          ? `Talk to ${ids.id(npc)} ${npc.name}: end the move on ${beside.join(' ')} and "talk".`
          : `${ids.id(npc)} ${npc.name} is out of reach this turn.`,
      );
    }
  }
  const bc = battle.battleConfig;
  if (bc.objective === 'seize' && unit.isLord && bc.thronePos) {
    const onThrone = tiles.has(tileKey(bc.thronePos.col, bc.thronePos.row));
    const bossAlive = battle.enemyUnits.some((u) => u.isBoss);
    out.push(
      `Throne ${bc.thronePos.col},${bc.thronePos.row}: ${onThrone ? 'reachable' : 'not reachable this turn'}${bossAlive ? ' (the boss must fall first)' : ''}.`,
    );
  }
  if (bc.objective === 'escape') {
    const exits = (bc.escapeTiles || []).filter((t) => tiles.has(tileKey(t.col, t.row)));
    out.push(
      exits.length
        ? `Escape tiles in reach: ${exits.map((t) => `${t.col},${t.row}`).join(' ')}.`
        : 'No escape tile in reach.',
    );
  }
  const usable = (unit.consumables || []).filter((i) =>
    ['heal', 'healFull', 'cure', 'cureHeal'].includes(i.effect),
  );
  if (usable.length)
    out.push(`Items: ${usable.map(itemText).join(', ')} ("item <name>" ends the action).`);
  return out.join('\n');
}

/** Who can strike a tile next enemy phase. */
export function threatView(battle, ids, col, row, mover = null) {
  const t = threatsAt(battle, col, row, mover);
  const names = (list) => list.map((e) => `${ids.id(e)} ${e.name}`).join(', ') || 'none';
  return [
    `Tile ${col},${row} (${terrainName(battle, col, row)}): ${t.count} damage source(s)${t.fogged ? ' visible (fog may hide more)' : ''}.`,
    `  Can strike it: ${names(t.damage)}${t.ballistas.length ? ` + ${t.ballistas.length} ballista(s)` : ''}`,
    t.status.length ? `  Status staff only: ${names(t.status)}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Whether `center` is a legal center for an area art from where the unit stands. */
export function isAreaCenter(battle, unit, art, weapon, center) {
  return isAreaStrikeCenter(unit, art, center, battle._postCombatWorld(), weapon);
}
