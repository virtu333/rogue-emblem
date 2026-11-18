"""Phantom Ganon: "Six Paintings of the Same Road".

The forest manor's gallery: six identical paintings of one road, and a rider coming
up it in two of them at once. One rider is paint. Then he gets off the horse, floats,
and serves you a ball of light, and the two of you return it, faster each time, until
somebody is late. 12/8, G minor and its tritone, C-sharp minor.

Mechanism one: WHICH PAINTING. Whenever the gallery is quiet, the rider's tune
approaches twice, far off and from opposite sides, in two keys a tritone apart:
low horns hard left in G minor and, half a bar behind them, a muted trumpet hard
right in C-sharp minor, each over its own hooves. They are the same picture: the
same notes. Then one of them turns round: its tune runs backwards (a strict
retrograde) and fades into its frame, and the other rides out of the wall with the
whole orchestra, in its key. The piece changes key only this way. The first time
the true rider is the left one (G minor); the second time it is the right one, and
the theme comes back in C-sharp minor.

Mechanism two: THE VOLLEY. The ball is an augmented arpeggio. The phantom (organ,
trombones, timpani) serves it on G; the hero (violins, trumpets, flute) returns it a
semitone higher; and so on up, so that the phantom only ever plays one whole-tone
scale and the hero the other. The gap between strokes shrinks, four beats, four,
three, three, two, two, one, one, one, one, then half-beats, exactly six bars to a
rally, the last strokes single stabs. The first rally the hero is late (a crash on
the tritone; the phantom laughs, in tritones, with the men of the choir). The second
runs its full course and the phantom is late: he falls a chromatic scale, and the
Hero's Call sounds in the brass, in G Dorian and then a third higher.

Form (12/8 bars, dotted quarter 132):
  intro 1-6    the gallery: a harpsichord, formal and dusty; an ocarina plays the
               Call (someone has come in); the harpsichord stops mid-figure. Hooves.
  R1 7-10      two riders. The right one turns back.
  A 11-18      the rider, G minor: trumpets, the horns an octave under them, over
               the gallop (low strings, a rattling harpsichord, the organ).
  A2 19-26     again with violins above and trombones below; a deceptive cadence
               onto E-flat.
  B 27-34      the manor: harpsichord over a chromatic lament bass, a solo violin
               and a glass tone above it, hooves somewhere in the walls.
  R2 35-38     two riders. This time the left one turns back.
  A3 39-46     the rider, C-sharp minor: the men of the choir sing the tune (the
               organ leaves them the room: its pedal only).
  A4 47-54     again, everyone; its last bar climbs a whole-tone scale.
  V 55-74      he rises (55-56); a rally lost (57-60), the crash and the laugh
               (61-62); a rally won (63-68); his fall (69-70); the Call (71-74).
  R3 75-78     the paintings again: he is back in them. Two riders; the right one
               turns back, and the loop rides out in G minor.
Loop 11-78 (68 bars).
"""

from __future__ import annotations

import kit  # noqa: F401  (sets sys.path, registers the instruments)
from kit import cresc, retrograde, shift, tchart

from engine.patterns import arp, bass, chart, drums, ostinato, pad   # noqa: E402
from engine.score import Score                                         # noqa: E402
from engine.theory import name as pname, pitch                         # noqa: E402

TITLE = 'Six Paintings of the Same Road (Phantom Ganon)'
OUTRO_BARS = 8
FADE_BARS = 4

INTRO, R1, A, A2, B, R2, A3, A4 = 1, 7, 11, 19, 27, 35, 39, 47
V, RL1, CRASH, RL2, FALL, CALL, R3, END = 55, 57, 61, 63, 69, 71, 75, 79
BAR = 6.0          # quarter-note beats in a bar of 12/8
BEAT = 1.5         # one dotted quarter

