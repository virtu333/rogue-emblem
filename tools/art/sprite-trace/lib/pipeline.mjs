// I/O-aware orchestration: roster id -> traced sprite (cached), bake entries -> frames.
import { readRaster } from './io.mjs';
import { splitFigures } from './figures.mjs';
import { recoverFigure, traceNative } from './trace.mjs';
import { estimateGridPitch } from './grid.mjs';
import { render } from './render.mjs';
import { paletteFor, unlightGrade, splitImage } from './treat.mjs';
import { idleFrames, attackFrames } from './motion.mjs';
import { hashString, addHeadband, makeBald } from './identity.mjs';
import { SLOT } from './slots.mjs';
import { ROSTER, bakeEntries, poseFor, peopleForClass } from '../roster.mjs';

const sheets = new Map();
const natives = new Map();
const traces = new Map();
const sheetPitch = new Map();

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
  // optional: one grid per sheet (recipe `sheetGrid: true`) — every figure shares its pitch
  let grid = e.recover?.grid || {};
  if (e.sheetGrid && e.figure != null && !grid.pitch && !grid.forcePitch) {
    if (!sheetPitch.has(e.src)) sheetPitch.set(e.src, estimateGridPitch(r, r.alphaBounds(64)));
    const p = sheetPitch.get(e.src);
    if (p.x && p.y && p.confidence >= 0.25) grid = { ...grid, pitch: p };
  }
  const res = recoverFigure(r.crop(box.x, box.y, box.width, box.height), {
    ...(e.recover || {}),
    grid,
  });
  const out = { ...res, box };
  natives.set(id, out);
  return out;
}

export async function traceId(id, { density = 1.5, mode = null } = {}) {
  const k = `${id}@${density}:${mode}`;
  if (traces.has(k)) return traces.get(k);
  const { native, pitch } = await loadNative(id);
  const aspect = pitch && pitch.x ? pitch.y / pitch.x : 1;
  const t = traceNative(native, ROSTER.sources[id], { density, mode, aspect });
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
    keep: ROSTER.sources[entry.source]?.keep || null,
    identity: entry.identity,
    grade,
  });
  let sprite = t.sprite;
  // a person's hair and skin read the same in every design: their shading is centred
  // on the identity ramp (a pale-haired design would otherwise wear only its top steps)
  if (entry.identity?.hair) sprite = centreShades(sprite, SLOT.hair, 2);
  if (entry.identity?.skin) sprite = centreShades(sprite, SLOT.skin, 3, { top: 0.3 });
  if (entry.identity?.band) sprite = addHeadband(sprite);
  // after the band, so a circlet stays on the scalp
  if (entry.identity?.bald) sprite = makeBald(sprite);
  const draw = (sp) => {
    const img = render(sp, palette);
    return entry.corrupt ? splitImage(img, hashString(entry.key || entry.source)) : img;
  };
  const idle = idleFrames(sprite).map(draw);
  const pose = entry.pose || poseFor(entry.source);
  const hint = ROSTER.sources[entry.source]?.weaponAt || null;
  const attack = attackFrames(sprite, { weapon: pose, hint }).map(draw);
  return { idle, attack, still: idle[0], sprite, palette, trace: t, pose };
}

/** Every runtime bake entry (lords, classes x portrait people / factions, bosses). */
export function allEntries() {
  return bakeEntries();
}

/** A class line's people: [{ person, base: entry, promoted: entry }]. */
export function recruitEntries(baseKey = 'myrmidon', promotedKey = 'swordmaster') {
  const all = allEntries();
  return peopleForClass(baseKey).map((person) => ({
    person,
    base: all.find((e) => e.key === `${baseKey}-${person}`),
    promoted: all.find((e) => e.key === `${promotedKey}-${person}`),
  }));
}

/**
 * Shift a slot's shades so their median sits on `target` (0..4), keeping the spread.
 * `top` (0..1] measures the median over the upper part of the figure only (skin: the
 * face, so a design drawn dark-faced with pale palms still gets the person's face tone).
 */
export function centreShades(sp, slot, target, { top = 1 } = {}) {
  const b = sp.bounds();
  const maxY = b ? b.y + Math.max(1, Math.round(b.height * top)) : sp.h;
  let shades = [];
  for (let i = 0; i < sp.w * sp.h; i++)
    if (sp.slot[i] === slot && Math.floor(i / sp.w) < maxY) shades.push(sp.shade[i]);
  if (!shades.length)
    for (let i = 0; i < sp.w * sp.h; i++) if (sp.slot[i] === slot) shades.push(sp.shade[i]);
  if (!shades.length) return sp;
  shades.sort((a, b) => a - b);
  const delta = target - shades[shades.length >> 1];
  if (!delta) return sp;
  const out = sp.clone();
  for (let i = 0; i < out.w * out.h; i++)
    if (out.slot[i] === slot) out.shade[i] = Math.max(0, Math.min(4, out.shade[i] + delta));
  return out;
}
