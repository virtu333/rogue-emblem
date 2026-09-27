#!/usr/bin/env python3
"""Turn a generated anime clip into pixel art: the "pixel trace" of The Far Side of the Glass.

The Veo clip is never shown. Each frame (on twos, 12 fps) is redrawn at 480x270 art
pixels in a fixed palette of a few dozen colours, the way a 16-bit intro was drawn:

  1. flatten   edge-preserving smoothing at 640x360, so cel regions are flat
  2. ink       the anime's own line work (dark thin strokes, found by a black-hat
               filter at full size) is kept as 1-pixel lines in the darkest ink
  3. palette   k-means over the whole clip (Lab), optionally snapped to the art
               bible's master ramps, so every frame of a shot shares one palette
  4. quantise  nearest palette colour, with hysteresis against the previous frame
               so flat areas do not flicker, and optional ordered (Bayer) dithering
               where the image is a smooth gradient (skies, glows, mist)
  5. tidy      single stray pixels are absorbed into their neighbours

Output: tools/cutscene/glass/px/<shot>.png, a sheet of frames whose grey value is
the palette index, and <shot>.json with the palette. The player maps indices to
colours at run time, so palette effects (fades through a ramp, flashes, the Roll's
red) are free.

  python3 tools/cutscene/glass/pixel.py mirror [--colors 24] [--snap 0.5] [--dither 0.5]
  python3 tools/cutscene/glass/pixel.py mirror --preview 3.0     # one frame, 4x PNG
  python3 tools/cutscene/glass/pixel.py title --still path.png   # a still plate
"""

import argparse
import json
import os
import subprocess
import sys

import cv2
import numpy as np
from scipy import ndimage

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..'))
SRC = os.path.join(ROOT, 'References/cutscene/glass')
OUT = os.path.join(ROOT, 'tools/cutscene/glass/px')

# The art bible's ramps (docs/art-direction/ART_BIBLE.md)
MASTER = """
07060b 0e0c14 16131e 211d2b 2e293a 403949 58505e 766b77 978b94 bdb0aa ddd0bd f4ecdb
2a170e 4f2c16 80461f b3702c dca044 f3cb6c fff0bd
22090f 44111c 6e1a28 9e2632 cc4038 ec7a5c
101a2e 1c2f4f 2c4c77 4574a0 77a5c6 b8d8e6
0f2622 1b4239 2d6450 4d8b66 86b27b c3d69a
170c24 2c1645 4a2270 763aa0 a863cc dcaaf0
1d1a12 34301d 4f4a2a 6e6a3b 938c55 b8ae78
1a1a20 2b2c33 40414a 5a5b63 7a7a80 a09e9f
""".split()

BAYER4 = (np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) + 0.5) / 16


def ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        return os.environ.get('FFMPEG', 'ffmpeg')


def read_frames(path, fps, t0=None, t1=None, size=(1280, 720)):
    W, H = size
    args = [ffmpeg(), '-loglevel', 'error']
    if t0 is not None:
        args += ['-ss', str(t0)]
    args += ['-i', path]
    if t1 is not None:
        args += ['-t', str(t1 - (t0 or 0))]
    args += ['-vf', f'fps={fps},scale={W}:{H}:flags=lanczos', '-f', 'rawvideo', '-pix_fmt',
             'bgr24', '-']
    raw = subprocess.run(args, check=True, capture_output=True).stdout
    n = len(raw) // (W * H * 3)
    return np.frombuffer(raw, np.uint8)[: n * W * H * 3].reshape(n, H, W, 3)


def to_lab(bgr):
    """uint8 BGR -> float Lab (L 0..100, a/b about -128..127)."""
    lab = cv2.cvtColor(bgr.astype(np.float32) / 255.0, cv2.COLOR_BGR2LAB)
    return lab


def hex_to_bgr(h):
    return np.array([int(h[4:6], 16), int(h[2:4], 16), int(h[0:2], 16)], np.uint8)


def flatten(bgr, o):
    """Edge-preserving smoothing so cel regions read as flat colour."""
    small = cv2.resize(bgr, (640, 360), interpolation=cv2.INTER_AREA)
    if o.meanshift:
        small = cv2.pyrMeanShiftFiltering(small, o.meanshift, o.meanshift_r)
    for _ in range(o.bilateral):
        small = cv2.bilateralFilter(small, 7, 28, 5)
    return small


def ink_mask(bgr, w, h, o):
    """The anime's line work: thin strokes darker than their surroundings."""
    g = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (o.ink_k, o.ink_k))
    bh = cv2.morphologyEx(g, cv2.MORPH_BLACKHAT, k).astype(np.float32)
    m = ((bh > o.ink) & (g < o.ink_max)).astype(np.float32)
    cov = cv2.resize(m, (w, h), interpolation=cv2.INTER_AREA)
    return cov > o.ink_cover


