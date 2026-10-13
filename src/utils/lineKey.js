// lineKey.js — the short key a narrative line is remembered by on a save.

/** A stable 32-bit hash (FNV-1a) for ordering and remembering lines. */
export function lineHash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/** The key a line is remembered by once played (MetaProgressionManager). */
export function narrativeLineKey(line) {
  return `l${lineHash(String(line)).toString(36)}`;
}
