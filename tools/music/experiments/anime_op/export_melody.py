import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..', '..')))
from paths import OUT_DIR  # noqa: E402
import melody as M  # noqa: E402

lines = {
    'VERSE': ['はいのふるまちで', 'めをさました', 'きのうのつづきを', 'だれもおぼえてない',
              'くずれたはたのした', 'ひえたゆびさき', 'それでもきみは', 'まえをみていた'],
    'PRE': ['みえないあしたを', 'みつめるひとみが', 'くらやみのなかで', 'ただひとつ', 'ともってた'],
    'CHORUS': ['かけたたいようを', 'せにしてはしれ', 'ほどけそうな', 'きんのいとをにぎって',
               'なんどたおれても', 'なんどでも', 'なもないよあけを', 'うばいにいけ'],
    'TAG_LINE': ['なもないよあけを', 'うばいにいけ'],
    'OUTRO': ['まだ', 'おわらない'],
}
ok = True
for k, ls in lines.items():
    got = ''.join(m for *_, m in getattr(M, k))
    want = ''.join(ls)
    good = got == want
    ok &= good
    print(k, len(got), len(want), 'OK' if good else f'MISMATCH\n {got}\n {want}')
ns = M.notes()
print('notes', len(ns), 'range', min(n[2] for n in ns), max(n[2] for n in ns),
      'last end beat', ns[-1][0] + ns[-1][1])
assert ok
out = {
    'bpm': M.BPM, 'key': 'E minor', 'time_signature': '4/4',
    'modulation': {'start_beat': 192, 'key': 'F minor', 'note': 'tag, bars 49-56'},
    'notes': [{'pitch': p, 'start_beat': t, 'beats': d, 'lyric': m} for t, d, p, m in ns],
}
with open(os.path.join(OUT_DIR, 'melody.json'), 'w') as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
print('wrote melody.json')
