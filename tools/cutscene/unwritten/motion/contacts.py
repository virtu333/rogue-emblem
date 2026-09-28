#!/usr/bin/env python3
"""Find where the feet are in a generated motion clip, and how far the body must travel.

    python3 tools/cutscene/unwritten/motion/contacts.py edric_run sera_run rowan_gallop march
    python3 tools/cutscene/unwritten/motion/contacts.py clash --band 0.2 --no-write

clip.py stabilises a clip on the body, so a runner runs on the spot and the planted foot
slides backward through the cell. In the world the planted foot is fixed to the ground and
the body advances. This reads a clip's atlas (docs/art-direction/anime-op/motion/<name>.webp
and .json) and writes a `contacts` block back into the same JSON: the ground speed that
exactly matches the planted foot, drawing by drawing. engine/locomotion.js turns it into
travel.

How it works
  1. Feet. Per drawing, the connected components of the silhouette in its bottom band
     (--band, a fraction of the silhouette's height) are the feet (or hooves, or the boots
     of a marching file). Each one's contact point is the centre of its lowest rows.
     A wide component (two feet in one blob) is split at the dip of its bottom profile.
  2. Planted feet. A foot is on the ground when it is within --ground-tol of the ground
     line (the level the lowest point of most drawings sits at). A planted foot's shift
     from one drawing to the next is found by registering its boot (normalised
     cross-correlation of the drawing's own pixels and mask, sub-pixel), not by comparing
     lowest points: a rolling foot's lowest point walks from heel to toe while the foot
     itself stays still on the ground, and would be read as a slide.
  3. Advance. advance[i] is the body's travel from drawing i to i+1 in cell px, +x the
     right of the cell as drawn: -(planted foot's shift). Every foot on the ground votes
     with its correlation curve over the possible advances, forwards from i and
     backwards from i+1 (so at a change of feet the newly planted one counts), and the
     peak wins: a horse's four hooves, a marching file's many boots, the dominant
     motion. A foot that does not move against the body is reaching for the ground, not
     planted. Weaker matches count only where they agree with the sure ones; a boot that
     has rotated too far to match (toe-off) is followed by its lowest point. Drawings
     with no planted foot (the flight of a run) take the average of the nearest measured
     neighbours.
  4. Facing. Whichever way the planted feet make the better case (score times speed).
     A horse's reaching forelegs and a marching file's shuffle can fool it: the block
     says `facingBy` and --facing overrides.
  5. Footfalls. A foot the stance carries, touching the ground (--touch-tol) in drawing i
     with no touching foot near where it would have been in i-1: dust and splashes.

The block written (`contacts`):
  ground   the ground line in cell px (y)
  band     the bottom band used
  facing   +1 the body moves right as drawn, -1 left; facingBy how; confidence 0..1
  advance  n numbers, cell px from drawing i to i+1 (the last wraps to 0 in a loop)
  measured n flags: 1 measured from a planted foot, 0 filled in (flight)
  stride   total advance over one loop
  feet     per drawing: [[x, y, id, ground], ...] (lowest points, cell px)
  planted  per drawing: [x, y, id] of the foot on the ground that the advance follows, or null
  footfalls  [{i, id, x, y}]
  flight   drawings with no foot on the ground

Overrides: --band, --facing, --flight i,j, --ground Y, --ground-tol F, --min-score S,
--smooth K (blend advances with their neighbours: 0 = exact, the default), --debug FILE.
Needs numpy, opencv-python, pillow.
"""

import argparse
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '../../../..'))
OUT = os.path.join(ROOT, 'docs/art-direction/anime-op/motion')


# ---------------------------------------------------------------- loading