# ------------------------------------------------------------------ material
HEAD = 'G4q. Bb4q A4e G4q. D5q. | Eb5h. D5q C5e Bb4q A4e |'
BODY = """
G4q. Bb4q A4e G4q. Eb5q. | F#5h.+q. D5q. |
G5q. F5q Eb5e D5q. C#5q. | D5h. Bb4q A4e G4q. | C5q. Eb5q D5e C5q. A4q. |
"""
THEME = HEAD + BODY + 'G4h.+q. rq. |'
THEME_DECEPTIVE = HEAD + BODY + 'Bb4h.+q. rq. |'
THEME_RISING = HEAD + BODY + 'G4q. A4q. B4q. C#5q. |'      # a whole-tone climb, into the volley
CH = 'Gm:6 Eb:3 Bb/D:3 Gm:3 Eb:3 D:6 Gm:9/2 A7:3/2 D:3 Gm:3 Cm:9/2 D7:3/2 '
CH_A = CH + 'Gm:6'
CH_A2 = CH + 'Eb:6'
CH_A4 = CH + 'Gaug:6'
# the true rider's last stride out of the wall: up the dominant
LEAD_IN = 'D4q. F#4q. A4q. D5q. |'
# B: a chromatic lament bass under the manor's harpsichord
CH_B = 'Gm:6 D/F#:6 F:6 C/E:6 Eb:6 Bb/D:6 Cm6:6 D:6'
GHOST = """
D5h. Bb4h. | A4h.+q. D5q. | C5h. A4h. | G4h.+q. C5q. |
Bb4h. G4h. | F4h.+q. Bb4q. | A4h. Eb5h. | D5h.+h. |
"""
# the Hero's Call in 12/8: in G Dorian, then a third higher, held over the dominant
CALL_G = 'G4q. D5q E5e D5q Bb4e D5q. | G5h.+h. |'
CALL_BB = 'Bb4q. F5q G5e F5q D5e F5q. | A5h.+q. rq. |'
CH_CALL = 'Gm:6 C/G:6 Bb:6 D:6'
# the gaps between strokes of a rally, in beats: six bars exactly
GAPS = [4, 4, 3, 3, 2, 2, 1, 1, 1, 1, 0.5, 0.5, 0.5, 0.5]


