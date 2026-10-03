"""Dailies: several takes of the same span side by side, with the shot name, frame and time
burned in (banteg's review cut). Each source is a PNG folder (frames named ####.png on the
piece's 24 fps clock) or a video with a start offset on that clock.

    python3 tools/cutscene/unwritten/previs3d/dailies.py \
        --json References/cutscene/previs3d/ford.json --from 0 --to 13.6 \
        --src "previs (shot camera)=References/cutscene/previs3d/ford/shots" \
        --src "current preview=docs/art-direction/anime-op/px/ford_v6.mp4@0" \
        --src "side-on blocking=References/cutscene/previs3d/ford/side" \
        --out References/cutscene/previs3d/ford/dailies_ford.mp4
"""

import argparse
import json
import os
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFont

ap = argparse.ArgumentParser()
ap.add_argument('--json', required=True)
ap.add_argument('--src', action='append', required=True, help='label=path[@offset]')
ap.add_argument('--from', dest='t0', type=float, default=0)
ap.add_argument('--to', dest='t1', type=float, default=None)
ap.add_argument('--cols', type=int, default=2)
ap.add_argument('--cell', default='640x360')
ap.add_argument('--out', required=True)
a = ap.parse_args()

D = json.load(open(a.json))
FPS = D['fps']
t1 = a.t1 if a.t1 is not None else D['duration']
CW, CH = (int(v) for v in a.cell.split('x'))
try:
    FONT = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 18)
    BIG = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 24)
except OSError:
    FONT = BIG = ImageFont.load_default()

tmp = tempfile.mkdtemp(prefix='dailies_')
srcs = []
for s in a.src:
    label, p = s.split('=', 1)
    off = 0.0
    if '@' in p:
        p, off = p.rsplit('@', 1)
        off = float(off)
    if os.path.isdir(p):
        srcs.append((label, 'dir', p, off))
    else:
        d = os.path.join(tmp, f'v{len(srcs)}')
        os.makedirs(d)
        # frame k of the extract is piece time off + k / FPS
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', p, '-vf', f'fps={FPS}',
                        os.path.join(d, '%05d.png')], check=True)
        srcs.append((label, 'vid', d, off))


def frame_of(src, t):
    label, kind, p, off = src
    if kind == 'dir':
        f = os.path.join(p, f'{round(t * FPS):04d}.png')
    else:
        f = os.path.join(p, f'{round((t - off) * FPS) + 1:05d}.png')
    if os.path.exists(f):
        return Image.open(f).convert('RGB').resize((CW, CH), Image.NEAREST)
    return None


def shot_at(t):
    for i, s in enumerate(D.get('shots') or []):
        if s['from'] <= t < s['to']:
            return f"#{i + 1} {s['name']}"
    return ''


rows = (len(srcs) + a.cols - 1) // a.cols
out_dir = os.path.join(tmp, 'out')
os.makedirs(out_dir)
n = 0
t = a.t0
while t < t1 - 1e-6:
    canvas = Image.new('RGB', (CW * a.cols, CH * rows), (24, 24, 28))
    dr = ImageDraw.Draw(canvas)
    for i, src in enumerate(srcs):
        x, y = (i % a.cols) * CW, (i // a.cols) * CH
        im = frame_of(src, t)
        if im:
            canvas.paste(im, (x, y))
        dr.rectangle((x, y + CH - 28, x + 12 + 11 * len(src[0]), y + CH), fill=(0, 0, 0))
        dr.text((x + 6, y + CH - 25), src[0], font=FONT, fill=(255, 255, 255))
    head = f'{shot_at(t)}   f{round(t * FPS):04d}   {t:6.2f}s'
    dr.rectangle((0, 0, 14 * len(head) + 12, 34), fill=(0, 0, 0))
    dr.text((8, 4), head, font=BIG, fill=(255, 235, 140))
    canvas.save(os.path.join(out_dir, f'{n:05d}.png'))
    n += 1
    t = a.t0 + n / FPS

os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-framerate', str(FPS), '-i',
                os.path.join(out_dir, '%05d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                '-crf', '18', a.out], check=True)
print(a.out)
