"""Cut each generated take into the plate clips the edit list plays (gen.js).

    .venv-cutscene/bin/python tools/cutscene/unwritten/previs3d/cut_clips.py ford [--fps 12]

For every cut of boards/<scene>_edit.json with a `take`, it takes that take's chosen motion
(the cut's `motion` file, else motion_720p.mp4, else the 480p draft), the span of take time the
cut shows (from `src`, its length times `rate`, plus margins for holds and slow motion), and
writes References/cutscene/gen_motion/<clip>.webp + .json via motion/clip.py --plate.
The clip's JSON `range` records the take time of its first drawing; gen.js offsets by it.
"""
import argparse, json, os, subprocess, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../..'))
ap = argparse.ArgumentParser()
ap.add_argument('scene')
ap.add_argument('--fps', type=float, default=12)
ap.add_argument('--only', nargs='*')
a = ap.parse_args()
E = json.load(open(os.path.join(ROOT, f'tools/cutscene/unwritten/boards/{a.scene}_edit.json')))
OUT = os.path.join(ROOT, 'References/cutscene/gen_motion')
for c in E['cuts']:
    if 'take' not in c or (a.only and c['name'] not in a.only):
        continue
    d = os.path.join(ROOT, f'References/cutscene/takes/{a.scene}', c['take'])
    mp4 = c.get('motion') or next((m for m in ('motion_720p.mp4', 'motion_480p.mp4')
                                   if os.path.exists(os.path.join(d, m))), None)
    if not mp4:
        print(c['name'], 'no motion for take', c['take'])
        continue
    rate = c.get('rate', 1)
    span = (c['to'] - c['from']) * rate
    t0 = max(0, c.get('src', 0) - 0.05)
    t1 = c.get('src', 0) + span + 0.25
    r = subprocess.run([sys.executable, os.path.join(ROOT, 'tools/cutscene/unwritten/motion/clip.py'),
                        c['clip'], '--plate', '--clip', os.path.join(d, mp4), '--from', f'{t0:.3f}',
                        '--to', f'{t1:.3f}', '--fps', str(a.fps), '--height', '270', '--out', OUT],
                       capture_output=True, text=True)
    print(c['name'], (r.stdout.strip().splitlines() or [''])[-1], r.stderr[-300:])
