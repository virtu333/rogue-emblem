// riteModel.js - what the route map and the pause list say of the Rite (act-v-descent §4, §8):
// the chip beside the burden chips, its opened note, and the finale's (and the gate's) node
// preview. Pure: no Phaser, no DOM. The numbers and the tiers are engine/Rite.js (`riteView`, the
// one read of the Rite for the UI); this file only arranges its words. The words themselves (tier
// effects, `riteModLines`) are the engine's, never rewritten here.
//
// A preview never promises what the battle will not keep: before a node's map is locked it is
// the current tier's effect on that boss (`riteView(run, { node })`), read again when the battle
// begins; once the map is locked it is what the locked config recorded it did
// (`battleConfig.riteMods`, RiteBattleMods.js), which is the battle that will be fought.

import {
  riteBandLabel,
  riteConfigOf,
  riteModLines,
  riteTargetOf,
  riteView,
  riteWaveTurnFor,
  riteWordsShown,
} from '../engine/Rite.js';

/** The bosses a tier speaks to, as the player names them. */
export const RITE_TARGET_NAMES = Object.freeze({
  lieutenant: 'The Lieutenant',
  entity: 'The Entity',
});
/** Where a word came from (the log's `source`), as the chip's "From" line names it. */
export const RITE_SOURCE_NAMES = Object.freeze({
  eclipse: 'The Eclipse',
  vigil: 'The Vigil',
  event: 'Events',
  battle: 'Par',
});

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const signed = (n) => (n < 0 ? `−${-n}` : `+${n}`);
const targetName = (target) => RITE_TARGET_NAMES[target] || target;

/**
 * The bosses of the route the army has not yet fought, from the view's effects: on the Entity's
 * road the Lieutenant's gate drops out once its node is done (its tier can no longer change a
 * battle). A target whose boss node cannot be found stays.
 */
function pendingEffects(run, effects) {
  const nodes = run?.nodeMap?.nodes || [];
  return effects.filter(({ target }) => {
    const bossNodes = nodes.filter((n) => riteTargetOf(n, run?.gameData) === target);
    return bossNodes.length === 0 || bossNodes.some((n) => !n.completed);
  });
}

/**
 * One boss's effect as a sentence in two parts: the boss's name and the rest. The engine's own
 * lines usually open with the name ("The Lieutenant carries 1 more Revival Stone"), so the name
 * is not said twice; a line that does not ("No change") gets a colon after it.
 * @returns {{ target: string, name: string, rest: string, lines: string[] }}
 */
export function effectParts(target, lines) {
  const name = targetName(target);
  // Each line is a sentence of its own ("A. B"): nothing here lowercases the engine's words.
  const text = lines.join('. ');
  const rest = text.startsWith(name) ? text.slice(name.length) : `: ${text}`;
  return { target, name, rest, lines };
}

/** What each source has put on the Rite so far: [{ source, name, delta }], nonzero, log order. */
export function riteSourceTotals(log) {
  const totals = new Map();
  for (const entry of Array.isArray(log) ? log : []) {
    const delta = Number(entry?.delta) || 0;
    if (!delta || !RITE_SOURCE_NAMES[entry.source]) continue;
    totals.set(entry.source, (totals.get(entry.source) || 0) + delta);
  }
  return [...totals]
    .filter(([, delta]) => delta !== 0)
    .map(([source, delta]) => ({ source, name: RITE_SOURCE_NAMES[source], delta }));
}

/**
 * The route map's Rite chip and what its tap opens, or null with no Rite (every run that is not
 * in the Descent).
 * @param {object} run RunManager
 * @param {{ live?: { vigilState?: object|null, riteAtEntry?: number } }} [opts] `live` is a battle
 *   in progress (BattleScene.liveRiteOptions): the words shown are the Rite's plus the Vigil's
 *   spoken so far (Rite.riteWordsShown), the tier and the way up follow that count, and the run's
 *   Rite is not written. The route map has no battle, so it passes none.
 * @returns {{ id: 'rite', label: string, short: string, chip: string, words: number,
 *   band: string, bandLabel: string, progress: string, effects: { target: string, name: string,
 *   rest: string, lines: string[] }[], sources: { source: string, name: string, delta: number }[],
 *   fromLine: string, terms: string }|null}
 *   `short` is the chip's figure ("7 words · Spoken"), `progress` the words to the next tier,
 *   `terms` the whole of it as one text (the pause list, a chip's title).
 */
export function riteChipModel(run, { live = null } = {}) {
  const words = riteWordsShown(run, live?.vigilState, { atEntry: live?.riteAtEntry });
  const view = riteView(run, { words });
  if (!view) return null;
  // Words spoken in the live Vigil are the Vigil's, in "From" as in the count.
  const spoken = words - (run.rite?.words ?? words);
  const short = view.chip.replace(/^The Rite:\s*/, '');
  const progress = view.next
    ? `${plural(Math.max(0, view.next.at - view.words), 'more word')} to ${view.next.label} (${view.next.at}).`
    : 'The highest tier.';
  const effects = pendingEffects(run, view.effects).map((e) => effectParts(e.target, e.lines));
  const sources = riteSourceTotals(
    spoken > 0 ? [...view.log, { source: 'vigil', delta: spoken }] : view.log,
  );
  const fromLine = sources.length
    ? `From: ${sources.map((s) => `${s.name} ${signed(s.delta)}`).join(' · ')}`
    : '';
  const effectText = effects.map((e) => `${e.name}${e.rest}.`);
  return {
    id: 'rite',
    label: 'The Rite',
    short,
    chip: view.chip,
    words: view.words,
    band: view.band,
    bandLabel: view.label,
    progress,
    effects,
    sources,
    fromLine,
    terms: [`${view.label}. ${progress}`, ...effectText, fromLine && `${fromLine}.`]
      .filter(Boolean)
      .join(' '),
  };
}

