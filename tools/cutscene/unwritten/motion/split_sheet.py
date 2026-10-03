#!/usr/bin/env python3
"""Key a pose sheet (figures on flat #00FF00) and split it into one cut-out per pose.

    python3 tools/cutscene/unwritten/motion/split_sheet.py \\
        docs/art-direction/anime-op/batch-7/f_warden_poses.png \\
        --spec docs/art-direction/anime-op/cutouts/f_warden_poses.spec.json

Writes, into docs/art-direction/anime-op/cutouts/ (--out):
  f_<sheet>_<n>_<pose>.webp   one keyed pose, full resolution, 16 px margin, alpha
and merges the sheet into cutouts/f_sheets.json (--sheets): per cut-out the crop box in
the sheet, the feet anchor (in the cut-out and in the sheet) and the sheet's shared ground
line. Poses of one sheet keep their relative scale (1 cut-out px = 1 sheet px), so the
engine can place them with one scale and one ground line.

Keying (same maths as clip.py and the older cut-outs): a = 1 - clip((g - max(r, b) - 30) / 60),
green is despilled (g <= max(r, b) + 10 on the rim, and on the whole figure), the alpha is
eroded 1 px, and the rim is despilled harder (g <= max(r, b)) so no green halo survives.

Splitting
  1. The keyed silhouette falls into connected components. A component holding seeds of
     only one pose belongs to it whole. Where poses touch (a weapon crossing into a
     neighbour's space, a boot against a boot) the merged component is cut by a watershed
     on the distance transform, seeded at each pose's seed points (the body's centroid,
     its boots, its helm): the cut falls at the narrowest neck between bodies.
  2. A component with no seed (a dropped sword, a cloak tip) goes to the nearest pose, or
     to the pose the spec names.
  3. The spec can override anything (see below). Overlays are for a weapon that crosses
     another pose's body: its shaft goes to the pose whose hands hold it, and where it
     covers the other pose's body the pixels are inpainted for that pose.

Spec (JSON, next to the cut-outs as f_<sheet>.spec.json):
  {
    "name": "warden_poses",                 # cut-out name <prefix>_<name>_<n>_<pose>
    "prefix": "f",                          # optional: f (The Ford, default), c (the camp)
    "facing": -1,                           # -1 faces left, +1 right (informative)
    "poses": [ {"n": 1, "name": "guard", "seeds": [[x, y], ...]}, ... ],
    "assign": [ {"pose": 2, "component_at": [x, y]},          # whole component to a pose
                {"pose": 2, "poly": [[x, y], ...]} ],         # pixels in a polygon
    "erase":  [ {"poly": [[x, y], ...]} ],                    # stray pixels
    "overlays": [ {"pose": 2, "line": [[x, y], [x, y]], "width": 11, "over": [1]} ],
    "ground": 830                           # optional: shared ground line (sheet y)
  }
    "variants": [ {"name": "guard_spear", "base": 1,
                   "add": {"pose": 2, "poly": [[x, y], ...]},   # pixels of another pose to copy in
                   "cap": [x, y, r]} ],                          # a rounded end for a cut shaft
  A variant is an extra cut-out of pose `base` that also holds a weapon the sheet drew on
  another pose (the Warden's guard has only a butt in his hands; the level spear drawn
  across his chest belongs, by the hand that grips it, to the thrust). Named
  f_<name>_<base>_<variant name>.
  `--debug DIR` writes the label map and every cut-out on grey for checking.

Needs numpy, opencv-python, pillow, scipy and scikit-image (watershed).
"""

import argparse
import json
import os
import sys

import numpy as np
import cv2
from PIL import Image
from scipy import ndimage as ndi
from skimage.segmentation import watershed

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '../../../..'))
CUTS = os.path.join(ROOT, 'docs/art-direction/anime-op/cutouts')
MARGIN = 16


