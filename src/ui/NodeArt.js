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
export function createNodeArt(index, size = 44) {
  const [x, y, w, h] = NODE_ART_RECTS[index] || NODE_ART_RECTS[0];
  const scale = size / Math.max(w, h);
  const el = document.createElement('span');
  el.className = 're-node-art';
  el.style.width = `${w * scale}px`;
  el.style.height = `${h * scale}px`;
  el.style.backgroundSize = `${1254 * scale}px ${1254 * scale}px`;
  el.style.backgroundPosition = `${-x * scale}px ${-y * scale}px`;
  return el;
}