def load(name):
    """(meta, cells): the JSON and every drawing as an RGBA array."""
    base = name if os.path.isabs(name) else os.path.join(OUT, name)
    if base.endswith('.json') or base.endswith('.webp'):
        base = base.rsplit('.', 1)[0]
    with open(base + '.json') as fh:
        meta = json.load(fh)
    atlas = np.array(Image.open(base + '.webp').convert('RGBA'))
    cw, ch = meta['cell']
    cells = []
    for i in range(meta['frames']):
        x, y = (i % meta['cols']) * cw, (i // meta['cols']) * ch
        cells.append(atlas[y : y + ch, x : x + cw])
    return base, meta, cells


# ---------------------------------------------------------------- feet


def silhouette(alpha):
    """Boolean silhouette without stray specks."""
    mk = alpha > 128
    n, lab, st, _ = cv2.connectedComponentsWithStats(mk.astype(np.uint8), connectivity=8)
    if n > 2:
        big = st[1:, cv2.CC_STAT_AREA].max()
        keep = np.zeros(n, bool)
        keep[1:] = st[1:, cv2.CC_STAT_AREA] > big * 0.01
        mk = keep[lab]
    return mk


def detect_feet(mk, band, cw, ch, max_feet=4):
    """Feet of one drawing: [{x, y, area, box}] sorted left to right.

    x, y is the contact point (the centre of the component's lowest rows)."""
    ys, xs = np.nonzero(mk)
    if len(ys) == 0:
        return []
    ymin, ymax = ys.min(), ys.max()
    hs = ymax - ymin
    y0 = int(ymax - band * hs)
    reg = np.zeros(mk.shape, np.uint8)
    reg[y0:] = mk[y0:]
    n, lab, st, _ = cv2.connectedComponentsWithStats(reg, connectivity=8)
    out = []
    thin = max(2, int(0.006 * hs))
    for k in range(1, n):
        area = st[k, cv2.CC_STAT_AREA]
        if area < 0.0004 * cw * ch:
            continue
        yy, xx = np.nonzero(lab == k)
        x0, x1 = xx.min(), xx.max()
        parts = [(xx, yy)]
        if x1 - x0 > 0.22 * cw:
            # two feet in one blob: cut at the deepest dip of the bottom profile
            prof = np.full(x1 - x0 + 1, -1.0)
            for x in range(x0, x1 + 1):
                c = yy[xx == x]
                if len(c):
                    prof[x - x0] = c.max()
            sm = cv2.GaussianBlur(prof.reshape(1, -1).astype(np.float32), (0, 0), 3).ravel()
            cuts = []
            lo, hi = int(0.07 * cw), len(sm) - int(0.07 * cw)
            if hi > lo:
                i = lo + int(np.argmin(sm[lo:hi]))
                left, right = sm[:i].max(), sm[i:].max()
                if min(left, right) - sm[i] > 0.02 * hs:
                    cuts.append(x0 + i)
            if cuts:
                cx = cuts[0]
                parts = [(xx[xx < cx], yy[xx < cx]), (xx[xx >= cx], yy[xx >= cx])]
        for px, py in parts:
            if len(px) < 0.0004 * cw * ch:
                continue
            yb = py.max()
            sel = py >= yb - thin
            out.append(
                {
                    'x': float(px[sel].mean()),
                    'y': int(yb),
                    'area': int(len(px)),
                    'lo': int(px.min()),
                    'hi': int(px.max()),
                }
            )
    out.sort(key=lambda f: -f['y'])
    out = out[:max_feet]
    out.sort(key=lambda f: f['x'])
    return out


# ---------------------------------------------------------------- registration


def foot_patch(mk, foot, ph, pw):
    """The boot around a foot's contact point: (x0, y0, x1, y1) and its mask."""
    ch, cw = mk.shape
    x, yb = int(round(foot['x'])), foot['y']
    x0, x1 = max(0, x - pw), min(cw, x + pw + 1)
    y0, y1 = max(0, yb - ph), min(ch, yb + 2)
    sub = mk[y0:y1, x0:x1].astype(np.uint8)
    n, lab, _, _ = cv2.connectedComponentsWithStats(sub, connectivity=8)
    # the component that holds the contact point (or the nearest one)
    ly, lx = min(y1 - 1 - y0, yb - y0), min(x1 - 1 - x0, max(0, x - x0))
    k = lab[ly, lx]
    if k == 0:
        yy, xx = np.nonzero(sub)
        if len(yy) == 0:
            return None
        j = np.argmin((yy - ly) ** 2 + (xx - lx) ** 2)
        k = lab[yy[j], xx[j]]
    return x0, y0, x1, y1, (lab == k)


def register(cells_rgb, alphas, src, dst, foot, ph, pw, rx, ry, dy_max):
    """Shift of `foot` (in drawing src) into drawing dst, per horizontal offset.

    Returns (score, dys): for each integer dx in [-rx, rx], the best normalised
    cross-correlation over |dy| <= dy_max and the dy that gave it. Mask and pixels are
    both matched (the mask alone is blind to laces and soles, the pixels alone to shape)."""
    mk = alphas[src] > 128
    p = foot_patch(mk, foot, ph, pw)
    if p is None:
        return None
    x0, y0, x1, y1, comp = p
    ch, cw = mk.shape
    tw, th = x1 - x0, y1 - y0
    # search window in dst
    sx0, sx1 = x0 - rx, x1 + rx
    sy0, sy1 = y0 - ry, y1 + ry
    pad_l, pad_t = max(0, -sx0), max(0, -sy0)
    pad_r, pad_b = max(0, sx1 - cw), max(0, sy1 - ch)

    def crop(a):
        a = a[max(0, sy0) : min(ch, sy1), max(0, sx0) : min(cw, sx1)]
        return cv2.copyMakeBorder(a, pad_t, pad_b, pad_l, pad_r, cv2.BORDER_CONSTANT, value=0)

    m_src = comp.astype(np.float32)
    m_dst = crop((alphas[dst] > 128).astype(np.float32))
    a_src = (cells_rgb[src][y0:y1, x0:x1].astype(np.float32) / 255.0) * comp[..., None]
    a_dst = crop(cells_rgb[dst].astype(np.float32) / 255.0 * (alphas[dst] > 128)[..., None])
    r1 = cv2.matchTemplate(m_dst, m_src, cv2.TM_CCOEFF_NORMED)
    r2 = cv2.matchTemplate(a_dst, a_src.astype(np.float32), cv2.TM_CCOEFF_NORMED)
    r = np.nan_to_num(0.5 * (r1 + r2), nan=-1.0)
    # r is indexed (dy + ry, dx + rx) for a template whose top-left moves by (dx, dy)
    rows = np.arange(r.shape[0]) - ry
    r = np.where((np.abs(rows) <= dy_max)[:, None], r, -1.0)
    return r.max(axis=0), r.argmax(axis=0) - ry


def subpixel(s, k):
    """Parabolic peak of s around index k, as an offset in [-0.5, 0.5]."""
    if k <= 0 or k >= len(s) - 1:
        return 0.0
    a, b, c = s[k - 1], s[k], s[k + 1]
    d = a - 2 * b + c
    return 0.0 if abs(d) < 1e-9 else float(np.clip(0.5 * (a - c) / d, -0.5, 0.5))


# ---------------------------------------------------------------- analysis


def analyse(meta, cells, o):
    n = meta['frames']
    cw, ch = meta['cell']
    loop = bool(meta.get('loop'))
    alphas = [c[..., 3] for c in cells]
    masks = [silhouette(a) for a in alphas]
    feet = [detect_feet(m, o.band, cw, ch, o.max_feet) for m in masks]

    # the ground line: the level the lowest point of most drawings sits at
    ymax = np.array([max((f['y'] for f in fs), default=0) for fs in feet], float)
    if o.ground is not None:
        ground = float(o.ground)
    else:
        ground = float(np.median(ymax[ymax >= np.median(ymax)]))
    hs = float(np.median([np.ptp(np.nonzero(m)[0]) for m in masks]))
    tol = o.ground_tol * hs
    for fs in feet:
        for f in fs:
            f['ground'] = bool(f['y'] >= ground - tol)

    forced = set(o.flight or [])
    ph = int(round(o.patch_h * hs))
    pw = int(round(o.patch_w * cw))
    rx = int(round(o.reach * cw))
    ry = max(3, int(round(0.06 * hs)))
    dy_max = 0.045 * hs
    npairs = n if loop else n - 1

    def log(*a):
        if o.verbose:
            print(*a)

    # 1. every registration: a foot on the ground at one end of a pair, found again at the
    #    other end (forwards from i, backwards from j). Each becomes a curve over the body
    #    advance a (a = -shift going forwards, +shift coming back), so feet vote together
    A = np.arange(-rx, rx + 1)
    regs = [[] for _ in range(npairs)]
    for p in range(npairs):
        i, j = p, (p + 1) % n
        if i in forced or j in forced:
            continue
        for src, dst, sgn in ((i, j, 1), (j, i, -1)):
            for k, f in enumerate(feet[src]):
                if not f['ground']:
                    continue
                res = register(cells, alphas, src, dst, f, ph, pw, rx, ry, dy_max)
                if res is None:
                    continue
                c, dys = res
                if sgn == 1:
                    c, dys = c[::-1], dys[::-1]
                regs[p].append({'src': src, 'dst': dst, 'sgn': sgn, 'foot': k, 'c': c, 'dys': dys})

    def vote(p, facing):
        """The advance the feet of pair p agree on, for a body moving `facing`:
        (a, contributors, strength) or None."""
        rs = regs[p]
        if not rs:
            return None
        S = sum(np.clip(r['c'] - 0.25, 0, None) for r in rs)
        S = np.where(A * facing > 0, S, 0.0)
        k = int(np.argmax(S))
        if S[k] <= 0:
            return None
        a = A[k] + subpixel(S, k)
        grp = []
        for r in rs:
            lo, hi = max(0, k - 3), min(len(A), k + 4)
            m = lo + int(np.argmax(r['c'][lo:hi]))
            if r['c'][m] >= o.weak_score:
                f = feet[r['src']][r['foot']]
                # where the boot is at the other end, to name its mate there
                dx = -(A[m] + subpixel(r['c'], m)) if r['sgn'] == 1 else A[m] + subpixel(r['c'], m)
                x_dst = f['x'] + dx
                mates = [(kk, g) for kk, g in enumerate(feet[r['dst']]) if g['ground']]
                mate = min(mates, key=lambda t: abs(t[1]['x'] - x_dst), default=None)
                if mate is not None and abs(mate[1]['x'] - x_dst) > 0.1 * cw:
                    mate = None
                grp.append(
                    {
                        'a': float(A[m]),
                        'score': float(r['c'][m]),
                        'reg': r,
                        'foot': r['foot'],
                        'mate': mate[0] if mate else None,
                        'y': f['y'],
                    }
                )
        if not grp:
            return None
        sure = (
            sum(1 for g in grp if g['score'] >= o.min_score) >= 1
            or sum(1 for g in grp if g['score'] >= 0.5) >= 2
        )
        return float(a), grp, sure

    if o.facing:
        facing = o.facing
        how_facing = 'manual'
    else:
        # the direction whose planted feet make the better case: a stance moves the foot
        # against the body at the body's speed, while a foot reaching for the ground near it
        # drifts forward slowly, so weigh each sure pair by its score and its speed
        tot = {}
        for fc in (1, -1):
            v = [vote(p, fc) for p in range(npairs)]
            v = [x for x in v if x and x[2]]
            sp = np.array([abs(x[0]) for x in v]) if v else np.zeros(0)
            cap = 1.5 * np.median(sp) if len(sp) else 0
            tot[fc] = sum(np.mean([g['score'] for g in x[1]]) * min(abs(x[0]), cap) for x in v)
        facing = 1 if tot[1] >= tot[-1] else -1
        hi, lo = max(tot.values()), min(tot.values())
        how_facing = 'auto' if hi > 0 and lo < 0.6 * hi else 'auto (unsure: check --facing)'
        log(f'  facing evidence: right {tot[1]:.0f}, left {tot[-1]:.0f}')
    votes = {p: vote(p, facing) for p in range(npairs)}
    votes = {p: v for p, v in votes.items() if v}
    strong = {p: (v[0], v[1]) for p, v in votes.items() if v[2]}

    speeds = np.array([abs(a) for a, _ in strong.values()])
    med = float(np.median(speeds)) if len(speeds) else 0.0
    log(f'  facing {facing:+d}, strong pairs {sorted(strong)}, median speed {med:.1f}')
    for p in sorted(votes):
        log(
            f"  pair {p}: a={votes[p][0]:6.1f} sure={votes[p][2]} "
            + ' '.join(f"[{g['score']:.2f}@{g['a']:.0f} foot{g['foot']}]" for g in votes[p][1])
        )

    # 2. a foot that is not moving against the body is not planted (a foot reaching for the
    #    ground): drop those, keeping real stillness only when the whole clip is still
    if med > 0.02 * cw:
        for p in list(strong):
            if abs(strong[p][0]) < 0.35 * med:
                log(f'  pair {p}: foot still ({strong[p][0]:.1f}), not planted')
                del strong[p]

    # 3. weaker matches, where they agree with what the strong ones say
    sel = dict(strong)
    weak = {}
    for p, v in votes.items():
        if p in sel or v[2]:
            continue
        if med == 0 or 0.5 * med <= abs(v[0]) <= 2.0 * med:
            sel[p] = (v[0], v[1])
            weak[p] = True

    # 4. toe-off: the planted foot keeps its contact point as the boot rotates, so where
    #    the boot no longer matches, follow its lowest point (only for a foot already planted)
    mate_of = {}  # (drawing, foot index) -> True for feet reached by an accepted pair
    for p, (a, grp) in sel.items():
        for g in grp:
            if g['mate'] is not None:
                mate_of[((p + 1) % n if g['reg']['sgn'] == 1 else p, g['mate'])] = True
    contact = {}
    if med > 0:
        for p in range(npairs):
            if p in sel or p in forced or (p + 1) % n in forced:
                continue
            i, j = p, (p + 1) % n
            for k, f in enumerate(feet[i]):
                if not f['ground'] or not mate_of.get((i, k)):
                    continue
                opts = [
                    (g, kk)
                    for kk, g in enumerate(feet[j])
                    if g['ground'] and abs(g['y'] - f['y']) <= 0.05 * hs
                ]
                opts = [
                    (g, kk)
                    for g, kk in opts
                    if facing * (f['x'] - g['x']) > 0 and 0.45 <= abs(f['x'] - g['x']) / med <= 2.0
                ]
                if opts:
                    g, kk = min(opts, key=lambda t: abs(abs(f['x'] - t[0]['x']) - med))
                    contact[p] = (facing * abs(f['x'] - g['x']), k, kk)
                    break

    adv = np.zeros(npairs)
    meas = np.zeros(npairs, bool)
    score = np.zeros(npairs)
    how = [''] * npairs
    sup = np.zeros(npairs, int)
    for p, (a, grp) in sel.items():
        adv[p], meas[p] = a, True
        score[p] = float(np.mean([g['score'] for g in grp]))
        sup[p] = len(grp)
        how[p] = 'weak' if p in weak else 'boot'
    for p, (a, k, kk) in contact.items():
        adv[p], meas[p], score[p], sup[p], how[p] = a, True, 0.3, 1, 'toe'

    # 5. flight: pairs with no planted foot take the average of the nearest measured neighbours
    filled = adv.copy()
    if meas.any():
        for p in range(npairs):
            if meas[p]:
                continue
            vals = []
            for step in (-1, 1):
                for d in range(1, npairs):
                    q = p + step * d
                    if loop:
                        q %= npairs
                    if not 0 <= q < npairs:
                        break
                    if meas[q]:
                        vals.append(adv[q])
                        break
            filled[p] = float(np.mean(vals)) if vals else 0.0
    adv = filled
    if o.smooth > 0 and npairs > 2:
        sm = adv.copy()
        for p in range(npairs):
            if not loop and p in (0, npairs - 1):
                continue
            sm[p] = (1 - o.smooth) * adv[p] + o.smooth * 0.5 * (adv[(p - 1) % npairs] + adv[(p + 1) % npairs])
        if abs(sm.sum()) > 1e-6:
            sm *= adv.sum() / sm.sum()  # smoothing must not change the stride
        adv = sm
    advance = np.zeros(n)
    advance[:npairs] = adv

    # 6. which foot was planted at each drawing, and where feet change (footfalls)
    plant = [None] * n  # foot index planted in drawing i
    linked_in = set()  # (drawing, foot) reached from the previous drawing's planted foot
    named_pairs = {}
    linked_out = {}
    parent = {}

    def find(a):
        parent.setdefault(a, a)
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a, b):
        parent[find(a)] = find(b)

    for i in range(n):
        for k in range(len(feet[i])):
            find((i, k))
    for p in range(npairs):
        if not meas[p]:
            continue
        i, j = p, (p + 1) % n
        if p in contact:
            pairs = [(contact[p][1], contact[p][2])]
        else:
            grp = sel[p][1]
            pairs = []
            for g in grp:
                if g['mate'] is None:
                    continue
                pairs.append((g['foot'], g['mate']) if g['reg']['sgn'] == 1 else (g['mate'], g['foot']))
            if not pairs:
                # a foot that only one end could name: the lowest ground foot at each end
                fi = [k for k, f in enumerate(feet[i]) if f['ground']]
                fj = [k for k, f in enumerate(feet[j]) if f['ground']]
                pairs = (
                    [(max(fi, key=lambda k: feet[i][k]['y']), max(fj, key=lambda k: feet[j][k]['y']))]
                    if fi and fj
                    else []
                )
        named_pairs[p] = [(i, ki) for ki, _ in pairs]
        linked_out[p] = [kj for _, kj in pairs]
        for ki, kj in pairs:
            union((i, ki), (j, kj))
            linked_in.add((j, kj))
        if pairs:
            # the foot that the advance follows: the lowest of them
            ki, kj = max(pairs, key=lambda t: feet[i][t[0]]['y'])
            if plant[i] is None:
                plant[i] = ki
            if plant[j] is None:
                plant[j] = kj
    ids = {}
    for i in range(n):
        for k, f in enumerate(feet[i]):
            f['id'] = ids.setdefault(find((i, k)), len(ids))
    # a footfall: the first drawing of a stance, where a foot that a measured pair carries
    # is not reached from the foot of the drawing before (the foot reaching for the ground
    # near it, not moving against the body, is not planted yet)
    carried = set()
    for p, named in named_pairs.items():
        carried.update(named)
        carried.update(((p + 1) % n, kj) for kj in linked_out.get(p, []))
    falls = []
    for i in range(n):
        if i == 0 and not loop:
            continue
        for k, f in enumerate(feet[i]):
            if (i, k) in carried and (i, k) not in linked_in:
                falls.append({'i': i, 'id': f['id'], 'x': round(f['x'], 1), 'y': int(f['y'])})
                if plant[i] is None:
                    plant[i] = k
    flight = [i for i in range(n) if plant[i] is None or i in forced]

    stride = float(advance.sum())
    facing_out = 1 if stride >= 0 else -1
    frac = float(meas.sum()) / max(1, npairs)
    agree = float((np.sign(adv[meas]) == facing_out).mean()) if meas.any() else 0.0
    conf = float(np.clip(frac / 0.5, 0, 1) * agree * (score[meas].mean() if meas.any() else 0))
    pad = [0] * (n - npairs)
    return {
        'ground': round(ground, 1),
        'band': o.band,
        'facing': facing_out,
        'facingBy': how_facing,
        'confidence': round(conf, 2),
        'advance': [round(float(a), 1) for a in advance],
        'measured': [int(m) for m in meas] + pad,
        'stride': round(stride, 1),
        'feet': [
            [[round(f['x'], 1), int(f['y']), int(f['id']), int(f['ground'])] for f in fs] for fs in feet
        ],
        'planted': [
            (
                [round(feet[i][k]['x'], 1), int(feet[i][k]['y']), int(feet[i][k]['id'])]
                if k is not None
                else None
            )
            for i, k in enumerate(plant)
        ],
        'footfalls': falls,
        'flight': flight,
        '_score': [round(float(s), 2) for s in score] + pad,
        '_support': [int(s) for s in sup] + pad,
        '_how': how + [''] * (n - npairs),
    }


