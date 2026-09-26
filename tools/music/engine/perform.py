"""Rule-based performance for a solo string line (the lab palette's solo violin).

A sample library plays what it is told. A violinist decides, note by note, how
to bow: which notes share a slur, which are re-bowed, which bounce, where the
phrase swells and where it lets go. This module makes those decisions from
the notes alone (durations, gaps, pitch contour, accents, position in the
phrase), deterministically, and hands the renderer a performance:

  * the articulation (stream) of every note:
      leg    slurred: the legato program's transition from the previous note
      first  a new bow inside the legato program (phrase start, re-bow after
             a rest, a repeated pitch); its velocity sets the attack (a soft
             bow-in, or a marcato bite from the accent layer)
      spic   short detached notes (bounced bow)
      stac   detached notes a little longer than a spiccato
      pizz / trem / chord  when the score asks for them, or double stops
  * the velocity sent with each note (for `leg` it picks the transition speed:
    a quick change inside a run, a slow expressive shift across a long leap);
  * a per-note loudness curve in dB (the phrase arch rising to its peak and
    tapering at its end, a messa di voce on long notes, a small dip at a bow
    change inside a long slur, a lift on downbeats) that the renderer turns
    into the program's dynamics CC;
  * humanised entrances: phrase starts land a touch late, inner notes wander
    by a few milliseconds (seeded, so every render is identical);
  * alternate round robins and small velocity changes on repeated notes
    (down-bow / up-bow).

The score format is unchanged: everything is derived from what the note
strings already carry (plus the accent marks the parser records).
"""

from __future__ import annotations

import zlib
from dataclasses import dataclass, field

import numpy as np

# classification thresholds
REST_BREAK_BEATS = 0.5      # a written rest this long ends a phrase
REST_BREAK_S = 0.35         # ...or this long in seconds
CADENCE_BEATS = 2.0         # a held note this long may close a sub-phrase
CADENCE_S = 1.4
SPIC_MAX_S = 0.2            # detached notes this short bounce
STAC_MAX_S = 0.42           # detached notes up to this are staccato
FAST_S = 0.26               # legato notes shorter than this change quickly
BOW_S = 3.2                 # a slur longer than this needs a bow change


@dataclass
class Played:
    """One performed note."""
    stream: str
    t_on: float
    t_off: float
    key: int
    vel: int                      # MIDI velocity 1..127
    db: list = field(default_factory=list)   # [(t, dB)] loudness shape for dynamics CC
    cc: dict = field(default_factory=dict)   # CCs sent just before the note-on
    why: str = ''


def _seed(*parts) -> int:
    return zlib.crc32('|'.join(str(p) for p in parts).encode()) & 0x7FFFFFFF


def vel_db(vel01: float) -> float:
    """Written dynamic -> loudness in dB below the program's top (pp -10, mf -4.5, ff -0.3)."""
    return 16.0 * (min(vel01, 1.0) - 0.9)


def _note_info(score, evs):
    """Per-note facts from the score: written span in seconds, gaps, flags."""
    out = []
    for e in evs:
        b0 = getattr(e, 'beat_start', None)
        b1 = getattr(e, 'beat_end', None)
        if b0 is None:            # calibration notes carry no score position
            b0, b1 = 0.0, e.dur
            w0, w1 = e.t, e.t + e.dur
        else:
            w0, w1 = score.seconds(b0), score.seconds(b1)
        out.append(dict(ev=e, b0=b0, b1=b1, w0=w0, w1=w1, wdur=w1 - w0, dur=e.dur,
                        stacc=bool(getattr(e, 'staccato', False)) or e.dur < 0.8 * (w1 - w0) - 0.02,
                        accent=int(getattr(e, 'accent', 0)), reart=bool(getattr(e, 'rearticulate', False)),
                        art=e.art))
    return out