def fit_palette(samples_lab, o):
    data = samples_lab.reshape(-1, 3).astype(np.float32)
    rng = np.random.default_rng(1)
    if len(data) > 200000:
        data = data[rng.choice(len(data), 200000, replace=False)]
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 60, 0.2)
    _, _, centers = cv2.kmeans(data, o.colors, None, crit, 4, cv2.KMEANS_PP_CENTERS)
    if o.snap > 0:
        # pull each colour toward its nearest art-bible colour (1 = snap onto it); the
        # match weighs hue and chroma over lightness, so a cream stays a cream
        master = np.stack([hex_to_bgr(h) for h in MASTER])[None]
        mlab = to_lab(master)[0]
        wt = np.array([0.5, 1, 1], np.float32)
        d = (((centers[:, None, :] - mlab[None]) * wt) ** 2).sum(-1)
        near = mlab[d.argmin(1)]
        centers = centers + o.snap * (near - centers)
        if o.snap >= 1:
            centers = np.unique(centers, axis=0)
    # always keep a true ink
    ink = to_lab(np.array([[[11, 6, 7]]], np.uint8))[0, 0]
    if ((centers - ink) ** 2).sum(-1).min() > 36:
        centers = np.vstack([centers, ink])
    # order by lightness, so index 0 is the darkest (the ink)
    centers = centers[np.argsort(centers[:, 0])]
    return centers.astype(np.float32)


def lab_to_hex(lab):
    bgr = cv2.cvtColor(lab.reshape(1, -1, 3).astype(np.float32), cv2.COLOR_LAB2BGR)[0]
    bgr = np.clip(np.round(bgr * 255), 0, 255).astype(int)
    return ['%02x%02x%02x' % (c[2], c[1], c[0]) for c in bgr]


def quantise(lab, pal, prev, o, yy, xx):
    d = ((lab[:, :, None, :] - pal[None, None]) ** 2).sum(-1)  # h, w, k
    order = np.argsort(d, axis=-1)
    i1 = order[..., 0]
    i2 = order[..., 1]
    d1 = np.take_along_axis(d, i1[..., None], -1)[..., 0]
    d2 = np.take_along_axis(d, i2[..., None], -1)[..., 0]
    idx = i1
    if o.dither > 0:
        # ordered dither between the two nearest colours, where the image is smooth
        s1 = np.sqrt(d1)
        s2 = np.sqrt(d2)
        t = s1 / np.maximum(s1 + s2, 1e-6)  # 0 at colour 1, 0.5 halfway
        gap = np.sqrt(((pal[i1] - pal[i2]) ** 2).sum(-1))
        L = lab[:, :, 0]
        smooth = ndimage.uniform_filter(np.abs(ndimage.laplace(L)), 3) < o.smooth
        use = smooth & (gap < o.dither_gap) & (t * 2 * o.dither > BAYER4[yy % 4, xx % 4])
        idx = np.where(use, i2, i1)
    if prev is not None and o.hold > 0:
        dp = np.take_along_axis(d, prev[..., None], -1)[..., 0]
        best = np.take_along_axis(d, idx[..., None], -1)[..., 0]
        keep = np.sqrt(dp) < np.sqrt(best) + o.hold
        idx = np.where(keep, prev, idx)
    return idx.astype(np.uint8)


