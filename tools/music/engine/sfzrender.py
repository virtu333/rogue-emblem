"""Render note events through a full-spec SFZ instrument with sfizz_render.

Used for the libraries whose programs rely on SFZ v2 features (#include,
#define, CC-driven mic mixes, choke groups): the Karoryfer / Virtuosity
drum kits, guitars, basses and the Splendid Grand piano. Timing is placed by
absolute seconds exactly like sf2render.
"""

from __future__ import annotations

import os
import subprocess
import tempfile

import mido
import numpy as np
import soundfile as sf

from .dsp import SR

PPQ = 960
TPS = PPQ * 2  # ticks per second at 120 BPM


def _t(sec):
    return int(round(max(0.0, sec) * TPS))


_LOADED = {}


def ram_mode() -> bool:
    """In-memory sample loading is the default; MUSIC_SFIZZ_RAM=0 streams
    samples the way plain sfizz_render does."""
    return os.environ.get('MUSIC_SFIZZ_RAM', '1') != '0'


def _in_ram(sfz: str, events, directory: str) -> str:
    """The same program flattened with its samples held in memory (engine/sfzlab.py).

    sfizz preloads 8192 frames of each sample and streams the rest from a
    background thread that sfizz_render does not reliably wait for: on a
    busy machine a note longer than ~0.19 s can fall silent part-way (seen
    on the Growlybass, Virtuosity kit and Splendid Grand programs). In RAM the
    render is the clean render, bit for bit. Only the regions this render
    can trigger (its keys) are kept, so a 1.4 GB drum kit does not have to
    fit in memory. The program is written into `directory` (the render's
    scratch folder), so renders leave no files behind."""
    from . import sfzlab
    if sfz not in _LOADED:
        _LOADED[sfz] = sfzlab.load(sfz)
    vels = {}
    for t, dur, key, vel in events:
        vels.setdefault(int(key), set()).add(int(np.clip(round(vel * 126) + 1, 1, 127)))

    def used(r):
        if not r.get('sample') or r['sample'].startswith('*'):
            return True
        try:
            lo, hi, _ = sfzlab.region_keys(list(r.items()))
        except ValueError:
            return True
        return any(lo <= k <= hi for k in vels)

    prog = sfzlab.keep_regions(_LOADED[sfz], used)
    return sfzlab.write(prog, 'ram-' + os.path.splitext(os.path.basename(sfz))[0].replace(' ', '_'),
                        directory=directory)


def render_sfz(sfz: str, events, n_frames: int, cc: dict | None = None,
               cc_events=None, polyphony: int = 256) -> np.ndarray:
    """events: (t, dur, key, vel01). cc: initial {cc: value}. cc_events: (t, cc, value)."""
    events = list(events)
    with tempfile.TemporaryDirectory() as td:
        if ram_mode() and '/music-lab/' not in sfz:
            sfz = _in_ram(sfz, events, td)
        return _render(sfz, events, n_frames, cc, cc_events, polyphony, td)


def _render(sfz, events, n_frames, cc, cc_events, polyphony, td) -> np.ndarray:
    mid = mido.MidiFile(ticks_per_beat=PPQ)
    tr = mido.MidiTrack()
    mid.tracks.append(tr)
    tr.append(mido.MetaMessage('set_tempo', tempo=500000, time=0))
    msgs = []
    for k, v in (cc or {}).items():
        msgs.append((0, 0, mido.Message('control_change', control=int(k), value=int(v))))
    for t, c, v in (cc_events or []):
        msgs.append((_t(t), 1, mido.Message('control_change', control=int(c), value=int(v))))
    for t, dur, key, vel in events:
        v = int(np.clip(round(vel * 126) + 1, 1, 127))
        msgs.append((_t(t), 3, mido.Message('note_on', note=int(key), velocity=v)))
        msgs.append((_t(t + max(dur, 0.01)), 2, mido.Message('note_off', note=int(key), velocity=0)))
    # a final event far enough out for every tail
    msgs.append((_t(n_frames / SR), 4, mido.Message('control_change', control=119, value=0)))
    msgs.sort(key=lambda m: (m[0], m[1]))
    prev = 0
    for tick, _, msg in msgs:
        msg.time = tick - prev
        prev = tick
        tr.append(msg)
    tr.append(mido.MetaMessage('end_of_track', time=0))
    mpath = os.path.join(td, 'p.mid')
    wpath = os.path.join(td, 'p.wav')
    mid.save(mpath)
    subprocess.run(['sfizz_render', '--sfz', sfz, '--midi', mpath, '--wav', wpath,
                    '-s', str(SR), '-q', '3', '-b', '64', '-p', str(polyphony), '--use-eot'],
                   check=True, capture_output=True)
    x, sr = sf.read(wpath, dtype='float32', always_2d=True)
    assert sr == SR
    out = np.zeros((n_frames, 2), np.float32)
    n = min(n_frames, len(x))
    out[:n] = x[:n, :2]
    return out
