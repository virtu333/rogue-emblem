#!/usr/bin/env python3
"""Hand-fix the Warden's guard in the warden_thrust clip (drawings 0-7).

MiniMax was given a guard pose whose painted spear had been pasted across the figure
(the original guard held only a short stub). The model kept both: a level spear floating
above his hands and the stub he grips. This rebuilds the guard with one spear:

  1. the floating spear is removed: where it crossed open air the pixels go transparent,
     where it crossed his body the body is inpainted from above and below;
  2. the stub he grips becomes the whole spear: the shaft is extended along the stub's
     own line through both gauntlets, back past his hip to the butt, forward to a point,
     and the clip's own painted spearhead is rotated onto it.

Run once; it rewrites docs/art-direction/anime-op/motion/warden_thrust.webp in place
(git holds the original). Cell coordinates are the atlas's (300 px tall cells).
"""

import json
import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[4]
ATLAS = ROOT / "docs/art-direction/anime-op/motion/warden_thrust.webp"
META = json.loads((ATLAS.with_suffix(".json")).read_text())
CW, CH = META["cell"]
COLS = META["cols"]

# the floating spear: a band along y = 91 from its point to its butt (cell px)
LVL_Y, LVL_HALF, LVL_X0, LVL_X1 = 91.5, 4.6, 294, 526
# the stub he grips runs through these two points; the rebuilt spear follows its line
STUB_A = (369.0, 140.0)  # its forward (left) end, just ahead of the lead gauntlet
STUB_B = (455.0, 124.0)  # just behind the rear gauntlet
# a spear of his full length (about 2.4 m, as he carries it upright and in the thrust):
# the point well ahead of his lead foot, the butt behind his hip
TIP_X, BUTT_X = 150.0, 548.0
# the painted head of the floating spear (point at the left, socket at the right)
HEAD_BOX = (297, 82, 354, 101)  # x0, y0, x1, y1
HEAD_SOCKET = (353.0, 91.0)
HEAD_POINT = (299.0, 91.5)


