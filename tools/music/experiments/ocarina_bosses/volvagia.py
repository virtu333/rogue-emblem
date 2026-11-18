"""Volvagia: "The Ground and the Coil".

The fire temple's last room: a floor of rock over a lake of fire, nine wells in it,
and a dragon that comes up out of whichever one you are not looking at. It was
killed once before, with a hammer. 3/4, F minor.

Mechanism: A PASSACAGLIA THAT GETS HIT. Two things, and neither is ever changed.

  * THE GROUND is the mountain, and the hammer: eight bars, a note a bar, in the
    bass (F, A-flat, G-flat, C; D-flat, B-flat, C, C: the tonic, the Neapolitan
    root a tritone from the dominant, never a cadence). It does not stop for
    anything. Each time it comes round to its F something heavy lands on the
    floor: an anvil, a bass drum, the low brass.
  * THE COIL is the dragon: one line of eighth notes that winds up through a bar
    and back down through the next, leaning on chromatic lower neighbours, forty-
    eight notes to a turn of the ground. It never rests, except where it is hit:
    on every first beat of the ground it stops for exactly one beat, goes under,
    and comes up out of another well, another instrument in another octave
    (bassoon and celli; violas and clarinet; second violins and oboe; the
    violins).

So the piece is thirteen turns of the ground and what the coil does to survive
them. When the blow is hard enough it is stunned (the fifth turn: only its tail
twitches, and the horns play the Hero's Call over the ground). It comes back from
underneath, in the basses, with the ground driven up into the brass above it. Then
it flies: the coil in sixteenths, each bar's figure thrown an octave up and back,
and rock falls from the ceiling on the ground's dominant bars. Last, the hammer
stops waiting for the ground: its blows come every two beats across the bars, and
the coil breaks into shorter and shorter pieces.

Form (3/4; turn k of the ground is bars 8k+1 to 8k+8):
  0  (1-8)      the ground alone, pizzicato; heat; an anvil somewhere below.
  1  (9-16)     the coil: bassoon and celli.                       quarter = 112
  2  (17-24)    violas and clarinet.
  3  (25-32)    second violins and oboe; the men hum the ground.
  4  (33-40)    the violins; the ground in the low brass and the men.
  5  (41-48)    stunned. The Call, horns, over the ground. The hammer is lifted.
  6  (49-56)    from underneath: the coil in celli, basses and bassoon, the ground
                above it in horns and trumpets.
  7  (57-64)    flight: the coil in sixteenths. Rock falls.            126
  8  (65-72)    the ground on top (trumpets, the women); the coil below.
  9  (73-80)    it has gone under. Ground pizzicato, a clarinet coil, heat.   100
  10 (81-88)    eruption: every string on the coil in octaves.     126, pressing on
  11 (89-96)    the whole choir sings the ground; the hammer on every bar.
  12 (97-104)   the hammer in twos against the three; the coil in pieces; the
                ground's last four bars, alone and enormous. It is not dead.
Loop 9-104 (96 bars, turns 1-12).
"""

from __future__ import annotations

import kit
from kit import cresc, shift

from engine.patterns import chart, drums, pad   # noqa: E402
from engine.score import Score                    # noqa: E402
from engine.theory import name as pname           # noqa: E402

TITLE = 'The Ground and the Coil (Volvagia)'
OUTRO_BARS = 16
FADE_BARS = 6

