#!/usr/bin/env python3
"""Keep drawings a..b (inclusive) of a packed clip atlas, same cells, fewer frames (smaller file).

    python3 tools/cutscene/unwritten/motion/trim_atlas.py camp_edric_rise 24 61

The drawings are renumbered from 0. The cell size, anchor and scale are unchanged, so the
measured metres-per-pixel stay valid; the first kept drawing is frame 0 in the new atlas.
"""
import json, os, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, '../../../../docs/art-direction/anime-op/motion'))

name, a, b = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
meta = json.load(open(f'{OUT}/{name}.json'))
im = Image.open(f'{OUT}/{name}.webp').convert('RGBA')
cw, ch = meta['cell']
cols = meta['cols']
keep = list(range(a, b + 1))
rows = (len(keep) + cols - 1) // cols
new = Image.new('RGBA', (cols * cw, rows * ch), (0, 0, 0, 0))
for k, f in enumerate(keep):
    cell = im.crop(((f % cols) * cw, (f // cols) * ch, (f % cols + 1) * cw, (f // cols + 1) * ch))
    new.paste(cell, ((k % cols) * cw, (k // cols) * ch))
new.save(f'{OUT}/{name}.webp', 'WEBP', quality=84, alpha_quality=100, method=6)
meta['frames'] = len(keep)
meta['trimmed'] = [a, b]
json.dump(meta, open(f'{OUT}/{name}.json', 'w'), indent=1)
print(f'{name}: kept {a}..{b} ({len(keep)} drawings), {os.path.getsize(f"{OUT}/{name}.webp") // 1024} KB')
