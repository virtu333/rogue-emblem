#!/usr/bin/env python3
"""Render the suite: its own stem cache, its own output folder, no game assets.

  python3 tools/music/experiments/ocarina_bosses/render.py dark_link        # one piece
  python3 tools/music/experiments/ocarina_bosses/render.py --all            # all five
  ... dark_link --bars 53 69            # an excerpt (bars 53-68), as <name>_x53_69.mp3
  ... dark_link --parts 'hero*' water   # only those parts (globs), as <name>_solo.mp3
  ... dark_link --check                 # form check and a semitone-clash lint, no audio

For each piece it writes, to OUT (see paths.py):

  <name>.mp3        the listening cut: the intro, the loop once, then the loop's
                    opening again, fading (what a soundtrack album prints)
  <name>_loop.mp3   the game-ready file: intro, then a seamless loop region
  loops.json        each loop file's loopStart / loopEnd / duration (seconds)

The engine's measured tables (onset compensation, level calibration) are copied to
OUT/tables and read and written there, so the suite's extra instruments never add
entries to the game's own tables.
"""

from __future__ import annotations

import argparse
import fnmatch
import importlib
import json
import os
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from paths import OUT_DIR  # noqa: E402

os.environ.setdefault('MUSIC_CACHE', os.path.join(OUT_DIR, 'cache'))
import kit  # noqa: E402,F401  (registers the suite's instruments, sets sys.path)

import numpy as np            # noqa: E402
import soundfile as sf        # noqa: E402

from engine import dsp, onsets  # noqa: E402
from engine import render as R  # noqa: E402
from engine.excerpt import excerpt  # noqa: E402
from engine.form import check_form  # noqa: E402
from engine.render import Renderer, _variant_gain, seam_error_db  # noqa: E402
from engine.theory import name as pitch_name  # noqa: E402

PIECES = ['dark_link', 'phantom_ganon', 'volvagia', 'bongo_bongo', 'twinrova']
ALBUM = 'Five Rooms: boss themes for an ocarina (unofficial fan suite)'
ARTIST = 'composed in code (Rogue Dawn music engine)'
SR = dsp.SR


def private_tables():
    """The suite keeps its own copies of the engine's measured tables."""
    d = os.path.join(OUT_DIR, 'tables')
    os.makedirs(d, exist_ok=True)
    for mod, attr in ((onsets, 'PATH'), (R, 'CALIB_PATH')):
        src = os.path.abspath(getattr(mod, attr))
        dst = os.path.join(d, os.path.basename(src))
        if not os.path.exists(dst):
            shutil.copyfile(src, dst)
        setattr(mod, attr, dst)


def write_mp3(path, y, title, track=None, quality=2):
    wav = path + '.tmp.wav'
    sf.write(wav, y, SR, subtype='PCM_24')
    meta = ['-metadata', f'title={title}', '-metadata', f'artist={ARTIST}',
            '-metadata', f'album={ALBUM}']
    if track:
        meta += ['-metadata', f'track={track}']
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-c:a', 'libmp3lame',
                    '-q:a', str(quality), '-ar', str(SR), *meta, path], check=True)
    os.remove(wav)


def lint(s, min_overlap=1.0):
    """Sustained semitone clashes between parts (tools/music/lint.py's check)."""
    notes = []
    for pname, part in s.parts.items():
        if part.inst in ('orch_perc', 'kit', 'riser', 'reverse', 'taiko', 'boom', 'impact'):
            continue
        for n in part.notes:
            if n.dur >= 1.0:
                notes.append((n.start, n.start + n.dur, n.pitch, pname))
    notes.sort()
    found = {}
    for i, (a0, a1, ap, an) in enumerate(notes):
        for b0, b1, bp, bn in notes[i + 1:]:
            if b0 >= a1:
                break
            if an == bn:
                continue
            ov = min(a1, b1) - max(a0, b0)
            if ov >= min_overlap and abs(ap - bp) % 12 in (1, 11):
                bar = s.bar_at(max(a0, b0)) + 1
                found.setdefault(bar, set()).add(
                    f'{an}:{pitch_name(ap)} x {bn}:{pitch_name(bp)} ({ov:.1f}b)')
    for bar in sorted(found):
        items = sorted(found[bar])
        print(f'  bar {bar:3d}: ' + '; '.join(items[:5]) + (' ...' if len(items) > 5 else ''))
    print(f'  {sum(len(v) for v in found.values())} sustained semitone clashes in {len(found)} bars')


def ranges(s):
    """Every part's notes against its instrument's range (the renderer would refuse)."""
    from engine.instruments import INSTRUMENTS
    bad = 0
    for pname, part in s.parts.items():
        inst = INSTRUMENTS[part.inst]
        if inst.get('fixed_pitch'):
            continue
        lo, hi = inst['range']
        for n in part.notes:
            if not lo <= n.pitch + s.transpose <= hi:
                print(f'  RANGE {pname} ({part.inst} {lo}-{hi}): {pitch_name(n.pitch)} '
                      f'at bar {s.bar_at(n.start) + 1}')
                bad += 1
    end = s.intro_beats + s.loop_beats
    for pname, part in s.parts.items():
        for n in part.notes:
            if n.start >= end - 1e-9:
                print(f'  LATE {pname}: a note at bar {s.bar_at(n.start) + 1}, after the loop ends')
                bad += 1
    return bad


