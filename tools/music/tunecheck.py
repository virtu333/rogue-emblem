#!/usr/bin/env python3
"""Measure the tuning of every sample the palette can play, and write the
correction table the renderers apply (tools/music/tuning.json).

  python3 tools/music/tunecheck.py                    # measure and print
  python3 tools/music/tunecheck.py --write            # ... and write tuning.json
  python3 tools/music/tunecheck.py tuba basses choir  # only these instruments
  python3 tools/music/tunecheck.py --verify           # measure through the engine, corrections applied

What is measured:

- sfz instruments (VSCO through engine/sampler.py) and the bass guitar
  (sfizz): every sample any key of the instrument's range can reach, at its
  own pitch (the sample as recorded, plus the program's `tune`), over the
  body of the note (past the attack, within 20 dB of its peak).
- SoundFont presets (choir, oohs, nylon guitar, accordion, celesta): every
  key of the range, rendered through FluidSynth at mf, 0.15-1.2 s into a 2 s note.

The meter (engine/tuning.measure) looks for each partial near k times the
expected frequency, so it cannot be fooled into an octave; a sample with as
much energy half-way between partials (sounding an octave low) or no odd
partials (an octave high) is reported as suspect and never corrected. Bars
(glockenspiel, marimba, celesta) are measured on their fundamental only: their
upper partials are not harmonic. Drums, bells and the piano are skipped (see
SKIP). A sample is corrected when its error exceeds THRESHOLD cents and the
reading can be trusted: the partials agree with each other, and the spectrum
and the autocorrelation period agree on most of the note. Other readings are
listed as unreliable and left alone. The correction is the energy-weighted
median over the note; `iqr` and `drift` show how much a sample's own pitch
wanders around it (a constant correction cannot remove that part).
"""

from __future__ import annotations

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from engine import tuning  # noqa: E402
from engine.dsp import SR  # noqa: E402
from engine.instruments import INSTRUMENTS  # noqa: E402
from engine.sampler import NoteEvent, SfzVoicer, load_sample, parse_sfz, pitched, shaped  # noqa: E402

THRESHOLD = 12.0      # cents: smaller errors are left alone
# the glockenspiel's samples are all sharp (+8 to +24 cents): every one is
# corrected, replacing the blanket tune_cents=-14 its articulation had
THRESHOLD_BY = {'glock': 0.0}
MAX_SPREAD = 12.0     # cents: partials disagreeing more than this -> unreliable
MIN_AGREE = 0.6       # spectrum and autocorrelation must agree on this share of windows

SKIP = {
    'orch_perc': 'unpitched percussion',
    'timpani': 'drum: membrane partials, the pitch is ambiguous',
    'bells': 'tubular bells: the strike tone is a virtual pitch, partials inharmonic',
    'kit': 'unpitched',
    'taiko': 'unpitched',
    'grand': 'piano: stretched tuning is part of the sound (stiff strings)',
}
# struck bars: inharmonic upper partials, a dominant fundamental
FUNDAMENTAL_ONLY = {'glock', 'marimba', 'celesta'}
# stiff strings: upper partials run sharp, so only the lowest few are used
MAX_HARM = {'rbass': 3, 'harp': 4, 'nylon': 4}
# programs mapped away from sounding pitch: the glockenspiel's samples sound an
# octave above their keys (measured +1208..+1224 cents on every sample)
SOUNDS_ABOVE = {'glock': 12}
# a section sampled as one voice: its partials are clusters of detuned voices
# (the GM choir's zones hold voices ~40 cents either side of the note), heard
# at their centre
ENSEMBLE = {'choir', 'oohs'}
ENSEMBLE_TOL = 8.0    # cents: the peak and centre readings must agree this well


def reachable_regions(inst):
    """{sample path: (region, [art names], key offset)} for every region a key
    of the instrument's range can play (in range, or the nearest for keys beyond)."""
    lo, hi = inst['range']
    out = {}
    if inst['kind'] == 'sfz':
        progs = {}
        for art_name, art in inst['arts'].items():
            progs.setdefault(art['file'], []).append(art_name)
        for f, arts in progs.items():
            sfz = parse_sfz(f)
            for key in range(lo, hi + 1):
                for v in range(1, 128, 3):
                    for r in sfz.candidates(key, v) or sfz.nearest(key, v):
                        out.setdefault(r.sample, (r, arts, 0))
    elif inst['kind'] == 'sfizz':
        from engine import sfzlab
        tr = inst.get('transpose', 0)
        for r in sfzlab.regions(sfzlab.load(inst['sfz'])):
            if 'sample' not in r or r.get('trigger') == 'release' or r['sample'].startswith('*'):
                continue
            a, b, _ = sfzlab.region_keys(list(r.items()))
            if b < lo + tr or a > hi + tr:
                continue
            # the SFZ default keycenter is 60 (sfizz follows it; the Growlybass
            # c4 regions rely on it)
            kc = sfzlab._num_key(r.get('pitch_keycenter', r.get('key', '60')))
            reg = argparse.Namespace(sample=r['sample'], keycenter=kc, tune=float(r.get('tune', 0)))
            out.setdefault(r['sample'], (reg, ['default'], tr))
    return out