# ---------------------------------------------------------------- output


def table(meta, c):
    n = meta['frames']
    fps = meta['fps']
    print(
        f"\n{meta['name']}: {n} drawings @ {fps:g} fps, cell {meta['cell'][0]}x{meta['cell'][1]}, "
        f"ground y {c['ground']}, band {c['band']}, loop {bool(meta.get('loop'))}"
    )
    print(' i  feet (x,y,id, *=ground)                            planted     adv  meas score sup')
    falls = {f['i']: f for f in c['footfalls']}
    for i in range(n):
        fs = ' '.join(f"({f[0]:.0f},{f[1]}{'*' if f[3] else ' '}#{f[2]})" for f in c['feet'][i])
        pl = c['planted'][i]
        pls = f'{pl[0]:6.1f} #{pl[2]}' if pl else '   flight'
        mark = ' <- footfall' if i in falls else ''
        print(
            f"{i:2d}  {fs:<52s} {pls:<10s} {c['advance'][i]:6.1f}   {c['_how'][i][:1].upper() or '-'}"
            f"   {c['_score'][i]:.2f}  {c['_support'][i]}{mark}"
        )
    per_s = c['stride'] * fps / n
    print(
        f"stride {c['stride']:.1f} cell px per loop ({n / fps:.2f} s) = {per_s:.0f} cell px/s; "
        f"facing {c['facing']:+d}; confidence {c['confidence']:.2f}; "
        f"footfalls at {[f['i'] for f in c['footfalls']]}; flight {c['flight']}"
    )


