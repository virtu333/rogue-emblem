// Explicit source rectangles exclude adjacent artwork on the approved concept sheet.
// The original pixels are unchanged; DOM and Phaser use identical atlas bounds.
export const NODE_ART_RECTS = [
  [40, 96, 350, 326],
  [444, 76, 370, 354],
  [849, 48, 370, 382],
  [28, 474, 384, 332],
  [438, 472, 378, 334],
  [858, 536, 354, 270],
  [25, 879, 389, 322],
  [445, 857, 376, 344],
  [827, 806, 404, 416],
];
export const NODE_ART_ATLAS = {
  frames: Object.fromEntries(
    NODE_ART_RECTS.map(([x, y, w, h], i) => [
      String(i),
      {
        frame: { x, y, w, h },
        rotated: false,
        trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w, h },
        sourceSize: { w, h },
      },
    ]),
  ),
};

// The Event medal and its Dark Omen (eclipsed) variant live on a small sheet of their own,
// baked at 96 px (tools/art/nodes/bakeMedals.mjs): the weathered sheet above is a 1254 px
// source and is not grown. Frames 9 and 10 follow the nine concept-sheet medals.
export const EVENT_ART_FRAME = 9;
export const EVENT_DARK_ART_FRAME = 10;
export const EVENT_ART_SHEET = {
  src: 'assets/sprites/nodes/event-nodes.png',
  size: [192, 96],
  frames: { 9: [0, 0, 96, 96], 10: [96, 0, 96, 96] },
};
// Where a missing sheet falls back to: the Ruins medal with a "?" on it (the first Event look).
const EVENT_FALLBACK_FRAME = 4;

function assetUrl(src) {
  let base = '/';
  try {
    base = import.meta.env?.BASE_URL ?? '/';
  } catch {
    /* no bundler env: the site root */
  }
  return `${base}${src}`;
}

// 'unknown' until the sheet has been probed once; then 'ok' or 'missing' for the session.
let eventSheet = 'unknown';
let probing = false;
const waiting = new Set();

function eventFallbackMark() {
  const mark = document.createElement('span');
  mark.className = 're-loom-mark';
  mark.textContent = '?';
  mark.setAttribute('aria-hidden', 'true');
  return mark;
}

function paint(el, index, size) {
  const [x, y, w, h] = NODE_ART_RECTS[index] || NODE_ART_RECTS[0];
  const scale = size / Math.max(w, h);
  el.style.width = `${w * scale}px`;
  el.style.height = `${h * scale}px`;
  el.style.backgroundSize = `${1254 * scale}px ${1254 * scale}px`;
  el.style.backgroundPosition = `${-x * scale}px ${-y * scale}px`;
}

function toEventFallback(el, size) {
  el.style.backgroundImage = '';
  el.dataset.fallback = 'true';
  paint(el, EVENT_FALLBACK_FRAME, size);
  if (!el.querySelector('.re-loom-mark')) el.append(eventFallbackMark());
}

function probeEventSheet() {
  if (eventSheet !== 'unknown' || probing || typeof Image === 'undefined') return;
  probing = true;
  const img = new Image();
  img.onload = () => {
    eventSheet = 'ok';
    waiting.clear();
  };
  img.onerror = () => {
    eventSheet = 'missing';
    for (const [el, size] of waiting) toEventFallback(el, size);
    waiting.clear();
  };
  img.src = assetUrl(EVENT_ART_SHEET.src);
}

/** Art for the Event frames: the baked sheet, or the Ruins medal with a "?" if it is missing. */
function createEventArt(index, size) {
  const [x, y, w, h] = EVENT_ART_SHEET.frames[index];
  const scale = size / Math.max(w, h);
  const el = document.createElement('span');
  el.className = 're-node-art';
  el.dataset.frame = String(index);
  if (eventSheet === 'missing') {
    toEventFallback(el, size);
    return el;
  }
  el.style.width = `${w * scale}px`;
  el.style.height = `${h * scale}px`;
  el.style.backgroundImage = `url("${assetUrl(EVENT_ART_SHEET.src)}")`;
  el.style.backgroundSize = `${EVENT_ART_SHEET.size[0] * scale}px ${EVENT_ART_SHEET.size[1] * scale}px`;
  el.style.backgroundPosition = `${-x * scale}px ${-y * scale}px`;
  if (eventSheet === 'unknown') {
    waiting.add([el, size]);
    probeEventSheet();
  }
  return el;
}

export function createNodeArt(index, size = 44) {
  if (EVENT_ART_SHEET.frames[index]) return createEventArt(index, size);
  const el = document.createElement('span');
  el.className = 're-node-art';
  el.dataset.frame = String(index);
  paint(el, index, size);
  return el;
}
