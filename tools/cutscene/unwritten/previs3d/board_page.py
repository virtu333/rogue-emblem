"""A storyboard sheet (e-konte) for a board's takes, as one self-contained HTML page: per take
its previs strip, its action to the second, its camera, the key candidates and the motion
prompt. Images are embedded as small JPEGs.

    .venv-cutscene/bin/python tools/cutscene/unwritten/previs3d/board_page.py ford camp \
        --out References/cutscene/takes/board.html
"""

import argparse
import base64
import html
import io
import json
import os
import subprocess
import sys

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../..'))
ap = argparse.ArgumentParser()
ap.add_argument('boards', nargs='+')
ap.add_argument('--out', default=os.path.join(ROOT, 'References/cutscene/takes/board.html'))
a = ap.parse_args()

TITLES = {
    'ford': ('The Ford', 'Bars 28.3–36 · 13.6 s · Edric crosses under the Hollow Sun, fights the Warden in the river and loses.'),
    'camp': ('The Night Before', 'Bars 5–12 · 12.8 s · Three at the fire on the last quiet night; a look crosses the fire and Edric rises.'),
}


def jpg(path, w=640, q=78):
    im = Image.open(path).convert('RGB')
    if im.width > w:
        im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    b = io.BytesIO()
    im.save(b, 'JPEG', quality=q, optimize=True)
    return 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode()


def strip(video, n=4, w=300):
    """n frames across a video, as data URIs."""
    out = []
    dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                                '-of', 'csv=p=0', video], capture_output=True, text=True).stdout)
    for k in range(n):
        t = dur * (k + 0.5) / n
        r = subprocess.run(['ffmpeg', '-loglevel', 'error', '-ss', f'{t:.3f}', '-i', video,
                            '-frames:v', '1', '-vf', f'scale={w}:-1', '-f', 'image2pipe',
                            '-vcodec', 'mjpeg', '-q:v', '5', '-'], capture_output=True)
        out.append(('data:image/jpeg;base64,' + base64.b64encode(r.stdout).decode(), t))
    return out


def prompt_of(board, tid):
    r = subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), 'takes.py'),
                        'prompt', tid, '--board', board], capture_output=True, text=True, cwd=ROOT)
    return r.stdout.split('\n', 1)[1].strip() if r.returncode == 0 else ''


