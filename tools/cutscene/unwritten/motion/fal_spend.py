"""What fal.ai has cost so far, estimated from References/cutscene/fal/spend.jsonl (fal.mjs logs
every submission) and fal's published unit prices. The API key cannot read the account balance.

    python3 tools/cutscene/unwritten/motion/fal_spend.py
"""

import json
import os
from collections import defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../..'))
LOG = os.path.join(ROOT, 'References/cutscene/fal/spend.jsonl')

# Seedance bills tokens: (width x height x fps x seconds) / 1024 at $0.0214 per 1000 tokens
SIZE = {'480p': (854, 480), '720p': (1280, 720), '1080p': (1920, 1080)}


def cost(e):
    ep = e['endpoint']
    n = e.get('num_images') or 1
    if 'nano-banana-pro' in ep:
        return 0.15 * n * (2 if e.get('resolution') == '4K' else 1)
    if 'seedream' in ep:
        return 0.0675 * n
    if 'seedance-2.5' in ep:
        w, h = SIZE['480p' if e.get('draft') else e.get('resolution') or '720p']
        sec = float(e.get('duration') or 5)
        return w * h * 24 * sec / 1024 / 1000 * 0.0214
    if 'kling' in ep and 'motion-control' in ep:
        return 0.168 * float(e.get('duration') or 5)
    if 'veo3.1' in ep:
        return 0.4 * float(e.get('duration') or 8)
    return 0.0


by = defaultdict(lambda: [0, 0.0])
total = 0.0
for line in open(LOG):
    e = json.loads(line)
    c = cost(e)
    k = e['endpoint'].split('/')[-2] + '/' + e['endpoint'].split('/')[-1]
    by[k][0] += 1
    by[k][1] += c
    total += c
for k, (n, c) in sorted(by.items(), key=lambda x: -x[1][1]):
    print(f'{k:42s} {n:4d} calls  ${c:7.2f}')
print(f'{"total (estimate)":42s}             ${total:7.2f}')
