"""Volcano battles — "Caldera" (Act IV: caldera, magma flow, eruption point).

The ground itself is hostile. B-flat is a pedal that never moves: the
contrabasses hold it, and the taiko alone beats it on every quarter. Over
it sits a collection that refuses to be a chord: A, B-flat and E, a
semitone and a tritone and no third, so nothing ever decides whether the
place is major or minor. The pulse is completely stable; the instability
is all in the pitches (One-Winged Angel's principle, with none of its
notes).

The piece is built in modules that alternate two kinds of attack, the way
a caldera alternates. BLOCKS: the collection struck in a two-bar stamp
with rests (1, 3, 3-and | 1, 2, and nothing), trombones, violas, tuba,
bass guitar and kick together, the celli singing the line's cell inside
it, the trumpets catching only its accents; in the second bar's silence
only the taiko, the anvil and the line are left. RUNS: the strings race
through the octatonic scale on B-flat (its two diminished sevenths) for
three beats and land on beat 4 on a pitch of the line, in the line's own
order (A, B-flat, E, B-flat), while the brass only hit the anchor on 1
and 3. Two anchors hold the modules together as rhetoric rather than
cuts: the anvil on beat 3 of every bar (in the stamp's empty bar it
strikes alone), and the line itself, which opens every module and is the
identity:

    Bb A Bb -  E . F E Bb  |  A Bb E -  F E Bb -

(a semitone down and back, the tritone up, the fifth as its only relief).
In the second BLOCKS the collection shifts to E, F and B (the semitone
now above the pedal, the tritone below it) and the line inverts with it.
In the third the line is augmented on full brass with a low choir on the
open fifth: the mountain's voice, no third in it. Then the runs again,
and the loop.

Form (bars, 4/4 at 120): intro 1-4 | BLOCKS 5-12 | RUNS 13-16 | BLOCKS'
17-24 | RUNS 25-28 | BROAD 29-36 | RUNS 37-40. Loop 5-40.

calm: clarinet and bassoon on the line, celli on the pedal, the piano
keeping the stamp, the taiko and the anvil kept but quiet: the ground is
still there.

lint: every sustained semitone it reports is the collection (A against
B-flat, E against F, B against B-flat in the shifted blocks); they are the
piece, not typos. No chord in the score has a third; the runs pass
through D-flat on their way, and nothing sustains it.
"""

from engine.patterns import Kit, bass, chart, drums, pad
from engine.score import Score

from scores._battle import Battle

KEY = 'music_battle_volcano'

# ------------------------------------------------------------------ material
LINE = """
Bb3q A3q Bb3h | E4q. F4e E4q Bb3q | A3q Bb3q E4h | F4q E4q Bb3h |
Bb3q A3q Bb3h | E4q. F4e E4q Bb3q | A3q Bb3q E4h | F4q E4q A3h |
"""
# the ground shifts: semitone above, tritone below
LINE_INV = """
Bb3q B3q Bb3h | F3q. E3e F3q Bb3q | B3q Bb3q F3h | E3q F3q Bb3h |
Bb3q A3q Bb3h | E4q. F4e E4q Bb3q | A3q Bb3q E4h | F4q E4q Bb3h |
"""
LINE_BROAD = """
Bb3h A3h | Bb3w | E4h. F4q | E4h Bb3h | A3h Bb3h | E4w | F4h E4h | Bb3w |
"""
# the octatonic on B-flat (W-H): Bb C Db Eb E Gb G A. Each bar races for
# three beats and lands on beat 4 on a pitch of the line, in the line's own
# order (Bb A Bb E): A, then Bb, then the tritone E, then home to Bb; the
# celli land with the violins, three octaves down
RUN = """
Bb4s C5s Db5s Eb5s E5s Gb5s G5s A5s Bb5s Db6s C6s Bb5s A5q |
A4s C5s Eb5s Gb5s A5s Gb5s Eb5s C5s Db5s E5s G5s A5s Bb5q |
Bb5s A5s G5s Gb5s E5s Gb5s G5s A5s Bb5s C6s Db6s Eb6s E6q |
E6s Eb6s Db6s C6s Bb5s A5s G5s Gb5s E5s Eb5s Db5s C5s Bb4q |
"""
RUN_LOW = """
Bb3e A3e G3e Gb3e E3e Db3e A2q | A2e C3e Eb3e Gb3e Eb3e C3e Bb2q |
Bb2e Db3e E3e G3e Bb3e G3e E3q | E3e Eb3e Db3e C3e A2e C3e Bb2q |
"""


