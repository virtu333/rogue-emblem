#!/usr/bin/env python3
"""Turn a generated motion clip into frames the Unwritten Page engine can play.

    python3 tools/cutscene/unwritten/motion/clip.py <name> [options]

Reads References/cutscene/unwritten/clips/<name>.mp4 (from minimax.mjs) and writes
docs/art-direction/anime-op/motion/<name>.webp (an atlas of keyed frames) and
<name>.json (frame count, cell size, fps, the foot anchor, and per-frame joints when a
pose model is available).

  --fps 12          sample rate: anime moves on twos, so 12 drawings a second
  --from S --to S   the part of the clip to use (seconds)
  --loop            find the best seamless cycle inside [from, to] and keep only it
  --min-cycle S     shortest cycle to accept (default 0.35 s)
  --max-cycle S     longest cycle to accept (default 1.0 s)
  --height PX       frame height in the atlas (default 360: about 1.5x the largest size
                    the engine shows it at, so the paint stages are built from detail)
  --stabilise MODE  'body' (default: pin the torso and head horizontally, so a figure
                    runs in place while its legs swing), 'feet', 'centroid', or 'none'
                    (keep the clip's own travel)
  --pose            run a pose model and store joints per frame (needs mediapipe)
  --plate           a painted plate clip (no green): no key, no stabilising, no crop
  --quality Q       WebP quality of the atlas (default 84)

Green is keyed the same way as the cut-outs (a = 1 - clip((g - max(r, b) - 30) / 60),
despill, 1 px erode). Needs numpy, opencv-python, pillow, imageio-ffmpeg.
"""

import argparse
import json
import os
import subprocess
import sys

import numpy as np
import cv2
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '../../../..'))
CLIPS = os.path.join(ROOT, 'References/cutscene/unwritten/clips')
OUT = os.path.join(ROOT, 'docs/art-direction/anime-op/motion')


def ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        return 'ffmpeg'


def read_frames(path, fps, t0, t1):
    """Frames resampled to `fps`, as RGB uint8 arrays."""
    probe = subprocess.run([ffmpeg(), '-i', path], capture_output=True, text=True).stderr
    import re
    m = re.search(r'(\d{2,5})x(\d{2,5})[, ]', probe)
    w, h = int(m.group(1)), int(m.group(2))
    cmd = [ffmpeg(), '-v', 'error']
    if t0:
        cmd += ['-ss', str(t0)]
    cmd += ['-i', path]
    if t1:
        cmd += ['-t', str(t1 - (t0 or 0))]
    cmd += ['-vf', f'fps={fps}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']
    raw = subprocess.run(cmd, capture_output=True).stdout
    n = len(raw) // (w * h * 3)
    return [np.frombuffer(raw, np.uint8, w * h * 3, i * w * h * 3).reshape(h, w, 3) for i in range(n)]


def key(rgb):
    """Green key: RGBA with despill and a 1 px alpha erode."""
    f = rgb.astype(np.float32)
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    a = 1 - np.clip((g - np.maximum(r, b) - 30) / 60, 0, 1)
    g2 = np.minimum(g, np.maximum(r, b) + 10)
    out = np.dstack([r, g2, b, a * 255]).clip(0, 255).astype(np.uint8)
    al = out[..., 3]
    al = cv2.erode(al, np.ones((3, 3), np.uint8))
    # drop specks: keep components that are a real part of the figure
    n, lab, stats, _ = cv2.connectedComponentsWithStats((al > 128).astype(np.uint8))
    if n > 1:
        big = stats[1:, cv2.CC_STAT_AREA].max()
        keep = np.zeros(n, bool)
        keep[1:] = stats[1:, cv2.CC_STAT_AREA] > big * 0.01
        al = np.where(keep[lab], al, 0).astype(np.uint8)
    out[..., 3] = al
    return out