/**
 * riteChipModel's options for a battle in progress: the Vigil's words so far count against the
 * Rite as the battle began (`battleParams.riteAtEntry`). The one place a battle's state meets the
 * chip, so the pause list and any other reader in a battle build it the same way.
 * @param {object|null} vigilState the battle's vigilState (null: no Vigil on this map)
 * @param {object|null} battleParams
 */
export function liveRiteOptions(vigilState, battleParams) {
  return { live: { vigilState: vigilState || null, riteAtEntry: battleParams?.riteAtEntry } };
}

/** The pause list's entry for the Rite ({ id, label, short, text }), or null. */
export function riteBurdenEntry(run, opts) {
  const chip = riteChipModel(run, opts);
  return chip ? { id: 'rite', label: chip.label, short: chip.short, text: chip.terms } : null;
}

// ── The node preview ─────────────────────────────────────────────────────

/**
 * The lines of a locked config's recorded Rite effect (`battleConfig.riteMods`: what the
 * generated map holds, which is what the battle will do). No record (the tier asked nothing of
 * this boss, or nothing could be placed) is "No change".
 */
export function lockedRiteLines(record, { turnOf = null } = {}) {
  if (!record || typeof record !== 'object' || !record.target) return ['No change'];
  const { target } = record;
  const lines = riteModLines(
    {
      escortDrop: record.escortDropped,
      revivalStones: record.revivalStones,
      splashDelta: record.splashDelta,
    },
    target,
  );
  const waves = (Array.isArray(record.waves) ? record.waves : []).filter((w) => w?.count > 0);
  if (waves.length) {
    const counts = waves.map((w) => w.count);
    if (target === 'lieutenant')
      lines.push(
        ...riteModLines({ waveHollowed: counts[0], waveTurn: waves[0].turn }, target, { turnOf }),
      );
    else if (counts.every((c) => c === counts[0]))
      lines.push(...riteModLines({ waveHollowed: counts[0] }, target));
    else lines.push(`Its waves bring ${counts.join(', ')} Hollowed`);
  }
  return lines.length ? lines : ['No change'];
}

/**
 * The Rite's effect on `node`'s battle for its loom card, or null when the node is not a boss
 * the Rite reads, one already won, or there is no Rite.
 * @param {object} run RunManager
 * @param {object} node a route node
 * @returns {{ id: 'rite', target: string, name: string, label: string, bandLabel: string,
 *   words: number, wordsText: string, state: 'open'|'locked', note: string,
 *   lines: string[] }|null}
 */
export function riteNodeModel(run, node) {
  const view = riteView(run, { node });
  const effect = view?.effects?.[0];
  if (!effect || node.completed) return null;
  const locked = run?.battleConfigsByNodeId?.[node.id] || null;
  const record = locked?.riteMods || null;
  return {
    id: 'rite',
    target: effect.target,
    name: targetName(effect.target),
    label: 'The Rite',
    bandLabel: record?.band ? riteBandLabel(record.band) : view.label,
    words: view.words,
    wordsText: plural(view.words, 'word'),
    state: locked ? 'locked' : 'open',
    note: locked ? 'Set for this battle.' : 'Read when the battle begins.',
    lines: locked
      ? lockedRiteLines(record, {
          // The wave is due as the locked map's scheduler will place it, with the delay the
          // battle applies when it begins (the run's Hollow Hourglass, read live like its params).
          turnOf: (turn) => riteWaveTurnFor(run, turn, { reinforcements: locked.reinforcements }),
        })
      : effect.lines,
  };
}

// ── Notes under a route node's text ──────────────────────────────────────

/** The Vigil's rule the player can act on before the fight: standing on a circle stops its summons, never its Voice's words. */
export const VIGIL_CIRCLE_NOTE = 'Stand on a circle to stop its summons. Its Voice still speaks.';

/**
 * The lines the Rite's rules owe the player under a Descent route node's text, or []:
 *  - the Mortuary Column (a node `rite.underPar` names): what winning at or under par does to
 *    the Rite, read from the data;
 *  - the Vigil: that standing on a summoning circle stops its summons but not its Voice's words.
 * Nothing without a Rite, and nothing on a node already won.
 * @param {object} run RunManager
 * @param {object} node a route node
 * @returns {string[]}
 */
export function riteNodeNotes(run, node) {
  if (!run?.rite || !node || node.completed) return [];
  const notes = [];
  const delta = Math.trunc(Number(riteConfigOf(run).underPar?.[node.descentKey]) || 0);
  if (delta)
    notes.push(
      `Win at or under par: the Rite ${delta < 0 ? 'loses' : 'gains'} ${plural(Math.abs(delta), 'word')}.`,
    );
  if (node.battleParams?.setPiece === 'the_vigil') notes.push(VIGIL_CIRCLE_NOTE);
  return notes;
}