def build():
    s = Score('phantom_ganon', tonic='G', bpm=198, meter=(12, 8), intro_bars=10, loop_bars=68,
              title=TITLE, seed=1987)
    # a stone gallery: hard walls, a long tail
    s.reverb = dict(rt60=2.6, predelay_ms=24, wet_db=-3.0, damp=0.5)
    s.master = dict(lufs=-14.5, glue_ratio=1.4, lead_duck=4.0,
                    eq=[('peak', 300, 0.8, -3.5), ('peak', 3600, 1.0, -1.0),
                        ('highshelf', 9000, 0.7, 1.0)])
    P = s.part
    LOWMID = [('peak', 280, 1.0, -2.5)]

    # ================================================================ the band
    hn = P('hn', 'horns', role='lead', gain=0.5, reverb=0.4, eq=[('peak', 2400, 1.0, 2.0)])
    tbn = P('tbn', 'trombones', role='lead2', gain=0.0, reverb=0.4,
            eq=LOWMID + [('peak', 2600, 1.0, 2.5)])
    tpt = P('tpt', 'trumpets', role='lead', gain=1.5, reverb=0.35,
            eq=[('peak', 3800, 1.0, -2.0), ('highshelf', 6000, 0.7, -2.0)])
    vn = P('vn', 'violins', role='lead', gain=0.0,
           eq=[('peak', 3800, 1.0, -3.0), ('highshelf', 6000, 0.7, -2.5)])
    fl = P('fl', 'flute', role='lead2', gain=-5.0)
    men = P('men', 'choir', role='lead', gain=4.0, reverb=0.4,
            eq=[('peak', 300, 1.0, -2.5), ('peak', 2500, 1.0, 2.5)])
    choir = P('choir', 'choir', role='choir', gain=-3.0, reverb=0.4, hpf=200)
    # the organ: its manuals thinned (they would sit on the tune), its pedal the bass
    organ = P('organ', 'organ', role='pad', art='loud', gain=-3.5, hpf=200,
              eq=[('peak', 320, 0.8, -6.0), ('peak', 700, 1.0, -2.5)])
    ped = P('ped', 'organ', role='low', art='loud', gain=-1.0, hpf=30,
            eq=[('lowpass', 900, 0.7, 0)])
    tuba = P('tuba', 'tuba', role='low', gain=3.0, reverb=0.3)
    cb = P('cb', 'basses', role='low', art='spic', gain=4.0)
    vc = P('vc', 'celli', role='section', art='spic', gain=-0.5, eq=[('peak', 280, 1.0, -4.0)])
    va = P('va', 'violas', role='ostinato', art='spic', gain=-1.0, eq=LOWMID)
    vn2 = P('vn2', 'violins2', role='ostinato', art='spic', gain=-1.0)
    cont = P('continuo', 'harpsichord', role='keys', gain=-3.0, hpf=200,
             eq=[('highshelf', 5000, 0.7, 4.0)])
    timp = P('timp', 'timpani', role='timp', gain=2.0)
    troll = P('timp_roll', 'timpani', role='timp', art='roll', gain=0.0)
    perc = P('perc', 'orch_perc', role='accent', gain=4.0)
    cym = P('cym', 'orch_perc', role='accent', gain=-2.0)
    snare = P('snare', 'orch_perc', role='accent', gain=-3.0, depth=0.8)
    boom = P('boom', 'boom', role='accent', gain=4.0)

    def impact(bar, vel=0.9, gong=True, note='G1'):
        boom.note(s.bar(bar), note, 2.0, vel=vel)
        drums(perc, bar, {'bd': 'x', 'gong': 'x'} if gong else {'bd': 'x'}, step=BAR, vel=vel)
        drums(cym, bar, {'crash': 'x'}, step=BAR, vel=vel - 0.12)

    def engine(bar, ch, vel=0.0):
        """The gallop under a tutti: long-short in the basses and celli, the dotted
        figure in the middle strings, a harpsichord rattling the chords, timpani."""
        bass(ped, bar, ch, 'h.', 'b', floor=36, vel=0.6, art='loud')
        bass(tuba, bar, ch, 'q. q.', 'b -', floor=31, vel=0.74 + vel)
        bass(cb, bar, ch, 'q e', 'b b', floor=26, vel=0.72 + vel, art='spic', accents='> -')
        bass(vc, bar, ch, 'q e', 'b 5', floor=38, vel=0.68 + vel, art='spic', accents='> -')
        ostinato(va, bar, ch, 'e. s e', '0 1 2', lo=55, hi=72, vel=0.6 + vel, art='spic',
                 accents='> - -')
        ostinato(vn2, bar, ch, 'e. s e', '2 1 0', lo=62, hi=81, vel=0.56 + vel, art='spic',
                 accents='> - -')
        arp(cont, bar, ch, pattern='0 2 1 2 3 2', step=0.5, lo=60, hi=84, vel=0.6,
            accent_every=1.5)
        bass(timp, bar, ch, 'q e q.', 'r r r', floor=38, vel=0.74 + vel, accents='> - -')

    # ================================================================ the rider (A, A2, A3, A4)
    def rider(bar, key, theme, ch_text, sung=False, high=False):
        """Eight bars of the rider's theme in G minor (key 0) or C-sharp minor (6)."""
        low = -6 if key else 0             # C-sharp minor lies a tritone lower in the brass
        ch = chart(tchart(ch_text, key, sharps=bool(key)))
        # the tune on top: trumpets, the horns an octave under them (G minor); the men
        # of the choir with the horns (C-sharp minor). The second time through, violins
        # and flute above and the trombones below
        if sung:
            men.at(bar).play('@ff ' + shift(theme, low))
            hn.at(bar).play('@ff ' + shift(theme, low))
        else:
            tpt.at(bar).play('@ff ' + theme)
            hn.at(bar).play('@ff ' + shift(theme, -12))
        if high:
            vn.at(bar).play('@ff ' + shift(theme, key + (0 if key else 12)))
            fl.at(bar).play('@f ' + shift(theme, key + (0 if key else 12)))
            tbn.at(bar).play('@ff ' + shift(theme, low - 12))
            if sung:
                tpt.at(bar).play('@ff ' + shift(theme, low))
            pad(choir, bar, ch, n=3, lo=62, hi=77, vel=0.6)      # the women, above
        else:
            # the trombones only stamp the strong beats
            bass(tbn, bar, ch, 'q. q.', 'b -', floor=43, vel=0.74, art='stac')
        if not (sung and not high):
            # (the first time the men sing, the organ leaves them the room: pedal only)
            pad(organ, bar, ch, n=3, lo=48, hi=64, vel=0.6, art='loud', legato_gap=0.1)
        engine(bar, ch, vel=0.04 if high else 0.0)
        for k in range(8):
            drums(perc, bar + k, {'bd': 'x.....x.....'}, step=0.5, vel=0.72)
        impact(bar, vel=0.92, gong=sung or not high)
        drums(cym, bar + 4, {'crash': 'x'}, step=BAR, vel=0.66)
        for p in (hn, tpt, men):
            for k in range(0, 8, 2):                          # each two bars lean in
                p.expr((bar + k, 0.88), (bar + k + 1.2, 1.0), (bar + k + 1.97, 0.9))

    rider(A, 0, THEME, CH_A)
    rider(A2, 0, THEME_DECEPTIVE, CH_A2, high=True)
    rider(A3, 6, THEME, CH_A, sung=True)
    rider(A4, 6, THEME_RISING, CH_A4, sung=True, high=True)
    for bar in (A2, A4):
        for k in range(8):
            drums(snare, bar + k, {'sn': 'x.xx.xx.xx.x'}, step=0.5, vel=0.5)

    # ================================================================ the gallery (R1, R2, R3)
    # two riders, far off: low horns on the left in G minor; half a bar behind them,
    # a muted trumpet on the right in C-sharp minor, an octave and a tritone above
    r_l = P('rider_l', 'horns', role='counter', gain=-6.0, pan=-1.0, depth=1.0, reverb=0.75,
            eq=[('lowpass', 2600, 0.7, 0), ('peak', 500, 1.0, 2.0)])
    r_r = P('rider_r', 'trumpets', role='counter', art='mute', gain=-9.0, pan=1.0, depth=1.0,
            reverb=0.8, eq=[('lowpass', 4500, 0.7, 0), ('highpass', 500, 0.7, 0)])
    hoof_l = P('hoof_l', 'orch_perc', role='accent', gain=-5.0, pan=-0.95, depth=0.8)
    hoof_r = P('hoof_r', 'orch_perc', role='accent', gain=-6.0, pan=0.95, depth=0.8)
    gal_l = P('gal_l', 'celli', role='ostinato', art='spic', gain=-9.0, pan=-0.9, depth=0.8)
    gal_r = P('gal_r', 'violas', role='ostinato', art='spic', gain=-13.0, pan=0.9, depth=0.8)
    CLOP = 'x.xx.xx.xx.x'

    def gallery(bar, true):
        """Four bars. Both riders come on; the false one turns round (its tune runs
        backwards) and is gone; the true one takes its last strides up the dominant."""
        end = s.bar(bar + 4)
        sides = {'l': (r_l, hoof_l, gal_l, 'log_lo', -12, 'G2', 0.0),
                 'r': (r_r, hoof_r, gal_r, 'log_hi', 6, 'C#4', 2 * BEAT)}
        for side, (line, hoof, gal, log, tr, root, late) in sides.items():
            real = side == true
            head = shift(HEAD, tr)
            t0 = s.bar(bar) + late
            first = len(line.notes)
            line.at_beat(t0).play('@mf ' + head)
            if real:
                line.at_beat(t0 + 2 * BAR).play('@f ' + shift(HEAD.split('|')[0], tr))
                # (the last bar always starts on the barline: the stride out of the wall)
                kit_clip(line, s.bar(bar + 3), end)
                line.at(bar + 3).play('@ff ' + shift(LEAD_IN, tr + (12 if side == 'l' else -12)))
                line.expr((bar, 0.35), (bar + 2, 0.7), (bar + 3, 0.9), (bar + 3.95, 1.3))
            else:
                line.at_beat(t0 + 2 * BAR).play('@mf ' + retrograde(head))
                kit_clip(line, end - 0.5, end + BAR)
                line.expr((bar, 0.35), (bar + 2, 0.7), (bar + 3.5, 0.12), (bar + 3.95, 0.05))
            assert all(n.start < end for n in line.notes[first:])
            for k in range(4):
                v = (0.45, 0.6, 0.75, 0.9)[k] if real else (0.45, 0.6, 0.4, 0.2)[k]
                drums(hoof, bar + k, {log: CLOP}, step=0.5, vel=v)
                gal.at(bar + k).play(' '.join([f'{root}q {root}e'] * 4), vel=v * 0.85)
        # the true rider's last bar: the floor begins to shake
        r = {'l': 'D2', 'r': 'G#2'}[true]
        troll.at(bar + 3).play(f'@mf {r}:6')
        cresc(troll, bar + 3, 1, lo=0.15, hi=0.9)
        drums(cym, bar + 3, {'swell_m': '......x.....'}, step=0.5, vel=0.6)

    gallery(R1, 'l')
    gallery(R2, 'r')
    gallery(R3, 'l')

    # ================================================================ intro: the gallery, empty
    hpsi = P('hpsi', 'harpsichord', role='keys', gain=-3.0, hpf=110)
    arp(hpsi, INTRO, chart('Gm:6 Gm:6 Gm:6 C:6'), pattern='0 2 4 3 4 2', step=0.5, lo=43, hi=79,
        vel=0.5, accent_every=1.5)
    # it stops in the middle of its figure
    kit_clip(hpsi, s.bar(INTRO + 4) - 2.0, s.bar(INTRO + 6))
    soft = P('org_soft', 'organ', role='pad', gain=-7.0, hpf=30)
    soft.at(INTRO).play('@p G2:12 G2:12 G2:12')
    soft.expr((INTRO, 0.5), (INTRO + 3, 0.9), (R1 - 0.05, 0.6))
    oc = P('call', 'ocarina', role='lead', gain=-6.0)
    oc.at(INTRO + 2).play('@mp ' + shift(CALL_G, 12))
    for k, v in ((4, 0.3), (5, 0.42)):
        drums(hoof_l, INTRO + k, {'log_lo': CLOP}, step=0.5, vel=v)
        drums(hoof_r, INTRO + k, {'log_hi': CLOP}, step=0.5, vel=v)

    # ================================================================ B: the manor
    ch_b = chart(CH_B)
    arp(hpsi, B, ch_b, pattern='0 2 4 3 4 2', step=0.5, lo=43, hi=79, vel=0.52, accent_every=1.5)
    bass(soft, B, ch_b, 'h.', 'b', floor=36, vel=0.5)
    pz = P('pizz', 'celli', role='bass', art='pizz', gain=-6.0)
    bass(pz, B, ch_b, 'q. q.', 'b b', floor=36, vel=0.5, art='pizz')
    ghost = P('ghost', 'solo_violin', role='lead', gain=-5.0)
    ghost.at(B).play('@mp ' + GHOST)
    for k in range(0, 8, 2):
        ghost.expr((B + k, 0.75), (B + k + 1, 1.0), (B + k + 1.97, 0.8))
    glass = P('glass', 'glass', role='pad', gain=-9.0)
    glass.at(B).play('@p ' + shift(GHOST, 12))
    for k in range(8):
        drums(hoof_l if k % 2 == 0 else hoof_r, B + k, {('log_lo' if k % 2 == 0 else 'log_hi'): CLOP},
              step=0.5, vel=0.3)

    # ================================================================ V: he rises
    wt = P('wt', 'violas', role='pad', art='trem', gain=-2.0)
    wt.at(V).play('@mp [F4 A4]:12')
    wtv = P('wtv', 'violins2', role='pad', art='trem', gain=-3.0)
    wtv.at(V).play('@mp [B4 D#5]:12')
    organ.at(V).play('%loud @mf [G2 C#3 F3 A3 B3 D#4]:12')
    ped.at(V).play('%loud @mf G2:12')
    choir.at(V).play('@mf [G3 B3 D#4 G4]:12')
    troll.at(V).play('@mf G2:12')
    for p in (wt, wtv, organ, ped, choir, troll):
        p.expr((V, 0.3), (V + 1, 0.55), (RL1 - 0.05, 1.0), (RL1, 1.0))
    drums(cym, V + 1, {'swell_l': 'x'}, step=BAR, vel=0.7)

    # ---------------------------------------------------------------- the rally
    def stroke(t0, k, beats, vel):
        """One stroke of the ball: an augmented arpeggio up from the k-th semitone
        above G, cut to the time there is. Even strokes are the phantom's."""
        dur = beats * BEAT
        phantom = k % 2 == 0
        root = pitch('G2') + k if phantom else pitch('Ab4') + k - 1
        if beats >= 1:
            notes = [(0.0, root, 0.5), (0.5, root + 4, 0.5), (1.0, root + 8, 0.5)]
            if beats >= 2:
                notes.append((1.5, root + 12, dur - 1.5))
        else:
            notes = [(0.0, p, dur) for p in (root, root + 4, root + 8)]
        if phantom:
            for off, p, d in notes:
                organ.note(t0 + off, p + 12, d, vel=vel, art='loud')
                organ.note(t0 + off, p, d, vel=vel, art='loud')
                tbn.note(t0 + off, p + 12 if p < 46 else p, d, vel=vel, rearticulate=True)
            timp.note(t0, root if root <= 55 else root - 12, 1.0, vel=vel)
            perc.note(t0, 36, 1.0, vel=vel)
            ped.note(t0, root - 12 if root - 12 >= 36 else root, max(dur, 1.0), vel=vel, art='loud')
        else:
            for off, p, d in notes:
                vn.note(t0 + off, p, d, vel=vel, rearticulate=True)
                fl.note(t0 + off, p if p <= 96 else p - 12, d, vel=vel)
                tpt.note(t0 + off, p - 12 if (root >= 76 or p > 84) else p, d, vel=vel,
                         rearticulate=True)
            cym.note(t0, 59, 0.5, vel=vel * 0.8)
        # the air between them: the stroke's own augmented triad, trembling
        for p in (root % 12 + 60, root % 12 + 64):
            wt.note(t0, p, dur, vel=min(1.0, vel * 0.8), art='trem', rearticulate=True)

    def rally(bar, n):
        t = s.bar(bar)
        for k in range(n):
            stroke(t, k, GAPS[k], vel=min(1.0, 0.72 + 0.022 * k))
            t += GAPS[k] * BEAT
        return t

    # what holds the room together while the ball is in the air: a low G under
    # everything (basses, a timpani roll) and a snare galloping
    glue_cb = P('glue_cb', 'basses', role='low', art='trem', gain=1.0)
    for bar, n_bars in ((RL1, 4), (RL2, 6)):
        for k in range(n_bars):
            glue_cb.at(bar + k).play('%trem @f [G1 G2]:6')
            drums(snare, bar + k, {'sn': 'x.xx.xx.xx.x'}, step=0.5, vel=0.42 + 0.05 * k)
        troll.at(bar).play(f'@mf G2:{6 * n_bars}')
        glue_cb.expr((bar, 0.5), (bar + n_bars - 0.05, 1.0))
        troll.expr((bar, 0.3), (bar + n_bars - 0.05, 1.0))
    end1 = rally(RL1, 5)                    # five strokes: the sixth, the hero's, is late
    assert abs(end1 - s.bar(CRASH)) < 1e-6
    end2 = rally(RL2, 14)
    assert abs(end2 - s.bar(FALL)) < 1e-6
    drums(snare, RL2 + 5, {'sn_roll': 'x' * 24}, step=0.25, vel=0.6, ramp=0.5)

    # ---------------------------------------------------------------- the crash and the laugh
    impact(CRASH, vel=1.0)
    tbn.at(CRASH).play('@fff [G2 C#3 G3]h.+h.^ |')
    tuba.at(CRASH).play('@fff G1h.+h. |')
    organ.at(CRASH).play('%loud @ff [G2 C#3 G3 C#4]h.+h. |')
    ped.at(CRASH).play('%loud @ff G2h.+h. |')
    fall_h = 'Ab5e G5e F#5e F5e E5e Eb5e D5e C#5e C5e B4e Bb4e A4e |'
    vn.at(CRASH).play('@ff ' + fall_h)
    tpt.at(CRASH).play('@ff ' + shift(fall_h, -12))
    for p in (vn, tpt):
        p.expr((CRASH, 1.0), (CRASH + 0.95, 0.35), (CRASH + 1, 1.0))
    laugh = "[G3 C#4]e' [G3 C#4]e' re [F#3 C4]e' [F#3 C4]e' re [F3 B3]e' [F3 B3]e' re [E3 Bb3]e' [E3 Bb3]e' re |"
    tbn.at(CRASH + 1).play('@ff ' + laugh)
    choir.at(CRASH + 1).play('@ff ' + laugh)
    timp.at(CRASH + 1).play('@f G2e G2e re G2e G2e re G2e G2e re G2e G2e re |')
    ped.at(CRASH + 1).play('%loud @mf G2h.+h. |')

    # ---------------------------------------------------------------- his fall
    impact(FALL, vel=1.0)
    t = s.bar(FALL)
    for i in range(18):                      # augmented triads down a chromatic scale
        v = 0.95 - 0.035 * i
        for p in (pitch('G4'), pitch('B4'), pitch('D#5')):
            organ.note(t + 0.5 * i, p - i, 0.5, vel=v, art='loud')
        vn.note(t + 0.5 * i, pitch('G6') - i, 0.5, vel=v)
        tbn.note(t + 0.5 * i, pitch('G3') - i, 0.5, vel=v, rearticulate=True)
    for p in (organ, vn, tbn):
        p.expr((FALL, 1.0), (FALL + 1.5, 0.3), (FALL + 1.95, 0.25), (CALL, 1.0))
    troll.at(FALL).play('@f G2:12')
    troll.expr((FALL, 0.9), (FALL + 1.5, 0.2), (FALL + 1.9, 0.1))
    ped.at(FALL).play('%loud @mf G2:12')
    drums(cym, FALL + 1, {'swell_m': '......x.....'}, step=0.5, vel=0.55)

    # ---------------------------------------------------------------- the Call
    ch_c = chart(CH_CALL)
    for p, tr, dyn in ((tpt, 0, 'ff'), (hn, -12, 'ff'), (vn, 12, 'ff'), (fl, 12, 'f'),
                       (tbn, -12, 'ff')):
        p.at(CALL).play(f'@{dyn} ' + shift(CALL_G + ' ' + CALL_BB, tr))
    pad(organ, CALL, ch_c, n=3, lo=48, hi=64, vel=0.6, art='loud')
    pad(choir, CALL, ch_c, n=4, lo=58, hi=77, vel=0.7)
    engine(CALL, ch_c, vel=0.04)
    for k in range(4):
        drums(perc, CALL + k, {'bd': 'x.....x.....'}, step=0.5, vel=0.74)
        drums(snare, CALL + k, {'sn': 'x.xx.xx.xx.x'}, step=0.5, vel=0.52)
    impact(CALL, vel=0.95, gong=False)
    drums(cym, CALL + 2, {'crash': 'x'}, step=BAR, vel=0.7)
    # the last bar is cut off: the paintings are quiet again
    for p in (organ, choir, ped, tuba, cb, vc, va, vn2, cont, timp, perc, snare):
        kit_clip(p, s.bar(R3) - BEAT, s.bar(R3))

    ride = [(V, 0.0), (RL1 - 0.02, 0.0), (RL1, 3.0), (CALL - 0.02, 3.0), (CALL, 0.0),
            (END - 0.02, 0.0)]
    for p in (organ, tbn, vn, tpt, fl, timp, wt):
        p.opts['fader'] = ride

    s.notes_text = __doc__
    return s


def kit_clip(part, limit, upto):
    """Cut a part off at beat `limit`: notes sounding there are shortened, notes
    starting in [limit, upto) removed."""
    part.notes = [n for n in part.notes if not (limit - 1e-9 <= n.start < upto - 1e-9)]
    for n in part.notes:
        if n.start < limit < n.end:
            n.dur = limit - n.start


if __name__ == '__main__':
    sc = build()
    print(sc.title, len(sc.parts), 'parts', pname(60))