def anchor(al, mode):
    """(x, y) of the point to pin: the feet (bottom centre of the lowest rows) or centroid."""
    ys, xs = np.nonzero(al > 128)
    if len(ys) == 0:
        return None
    if mode == 'centroid':
        return float(xs.mean()), float(ys.mean())
    if mode == 'body':
        # the upper two thirds: torso and head, not the legs, which swing
        cut = ys.min() + (ys.max() - ys.min()) * 0.62
        m = ys < cut
        return float(xs[m].mean()), float(ys.max())
    y1 = ys.max()
    band = ys > y1 - (y1 - ys.min()) * 0.08
    return float(xs[band].mean()), float(y1)


def best_loop(frames, min_len, max_len):
    """(i, j): the pair of frames most alike, min_len <= j - i <= max_len; the cycle is
    i..j-1 (frame j is where it wraps back to i)."""
    small = [cv2.resize(f[..., 3], (64, 64), interpolation=cv2.INTER_AREA).astype(np.float32) for f in frames]
    best = (1e18, 0, len(frames))
    for i in range(len(frames)):
        for j in range(i + min_len, min(len(frames), i + max_len + 1)):
            d = float(np.abs(small[i] - small[j]).mean())
            if d < best[0]:
                best = (d, i, j)
    return best[1], best[2], best[0]


