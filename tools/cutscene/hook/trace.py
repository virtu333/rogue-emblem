#!/usr/bin/env python3
"""Trace a generated clip into drawings: the rotoscope step of "The Roll".

The Veo clip is never shown. Each frame (on twos, 12 fps) is reduced to a few
layers of filled polygons that the player redraws in its own hand:

  fg   the figures' silhouette (a foreground matte, rembg / IS-Net)
  t1   figure midtones            t2  figure lights        t3  figure highlights
  ln   ink lines inside the figures (difference of Gaussians on the dark side
       of edges, after local contrast equalisation)
  gl   glow: the brightest light anywhere (fire, candle, corona, spell)
  b1   background shadows-lifted  b2  background lights  (optional, simplified)

Tone thresholds are percentiles of the whole clip's figure luminance, not per
frame, so tones hold still while the drawing boils.

Output: tools/cutscene/hook/traces/<shot>.json.gz, polygon coordinates in half
pixels of a 960x540 frame (ints 0..1920 x 0..1080), each polygon a flat list
[x0, y0, dx1, dy1, ...] (first point absolute, then deltas).

  python3 tools/cutscene/hook/trace.py hearth [--bg] [--lines 0.02] [--glow 0.8]
  python3 tools/cutscene/hook/trace.py hearth --preview 3.0   # one frame as a PNG
"""

import argparse
import gzip
import json
import os
import subprocess
import sys

import cv2
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..'))
CLIPS = os.path.join(ROOT, 'References/cutscene/hook/clips')
OUT = os.path.join(ROOT, 'tools/cutscene/hook/traces')
W, H = 960, 540


def ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        return os.environ.get('FFMPEG', 'ffmpeg')


