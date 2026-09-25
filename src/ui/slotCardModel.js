// slotCardModel — what a save-slot "candle" card shows (pure: no DOM, no Phaser).
//
// SlotPicker cards are small shrines: the commander's portrait, the act and its
// region/mood, where the run stands ("Battle suspended at River Crossing"), the
// Loom thread of acts, milestone seals and one primary action. Everything here
// is derived from getSlotSummary() plus game data, so the copy is unit-testable
// and the renderer (SlotPickerView.js) stays thin. Read-only: never writes saves.

import { actCardContent, actRegion, ACT_GRADE_KEYS, romanNumeral } from './ceremonyContent.js';
import { portraitIdForUnit } from './portraitArt.js';

/** Milestone seals in the order they are earned; the last two show only once lit. */
export const SLOT_SEALS = Object.freeze([
  { id: 'beatAct1', label: 'Act I cleared' },
  { id: 'beatAct2', label: 'Act II cleared' },
  { id: 'beatAct3', label: 'Act III cleared' },
  { id: 'beatGame', label: 'The Emperor fell', crown: true },
  { id: 'beatHard', label: 'Won on Hard', crown: true, optional: true },
  { id: 'beatLunatic', label: 'Won on Lunatic', crown: true, optional: true },
]);

const NODE_WORDS = Object.freeze({
  battle: 'Battle',
  boss: 'Boss battle',
  shop: 'Market',
  ruins: 'Ruins',
  recruit: 'Recruit battle',
  church: 'Church',
  colosseum: 'Arena',
});

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "Saved just now / 42 min ago / 3 h ago / yesterday / 4 days ago / on Sep 12".
 * `title` is the exact local timestamp for the tooltip / screen readers.
 */
export function friendlySavedTime(savedAt, now = Date.now()) {
  if (!Number.isFinite(savedAt)) return { text: 'Save time unknown', title: '' };
  const date = new Date(savedAt);
  let title = '';
  try {
    title = date.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    title = date.toISOString();
  }
  const age = Math.max(0, now - savedAt);
  let text;
  if (age < MINUTE) text = 'Saved just now';
  else if (age < HOUR) text = `Saved ${Math.floor(age / MINUTE)} min ago`;
  else if (age < DAY) text = `Saved ${Math.floor(age / HOUR)} h ago`;
  else if (age < 2 * DAY) text = 'Saved yesterday';
  else if (age < 7 * DAY) text = `Saved ${Math.floor(age / DAY)} days ago`;
  else {
    let day = '';
    try {
      day = date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        ...(now - savedAt > 300 * DAY ? { year: 'numeric' } : {}),
      });
    } catch {
      day = date.toISOString().slice(0, 10);
    }
    text = `Saved ${day}`;
  }
  return { text, title };
}

/** Map template display name ("River Crossing") from its id, or ''. */
export function templateName(mapTemplates, templateId) {
  if (!templateId || !mapTemplates || typeof mapTemplates !== 'object') return '';
  for (const list of Object.values(mapTemplates)) {
    if (!Array.isArray(list)) continue;
    const found = list.find((entry) => entry?.id === templateId);
    if (found?.name) return String(found.name);
  }
  return '';
}

function commanderOf(roster) {
  if (!Array.isArray(roster) || !roster.length) return null;
  return (
    roster.find((u) => u?.isCommander) ||
    roster.find((u) => u?.name === 'Edric') ||
    roster.find((u) => u?.isLord) ||
    roster[0]
  );
}

function companionsLine(roster, commander, total) {
  const others = (roster || []).filter((u) => u && u !== commander && u.name).map((u) => u.name);
  const shown = others.slice(0, 2);
  const more = Math.max(0, (total || 0) - 1 - shown.length);
  if (!shown.length) return 'marching alone';
  return `with ${shown.join(', ')}${more ? ` +${more}` : ''}`;
}

function sealsFor(milestones) {
  const earned = new Set(Array.isArray(milestones) ? milestones : []);
  return SLOT_SEALS.filter((seal) => !seal.optional || earned.has(seal.id)).map((seal) => ({
    id: seal.id,
    label: seal.label,
    crown: Boolean(seal.crown),
    lit: earned.has(seal.id),
  }));
}

function tallyLine(summary) {
  const started = summary.runsStarted || 0;
  const finished = summary.runsCompleted || 0;
  if (!started && !finished) return 'No runs yet';
  return `${started} ${started === 1 ? 'run' : 'runs'} · ${finished} finished`;
}

/**
 * Card model for one slot.
 * @param {number} slot
 * @param {object|null} summary  getSlotSummary(slot)
 * @param {{ gameData?: object, now?: number, conflict?: boolean }} [ctx]
 */