def pose_joints(frames):
    """Per-frame joints from MediaPipe (normalised to the cell), or None."""
    try:
        import mediapipe as mp
        from mediapipe.tasks import python as mpt
        from mediapipe.tasks.python import vision
    except ImportError:
        print('pose: mediapipe not installed, skipping')
        return None
    model = os.path.join(CLIPS, 'pose_landmarker_heavy.task')
    if not os.path.exists(model):
        import urllib.request
        url = ('https://storage.googleapis.com/mediapipe-models/pose_landmarker/'
               'pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task')
        urllib.request.urlretrieve(url, model)
    opts = vision.PoseLandmarkerOptions(base_options=mpt.BaseOptions(model_asset_path=model),
                                        running_mode=vision.RunningMode.IMAGE, num_poses=1)
    names = {0: 'nose', 11: 'shoulderL', 12: 'shoulderR', 13: 'elbowL', 14: 'elbowR', 15: 'wristL',
             16: 'wristR', 23: 'hipL', 24: 'hipR', 25: 'kneeL', 26: 'kneeR', 27: 'ankleL',
             28: 'ankleR', 31: 'toeL', 32: 'toeR'}
    out = []
    with vision.PoseLandmarker.create_from_options(opts) as lm:
        for f in frames:
            rgb = f[..., :3].copy()
            rgb[f[..., 3] < 128] = (0, 255, 0)
            res = lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)))
            if not res.pose_landmarks:
                out.append(None)
                continue
            p = res.pose_landmarks[0]
            out.append({n: [round(p[i].x, 4), round(p[i].y, 4), round(p[i].visibility, 2)] for i, n in names.items()})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('name')
    ap.add_argument('--fps', type=float, default=12)
    ap.add_argument('--from', dest='t0', type=float, default=0)
    ap.add_argument('--to', dest='t1', type=float, default=None)
    ap.add_argument('--loop', action='store_true')
    ap.add_argument('--min-cycle', type=float, default=0.35)
    ap.add_argument('--max-cycle', type=float, default=1.0)
    ap.add_argument('--height', type=int, default=360)
    ap.add_argument('--stabilise', default='body')
    ap.add_argument('--pose', action='store_true')
    ap.add_argument('--plate', action='store_true')
    ap.add_argument('--quality', type=int, default=84)
    ap.add_argument('--clip', default=None, help='source mp4 (default clips/<name>.mp4)')
    a = ap.parse_args()

    src = a.clip or os.path.join(CLIPS, f'{a.name}.mp4')
    raw = read_frames(src, a.fps, a.t0, a.t1)
    if a.plate:
        frames = [np.dstack([f, np.full(f.shape[:2], 255, np.uint8)]) for f in raw]
        a.stabilise = 'none'
    else:
        frames = [key(f) for f in raw]
    print(f'{len(frames)} frames at {a.fps} fps')
    loop = None
    if a.loop:
        i, j, d = best_loop(frames, max(2, round(a.min_cycle * a.fps)), round(a.max_cycle * a.fps))
        frames = frames[i:j]
        loop = [i, j]
        print(f'loop: frames {i}..{j - 1} ({len(frames)} drawings, {len(frames) / a.fps:.2f} s, score {d:.2f})')

    # stabilise: move every frame so its anchor sits where the first frame's does
    if a.stabilise != 'none':
        anchors = [anchor(f[..., 3], a.stabilise) for f in frames]
        good = [p for p in anchors if p]
        # smooth the anchor path a little so a foot lifting doesn't jolt the body
        ax = np.array([p[0] if p else good[0][0] for p in anchors])
        ay = np.array([p[1] if p else good[0][1] for p in anchors])
        if a.stabilise in ('feet', 'body'):
            ay[:] = np.median(ay)  # the ground stays level; only horizontal travel is removed
        ref = (ax.mean(), ay.mean())
        out = []
        for f, x, y in zip(frames, ax, ay):
            M = np.float32([[1, 0, ref[0] - x], [0, 1, ref[1] - y]])
            out.append(cv2.warpAffine(f, M, (f.shape[1], f.shape[0]), flags=cv2.INTER_LINEAR,
                                      borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0)))
        frames = out

    # crop to the union of all frames, with a margin; scale to the atlas height
    al = np.max(np.stack([f[..., 3] for f in frames]), axis=0)
    ys, xs = np.nonzero(al > 16)
    m = 0 if a.plate else 6
    x0, x1 = max(0, xs.min() - m), min(al.shape[1], xs.max() + m)
    y0, y1 = max(0, ys.min() - m), min(al.shape[0], ys.max() + m)
    s = a.height / (y1 - y0)
    cw, ch = round((x1 - x0) * s), a.height
    cells = [Image.fromarray(f[y0:y1, x0:x1]).resize((cw, ch), Image.LANCZOS) for f in frames]

    joints = pose_joints([np.array(c) for c in cells]) if a.pose else None

    cols = min(len(cells), max(1, int(4096 // cw)))
    rows = (len(cells) + cols - 1) // cols
    atlas = Image.new('RGBA', (cols * cw, rows * ch), (0, 0, 0, 0))
    for k, c in enumerate(cells):
        atlas.paste(c, ((k % cols) * cw, (k // cols) * ch))
    os.makedirs(OUT, exist_ok=True)
    atlas.save(os.path.join(OUT, f'{a.name}.webp'), 'WEBP', quality=a.quality, alpha_quality=100, method=6)
    # the foot anchor, in cell pixels (for placing the figure on the ground)
    fa = anchor(np.array(cells[0])[..., 3], 'feet')
    meta = {
        'name': a.name, 'frames': len(cells), 'cols': cols, 'cell': [cw, ch], 'fps': a.fps,
        'loop': bool(a.loop), 'source': os.path.relpath(src, ROOT), 'range': [a.t0, a.t1],
        'cycle': loop, 'plate': bool(a.plate), 'anchor': [round(fa[0], 1), round(fa[1], 1)] if fa else [cw / 2, ch],
    }
    if joints:
        meta['joints'] = joints
    with open(os.path.join(OUT, f'{a.name}.json'), 'w') as fh:
        json.dump(meta, fh, indent=1)
    kb = os.path.getsize(os.path.join(OUT, f'{a.name}.webp')) / 1024
    print(f'wrote motion/{a.name}.webp ({cols}x{rows} of {cw}x{ch}, {kb:.0f} KB) and .json')


if __name__ == '__main__':
    sys.exit(main())