E = html.escape
sections = []
toc = []
n_keys = 0
for board in a.boards:
    B = json.load(open(os.path.join(ROOT, f'tools/cutscene/unwritten/boards/{board}.json')))
    title, sub = TITLES.get(board, (board, ''))
    toc.append(f'<a href="#{board}">{E(title)}</a>')
    rows = []
    for t in B['takes']:
        d = os.path.join(ROOT, f'References/cutscene/takes/{board}', t['id'])
        r0, r1 = t['range']
        frames = ''
        pv = os.path.join(d, 'previs.mp4')
        if os.path.exists(pv):
            frames = ''.join(
                f'<figure><img src="{u}" alt="previs at {r0 + tt:.1f} s" loading="lazy">'
                f'<figcaption>{r0 + tt:.1f} s</figcaption></figure>' for u, tt in strip(pv))
        elif 'image' in t:
            frames = (f'<figure class="one"><img src="{jpg(os.path.join(ROOT, t["image"]))}" '
                      f'alt="first frame"><figcaption>first frame: {E(os.path.basename(t["image"]))}'
                      f'</figcaption></figure>')
        keys = []
        if os.path.isdir(d):
            for f in sorted(os.listdir(d)):
                if f.startswith('key_') and f.endswith('.png'):
                    label = f'{t["id"]}-' + f[4:-4].replace('_', '')
                    model = 'Nano Banana Pro' if 'nbp' in f else 'Seedream 5'
                    keys.append(f'<figure class="key"><img src="{jpg(os.path.join(d, f), 720)}" '
                                f'alt="key {label}" loading="lazy"><figcaption><b>{E(label)}</b> '
                                f'{model}</figcaption></figure>')
        n_keys += len(keys)
        acts = ''.join(
            f'<tr><td class="tc">{r0 + x0:.1f}–{r0 + x1:.1f}</td><td>{E(txt)}</td></tr>'
            for x0, x1, txt in t['action'])
        cuts = ' · '.join(E(c) for c in t['cuts'])
        dur = max(4, -(-(r1 - r0) // 1))
        prompt = prompt_of(board, t['id'])
        rows.append(f"""
<article class="take" id="{board}-{t['id']}">
  <header class="th">
    <span class="tid">{E(t['id'])}</span>
    <h3>{E(t['name'])}</h3>
    <span class="meta">{r0:.1f}–{r1:.1f} s · take {int(dur)} s · cuts: {cuts}</span>
  </header>
  <div class="strip">{frames or '<p class="empty">Previs not rendered yet.</p>'}</div>
  <div class="body">
    <table class="act"><thead><tr><th>Piece time (s)</th><th>Action → reaction</th></tr></thead><tbody>{acts}</tbody></table>
    <p class="cam"><span>Camera</span> {E(t['camera'])}</p>
  </div>
  <div class="keys">{''.join(keys) or '<p class="empty">Keys not drawn yet.</p>'}</div>
  <details><summary>Motion prompt (Seedance 2.5)</summary><pre>{E(prompt)}</pre></details>
</article>""")
    code = ''.join(f'<li><b>{E(c["cut"])}</b>: {E(c["what"])}</li>' for c in B.get('code', []))
    sections.append(f"""
<section class="board" id="{board}">
  <h2>{E(title)}</h2>
  <p class="sub">{E(sub)}</p>
  {''.join(rows)}
  <aside class="code"><span>Drawn in code, not generated</span><ul>{code}</ul></aside>
</section>""")

page = f"""<title>Opening Storyboard</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&family=Spectral:ital,wght@0,400;0,600;1,400&family=JetBrains+Mono:wght@400;600&display=swap">
<style>
/* Layout: a production storyboard sheet; each take is a row of previs frames, the timed action, then the key candidates to choose from. */
:root {{
  --paper: #e4e0d8; --sheet: #efece6; --ink: #2a2520; --muted: #6b6258; --rule: #c9c2b6;
  --gold: #9a7420; --crimson: #8a2b24;
  --display: 'Cinzel', 'Trajan Pro', Georgia, serif;
  --body: 'Spectral', Georgia, 'Times New Roman', serif;
  --mono: 'JetBrains Mono', ui-monospace, Menlo, monospace;
}}
@media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{
  --paper: #18171b; --sheet: #211f24; --ink: #e8e2d6; --muted: #a59c8f; --rule: #3a363d;
  --gold: #d4b062; --crimson: #d0675c; color-scheme: dark; }} }}
:root[data-theme="dark"] {{
  --paper: #18171b; --sheet: #211f24; --ink: #e8e2d6; --muted: #a59c8f; --rule: #3a363d;
  --gold: #d4b062; --crimson: #d0675c; color-scheme: dark; }}
body {{ background: var(--paper); color: var(--ink); font: 400 15px/1.55 var(--body); padding: 0 16px; }}
.wrap {{ max-width: 1200px; margin: 0 auto; padding-block: 28px 64px; display: grid; gap: 28px; }}
h1, h2, h3 {{ font-family: var(--display); text-wrap: balance; margin: 0; letter-spacing: .02em; }}
h1 {{ font-size: 1.9rem; font-weight: 700; }}
h2 {{ font-size: 1.45rem; font-weight: 700; border-bottom: 2px solid var(--ink); padding-bottom: 6px; }}
h3 {{ font-size: 1.02rem; font-weight: 500; }}
.lede {{ max-width: 68ch; color: var(--muted); margin: 6px 0 0; }}
.how {{ display: grid; gap: 6px; max-width: 76ch; padding: 14px 16px; border: 1px solid var(--rule); background: var(--sheet); }}
.how b {{ color: var(--gold); }}
nav {{ display: flex; gap: 18px; flex-wrap: wrap; font-family: var(--mono); font-size: .8rem; text-transform: uppercase; letter-spacing: .08em; }}
nav a {{ color: var(--ink); }}
.board {{ display: grid; gap: 18px; }}
.sub {{ margin: -8px 0 0; color: var(--muted); font-style: italic; }}
.take {{ background: var(--sheet); border: 1px solid var(--rule); padding: 14px; display: grid; gap: 12px; min-width: 0; }}
.th {{ display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }}
.tid {{ font-family: var(--mono); font-weight: 600; font-size: .85rem; color: var(--sheet); background: var(--ink); padding: 2px 8px; }}
.meta {{ font-family: var(--mono); font-size: .76rem; color: var(--muted); font-variant-numeric: tabular-nums; }}
.strip {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 6px; }}
.strip figure, .keys figure {{ margin: 0; display: grid; gap: 3px; min-width: 0; }}
.strip img, .keys img {{ width: 100%; height: auto; display: block; border: 1px solid var(--rule); }}
.strip figcaption {{ font-family: var(--mono); font-size: .7rem; color: var(--muted); }}
.strip .one {{ max-width: 420px; }}
.body {{ display: grid; gap: 8px; min-width: 0; }}
.act {{ border-collapse: collapse; width: 100%; font-size: .93rem; }}
.act th {{ text-align: left; font-family: var(--mono); font-size: .68rem; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); font-weight: 400; border-bottom: 1px solid var(--rule); padding: 4px 6px; }}
.act td {{ padding: 5px 6px; vertical-align: top; border-bottom: 1px dotted var(--rule); }}
.act .tc {{ font-family: var(--mono); font-size: .78rem; white-space: nowrap; font-variant-numeric: tabular-nums; color: var(--crimson); width: 1%; }}
.cam {{ margin: 0; font-size: .92rem; }}
.cam span {{ font-family: var(--mono); font-size: .68rem; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin-right: 6px; }}
.keys {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 10px; }}
.keys figcaption {{ font-size: .82rem; color: var(--muted); }}
.keys figcaption b {{ font-family: var(--mono); color: var(--gold); }}
details summary {{ cursor: pointer; font-family: var(--mono); font-size: .76rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }}
details summary:focus-visible, nav a:focus-visible {{ outline: 2px solid var(--gold); outline-offset: 2px; }}
pre {{ white-space: pre-wrap; font: 400 .8rem/1.5 var(--mono); background: var(--paper); border: 1px solid var(--rule); padding: 10px; overflow-x: auto; margin: 8px 0 0; }}
.empty {{ margin: 0; color: var(--muted); font-style: italic; }}
.code {{ border-left: 3px solid var(--gold); padding: 4px 12px; }}
.code span {{ font-family: var(--mono); font-size: .7rem; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }}
.code ul {{ margin: 4px 0 0; padding-left: 18px; }}
</style>
<div class="wrap">
  <header>
    <h1>Opening Storyboard</h1>
    <p class="lede">Generated frames for “Again”. Each take is one generated clip seen through one camera; the edit cuts between takes on the score. The grey frames are the 3D blocking (yellow marks each figure’s front); the keys are drawn from them.</p>
  </header>
  <div class="how">
    <span><b>To approve:</b> reply with one key per take (for example <b>M-nbp1</b>) or what to change.</span>
    <span>Then each take is generated as a 480p draft from its key, the blocking video and the prompt below it, checked frame by frame, and redone at 720p once it reads.</span>
  </div>
  <nav>{''.join(toc)}</nav>
  {''.join(sections)}
</div>
"""
os.makedirs(os.path.dirname(a.out), exist_ok=True)
open(a.out, 'w').write(page)
print(a.out, f'{os.path.getsize(a.out) / 1e6:.1f} MB', f'{n_keys} keys')
