// The game as structured data, for programs that read headless play (tools/play):
// `look --json`. The same facts the text views show, from what the player knows
// (fog hides what it hides), and none of their advice: no ranking of tiles, no
// "best" anything. Read-only.

import { knowledgeOf, dangerMap, movementTiles, tileKey } from './battleView.js';
import { statusDescriptions } from '../../src/engine/BattleInformation.js';
import { calculateEffectiveSpeed } from '../../src/engine/Combat.js';
import { getWeaponArtBindings } from '../../src/engine/WeaponArtSystem.js';
import { UNSUPPORTED } from './capabilities.js';

export const OBSERVATION_VERSION = 1;

function item(i) {
  if (!i) return null;
  const out = { name: i.name, type: i.type };
  for (const k of ['might', 'hit', 'crit', 'weight', 'range', 'uses', 'special', 'effect', 'value'])
    if (i[k] !== undefined) out[k] = i[k];
  if (i._usesSpent) out.usesSpent = i._usesSpent;
  if (i._forgeLevel) out.forgeLevel = i._forgeLevel;
  if (i._imbueId) out.imbue = i._imbueId;
  const arts = getWeaponArtBindings(i);
  if (arts.length) out.arts = arts.map((a) => a.id);
  return out;
}

function unit(u, ids, battle = null) {
  return {
    id: ids ? ids.id(u) : null,
    name: u.name,
    faction: u.faction,
    className: u.className,
    level: u.level,
    xp: u.faction === 'player' ? u.xp || 0 : undefined,
    hp: u.currentHP,
    maxHp: u.stats?.HP,
    col: battle ? u.col : undefined,
    row: battle ? u.row : undefined,
    stats: { ...u.stats },
    attackSpeed: calculateEffectiveSpeed(u, u.weapon),
    moveType: u.moveType,
    weapon: u.weapon?.name || null,
    inventory: (u.inventory || []).map(item),
    consumables: (u.consumables || []).map(item),
    accessory: u.accessory?.name || null,
    skills: [...(u.skills || [])],
    affixes: (u.affixes || []).map((a) => (typeof a === 'string' ? a : a?.id)),
    status: statusDescriptions(u),
    flags: {
      commander: Boolean(u.isCommander),
      lord: Boolean(u.isLord),
      boss: Boolean(u.isBoss),
      elite: Boolean(u.isElite),
    },
    acted: battle && u.faction === 'player' ? Boolean(u.hasActed) : undefined,
    moveLocked: battle && u.faction === 'player' ? Boolean(u._movementCommitted) : undefined,
  };
}

function battleObservation(game) {
  const pb = game.battle;
  const b = pb.battle;
  const known = knowledgeOf(b);
  const { damage, status } = dangerMap(b);
  const terrain = [];
  const fog = [];
  for (let r = 0; r < b.grid.rows; r++) {
    terrain.push([]);
    fog.push([]);
    for (let c = 0; c < b.grid.cols; c++) {
      terrain[r].push(b.grid.getTerrainAt(c, r)?.name || null);
      fog[r].push(Boolean(b.grid.fogEnabled && !b.grid.isVisible(c, r)));
    }
  }
  const bc = b.battleConfig;
  return {
    turn: b.turnManager.turnNumber,
    phase: b.turnManager.currentPhase,
    par: Number.isFinite(b.turnPar) ? b.turnPar : null,
    objective: bc.objective,
    throne: bc.thronePos || null,
    escapeTiles: bc.escapeTiles || [],
    fogOfWar: Boolean(b.grid.fogEnabled),
    formation: Boolean(pb.formation),
    pendingCanto:
      b.battleState === 'CANTO_MOVING'
        ? { unit: pb.ids.id(b.selectedUnit), tilesLeft: b.cantoRemaining }
        : null,
    map: { cols: b.grid.cols, rows: b.grid.rows, terrain, fog },
    army: b.playerUnits.map((u) => ({
      ...unit(u, pb.ids, b),
      reachable: [...movementTiles(b, u).keys()],
    })),
    npcs: b.npcUnits.filter((u) => known.isKnown(u)).map((u) => unit(u, pb.ids, b)),
    enemies: b.enemyUnits.filter((u) => known.isKnown(u)).map((u) => unit(u, pb.ids, b)),
    // Visible enemies able to strike each tile next enemy phase (the Danger overlay).
    danger: Object.fromEntries(damage),
    statusThreat: [...status],
  };
}

/** The current observation as data. */
export function observe(session) {
  const game = session.game;
  const rm = game.rm;
  const out = {
    observationVersion: OBSERVATION_VERSION,
    revision: session.revision,
    phase: game.phase,
    run: rm && {
      act: rm.currentAct,
      node: rm.currentNodeId,
      gold: rm.gold,
      battlesWon: rm.completedBattles,
      visionCharges: rm.visionChargesRemaining,
      status: rm.status,
      roster: rm.roster.map((u) => unit(u, null)),
      convoy: rm.getConvoyItems?.() && {
        weapons: rm.getConvoyItems().weapons.map(item),
        consumables: rm.getConvoyItems().consumables.map(item),
      },
      scrolls: (rm.scrolls || []).map(item),
      accessories: (rm.accessories || []).map((a) => a.name),
      available: (game.availableNodes?.() || []).map((n) => ({ id: n.id, type: n.type })),
    },
    commands: game.help(),
    unsupported: UNSUPPORTED.map(({ id, what }) => ({ id, what })),
  };
  if ((game.phase === 'battle' || game.phase === 'fatal') && game.battle)
    out.battle = battleObservation(game);
  // Every other phase's facts as the text view gives them (menus, offers, prices).
  else out.text = game.view();
  return out;
}

export { tileKey };
