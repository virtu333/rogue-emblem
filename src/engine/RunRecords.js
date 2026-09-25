import { DEED_FORMS } from './DeedTitles.js';

// Records contain display snapshots, never live units or inventory objects.
export function mergeRunRecords(...sources) {
  const byId = new Map();
  for (const record of sources.flat()) {
    if (!record || typeof record.id !== 'string' || !record.id) continue;
    const clean = {
      id: record.id.slice(0, 160),
      endedAt: Number.isFinite(record.endedAt) ? record.endedAt : 0,
      difficulty: ['normal', 'hard', 'lunatic'].includes(record.difficulty)
        ? record.difficulty
        : 'normal',
      seed: Number.isFinite(record.seed) ? record.seed : null,
      actsCleared: Math.max(0, Math.trunc(record.actsCleared) || 0),
      totalTurns: Number.isFinite(record.totalTurns)
        ? Math.max(0, Math.trunc(record.totalTurns))
        : null,
      // The Eclipse's final shadow (null for runs before it or with it off).
      shadow: Number.isFinite(record.shadow)
        ? Math.max(0, Math.min(1000, Math.trunc(record.shadow)))
        : null,
      roster: (Array.isArray(record.roster) ? record.roster : [])
        .slice(0, 20)
        .filter((u) => typeof u?.name === 'string')
        .map((u) => ({
          name: u.name.slice(0, 80),
          className: String(u.className || '').slice(0, 80),
          level: Math.max(1, Math.trunc(u.level) || 1),
          isLord: u.isLord === true,
          // A title earned on the march (Deeds & Epithets); absent on older records.
          ...(typeof u.epithet === 'string' && u.epithet.trim()
            ? {
                epithet: u.epithet.trim().slice(0, 80),
                epithetForm: DEED_FORMS.includes(u.epithetForm) ? u.epithetForm : 'the',
              }
            : {}),
        })),
    };
    if (!byId.has(clean.id) || clean.endedAt > byId.get(clean.id).endedAt)
      byId.set(clean.id, clean);
  }
  return [...byId.values()]
    .sort((a, b) => b.endedAt - a.endedAt || a.id.localeCompare(b.id))
    .slice(0, 50);
}