def key(rgb):
    """Green key of a sheet: (rgba uint8, soft alpha 0..1 before the erode)."""
    f = rgb.astype(np.float32)
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    a = 1 - np.clip((g - np.maximum(r, b) - 30) / 60, 0, 1)
    a = cv2.erode(a, np.ones((3, 3), np.uint8))  # 1 px alpha erode
    # despill: the whole figure loses any green above its warm/blue channels; the rim
    # (where alpha < 1, or within 2 px of transparency) is despilled all the way down
    m = np.maximum(r, b)
    g2 = np.minimum(g, m + 10)
    rim = cv2.dilate((a < 0.999).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    g2 = np.where(rim, np.minimum(g, m), g2)
    out = np.dstack([r, g2, b, a * 255]).clip(0, 255).astype(np.uint8)
    return out


def poly_mask(shape, poly):
    m = np.zeros(shape[:2], np.uint8)
    cv2.fillPoly(m, [np.array(poly, np.int32)], 1)
    return m > 0


def line_mask(shape, line, width):
    m = np.zeros(shape[:2], np.uint8)
    pts = np.array(line, np.int32).reshape(-1, 1, 2)
    cv2.polylines(m, [pts], False, 1, int(width), cv2.LINE_8)
    return m > 0


def repaint(rgba, spec, max_hole=90):
    """Two fixes to the keyed sheet before it is split.
    1. Small holes inside a figure (green flecks the painter left in a cloak keyed out as
       transparent) are filled: opaque, colour inpainted from the ring around them.
    2. Spec `repaint`: [{"poly": [...], "select": "yellowgreen"}]: stray yellow-green
       pixels inside a polygon (a sliver of the source's background that survived
       normalisation) are inpainted from their neighbours."""
    al = rgba[..., 3]
    solid = al > 128
    inv = (~solid).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(inv, connectivity=4)
    fill = np.zeros(al.shape, bool)
    H, W = al.shape
    for i in range(1, n):
        x, y, w, h, area = st[i]
        if area <= max_hole and x > 0 and y > 0 and x + w < W and y + h < H:
            fill |= lab == i
    for r in spec.get('repaint', []):
        rgb = rgba[..., :3].astype(np.int32)
        sel = poly_mask(al.shape, r['poly']) & solid
        if r.get('select') == 'yellowgreen':
            sel &= ((rgb[..., 1] - rgb[..., 2]) > 42) & ((rgb[..., 0] - rgb[..., 2]) > 22) & (rgb[..., 1] > 100)
        fill |= cv2.dilate(sel.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    if not fill.any():
        return rgba
    fill = cv2.dilate(fill.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    fill &= cv2.dilate(solid.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
    bgr = cv2.cvtColor(rgba[..., :3], cv2.COLOR_RGB2BGR)
    # ring colours only: transparent pixels carry the spill of the green
    out = cv2.inpaint(bgr, (fill).astype(np.uint8) * 255, 3, cv2.INPAINT_TELEA)
    res = rgba.copy()
    res[..., :3] = np.where(fill[..., None], cv2.cvtColor(out, cv2.COLOR_BGR2RGB), rgba[..., :3])
    # holes become opaque; stripe pixels keep the alpha they had (never grow the silhouette)
    holes_only = fill & ~solid
    interior = cv2.erode(solid.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    res[..., 3] = np.where(holes_only & (cv2.dilate(interior.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0), 255, rgba[..., 3])
    return res


def segment(rgba, spec):
    """Label map (0 = background, k = pose n) and the per-pose masks."""
    h, w = rgba.shape[:2]
    mask = rgba[..., 3] > 128
    # drop dust
    n, lab, st, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] < 40:
            mask[lab == i] = False
    n, comp, st, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)

    poses = spec['poses']
    markers = np.zeros((h, w), np.int32)
    for p in poses:
        for (x, y) in p['seeds']:
            cv2.circle(markers, (int(x), int(y)), 5, int(p['n']), -1)
    markers[~mask] = 0

    # which poses seed each component
    seeded = {}
    for p in poses:
        for v in np.unique(comp[(markers == p['n'])]):
            if v:
                seeded.setdefault(int(v), set()).add(int(p['n']))

    dist = ndi.distance_transform_edt(mask)
    ws = watershed(-dist, markers, mask=mask)  # cut at the narrowest necks
    labels = np.zeros((h, w), np.int32)
    for c in range(1, n):
        sel = comp == c
        owners = seeded.get(c, set())
        if len(owners) == 1:
            labels[sel] = next(iter(owners))
        elif len(owners) > 1:
            labels[sel] = ws[sel]
    # components with no seed: nearest labelled pixel
    loose = mask & (labels == 0)
    if loose.any() and (labels > 0).any():
        idx = ndi.distance_transform_edt(labels == 0, return_distances=False, return_indices=True)
        near = labels[idx[0], idx[1]]
        # whole components go together: vote by component
        nc, cc, _, _ = cv2.connectedComponentsWithStats(loose.astype(np.uint8), connectivity=8)
        for c in range(1, nc):
            sel = cc == c
            vals, cnt = np.unique(near[sel], return_counts=True)
            labels[sel] = vals[cnt.argmax()]

    for a in spec.get('assign', []):
        if 'component_at' in a:
            x, y = a['component_at']
            c = comp[int(y), int(x)]
            if c == 0:  # a click on a hole: the nearest component
                idx = ndi.distance_transform_edt(comp == 0, return_distances=False, return_indices=True)
                c = comp[idx[0][int(y), int(x)], idx[1][int(y), int(x)]]
            labels[(comp == c) & mask] = a['pose']
        if 'poly' in a:
            labels[poly_mask(labels.shape, a['poly']) & mask] = a['pose']
    for e in spec.get('erase', []):
        labels[poly_mask(labels.shape, e['poly'])] = 0
    return labels, mask


def apply_overlays(rgba, labels, spec):
    """Overlay shafts go to the pose whose hands hold them; the pixels they cover on
    another pose's body are inpainted for that pose. Returns (labels, {pose: (rgb, holes)})."""
    fixes = {}
    for o in spec.get('overlays', []):
        band = line_mask(labels.shape, o['line'], o['width']) & (rgba[..., 3] > 128)
        prev = labels.copy()
        labels[band] = o['pose']
        for k in o.get('over', []):
            body = (prev == k) & ~band
            # holes: shaft pixels enclosed by the body (body above and below it)
            ker = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (o['width'] + 9, o['width'] + 9))
            closed = cv2.morphologyEx(body.astype(np.uint8), cv2.MORPH_CLOSE, ker) > 0
            hole = band & closed
            hole = cv2.dilate(hole.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
            hole &= (prev == k) | band
            (x0, y0), (x1, y1) = o['line'][0], o['line'][-1]
            nrm = np.array([-(y1 - y0), x1 - x0], np.float32)
            fixes.setdefault(k, []).append((hole, nrm / np.linalg.norm(nrm)))
    return labels, fixes


def mirror_fill(out, sel, hole, normal):
    """Repaint `hole` (pixels a weapon covered on this pose's body) by drawing a straight
    blend, along the weapon's normal, between the body just beyond either edge of the
    hole: the cloth's folds and straps run on through it as streaks, sharper than a
    smooth inpaint and without the kaleidoscope a mirror leaves. Returns (rgba, mask)."""
    H, W = hole.shape
    good = sel & ~hole
    res = out.copy()
    ys, xs = np.nonzero(hole)
    for y, x in zip(ys, xs):
        ends = []
        for sgn in (1, -1):
            hit = None
            for t in range(1, 40):
                px, py = int(round(x + sgn * normal[0] * t)), int(round(y + sgn * normal[1] * t))
                if not (0 <= px < W and 0 <= py < H):
                    break
                if good[py, px]:
                    # sample a little further in: the pixels beside a weapon are its outline
                    qx, qy = int(round(x + sgn * normal[0] * (t + 2))), int(round(y + sgn * normal[1] * (t + 2)))
                    q = out[qy, qx, :3] if (0 <= qx < W and 0 <= qy < H and good[qy, qx]) else out[py, px, :3]
                    hit = (t, q.astype(np.float32))
                    break
            ends.append(hit)
        if ends[0] and ends[1]:
            (t1, c1), (t2, c2) = ends
            w = t1 / (t1 + t2)  # near the + side: mostly that side's colour
            res[y, x, :3] = (c1 * (1 - w) + c2 * w).astype(np.uint8)
        elif ends[0] or ends[1]:
            res[y, x, :3] = (ends[0] or ends[1])[1].astype(np.uint8)
    # soften the streaks along the weapon's own direction (its tangent), keeping the ends
    tang = np.array([normal[1], -normal[0]])
    ang = np.degrees(np.arctan2(tang[1], tang[0]))
    k = 13
    ker = np.zeros((k, k), np.float32)
    c = k // 2
    for t in range(-c, c + 1):
        ker[int(round(c + np.sin(np.radians(ang)) * t)), int(round(c + np.cos(np.radians(ang)) * t))] = np.exp(-t * t / 8.0)
    ker /= ker.sum()
    blur = cv2.filter2D(res[..., :3], -1, ker, borderType=cv2.BORDER_REPLICATE)
    # repaint the paint's grain (a smooth fill reads as a smear next to brushwork)
    rng = np.random.default_rng(7)
    grain = cv2.GaussianBlur(rng.normal(0, 1, (H, W)).astype(np.float32), (0, 0), 0.9) * 22
    filled = np.clip(blur.astype(np.float32) + grain[..., None] * 0.9, 0, 255)
    res[hole, :3] = filled[hole].astype(np.uint8)
    res[hole, 3] = 255
    return res, sel | hole


def feet_anchor(al):
    """(x, y): where the figure stands. Thin things (a spear butt, a sword tip) are opened
    away first, so the anchor is the bottom of the boots (or of the body, lying down),
    with x at the centre of the lowest rows."""
    solid = (al > 128).astype(np.uint8)
    body = cv2.morphologyEx(solid, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
    if not body.any():
        body = solid
    ys, xs = np.nonzero(body)
    y1 = ys.max()
    band = ys > y1 - max(6, (y1 - ys.min()) * 0.06)
    return float(xs[band].mean()), float(y1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('sheet')
    ap.add_argument('--spec', required=True)
    ap.add_argument('--out', default=CUTS)
    ap.add_argument('--sheets', default=os.path.join(CUTS, 'f_sheets.json'))
    ap.add_argument('--quality', type=int, default=88)
    ap.add_argument('--debug', default=None, help='dir for the label map and grey previews')
    ap.add_argument('--dry', action='store_true', help='no cut-outs, just the debug output')
    a = ap.parse_args()

    spec = json.load(open(a.spec))
    src = np.array(Image.open(a.sheet).convert('RGB'))
    rgba = key(src)
    rgba = repaint(rgba, spec)
    labels, mask = segment(rgba, spec)
    labels, fixes = apply_overlays(rgba, labels, spec)
    H, W = labels.shape

    if a.debug:
        os.makedirs(a.debug, exist_ok=True)
        pal = np.array([[0, 0, 0], [230, 60, 60], [60, 200, 60], [70, 100, 240], [230, 200, 40],
                        [200, 60, 220], [60, 220, 220]], np.uint8)
        vis = pal[labels % len(pal)]
        vis[labels == 0] = (40, 40, 40)
        Image.fromarray(vis).save(os.path.join(a.debug, spec['name'] + '.labels.png'))

    ground_feet = []
    entries = []
    made = []
    for p in spec['poses']:
        k = int(p['n'])
        sel = labels == k
        out = rgba.copy()
        out[..., 3] = np.where(sel, rgba[..., 3], 0)
        for hole, normal in fixes.get(k, []):
            out, sel = mirror_fill(out, sel, hole, normal)
        al = out[..., 3]
        ys, xs = np.nonzero(al > 16)
        x0, x1 = max(0, xs.min() - MARGIN), min(W, xs.max() + 1 + MARGIN)
        y0, y1 = max(0, ys.min() - MARGIN), min(H, ys.max() + 1 + MARGIN)
        crop = out[y0:y1, x0:x1].copy()
        # colour under transparent pixels: black (keeps webp from smearing green in)
        crop[crop[..., 3] == 0, :3] = 0
        fx, fy = feet_anchor(al)
        name = f"{spec.get('prefix', 'f')}_{spec['name']}_{k}_{p['name']}"
        made.append((name, crop))
        ground_feet.append(fy)
        entries.append({
            'file': name + '.webp', 'pose': p['name'], 'n': k,
            'box': [int(x0), int(y0), int(x1 - x0), int(y1 - y0)],
            'anchor': [round(float(fx - x0), 1), round(float(fy - y0), 1)],
            'anchorSheet': [round(float(fx), 1), round(float(fy), 1)],
            'size': [int(x1 - x0), int(y1 - y0)],
            'figure': [int(xs.min() - x0), int(ys.min() - y0), int(xs.max() + 1 - xs.min()), int(ys.max() + 1 - ys.min())],
            'pixels': int((al > 128).sum()),
        })
        if a.debug:
            bg = np.full(crop.shape[:2] + (3,), 128, np.float32)
            al3 = crop[..., 3:4].astype(np.float32) / 255
            comp = (crop[..., :3] * al3 + bg * (1 - al3)).astype(np.uint8)
            Image.fromarray(comp).save(os.path.join(a.debug, name + '.grey.png'))

    for v in spec.get('variants', []):
        base = next(p for p in spec['poses'] if int(p['n']) == int(v['base']))
        k = int(base['n'])
        sel = (labels == k)
        add = poly_mask(labels.shape, v['add']['poly']) & (labels == int(v['add']['pose']))
        out = rgba.copy()
        # the base pose, repaired where the weapon covered it, plus the weapon itself
        for hole, normal in fixes.get(k, []):
            out, sel = mirror_fill(out, sel, hole & ~add, normal)
        sel = sel | add
        out[..., 3] = np.where(sel, np.maximum(out[..., 3], np.where(add, rgba[..., 3], 0)), 0)
        out[add, :3] = rgba[add, :3]
        if 'cap' in v:
            cx, cy, cr = v['cap']
            layer = out[..., :3].copy()
            cv2.circle(layer, (int(cx), int(cy)), int(cr), (24, 14, 10), -1)
            cv2.circle(layer, (int(cx), int(cy)), max(1, int(cr) - 2), (112, 72, 42), -1)
            m = np.zeros(sel.shape, np.uint8)
            cv2.circle(m, (int(cx), int(cy)), int(cr), 1, -1)
            out[..., :3] = np.where(m[..., None] > 0, layer, out[..., :3])
            out[..., 3] = np.where(m > 0, 255, out[..., 3])
        ys, xs = np.nonzero(out[..., 3] > 16)
        x0, x1 = max(0, xs.min() - MARGIN), min(W, xs.max() + 1 + MARGIN)
        y0, y1 = max(0, ys.min() - MARGIN), min(H, ys.max() + 1 + MARGIN)
        crop = out[y0:y1, x0:x1].copy()
        crop[crop[..., 3] == 0, :3] = 0
        fx, fy = feet_anchor(out[..., 3])
        name = f"{spec.get('prefix', 'f')}_{spec['name']}_{k}_{v['name']}"
        made.append((name, crop))
        entries.append({
            'file': name + '.webp', 'pose': v['name'], 'n': k, 'variantOf': base['name'],
            'box': [int(x0), int(y0), int(x1 - x0), int(y1 - y0)],
            'anchor': [round(float(fx - x0), 1), round(float(fy - y0), 1)],
            'anchorSheet': [round(float(fx), 1), round(float(fy), 1)],
            'size': [int(x1 - x0), int(y1 - y0)],
            'figure': [int(xs.min() - x0), int(ys.min() - y0), int(xs.max() + 1 - xs.min()), int(ys.max() + 1 - ys.min())],
            'pixels': int((out[..., 3] > 128).sum()),
        })
        if a.debug:
            bg = np.full(crop.shape[:2] + (3,), 128, np.float32)
            al3 = crop[..., 3:4].astype(np.float32) / 255
            Image.fromarray((crop[..., :3] * al3 + bg * (1 - al3)).astype(np.uint8)).save(os.path.join(a.debug, name + '.grey.png'))

    if a.dry:
        return 0

    os.makedirs(a.out, exist_ok=True)
    total = 0
    for name, crop in made:
        f = os.path.join(a.out, name + '.webp')
        Image.fromarray(crop).save(f, 'WEBP', quality=a.quality, alpha_quality=100, method=6)
        total += os.path.getsize(f)
    ground = spec.get('ground')
    if ground is None:
        ground = float(np.median(ground_feet))
    sheets = {}
    if os.path.exists(a.sheets):
        sheets = json.load(open(a.sheets))
    sheets[spec['name']] = {
        'source': os.path.relpath(a.sheet, ROOT), 'sheet': [W, H], 'facing': spec.get('facing'),
        'ground': round(float(ground), 1), 'scale': 1,
        'note': '1 cut-out px = 1 sheet px; place anchorSheet.y on the ground and use one scale for the whole sheet',
        'cutouts': entries,
    }
    with open(a.sheets, 'w') as fh:
        json.dump(sheets, fh, indent=1)
        fh.write('\n')
    print(f"{spec['name']}: {len(made)} cut-outs, {total / 1024:.0f} KB, ground {ground:.0f}")
    for e in entries:
        print(' ', e['file'], e['size'], 'anchor', e['anchor'])
    return 0


if __name__ == '__main__':
    sys.exit(main())