def tidy(idx, protect):
    """Absorb pixels that differ from at least 6 of their 8 neighbours' shared colour."""
    h, w = idx.shape
    p = np.pad(idx, 1, mode='edge')
    neigh = np.stack([p[1 + dy: 1 + dy + h, 1 + dx: 1 + dx + w]
                      for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dy or dx])
    out = idx.copy()
    # the most common neighbour value and its count
    best = np.zeros_like(idx)
    cnt = np.zeros(idx.shape, np.int32)
    for v in np.unique(neigh):
        c = (neigh == v).sum(0)
        m = c > cnt
        best[m] = v
        cnt[m] = c[m]
    fix = (cnt >= 6) & (best != idx) & ~protect
    out[fix] = best[fix]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('shot')
    ap.add_argument('--src', help='clip path (default References/cutscene/glass/clips/<shot>.mp4)')
    ap.add_argument('--still', help='convert this image to a one-frame plate')
    ap.add_argument('--w', type=int, default=480)
    ap.add_argument('--h', type=int, default=270)
    ap.add_argument('--fps', type=float, default=12)
    ap.add_argument('--colors', type=int, default=24)
    ap.add_argument('--snap', type=float, default=0.5,
                    help='pull the palette toward the art bible ramps (0 free .. 1 exact)')
    ap.add_argument('--dither', type=float, default=0.6)
    ap.add_argument('--dither-gap', type=float, default=22, help='max Lab distance to dither across')
    ap.add_argument('--smooth', type=float, default=1.2, help='laplacian threshold for "smooth"')
    ap.add_argument('--hold', type=float, default=5.0, help='hysteresis in Lab units')
    ap.add_argument('--ink', type=float, default=26)
    ap.add_argument('--ink-k', type=int, default=5, help='stroke kernel: strokes thinner than this')
    ap.add_argument('--ink-max', type=float, default=110)
    ap.add_argument('--ink-cover', type=float, default=0.28)
    ap.add_argument('--no-ink', action='store_true')
    ap.add_argument('--bilateral', type=int, default=2)
    ap.add_argument('--meanshift', type=int, default=0)
    ap.add_argument('--meanshift-r', type=int, default=16)
    ap.add_argument('--from', dest='t0', type=float)
    ap.add_argument('--to', dest='t1', type=float)
    ap.add_argument('--preview', type=float, help='write one frame (at this time, s) as a PNG')
    ap.add_argument('--video', action='store_true', help='write a 4x preview MP4 instead')
    ap.add_argument('--cols', type=int, default=8)
    o = ap.parse_args()

    if o.still:
        img = cv2.imread(o.still, cv2.IMREAD_COLOR)
        frames = cv2.resize(img, (1280, 720), interpolation=cv2.INTER_AREA)[None]
    else:
        src = o.src or os.path.join(SRC, 'clips', f'{o.shot}.mp4')
        frames = read_frames(src, o.fps, o.t0, o.t1)
    if o.preview is not None:
        i = min(len(frames) - 1, int(round((o.preview - (o.t0 or 0)) * o.fps)))
        sample = frames[:: max(1, len(frames) // 10)]
        frames = frames[i: i + 1]
    else:
        sample = frames[:: max(1, len(frames) // 10)]
    W, H = o.w, o.h
    yy, xx = np.mgrid[0:H, 0:W]

    def small_lab(f):
        return to_lab(cv2.resize(flatten(f, o), (W, H), interpolation=cv2.INTER_AREA))

    pal = fit_palette(np.stack([small_lab(f) for f in sample]), o)
    out = []
    prev = None
    for n, f in enumerate(frames):
        lab = small_lab(f)
        idx = quantise(lab, pal, prev, o, yy, xx)
        line = np.zeros_like(idx, bool) if o.no_ink else ink_mask(f, W, H, o)
        idx = tidy(idx, line)
        prev = idx.copy()
        if not o.no_ink:
            idx[line] = 0
        out.append(idx)
        if n % 24 == 0:
            print(f'  {o.shot} {n}/{len(frames)}', file=sys.stderr)

    hexes = lab_to_hex(pal)
    if o.preview is not None:
        lut = np.stack([hex_to_bgr(h) for h in hexes])
        img = lut[out[0]]
        big = cv2.resize(img, (W * 4, H * 4), interpolation=cv2.INTER_NEAREST)
        d = os.path.join(SRC, 'px_preview')
        os.makedirs(d, exist_ok=True)
        p = os.path.join(d, f'{o.shot}_{o.preview:.1f}.png')
        cv2.imwrite(p, big)
        print(p, len(hexes), 'colours')
        return

    if o.video:
        lut = np.stack([hex_to_bgr(h) for h in hexes])
        d = os.path.join(SRC, 'px_preview')
        os.makedirs(d, exist_ok=True)
        p = os.path.join(d, f'{o.shot}.mp4')
        enc = subprocess.Popen([ffmpeg(), '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt',
                                'bgr24', '-s', f'{W * 4}x{H * 4}', '-r', str(o.fps), '-i', '-',
                                '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', p],
                               stdin=subprocess.PIPE)
        for fr in out:
            enc.stdin.write(cv2.resize(lut[fr], (W * 4, H * 4),
                                       interpolation=cv2.INTER_NEAREST).tobytes())
        enc.stdin.close()
        enc.wait()
        print(p)
        return

    os.makedirs(OUT, exist_ok=True)
    cols = min(o.cols, len(out))
    rows = (len(out) + cols - 1) // cols
    sheet = np.zeros((rows * H, cols * W), np.uint8)
    for i, fr in enumerate(out):
        r, c = divmod(i, cols)
        sheet[r * H: (r + 1) * H, c * W: (c + 1) * W] = fr
    png = os.path.join(OUT, f'{o.shot}.png')
    cv2.imwrite(png, sheet, [cv2.IMWRITE_PNG_COMPRESSION, 9])
    meta = {'shot': o.shot, 'w': W, 'h': H, 'fps': o.fps, 'n': len(out), 'cols': cols,
            'palette': hexes}
    with open(os.path.join(OUT, f'{o.shot}.json'), 'w') as fh:
        json.dump(meta, fh)
    print(f'{png}  {len(out)} frames  {len(hexes)} colours  {os.path.getsize(png) / 1024:.0f} KB')


if __name__ == '__main__':
    main()
