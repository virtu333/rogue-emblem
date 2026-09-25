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


def render_sfz(sfz: str, events, n_frames: int, cc: dict | None = None,
               cc_events=None, polyphony: int = 256) -> np.ndarray:
    """events: (t, dur, key, vel01). cc: initial {cc: value}. cc_events: (t, cc, value)."""
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
    with tempfile.TemporaryDirectory() as td:
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