def cell(atlas, i):
    x0 = (i % COLS) * CW
    y0 = (i // COLS) * CH
    return x0, y0


def line_y(x):
    (ax, ay), (bx, by) = STUB_A, STUB_B
    return ay + (by - ay) * (x - ax) / (bx - ax)


def fix(c):
    """c: HxWx4 uint8 RGBA of one cell. Returns the fixed cell."""
    h, w = c.shape[:2]
    out = c.copy()
    head = c[HEAD_BOX[1] : HEAD_BOX[3], HEAD_BOX[0] : HEAD_BOX[2]].copy()

    # 1. remove the floating spear
    band = np.zeros((h, w), np.uint8)
    for x in range(LVL_X0, LVL_X1 + 1):
        half = LVL_HALF + (5 if x < 358 else 0)  # the head is wider than the shaft
        band[int(LVL_Y - half) : int(math.ceil(LVL_Y + half)) + 1, x] = 1
    alpha = c[:, :, 3]
    above = alpha[int(LVL_Y - LVL_HALF - 3)]
    below = alpha[int(LVL_Y + LVL_HALF + 3)]
    body = np.zeros_like(band)
    for x in range(w):
        if above[x] > 128 and below[x] > 128:
            body[:, x] = 1
    inpaint = (band & body).astype(np.uint8)
    clear = (band & (1 - body)).astype(bool)
    # over the body: each column is filled by mirroring the cloth just above the band
    # into its top half and the cloth just below into its bottom half (keeps the paint's
    # grain, where an inpaint blurs), then the seam is softened by one pixel
    for x in range(w):
        ys = np.nonzero(inpaint[:, x])[0]
        if len(ys) == 0:
            continue
        top, bot = ys[0], ys[-1]
        mid = (top + bot) / 2
        for y in range(top, bot + 1):
            src = top - 1 - (y - top) if y <= mid else bot + 1 + (bot - y)
            src = min(h - 1, max(0, src))
            out[y, x, :3] = c[src, x, :3]
            out[y, x, 3] = 255
        m = int(round(mid))
        if 0 < m < h - 1:
            out[m, x, :3] = (out[m - 1, x, :3].astype(int) + out[m + 1, x, :3].astype(int)) // 2
    out[clear] = 0
    # the old head's fringe (soft edge pixels outside the band), in open air ahead of him
    out[78:107, 294:371] = 0

    # 2. the shaft along the stub's line, outside the stretch the gauntlets already hold
    dx = BUTT_X - TIP_X
    dy = line_y(BUTT_X) - line_y(TIP_X)
    L = math.hypot(dx, dy)
    ux, uy = dx / L, dy / L
    nx, ny = -uy, ux  # the normal (pointing down-right of the shaft: its shadow side)
    WOOD = np.array([118, 80, 54])
    WOOD_HI = np.array([170, 128, 98])
    WOOD_LO = np.array([62, 40, 26])
    INK = np.array([26, 17, 10])
    head_len = HEAD_SOCKET[0] - HEAD_POINT[0]
    socket_x = TIP_X + head_len * ux
    for x0 in np.arange(socket_x - 1, BUTT_X, 0.25):
        if STUB_A[0] - 1 < x0 < STUB_B[0] + 3:
            continue  # the painted stub and the gauntlets over it stay as painted
        y0 = line_y(x0)
        for d in np.arange(-2.4, 2.41, 0.25):
            px = int(round(x0 + nx * d))
            py = int(round(y0 + ny * d))
            if not (0 <= px < w and 0 <= py < h):
                continue
            a = abs(d)
            col = INK if a > 1.7 else (WOOD_HI if d < -0.6 else WOOD_LO if d > 0.8 else WOOD)
            out[py, px, :3] = col
            out[py, px, 3] = 255
    # the butt cap
    bx, by = BUTT_X, line_y(BUTT_X)
    for yy in range(int(by) - 3, int(by) + 4):
        for xx in range(int(bx) - 3, int(bx) + 4):
            if (xx - bx) ** 2 + (yy - by) ** 2 <= 7 and 0 <= xx < w and 0 <= yy < h:
                out[yy, xx, :3] = WOOD_HI if yy < by else WOOD_LO
                out[yy, xx, 3] = 255

    # 3. the painted head, rotated onto the new line, its socket at the shaft's end
    ang = math.degrees(math.atan2(uy, ux))  # the shaft's angle (butt direction)
    himg = Image.fromarray(head, "RGBA")
    # pad so the rotation keeps the socket at a known place (the pad's centre)
    sx = HEAD_SOCKET[0] - HEAD_BOX[0]
    sy = HEAD_SOCKET[1] - HEAD_BOX[1]
    pad = 70
    canvas = Image.new("RGBA", (2 * pad, 2 * pad), (0, 0, 0, 0))
    canvas.paste(himg, (int(pad - sx), int(pad - sy)), himg)
    rot = canvas.rotate(-ang, resample=Image.BICUBIC, center=(pad, pad))
    ra = np.array(rot)
    sock = (socket_x, line_y(socket_x))
    ox = int(round(sock[0] - pad))
    oy = int(round(sock[1] - pad))
    for yy in range(ra.shape[0]):
        for xx in range(ra.shape[1]):
            if ra[yy, xx, 3] < 110:
                continue
            X, Y = ox + xx, oy + yy
            if 0 <= X < w and 0 <= Y < h:
                out[Y, X, :3] = ra[yy, xx, :3]
                out[Y, X, 3] = 255
    return out


def main():
    im = np.array(Image.open(ATLAS).convert("RGBA"))
    for i in range(0, 8):
        x0, y0 = cell(im, i)
        im[y0 : y0 + CH, x0 : x0 + CW] = fix(im[y0 : y0 + CH, x0 : x0 + CW])
    Image.fromarray(im, "RGBA").save(ATLAS, "WEBP", quality=88, alpha_quality=100, method=6)
    print(f"fixed drawings 0-7 of {ATLAS.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
