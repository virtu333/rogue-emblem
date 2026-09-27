"""Round 2: melody_v2.json (the sung line without the tag's repeated line, whose
bars now hold the chop drop) and chops.json."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..', '..')))
from paths import OUT_DIR  # noqa: E402
import melody as M  # noqa: E402

OUT = OUT_DIR
ns = M.notes(tag=False)
v1 = M.notes(tag=True)
# the timeline is unchanged: every v2 note is a v1 note at the same beat
assert set(ns) <= set(v1) and len(v1) - len(ns) == 14
with open(os.path.join(OUT, 'melody_v2.json'), 'w') as f:
    json.dump({
        'bpm': M.BPM, 'key': 'E minor', 'time_signature': '4/4',
        'modulation': {'start_beat': 192, 'key': 'F minor', 'note': 'bars 49-56'},
        'changes_from_v1': 'Same timeline and beats. The tag\'s repeated line (名もない夜明けを '
                           '奪いに行け, beats 187-207.5) is removed: bars 49-52 (beats 192-208) '
                           'are the vocal-chop drop (chops.json). Everything else is identical.',
        'notes': [{'pitch': p, 'start_beat': t, 'beats': d, 'lyric': m} for t, d, p, m in ns],
    }, f, ensure_ascii=False, indent=1)
chops = [{'lyric': m, 'pitch': p, 'start_beat': t, 'beats': d, 'fx': fx}
         for t, d, p, m, fx in M.chop_notes()]
with open(os.path.join(OUT, 'chops.json'), 'w') as f:
    json.dump(chops, f, ensure_ascii=False, indent=1)
print('melody_v2:', len(ns), 'notes; chops:', len(chops), 'from beat', chops[0]['start_beat'],
      'to', chops[-1]['start_beat'] + chops[-1]['beats'])