def debug_image(path, meta, cells, c):
    cw, ch = meta['cell']
    n = len(cells)
    sheet = np.zeros((ch, cw * n, 3), np.uint8)
    sheet[:] = (110, 130, 110)
    for i, cell in enumerate(cells):
        a = cell[..., 3:4].astype(np.float32) / 255
        sheet[:, i * cw : (i + 1) * cw] = (
            cell[..., :3] * a + sheet[:, i * cw : (i + 1) * cw] * (1 - a)
        ).astype(np.uint8)
        cv2.line(sheet, (i * cw, int(c['ground'])), ((i + 1) * cw, int(c['ground'])), (255, 255, 0), 1)
        for f in c['feet'][i]:
            col = (255, 60, 60) if f[3] else (60, 60, 255)
            cv2.circle(sheet, (i * cw + int(f[0]), f[1]), 6, col, 2)
            cv2.putText(
                sheet, str(f[2]), (i * cw + int(f[0]) + 8, f[1] - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.6, col, 2
            )
        pl = c['planted'][i]
        if pl:
            cv2.circle(sheet, (i * cw + int(pl[0]), pl[1]), 12, (255, 255, 255), 2)
        cv2.putText(
            sheet,
            f"{i} adv {c['advance'][i]:.0f}",
            (i * cw + 4, 24),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (255, 255, 255),
            2,
        )
    Image.fromarray(sheet).save(path)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('names', nargs='+', help='clip names (motion/<name>.json) or paths')
    ap.add_argument(
        '--band', type=float, default=0.12, help='bottom band, as a fraction of the silhouette height'
    )
    ap.add_argument(
        '--facing', type=int, choices=(1, -1), default=None, help='force the direction of travel as drawn'
    )
    ap.add_argument(
        '--flight',
        type=lambda s: [int(x) for x in s.split(',') if x != ''],
        default=None,
        help='drawings with no foot on the ground (comma separated)',
    )
    ap.add_argument('--ground', type=float, default=None, help='the ground line, cell y')
    ap.add_argument(
        '--ground-tol',
        type=float,
        default=0.06,
        help='how far above the ground line a foot still counts as on it (fraction of height)',
    )
    ap.add_argument(
        '--min-score', type=float, default=0.65, help='correlation that counts as a sure boot match'
    )
    ap.add_argument(
        '--weak-score',
        type=float,
        default=0.4,
        help='lowest correlation accepted, and then only where it agrees with the sure matches',
    )
    ap.add_argument(
        '--patch-h', type=float, default=0.10, help='boot patch height (fraction of silhouette height)'
    )
    ap.add_argument(
        '--patch-w', type=float, default=0.11, help='boot patch half width (fraction of cell width)'
    )
    ap.add_argument(
        '--reach',
        type=float,
        default=0.45,
        help='furthest a foot may shift between drawings (fraction of cell width)',
    )
    ap.add_argument(
        '--touch-tol',
        type=float,
        default=0.02,
        help='how close to the ground line a foot is touching it, for footfalls (fraction of height)',
    )
    ap.add_argument('--max-feet', type=int, default=4)
    ap.add_argument(
        '--smooth', type=float, default=0.0, help='blend each advance with its neighbours (0 exact)'
    )
    ap.add_argument(
        '--debug', default=None, help='write a marked-up strip of the drawings here (a directory or a .png)'
    )
    ap.add_argument('--verbose', action='store_true')
    ap.add_argument('--no-write', action='store_true', help='print only')
    o = ap.parse_args()

    for name in o.names:
        base, meta, cells = load(name)
        c = analyse(meta, cells, o)
        table(meta, c)
        if o.debug:
            p = o.debug if o.debug.endswith('.png') else os.path.join(o.debug, f"contacts_{meta['name']}.png")
            os.makedirs(os.path.dirname(os.path.abspath(p)), exist_ok=True)
            debug_image(p, meta, cells, c)
            print('debug:', p)
        if not o.no_write:
            block = {k: v for k, v in c.items() if not k.startswith('_')}
            meta['contacts'] = block
            with open(base + '.json', 'w') as fh:
                json.dump(meta, fh, indent=2)
                fh.write('\n')
            print(f"wrote contacts into {os.path.relpath(base + '.json', ROOT)}")


if __name__ == '__main__':
    sys.exit(main())