def meter(name, x, expect):
    kw = dict(fundamental_only=name in FUNDAMENTAL_ONLY, max_harm=MAX_HARM.get(name, 8))
    m = tuning.measure(x, expect + SOUNDS_ABOVE.get(name, 0), **kw)
    if name not in ENSEMBLE or m is None:
        return m
    # a section: the loudest voice (peaks, checked by the autocorrelation) and
    # the clusters' centres must tell the same story, or the key's pitch is
    # simply not defined to within a correction's worth of cents
    c = tuning.measure(x, expect + SOUNDS_ABOVE.get(name, 0), ensemble=True, **kw)
    if c is None or abs(c['cents'] - m['cents']) > ENSEMBLE_TOL:
        m['agree'] = 0.0
        m['why'] = f'peak {m["cents"]:+.1f} vs centre {c["cents"]:+.1f}' if c else 'no centre'
        return m
    m['cents'] = (m['cents'] + c['cents']) / 2
    return m


def measure_sample(name, path, keycenter, tune, key_offset=0):
    """Error (cents) of a sample as played at its keycenter: the recording's
    pitch plus the program's `tune`, against the key's equal-tempered pitch."""
    x, _ = load_sample(path)
    return meter(name, tuning.body(x), keycenter - key_offset - tune / 100.0)


def sf2_key(name, inst, key, vel=0.62, key_tuning=None):
    """A 3 s note; a held sound is read once it has settled (0.3-2.8 s: the GM
    choir's attack swings by tens of cents before it does), a plucked or struck
    one over its body."""
    from engine.sf2render import render_sf2
    x = render_sf2(inst['font'], inst['bank'], inst['program'], [(0.0, 3.0, key, vel)],
                   int(3.6 * SR), key_tuning=key_tuning).mean(axis=1)
    held = name in ENSEMBLE or name == 'accordion'
    return meter(name, x[int(0.3 * SR): int(2.8 * SR)] if held else tuning.body(x), key)


def reliable(m):
    """Can the reading be trusted? (Not: is the sample steady. A sample whose
    pitch wanders is still best served by the median, the constant correction
    that leaves the least error; iqr and drift are printed to show what stays.)"""
    if m is None or m['octave_suspect']:
        return False
    if m['partials'] >= 2 and m['spread'] > MAX_SPREAD:
        return False
    return m['agree'] >= MIN_AGREE


def sweep(names):
    """{'sfz': {rel path: row}, 'sf2': {preset: {key: row}}}; a row is
    {'inst', 'key', 'err', 'ok', 'm'}."""
    res = {'sfz': {}, 'sf2': {}}
    for name in names:
        inst = INSTRUMENTS[name]
        if name in SKIP or inst['kind'] in ('synth', 'lab'):
            continue
        if inst['kind'] in ('sfz', 'sfizz'):
            for path, (r, arts, off) in sorted(reachable_regions(inst).items()):
                rel = tuning.lib_rel(path)
                if rel in res['sfz']:
                    res['sfz'][rel]['inst'] += f',{name}'
                    continue
                m = measure_sample(name, path, r.keycenter, r.tune, key_offset=off)
                res['sfz'][rel] = {'inst': name, 'key': r.keycenter - off,
                                   'err': None if m is None else round(m['cents'], 1),
                                   'ok': reliable(m), 'm': m}
            load_sample.cache_clear()   # bounded memory across a full sweep
        elif inst['kind'] == 'sf2':
            pid = tuning.preset_id(inst['font'], inst['bank'], inst['program'])
            lo, hi = inst['range']
            rows = {}
            for key in range(lo, hi + 1):
                m = sf2_key(name, inst, key)
                rows[key] = {'inst': name, 'key': key,
                             'err': None if m is None else round(m['cents'], 1),
                             'ok': reliable(m), 'm': m}
            res['sf2'][pid] = rows
    return res