def build(name):
    mod = importlib.import_module(name)
    s = mod.build()
    probs = check_form(s)
    if probs:
        raise SystemExit('\n'.join(['form check failed:', *probs]))
    return mod, s


def render_piece(name, args, table):
    t0 = time.time()
    mod, s = build(name)
    title = getattr(mod, 'TITLE', s.title)
    print(f'[{name}] {title}: {s.intro_bars} + {s.loop_bars} bars, '
          f'{len(s.parts)} parts, {sum(len(p.notes) for p in s.parts.values())} notes')
    if args.check:
        bad = ranges(s)
        lint(s)
        if bad:
            raise SystemExit(f'{bad} notes out of range or late')
        return
    if args.bars:
        s = excerpt(s, *args.bars)
    solo = None
    if args.parts:
        solo = [n for n in s.parts if any(fnmatch.fnmatch(n, p) for p in args.parts)]
        gains = {'*': None}
        gains.update({n: _variant_gain(s.variants.get('full', {}), n) or 0.0 for n in solo})
        s.variant('full', gains, lufs=args.lufs)
    r = Renderer(s)
    if solo is not None:
        stems = {k: r._process_part(s.parts[k], r.render_part(s.parts[k]))
                 for k in solo if s.parts[k].notes}
    else:
        stems = r.stems()
    y = r.mix(stems, 'full')
    suffix = ('_solo' if solo is not None else '')
    if s.one_shot:
        a, b = args.bars
        end = min(len(y), r.I_f + int(3.0 * SR))
        f = y[:end].copy()
        fade = min(int(0.4 * SR), len(f))
        f[-fade:] *= np.linspace(1, 0, fade, dtype=np.float32)[:, None]
        path = os.path.join(OUT_DIR, f'{name}_x{a:g}_{b:g}{suffix}.mp3')
        write_mp3(path, f, f'{title} (bars {a:g}-{b:g})')
        print(f'[{name}] wrote {path} ({len(f) / SR:.1f} s) in {time.time() - t0:.0f}s')
        return
    f = y[: r.file_f]
    ls, le = r.loop_start_f, r.loop_end_f
    seam = seam_error_db(f, ls, le)
    info = {'loopStart': round(ls / SR, 6), 'loopEnd': round(le / SR, 6),
            'duration': round(len(f) / SR, 3), 'lufs': round(dsp.lufs(f[ls:le]), 2),
            'seamDb': round(seam, 1), 'peakDb': round(dsp.db(float(np.abs(f).max())), 2),
            'title': title}
    print(f'[{name}] {info}')
    if solo is None and seam > -45:
        raise RuntimeError(f'{name}: loop seam error {seam:.1f} dB (should be < -45)')
    # the listening cut: intro, the loop once, the loop's opening again, fading
    outro_bars = getattr(mod, 'OUTRO_BARS', 8)
    fade_bars = getattr(mod, 'FADE_BARS', min(outro_bars, 4))
    first = s.intro_bars + 1
    outro = int(round((s.seconds(s.bar(first + outro_bars)) - s.seconds(s.bar(first))) * SR))
    fade = int(round((s.seconds(s.bar(first + outro_bars))
                      - s.seconds(s.bar(first + outro_bars - fade_bars))) * SR))
    outro = min(outro, le - ls)
    cut = np.concatenate([f[:le], f[ls: ls + outro]]).copy()
    fade = min(fade, len(cut))
    cut[-fade:] *= (np.linspace(1, 0, fade, dtype=np.float32) ** 1.6)[:, None]
    track = PIECES.index(name) + 1 if name in PIECES else None
    write_mp3(os.path.join(OUT_DIR, f'{name}{suffix}.mp3'), cut, title, track)
    if solo is None:
        write_mp3(os.path.join(OUT_DIR, f'{name}_loop.mp3'), f, f'{title} (loop)', track)
        table[name] = info
    print(f'[{name}] wrote {name}{suffix}.mp3 ({len(cut) / SR:.1f} s) in {time.time() - t0:.0f}s')
    if args.stems:
        sd = os.path.join(OUT_DIR, f'stems_{name}')
        os.makedirs(sd, exist_ok=True)
        for pname, (x, _send) in stems.items():
            g = dsp.undb(s.parts[pname].opts.get('gain', 0.0))
            sf.write(os.path.join(sd, pname + '.wav'), (x * g)[: r.file_f], SR, subtype='PCM_16')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pieces', nargs='*')
    ap.add_argument('--all', action='store_true')
    ap.add_argument('--bars', type=float, nargs=2, help='render bars A to B-1 as an excerpt')
    ap.add_argument('--parts', nargs='*', help='only these parts (globs)')
    ap.add_argument('--lufs', type=float, default=-16.0, help='loudness of a --parts mix')
    ap.add_argument('--stems', action='store_true', help='also write each processed stem')
    ap.add_argument('--check', action='store_true', help='form, range and clash checks only')
    args = ap.parse_args()
    names = PIECES if args.all else args.pieces
    if not names:
        ap.error('name a piece, or --all')
    private_tables()
    path = os.path.join(OUT_DIR, 'loops.json')
    table = json.load(open(path)) if os.path.exists(path) else {}
    for name in names:
        render_piece(name, args, table)
    if not args.check and not args.bars and not args.parts:
        with open(path, 'w') as fh:
            json.dump(table, fh, indent=2, sort_keys=True)
            fh.write('\n')
    print('OUT', OUT_DIR)


if __name__ == '__main__':
    main()