def stamp(ch):
    """The blocks' two-bar rhythm with rests: 1, 3, 3& | 1, 2, and nothing."""
    return f'{ch}q> rq {ch}e {ch}e rq | {ch}q> {ch}q rh |'


BLOCK = stamp('[E3 A3 Bb3]')
BLOCK2 = stamp('[E3 F3 B3]')
# the trumpets catch only the accents: the downbeats and the and-of-3
BLOCK_HI = '[A4 Bb4 E5]q> rq re [A4 Bb4 E5]e rq | [A4 Bb4 E5]q> rq rh |'
# the celli sing the line's cell inside the stamp: B-flat, the tritone and
# back, then the semitone below leaning onto B-flat
CELLO_OST = 'Bb2q> rq E3e Bb2e rq | A2q> Bb2q rh |'
CELLO_OST2 = 'Bb2q> rq F3e Bb2e rq | B2q> Bb2q rh |'
LOW_STAMP = 'Bb1q> rq Bb1e Bb1e rq | Bb1q> Bb1q rh |'

PEDAL = chart('Bb5:4')

# the kit stamps with the blocks; in the runs it takes 1 and 3 (with the horn
# stabs) and the landing on 4
STAMP_A = {'kick': 'x.......x.x.....'}
STAMP_B = {'kick': 'x...x...........'}
STAMP_FILL = {'kick': 'x...x...........', 'tom_floor': '..........x.xx..', 'tom_lo': '..............xx'}
RUNS_BEAT = {'kick': 'x.......x.......', 'tom_floor': '............X...', 'tom_lo': '......x.........'}
BUILD_BEAT = {'kick': 'x...x...x...x...', 'tom_floor': 'x.x.x.x.x.x.x.x.', 'snare': '........x.x.xxxx'}


