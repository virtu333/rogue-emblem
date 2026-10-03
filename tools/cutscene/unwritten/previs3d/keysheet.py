"""Tile a take's previs key frame and its key candidates, labelled, for choosing a key.
    .venv-cutscene/bin/python tools/cutscene/unwritten/previs3d/keysheet.py ford L [camp CS ...]"""
import os, sys
from PIL import Image, ImageDraw, ImageFont
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../..'))
F = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 22)
args = sys.argv[1:]
for board, tid in zip(args[::2], args[1::2]):
    d = os.path.join(ROOT, 'References/cutscene/takes', board, tid)
    files = ['first.png'] + sorted(f for f in os.listdir(d) if f.startswith('key_') and f.endswith('.png'))
    cw, ch = 800, 450
    cols = 3
    rows = (len(files) + cols - 1) // cols
    c = Image.new('RGB', (cw * cols, ch * rows), (30, 30, 34))
    dr = ImageDraw.Draw(c)
    for i, f in enumerate(files):
        im = Image.open(os.path.join(d, f)).convert('RGB').resize((cw, ch))
        x, y = (i % cols) * cw, (i // cols) * ch
        c.paste(im, (x, y))
        lab = 'previs' if f == 'first.png' else f'{tid}-' + f[4:-4].replace('_', '')
        dr.rectangle((x, y, x + 14 * len(lab) + 16, y + 32), fill=(0, 0, 0))
        dr.text((x + 8, y + 4), lab, font=F, fill=(255, 230, 120))
    out = os.path.join(ROOT, 'References/cutscene/takes/_qa', f'keys_{board}_{tid}.jpg')
    c.save(out, quality=85)
    print(out)
