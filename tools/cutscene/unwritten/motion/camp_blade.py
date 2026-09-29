#!/usr/bin/env python3
"""Find the sword blade in each drawing of a clip atlas and store it as a line in the clip's JSON.

    python3 tools/cutscene/unwritten/motion/camp_blade.py camp_edric_fire [--debug out.png]

The painted blade is a thin bright diagonal that turns into a saw of pixels at game size (a 2-3 px
diagonal, lit orange by the rim). camp.js repaints it as a clean blade from the line found here:
`blade` in the JSON is one entry per drawing, [x0, y0, x1, y1, w] in cell px (x0, y0 the guard end,
x1, y1 the tip, w the painted blade's width), or null when the drawing has none.

Two cases. Put out toward the fire, the blade stands clear of the body and is found as a long thin
bright component. Resting across the knee it lies over the body, so a line is searched for: the
one with the most brightness along it against its two sides, near the resting position.
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, '../../../../docs/art-direction/anime-op/motion'))

name = sys.argv[1]
debug = sys.argv[sys.argv.index('--debug') + 1] if '--debug' in sys.argv else None
meta = json.load(open(f'{OUT}/{name}.json'))
full = Image.open(f'{OUT}/{name}.webp').convert('RGBA')
im = np.array(full).astype(np.float64)
cw, ch = meta['cell']
cols = meta['cols']


def cell_of(f):
    return im[(f // cols) * ch:(f // cols + 1) * ch, (f % cols) * cw:(f % cols + 1) * cw]


def clear_blade(cell):
    """The long thin bright component of a drawing (the sword held out), or None."""
    a = cell[..., 3] > 128
    mn = cell[..., :3].min(-1)
    mx = cell[..., :3].max(-1)
    S = a & (mn > 140) & ((mx - mn) < 82)
    S = ndimage.binary_opening(S, structure=np.ones((2, 2)))
    lab, n = ndimage.label(S, structure=np.ones((3, 3)))
    best = None
    for k in range(1, n + 1):
        ys, xs = np.where(lab == k)
        if len(xs) < 250:
            continue
        pts = np.stack([xs, ys], 1).astype(float)
        c = pts.mean(0)
        _, s, vt = np.linalg.svd(pts - c, full_matrices=False)
        d = vt[0]
        t = (pts - c) @ d
        length = t.max() - t.min()
        width = len(xs) / max(length, 1)
        if length > 120 and length / max(s[1] / np.sqrt(len(xs)) * 3.4, 1) > 6 and (best is None or length > best[0]):
            best = (length, c, d, t, width)
    if best is None:
        return None
    _, c, d, t, width = best
    lo, hi = np.percentile(t, [0.4, 99.6])
    p0, p1 = c + d * lo, c + d * hi
    if p1[1] < p0[1]:
        p0, p1 = p1, p0
    return [float(p0[0]), float(p0[1]), float(p1[0]), float(p1[1]), float(width)]


def lum_of(cell):
    return (0.3 * cell[..., 0] + 0.59 * cell[..., 1] + 0.11 * cell[..., 2]) * (cell[..., 3] > 128)


def bil(L, x, y):
    x = np.clip(x, 0, cw - 1.001)
    y = np.clip(y, 0, ch - 1.001)
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    fx, fy = x - x0, y - y0
    return (L[y0, x0] * (1 - fx) * (1 - fy) + L[y0, x0 + 1] * fx * (1 - fy) + L[y0 + 1, x0] * (1 - fx) * fy + L[y0 + 1, x0 + 1] * fx * fy)


def resting_blade(cell, guess, ang=7, shift=14, along=(-8, 0, 8)):
    """Search a line near `guess` ([x0, y0, x1, y1]) for the blade lying over the body."""
    L = lum_of(cell)
    gx0, gy0, gx1, gy1 = guess
    best = None
    ang0 = np.arctan2(gy1 - gy0, gx1 - gx0)
    for dth in np.radians(np.arange(-ang, ang + 0.01, 0.75 if ang > 5 else 0.5)):
        th = ang0 + dth
        d = np.array([np.cos(th), np.sin(th)])
        n = np.array([-d[1], d[0]])
        for sh in np.arange(-shift, shift + 0.1, 1.0):
            for lshift in along:
                # a segment through the guessed centre, shifted sideways and along
                cx = (gx0 + gx1) / 2 + n[0] * sh + d[0] * lshift
                cy = (gy0 + gy1) / 2 + n[1] * sh + d[1] * lshift
                half = np.hypot(gx1 - gx0, gy1 - gy0) / 2
                ts = np.linspace(-half, half, 40)
                px = cx + d[0] * ts
                py = cy + d[1] * ts
                mid = bil(L, px, py)
                side = 0.5 * (bil(L, px + n[0] * 11, py + n[1] * 11) + bil(L, px - n[0] * 11, py - n[1] * 11))
                score = np.mean(np.minimum(mid - side, 90))
                if best is None or score > best[0]:
                    best = (score, cx, cy, d, half)
    _, cx, cy, d, half = best
    # extents: from the outer end walk inward while the line is bright against its sides
    n = np.array([-d[1], d[0]])
    ts = np.arange(-half - 30, half + 30, 1.0)
    px, py = cx + d[0] * ts, cy + d[1] * ts
    mid = bil(L, px, py)
    side = 0.5 * (bil(L, px + n[0] * 11, py + n[1] * 11) + bil(L, px - n[0] * 11, py - n[1] * 11))
    ok = (mid - side) > 28
    idx = np.where(ok)[0]
    if len(idx) < 20:
        t0, t1 = -half, half
    else:
        # the longest run of bright samples
        runs, start = [], idx[0]
        for a, b in zip(idx[:-1], idx[1:]):
            if b - a > 4:
                runs.append((start, a))
                start = b
        runs.append((start, idx[-1]))
        s0, s1 = max(runs, key=lambda r: r[1] - r[0])
        t0, t1 = ts[s0], ts[s1]
    p0 = np.array([cx, cy]) + d * t0
    p1 = np.array([cx, cy]) + d * t1
    return [float(p0[0]), float(p0[1]), float(p1[0]), float(p1[1]), 12.0], best[0]


KEYS = json.loads(sys.argv[sys.argv.index('--keys') + 1]) if '--keys' in sys.argv else None
if KEYS:
    # a clip whose sword is clear of the body all through: rough keyframes by eye
    # ([frame, x0, y0, x1, y1] in cell px), interpolated, then each drawing searched near its guess
    KEYS.sort()
    blades = [None] * meta['frames']
    for f in range(meta['frames']):
        lo = max((k for k in KEYS if k[0] <= f), default=KEYS[0], key=lambda k: k[0])
        hi = min((k for k in KEYS if k[0] >= f), default=KEYS[-1], key=lambda k: k[0])
        u = 0 if hi[0] == lo[0] else (f - lo[0]) / (hi[0] - lo[0])
        g = [lo[i] + (hi[i] - lo[i]) * u for i in range(1, 5)]
        r = resting_blade(cell_of(f), g, ang=6, shift=9, along=(-6, 0, 6))[0]
        blades[f] = r
    meta['blade'] = [[round(v, 1) for v in b] for b in blades]
    json.dump(meta, open(f'{OUT}/{name}.json', 'w'), indent=1)
    print(f'{name}: {len(blades)} blades from {len(KEYS)} keys')
    if debug:
        pick = [int(x) for x in np.linspace(0, meta['frames'] - 1, 10)]
        tiles = []
        for f in pick:
            c = full.crop(((f % cols) * cw, (f // cols) * ch, (f % cols + 1) * cw, (f // cols + 1) * ch))
            bg = Image.new('RGBA', c.size, (70, 70, 90, 255))
            bg.alpha_composite(c)
            d = ImageDraw.Draw(bg)
            b = meta['blade'][f]
            d.line([(b[0], b[1]), (b[2], b[3])], fill=(0, 255, 0, 255), width=1)
            d.text((4, 4), str(f), fill=(255, 255, 255, 255))
            tiles.append(bg.crop((0, 150, cw, ch)).convert('RGB'))
        per = 5
        sheet = Image.new('RGB', (cw * per, (ch - 150) * 2))
        for k, t in enumerate(tiles):
            sheet.paste(t, ((k % per) * cw, (k // per) * (ch - 150)))
        sheet.save(debug)
    sys.exit(0)

blades = [None] * meta['frames']
clear = [clear_blade(cell_of(f)) for f in range(meta['frames'])]
found = [f for f, b in enumerate(clear) if b]
REST = [432.0, 263.0, 568.0, 318.0]
# the drawings where the sword is a fast smear (going up, coming down) keep their painted blade
SMEAR = set(meta.get('blade_smear', [37, 53, 54, 55]))
for f in range(meta['frames']):
    if f in SMEAR:
        continue
    if clear[f] and 38 <= f <= 56:
        blades[f] = clear[f]
        continue
    guess = REST
    if f == 57 and clear[56]:
        c = clear[56]
        guess = [(c[0] + REST[0]) / 2, (c[1] + REST[1]) / 2, (c[2] + REST[2]) / 2, (c[3] + REST[3]) / 2]
    blades[f] = resting_blade(cell_of(f), guess)[0]

meta['blade'] = [[round(v, 1) for v in b] if b else None for b in blades]
meta['blade_smear'] = sorted(SMEAR)
json.dump(meta, open(f'{OUT}/{name}.json', 'w'), indent=1)
print(f'{name}: {sum(b is not None for b in blades)} blades, {sorted(SMEAR)} left painted')

if debug:
    pick = [int(x) for x in np.linspace(0, meta['frames'] - 1, 10)] + [36, 37, 53, 54, 55]
    tiles = []
    for f in pick:
        c = full.crop(((f % cols) * cw, (f // cols) * ch, (f % cols + 1) * cw, (f // cols + 1) * ch))
        bg = Image.new('RGBA', c.size, (70, 70, 90, 255))
        bg.alpha_composite(c)
        d = ImageDraw.Draw(bg)
        b = meta['blade'][f]
        if b:
            d.line([(b[0], b[1]), (b[2], b[3])], fill=(0, 255, 0, 255), width=1)
        d.text((4, 4), str(f), fill=(255, 255, 255, 255))
        tiles.append(bg.convert('RGB'))
    per = 5
    rows = (len(tiles) + per - 1) // per
    sheet = Image.new('RGB', (cw * per, ch * rows))
    for k, t in enumerate(tiles):
        sheet.paste(t, ((k % per) * cw, (k // per) * ch))
    sheet.save(debug)