def perform_line(score, evs, seed, arts=()) -> list[Played]:
    """The articulation state machine for a solo (mostly monophonic) string line.

    `arts`: extra articulations the instrument plays as streams of their own
    (e.g. 'mute'); notes asking for them are played detached through them."""
    if not evs:
        return []
    evs = sorted(evs, key=lambda e: (getattr(e, 'beat_start', e.t), e.key))
    info = _note_info(score, evs)
    rng = np.random.default_rng(seed)
    # ---------------------------------------------------------------- chords
    by_start = {}
    for i, n in enumerate(info):
        by_start.setdefault(round(n['b0'], 4), []).append(i)
    chord = set()
    for idx in by_start.values():
        if len(idx) > 1:
            chord.update(idx)
    # monophonic sequence (chord notes are played apart and break the line)
    seq = [i for i in range(len(info)) if i not in chord]

    # ---------------------------------------------------------------- links
    # connected[i]: note i follows the previous monophonic note with no written gap
    connected = {}
    gap_after = {i: 9.9 for i in seq}   # sounding gap (s) to the next note
    for a, b in zip(seq, seq[1:]):
        na, nb = info[a], info[b]
        gap_b = nb['b0'] - na['b1']
        gap_s = nb['w0'] - (na['w0'] + na['dur'])
        gap_after[a] = gap_s
        connected[b] = (abs(gap_b) < 1e-3 and not na['stacc'] and not nb['reart']
                        and na['art'] == nb['art'] and na['art'] in ('default', 'soft', 'sus', 'vib')
                        and gap_s < 0.06)
    # ---------------------------------------------------------------- phrases
    # a phrase ends at a real rest (a breath shorter than ~0.3 s stays inside it)
    # or after a held note that closes a sub-phrase
    phrases, cur = [], []
    for i in seq:
        if cur:
            prev = info[cur[-1]]
            rest_b = info[i]['b0'] - prev['b1']
            rest_s = info[i]['w0'] - prev['w1']
            # a held note closes a sub-phrase when it is the longest note so far
            # (A4h D5q E5q | A5w closes; A4h D5q E5q | A5h C6h does not)
            cadence = (prev['b1'] - prev['b0'] >= CADENCE_BEATS - 1e-6 and prev['wdur'] >= CADENCE_S
                       and len(cur) >= 3
                       and all(info[j]['b1'] - info[j]['b0'] < prev['b1'] - prev['b0'] - 1e-6
                               for j in cur[:-1]))
            if (rest_b >= REST_BREAK_BEATS - 1e-6 and rest_s >= REST_BREAK_S) or rest_b >= 1 - 1e-6 \
                    or cadence:
                phrases.append(cur)
                cur = []
        cur.append(i)
    if cur:
        phrases.append(cur)

    played = {}
    for p_idx, ph in enumerate(phrases):
        # the phrase arch: rise to the peak (highest pitch, then longest), fall to the end
        t0 = info[ph[0]]['w0']
        t_end = info[ph[-1]]['w1']
        span = max(t_end - t0, 1e-3)
        peak = max(ph, key=lambda i: (info[i]['ev'].key, info[i]['wdur']))
        tp = (info[peak]['w0'] - t0) / span
        single = len(ph) == 1

        def arch(t):
            x = (t - t0) / span
            if single:
                return 0.0
            if x <= tp:
                return -1.5 + 3.5 * (x / tp if tp > 0 else 1.0)
            return 2.0 - 4.5 * ((x - tp) / (1 - tp) if tp < 1 else 0.0)

        slur_t = 0.0
        for k, i in enumerate(ph):
            n = info[i]
            e = n['ev']
            prev = info[ph[k - 1]] if k else None
            nxt = info[ph[k + 1]] if k + 1 < len(ph) else None
            is_first = k == 0
            is_last = nxt is None
            link = connected.get(i, False) and not is_first
            repeated = prev is not None and prev['ev'].key == e.key
            # ------------------------------------------------ articulation
            short = ('spic', 'short detached (spiccato)') if n['dur'] <= SPIC_MAX_S \
                else ('stac', 'detached (staccato)')
            if n['art'] in ('pizz', 'trem') or n['art'] in arts:
                stream, why = n['art'], f"score asks {n['art']}"
            elif n['art'] == 'spic':
                stream, why = 'spic', 'score asks spiccato'
            elif n['art'] == 'stac':
                stream, why = 'stac', 'score asks staccato'
            elif n['stacc']:
                stream, why = short[0], short[1] + ', marked'
            elif not link and n['dur'] <= STAC_MAX_S and gap_after[i] >= 0.04:
                stream, why = short
            elif link and repeated:
                stream, why = 'first', 'repeated pitch: re-bowed'
            elif link and n['accent']:
                stream, why = 'first', 'accent inside a slur: re-bowed marcato'
            elif link:
                stream, why = 'leg', 'slurred'
            else:
                stream, why = 'first', 'phrase start' if is_first else 'new bow after a break'
            # ------------------------------------------------ loudness shape
            base = vel_db(e.vel) + (-2.0 if n['art'] == 'soft' else 0.0)
            a_on = arch(n['w0'])
            a_off = arch(n['w1'])
            downbeat = score is not None and getattr(e, 'beat_start', None) is not None and \
                score.on_barline(n['b0'])
            lift = 0.6 if downbeat else 0.0
            v0 = base + a_on + lift
            v1 = base + a_off
            d = n['dur']
            shape = [(0.0, v0)]
            if d >= 0.8:
                # messa di voce: bloom, then let the bow lighten
                shape.append((0.35 * d, v0 + 1.5))
                shape.append((d, v1 - (3.0 if is_last else 1.0)))
            else:
                shape.append((d, v1 - (1.5 if is_last and d > 0.3 else 0.0)))
            # ------------------------------------------------ bow changes in long slurs
            if stream == 'leg':
                slur_t += prev['dur'] if prev else 0.0
                if slur_t > BOW_S and prev is not None and prev['dur'] >= 0.45:
                    why += ' (bow change)'
                    slur_t = 0.0
                    shape.insert(0, (-0.05, v0 - 1.5))
                    shape[1] = (0.07, v0)
            else:
                slur_t = 0.0
            # ------------------------------------------------ velocity
            if stream == 'leg':
                pd = prev['dur'] if prev else 1.0
                leap = abs(e.key - prev['ev'].key) if prev else 0
                if pd < FAST_S or d < FAST_S:
                    vel = 112
                elif pd >= 0.8 and d >= 0.6 and leap >= 5:
                    vel = 28
                else:
                    vel = 72
            elif stream == 'first':
                if n['accent'] >= 2:
                    vel = 124
                elif n['accent'] == 1:
                    vel = 108
                elif e.vel >= 0.74 and is_first:
                    vel = 96                          # a forte entry bites a little
                elif e.vel >= 0.55:
                    vel = 64                          # clean, no accent layer
                else:
                    vel = 36                          # a soft bow-in
                if repeated and not n['accent']:
                    vel = max(24, vel - 16)
            else:
                # short notes: velocity is the loudness
                vel = int(np.clip(round(18 + 118 * (min(e.vel, 1.0) + 0.12 * n['accent'])
                                        * 10 ** ((a_on + lift) / 40)), 12, 127))
            # ------------------------------------------------ timing
            if is_first:
                dt = float(np.clip(rng.normal(0.012, 0.006), 0.0, 0.03))
            else:
                dt = float(np.clip(rng.normal(0.0, 0.004), -0.01, 0.01))
            played[i] = Played(stream=stream, t_on=e.t + dt, t_off=e.t + dt + d, key=e.key, vel=vel,
                               db=[(e.t + dt + x, y) for x, y in shape], why=why)
    # ---------------------------------------------------------------- repeated notes: round robin
    last_by_stream = {}
    for i in seq:
        p = played[i]
        if p.stream in ('spic', 'stac', 'pizz'):
            q = last_by_stream.get(p.stream)
            if q is not None and q.key == p.key and p.t_on - q.t_off < 0.6:
                alt = 127 if q.cc.get(20, 0) < 64 else 0
                p.cc[20] = alt
                # up-bow a hair lighter than down-bow
                p.vel = int(np.clip(p.vel + (-5 if alt else 3), 1, 127))
                p.why += ' (alternate round robin)'
            else:
                p.cc[20] = 0
            last_by_stream[p.stream] = p
    # ---------------------------------------------------------------- chords
    for i in chord:
        n = info[i]
        e = n['ev']
        base = vel_db(e.vel)
        played[i] = Played(stream='chord' if n['art'] not in ('pizz', 'spic', 'trem') else n['art'],
                           t_on=e.t, t_off=e.t + n['dur'], key=e.key,
                           vel=int(np.clip(round(20 + 100 * e.vel), 1, 127)),
                           db=[(e.t, base), (e.t + n['dur'], base - 1.0)], why='double stop')
    return [played[i] for i in range(len(info))]


def perform_plain(evs, stream='main', vel_mode='dynamic') -> list[Played]:
    """No state machine: every note to one stream, the written dynamic as the level
    (the 'plain' comparison: what the library does with no performance)."""
    out = []
    for e in sorted(evs, key=lambda e: (e.t, e.key)):
        base = vel_db(e.vel)
        if vel_mode == 'dynamic':
            vel = int(np.clip(round(1 + 126 * min(e.vel, 1.0)), 1, 127))
        else:
            vel = 80
        out.append(Played(stream=stream, t_on=e.t, t_off=e.t + e.dur, key=e.key, vel=vel,
                          db=[(e.t, base), (e.t + e.dur, base)], why='plain'))
    return out