def build():
    s = Score('battle_volcano', tonic='Bb', bpm=120, intro_bars=4, loop_bars=36, title='Caldera',
              seed=229)
    s.reverb = dict(rt60=2.6, predelay_ms=28, wet_db=-0.5, damp=0.6)
    s.master = dict(lufs=-14.0, glue_ratio=1.6)
    b = Battle(s, calm_lufs=-17.0, full_lufs=-14.0)
    for name, bar, n in (('intro', 1, 4), ('M1', 5, 8), ('R1', 13, 4), ('M2', 17, 8),
                         ('R2', 25, 4), ('M3', 29, 8), ('R3', 37, 4)):
        b.section(name, bar, PEDAL * n)

    # ---------------------------------------------------------------- the pedal
    tk = b.part('taiko', 'taiko', role='drums', calm_db=-8, gain=1.0)
    tk.at(1).play('@p Bb2q> Bb2q Bb2q Bb2q |')
    tk.expr((1, 0.45), (4.9, 1.0), (5, 1.0))
    for bar in range(2, 41):
        tk.at(bar).play('@f Bb2q> Bb2q Bb2q Bb2q |')
    cb = b.part('cb', 'basses', role='low', calm_db=-2)
    cb.at(1).play('%sus @p Bb1w~ | Bb1w~ | Bb1w~ | Bb1w |')
    cb.expr((1, 0.4), (4.9, 1.0), (5, 1.0))
    # only the taiko keeps every quarter: the contrabasses hold the pedal,
    # and the tuba and bass guitar strike it with the blocks
    for sec in ('M1', 'R1', 'M2', 'R2', 'M3', 'R3'):
        bass(cb, b.bar(sec), b.chart(sec), 'w', 'r', floor=26, vel=0.6, art='sus')
    tuba = b.part('tuba', 'tuba', role='low', layer='full')
    tuba.at(3).play('@f Bb1q rq rh | Bb1q> rq Bb1e Bb1e rq |')
    for sec in ('M1', 'M2'):
        tuba.at(b.bar(sec)).play('%stac @f ' + LOW_STAMP * 4)
    for sec in ('R1', 'R2', 'R3'):
        tuba.at(b.bar(sec)).play('%stac @f ' + 'Bb1q> rq Bb1q rq |' * 4)
    bass(tuba, b.bar('M3'), b.chart('M3'), 'w', 'r', floor=28, vel=0.62, art='default')
    # no synth sub: basses, tuba and bass guitar are pedal enough
    for sec in ('M1', 'M2', 'M3'):
        b.rbass(sec, text=LOW_STAMP * 4)
    for sec in ('R1', 'R2', 'R3'):
        b.rbass(sec, rhythm='q q q q', notes='r - r -', accents='> - > -')

    # ---------------------------------------------------------------- the anvil
    perc = b.part('perc', 'orch_perc', role='accent', calm_db=-6, gain=2.5)
    # the anvil is struck with a bass drum under it: a forge, not a chime
    for bar in range(2, 41):
        drums(perc, bar, {'anvil': '........x.......'}, vel=0.8)
        drums(perc, bar, {'bd': '........x.......'}, vel=0.55)
    for bar in range(5, 41, 2):
        drums(perc, bar, {'bd': 'x...............'}, vel=0.7)
    for bar in (5, 17, 29):
        drums(perc, bar, {'gong': 'x'}, vel=0.6)

    # ---------------------------------------------------------------- blocks
    tbn = b.part('tbn_block', 'trombones', role='section', layer='full', art='stac')
    # the intro's last bar is already the stamp's first
    tbn.at(3).play('@f [E3 A3 Bb3]q> rq rh | [E3 A3 Bb3]q> rq [E3 A3 Bb3]e [E3 A3 Bb3]e rq |')
    tbn.at(5).play('@f' + BLOCK * 4)
    tbn.at(17).play('@f' + BLOCK2 * 2 + BLOCK * 2)
    tbn.at(29).play('@f' + BLOCK + BLOCK2 + BLOCK + BLOCK2)
    va = b.part('va_block', 'violas', role='ostinato', art='stac', calm_db=-6)
    va.at(5).play('@mf' + BLOCK * 4)
    va.at(17).play('@mf' + BLOCK2 * 2 + BLOCK * 2)
    va.at(29).play('@mf' + BLOCK + BLOCK2 + BLOCK + BLOCK2)
    tpt = b.part('tpt_block', 'trumpets', role='accent', layer='full', art='stac', gain=3.0)
    tpt.at(9).play('@f' + BLOCK_HI * 2)
    tpt.at(21).play('@f' + BLOCK_HI * 2)
    vc = b.part('vc_ost', 'celli', role='ostinato', art='spic', calm_db=-4)
    vc.at(5).play('@f' + CELLO_OST * 4)
    vc.at(17).play('@f' + CELLO_OST2 * 2 + CELLO_OST * 2)
    vc.at(29).play('@f' + CELLO_OST + CELLO_OST2 + CELLO_OST + CELLO_OST2)

    # ---------------------------------------------------------------- the line
    b.lead('M1', LINE, inst='horns', dyn='f', layer='full')
    b.lead('M1', LINE, inst='trombones', name='line_tbn', transpose=-12, dyn='f', role='lead2',
           layer='full')
    b.lead('M2', LINE_INV, inst='horns', dyn='f', layer='full')
    b.lead('M2', LINE_INV, inst='trombones', name='line_tbn', transpose=-12, dyn='f',
           role='lead2', layer='full')
    b.lead('M3', LINE_BROAD, inst='trumpets', name='broad_tpt', transpose=12, dyn='f',
           layer='full')
    b.lead('M3', LINE_BROAD, inst='horns', dyn='f', role='lead2', layer='full')
    b.lead('M3', LINE_BROAD, inst='trombones', name='line_tbn', transpose=-12, dyn='f',
           role='lead2', layer='full')
    b.lead('M3', LINE_BROAD, inst='violins', name='broad_vn', transpose=24, dyn='f',
           role='lead2', layer='full', art='sus')
    b.lead('M1', LINE, inst='clarinet', dyn='mf', layer='calm')
    b.lead('M1', LINE, inst='bassoon', transpose=-12, dyn='mf', role='lead2', layer='calm')
    b.lead('M2', LINE_INV, inst='clarinet', dyn='mf', layer='calm')
    b.lead('M2', LINE_INV, inst='bassoon', transpose=-12, dyn='mf', role='lead2', layer='calm')
    b.lead('M3', LINE_BROAD, inst='oboe', transpose=12, dyn='mf', layer='calm')
    b.lead('M3', LINE_BROAD, inst='clarinet', dyn='mf', role='lead2', layer='calm')
    # the mountain's voice: a low choir on the open fifth, no third in it
    b.choir('M3', 'oohs', n=3, lo=46, hi=65, vel=0.55)

    # ---------------------------------------------------------------- runs
    vn = b.part('run_vn', 'violins', role='lead', layer='full', art='spic', gain=1.0)
    vn2 = b.part('run_va_line', 'violas', role='lead2', layer='full', art='spic')
    vcr = b.part('run_vc', 'celli', role='counter', layer='full', art='spic')
    for sec in ('R1', 'R2', 'R3'):
        vn.at(b.bar(sec)).play('@f' + RUN)
        vn2.at(b.bar(sec)).play('@mf' + RUN, transpose=-12)
        vcr.at(b.bar(sec)).play('@f' + RUN_LOW)
    stab = b.part('stab_brass', 'horns', role='accent', layer='full', art='stac')
    for sec in ('R1', 'R2', 'R3'):
        stab.at(b.bar(sec)).play('@f' + '[E4 A4 Bb4]q> rq [E4 A4 Bb4]q rq |' * 4)
    b.lead('R1', RUN, inst='flute', dyn='mf', layer='calm')
    b.lead('R2', RUN, inst='flute', dyn='mf', layer='calm')
    b.lead('R3', RUN, inst='flute', dyn='mf', layer='calm')
    # a pad in the runs so the pedal keeps a ceiling
    b.pads('R1', 'violas', n=2, lo=55, hi=67, art='trem', name='run_va', layer='full')
    b.pads('R2', 'violas', n=2, lo=55, hi=67, art='trem', name='run_va', layer='full')
    b.pads('R3', 'violas', n=2, lo=55, hi=67, art='trem', name='run_va', layer='full')

    # ---------------------------------------------------------------- drums
    b.kit = Kit(s, 'kit', gains={'kick': 1.0, 'toms': 1.5})
    b.full_only.update(b.kit.names())
    b.kit.play(4, {'tom_floor': '........x.x.x.x.', 'kick': 'x.......x.......'}, vel=0.7)
    for sec, vel, extra in (('M1', 0.74, {}), ('M2', 0.76, {}),
                            ('M3', 0.78, {'crash2': 'x...............'})):
        start = b.bar(sec)
        for i in range(8):
            beat = {**STAMP_A, **extra} if i % 2 == 0 else (STAMP_FILL if i % 4 == 3 else STAMP_B)
            b.kit.play(start + i, beat, vel=vel)
        b.kit.play(start, {'crash': 'X'})
    b.groove('R1', RUNS_BEAT, None, crash=False, vel=0.74)
    b.groove('R2', RUNS_BEAT, None, crash=False, vel=0.76)
    b.groove('R3', RUNS_BEAT, None, crash=False, vel=0.78, n_bars=2)
    b.kit.play(39, BUILD_BEAT, vel=0.78)
    b.kit.play(40, {'kick': 'x...x...x.x.x.x.', 'snare': 'xxxxxxxxxxxxxxxx',
                    'tom_floor': 'x.x.x.x.x.x.x.x.'}, vel=0.84, ramp=0.5)

    b.timp('intro', '@mf rw | rw | Bb2q rq rh | %roll Bb2w %default |')
    for sec in ('M1', 'M2'):
        b.timp(sec, '@f Bb2q rq rh |')
    b.timp('M3', '%roll @mf Bb2w~ | Bb2w | %default Bb2q rq rh | rw | %roll Bb2w~ | Bb2w |'
                 ' %default Bb2q Bb2q Bb2q Bb2q | Bb2e Bb2e Bb2e Bb2e Bb2q Bb2q |')
    b.timp('R3', '@f Bb2q rq rh | rw | rw | %roll Bb2w %default |')
    b.hit(5, pieces=('crash',), vel=0.8)
    b.hit(17, pieces=('crash',), vel=0.8)
    b.hit(29, pieces=('crash',), vel=0.85)
    b.riser(27, beats=8, vel=0.5)
    b.riser(39, beats=8)

    # ---------------------------------------------------------------- calm bed
    # the piano keeps the stamp in the rain too (and the runs' 1 and 3)
    pno = b.part('c_pno', 'grand', layer='calm', role='keys')
    for sec in ('M1', 'M2', 'M3'):
        pno.at(b.bar(sec)).play('@mp ' + ('[Bb1 Bb2]q> rq [F3 Bb3]e [E3 Bb3]e rq |'
                                          ' [Bb1 Bb2]q> [E3 Bb3]q rh | ') * 4)
    for sec in ('R1', 'R2', 'R3'):
        pno.at(b.bar(sec)).play('@mp ' + '[Bb1 Bb2]q rq [E3 Bb3]q rq | ' * 4)
    clow = b.part('c_low', 'celli', layer='calm', role='bass', art='soft')
    for sec in ('M1', 'R1', 'M2', 'R2', 'M3', 'R3'):
        bass(clow, b.bar(sec), b.chart(sec), 'w', 'r', floor=38, vel=0.5, art='soft')
    ck = Kit(s, 'ckit', gains={'kick': -4})
    b.calm_only.update(ck.names())
    for bar in range(5, 41):
        in_blocks = 5 <= bar <= 12 or 17 <= bar <= 24 or 29 <= bar <= 36
        second = in_blocks and (bar - 5) % 2 == 1
        ck.play(bar, {'kick': 'x...x...........' if second else 'x.......x.......'}, vel=0.42)
    return b.finish()
