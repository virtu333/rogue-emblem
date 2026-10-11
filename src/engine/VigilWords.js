// VigilWords — what the Vigil's Voices say aloud (docs/specs/act-v-descent.md §3.1, §10.5).
// Pure: no Phaser, no RNG. The words are presentation only: the rules (who speaks, how many
// words count, who is called) are engine/Vigil.js, and nothing here reads or writes the battle.
//
// dialogue.json `vigil`:
//   entry       the battle-entry beat: the Voices, before the first move (a story section:
//               base + variants, `when` keys as NarrativeDirector; `riteBand` reads the Rite)
//   entryReply  the commander's answer (variants by `commander`), played after `entry`
//   voices.<authoredId>
//     words     the verse that Voice keeps, one word (or a short phrase) per word it speaks,
//               in order; a Voice that speaks two at once (the Waking, while the others live)
//               says the next two together. The verse starts again once it runs out.
//     silenced  its last line, said as it falls
//   call        what a called Hollowed answers as it rises (the roll call), one per call
//
// Every pick is a count the battle already keeps (vigilState.byVoice / byCircle), so a resume or
// a Vision rewind that replays a phase says exactly what it said the first time.

const count = (value) => Math.max(0, Math.trunc(Number(value) || 0));
const lines = (list) =>
  Array.isArray(list) ? list.filter((l) => typeof l === 'string' && l.trim()) : [];

/** A Voice's verse (its `words`), or []. */
export function voiceVerse(pool, voiceId) {
  return lines(pool?.voices?.[voiceId]?.words);
}

/**
 * What each Voice says this phase: for every `{ voiceId, count }` the step spoke, the next
 * `count` words of its verse after the `before[voiceId]` it had already spoken this battle.
 * @param {{ voiceId: string, count: number }[]} words vigilPhaseStep's `words`
 * @param {Record<string, number>} before the state's `byVoice` before the step
 * @param {object} pool dialogue.json `vigil`
 * @returns {{ voiceId: string, text: string }[]} only Voices that have a verse
 */
export function vigilSpokenWords(words, before, pool) {
  const out = [];
  for (const word of Array.isArray(words) ? words : []) {
    const verse = voiceVerse(pool, word?.voiceId);
    const n = count(word?.count);
    if (!verse.length || n === 0) continue;
    const start = count(before?.[word.voiceId]);
    const said = [];
    for (let i = 0; i < n; i++) said.push(verse[(start + i) % verse.length]);
    out.push({ voiceId: word.voiceId, text: said.join(' ') });
  }
  return out;
}

/** A Voice's last line as it falls, or null. */
export function vigilSilencedLine(pool, voiceId) {
  const line = pool?.voices?.[voiceId]?.silenced;
  return typeof line === 'string' && line.trim() ? line : null;
}

/**
 * The answer a called Hollowed gives as it rises: the roll call, walked by how many the circles
 * have called this battle before it (`ordinal`, 0-based), so each call answers in turn.
 */
export function vigilCallLine(pool, ordinal) {
  const list = lines(pool?.call);
  return list.length ? list[count(ordinal) % list.length] : null;
}
