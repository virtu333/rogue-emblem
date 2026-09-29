#!/usr/bin/env python3
"""Hand-fix the Warden's spear in the warden_level clip (drawings 3 on).

The clip's last frame was the guard exported before its spear was lengthened, so once
he is in the guard the spear is about 1.3 m, against the 2.4 m he carries upright and
thrusts. This repacks the atlas with room on the left and, in each guard drawing,
lengthens the spear along its own line: the painted head is lifted off, the shaft is
continued with its own cross-section (sampled just behind the head), and the head is
set back on at the new point. The upright and falling drawings (0-2) are untouched.

Run once on the clip as packed (git holds it); rewrites the atlas and its JSON.
"""

import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[4]
ATLAS = ROOT / "docs/art-direction/anime-op/motion/warden_level.webp"
META_P = ATLAS.with_suffix(".json")
PAD = 160  # extra cell px on the left, for the longer spear
FIRST = 3  # the first drawing with the spear level in his hands
EXT_M = 1.05  # how much longer (m)


def main():
    meta = json.loads(META_P.read_text())
    cw, ch = meta["cell"]
    cols = meta["cols"]
    n = meta["frames"]
    mpp = 1.9 / (355 - 109)  # metres per cell px: standing helm-to-sole, drawing 0
    ext = EXT_M / mpp
    src = np.array(Image.open(ATLAS).convert("RGBA"))
    ncw = cw + PAD
    out = np.zeros((ch * math.ceil(n / cols), ncw * cols, 4), np.uint8)
    for i in range(n):
        sx, sy = (i % cols) * cw, (i // cols) * ch
        c = np.zeros((ch, ncw, 4), np.uint8)
        c[:, PAD:] = src[sy : sy + ch, sx : sx + cw]
        if i >= FIRST:
            c = lengthen(c, ext)
        dx, dy = (i % cols) * ncw, (i // cols) * ch
        out[dy : dy + ch, dx : dx + ncw] = c
    Image.fromarray(out, "RGBA").save(ATLAS, "WEBP", quality=88, alpha_quality=100, method=6)
    meta["cell"] = [ncw, ch]
    meta["anchor"] = [meta["anchor"][0] + PAD, meta["anchor"][1]]
    meta["spearFix"] = {"pad": PAD, "from": FIRST, "extM": EXT_M}
    c = meta.get("contacts")
    if c:
        # contact positions are cell px: shift x by the pad (feet, planted, footfalls)
        c["feet"] = [[[q[0] + PAD, *q[1:]] for q in fr] for fr in c.get("feet", [])]
        c["planted"] = [None if q is None else [q[0] + PAD, *q[1:]] for q in c.get("planted", [])]
        for f in c.get("footfalls", []):
            f["x"] += PAD
    META_P.write_text(json.dumps(meta, indent=2) + "\n")
    print(f"lengthened the spear in drawings {FIRST}-{n - 1} by {EXT_M} m ({ext:.0f} px)")


def lengthen(c, ext):
    a = c[:, :, 3] > 60
    h, w = a.shape
    # the point: the leftmost opaque pixel at spear height (above the lead leg)
    band = a[190:280]
    ys, xs = np.nonzero(band)
    tx = xs.min()
    ty = 190 + ys[xs == tx].mean()
    # walk from the point along the spear: the head widens then narrows to the shaft;
    # the shaft is the thin run (<= 5 px) that continues from it. Track it by continuity
    def runs(x, y0, y1):
        col = np.nonzero(a[max(0, y0) : min(h, y1), x])[0]
        if not len(col):
            return []
        rs = np.split(col, np.nonzero(np.diff(col) > 1)[0] + 1)
        return [(max(0, y0) + r.min(), max(0, y0) + r.max()) for r in rs]

    cy = ty
    wide = False
    head_end = None
    pts = []
    for x in range(tx + 1, min(w, tx + 90)):
        rs = runs(x, int(cy) - 14, int(cy) + 14)
        if not rs:
            break
        r = min(rs, key=lambda q: abs((q[0] + q[1]) / 2 - cy))
        hgt = r[1] - r[0] + 1
        if hgt >= 7:
            wide = True
        if head_end is None and wide and hgt <= 5:
            head_end = x
        if head_end is not None:
            if hgt > 5:
                break  # a hand, the cloak or a leg: the free shaft ends here
            pts.append((x, (r[0] + r[1]) / 2))
        cy = (r[0] + r[1]) / 2
    pts = np.array(pts)
    k, b = np.polyfit(pts[:, 0], pts[:, 1], 1)  # y = k x + b along the shaft
    ux, uy = 1 / math.hypot(1, k), k / math.hypot(1, k)  # toward the butt
    head = np.zeros_like(a)
    for y in range(max(0, int(ty) - 14), min(h, int(ty) + 15)):
        for x in range(tx, head_end + 1):
            if a[y, x] and abs(y - (k * x + b)) < 11:
                head[y, x] = True
    patch = c.copy()
    patch[~head] = 0
    c[head] = 0
    # the shaft's cross-section just behind the head
    sx0 = int(pts[len(pts) // 2, 0])
    sy0 = k * sx0 + b
    nx, ny = -uy, ux
    prof = []
    for d in np.arange(-4, 4.01, 0.5):
        px = int(round(sx0 + nx * d))
        py = int(round(sy0 + ny * d))
        prof.append((d, c[py, px].copy() if a[py, px] else None))
    # the new socket, ext px further along the line; draw the shaft from the old one to it
    sock_old = (head_end, k * head_end + b)
    for s in np.arange(-ext, 0.01, 0.34):
        x0 = sock_old[0] + ux * s
        y0 = sock_old[1] + uy * s
        for d, col in prof:
            if col is None:
                continue
            px = int(round(x0 + nx * d))
            py = int(round(y0 + ny * d))
            if 0 <= px < w and 0 <= py < h:
                c[py, px] = col
    # the head, set back on at the new point
    ox = int(round(-ux * ext))
    oy = int(round(-uy * ext))
    ys, xs = np.nonzero(head)
    for y, x in zip(ys, xs):
        X, Y = x + ox, y + oy
        if 0 <= X < w and 0 <= Y < h:
            c[Y, X] = patch[y, x]
    return c


if __name__ == "__main__":
    main()