# ------------------------------------------------------------------ material
GROUND = 'F1h. | Ab1h. | Gb1h. | C2h. | Db2h. | Bb1h. | C2h. | C2h. |'
CH_TXT = 'Fm:3 Fm/Ab:3 Gb:3 C7:3 Db:3 Bbm:3 C7sus4:3 C7:3'
COIL_BARS = [
    'F3e Ab3e G3e Ab3e C4e B3e', 'C4e Eb4e Db4e C4e Ab3e G3e',
    'Gb3e Bb3e A3e Bb3e Db4e C4e', 'E4e G4e F4e E4e C4e Bb3e',
    'Ab3e Db4e C4e Db4e F4e E4e', 'F4e Ab4e Gb4e F4e Db4e C4e',
    'C4e F4e E4e F4e G4e Ab4e', 'G4e E4e Db4e C4e Bb3e G3e',
]
# the Hero's Call over the ground (F Dorian: its D-natural leans on the tonic's
# sixth), its last note hung over the dominant as a suspension; then an answer
CALL = 'F4h C5q | D5q C5q Ab4q | C5h. | F5h E5q | F5h Db5q | Bb4h Db5q | C5h. | C5h. |'


def cyc(k):
    """First bar of the ground's k-th turn."""
    return 8 * k + 1


def coil_text(hit=True, bars=range(8)):
    """The coil in eighths. `hit`: its first beat is taken out (the blow)."""
    out = []
    for i in bars:
        b = COIL_BARS[i]
        if i == 0 and hit:
            b = 'rq ' + ' '.join(b.split()[2:])
        out.append(b)
    return ' | '.join(out) + ' |'


def flight_text(hit=True, bars=range(8)):
    """The coil in sixteenths: each bar's figure and the same an octave up (bars
    that wind upward) or an octave up and then at pitch (bars that wind down)."""
    out = []
    for i in bars:
        ps = kit.pitches(COIL_BARS[i])
        seq = ps + [p + 12 for p in ps] if i % 2 == 0 else [p + 12 for p in ps] + ps
        toks = [pname(p) + 's' for p in seq]
        if i == 0 and hit:
            toks = ['rq'] + toks[4:]
        out.append(' '.join(toks))
    return ' | '.join(out) + ' |'