def verify(names):
    """Tuning with the corrections applied, measured through the engine's own
    paths: {id: cents}."""
    out = {}
    for name in names:
        inst = INSTRUMENTS[name]
        if name in SKIP or inst['kind'] in ('synth', 'lab'):
            continue
        if inst['kind'] == 'sfz':
            done = set()
            for art_name, art in inst['arts'].items():
                if art['file'] in done:
                    continue
                done.add(art['file'])
                v = SfzVoicer(art['file'])
                for r in v.inst.regions:
                    rel = tuning.lib_rel(r.sample)
                    if rel not in tuning.table()['sfz'] or rel in out:
                        continue
                    # the voicer's pitch path at the keycenter (SfzVoicer._one: region
                    # tune + measured fix), without an art's deliberate section detune
                    x, _ = pitched(r.sample, int(round(r.tune + r.fix)))
                    m = meter(name, tuning.body(x), r.keycenter)
                    out[rel] = None if m is None else round(m['cents'], 1)
            load_sample.cache_clear()
            pitched.cache_clear()
            shaped.cache_clear()
        elif inst['kind'] == 'sfizz':
            from engine.render import _render_raw
            for path, (r, arts, off) in reachable_regions(inst).items():
                rel = tuning.lib_rel(path)
                if rel not in tuning.table()['sfz']:
                    continue
                # the program's region: every take and layer of that key, through sfizz
                key = r.keycenter - off
                x = _render_raw(name, inst, [NoteEvent(t=0.05, dur=1.6, key=key, vel=0.62,
                                                       art='default')], int(2.2 * SR), seed=1)
                m = meter(name, tuning.body(x), key)
                out[f'{rel} (key {key}, sfizz)'] = None if m is None else round(m['cents'], 1)
        elif inst['kind'] == 'sf2':
            from engine.render import sf2_key_tuning
            pid = tuning.preset_id(inst['font'], inst['bank'], inst['program'])
            fix = sf2_key_tuning(inst)
            for key in sorted(fix):
                m = sf2_key(name, inst, key, key_tuning=fix)
                out[f'{pid}|{key}'] = None if m is None else round(m['cents'], 1)
    return out


def row_text(label, row, fix):
    m = row['m']
    body = (f'{row["err"]:+7.1f} {m["spread"]:6.1f} {m["iqr"]:6.1f} {m["drift"]:6.1f} '
            f'{m["partials"]:3d} {m["agree"]:5.2f}') if m else '     --'
    flag = '' if row['ok'] else '  UNRELIABLE' + (' (octave?)' if m and m['octave_suspect'] else '') \
        + (f' ({m["why"]})' if m and m.get('why') else '')
    return f'{label} {body}' + ('  FIX' if fix else '') + flag


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('insts', nargs='*')
    ap.add_argument('--write', action='store_true', help='write tools/music/tuning.json')
    ap.add_argument('--verify', action='store_true')
    ap.add_argument('--all-rows', action='store_true', help='print in-tune samples too')
    args = ap.parse_args()
    names = args.insts or list(INSTRUMENTS)
    if args.verify:
        for k, v in sorted(verify(names).items()):
            print(f'{k:90s} {v}')
        return
    res = sweep(names)
    new = {'sfz': {}, 'sf2': {}}
    print(f'{"sample":64s} {"inst":16s} key     err spread    iqr  drift  prt agree')
    for rel, row in sorted(res['sfz'].items()):
        fix = row['ok'] and abs(row['err']) > THRESHOLD_BY.get(row['inst'].split(',')[0], THRESHOLD)
        if fix:
            new['sfz'][rel] = int(round(-row['err']))
        if fix or args.all_rows or row['err'] is None or abs(row['err']) > THRESHOLD:
            print(row_text(f'{rel[-64:]:64s} {row["inst"][:16]:16s} {row["key"]:3d}', row, fix))
    for pid, rows in res['sf2'].items():
        print(f'\n{pid} ({next(iter(rows.values()))["inst"]})')
        for key, row in rows.items():
            fix = row['ok'] and abs(row['err']) > THRESHOLD
            if fix:
                new['sf2'].setdefault(pid, {})[str(key)] = int(round(-row['err']))
            print(row_text(f'  key {key:3d}', row, fix))
    print(f'\n{len(res["sfz"])} samples measured, {len(new["sfz"])} to correct; '
          f'{sum(len(v) for v in new["sf2"].values())} SoundFont keys to correct')
    if args.write:
        # instruments not swept this time keep their entries
        old = tuning.table()
        out = {'sfz': {k: v for k, v in old['sfz'].items() if k not in res['sfz']},
               'sf2': {k: v for k, v in old['sf2'].items() if k not in res['sf2']}}
        out['sfz'].update(new['sfz'])
        out['sf2'].update(new['sf2'])
        out['sfz'] = dict(sorted(out['sfz'].items()))
        out['sf2'] = {k: dict(sorted(v.items(), key=lambda kv: int(kv[0])))
                      for k, v in sorted(out['sf2'].items())}
        with open(tuning.TABLE_PATH, 'w') as f:
            f.write(json.dumps(out, indent=2) + '\n')
        print('wrote', os.path.relpath(tuning.TABLE_PATH))


if __name__ == '__main__':
    main()
