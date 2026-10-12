// rallyCardModel — the pure side of the Entity rally's speaker cards
// (EntityRallyController, RallyCard).
//
// The rally (engine/FinaleRally.js) says what each speaker says; the music says when: one line
// every two bars from the finale's downbeat. These helpers turn that into a timetable, the text
// a card shows and the edge of the map it docks to. No Phaser, no DOM, no RNG.

/** The bar the finale's hinge cue is cut in (ms) when the music reports none. */
export const RALLY_DEFAULT_BAR_MS = 1765;
/** A beat is never shorter than this, so a card can always be read. */
export const RALLY_MIN_STEP_MS = 1000;
/** How long the last card takes to fade away once its hold is over. */
export const RALLY_FADE_MS = 300;

/** Time between two cards: two bars. */
export function rallyStepMs(barMs) {
  return Math.max(RALLY_MIN_STEP_MS, 2 * (Number(barMs) || RALLY_DEFAULT_BAR_MS));
}

/**
 * The timetable: card `index` appears `atMs` after the call (the finale's downbeat is `leadMs`
 * away, then one card per two bars) and holds `holdMs`: until the next card's beat, and for the
 * last card one more beat, after which it fades.
 * @returns {Array<{ index: number, atMs: number, holdMs: number, last: boolean }>}
 */
export function rallySchedule(count, { leadMs = 0, barMs = RALLY_DEFAULT_BAR_MS } = {}) {
  const step = rallyStepMs(barMs);
  const lead = Math.max(0, Number(leadMs) || 0);
  const n = Math.max(0, Math.floor(Number(count) || 0));
  return Array.from({ length: n }, (_, index) => ({
    index,
    atMs: lead + index * step,
    holdMs: step,
    last: index === n - 1,
  }));
}

/**
 * What a card shows for rally entry `index` of `total` ({ unit, speaker, line }): the speaker's
 * name and class, the line, and "2 / 5" so a player can see how much is left.
 */
export function rallyCardModel(entry, { index = 0, total = 1 } = {}) {
  const unit = entry?.unit || null;
  const name = String(entry?.speaker || unit?.name || '').trim();
  const className = String(unit?.className || '').trim();
  return {
    name,
    className,
    line: String(entry?.line || '').trim(),
    counter: total > 1 ? `${index + 1} / ${total}` : '',
    label: `${name}${className ? `, ${className}` : ''}: ${String(entry?.line || '').trim()}`,
  };
}

/** How far (CSS px) a unit's sprite reaches beyond its centre: a unit this near the card is covered. */
export const RALLY_UNIT_REACH = 18;
/** A selected unit counts as this many units: its action menu opens beside it (desktop canvas). */
export const RALLY_SELECTED_WEIGHT = 4;
/** The other edge must cover this many fewer units before the card moves there. */
export const RALLY_EDGE_MARGIN = 2;

/**
 * Which edge of the map the card docks to: the one that covers fewer units, the bottom on a tie.
 * `ys` are the CSS y of the units in play (the army and the foes in view), `selectedY` the unit
 * whose menu is open (it counts for more: its canvas menu opens beside it), `frame` and `insets`
 * the layer rect and the card's distance from its edges, `cardHeight` the card's height. Once on
 * an edge the card stays until the other covers RALLY_EDGE_MARGIN fewer, so it never flickers.
 * @returns {'top'|'bottom'}
 */
export function rallyCardEdge({
  ys = [],
  selectedY = null,
  frame = null,
  insets = { top: 8, bottom: 8 },
  cardHeight = 80,
  current = null,
} = {}) {
  if (!frame || !(frame.height > 0)) return current || 'bottom';
  const top = frame.top + insets.top;
  const bottom = frame.top + frame.height - insets.bottom;
  const h = Math.max(0, Number(cardHeight) || 0);
  const covered = (lo, hi, y) => y > lo - RALLY_UNIT_REACH && y < hi + RALLY_UNIT_REACH;
  const cover = (lo, hi) => {
    let n = 0;
    for (const y of ys) if (Number.isFinite(y) && covered(lo, hi, y)) n += 1;
    if (Number.isFinite(selectedY) && covered(lo, hi, selectedY)) n += RALLY_SELECTED_WEIGHT - 1;
    return n;
  };
  const atTop = cover(top, top + h);
  const atBottom = cover(bottom - h, bottom);
  if (current === 'top') return atBottom + RALLY_EDGE_MARGIN <= atTop ? 'bottom' : 'top';
  if (current === 'bottom') return atTop + RALLY_EDGE_MARGIN <= atBottom ? 'top' : 'bottom';
  return atTop < atBottom ? 'top' : 'bottom';
}

/**
 * Inset (CSS px) from each edge of a layer frame to the battlefield drawn in it, so the card sits
 * on the board's own edge, not over a letterbox or a HUD plate beside it. `map` and `frame` are
 * { left, top, width, height } rects; a missing or disjoint map leaves `pad` all round.
 */
export function rallyCardInsets(frame, map, pad = 8) {
  const none = { top: pad, bottom: pad };
  if (!frame || !map || !(map.width > 0) || !(map.height > 0)) return none;
  const top = Math.max(frame.top, map.top);
  const bottom = Math.min(frame.top + frame.height, map.top + map.height);
  if (bottom <= top) return none;
  return {
    top: Math.round(top - frame.top + pad),
    bottom: Math.round(frame.top + frame.height - bottom + pad),
  };
}
