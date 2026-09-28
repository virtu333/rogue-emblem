#!/usr/bin/env python3
"""How far does a planted foot slide with the advance contacts.py measured?

    python3 tools/cutscene/unwritten/motion/check_slip.py                 # every clip with contacts
    python3 tools/cutscene/unwritten/motion/check_slip.py edric_run --h 214
    python3 tools/cutscene/unwritten/motion/check_slip.py --frames <dir>  # rendered loco_test frames

Two checks.

1. Atlas (default). For every pair of drawings where a planted foot carried the advance,
   the boot is found again by a different metric than contacts.py used (sum of absolute
   differences of the greyscale boot, not correlation of mask and colour). The slip is the
   difference between that shift and the advance, in art px at height --h. A pair whose
   advance was filled in (a flight drawing) has no planted foot: its slip is listed apart,
   as the biggest error the average-of-neighbours can make there.
2. Frames (--frames DIR, the PNGs `render.mjs --piece loco_test --video` leaves in
   <video>.frames). In consecutive rendered frames the ground has shifted by g (measured
   from its tick marks) and the planted boot by b (template match of the boot in the
   pixels); the slip is b - g, in art px. This is what the viewer sees.
"""

import argparse
import math
import os
import sys

import cv2
import numpy as np

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import contacts as C  # noqa: E402

CLIPS = ['edric_run', 'sera_run', 'rowan_gallop', 'march', 'clash', 'edric_fall', 'edric_tumble']


def parabola(s, k):
    return k + C.subpixel(s, k)


def independent_shift(cells, i, j, foot, hs, cw, expect, ph, pw):
    """Shift (cell px) of the boot of `foot` (drawing i) into drawing j by greyscale SAD,
    searched around `expect`; None when the boot has nothing to match."""
    a_i = cells[i][..., 3] > 128
    p = C.foot_patch(a_i, foot, ph, pw)
    if p is None:
        return None
    x0, y0, x1, y1, comp = p

    def grey(c):
        g = cv2.cvtColor(c[..., :3], cv2.COLOR_RGB2GRAY).astype(np.float32)
        return g * (c[..., 3] > 128) + 255.0 * (c[..., 3] <= 128) * 0.0

    gi, gj = grey(cells[i]), grey(cells[j])
    t = gi[y0:y1, x0:x1]
    m = comp.astype(np.float32)
    best = None
    scores = {}
    R = int(0.06 * cw) + 4
    for dx in range(int(expect) - R, int(expect) + R + 1):
        for dy in range(-3, 4):
            xs, ys = x0 + dx, y0 + dy
            if xs < 0 or ys < 0 or xs + (x1 - x0) > gj.shape[1] or ys + (y1 - y0) > gj.shape[0]:
                continue
            w = gj[ys : ys + (y1 - y0), xs : xs + (x1 - x0)]
            wm = cells[j][ys : ys + (y1 - y0), xs : xs + (x1 - x0), 3] > 128
            # boot pixels must be opaque there; count the miss, and the grey difference on the boot
            miss = float((m * (~wm)).sum() + ((1 - m) * wm).sum() * 0.25)
            sad = float((np.abs(t - w) * m).sum())
            sc = sad / max(1.0, m.sum()) + 40.0 * miss / max(1.0, m.sum())
            if dx not in scores or sc < scores[dx]:
                scores[dx] = sc
            if best is None or sc < best[0]:
                best = (sc, dx)
    if best is None:
        return None
    dxs = sorted(scores)
    arr = np.array([scores[d] for d in dxs])
    k = int(np.argmin(arr))
    return dxs[k] + C.subpixel(-arr, k), float(arr[k])


