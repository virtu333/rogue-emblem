// DialogueCast.js — Pure helpers: recast scripted story dialogue for runs
// whose starting pair differs from the default Edric + Sera.
//
// Scripts are written for two voices: the hero (Edric) and the seer (Sera).
// When a scripted speaker is missing from the starting pair, their lines move
// to the stand-in voice from the pair; when both are present the script plays
// verbatim. Line text may use the {commander} token, which resolves to the
// hero voice's name (so a Sera commander never addresses herself).

import { DEFAULT_STARTING_LORD_NAMES } from './Commander.js';

const COMMANDER_TOKEN = '{commander}';

/**
 * Resolve the two story voices from the starting pair.
 * @param {string[]|null} startingLordNames - [commander, partner]
 * @returns {{ commander: string, partner: string, hero: string, seer: string }}
 */
export function resolveDialogueCast(startingLordNames) {
  const pair =
    Array.isArray(startingLordNames) &&
    typeof startingLordNames[0] === 'string' &&
    typeof startingLordNames[1] === 'string' &&
    startingLordNames[0] !== startingLordNames[1]
      ? startingLordNames
      : DEFAULT_STARTING_LORD_NAMES;
  const [commander, partner] = pair;
  const hero = pair.includes('Edric') ? 'Edric' : commander === 'Sera' ? partner : commander;
  const seer = pair.includes('Sera') ? 'Sera' : pair.find((name) => name !== hero);
  return { commander, partner, hero, seer };
}

/** Replace the {commander} token with the hero voice's name. */
export function adaptDialogueLine(line, cast) {
  if (typeof line !== 'string') return line;
  return line.split(COMMANDER_TOKEN).join(cast.hero);
}

/**
 * Recast a story-sequence entry array. Returns a new array; entries that need
 * no change are passed through by reference.
 * @param {Array<{speaker?: string, portrait?: string, line?: string}>} entries
 * @param {string[]|null} startingLordNames - runManager.getStartingLordNames()
 */
export function adaptDialogueEntries(entries, startingLordNames) {
  if (!Array.isArray(entries)) return entries;
  const cast = resolveDialogueCast(startingLordNames);
  return entries.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry;
    let speaker = entry.speaker;
    if (speaker === 'Edric') speaker = cast.hero;
    else if (speaker === 'Sera') speaker = cast.seer;
    const line = adaptDialogueLine(entry.line, cast);
    if (speaker === entry.speaker && line === entry.line) return entry;
    return {
      ...entry,
      speaker,
      line,
      portrait:
        speaker === entry.speaker
          ? entry.portrait
          : `portrait_lord_${String(speaker).toLowerCase()}`,
    };
  });
}
