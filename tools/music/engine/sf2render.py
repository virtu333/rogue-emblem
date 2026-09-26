"""Render note events through a SoundFont with FluidSynth (offline).

Events are written to a MIDI file at a fixed 120 BPM with 960 PPQ, placing
every event by absolute seconds, so the score's own tempo map is honored
exactly. FluidSynth's reverb and chorus are off: the mixer adds space.
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
TICKS_PER_SEC = PPQ * 2  # 120 BPM


def _ticks(sec: float) -> int:
    return int(round(max(0.0, sec) * TICKS_PER_SEC))


def render_sf2(font: str, bank: int, program: int, events, n_frames: int,
               expr_points=None, channel: int = 0, gain: float = 1.0,
               cc: dict | None = None, pitch_bend_range: int | None = None,
               cents=None) -> np.ndarray:
    """events: iterable of (t_sec, dur_sec, key, vel01). Returns (n, 2) float32.

    cents: optional per-event tuning (same order as events), sent as a pitch bend
    (FluidSynth's default range, 2 semitones) just before each note-on. The bend
    is per channel, so this is for single-line parts."""
    mid = mido.MidiFile(ticks_per_beat=PPQ)
    tr = mido.MidiTrack()
    mid.tracks.append(tr)
    tr.append(mido.MetaMessage('set_tempo', tempo=500000, time=0))
    msgs = []  # (tick, order, msg)
    if channel != 9:  # the drum channel is bank 128 already
        msgs.append((0, 0, mido.Message('control_change', channel=channel, control=0,
                                        value=bank)))
    msgs.append((0, 1, mido.Message('program_change', channel=channel, program=program)))
    msgs.append((0, 2, mido.Message('control_change', channel=channel, control=7, value=110)))
    for k, v in (cc or {}).items():
        msgs.append((0, 3, mido.Message('control_change', channel=channel, control=k, value=v)))
    if expr_points:
        # sample the lane every 20 ms where it changes
        pts = sorted(expr_points)
        t0, t1 = pts[0][0], pts[-1][0]
        ts = np.arange(max(0.0, t0), t1 + 0.02, 0.02)
        vals = np.interp(ts, [p[0] for p in pts], [p[1] for p in pts])
        last = None
        for t, v in zip(ts, vals):
            iv = int(round(np.clip(v, 0, 1) * 127))
            if iv != last:
                msgs.append((_ticks(t), 3, mido.Message('control_change', channel=channel,
                                                        control=11, value=iv)))
                last = iv
    else:
        msgs.append((0, 3, mido.Message('control_change', channel=channel, control=11, value=127)))
    end_t = 0.0
    for i, (t, dur, key, vel) in enumerate(events):
        v = int(np.clip(round(vel * 126) + 1, 1, 127))
        on, off = _ticks(t), _ticks(t + max(dur, 0.01))
        if cents is not None:
            bend = int(np.clip(round(cents[i] / 200.0 * 8191), -8192, 8191))
            msgs.append((on, 4.5, mido.Message('pitchwheel', channel=channel, pitch=bend)))
        msgs.append((on, 5, mido.Message('note_on', channel=channel, note=int(key), velocity=v)))
        msgs.append((off, 4, mido.Message('note_off', channel=channel, note=int(key), velocity=0)))
        end_t = max(end_t, t + dur)
    # keep the file running long enough for release tails
    msgs.append((_ticks(n_frames / SR), 6, mido.Message('control_change', channel=channel,
                                                         control=110, value=0)))
    msgs.sort(key=lambda m: (m[0], m[1]))
    prev = 0
    for tick, _, msg in msgs:
        msg.time = tick - prev
        prev = tick
        tr.append(msg)
    with tempfile.TemporaryDirectory() as td:
        mpath = os.path.join(td, 'part.mid')
        wpath = os.path.join(td, 'part.wav')
        mid.save(mpath)
        cmd = ['fluidsynth', '-n', '-i', '-q', '-R', '0', '-C', '0', '-g', str(gain),
               '-r', str(SR), '-O', 'float', '-T', 'wav', '-F', wpath, font, mpath]
        subprocess.run(cmd, check=True, capture_output=True)
        x, sr = sf.read(wpath, dtype='float32', always_2d=True)
    assert sr == SR, sr
    out = np.zeros((n_frames, 2), np.float32)
    n = min(n_frames, len(x))
    out[:n] = x[:n]
    return out
