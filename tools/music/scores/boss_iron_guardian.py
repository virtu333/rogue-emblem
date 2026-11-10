"""The Iron Guardian — "No Word to Stop".

The Sunken Mine's keeper: its fight is an event battle, and plays this
because the Guardian is named in musicConfig's `bossByName`.

"Whoever buried the hall left it a keeper and no word to stop. It has not
stopped." Black iron the size of a doorway; it never moves; it marks where
its hammer falls next; it sheds a plate for each quarter of its health,
softer and angrier. 92 bpm, 4/4, on C. No drum kit and no bass guitar:
iron, skins and low brass in a hall nobody dug.

Mechanism: THE MARK AND THE FALL, over a pendulum. The bass does not hold a
note and does not walk: it swings between C and the G-flat a tritone away,
and with it two bare fifths (C-G, G-flat-D-flat), four notes that are the
whole harmony. Every phrase is five bars: four of the tune, then the mark,
a bar where the swing stops, one bright ping says where the hammer will
land, a ratchet winds (quarters, eighths, sixteenths) and the low brass
lean on the G-flat; the hammer falls on the next downbeat, all four notes
at once. You always know where it lands. It lands anyway.

The tune is the Old Kingdom's horn call gone to rust: its dotted rise of a
fifth (C, G) sags a semitone onto the G-flat as the bass swings there.

The plates: four strains, and at the head of each a plate falls (a clatter
of iron settling). Each time the swing doubles its rate (halves, quarters,
eighths, eighths in octaves), the tune loses its lowest voice and climbs
(tuba and trombones; horns; trumpets against trombones a bar apart, a
machine out of true; violins and trumpets with nothing under them), and
the gears turn faster. In the last strain the hammer no longer waits for
the fifth bar: it also falls in the middle of each phrase.

Form (bars): intro 1-4 (a ping in the dark, the hammer lifting like a
drawbridge) | S1 5-14 | S2 15-24 | S3 25-34 | S4 35-44. Loop 5-44, 40 bars.

Enrage: the hammer also falls on the far end of the swing, the third beat
of every bar of the tune, with no mark.

Not built: the four strains as four mixes on one timeline, chosen by the
plates the Guardian has left, the way the Entity's hum follows its HP.
"""

from engine.patterns import drums
from engine.score import Score
from engine.theory import pitch

from scores._battle import Battle

KEY = 'music_boss_iron_guardian'

# the rusted call: four bars, twice (written at the trombones' octave)
T1 = 'C3q. G3e Gb3h | F3q. C4e Bb3h | C4q. G3e Gb3q Db4q | C4h Bb3q Gb3q |'
T2 = 'C3q. G3e Gb3h | Eb4q. C4e Bb3h | F4q. Eb4e Db4q Bb3q | C4h Gb3h |'

INTRO, S1, S2, S3, S4, END = 1, 5, 15, 25, 35, 45
STRAINS = (S1, S2, S3, S4)
BLOWS = tuple(range(S1, END, 5))                 # the hammer: every fifth bar
MARKS = tuple(b + 4 for b in BLOWS)              # the bar before each
PLATES = (S2, S3, S4)                            # a plate falls with these blows
MID_BLOWS = (S4 + 2, S4 + 7)                     # the last strain: it stops waiting


def _tune_bars(strain):
    """The eight tune bars of a strain (its two marks left out)."""
    return [strain + k for k in (0, 1, 2, 3, 5, 6, 7, 8)]


def _breathe(part, bars, lo=0.8):
    for bar in bars:
        part.expr((bar, lo), (bar + 0.4, 1.0), (bar + 0.97, 0.9))


