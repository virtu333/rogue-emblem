// EventTells.js — roster tells: a unit who knows better speaks up under a choice
// (docs/specs/event-nodes-phase2.md §2A "Roster tells").
//
//   choice.tells: [{ when: { class | classes | weaponType | trait | skill }, line, reveals | tilts }]
//
// A tell is shown when a LIVING roster unit matches `when` (exactly one key per tell). The
// speaker is a seeded pick among the matches, lords last (a lord speaks only when no one
// else matches), keyed `event-tell:${runSeed}:${nodeId}:${pageId}:${choiceId}:${n}` so a
// refresh shows the same voice. `{name}` in the line is the speaker. Lines are at most
// EVENT_TEXT_LIMITS.tell characters, in the lore style guide's voice, and never show a
// number.
//
// What a tell does:
//   reveals: '<outcomeId>'   the line tells the truth about that outcome of the choice, and it
//                            is shown ONLY when that outcome is the one this run will roll:
//                            the outcome is fixed by the run seed before the choice is made
//                            (EventSystem.selectOutcome), so "that is a tripwire" is said only
//                            where there is a tripwire, and a quiet roster unit means the
//                            named outcome is not coming. Never on a check choice (its outcome
//                            depends on who is chosen: use `tilts`). The data validator checks
//                            the name is a real outcome that can happen.
//   tilts: 'pass'            on a CHECK choice: the line is the only thing the player sees,
//                            and the check's chance of passing rises by TELL_TILT (once, not
//                            per tell). EventCommands passes it to selectOutcome.
//
// Pure: no Phaser, no DOM, no Math.random.

import { eventRng, livingUnits, runSeedOf, selectOutcome, unitWields } from './EventSystem.js';
import { knowsSkill } from './UnitManager.js';
import { unitUidOf } from './UnitIdentity.js';

/** What a `tilts` tell adds to a check's chance of passing (shown only as the line). */
export const TELL_TILT = 0.1;

/** The `when` keys: the unit's class, one of several classes, a weapon it wields, a trait, a skill. */
export const TELL_WHEN_KEYS = Object.freeze(['class', 'classes', 'weaponType', 'trait', 'skill']);

/** True when a unit matches a tell's `when` (a single key). */
export function tellMatches(unit, when) {
  if (!unit || !when || typeof when !== 'object') return false;
  if (when.class !== undefined) return unit.className === when.class;
  if (when.classes !== undefined)
    return Array.isArray(when.classes) && when.classes.includes(unit.className);
  if (when.weaponType !== undefined) return unitWields(unit, [when.weaponType]);
  if (when.trait !== undefined)
    return Array.isArray(unit.traits) && unit.traits.includes(when.trait);
  if (when.skill !== undefined) return knowsSkill(unit, when.skill);
  return false;
}

const byUid = (a, b) =>
  String(unitUidOf(a) || a.name).localeCompare(String(unitUidOf(b) || b.name), 'en', {
    numeric: true,
  });

/**
 * The tells a choice shows now: [{ speaker: { uid, name }, line, reveals, tilts }] (a tell
 * with no living match is left out, and so is a `reveals` tell whose outcome is not the one
 * the run will roll: a tell only ever says what is true). `reveals`/`tilts` are for the
 * engine; the view hands the UI only the speaker and the line.
 */
export function choiceTells(run, nodeId, pageId, choice) {
  const out = [];
  const tells = Array.isArray(choice?.tells) ? choice.tells : [];
  const living = livingUnits(run);
  // The outcome this run will roll for the choice (null for a check: it depends on the target).
  const fated = choice?.check
    ? null
    : (selectOutcome(run, nodeId, choice, { pageId }).outcome?.id ?? null);
  tells.forEach((tell, index) => {
    if (typeof tell.reveals === 'string' && tell.reveals !== fated) return;
    const matches = living.filter((unit) => tellMatches(unit, tell.when)).sort(byUid);
    if (matches.length === 0) return;
    const others = matches.filter((unit) => unit.isLord !== true);
    const pool = others.length ? others : matches;
    const rng = eventRng(`event-tell:${runSeedOf(run)}:${nodeId}:${pageId}:${choice.id}:${index}`);
    const speaker = pool[Math.floor(rng() * pool.length)];
    out.push({
      speaker: { uid: unitUidOf(speaker) || null, name: speaker.name },
      line: String(tell.line ?? '').replaceAll('{name}', speaker.name),
      reveals: typeof tell.reveals === 'string' ? tell.reveals : null,
      tilts: tell.tilts === 'pass' ? 'pass' : null,
    });
  });
  return out;
}

/** The nudge to a check's odds from the tells shown: TELL_TILT once, else 0. */
export function tellTilt(tells) {
  return (tells || []).some((tell) => tell.tilts === 'pass') ? TELL_TILT : 0;
}
