// I/O-aware orchestration: roster id -> traced sprite (cached), bake entries -> frames.
import { readRaster } from './io.mjs';
import { splitFigures } from './figures.mjs';
import { recoverFigure, traceNative } from './trace.mjs';
import { render } from './render.mjs';
import { paletteFor, unlightGrade, splitImage } from './treat.mjs';
import { idleFrames, attackFrames } from './motion.mjs';
import { rollIdentity, hashString, addHeadband } from './identity.mjs';
import { ROSTER, RECRUITS } from '../roster.mjs';

const sheets = new Map();
const natives = new Map();
const traces = new Map();

export async function loadNative(id) {
  if (natives.has(id)) return natives.get(id);
  const e = ROSTER.sources[id];
  if (!e) throw new Error(`Unknown roster id: ${id}`);
  let r = sheets.get(e.src);
  if (!r) {
    r = await readRaster(e.src);
    sheets.set(e.src, r);
  }
  const box = e.figure != null ? splitFigures(r, e.figures ?? 3)[e.figure] : r.alphaBounds(64);
  const res = recoverFigure(r.crop(box.x, box.y, box.width, box.height), e.recover || {});
  const out = { ...res, box };
  natives.set(id, out);
  return out;
}

export async function traceId(id, { density = 1.5, mode = 'area' } = {}) {
  const k = `${id}@${density}:${mode}`;
  if (traces.has(k)) return traces.get(k);
  const { native } = await loadNative(id);
  const t = traceNative(native, ROSTER.sources[id], { density, mode });
  traces.set(k, t);
  return t;
}

/**
 * Frames for one bake entry: { idle: [Raster x4], attack: [Raster x2], still: Raster }.
 * entry: { source, faction, keepMain, corrupt, identity, headband }
 */
export async function bakeFrames(entry, { density = 1.5 } = {}) {
  const t = await traceId(entry.source, { density });
  const grade = entry.faction === 'corrupted' ? unlightGrade() : entry.grade || null;
  const palette = paletteFor(t, {
    faction: entry.faction,
    keepMain: entry.keepMain,
    identity: entry.identity,
    grade,
  });
  let sprite = t.sprite;
  if (entry.identity?.band) sprite = addHeadband(sprite);
  const draw = (sp) => {
    const img = render(sp, palette);
    return entry.corrupt ? splitImage(img, hashString(entry.key || entry.source)) : img;
  };
  const idle = idleFrames(sprite).map(draw);
  const attack = attackFrames(sprite).map(draw);
  return { idle, attack, still: idle[0], sprite, palette, trace: t };
}

/** The review's seeded recruits: [{ seed, identity, base: entry, promoted: entry }]. */
export function recruitEntries(line = RECRUITS.lines[0], count = RECRUITS.count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const seed = hashString(`${RECRUITS.seedPrefix}${i}`);
    const id = rollIdentity(seed, line.base.length);
    const identity = { hair: id.hair, skin: id.skin, accent: id.band, band: !!id.band };
    out.push({
      seed,
      identity: id,
      base: { key: `${line.key}#${i}`, source: line.base[id.design], faction: 'player', identity },
      promoted: {
        key: `${line.promotedKey}#${i}`,
        source: line.promoted[id.design],
        faction: 'player',
        identity,
      },
    });
  }
  return out;
}
