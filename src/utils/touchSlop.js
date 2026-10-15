// touchSlop — how far a finger may wander and still be a tap, in one unit for every reader.
//
// Phaser pointer coordinates are game pixels (the 640x480 canvas), but the canvas is
// scaled to the screen (Scale.FIT): an upright phone shows 640 game pixels in about
// 390 CSS pixels, so one CSS pixel there is ~1.64 game pixels. A finger's wobble is a
// physical distance, so the slop is set in CSS pixels and converted per pointer.
//
// The battle reads it twice: the camera starts a pan only once a single finger has
// moved MORE than the slop, and the input controller keeps a press a tap only while it
// has moved NO MORE than the slop. One number, one conversion, so no movement is
// neither (before, the tap gave up at 12 game px and the pan began at 10 CSS px: on an
// upright phone a 7-10 CSS px wobble did nothing at all).

/** The slop, in CSS pixels. */
export const TOUCH_SLOP_CSS_PX = 10;

/** Game pixels per CSS pixel for this pointer's canvas (1 when it can't be measured). */
export function gamePxPerCssPx(pointer, canvas = null) {
  try {
    const el = canvas || pointer?.manager?.game?.canvas;
    const rect = el?.getBoundingClientRect?.();
    const ratio = rect?.width && el.width ? el.width / rect.width : 1;
    return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  } catch {
    return 1;
  }
}

/** The slop in game pixels for this pointer. */
export function touchSlopGamePx(pointer, canvas = null) {
  return TOUCH_SLOP_CSS_PX * gamePxPerCssPx(pointer, canvas);
}

/** True when the finger has moved past the slop from `from` (both in game pixels). */
export function exceedsTouchSlop(pointer, from, canvas = null) {
  const dx = (Number(pointer?.x) || 0) - (Number(from?.x) || 0);
  const dy = (Number(pointer?.y) || 0) - (Number(from?.y) || 0);
  return Math.hypot(dx, dy) > touchSlopGamePx(pointer, canvas);
}
