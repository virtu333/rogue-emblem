"""Route map, Act I — "The Loom: Ember Dusk".

Sera reads the roads ahead as threads on a loom. Harp and pizzicato weave a
shuttle figure back and forth (up an octave, down again); the flute lays the
Thread motif across it in D dorian (the raised sixth is the dusk light). A
light snare march underneath: the warband is walking, not running.
"""

from engine.patterns import Kit, arp, bass, chart, drums, ostinato, pad
from engine.score import Score

KEY = 'music_explore_act1'

MEL_A = """
A4q D5q E5e A5q.~ | A5h B5q G5q | A5q. G5e F5q E5q | D5w |
A4q D5q E5e A5q.~ | A5q C6q B5q G5q | A5q. G5e E5q F#5q | G5w |
"""
MEL_B = """
C6h. B5q | A5q G5q E5h | F5h. G5q | A5w |
C6h. D6q | B5q G5q E5q G5q | A5q. B5e C#6q E6q | D6w |
"""
CH_A = chart('Dm C/E F G Dm Am Dm:2 D/F#:2 G')
CH_B = chart('Am Em F Dm Am G A7sus4:2 A7:2 D')
CH_TURN = chart('Bb C')


def build():
    s = Score('loom_act1', tonic='D', bpm=100, intro_bars=2, loop_bars=34, title='The Loom: Ember Dusk',
              seed=43)
    s.reverb = dict(rt60=2.0, predelay_ms=20, wet_db=-1.0)
    s.master = dict(lufs=-17.0, glue_ratio=1.3)
    s.variant('full', {}, lufs=-17.0)
    A1, A2, B, TURN = 3, 11, 19, 35
    A3 = 27

    hp = s.part('harp', 'harp', role='keys')
    shuttle = '0 1 2 3 4 3 2 1'
    arp(hp, 1, chart('Dm C'), shuttle, step=0.5, lo=50, hi=81, vel=0.5)
    for bar, ch in ((A1, CH_A), (A2, CH_A), (B, CH_B), (A3, CH_A), (TURN, CH_TURN)):
        arp(hp, bar, ch, shuttle, step=0.5, lo=50, hi=81, vel=0.48, accent_every=2, accent=0.08)
    pz = s.part('pizz', 'violins2', role='ostinato', art='pizz')
    for bar, ch in ((A2, CH_A), (B, CH_B), (A3, CH_A)):
        ostinato(pz, bar, ch, 'e e e e e e e e', '- 2 - 1 - 2 - 3', lo=62, hi=81, vel=0.5)
    cb = s.part('cb', 'basses', role='bass', art='pizz')
    for bar, ch in ((A1, CH_A), (A2, CH_A), (B, CH_B), (A3, CH_A), (TURN, CH_TURN)):
        bass(cb, bar, ch, 'q q q q', 'r - 5 -', floor=28, vel=0.55, art='pizz')

    fl = s.part('fl', 'flute', role='lead')
    fl.at(A1).play('@mf' + MEL_A)
    fl.at(A3).play('@mf' + MEL_A)
    ob = s.part('ob', 'oboe', role='lead')
    ob.at(A2).play('@mf' + MEL_A)
    vn = s.part('vn', 'violins', role='lead', art='sus')
    vn.at(B).play('@mf' + MEL_B)
    vn.at(A3).play('@mp' + MEL_A)
    vn.expr((B, 0.8), (B + 4, 1.0), (A3, 0.6))
    va = s.part('va', 'violas', role='pad', art='soft')
    for bar, ch in ((A2, CH_A), (B, CH_B), (A3, CH_A)):
        pad(va, bar, ch, n=2, lo=53, hi=67, vel=0.42, art='soft')
    vc = s.part('vc', 'celli', role='counter', art='sus')
    vc.at(B).play('@mp A3h. G3q | E3w | F3h. G3q | A3w | A3h. B3q | G3w | A3h G3h | F#3w |')
    hn = s.part('hn', 'horns', role='pad')
    pad(hn, B, CH_B, n=3, lo=50, hi=65, vel=0.48)
    hn.at(A3).play('@mp D4q. A4e A4q G4e A4e | D5h A4h | rw | rw |')

    kit = Kit(s, 'kit', gains={'kick': -8, 'snare': -6, 'cym': -8})
    march = {'snare': 'x.o.o.x.x.o.o.o.', 'kick': 'x.......x.......'}
    for b in list(range(A2, B)) + list(range(A3, TURN)):
        kit.play(b, march, vel=0.42)
    for b in range(B, A3):
        kit.play(b, {'kick': 'x.......x.......', 'shaker': 'x.x.x.x.x.x.x.x.'}, vel=0.4)
    tri = s.part('tri', 'orch_perc', role='accent', gain=-6)
    for bar in (A1, A2, B, A3):
        drums(tri, bar, {'tri': 'x'}, vel=0.5)
    glock = s.part('glock', 'glock', role='accent', gain=-5)
    glock.at(TURN).play('@mp F6q Bb6q C7q F7q | rw |')
    return s