export function slotCardModel(slot, summary, { gameData = {}, now = Date.now(), conflict } = {}) {
  const numeral = romanNumeral(slot) || String(slot);
  const base = { slot, kicker: `Slot ${numeral}`, conflict: Boolean(conflict) };
  if (!summary) {
    return {
      ...base,
      state: 'empty',
      grade: 'unlit',
      title: 'An unlit candle',
      status: 'Begin a new chronicle.',
      primary: { label: 'New run', ariaLabel: `New run in Slot ${slot}` },
      canDelete: false,
    };
  }
  const seals = sealsFor(summary.milestones);
  const common = {
    ...base,
    canDelete: true,
    seals,
    sealsLabel: seals.some((s) => s.lit)
      ? `Milestones: ${seals
          .filter((s) => s.lit)
          .map((s) => s.label)
          .join(', ')}`
      : 'No milestones yet',
    tally: tallyLine(summary),
    currency: `${summary.valor || 0} Valor · ${summary.supply || 0} Supply`,
    primary: { ariaLabel: `Select Slot ${slot}` },
  };
  if (conflict) common.note = 'Cloud and device differ — choose which to keep.';

  if (summary.runCorrupt) {
    return {
      ...common,
      state: 'corrupt',
      grade: 'unlit',
      actKicker: 'Between runs',
      title: 'Damaged pages',
      status: "This run's save could not be read. Upgrades and currency are safe.",
      primary: { ...common.primary, label: conflict ? 'Choose version' : 'Enter Home Base' },
    };
  }

  if (!summary.hasActiveRun) {
    const fresh = !(summary.runsStarted || 0) && !(summary.runsCompleted || 0);
    return {
      ...common,
      state: fresh ? 'fresh' : 'home',
      grade: 'hearth',
      actKicker: fresh ? 'A new chronicle' : 'Between runs',
      title: 'Home Base',
      status: fresh
        ? 'The banners are ready. Your first run awaits.'
        : 'The banners rest. A new run awaits.',
      primary: {
        ...common.primary,
        label: conflict ? 'Choose version' : fresh ? 'Begin first run' : 'Enter Home Base',
      },
    };
  }

  const actId = summary.actId || `act${summary.actReached || 1}`;
  const act = actCardContent(actId);
  const actCount = Number.isFinite(summary.actCount) && summary.actCount > 0 ? summary.actCount : 4;
  const actIndex = Math.max(0, Math.min(actCount - 1, (summary.actReached || 1) - 1));
  // Saves summarised before the roster detail existed still name their units.
  const roster = Array.isArray(summary.roster)
    ? summary.roster
    : (summary.rosterNames || []).map((name) => ({ name }));
  const commander = commanderOf(roster);
  const total = Number.isFinite(summary.rosterSize) ? summary.rosterSize : roster.length;
  const portraitUnit = commander
    ? {
        name: commander.name,
        className: commander.className,
        isLord: commander.isLord,
        tier: commander.tier,
        faction: 'player',
      }
    : null;
  const portraitId = portraitUnit ? portraitIdForUnit(portraitUnit, gameData) : null;
  const where = templateName(gameData?.mapTemplates, summary.templateId);
  let status;
  let tone = 'route';
  if (summary.battleSuspended) {
    tone = 'battle';
    const kind = summary.battleIsBoss ? 'Boss battle' : 'Battle';
    status = where ? `${kind} suspended at ${where}` : `${kind} suspended mid-fight`;
  } else if (Number.isFinite(summary.stage)) {
    const word = NODE_WORDS[summary.nodeType] || 'Camp';
    status = `On the road · ${word}, stage ${summary.stage}`;
  } else status = `Setting out into the ${actRegion(actId) || 'wilds'}`;
  const battles = summary.completedBattles || 0;
  return {
    ...common,
    state: summary.battleSuspended ? 'battle' : 'route',
    tone,
    grade: ACT_GRADE_KEYS[actId] || 'act1',
    actKicker: act.kicker || `Act ${summary.actReached || 1}`,
    title: act.title || 'The road',
    gradeName: act.grade,
    status,
    battles: `${battles} ${battles === 1 ? 'battle' : 'battles'} won`,
    saved: friendlySavedTime(summary.savedAt, now),
    thread: { count: actCount, index: actIndex },
    threadLabel: `Act ${actIndex + 1} of ${actCount}`,
    commander: commander
      ? {
          name: commander.name,
          portraitId,
          line: companionsLine(roster, commander, total),
        }
      : null,
    primary: {
      ...common.primary,
      label: conflict
        ? 'Choose version'
        : summary.battleSuspended
          ? 'Resume battle'
          : 'Continue run',
    },
  };
}
