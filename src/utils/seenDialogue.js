// Only explicitly repeatable story categories participate; never boss or recruit beats.
export function seenDialogueKey(category, key, entries) {
  if (!['runStart', 'actTransition'].includes(category) || !key || !entries?.length) return null;
  const content = JSON.stringify(
    entries.map(({ speaker, portrait, line }) => [speaker || '', portrait || '', line || '']),
  );
  let first = 2166136261,
    second = 5381;
  for (let i = 0; i < content.length; i++) {
    first = Math.imul(first ^ content.charCodeAt(i), 16777619) >>> 0;
    second = (Math.imul(second, 33) ^ content.charCodeAt(i)) >>> 0;
  }
  return `${category}:${key}:${first.toString(16)}-${second.toString(16)}`;
}
export function mergeSeenDialogueKeys(...sources) {
  return [
    ...new Set(
      sources
        .flat()
        .filter((key) => typeof key === 'string' && key.length > 0 && key.length <= 200),
    ),
  ].slice(-200);
}
