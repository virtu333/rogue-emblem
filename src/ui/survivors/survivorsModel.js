// survivorsModel.js — the words and numbers Darkest Before Dawn's menus show (pure, no DOM):
// the clock, a level-up's gains line, what a choice is and does, the night's summary, and the
// device's best nights. The DOM in SurvivorsMenus.js only lays these out.
import { GROWN_STATS } from '../../engine/survivors/SurvivorsUnits.js';

export const BEST_KEY = 'emblem_rogue_survivors_best';

/** "9:58", "0:07": minutes and seconds, rounded down. */
export function clockText(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "HP +1 · STR +1 · SPD +2", or null for a level that gained nothing shown. */
export function gainsLine(gains) {
  if (!gains) return null;
  const parts = GROWN_STATS.filter((s) => gains[s] > 0).map((s) => `${s} +${gains[s]}`);
  return parts.length ? parts.join(' · ') : null;
}

/** The icon a passive shows: its own `icon`, a skill's scroll, else the accessory itself. */
function passiveIcon(def) {
  return def.icon || (def.kind === 'skill' ? `${def.name} Scroll` : def.name);
}

/**
 * One level-up choice as the card shows it: `{ title, tag, note, icon }`. `icon` is what the
 * item icon reads (a weapon or accessory name; a skill's scroll).
 */
export function choiceView(config, choice) {
  if (choice.kind === 'weapon') {
    const def = config.weapons[choice.id];
    const lvl = def.levels[choice.level - 1];
    return {
      title: choice.level === 1 ? def.name : `${def.name} ${choice.level}`,
      tag: choice.level === 1 ? 'New weapon' : `Level ${choice.level}`,
      note: choice.level === 1 ? def.description : lvl.note,
      icon: lvl.weapon,
    };
  }
  if (choice.kind === 'passive') {
    const def = config.passives[choice.id];
    return {
      title: choice.level === 1 ? def.name : `${def.name} ${choice.level}`,
      tag:
        def.kind === 'skill'
          ? choice.level === 1
            ? 'New skill'
            : `Level ${choice.level}`
          : choice.level === 1
            ? 'New accessory'
            : `Level ${choice.level}`,
      note: def.description,
      icon: passiveIcon(def),
    };
  }
  return {
    title: 'Rest',
    tag: 'Heal',
    note: `Heal ${Math.round((config.restHealShare || 0) * 100)}% of your HP.`,
    icon: 'Vulnerary',
  };
}

/** What the lord holds, for the HUD's slot row: `[{ kind, id, name, level, icon }]`. */
export function heldView(config, player) {
  const weapons = player.weapons.map((w) => {
    const def = config.weapons[w.id];
    return {
      kind: 'weapon',
      id: w.id,
      name: def.name,
      level: w.level,
      icon: def.levels[w.level - 1].weapon,
    };
  });
  const passives = player.passives.map((p) => {
    const def = config.passives[p.id];
    return {
      kind: 'passive',
      id: p.id,
      name: def.name,
      level: p.level,
      icon: passiveIcon(def),
    };
  });
  return [...weapons, ...passives];
}

/** The night's end in numbers: `{ won, title, lines, damage: [{ name, amount }] }`. */
export function resultView(world, { best = null } = {}) {
  const won = world.status === 'won';
  const damage = Object.entries(world.damageByWeapon)
    .map(([id, amount]) => ({ name: world.config.weapons[id]?.name || id, amount }))
    .sort((a, b) => b.amount - a.amount);
  const lines = [
    won ? 'You held until dawn.' : `You held for ${clockText(world.t)}.`,
    `Level ${world.player.level} · ${world.kills} foes felled`,
  ];
  if (world.bossesDown)
    lines.push(`${world.bossesDown} ${world.bossesDown === 1 ? 'captain' : 'captains'} fell`);
  if (best != null)
    lines.push(
      `Best night with ${world.player.name}: ${best >= world.config.durationSec ? 'dawn' : clockText(best)}`,
    );
  return { won, title: won ? 'Dawn breaks' : 'The night takes you', lines, damage };
}

function readBest(storage) {
  try {
    const raw = storage?.getItem?.(BEST_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** The device's best night for a lord, in seconds held (null when never played). */
export function bestFor(lordName, storage = globalThis.localStorage) {
  const value = Number(readBest(storage)[lordName]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Keep a night if it is the lord's longest. Returns the best after it. Never throws. */
export function recordNight(lordName, seconds, storage = globalThis.localStorage) {
  const all = readBest(storage);
  const held = Math.floor(Math.max(0, Number(seconds) || 0));
  const best = Math.max(Number(all[lordName]) || 0, held);
  all[lordName] = best;
  try {
    storage?.setItem?.(BEST_KEY, JSON.stringify(all));
  } catch {
    /* a refused write keeps the old best; the night still counts on screen */
  }
  return best;
}