def check_atlas(name, h, args):
    base, meta, cells = C.load(name)
    c = meta.get('contacts')
    if not c:
        print(f'{name}: no contacts block (run contacts.py)')
        return None
    n = meta['frames']
    cw, ch = meta['cell']
    loop = bool(meta.get('loop'))
    npairs = n if loop else n - 1
    sx = round(cw * h / ch) / cw
    masks = [C.silhouette(a[..., 3]) for a in cells]
    hs = float(np.median([np.ptp(np.nonzero(m)[0]) for m in masks]))
    ph, pw = int(round(0.10 * hs)), int(round(0.11 * cw))
    rows = []
    filled = []
    for p in range(npairs):
        j = (p + 1) % n
        adv = c['advance'][p]
        if not c['measured'][p]:
            filled.append((p, adv))
            continue
        pl = c['planted'][p]
        if pl is None:
            continue
        feet = C.detect_feet(masks[p], c['band'], cw, ch)
        foot = min(feet, key=lambda f: abs(f['x'] - pl[0]) + abs(f['y'] - pl[1]))
        r = independent_shift(cells, p, j, foot, hs, cw, -adv * (1 if c['facing'] > 0 else -1), ph, pw)
        if r is None:
            continue
        shift, sc = r
        indep = -shift  # body advance the independent match implies
        rows.append((p, adv, indep, (adv - indep) * sx))
    print(
        f"\n{name} @ h {h} (1 cell px = {sx:.3f} art px): stride {c['stride']} cell px, "
        f"facing {c['facing']:+d} ({c['facingBy']}), confidence {c['confidence']}"
    )
    print('  pair  advance  independent   slip (art px)')
    for p, a, ind, s in rows:
        print(f'  {p:3d}   {a:7.1f}   {ind:9.1f}   {s:+6.2f}')
    slips = [abs(s) for *_, s in rows]
    if filled:
        print('  filled pairs (no planted foot): ' + ', '.join(f'{p}:{a:.0f}' for p, a in filled))
    if slips:
        print(
            f'  max |slip| {max(slips):.2f} art px, mean {np.mean(slips):.2f}, over {len(slips)} planted pairs'
        )
    return slips


# ---------------------------------------------------------------- rendered frames


