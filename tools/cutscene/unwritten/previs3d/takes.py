"""Shoot a storyboard's takes: previs reference video, first key, generated motion, QA sheet.

    .venv-cutscene/bin/python tools/cutscene/unwritten/previs3d/takes.py <stage> [ids] [--board ford]

Stages (each reads tools/cutscene/unwritten/boards/<board>.json):
  previs   render each take's previs (Blender, its shot camera or a held one) to
           References/cutscene/takes/<board>/<id>/previs.mp4 and first.png
  keys     draw the first key from first.png with an image model (2 candidates per model):
           <id>/key_<model>[_n].png
  motion   generate the take with Seedance 2.5 reference-to-video: the chosen key as the look
           (<id>/key.png, copy one candidate there), the cast refs, the previs as @Video1, and a
           prompt built from the board (style, cast, action to the second, camera).
           --final renders at 720p; otherwise a 480p draft.
  sheet    a QA contact sheet of a take's motion (12 frames) beside its previs
  prompt   print the take's motion prompt (for review before spending)

Image-only takes (an `image` instead of a camera) skip previs and keys: their first frame is the
image, and motion uses image-to-video.
"""

import argparse
import json
import math
import os
import shutil
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../..'))
BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender'
FAL = os.path.join(ROOT, 'tools/cutscene/unwritten/motion/fal.mjs')

ap = argparse.ArgumentParser()
ap.add_argument('stage', choices=['previs', 'keys', 'motion', 'sheet', 'prompt'])
ap.add_argument('ids', nargs='*')
ap.add_argument('--board', default='ford')
ap.add_argument('--final', action='store_true')
ap.add_argument('--models', default='nbp,sd5')
ap.add_argument('--tag', default='', help='suffix for the motion output (a retake)')
ap.add_argument('--force', action='store_true', help='redraw keys that exist')
a = ap.parse_args()

B = json.load(open(os.path.join(ROOT, f'tools/cutscene/unwritten/boards/{a.board}.json')))
FPS = 24
takes = [t for t in B['takes'] if not a.ids or t['id'] in a.ids]
OUT = os.path.join(ROOT, f'References/cutscene/takes/{a.board}')


def rel(p):
    return os.path.relpath(p, ROOT)


def tdir(t):
    d = os.path.join(OUT, t['id'])
    os.makedirs(d, exist_ok=True)
    return d


def run(cmd, **kw):
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, **kw)
    if r.returncode:
        sys.stderr.write(r.stdout[-2000:] + r.stderr[-2000:])
        raise SystemExit(f'failed: {" ".join(cmd[:4])}')
    return r.stdout


def duration(t):
    return max(4, math.ceil(t['range'][1] - t['range'][0] - 1e-6))


def prompt_for(t):
    cast = ' '.join(B['cast'][c]['text'] for c in t['cast'])
    lines = [f"{x0:.1f}-{x1:.1f} s: {txt}" for x0, x1, txt in t['action']]
    has_previs = 'image' not in t
    refs = []
    n = 1
    if has_previs:
        if 'keyAt' in t:
            refs.append(f"@Image{n} is this shot's frame at {t['keyAt'] - t['range'][0]:.1f} s and "
                        f'its look: draw every frame in its style, with its light and its place.')
        else:
            refs.append(f'@Image{n} is the first frame and the look of this shot: draw every frame '
                        f'in its style, with its light and its place.')
        n += 1
        for c in t['cast']:
            k = len(B['cast'][c]['refs'])
            who = B['cast'][c]['text'].split(':')[0]
            span = f'@Image{n}' if k == 1 else f'@Image{n} to @Image{n + k - 1}'
            refs.append(f'{span}: {who} (character reference only, not a frame).')
            n += k
    head = ' '.join(refs)
    if not has_previs:
        head = ('Keep exactly the art style, the drawing, the character and the colours of the '
                'first frame; it moves, it is not redrawn.')
    if has_previs:
        head += (' @Video1 is a grey 3D blocking of the same moment: take from it only the '
                 'positions, the timing, which way each figure faces, where each foot stands and '
                 'the camera; never its grey look.')
    body = (
        f"{head}\n\n{cast}\n\n"
        f"Physics: {B['physics']} There are no grey or pale mannequins, statues or ghost figures "
        f"anywhere, and each person appears once.\n\n"
        + '\n'.join(lines)
        + f"\n\nCamera: {t['camera']}\n\n{B['style']}"
    )
    return body


def stage_previs(t):
    if 'image' in t:
        print(t['id'], 'image take: no previs')
        return
    d = tdir(t)
    f0 = round(t['range'][0] * FPS)
    f1 = f0 + duration(t) * FPS - 1
    sub = f'take_{t["id"]}'
    cam = ['--camshot', t['camshot']] if 'camshot' in t else ['--fixcam', str(t['fixcam'])]
    run([BLENDER, '-b', '-P', f'tools/cutscene/unwritten/previs3d/{a.board}_scene.py', '--', *cam,
         '--frames', f'{f0}-{f1}', '--sub', sub, '--size', '1280x720'], timeout=3600)
    src = os.path.join(ROOT, f'References/cutscene/previs3d/{a.board}', sub)
    run(['ffmpeg', '-loglevel', 'error', '-y', '-framerate', str(FPS), '-start_number', str(f0),
         '-i', os.path.join(src, '%04d.png'), '-frames:v', str(f1 - f0 + 1), '-c:v', 'libx264',
         '-pix_fmt', 'yuv420p', '-crf', '16', os.path.join(d, 'previs.mp4')])
    # the key frame: the first, or `keyAt` (piece time) for a shot that opens on empty sky
    fk = round(t.get('keyAt', t['range'][0]) * FPS)
    shutil.copy(os.path.join(src, f'{fk:04d}.png'), os.path.join(d, 'first.png'))
    print(t['id'], 'previs', rel(os.path.join(d, 'previs.mp4')))


