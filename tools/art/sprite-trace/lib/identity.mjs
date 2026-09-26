// Seeded recruit identity within a traced design: which of the class's reviewed
// designs (A / B) the person wears, their hair and skin ramps, and an optional
// headband. Promotion keeps the seed, so the same person is recognisable as a
// Swordmaster. Identity colours never use the faction hues (steel blue, crimson,
// verdigris) or Edric's teal. Pure.
import { SLOT } from './slots.mjs';

export function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const HAIRS = [
  'hairBrown',
  'hairBlack',
  'hairChestnut',
  'hairAuburn',
  'hairAsh',
  'hairSilver',
  'hairSlate',
];
export const SKINS = ['skinFair', 'skinWarm', 'skinOlive', 'skinTan', 'skinDeep'];
export const BANDS = [null, null, 'rustCloth', 'oliveCloth', 'boneCloth', 'plumCloth'];

/** rollIdentity(seed, designs = 2) -> { design, hair, skin, band } */
export function rollIdentity(seed, designs = 2) {
  const rnd = mulberry32(seed);
  const design = Math.floor(rnd() * designs);
  const hair = HAIRS[Math.floor(rnd() * HAIRS.length)];
  const skin = SKINS[Math.floor(rnd() * SKINS.length)];
  const band = BANDS[Math.floor(rnd() * BANDS.length)];
  return { design, hair, skin, band };
}

/**
 * Headband: a one-pixel band of `accent` across the hair just above the face — drawn
 * in index space so it takes the light, outline and motion like everything else.
 * `face` = target-space face top row and the hair columns are found from the sprite.
 */
export function addHeadband(sp) {
  // face top: first row (from the top) containing skin in the head region
  const hair = sp.bounds((s) => s === SLOT.hair);
  const skin = sp.bounds((s) => s === SLOT.skin || s === SLOT.eye);
  if (!hair || !skin) return sp;
  // topmost skin pixel of the face (skin whose row is within the hair's vertical span)
  let faceTop = -1;
  for (let y = hair.y; y < hair.y + hair.height + 2 && faceTop < 0; y++)
    for (let x = hair.x; x < hair.x + hair.width; x++)
      if (sp.at(x, y) === SLOT.skin) {
        faceTop = y;
        break;
      }
  if (faceTop < 0) return sp;
  const out = sp.clone();
  const y = faceTop - 1;
  let back = -1;
  for (let x = hair.x; x < hair.x + hair.width; x++)
    if (out.at(x, y) === SLOT.hair) {
      out.set(x, y, SLOT.accent, 3);
      if (back < 0) back = x;
    }
  // the knot's tails hang at the back of the head (the figure faces right)
  if (back >= 0) {
    out.set(back - 1, y + 1, SLOT.accent, 2);
    out.set(back - 1, y + 2, SLOT.accent, 1);
  }
  return out;
}

/** Top row of the face (first skin row inside the hair's vertical span), or -1. */
export function faceTopRow(sp) {
  const hair = sp.bounds((s) => s === SLOT.hair);
  if (!hair) return -1;
  for (let y = hair.y; y < hair.y + hair.height + 2; y++)
    for (let x = hair.x; x < hair.x + hair.width; x++) if (sp.at(x, y) === SLOT.skin) return y;
  return -1;
}

/**
 * Bald crown: hair above the brow becomes scalp (skin, one step lighter: the crown
 * catches the light); hair from the brow down (sides, a beard) keeps the hair ramp.
 * A band or circlet drawn before stays on the scalp.
 */
export function makeBald(sp) {
  const top = faceTopRow(sp);
  if (top < 0) return sp;
  const out = sp.clone();
  for (let y = 0; y < top; y++)
    for (let x = 0; x < sp.w; x++)
      if (out.at(x, y) === SLOT.hair) out.set(x, y, SLOT.skin, Math.min(4, out.shadeAt(x, y) + 1));
  return out;
}