def build():
    s = Score('boss_iron_guardian', tonic='C', bpm=92, intro_bars=4, loop_bars=40,
              title='No Word to Stop', seed=2203)
    s.reverb = dict(rt60=3.2, predelay_ms=34, wet_db=-1.0, damp=0.55)
    s.master = dict(lufs=-13.5, glue_ratio=1.6, eq=[('peak', 250, 0.8, -2.5),
                                                    ('peak', 2500, 1.0, 1.5)])
    b = Battle(s, full_lufs=-13.5, adaptive=False)

    # ================================================================ the pendulum
    cb = b.part('swing_cb', 'basses', role='low', art='sus', gain=1)
    vc = b.part('swing_vc', 'celli', role='ostinato', art='spic')
    sub = b.part('swing_sub', 'sub', role='sub', gain=-3)
    fifth_hn = b.part('fifths_hn', 'horns', role='pad', gain=-3)
    fifth_va = b.part('fifths_va', 'violas', role='pad', art='trem', gain=-6)
    C1, GB1 = pitch('C1'), pitch('Gb1')
    for si, strain in enumerate(STRAINS):
        for bar in _tune_bars(strain):
            t0 = s.bar(bar)
            for half, root in ((0, C1), (1, GB1)):
                t = t0 + 2 * half
                sub.note(t, root + 12, 2.0, vel=0.6)
                # the two bare fifths
                lo = root + 36
                if si < 3:
                    fifth_hn.note(t, lo, 2.0, vel=0.56 + 0.04 * si, rearticulate=True)
                    fifth_hn.note(t, lo + 7, 2.0, vel=0.52 + 0.04 * si, rearticulate=True)
                if si >= 1:
                    fifth_va.note(t, lo, 2.0, vel=0.5 + 0.05 * si, rearticulate=True)
                    fifth_va.note(t, lo + 7, 2.0, vel=0.5 + 0.05 * si, rearticulate=True)
                # the swing itself: halves, quarters, eighths, eighths in octaves
                if si == 0:
                    cb.note(t, root, 2.0, vel=0.7, art='sus', rearticulate=True)
                    vc.note(t, root + 24, 0.5, vel=0.7, art='spic')
                    vc.note(t + 1.0, root + 24, 0.5, vel=0.5, art='spic')
                elif si == 1:
                    for k in range(2):
                        cb.note(t + k, root, 1.0, vel=0.72 - 0.06 * k, art='spic')
                        vc.note(t + k, root + 24, 0.5, vel=0.7 - 0.06 * k, art='spic')
                        vc.note(t + k + 0.5, root + 24, 0.5, vel=0.5, art='spic')
                else:
                    for k in range(4):
                        acc = 0.14 if k == 0 else 0.0
                        up = 12 if (si == 3 and k % 2) else 0
                        cb.note(t + 0.5 * k, root + up, 0.5, vel=0.64 + acc, art='spic')
                        vc.note(t + 0.5 * k, root + 24 + up, 0.25, vel=0.62 + acc, art='spic')
                        vc.note(t + 0.5 * k + 0.25, root + 24 + up, 0.25, vel=0.48, art='spic')

    # ================================================================ the tune
    tuba = b.part('tune_tuba', 'tuba', role='low', gain=1)
    tbn = b.part('tune_tbn', 'trombones', role='lead', gain=2,
                 eq=[('peak', 300, 1.0, -2.0), ('peak', 1500, 1.0, 2.5)])
    hn = b.part('tune_hn', 'horns', role='lead', gain=2)
    tpt = b.part('tune_tpt', 'trumpets', role='lead', gain=1)
    vn = b.part('tune_vn', 'violins', role='lead', art='trem', gain=-1)
    men = b.part('men', 'choir', role='choir', gain=1, eq=[('highshelf', 5000, 0.7, -3.0)])

    def tune(part, strain, dyn, transpose=0, delay=0.0, art=None):
        for half, text in ((0, T1), (5, T2)):
            part.at(strain + half + delay).play(
                f'@{dyn} ' + (f'%{art} ' if art else '') + text, transpose=transpose)

    # S1: all four plates. Tuba and trombones in octaves, the celli with them
    tune(tbn, S1, 'ff')
    tune(tuba, S1, 'f', transpose=-12)
    # S2: the horns take it an octave up, the trombones under them
    tune(hn, S2, 'ff', transpose=12)
    tune(tbn, S2, 'f')
    # S3: out of true. Trumpets lead; trombones and tuba follow a bar behind
    # (the follower gives up its fourth bar to the mark)
    tune(tpt, S3, 'ff', transpose=12)
    for half, text in ((0, T1), (5, T2)):
        three = ' | '.join(text.split('|')[:3]) + ' |'
        tbn.at(S3 + half + 1).play('@ff ' + three)
        tuba.at(S3 + half + 1).play('@f ' + three, transpose=-12)
    men_ch = ('[C3 G3]h [Gb2 Db3]h | ' * 4)
    for half in (0, 5):
        men.at(S3 + half).play('@f ' + men_ch)
    # S4: the last plate. Nothing under the tune but the swing: violins and trumpets
    tune(tpt, S4, 'fff', transpose=12)
    tune(vn, S4, 'ff', transpose=24, art='trem')
    tune(hn, S4, 'ff', transpose=12)
    for half in (0, 5):
        men.at(S4 + half).play('@ff ' + men_ch, transpose=12)
    for p in (tbn, hn, tpt):
        _breathe(p, [bar for st in STRAINS for bar in _tune_bars(st)])

    # ================================================================ the mark
    ping = b.part('ping', 'glock', role='accent', gain=2)
    ping_bell = b.part('ping_bell', 'bells', role='accent', gain=-2)
    ratchet = b.part('ratchet', 'orch_perc', role='accent', gain=1)
    lean = b.part('lean', 'trombones', role='section', gain=0)
    lean_tuba = b.part('lean_tuba', 'tuba', role='low', gain=-1)
    roll = b.part('roll', 'timpani', role='timp', gain=-1)
    hush = b.part('hush', 'violas', role='pad', art='trem', gain=-5)
    for i, bar in enumerate(MARKS):
        t = s.bar(bar)
        ping.note(t, 'C7', 1.0, vel=0.8)
        ping.note(t + 0.5, 'C7', 1.0, vel=0.55)
        ping_bell.note(t, 'C5', 3.0, vel=0.5)
        # the ratchet winds: quarters, eighths, sixteenths
        drums(ratchet, bar, {'claves': 'x...x...x.x.....', 'log_hi': '............x.x.',
                             'log_lo': '.............x.x', 'sn_taps': '........o.o.oooo'},
              vel=0.62, ramp=0.4)
        lean.note(t + 1.0, 'Gb2', 3.0, vel=0.7, rearticulate=True)
        lean.note(t + 1.0, 'Db3', 3.0, vel=0.66, rearticulate=True)
        lean_tuba.note(t + 1.0, 'Gb1', 3.0, vel=0.7, rearticulate=True)
        lean.expr((bar, 0.3), (bar + 0.25, 0.3), (bar + 0.97, 1.0), (bar + 1, 1.0))
        lean_tuba.expr((bar, 0.3), (bar + 0.25, 0.3), (bar + 0.97, 1.0), (bar + 1, 1.0))
        roll.at(bar).play('%roll @mf Gb2w |')
        roll.expr((bar, 0.25), (bar + 0.97, 1.0), (bar + 1, 1.0))
        hush.at(bar).play('@mp [C4 Db4 Gb4 G4]w |')
        hush.expr((bar, 0.4), (bar + 0.97, 1.0), (bar + 1, 1.0))

    # ================================================================ the fall
    f_tbn = b.part('fall_tbn', 'trombones', role='section', gain=3)
    f_tuba = b.part('fall_tuba', 'tuba', role='low', gain=2)
    f_hn = b.part('fall_hn', 'horns', role='section', gain=1)
    f_tpt = b.part('fall_tpt', 'trumpets', role='section', gain=-2)
    f_timp = b.part('fall_timp', 'timpani', role='timp', gain=2)
    f_perc = b.part('fall_perc', 'orch_perc', role='accent', gain=3)
    f_taiko = b.part('fall_taiko', 'taiko', role='drums', gain=4)
    f_bell = b.part('fall_bell', 'bells', role='accent', gain=0)

    def fall(beat, weight=1.0, gong=True):
        v = 0.9 * weight
        for p in ('C2', 'C3', 'G3'):
            f_tbn.note(beat, p, 1.5, vel=v, rearticulate=True)
        f_tuba.note(beat, 'C2', 1.5, vel=v, rearticulate=True)
        for p in ('Gb3', 'Db4'):
            f_hn.note(beat, p, 1.5, vel=v, rearticulate=True)
        for p in ('C5', 'Db5'):
            f_tpt.note(beat, p, 0.75, vel=v - 0.08, rearticulate=True)
        f_timp.note(beat, 'C2', 1.0, vel=min(1.0, v + 0.05), art='default')
        f_taiko.note(beat, 'C2', 1.0, vel=min(1.0, v + 0.08))
        f_perc.note(beat, 36, 2.0, vel=min(1.0, v))            # bass drum
        f_perc.note(beat, 67, 1.0, vel=v - 0.1)                # anvil
        if gong:
            f_perc.note(beat, 46, 4.0, vel=v - 0.2)
            f_bell.note(beat, 'C4', 4.0, vel=v - 0.25)

    for bar in BLOWS:
        fall(s.bar(bar))
    for bar in MID_BLOWS:
        # its own short mark on the beat before, then the fall
        ping.note(s.bar(bar) - 1.0, 'C7', 1.0, vel=0.8)
        fall(s.bar(bar), weight=0.92, gong=False)

    # a plate falls: iron settling on stone after the blow
    plate = b.part('plate', 'orch_perc', role='accent', gain=0)
    bounce = (1.0, 1.7, 2.2, 2.58, 2.86, 3.06, 3.2, 3.3, 3.37)
    for bar in PLATES:
        t0 = s.bar(bar)
        for i, off in enumerate(bounce):
            key = (67, 59, 67, 76, 67, 59, 76, 67, 59)[i]        # anvil, cymbal stick, log
            plate.note(t0 + off, key, 0.5, vel=max(0.18, 0.72 - 0.065 * i))

    # ================================================================ the gears
    taiko = b.part('taiko', 'taiko', role='drums', gain=2)
    gears = b.part('gears', 'orch_perc', role='accent', gain=-2)
    anvil = b.part('anvil', 'orch_perc', role='accent', gain=-5)
    t_pat = ('@f rq rq C2q rq |',
             '@f rq C2e C2e C2q rq |',
             '@f rq C2e C2e C2q C2e C2e |',
             '@ff rq C2e C2e C2e C2e C2q |')
    g_pat = ({'claves': '....x.......x...'},
             {'claves': '..x.x...x.x.x...', 'log_lo': '......x.......x.'},
             {'claves': 'x.x.x.x.x.x.x.x.', 'log_hi': '...x...x...x...x', 'log_lo': '.x...x...x...x..'},
             {'claves': 'x.xxx.xxx.xxx.xx', 'log_hi': '...x...x...x...x', 'log_lo': '.x...x...x...x..',
              'sn_taps': '....x.......x.xx'})
    for si, strain in enumerate(STRAINS):
        for bar in _tune_bars(strain):
            taiko.at(bar).play(t_pat[si])
            drums(gears, bar, g_pat[si], vel=0.5 + 0.04 * si)
            if si >= 1:
                drums(anvil, bar, {'anvil': ('..............x.', '......x.........',
                                             '..........x.....')[bar % 3]}, vel=0.5)
    timp = b.part('timp', 'timpani', role='timp')
    for si, strain in enumerate(STRAINS):
        for bar in _tune_bars(strain):
            if bar in BLOWS or bar in MID_BLOWS:
                continue
            timp.at(bar).play(('%default @mf C2q rq Gb2q rq |', '%default @f C2q rq Gb2q rq |',
                               '%default @f C2q C2e C2e Gb2q Gb2e Gb2e |',
                               '%default @ff C2q C2e C2e Gb2q Gb2e Gb2e |')[si])

    # ================================================================ intro: the hammer lifts
    ping.note(s.bar(1), 'C7', 1.0, vel=0.7)
    ping.note(s.bar(1) + 0.5, 'C7', 1.0, vel=0.45)
    ping_bell.note(s.bar(1), 'C5', 4.0, vel=0.45)
    drone = b.part('drone', 'basses', role='low', art='sus', gain=-2)
    drone.at(1).play('@p C1w~ | C1w~ | C1w~ | C1w |')
    drone.expr((1, 0.3), (4.9, 1.0))
    lift = b.part('lift', 'trombones', role='section', gain=0)
    lift_tuba = b.part('lift_tuba', 'tuba', role='low', gain=-1)
    # the house trombones stop at E2: the rise an octave up, whole (the tuba holds the floor)
    lift.at(2).play('@mp C3w~ | C3h Db3h | D3q Eb3q E3q F3e Gb3e |')
    lift_tuba.at(2).play('@mp C2w~ | C2h Db2h | D2q Eb2q E2q F2e Gb2e |')
    lift.expr((2, 0.3), (4, 0.6), (4.97, 1.0))
    lift_tuba.expr((2, 0.3), (4, 0.6), (4.97, 1.0))
    drums(ratchet, 3, {'claves': 'x.......x.......'}, vel=0.5)
    drums(ratchet, 4, {'claves': 'x...x...x.x.....', 'log_hi': '............x.x.',
                       'log_lo': '.............x.x', 'sn_taps': '........o.o.oooo'},
          vel=0.62, ramp=0.4)
    roll.at(3).play('%roll @p Gb2w~ | Gb2w |')
    roll.expr((3, 0.2), (4.97, 1.0), (5, 1.0))
    scrape = b.part('scrape', 'orch_perc', role='accent', gain=-2)
    drums(scrape, 2, {'gong_scrape': 'x'}, step=4.0, vel=0.55)

    # ================================================================ enrage: both ends of the swing
    # the hammer also falls where the bass swings to the G-flat, the third beat of
    # every bar of the tune, unmarked
    v = 'enrage_iron_guardian'
    e_tbn = b.extra(v, 'ig_tbn', 'trombones', role='section', gain=2)
    e_tuba = b.extra(v, 'ig_tuba', 'tuba', role='low', gain=1)
    e_hn = b.extra(v, 'ig_hn', 'horns', role='section', gain=0)
    e_taiko = b.extra(v, 'ig_taiko', 'taiko', role='drums', gain=4)
    e_perc = b.extra(v, 'ig_perc', 'orch_perc', role='accent', gain=2)
    for si, strain in enumerate(STRAINS):
        for bar in _tune_bars(strain):
            t = s.bar(bar) + 2.0
            w = 0.8 + 0.03 * si
            for p in ('Gb2', 'Gb3', 'Db4'):
                e_tbn.note(t, p, 1.0, vel=w, rearticulate=True)
            e_tuba.note(t, 'Gb1', 1.0, vel=w, rearticulate=True)
            for p in ('C4', 'G4'):
                e_hn.note(t, p, 1.0, vel=w - 0.06, rearticulate=True)
            e_taiko.note(t, 'C2', 1.0, vel=min(1.0, w + 0.1))
            e_taiko.note(t - 0.5, 'C2', 0.5, vel=w - 0.25)
            e_perc.note(t, 36, 2.0, vel=w)
            e_perc.note(t, 67, 1.0, vel=w - 0.15)
    b.variant_lufs[v] = -12.7
    return b.finish()
