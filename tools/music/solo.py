#!/usr/bin/env python3
"""Export a mix of only some parts (for auditioning / critique).

  python3 tools/music/solo.py battle_act1 kit ebass --start 6 --dur 30 --out /tmp/x.mp3

Sound-lab options (all optional; without them this is the tool it always was):

  --bars 5 13             render only bars 5-12 (an excerpt; much cheaper than the loop)
  --palette lab:choir     render through the lab palette (engine/palette.py)
  --variant full          start from a mix variant's gains; parts '*' = every part it plays
  --bitrate 192           constant-bitrate MP3 (default: VBR quality 2)
  --tail 3                seconds of ring-out kept after the excerpt's last bar
  --list-palette          print the lab candidates and exit
  --why                   print the performer's articulation decisions for lab solo lines

  python3 tools/music/solo.py title solo --bars 5 13 --palette lab:solo_violin=sso --out v.mp3
  python3 tools/music/solo.py boss_emperor '*' --variant full --bars 9 17 --out a.mp3
"""

from __future__ import annotations

import argparse
import fnmatch
import importlib
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402

from engine import dsp, palette  # noqa: E402
from engine.dsp import SR  # noqa: E402
from engine.instruments import INSTRUMENTS  # noqa: E402
from engine.render import Renderer, _variant_gain, write_audio  # noqa: E402


def normalize(y, target, ceiling_db=-1.0):
    """Integrated loudness to `target` LUFS under a true-peak ceiling."""
    for _ in range(4):
        cur = dsp.lufs(y)
        y = dsp.limit(y * dsp.undb(target - cur), ceiling_db=ceiling_db)
        if abs(dsp.lufs(y) - target) < 0.1:
            break
    return y


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('score', nargs='?')
    ap.add_argument('parts', nargs='*')
    ap.add_argument('--start', type=float, default=0)
    ap.add_argument('--dur', type=float, default=40)
    ap.add_argument('--out')
    ap.add_argument('--lufs', type=float, default=-16)
    ap.add_argument('--bars', type=float, nargs=2)
    ap.add_argument('--palette')
    ap.add_argument('--variant')
    ap.add_argument('--bitrate', type=int)
    ap.add_argument('--tail', type=float, default=3.0)
    ap.add_argument('--list-palette', action='store_true')
    ap.add_argument('--why', action='store_true')
    args = ap.parse_args()
    if args.list_palette:
        for inst, cands in palette.CANDIDATES.items():
            for name, c in cands.items():
                print(f'{inst}={name:18s} {c["label"]}\n    {c["what"]}')
        return
    if not args.score or not args.parts or not args.out:
        ap.error('score, parts and --out are required')
    if args.palette is not None:
        palette.request(args.palette)
    lab = True
    s = importlib.import_module(f'scores.{args.score}').build()
    if args.bars:
        from engine.excerpt import excerpt
        s = excerpt(s, *args.bars)
    # which parts: named ones (globs allowed) or '*', optionally within a variant
    base = s.variants.get(args.variant, {}) if args.variant else None
    names = [n for n in s.parts if any(fnmatch.fnmatch(n, p) for p in args.parts)]
    if base is not None:
        names = [n for n in names if _variant_gain(base, n) is not None]
    gains = {'*': None}
    for n in names:
        gains[n] = _variant_gain(base, n) if base is not None else 0.0
    s.variant('solo', gains, lufs=args.lufs)
    r = Renderer(s, verbose=lab)
    print(palette.describe(), '|', ', '.join(names))
    if args.why:
        from engine import labrender, perform
        for n in names:
            inst = INSTRUMENTS[s.parts[n].inst]
            if inst.get('kind') != 'lab' or not s.parts[n].notes:
                continue
            intro, loop = r._events(s.parts[n], inst)
            mode = inst['lab'].get('perform')
            if mode == 'line' or (mode == 'auto' and labrender.is_line(intro + loop)):
                for p in perform.perform_line(s, intro + loop, 0,
                                              style=inst['lab'].get('style', 'full')):
                    print(f'  {n:10s} t={p.t_on:7.3f} key={p.key:3d} {p.stream:5s} vel={p.vel:3d} '
                          f'{p.why}')
    # only the chosen parts are rendered (each stem is independent of the others)
    stems = {k: r._process_part(s.parts[k], r.render_part(s.parts[k]))
             for k in names if s.parts[k].notes}
    y = r.mix(stems, 'solo')
    if args.bars:
        # the excerpt, its ring-out, and a short fade
        y = y[:min(len(y), r.I_f + int(args.tail * SR))].copy()
        f = min(int(0.4 * SR), len(y))
        y[-f:] *= np.linspace(1, 0, f, dtype=np.float32)[:, None]
    else:
        a = int(args.start * SR)
        y = y[a:a + int(args.dur * SR)]
    if args.bars or args.palette is not None or args.variant or args.bitrate:
        # audition files are compared side by side: level the file itself
        y = normalize(y, args.lufs)
    if args.bitrate:
        import subprocess

        import soundfile as sf

        def encode(z):
            tmp = args.out + '.tmp.wav'
            sf.write(tmp, z, SR, subtype='PCM_24')
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', tmp, '-c:a', 'libmp3lame',
                            '-b:a', f'{args.bitrate}k', '-ar', str(SR), args.out], check=True)
            os.remove(tmp)
            raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', args.out, '-f', 'f32le',
                                  '-ac', '2', '-ar', str(SR), '-'], capture_output=True,
                                 check=True).stdout
            return dsp.lufs(np.frombuffer(raw, np.float32).reshape(-1, 2))

        # level what the listener decodes (the encoder moves loudness a little)
        got = encode(y)
        if abs(got - args.lufs) > 0.1:
            y = normalize(y, args.lufs + (args.lufs - got))
            encode(y)
    else:
        write_audio(args.out, y, quality=2)
    print('wrote', args.out, f'({len(y) / SR:.1f} s)')


if __name__ == '__main__':
    main()