def check_frames(frames, args):
    """End to end on the frames of loco_test: ground shift vs boot shift, per consecutive pair."""
    import json

    # the shots of loco_test.js (keep in step with SPECS there)
    specs = [
        ('edric_follow', 'edric_run', 214, 4, 200, 1, 250),
        ('edric_static', 'edric_run', 214, 5, -100, 0, 330),
        ('sera_follow', 'sera_run', 200, 4, 210, 1, 230),
        ('rowan_follow', 'rowan_gallop', 190, 3, 200, 1, 420),
        ('march_static', 'march', 200, 4, 120, 0, 100),
    ]
    GROUND_Y = 232
    fps = 24
    beat = 0.4
    t0 = 0.0
    out = {}
    for name, clip, h, beats, x0, follow, speed in specs:
        base, meta, cells = C.load(clip)
        c = meta['contacts']
        n = meta['frames']
        cw, ch = meta['cell']
        sx = round(cw * h / ch) / cw
        sy = h / ch
        loop = bool(meta.get('loop'))
        cyc = n if loop else n - 1
        rate = speed / (abs(c['stride']) * sx * meta['fps'] / cyc)
        cum = np.concatenate([[0], np.cumsum(c['advance'])])
        ax = (c['anchor'][0] if 'anchor' in c else meta['anchor'][0]) * 0 + meta['anchor'][0] * (h / ch)
        ay = meta['anchor'][1] * sy
        w_layer = round(cw * h / ch)
        first = int(round(t0 * fps))
        last = int(round((t0 + beats * beat) * fps))
        t0 += beats * beat
        prev = None
        slips = []
        for f in range(first, last):
            lt = f / fps - (first / fps)
            k = math.floor(lt * meta['fps'] * rate)
            if meta['fps'] > 12:
                k = math.floor(math.floor(lt * meta['fps'] * rate / 2) * 2)
            i = k % n
            loops = k // n
            travel = (loops * c['stride'] + cum[i]) * sx
            world = x0 + travel
            ground = -follow * travel
            px = world + ground
            path = os.path.join(frames, f'{f:06d}.png')
            if not os.path.exists(path):
                continue
            img = cv2.imread(path)
            img = cv2.resize(img, (480, 270), interpolation=cv2.INTER_NEAREST).astype(np.float32)
            grey = img.mean(axis=2)
            strip = grey[GROUND_Y + 8 : GROUND_Y + 32].mean(axis=0)
            pl = c['planted'][i]
            cur = (f, i, k, px, strip, grey, pl, ground)
            if prev is not None and prev[2] != k:
                pf, pi, pk, ppx, pstrip, pgrey, ppl, pground = prev
                # the stance: the same foot planted in both drawings, carried by a measured pair
                if ppl is not None and pl is not None and pi != i and c['measured'][pi] and (pi + 1) % n == i:
                    # ground shift from the tick marks
                    dg = pground_shift(pstrip, strip)
                    # boot shift: template of the boot in the previous frame, found in this one
                    fx = int(round(ppx + ppl[0] * sx - ax))
                    fy = int(round(GROUND_Y + ppl[1] * sy - ay))
                    pw_ = int(round(0.11 * cw * sx))
                    ph_ = int(round(0.08 * h))
                    tmpl = pgrey[max(0, fy - ph_) : fy + 1, max(0, fx - pw_) : fx + pw_]
                    ok = tmpl.size > 0 and tmpl.std() > 4
                    if ok:
                        # the search follows the ground: the boot should have moved by dg
                        R = 40
                        xs0 = max(0, fx - pw_ - R + int(dg))
                        xs1 = min(480, fx + pw_ + R + int(dg))
                        win = grey[max(0, fy - ph_ - 3) : fy + 4, xs0:xs1]
                        if win.shape[0] >= tmpl.shape[0] and win.shape[1] >= tmpl.shape[1]:
                            r = cv2.matchTemplate(win, tmpl, cv2.TM_CCOEFF_NORMED)
                            m = np.unravel_index(np.argmax(r), r.shape)
                            score = float(r[m])
                            db = xs0 + m[1] - max(0, fx - pw_) + C.subpixel(r[m[0]], m[1])
                            if score > args.min_match:
                                slips.append((pf, f, db - dg, score, dg, db))
            prev = cur
        out[name] = slips
        print(f'\n{name}: rate {rate:.2f}, {len(slips)} planted pair(s) in the frames')
        for pf, f, s, sc, dg, db in slips:
            print(
                f'  frame {pf}->{f}: ground {dg:+6.1f}, boot {db:+6.1f}, slip {s:+5.2f} art px (match {sc:.2f})'
            )
        if slips:
            print(f'  max |slip| {max(abs(x[2]) for x in slips):.2f} art px')
    return out


def pground_shift(a, b):
    """Horizontal shift of the ground's ticks between two strips (b relative to a)."""
    a = a - a.mean()
    b = b - b.mean()
    best = None
    for d in range(-60, 61):
        if d >= 0:
            x, y = a[: len(a) - d], b[d:]
        else:
            x, y = a[-d:], b[: len(b) + d]
        s = float((x * y).sum() / (np.linalg.norm(x) * np.linalg.norm(y) + 1e-6))
        if best is None or s > best[0]:
            best = (s, d)
    return float(best[1])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('names', nargs='*', default=CLIPS)
    ap.add_argument('--h', type=float, default=214, help='figure height in art px')
    ap.add_argument("--frames", default=None, help="rendered loco_test frames (a .frames directory)")
    ap.add_argument(
        "--min-match", type=float, default=0.6, help="template match below which a frame pair is not trusted"
    )
    args = ap.parse_args()
    if args.frames:
        check_frames(args.frames, args)
        return 0
    summary = []
    for n in args.names:
        s = check_atlas(n, args.h, args)
        if s:
            summary.append((n, max(s), float(np.mean(s)), len(s)))
    print('\nclip            max |slip|  mean   planted pairs   (art px, independent boot match)')
    for n, mx, mean, k in summary:
        print(f'{n:<15s} {mx:7.2f}  {mean:6.2f}  {k:5d}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
