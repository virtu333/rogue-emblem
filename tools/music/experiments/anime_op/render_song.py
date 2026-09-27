"""Render the OP as an audition: its own stem cache, its own output folder, no game assets.

  python3 tools/music/experiments/anime_op/render_song.py            # round 1, guitar version
  python3 tools/music/experiments/anime_op/render_song.py --edm      # round 2, J-rock x EDM
  ... [--stems]                                                      # also each processed stem

Writes <OUT>/anime_op[_edm].mp3 and <OUT>/anime_op[_edm]_backing.mp3 (no lead guitar
and no doubling of the tune: the bed for a sung version); OUT is $ANIME_OP_OUT or
References/music-lab/anime_op (see paths.py).
"""
import argparse
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from paths import MUSIC, OUT_DIR  # noqa: E402

os.environ.setdefault('MUSIC_CACHE', os.path.join(OUT_DIR, 'cache'))
sys.path.insert(0, MUSIC)

import numpy as np            # noqa: E402
import soundfile as sf        # noqa: E402

from engine import dsp        # noqa: E402
from engine.form import check_form   # noqa: E402
from engine.render import Renderer   # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--edm', action='store_true', help='round 2 (J-rock x EDM)')
ap.add_argument('--stems', action='store_true', help='also write each processed stem (wav)')
args = ap.parse_args()
if args.edm:
    import anime_op_edm as song  # noqa: E402
    names = (('full', 'anime_op_edm'), ('backing', 'anime_op_edm_backing'))
else:
    import anime_op as song  # noqa: E402
    names = (('full', 'anime_op'), ('backing', 'anime_op_backing'))

s = song.build()
probs = check_form(s)
if probs:
    raise SystemExit('\n'.join(probs))
print('form check: ok')
r = Renderer(s)
stems = r.stems()
# the TV-size cut: 0.7 s after the last hit (bar 56 beat 1, plus the held half beat)
cut = int(s.seconds(s.bar(56) + 0.5) * dsp.SR + 0.7 * dsp.SR)
end = None
for var, fname in names:
    y = r.mix(stems, var)
    end = min(r.one_shot_end(y), cut)
    f = y[:end].copy()
    fade = int(0.3 * dsp.SR)
    f[-fade:] *= np.linspace(1, 0, fade, dtype=np.float32)[:, None]
    wav = os.path.join(OUT_DIR, fname + '.wav')
    sf.write(wav, f, dsp.SR, subtype='PCM_24')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-c:a', 'libmp3lame',
                    '-q:a', '2', os.path.join(OUT_DIR, fname + '.mp3')], check=True)
    print(var, fname, 'duration', round(len(f) / dsp.SR, 2), 's')
if args.stems:
    sd = os.path.join(OUT_DIR, 'stems_' + names[0][1])
    os.makedirs(sd, exist_ok=True)
    for name, (x, send) in stems.items():
        g = dsp.undb(s.parts[name].opts.get('gain', 0.0))
        sf.write(os.path.join(sd, name + '.wav'), (x * g)[:end], dsp.SR, subtype='PCM_16')
