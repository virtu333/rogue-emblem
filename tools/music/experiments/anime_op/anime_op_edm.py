"""欠けた太陽 (The Broken Sun), round 2: J-rock x EDM. The band of round 1 with
supersaw stacks, plucks, an 808, sidechain pumping, a filtered intro, risers,
downlifters and impacts, a one-bar accelerating snare build into the sabi, and a
beat drop into a four-bar vocal-chop drop (bars 49-52, F minor) that takes the
tag's repeated line. Same timeline as round 1 (56 bars at 150).
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from engine.patterns import Kit, arp, chart, pad   # noqa: E402
from engine.score import Score                      # noqa: E402
from engine.theory import Chord, voice_lead         # noqa: E402

import melody as M                                  # noqa: E402
from anime_op import (BAR, bass_note, chord_at, eighths, low_chord, open_chord,  # noqa: E402
                      rhythm_events, strum, CHORDS)

KEY = 'anime_op_edm'


def accel_roll(part, bar, start=0.0, end=4.0, v0=0.45, v1=1.0, key=38):
    """An accelerating snare roll: eighths, then triplets, sixteenths, sextuplets."""
    b0 = (bar - 1) * BAR
    ts = []
    for beat in range(int(start), int(end + 0.999)):
        k = beat - int(start)
        per = [2, 3, 4, 6, 8][min(k, 4)] if end - start < 4 else [2, 3, 4, 6][min(k, 3)]
        for i in range(per):
            t = beat + i / per
            if start - 1e-9 <= t < end - 1e-9:
                ts.append(t)
    for i, t in enumerate(ts):
        v = v0 + (v1 - v0) * (i / max(1, len(ts) - 1)) ** 1.3
        part.note(b0 + t, key, 0.1, vel=v)
    return ts


def chord_segments(bars, push=True):
    """[(start, beats, symbol)] of the chords over `bars`, a chord that changes on a
    downbeat pushed an eighth early."""
    lo, hi = (bars[0] - 1) * BAR, bars[-1] * BAR
    segs = [(t, d, sym) for t, d, sym in CHORDS if lo - 1e-9 <= t < hi - 1e-9]
    out = []
    for i, (t, d, sym) in enumerate(segs):
        st = t - 0.5 if push and i > 0 and abs(t % BAR) < 1e-9 else t
        out.append([st, sym])
    res = []
    for i, (st, sym) in enumerate(out):
        en = out[i + 1][0] if i + 1 < len(out) else hi
        res.append((st, en - st, sym))
    return res


def syn_chord(sym):
    """A chart symbol the synths can voice (theory.Chord)."""
    s = sym.replace('(add9)', 'add9').replace('Fmadd9', 'Fmadd9')
    return Chord({'C5': 'C5', 'Fmadd9': 'Fsus2', 'D#dim7': 'D#dim7'}.get(s, s))


def voiced(segs, n=4, lo=55, hi=79):
    """[(start, beats, [pitches])] with voice leading."""
    out, prev = [], None
    for t, d, sym in segs:
        v = voice_lead(prev, syn_chord(sym), n, lo, hi)
        out.append((t, d, v))
        prev = v
    return out


def quarters(bars):
    return [(b - 1) * BAR + q for b in bars for q in range(4)]


def electronics(s, kit, P):
    """The EDM layer over the band: stacks, wobble, pluck arps, pad, 808, a kick
    layer, sidechain pumping, the filtered intro, risers, downlifters, impacts."""
    stack, wob, pluck, spad, sub = P['stack'], P['wob'], P['pluck'], P['spad'], P['sub']
    kick2, riser, down, boom = P['kick2'], P['riser'], P['down'], P['boom']

    # ---- supersaw stack: the intro hook's drive and the sabi, chords pushed like the band
    for bars in (list(range(5, 8)), list(range(33, 48))):
        for t, d, v in voiced(chord_segments(bars), n=4, lo=55, hi=79):
            for p in v:
                stack.note(t, p, d - 0.05, vel=0.8)
    for p in (48, 55, 60, 67):          # bar 48: the C5 hit before the gap
        stack.note(47 * BAR, p, 1.8, vel=0.85)

    # ---- future-bass wobble chords in the drop: syncopated stabs, a scoop into each
    STABS = [(0.0, 0.75), (0.75, 0.75), (1.5, 1.0), (2.5, 0.5), (3.0, 0.75)]
    prev = None
    for bar in range(49, 53):
        sym = chord_at((bar - 1) * BAR)
        v = voice_lead(prev, syn_chord(sym), 4, 53, 75)
        prev = v
        for st, d in STABS:
            for p in v:
                wob.note((bar - 1) * BAR + st, p, d - 0.05, vel=0.82 if st == 0 else 0.72)

    # ---- pluck arps: sixteenths in the A-melo, climbing through the B-melo
    arp(pluck, 9, chart('Em:4 C:4 Em:4 D:4 Em:4 C:4 Am:4 B:4 Am:4 Em/G:4 C:4 D:4 Am:4 Bm:4 C:4 D:4'),
        pattern='0 2 4 1 3 5 2 4', step=0.25, lo=64, hi=88, dur=0.2, vel=0.5)
    arp(pluck, 25, chart('C:4 D:4 Em:4 Em/D:4 C:4 D:4 B7sus4:2 B7:2'),
        pattern='0 1 2 3 4 5 4 3', step=0.25, lo=66, hi=90, dur=0.2, vel=0.55)
    pluck.opts['sweep'] = [(1, 20000), (8.9, 20000), (9, 1100), (16.9, 2200), (17, 2800),
                           (24.9, 4000), (25, 1200), (31.5, 9000), (32, 20000)]

    # ---- pad: A2 soft, the B-melo swelling, under the sabi and the drop, the outro
    pad(spad, 17, chart('Am:4 Em/G:4 C:4 D:4 Am:4 Bm:4 C:4 D:4 C:4 D:4 Em:4 Em/D:4 C:4 D:4 '
                        'B7sus4:2 B7:2'), n=4, lo=48, hi=72, vel=0.6)
    pad(spad, 33, chart('C:4 D:4 Bm:4 Em:4 C:4 D:4 G:2 D#dim7:2 Em:4 C:4 D:4 Bm:4 Em:4 Am:4 '
                        'D:4 B7sus4:2 B7:2'), n=4, lo=48, hi=72, vel=0.62)
    pad(spad, 49, chart('Db:4 Eb:4 Cm:4 Fsus2:4 Db:4 Eb:4 C:4'), n=4, lo=48, hi=72, vel=0.62)
    spad.opts['sweep'] = [(1, 20000), (16.9, 20000), (17, 700), (24.9, 1400), (25, 900),
                          (32, 8000), (32.5, 20000)]

    # ---- 808 under the Growlybass: roots, pushed with the band
    for bars in (list(range(5, 8)), list(range(17, 25)), list(range(33, 48))):
        for t, d, sym in chord_segments(bars, push=bars[0] != 17):
            sub.note(t, bass_note(sym), d - 0.1, vel=0.85)
    for bar in range(49, 53):
        sym = chord_at((bar - 1) * BAR)
        k = bass_note(sym)
        sub.note((bar - 1) * BAR, k, 2.3, vel=0.9)
        sub.note((bar - 1) * BAR + 2.5, k, 1.3, vel=0.85)
    sub.note(55 * BAR, 36, 0.5, vel=0.95)           # the last hit

    # ---- a synthetic kick under the kit's in the drive, sabi and drop
    kicks = [n.start for n in kit.parts['kick'].notes
             if 4 * BAR <= n.start < 7 * BAR or 32 * BAR <= n.start < 52 * BAR
             or n.start >= 55 * BAR]
    for t in sorted(set(round(k, 4) for k in kicks)):
        kick2.note(t, 36, 0.2, vel=0.9)

    sub.opts['pump'] = dict(beats=sorted(set(round(n.start, 4) for n in kit.parts['kick'].notes)),
                            depth_db=9.0, release=0.14, shape=1.2)

    # ---- sidechain: stacks, wobble and pad pump on every quarter where the kit drives
    pump_beats = quarters(range(5, 8)) + quarters(range(33, 48)) + quarters(range(49, 53))
    stack.opts['pump'] = dict(beats=pump_beats, depth_db=9.0, release=0.26)
    wob.opts['pump'] = dict(beats=pump_beats, depth_db=10.0, release=0.24)
    spad.opts['pump'] = dict(beats=pump_beats, depth_db=11.0, release=0.3)
    pluck.opts['pump'] = dict(beats=pump_beats, depth_db=4.0, release=0.2)

    # ---- transitions
    riser.note(2 * BAR, 48, 8.0, vel=0.7)            # into the hook
    riser.note(30 * BAR, 50, 8.0, vel=0.85)          # into the sabi (with the roll)
    riser.note(46 * BAR, 53, 7.5, vel=0.9)           # into the drop, ends at the gap
    down.note(24 * BAR, 60, 4.0, vel=0.75)           # into the half time
    down.note(52 * BAR, 61, 4.0, vel=0.8)            # out of the drop
    for bar in (5, 33, 49):
        boom.note((bar - 1) * BAR, 36, 1.0, vel=0.95)
    boom.note(55 * BAR, 36, 0.5, vel=0.85)           # the last hit

    # ---- the filtered intro: everything that plays there opens from 300 Hz
    INTRO = [(1, 300), (2.5, 650), (3.5, 1400), (4.5, 4500), (4.95, 12000), (5, 20000)]
    for name, part in s.parts.items():
        if any(n.start < 4 * BAR for n in part.notes) and 'sweep' not in part.opts \
                and name != 'riser':
            part.opts['sweep'] = INTRO

# ------------------------------------------------------------------ build
def build():
    s = Score('anime_op_edm', bpm=M.BPM, intro_bars=56, one_shot=True, tonic='E',
              title='The Broken Sun (J-rock x EDM)', seed=7)
    s.master = dict(lufs=-11.0, lead_duck=2.5, glue_thresh=-12, glue_ratio=1.6,
                    eq=[('peak', 300, 0.8, -1.5), ('peak', 750, 0.8, -3.0),
                        ('peak', 3000, 1.0, 0.5), ('highshelf', 8000, 0.7, 3.0)])
    s.reverb = dict(rt60=1.5, predelay_ms=25, wet_db=-3, room_db=-4)

    # ------------------------------------------------ parts
    amp_rhythm = dict(rig=True, gain_db=26, mid_hz=650, mid_db=1.5, bias=0.3, treble_db=1.0)
    amp_pm = dict(rig=True, gain_db=24, palm=True, mid_db=1.0, bias=0.3, treble_db=0.5)
    amp_lead = dict(rig=True, gain_db=31, tight=160, mid_hz=850, mid_db=4.5, bias=0.2,
                    treble_db=2.0, presence_db=2.0, delay_mix=0.16, delay_s=0.3,
                    delay_fb=0.32)
    amp_clean = dict(rig=True, gain_db=-8, stages=1, bias=0.05, tight=90, mid_db=0,
                     treble_db=2.0, chorus_mix=0.5, delay_mix=0.12, delay_s=0.3)

    gL = s.part('gtr_L', 'egtr', role='section', pan=-0.9, width=0.0, amp=amp_rhythm,
                reverb=0.06, gain=0.0)
    gR = s.part('gtr_R', 'egtr2', role='section', pan=0.9, width=0.0, amp=amp_rhythm,
                reverb=0.06, gain=0.0)
    pL = s.part('pm_L', 'egtr_pm', role='section', pan=-0.8, width=0.0, amp=amp_pm,
                reverb=0.04, gain=-1.0)
    pR = s.part('pm_R', 'egtr_pm2', role='section', pan=0.8, width=0.0, amp=amp_pm,
                reverb=0.04, gain=-1.0)
    cl = s.part('clean', 'egtr3', role='keys', pan=-0.3, width=0.8, amp=amp_clean,
                reverb=0.25, gain=-2.0)
    lead = s.part('lead', 'egtr', role='lead', pan=0.05, width=0.0, amp=amp_lead,
                  reverb=0.18, gain=1.0, humanize_ms=3)
    bass = s.part('bass', 'rbass', role='bass', gain=0.0)
    vln = s.part('vln', 'violins', role='counter', gain=-6.0)
    strings = s.part('str_pad', 'violas', role='pad', gain=-6.0)
    piano = s.part('piano', 'grand', role='keys', gain=-6.0, pan=0.25)
    piano_dbl = s.part('piano_dbl', 'grand', role='keys', gain=-7.0, pan=0.25)
    # ------------------------------------------------ the electronics
    POCKET = [('peak', 2600, 0.7, -4.0), ('peak', 1200, 0.9, -1.5)]   # room for the voice
    stack = s.part('stack', 'saw_stack', role='section', gain=-3.0, width=1.0, reverb=0.25,
                   eq=POCKET,
                   synth=dict(cutoff=1700, env_hz=2200, env_decay=0.25, res=0.2, attack=0.01,
                              sustain=0.8, release=0.3, detune=0.3, octave=0.3))
    wob = s.part('wobble', 'saw_stack', role='section', gain=-2.0, width=1.0, reverb=0.2,
                 eq=POCKET,
                 synth=dict(cutoff=900, env_hz=2800, env_decay=0.12, res=0.35, lfo_hz=7.5,
                            lfo_oct=2.2, trem_depth=0.45, glide_st=1.5, glide_s=0.05,
                            detune=0.35, release=0.12, octave=0.4))
    pluck = s.part('pluck', 'saw_pluck', role='ostinato', gain=-4.0, width=0.8, reverb=0.35,
                   pan=0.2)
    spad = s.part('synth_pad', 'saw_pad', role='pad', gain=-4.0, width=1.0, eq=POCKET)
    sub = s.part('sub808', 'sub808', role='sub', gain=0.0)
    kick2 = s.part('kick_layer', 'kick_synth', role='kick', gain=-7.5)
    riser = s.part('riser', 'noise_riser', role='fx', gain=-5.0)
    down = s.part('downlifter', 'downlifter', role='fx', gain=-7.0)
    boom = s.part('impact', 'impact', role='accent', gain=-1.0, reverb=0.4)
    kit = Kit(s, gains={'kick': 1.0, 'snare': 1.0, 'toms': 0.0, 'cym': 2.5})

    # faders (dB by bar): the A-melo sits back, the B-melo climbs, the sabi opens up
    BAND = [(1, 0), (4.9, 0), (5, -1.5), (8.9, -1.5), (9, 0), (24.9, 0), (25, -6.5), (31, -2.5),
            (32.9, 0), (33, 1.0), (48, 1.0),
            (49, -1), (52.9, -1), (53, -3), (55, 0), (57, 0)]
    gL.opts['fader'] = gR.opts['fader'] = BAND
    pL.opts['fader'] = pR.opts['fader'] = [(1, -4.5), (16.9, -4.5), (17, -2), (24, -2),
                                           (54.9, -1), (57, 0)]
    bass.opts['fader'] = [(1, 0), (8.9, 0), (9, -3.5), (16.9, -3.5), (17, -1.5), (24.9, -1.5),
                          (25, -1), (32.9, -1), (33, 0), (57, 0)]
    KIT = [(1, 0), (8.9, 0), (9, -3.5), (16.9, -3.5), (17, -1.5), (24.9, -1.5), (25, -3.5),
           (31, -1.5), (32.9, -1), (33, 1.0), (48.9, 1.0), (49, 0.5), (57, 0.5)]
    for p in kit.parts.values():
        p.opts['fader'] = KIT
    kit.parts['cym'].opts['fader'] = [(1, 0), (8.9, 0), (9, -3.5), (16.9, -3.5), (17, -7),
                                      (24.9, -7), (25, -3.5), (32.9, -1.5), (33, 2.0), (48.9, 2.0),
                                      (49, 0.5), (57, 0.5)]
    cl.opts['fader'] = [(1, 0), (16.9, -2.5), (17, -1), (57, -1)]
    lead.opts['fader'] = [(1, -1), (4.9, -1), (5, -2), (8.9, -2), (9, -2.5), (16.9, -2.5),
                          (17, -1.5), (24.9, -1.5), (25, -2.5), (31, -1.5), (32.9, -0.5),
                          (33, 0.5), (57, 0.5)]

    spad.opts['fader'] = [(1, -3), (24.9, -3), (25, -7), (32, -2), (32.9, -2), (33, 0), (57, 0)]
    pluck.opts['fader'] = [(1, -3), (16.9, -3), (17, -1.5), (24.9, -1.5), (25, -3.5), (57, -3.5)]
    stack.opts['fader'] = [(1, -3.5), (8.9, -3.5), (9, -1.5), (57, -1.5)]
    sub.opts['fader'] = [(1, -5), (8.9, -5), (9, -3), (32.9, -3), (33, -3), (57, -3)]
    piano.opts['fader'] = [(1, -2), (57, -2)]

    def both(fn, *a, **k):
        fn(gL, *a, **k)
        fn(gR, *a, **k)

    def rhythm(bars, steps=None, push=True, gate=0.92, vel=0.74, acc=0.86, parts=(gL, gR),
               voicing=open_chord, dur=None):
        for t, d, sym, a in rhythm_events(list(bars), steps or eighths(), push, gate):
            for i, part in enumerate(parts):
                off = 0.01 * i            # the second take a hair late
                strum(part, t + off, dur or d, voicing(sym), acc if a else vel)

    def bassline(bars, steps=None, push=True, gate=0.9, vel=0.7, acc=0.82):
        for t, d, sym, a in rhythm_events(list(bars), steps or eighths(), push, gate):
            bass.note(t, bass_note(sym), d, vel=acc if a else vel)

    def hits(bar, spec, parts=(gL, gR), voicing=open_chord, vel=0.9, with_bass=True):
        """spec: [(beat in bar, beats, symbol or None)]"""
        b0 = (bar - 1) * BAR
        for p, d, sym in spec:
            sym = sym or chord_at(b0 + p)
            for i, part in enumerate(parts):
                strum(part, b0 + p + 0.01 * i, d, voicing(sym), vel)
            if with_bass:
                bass.note(b0 + p, bass_note(sym), d, vel=vel)

    # ================================================= INTRO 1-8
    # kime: C, D, Bm struck on 1, 2&, 3& and pushed on 4&, then the Empire drill in unison
    hits(1, [(0, 1.0, 'C'), (1.5, 0.5, 'C'), (2.5, 0.75, 'C'), (3.5, 1.5, 'D')])
    hits(2, [(1.5, 0.5, 'D'), (2.5, 0.75, 'D'), (3.5, 1.5, 'Bm')])
    hits(3, [(1.5, 0.5, 'Bm'), (2.5, 0.5, 'Bm')])
    drill = [(0, 1.5, 'E5'), (1.5, 0.5, 'F5'), (2.0, 1.0, 'E5'), (3.0, 1.0, 'D5')]
    for p, d, sym in drill:
        b0 = 3 * BAR
        for i, part in enumerate((gL, gR)):
            r = {'E5': 40, 'F5': 41, 'D5': 38}[sym]
            strum(part, b0 + p + 0.01 * i, d * 0.95, [r, r + 7, r + 12], 0.92)
        bass.note(b0 + p, {'E5': 40, 'F5': 41, 'D5': 38}[sym], d * 0.95, vel=0.92)
    lead.at(1).play('@f B5:1~ B5:0.5 A5:0.5 G5:0.5 A5:1~ A5:0.5 | A5:1.5 G5:0.5 F#5:0.5 '
                    'F#5:1.5~ | F#5:1.5 E5:0.5 D5:0.5 r:1.5 |'
                    ' @ff E5:1.5 F5:0.5 E5:1 D5:1 |')
    # the hook (bars 5-8): the Thread, high, over the drive
    lead.at(5).play('@ff B4e E5e F#5e B5:1.5 A5e G5e | F#5q. E5e F#5q A5q |'
                    ' B5q. A5e F#5q D5q | E5h. rq |')
    rhythm(range(5, 8), push=True)
    hits(8, [(0, 0.45, 'Em'), (0.5, 0.45, 'Em'), (1.0, 0.45, 'Em'), (1.5, 0.45, 'Em'),
             (2.5, 0.4, 'Em'), (3.0, 0.4, 'Em')])
    bassline(range(5, 8))
    # (the drive's C in bar 5 is the drill's fall, D-C)

    # ================================================= A-MELO 9-24
    # 9-16: clean chorused arpeggios ("Again"), the drill palm-muted underneath
    for bar in range(9, 17):
        b0 = (bar - 1) * BAR
        sym = chord_at(b0)
        if sym == 'Em':
            seq = [40, 40, 40, 41, 40, 40, 38, 38]      # E E E F | E E D D : the drill
            for i, r in enumerate(seq):
                for j, part in enumerate((pL, pR)):
                    strum(part, b0 + i * 0.5 + 0.01 * j, 0.28, [r, r + 7],
                          0.82 if i in (0, 3) else 0.66)
                bass.note(b0 + i * 0.5, r, 0.4,
                          vel=0.8 if i in (0, 3) else 0.62)
        else:
            for i in range(8):
                if bar in (12, 16) and i >= 6:
                    continue
                for j, part in enumerate((pL, pR)):
                    strum(part, b0 + i * 0.5 + 0.01 * j, 0.28, low_chord(sym),
                          0.8 if i == 0 else 0.64)
                bass.note(b0 + i * 0.5, bass_note(sym), 0.4, vel=0.78 if i == 0 else 0.6)
    # bars 12 and 16 end on a two-chord kime (the band answers the line)
    hits(12, [(3.0, 0.4, 'D'), (3.5, 0.45, 'D')], vel=0.85)
    hits(16, [(3.0, 0.4, 'B'), (3.5, 0.45, 'B')], vel=0.85)
    cl.vel = 0.55
    arp(cl, 9, chart('Em:4 C:4 Em:4 D:4 Em:4 C:4 Am:4 B:4'), pattern='0 2 4 3 5 4 3 2',
        step=0.5, lo=52, hi=79, dur=1.2, vel=0.55)
    # 17-24: the drive (palm-muted eighths both sides, open accents), arps thinner
    rhythm(range(17, 24), push=True, gate=0.5, parts=(pL, pR), voicing=low_chord,
           vel=0.66, acc=0.84, dur=0.28)
    bassline(range(17, 24), vel=0.68, acc=0.8)
    arp(cl, 17, chart('Am:4 Em/G:4 C:4 D:4 Am:4 Bm:4 C:4'), pattern='0 2 4 2', step=1.0,
        lo=55, hi=79, dur=1.6, vel=0.45)
    # bar 24 (D): open power chords return: build into the B-melo
    hits(24, [(0, 1.5, 'D'), (1.5, 0.5, 'D'), (2.0, 0.5, 'D'), (2.5, 0.5, 'D'),
              (3.0, 0.5, 'D'), (3.5, 0.5, 'D')], vel=0.84)

    # ================================================= B-MELO 25-32 (half time)
    rhythm(range(25, 29), steps=[0.0, 2.5], push=False, gate=0.97, vel=0.78, acc=0.84)
    rhythm(range(29, 31), steps=[0.0, 1.0, 2.0, 3.0], push=False, gate=0.9, vel=0.76,
           acc=0.84)
    rhythm([31], push=False, gate=0.85, vel=0.78, acc=0.88)
    bassline(range(25, 29), steps=[0.0, 2.5, 3.5], push=False, vel=0.72, acc=0.8)
    bassline(range(29, 32), push=False, vel=0.7, acc=0.82)
    hits(32, [(0, 1.0, 'B7')], vel=0.95)
    arp(cl, 25, chart('C:4 D:4 Em:4 Em/D:4 Cmaj7:4 D:4 B7sus4:2 B7:2'),
        pattern='0 1 2 3 4 3 2 1', step=0.5, lo=59, hi=83, dur=1.0, vel=0.5)
    pad(strings, 25, chart('C:4 D:4 Em:4 Em/D:4 Cmaj7:4 D:4 B7sus4:2 B7:2'), n=3, lo=52,
        hi=71, vel=0.5)
    strings.expr((25, 0.55), (31, 0.9), (32, 1.0), (32.3, 0.0), (32.95, 0.0), (33, 1.0))
    # piano: the Thread, one note a beat, a bell over the build
    piano.at(25).play('@mp B5h E6h | F#6h B6h | B5h E6h | F#6h B6h |'
                      ' B5q E6q F#6q B6q | B5q E6q F#6q B6q | rw | rw |')

    # ================================================= SABI 33-48
    rhythm(range(33, 48), push=True)
    bassline(range(33, 48))
    hits(48, [(0, 1.8, 'C5')], vel=0.98)
    pad(strings, 33, chart('C:4 D:4 Bm:4 Em:4 C:4 D:4 G:2 D#dim7:2 Em:4 C:4 D:4 Bm:4 '
                           'Em:4 Am:4 D:4 B7sus4:2 B7:2'), n=3, lo=55, hi=74, vel=0.6)

    # ================================================= DROP 49-52 (F minor): the chops' bed
    # the band rings a chord a bar, struck again on 3&
    for bar in range(49, 53):
        sym = chord_at((bar - 1) * BAR)
        hits(bar, [(0, 2.4, sym), (2.5, 1.4, sym)], vel=0.9)
    pad(strings, 49, chart('Db:4 Eb:4 Cm:4 Fsus2:4 Db:4 Eb:4 C:4'), n=3, lo=56, hi=75, vel=0.62)
    hits(53, [(0, 3.8, 'Db')], vel=0.86)
    hits(54, [(0, 1.9, 'Eb'), (2.0, 1.9, 'Eb')], vel=0.88)
    # 55: C, palm-muted eighths opening up, then the last hit on 56's downbeat
    for i in range(8):
        t = 54 * BAR + i * 0.5
        for j, part in enumerate((pL, pR)):
            strum(part, t + 0.01 * j, 0.28, low_chord('C'), 0.7 + 0.03 * i)
        bass.note(t, 36, 0.4, vel=0.7 + 0.03 * i)
    rhythm([55], steps=[2.0, 2.5, 3.0, 3.5], push=False, gate=0.9, vel=0.84, acc=0.9)
    hits(56, [(0, 0.5, 'C')], vel=1.0)
    for j, part in enumerate((pL, pR)):
        strum(part, 55 * BAR + 0.01 * j, 0.3, low_chord('C'), 0.95)

    # ================================================= the sung line
    mel = M.note_string(start_bar=9, tag=False)
    lead.at(9).play('@f ' + mel)
    # the drop: in the instrumental the lead guitar plays the chop line
    for t, d, p, m, fx in M.chop_notes():
        lead.note(t, p, d * (0.6 if 'stutter' in fx or 'gate' in fx else 0.95), vel=0.84)
    # violins in unison through the sabi and tag; piano an octave up
    names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
    for t, d, p, _ in M.notes(tag=False):
        if 31 * BAR + 2 <= t < 48 * BAR:          # the sabi
            vln.note(t, names[p % 12] + str(p // 12 - 1), d, vel=0.62)
            piano_dbl.note(t, p + 12, min(d, 1.0), vel=0.34)
        elif t >= 52 * BAR:                       # the outro's last words
            vln.note(t, names[p % 12] + str(p // 12 - 1), d, vel=0.62)
    # lead dynamics: A-melo sits back, the sabi sings out (velocity drives the amp)
    for n in lead.notes:
        if n.start >= 8 * BAR:
            n.vel = 0.62 if n.start < 16 * BAR else 0.68 if n.start < 24 * BAR else \
                0.74 if n.start < 31 * BAR + 2 else 0.86 if n.start < 48 * BAR else \
                n.vel if n.start < 52 * BAR else 0.86

    # ================================================= drums
    K = kit.play
    kime_hat = 'o.o.o.o.o.o.o.o.'
    K(1, {'kick': 'X.....x...x...X.', 'snare': 'x.....x...x...x.', 'crash': 'X.............X.',
          'hat': kime_hat})
    K(2, {'kick': '......x...x...X.', 'snare': '......x...x...x.', 'crash': '..............X.',
          'hat': kime_hat})
    K(3, {'kick': '......x...x.....', 'snare': '......x...x.xxxx', 'hat': 'o.o.o.o.o.o.....'},
      ramp=0.2)
    K(4, {'kick': 'X.....x.x...x...', 'snare': 'X.....x.x...x...', 'crash': 'X.......x.......'})
    DRIVE = {'kick': 'x.....x.x.....x.', 'snare': '....x.......x...',
             'ride': 'X.x.X.x.X.x.X.x.'}
    for bar in (5, 6, 7):
        K(bar, {**DRIVE, 'crash': 'X...............' if bar == 5 else '..............x.'})
    K(8, {'kick': 'x.x.x.x...X.X...', 'snare': '....x.....X.X...', 'crash': 'X.........X.....',
          'ride': 'x.x.x.x.........'})
    VERSE1 = {'kick': 'x.......x.x.....', 'snare': '....x.......x...',
              'hat': 'x.x.x.x.x.x.x.x.'}
    for bar in range(9, 17):
        g = dict(VERSE1)
        if bar in (12, 16):
            g = {'kick': 'x.......x...X.X.', 'snare': '....x.......X.X.', 'hat': 'x.x.x.x.x.x.....',
                 'crash': '............X...'}
        K(bar, g, vel=0.68)
    K(9, {'crash': 'X...............'}, vel=0.7)
    VERSE2 = {'kick': 'x.x...x.x.x...x.', 'snare': '....x.......x...',
              'hat': 'x.X.x.X.x.X.x.X.'}
    for bar in range(17, 24):
        K(bar, VERSE2, vel=0.74)
    K(17, {'crash': 'X...............'}, vel=0.78)
    K(24, {'kick': 'x...............', 'snare': 'x.........xx..xx', 'tom_hi': '....xx..........',
           'tom_mid': '......xx........', 'tom_lo': '........xx..xx..', 'crash': 'X...............'},
      vel=0.8, ramp=0.25)
    HALF = {'kick': 'x.........x.....', 'snare': '........x.......', 'ride': 'x...x...x...x...'}
    for bar in range(25, 29):
        K(bar, {**HALF, **({'crash': 'X...............'} if bar in (25, 27) else {})}, vel=0.72)
    for bar in (29, 30):
        K(bar, {**HALF, 'tom_lo': 'x.x.x.x.x.x.x.x.', 'crash': 'X.......'}, vel=0.76, ramp=0.2)
    K(31, {'kick': 'x...x...x...x...', 'snare': 'x.x.x.x.xxxxxxxx', 'crash': 'X...............'},
      vel=0.8, ramp=0.35)
    K(32, {'kick': 'X...............', 'crash': 'X...............'}, vel=0.84)
    accel_roll(kit.parts['snare'], 32, 0.0, 4.0, v0=0.4, v1=0.98)
    CHORUS = {'kick': 'x.....x.x.....x.', 'snare': '....x.......x...',
              'ride': 'X.x.X.x.X.x.X.x.'}
    for bar in range(33, 48):
        g = dict(CHORUS)
        if bar in (33, 37, 41, 45):
            g['crash'] = 'X...............'
        if bar == 39:
            g['kick'] = 'x.....x.X.....x.'
            g['crash'] = '........X.......'
        if bar in (36, 40, 44):
            g['snare'] = '....x.......x.xx'
        if bar == 47:
            g = {'kick': 'x.....x.X.......', 'snare': '....x...X...xxxx', 'ride': 'X.x.X.x.',
                 'tom_hi': '..........xx....', 'crash': '........X.......'}
        K(bar, g, vel=0.82)
    K(48, {'kick': 'X...............', 'crash': 'X...............'}, vel=0.84)
    accel_roll(kit.parts['snare'], 48, 1.0, 3.5, v0=0.45, v1=1.0)
    # the drop: half time, a trap hat, the snare on 3
    DROP = {'kick': 'x.........x.....', 'snare': '........X.......',
            'hat': 'x.x.x.x.x.xxx.x.'}
    for bar in range(49, 53):
        g = dict(DROP)
        if bar == 49:
            g['crash'] = 'X...............'
        if bar == 51:
            g['kick'] = 'x.........x...x.'
        if bar == 52:
            g['snare'] = '........X...xxxx'
            g['hat'] = 'x.x.x.x.x.x.....'
        hat = g.pop('hat')
        K(bar, g, vel=0.82)
        K(bar, {'hat': hat}, vel=0.5)
    K(53, {'kick': 'x...............', 'crash': 'X...............', 'ride': '....x...x...x...'},
      vel=0.72)
    K(54, {'kick': 'x.......x.......', 'snare': '........x.......', 'ride': 'x...x...x...x...'},
      vel=0.74)
    K(55, {'kick': 'x.x.x.x.x.x.x.x.', 'snare': '........xxxxxxxx', 'crash': 'X...............'},
      vel=0.78, ramp=0.4)
    K(56, {'kick': 'X...', 'snare': 'X...', 'crash': 'X...', 'tom_lo': 'X...'}, vel=0.95,
      step=0.25)
    # the last crash is choked with the band
    kit.parts['cym'].expr((1, 1.0), (56.12, 1.0), (56.2, 0.0))

    # the backing track for a sung version: the lead and its violin double out
    electronics(s, kit, dict(stack=stack, wob=wob, pluck=pluck, spad=spad, sub=sub,
                             kick2=kick2, riser=riser, down=down, boom=boom))
    s.variant('backing', {'lead': None, 'vln': None, 'piano_dbl': None}, lufs=-11.8)
    s.silent_ok = set()
    s.notes_text = __doc__
    return s