KEY_PROMPT = """Image 1 is a grey 3D blocking render of the first frame of a shot. Redraw it as a finished illustration. Keep exactly its camera, framing, the figures' positions and sizes in the frame, their poses, which way each one faces (the yellow marks show each figure's front), where each foot stands, what each one sits on, and where the weapons and props are. Do not move the camera.

{cast}

{legend}

{place}

{style}"""


def stage_keys(t):
    if 'image' in t:
        print(t['id'], 'image take: its key is', t['image'])
        return
    d = tdir(t)
    if not a.force and any(f.startswith('key_') and f.endswith('.png') for f in os.listdir(d)):
        print(t['id'], 'keys exist (--force to redraw)')
        return
    first = os.path.join(d, 'first.png')
    if not os.path.exists(first):
        raise SystemExit(f'{t["id"]}: run previs first')
    cast = ' '.join(B['cast'][c]['text'] for c in t['cast'])
    refs = ([rel(first)] + [r for c in t['cast'] for r in B['cast'][c]['refs']] + t.get('keyRefs', [])
            + [B['place']])
    who = '; '.join(B['cast'][c]['mannequin'] for c in t['cast'])
    legend = (f'In Image 1, {who}. Draw only these people, each exactly where and how its '
              f'mannequin stands or sits; draw no mannequins, no ghost or pale figures, and no '
              f'other people. {B["keyLegend"]}')
    if t.get('keyNote'):
        legend += ' ' + t['keyNote']
    prompt = KEY_PROMPT.format(cast=cast, style=B['style'], legend=legend, place=B['keyPlace'])
    jobs = []
    for m in a.models.split(','):
        if m == 'nbp':
            ep = 'fal-ai/nano-banana-pro/edit'
            inp = {'prompt': prompt, 'image_urls': refs, 'aspect_ratio': '16:9', 'resolution': '2K',
                   'num_images': 2, 'output_format': 'png', 'limit_generations': False}
        elif m == 'sd5':
            ep = 'bytedance/seedream/v5/pro/edit'
            inp = {'prompt': prompt, 'image_urls': refs, 'image_size': 'landscape_16_9',
                   'num_images': 2, 'output_format': 'png'}
        else:
            raise SystemExit(f'unknown model {m}')
        jf = os.path.join(d, f'key_{m}.json')
        json.dump(inp, open(jf, 'w'), indent=1)
        jobs.append(subprocess.Popen(['node', FAL, ep, jf, '--out', d, '--name', f'key_{m}'],
                                     cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                     text=True))
    for j in jobs:
        out, err = j.communicate()
        print(t['id'], out.strip() or err[-500:])


def stage_motion(t):
    d = tdir(t)
    key = t.get('image') or os.path.join(d, 'key.png')
    if not os.path.exists(os.path.join(ROOT, key) if not os.path.isabs(key) else key):
        raise SystemExit(f'{t["id"]}: choose a key first (copy a candidate to {rel(key)})')
    prompt = prompt_for(t)
    cast_refs = [r for c in t['cast'] for r in B['cast'][c]['refs']]
    res = '720p' if a.final else '480p'
    name = f'motion_{res}{a.tag}'
    if 'image' in t:
        ep = 'bytedance/seedance-2.5/image-to-video'
        inp = {'prompt': prompt, 'image_url': key, 'duration': str(duration(t)),
               'resolution': res, 'generate_audio': False}
    else:
        ep = 'bytedance/seedance-2.5/reference-to-video'
        inp = {'prompt': prompt, 'image_urls': [rel(key)] + cast_refs,
               'video_urls': [rel(os.path.join(d, 'previs.mp4'))],
               'duration': str(duration(t)), 'resolution': res, 'aspect_ratio': '16:9',
               'generate_audio': False}
    if not a.final:
        inp['draft'] = True
    jf = os.path.join(d, f'{name}.json')
    json.dump(inp, open(jf, 'w'), indent=1)
    out = run(['node', FAL, ep, jf, '--out', d, '--name', name], timeout=3600)
    print(t['id'], out.strip())


def stage_sheet(t):
    d = tdir(t)
    vids = sorted(f for f in os.listdir(d) if f.startswith('motion_') and f.endswith('.mp4'))
    if not vids:
        raise SystemExit(f'{t["id"]}: no motion yet')
    for v in vids:
        src = os.path.join(d, v)
        dur = duration(t)
        fps = 12 / dur
        sheet = os.path.join(d, v.replace('.mp4', '_sheet.png'))
        inputs = ['-i', src]
        filt = f'[0]fps={fps:.4f},scale=480:-1,tile=4x3[m]'
        if os.path.exists(os.path.join(d, 'previs.mp4')):
            inputs += ['-i', os.path.join(d, 'previs.mp4')]
            filt += f';[1]fps={fps:.4f},scale=480:-1,tile=4x3[p];[m][p]vstack'
        else:
            filt += ';[m]null'
        run(['ffmpeg', '-loglevel', 'error', '-y', *inputs, '-filter_complex', filt, '-frames:v',
             '1', sheet])
        print(t['id'], rel(sheet))


for t in takes:
    if a.stage == 'prompt':
        print(f'===== {t["id"]} {t["name"]} ({duration(t)} s)\n{prompt_for(t)}\n')
    else:
        globals()[f'stage_{a.stage}'](t)