def build():
    s = Score('volvagia', tonic='F', bpm=112, meter=(3, 4), intro_bars=8, loop_bars=96,
              title=TITLE, seed=1996)
    s.tempo(cyc(7), 126)
    s.tempo(cyc(9), 100)
    s.tempo(cyc(10), 126, ramp_to=138)
    s.tempo(cyc(13), 112)
    # a cavern under a mountain
    s.reverb = dict(rt60=2.7, predelay_ms=28, wet_db=-3.0, damp=0.55)
    s.master = dict(lufs=-14.5, glue_ratio=1.4, lead_duck=4.0,
                    eq=[('peak', 300, 0.8, -3.5), ('peak', 3600, 1.0, -1.0),
                        ('highshelf', 9000, 0.7, 1.0)])
    P = s.part
    LOWMID = [('peak', 280, 1.0, -3.0)]
    CH = chart(CH_TXT)

    # ================================================================ parts
    # the coil's wells, low to high
    bsn = P('bsn', 'bassoon', role='lead2', gain=-2.0)
    vc = P('vc', 'celli', role='lead', art='sus', gain=-1.0, eq=LOWMID)
    cl = P('cl', 'clarinet', role='lead2', gain=-6.0)
    va = P('va', 'violas', role='lead', art='sus', gain=-2.0)
    ob = P('ob', 'oboe', role='lead2', gain=-6.0)
    vn2 = P('vn2', 'violins2', role='lead', art='sus', gain=-2.0)
    vn = P('vn', 'violins', role='lead', gain=-1.0,
           eq=[('peak', 3800, 1.0, -3.0), ('highshelf', 6000, 0.7, -2.5)])
    fl = P('fl', 'flute', role='lead2', gain=-5.0)
    cbc = P('cb_coil', 'basses', role='lead2', art='sus', gain=0.0, eq=[('peak', 250, 1.0, -4.0)])
    # the ground
    cb = P('cb', 'basses', role='low', gain=4.0)
    harp = P('harp', 'harp', role='keys', gain=-4.0)
    tuba = P('tuba', 'tuba', role='low', gain=3.0, reverb=0.3)
    tbn = P('tbn', 'trombones', role='lead2', gain=1.0, reverb=0.4,
            eq=LOWMID + [('peak', 2600, 1.0, 2.5)])
    hn = P('hn', 'horns', role='lead', gain=0.5, reverb=0.4, eq=[('peak', 2400, 1.0, 2.0)])
    tpt = P('tpt', 'trumpets', role='lead', gain=-2.0, reverb=0.4,
            eq=[('peak', 3800, 1.0, -2.0), ('highshelf', 6000, 0.7, -2.0)])
    men = P('men', 'choir', role='lead', gain=3.0, reverb=0.42,
            eq=[('peak', 300, 1.0, -2.5), ('peak', 2500, 1.0, 2.0)])
    wom = P('women', 'choir', role='lead2', gain=2.0, reverb=0.42)
    hum = P('hum', 'oohs', role='choir', gain=-3.0)
    timp = P('timp', 'timpani', role='timp', gain=2.0)
    troll = P('timp_roll', 'timpani', role='timp', art='roll', gain=-1.0)
    # harmony and heat
    hpad = P('hn_pad', 'horns', role='pad', gain=-2.0, eq=LOWMID)
    tpad = P('tbn_pad', 'trombones', role='pad', gain=-4.0, eq=[('peak', 280, 1.0, -5.0)])
    heat = P('heat', 'violins', role='pad', art='trem', gain=-9.0,
             eq=[('highshelf', 5000, 0.7, -4.0)])
    glass = P('glass', 'glass', role='pad', gain=-9.0)
    # the hammer and the ceiling
    perc = P('perc', 'orch_perc', role='accent', gain=5.0, eq=[('lowshelf', 70, 0.7, 3.0)])
    anvil = P('anvil', 'orch_perc', role='accent', gain=-1.5, reverb=1.0, depth=0.9)
    cym = P('cym', 'orch_perc', role='accent', gain=-2.0)
    boom = P('boom', 'boom', role='accent', gain=7.0)
    stab = P('stab', 'trombones', role='accent', art='stac', gain=5.0, eq=LOWMID)
    rock = P('rock', 'marimba', role='accent', gain=1.0)
    rock2 = P('rock2', 'grand', role='accent', gain=-1.0)

    # ================================================================ helpers
    # heat over the floor: two notes of each bar's chord, an octave apart in glass and
    # trembling violins
    HEAT = '[C5 F5]:6 [Db5 Gb5]:3 [C5 E5]:3 [Db5 F5]:6 [C5 F5]:3 [C5 E5]:3'

    def shimmer(k, dyn='pp', strings=True):
        glass.at(cyc(k)).play(f'@{dyn} ' + HEAT)
        if strings:
            heat.at(cyc(k)).play(f'@{dyn} ' + shift(HEAT, 12))

    def ground(part, k, tr=0, dyn='f', art=None, bars=8, text=GROUND):
        cells = [c.strip() for c in text.split('|') if c.strip()][:bars]
        part.at(cyc(k)).play(f'@{dyn} ' + (f'%{art} ' if art else '')
                             + shift(' | '.join(cells) + ' |', tr))

    def coil(part, k, tr=0, dyn='f', hit=True, flight=False, bars=range(8)):
        text = flight_text(hit, bars) if flight else coil_text(hit, bars)
        first = len(part.notes)
        part.at(cyc(k) + bars[0]).play(f'@{dyn} ' + shift(text, tr))
        # played, not typed: each bar leans on its first note and swells toward the
        # top of its winding (the highest note it reaches), then lets go
        by_bar = {}
        for n in part.notes[first:]:
            by_bar.setdefault(s.bar_at(n.start), []).append(n)
        for notes in by_bar.values():
            top = max(n.pitch for n in notes)
            lo = min(n.pitch for n in notes)
            for n in notes:
                pos = n.start - s.bar(s.bar_at(n.start) + 1)
                lean = 0.1 if pos < 1e-6 else (0.04 if abs(pos % 1.0) < 1e-6 else -0.02)
                rise = 0.09 * (n.pitch - lo) / max(1, top - lo) - 0.04
                n.vel = float(min(1.0, max(0.15, n.vel + lean + rise)))

    def hammer(bar, power, gong=False, beat=0.0, note='F'):
        """The blow: an anvil and a bass drum; from half strength the low brass, a
        floor under it and a cymbal; `gong` the tam-tam too."""
        t = s.bar(bar) + beat
        anvil.note(t, 67, 1.0, vel=min(1.0, 0.35 + 0.6 * power))
        perc.note(t, 36, 1.0, vel=min(1.0, 0.4 + 0.55 * power))
        if power >= 0.5:
            boom.note(t, 'F1', 2.0, vel=min(1.0, 0.3 + 0.7 * power))
            for p in (f'{note}2', f'{note}3'):
                stab.note(t, p, 0.9, vel=min(1.0, 0.4 + 0.6 * power), art='stac')
            if note == 'F':
                stab.note(t, 'C3', 0.9, vel=min(1.0, 0.4 + 0.6 * power), art='stac')
            cym.note(t, 49, 1.0, vel=min(1.0, 0.3 + 0.5 * power))
        if gong:
            perc.note(t, 46, 1.0, vel=min(1.0, 0.4 + 0.5 * power))

    def chant(part, k, tr, dyn='ff'):
        cells = [c.strip()[:-2] for c in GROUND.split('|') if c.strip()]
        text = ' | '.join(f'{c}q> {c}q {c}q' for c in cells) + ' |'
        part.at(cyc(k)).play(f'@{dyn} ' + shift(text, tr))

    def timp_ground(k, dyn='f', rhythm='q'):
        cells = {'q': '{n}q rh', 'qq': '{n}q rq {n}q', 'gallop': '{n}q {n}e {n}e {n}q'}[rhythm]
        notes = ('F2', 'Ab2', 'Gb2', 'C3', 'Db3', 'Bb2', 'C3', 'C3')
        timp.at(cyc(k)).play(f'@{dyn} ' + ' | '.join(cells.format(n=n) for n in notes) + ' |')

    def rocks(bar, vel=0.7):
        """Rock off the ceiling: the dominant's flat-ninth chord, falling four octaves."""
        text = 'Db6s Bb5s G5s E5s Db5s Bb4s G4s E4s Db4s Bb3s G3s E3s |'
        rock.at(bar).play(text, vel=vel)
        rock2.at(bar).play(shift(text, -12), vel=vel - 0.1)

    # ================================================================ 0: the ground alone
    ground(cb, 0, 12, 'p', art='pizz')
    ground(harp, 0, 12, 'p')
    shimmer(0)
    heat.expr((cyc(0), 0.3), (cyc(0) + 6, 0.8), (cyc(1) - 0.05, 0.4))
    hammer(cyc(0), 0.1)
    hammer(cyc(0) + 4, 0.15)
    troll.at(cyc(0) + 6).play('@p C3:6')
    cresc(troll, cyc(0) + 6, 2, lo=0.15, hi=0.6)

    # ================================================================ 1-4: well after well
    # 1: bassoon and celli
    hammer(cyc(1), 0.3)
    coil(bsn, 1, 0, 'mp')
    coil(vc, 1, 0, 'mp')
    ground(cb, 1, 12, 'mp', art='pizz')
    ground(harp, 1, 12, 'mp')
    shimmer(1, strings=False)
    # 2: violas and clarinet; the celli go under and hold the bass with the tuba
    hammer(cyc(2), 0.4)
    coil(va, 2, 12, 'mf')
    coil(cl, 2, 12, 'mf')
    ground(cb, 2, 12, 'mf', art='sus')
    ground(vc, 2, 24, 'mp')
    ground(tuba, 2, 12, 'mp')
    # 3: second violins and oboe; the men hum the ground; horns hold the chords
    hammer(cyc(3), 0.55)
    coil(vn2, 3, 24, 'mf')
    coil(ob, 3, 12, 'mf')
    ground(cb, 3, 12, 'mf', art='sus')
    ground(tuba, 3, 12, 'mf')
    ground(tbn, 3, 24, 'mp')
    ground(hum, 3, 24, 'mf')
    pad(hpad, cyc(3), CH, n=3, lo=53, hi=67, vel=0.5)
    timp_ground(3, 'mf')
    # 4: the violins (flute above, violas an octave under); the low brass and the men
    hammer(cyc(4), 0.8)
    coil(vn, 4, 24, 'f')
    coil(fl, 4, 24, 'f')
    coil(va, 4, 12, 'f')
    ground(cb, 4, 12, 'f', art='sus')
    ground(tuba, 4, 12, 'f')
    ground(tbn, 4, 24, 'f')
    ground(men, 4, 24, 'f')
    pad(hpad, cyc(4), CH, n=3, lo=53, hi=67, vel=0.62)
    timp_ground(4, 'f', 'qq')
    for k in range(1, 8):
        drums(perc, cyc(4) + k, {'bd': 'x'}, step=3.0, vel=0.62)

    # ================================================================ 5: stunned
    hammer(cyc(5), 1.0, gong=True)
    hn.at(cyc(5)).play('@f ' + CALL)
    for k in range(0, 8, 4):
        hn.expr((cyc(5) + k, 0.85), (cyc(5) + k + 2, 1.0), (cyc(5) + k + 3.95, 0.85))
    # only its tail moves: the last three notes of every other bar
    for i in (1, 3, 5, 7):
        tail = 'rq. ' + ' '.join(COIL_BARS[i].split()[3:]) + ' |'
        bsn.at(cyc(5) + i).play('@p ' + tail)
        vc.at(cyc(5) + i).play('%spic @p ' + tail)
    ground(cb, 5, 12, 'mf', art='sus')
    ground(tuba, 5, 12, 'mf')
    ground(men, 5, 24, 'mf')
    pad(tpad, cyc(5), CH, n=3, lo=46, hi=62, vel=0.5)
    heat.at(cyc(5)).play('@p ' + shift(HEAT, 12))
    heat.expr((cyc(5), 0.5), (cyc(5) + 4, 0.7), (cyc(6) - 0.05, 1.3))
    # the hammer is lifted again: an anvil stroke each second bar, nearer
    for i, v in ((2, 0.35), (4, 0.5), (6, 0.65), (7, 0.8)):
        anvil.note(s.bar(cyc(5) + i), 67, 1.0, vel=v)
    troll.at(cyc(5) + 6).play('@mf C3:6')
    cresc(troll, cyc(5) + 6, 2, lo=0.2, hi=1.0)
    drums(cym, cyc(5) + 7, {'swell_m': 'x'}, step=3.0, vel=0.6)

    # ================================================================ 6: from underneath
    hammer(cyc(6), 1.0)
    coil(vc, 6, 0, 'ff')
    coil(cbc, 6, -12, 'ff')
    coil(bsn, 6, 0, 'ff')
    ground(hn, 6, 36, 'ff')
    ground(tpt, 6, 36, 'ff')
    pad(tpad, cyc(6), CH, n=3, lo=46, hi=62, vel=0.7)
    heat.at(cyc(6)).play('@mf ' + shift(HEAT, 12))
    timp_ground(6, 'f', 'qq')
    for k in range(1, 8):
        drums(perc, cyc(6) + k, {'bd': 'x'}, step=3.0, vel=0.7)
    for k in (3, 7):
        anvil.note(s.bar(cyc(6) + k), 67, 1.0, vel=0.7)

    # ================================================================ 7: flight
    hammer(cyc(7), 1.0, gong=True)
    coil(vn, 7, 12, 'ff', flight=True)
    coil(fl, 7, 12, 'ff', flight=True)
    coil(va, 7, 0, 'ff', flight=True)
    ground(cb, 7, 12, 'ff', art='sus')
    ground(tuba, 7, 12, 'ff')
    ground(tbn, 7, 24, 'ff')
    chant(men, 7, 24)
    pad(hpad, cyc(7), CH, n=3, lo=53, hi=67, vel=0.7)
    # trumpets: fire, on the second beat of every other bar
    tpt.at(cyc(7)).play("@ff rq [C5 F5]q> rq | rh. | rq [Bb4 Db5]q> rq | rh. | "
                        "rq [Db5 F5]q> rq | rh. | rq [C5 F5]q> rq | rq [C5 E5]q> [C5 E5]q> |")
    timp_ground(7, 'ff', 'gallop')
    for k in range(1, 8):
        drums(perc, cyc(7) + k, {'bd': 'x'}, step=3.0, vel=0.74)
    rocks(cyc(7) + 3, 0.72)
    rocks(cyc(7) + 7, 0.8)

    # ================================================================ 8: the ground on top
    hammer(cyc(8), 1.0)
    ground(tpt, 8, 36, 'ff')
    ground(hn, 8, 36, 'ff')
    ground(wom, 8, 36, 'ff')
    coil(va, 8, 0, 'ff', flight=True)
    coil(vc, 8, -12, 'ff', flight=True)
    ground(cb, 8, 12, 'ff', art='sus')
    ground(tuba, 8, 12, 'ff')
    pad(tpad, cyc(8), CH, n=3, lo=46, hi=62, vel=0.72)
    heat.at(cyc(8)).play('@mf ' + shift(HEAT, 12))
    timp_ground(8, 'ff', 'gallop')
    for k in range(1, 8):
        drums(perc, cyc(8) + k, {'bd': 'x'}, step=3.0, vel=0.74)
    rocks(cyc(8) + 3, 0.72)
    rocks(cyc(8) + 7, 0.8)
    drums(cym, cyc(8) + 4, {'crash': 'x'}, step=3.0, vel=0.66)

    # ================================================================ 9: gone under
    drums(perc, cyc(9), {'gong': 'x'}, step=3.0, vel=0.45)
    ground(cb, 9, 12, 'p', art='pizz')
    ground(harp, 9, 12, 'mp')
    coil(cl, 9, 0, 'p', hit=True)
    shimmer(9)
    heat.expr((cyc(9), 0.35), (cyc(9) + 5, 0.6), (cyc(10) - 0.05, 1.4), (cyc(10), 1.0))
    anvil.note(s.bar(cyc(9) + 4), 67, 1.0, vel=0.3)
    troll.at(cyc(9) + 5).play('@mp Bb2h. C3:6')
    cresc(troll, cyc(9) + 5, 3, lo=0.12, hi=1.0)
    drums(cym, cyc(9) + 7, {'swell_m': 'x'}, step=3.0, vel=0.62)

    # ================================================================ 10: eruption
    hammer(cyc(10), 1.0, gong=True)
    for part, tr in ((vn, 24), (vn2, 12), (va, 12), (vc, 0), (cbc, -12), (bsn, 0)):
        coil(part, 10, tr, 'ff')
    ground(cb, 10, 12, 'ff', art='sus')
    ground(tuba, 10, 12, 'ff')
    ground(tbn, 10, 24, 'ff')
    chant(men, 10, 24)
    pad(hpad, cyc(10), CH, n=3, lo=53, hi=67, vel=0.72)
    timp_ground(10, 'ff', 'qq')
    for k in range(1, 8):
        drums(perc, cyc(10) + k, {'bd': 'x'}, step=3.0, vel=0.74)
    for k in (3, 7):
        anvil.note(s.bar(cyc(10) + k), 67, 1.0, vel=0.75)

    # ================================================================ 11: everyone sings the ground
    hammer(cyc(11), 1.0)
    for part, tr in ((vn, 12), (fl, 12), (vn2, 12), (va, 0)):
        coil(part, 11, tr, 'ff', flight=True)
    for part, tr in ((tpt, 36), (hn, 24), (tbn, 24), (tuba, 12)):
        ground(part, 11, tr, 'fff')
    chant(men, 11, 24, 'fff')
    chant(wom, 11, 36, 'fff')
    ground(cb, 11, 12, 'ff', art='sus')
    pad(tpad, cyc(11), CH, n=3, lo=46, hi=62, vel=0.76)
    timp_ground(11, 'ff', 'gallop')
    for k in range(1, 8):
        hammer(cyc(11) + k, 0.45 + 0.03 * k)
    rocks(cyc(11) + 3, 0.76)
    rocks(cyc(11) + 7, 0.84)

    # ================================================================ 12: the hammer in twos
    c12 = cyc(12)
    notes = ('F', 'Ab', 'Gb', 'C')
    for j in range(6):                       # six blows across four bars of three
        beat = 2.0 * j
        hammer(c12 + int(beat // 3), 1.0, gong=j in (0, 5), beat=beat % 3,
               note=notes[int(beat // 3)])
    # the coil in pieces: each blow knocks a scrap of it loose, shorter every time
    # (seven sixteenths of the flight, then six, five, four, three, two)
    flight = [p for i in range(4) for p in kit.pitches(flight_text(hit=False, bars=[i]))]
    for j in range(6):
        t0 = s.bar(c12) + 2.0 * j
        for part, tr in ((vn, 12), (fl, 12), (vn2, 12), (va, 0)):
            for i in range(1, 8 - j):
                part.note(t0 + 0.25 * i, flight[8 * j + i] + tr, 0.25,
                          vel=min(1.0, 0.9 - 0.03 * i), art='default')
    # under the blows the ground is held, not chanted: nothing else keeps the three
    for part, tr in ((tpt, 36), (hn, 24), (tbn, 24), (tuba, 12), (men, 24), (wom, 36)):
        ground(part, 12, tr, 'fff')
    ground(cb, 12, 12, 'ff', art='sus')
    pad(tpad, c12, CH, n=3, lo=46, hi=62, vel=0.76)
    for j in range(6):
        beat = 2.0 * j
        timp.note(s.bar(c12) + beat, ('F2', 'Ab2', 'Gb2', 'C3')[int(beat // 3)], 1.0, vel=0.9)
    timp.at(c12 + 4).play('@ff Db3q rh | Bb2q rh | C3q rh | C3q C3q C3q |')
    # the last four bars: nothing but the ground, harmonised, and the roll
    pad(hpad, c12 + 4, CH[4:], n=3, lo=53, hi=67, vel=0.8)
    for part, tr in ((vn, 12), (vn2, 0), (va, 0)):
        part.at(c12 + 4).play('%trem @ff ' + shift('F5h. | Db5h. | C5h. | C5h. |', tr))
    troll.at(c12 + 4).play('@f Db3h. Bb2h. C3:6')
    cresc(troll, c12 + 4, 4, lo=0.5, hi=1.0)
    for k in (4, 5, 6):
        drums(perc, c12 + k, {'bd': 'x'}, step=3.0, vel=0.8)
    drums(cym, c12 + 6, {'swell_l': 'x'}, step=3.0, vel=0.75)
    # everything stops a beat short: the floor closes over it
    for p in s.parts.values():
        kit_clip(p, s.bar(cyc(13)) - 0.75, s.bar(cyc(13)))

    s.notes_text = __doc__
    return s


def kit_clip(part, limit, upto):
    part.notes = [n for n in part.notes if not (limit - 1e-9 <= n.start < upto - 1e-9)]
    for n in part.notes:
        if n.start < limit < n.end:
            n.dur = limit - n.start


if __name__ == '__main__':
    sc = build()
    print(sc.title, len(sc.parts), 'parts')