def read_frames(path, fps, t0=None, t1=None):
    args = [ffmpeg(), '-loglevel', 'error']
    if t0 is not None:
        args += ['-ss', str(t0)]
    args += ['-i', path]
    if t1 is not None:
        args += ['-t', str(t1 - (t0 or 0))]
    args += ['-vf', f'fps={fps},scale={W}:{H}:flags=area', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-']
    raw = subprocess.run(args, check=True, capture_output=True).stdout
    n = len(raw) // (W * H * 3)
    return np.frombuffer(raw, np.uint8)[: n * W * H * 3].reshape(n, H, W, 3)


class Matte:
    def __init__(self):
        from rembg import new_session
        self.session = new_session('isnet-general-use')

    def __call__(self, bgr):
        from rembg import remove
        return remove(bgr, session=self.session, only_mask=True).astype(np.float32) / 255.0


def polys(mask, eps=0.8, min_area=6.0):
    """Filled mask -> outer and hole contours (even-odd fill), delta-encoded."""
    m = mask.astype(np.uint8)
    if not m.any():
        return []
    cs, _ = cv2.findContours(m, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    out = []
    for c in cs:
        if abs(cv2.contourArea(c)) < min_area:
            continue
        c = cv2.approxPolyDP(c, eps, True).reshape(-1, 2)
        if len(c) < 3:
            continue
        pts = np.round(c * 2).astype(np.int32)
        d = np.diff(pts, axis=0)
        flat = [int(pts[0, 0]), int(pts[0, 1])] + d.reshape(-1).tolist()
        out.append(flat)
    return out


def clean(mask, open_px=2, min_area=10):
    m = mask.astype(np.uint8)
    if open_px:
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((open_px, open_px), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    keep = np.zeros(n, bool)
    keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= min_area
    return keep[lab]


def analyse(frame, fg, o):
    lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
    L = lab[:, :, 0]
    lum = cv2.GaussianBlur(L.astype(np.float32) / 255.0, (0, 0), 1.2)
    cl = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(4, 4)).apply(L).astype(np.float32) / 255.0
    g = cv2.bilateralFilter(cl, 9, 0.12, 5)
    a = cv2.GaussianBlur(g, (0, 0), o.sigma)
    b = cv2.GaussianBlur(g, (0, 0), o.sigma * 1.6)
    dog = b - a
    return lum, dog


def trace_frame(frame, fgm, th, o):
    lum, dog = analyse(frame, fgm, o)
    fg = fgm > 0.5
    fg = clean(fg, 3, 60)
    inner = cv2.erode(fg.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    layers = {'fg': polys(fg, 1.0, 40)}
    for k, t in (('t1', th[0]), ('t2', th[1]), ('t3', th[2])):
        layers[k] = polys(clean(fg & (lum > t), 2, 14), 0.8, 10)
    layers['ln'] = polys(clean(inner & (dog > o.lines), 0, 10), 0.6, 5)
    if o.glow < 1:
        gl = clean(lum > o.glow, 2, 12)
        layers['gl'] = polys(gl, 1.0, 10)
    if o.bg:
        bl = cv2.GaussianBlur(lum, (0, 0), 3)
        bg = ~cv2.dilate(fg.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
        layers['b1'] = polys(clean(bg & (bl > th[3]), 3, 80), 1.6, 60)
        layers['b2'] = polys(clean(bg & (bl > th[4]), 3, 60), 1.6, 40)
    return layers


def thresholds(frames, mattes, o):
    fl, bl = [], []
    for f, m in zip(frames[:: max(1, len(frames) // 12)], mattes[:: max(1, len(frames) // 12)]):
        lum = cv2.cvtColor(f, cv2.COLOR_BGR2LAB)[:, :, 0].astype(np.float32) / 255.0
        fl.append(lum[m > 0.5])
        bl.append(lum[m <= 0.5])
    fl = np.concatenate(fl) if fl else np.array([0.5])
    bl = np.concatenate(bl) if bl else np.array([0.5])
    if fl.size < 100:
        fl = np.array([0.2, 0.5, 0.8])
    p = [float(np.percentile(fl, q)) for q in o.tones]
    q = [float(np.percentile(bl, x)) for x in o.bgtones]
    return p + q


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('shot')
    ap.add_argument('--fps', type=float, default=12)
    ap.add_argument('--lines', type=float, default=0.02, help='DoG threshold for ink lines')
    ap.add_argument('--sigma', type=float, default=1.2)
    ap.add_argument('--glow', type=float, default=0.82, help='luminance for glow (1 = none)')
    ap.add_argument('--tones', type=float, nargs=3, default=[30, 66, 92])
    ap.add_argument('--bg', action='store_true', help='keep simplified background tones')
    ap.add_argument('--bgtones', type=float, nargs=2, default=[70, 93])
    ap.add_argument('--from', dest='t0', type=float)
    ap.add_argument('--to', dest='t1', type=float)
    ap.add_argument('--preview', type=float, help='write one traced frame at this time (s)')
    o = ap.parse_args()

    src = os.path.join(CLIPS, f'{o.shot}.mp4')
    frames = read_frames(src, o.fps, o.t0, o.t1)
    matte = Matte()
    if o.preview is not None:
        i = min(len(frames) - 1, int(round((o.preview - (o.t0 or 0)) * o.fps)))
        frames = frames[i: i + 1]
    mattes = []
    for i, f in enumerate(frames):
        mattes.append(matte(f))
        if i % 24 == 0:
            print(f'  matte {i}/{len(frames)}', file=sys.stderr)
    th = thresholds(frames, mattes, o)
    out = [trace_frame(f, m, th, o) for f, m in zip(frames, mattes)]
    doc = {'shot': o.shot, 'w': W, 'h': H, 'fps': o.fps, 'n': len(out), 'thresholds': th,
           'frames': out}
    if o.preview is not None:
        path = os.path.join(ROOT, 'References/cutscene/hook', f'preview_{o.shot}.json')
        with open(path, 'w') as fh:
            json.dump(doc, fh)
        cv2.imwrite(path.replace('.json', '_src.png'), frames[0])
        print(path)
        return
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f'{o.shot}.json.gz')
    with gzip.open(path, 'wt', compresslevel=9) as fh:
        json.dump(doc, fh, separators=(',', ':'))
    print(f'{path}  {len(out)} frames  {os.path.getsize(path) / 1024:.0f} KB  thresholds {th}')


if __name__ == '__main__':
    main()
