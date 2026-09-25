"""Home Base — "Embers of the Old Kingdom".

The camp between runs. A lilting 6/8 in F major (the warm relative of the
game's D minor): nylon guitar and harp by the fire, the Thread motif turned
major and unhurried on the flute (C-F-G-C: the same taut line, at rest).
Edric's oath answers on the horn in D dorian, and the last verse gathers
everyone around the melody before the guitar is left alone again.
"""

from engine.patterns import arp, bass, chart, drums, pad
from engine.score import Score

KEY = 'music_home_base'

MEL = """
C5q. F5e G5e A5e | C6q. A5q. | Bb5e A5e G5e F5q. | G5q. C5q. |
C5q. F5e G5e A5e | C6q. D6e C6e A5e | Bb5q. G5e A5e Bb5e | A5q. F5q. |
"""
COUNTER = """
A4q. C5q. | E5q. C5q. | D5q. C5q. | Bb4q. E4q. |
A4q. C5q. | A4q. F4q. | G4q. E4e F4e G4e | F4q. C4q. |
"""
HORN_B = """
D4q. A4q. | G4e A4e G4e E4q. | F4q. D4q. | E4q. C4q. |
D4q. A4q. | C5q. Bb4e A4e G4e | F4q. G4q. | A4q. rq. |
"""
CELLO_B = """
F3q. E3q. | E3q. G3q. | D3q. F3q. | G3q. E3q. |
F3q. A3q. | A3q. E3q. | D3q. E3q. | F3q. C3q. |
"""

CH_A = chart('F:3 Am:3 Bb:3 C:3 F:3 Dm:3 Gm7:1.5 C7:1.5 F:3')
CH_B = chart('Dm:3 C:3 Bb:3 C:3 Dm:3 Am:3 Bb:1.5 C:1.5 F:3')
CH_TAG = chart('Bb:3 C:3')


def build():
    s = Score('home_base', tonic='F', bpm=84, meter=(6, 8), intro_bars=2, loop_bars=34,
              title='Embers of the Old Kingdom', seed=5)
    s.reverb = dict(rt60=2.2, predelay_ms=22, wet_db=-1.0)
    s.master = dict(lufs=-17.0, glue_ratio=1.3, lead_duck=1.5)
    s.variant('full', {}, lufs=-17.0)
    A1, A2, B, A3, TAG = 3, 11, 19, 27, 35

    gtr = s.part('nylon', 'nylon', role='keys')
    arp(gtr, 1, chart('F:3 C:3'), '0 2 4 5 4 2', step=0.5, lo=48, hi=74, vel=0.55,
        accent_every=1.5, accent=0.1)
    for bar, ch in ((A1, CH_A), (A2, CH_A), (B, CH_B), (A3, CH_A), (TAG, CH_TAG)):
        arp(gtr, bar, ch, '0 2 4 5 4 2', step=0.5, lo=48, hi=74, vel=0.52,
            accent_every=1.5, accent=0.1)
    gtr.expr((1, 0.9), (A3, 0.8), (TAG, 1.0))

    hp = s.part('harp', 'harp', role='keys', gain=-3)
    for bar, ch in ((A2, CH_A), (A3, CH_A)):
        arp(hp, bar, ch, '2 3 4 5 4 3', step=0.5, lo=60, hi=86, vel=0.45)

    fl = s.part('flute', 'flute', role='lead')
    fl.at(A1).play('@mf' + MEL)
    fl.at(A2).play('@mp' + COUNTER, transpose=12)
    fl.expr((A1, 0.85), (A2 - 0.1, 1.0), (A2, 0.7), (B, 0.7))

    vn = s.part('vn', 'violins', role='lead', art='sus')
    vn.at(A2).play('@mp' + MEL)
    vn.at(A3).play('@mf' + MEL)
    vn.expr((A2, 0.7), (B - 0.1, 0.85), (A3, 0.9), (TAG - 0.1, 1.0), (TAG, 0.6))
    vn2 = s.part('vn2', 'violins2', role='pad', art='soft')
    pad(vn2, A1, CH_A, n=2, lo=60, hi=74, vel=0.4, art='soft')
    pad(vn2, B, CH_B, n=2, lo=62, hi=77, vel=0.5, art='sus')
    vn2.at(A3).play('@mp' + COUNTER, transpose=12, art='sus')
    va = s.part('va', 'violas', role='pad', art='soft')
    for bar, ch in ((A1, CH_A), (A2, CH_A), (B, CH_B), (A3, CH_A)):
        pad(va, bar, ch, n=2, lo=53, hi=67, vel=0.42, art='soft')
    vc = s.part('vc', 'celli', role='counter', art='sus')
    vc.at(B).play('@mp' + CELLO_B)
    bass(vc, A3, CH_A, 'q. q.', 'r 5', floor=36, vel=0.5, art='sus')
    cb = s.part('cb', 'basses', role='low', art='pizz')
    for bar, ch in ((A1, CH_A), (A2, CH_A), (B, CH_B), (A3, CH_A)):
        bass(cb, bar, ch, 'q. q.', 'r 5', floor=28, vel=0.55, art='pizz')

    cl = s.part('cl', 'clarinet', role='counter')
    cl.at(A2).play('@mp' + COUNTER)

    hn = s.part('hn', 'horns', role='lead')
    hn.at(B).play('@mf' + HORN_B)
    hn.at(A3).play('@mp' + MEL, transpose=-12)
    hn.expr((B, 0.85), (B + 3, 1.0), (A3, 0.7), (TAG - 0.1, 0.8))

    oohs = s.part('oohs', 'oohs', role='choir')
    pad(oohs, A3, CH_A, n=3, lo=55, hi=72, vel=0.45)
    timp = s.part('timp', 'timpani', role='timp', gain=-4)
    timp.at(A3 - 1).play('%roll @pp C3q.~ C3q. |')
    timp.expr((A3 - 1, 0.2), (A3 - 0.05, 0.9), (A3, 0.9))
    timp.at(A3).play('%default @mp F2q. rq. |')
    tri = s.part('tri', 'orch_perc', role='accent', gain=-6)
    for bar in (A2, B, A3):
        drums(tri, bar, {'tri': 'x'}, step=0.5, vel=0.5)
    glock = s.part('glock', 'glock', role='accent', gain=-4)
    glock.at(A3).play('@mp C7q. rq. | C7q. rq. | rq. rq. | rq. rq. | C7q. rq. | D7q. rq. |')
    return s
