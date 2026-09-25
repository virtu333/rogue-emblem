"""Route map, Act IV — "The Loom: Ashfall".

True night. The land has warped toward the rite and only your units carry
light. Almost nothing: a low drone, a timpani heartbeat, distant bells, and
the cor anglais-dark oboe finding the Thread motif in B minor one fragment at
a time, each fragment answered by the Empire's drill low in the bassoon.
"""

from engine.patterns import chart, pad
from engine.score import Score

KEY = 'music_explore_act4'


def build():
    s = Score('loom_act4', tonic='B', bpm=60, intro_bars=2, loop_bars=24, title='The Loom: Ashfall', seed=59)
    s.reverb = dict(rt60=4.5, predelay_ms=44, wet_db=2.0, damp=0.6)
    s.master = dict(lufs=-19.5, glue_ratio=1.2, lead_duck=0.5)
    s.variant('full', {}, lufs=-19.5)
    A, B, C = 3, 11, 19

    cb = s.part('drone', 'basses', role='low', art='soft')
    cb.at(1).play('@pp B1w~ | B1w |')
    for bar in range(A, C, 4):
        cb.at(bar).play('@p B1w~ | B1w~ | B1w~ | B1w |')
    cb.at(C).play('@p B1w | G1w | E1w | F#1w | F#1w | G1w | C2w | F#1w |')
    cb.expr((1, 0.4), (3, 0.9), (11, 0.7), (19, 1.0), (26.9, 0.6))
    vc = s.part('vc', 'celli', role='pad', art='soft')
    vc.at(A).play('@pp F#2w~ | F#2w | G2w | F#2w | F#2w~ | F#2w | G2w | F#2w |')
    vc.at(C).play('@p [F#2 B2]w | [G2 D3]w | [E2 B2]w | [F#2 C#3]w | [F#2 C#3]w | [G2 D3]w | [C2 G2]w | [F#2 C#3]w |')
    heart = s.part('heart', 'timpani', role='timp', gain=-4)
    roots = ['F#2'] * 16 + ['F#2', 'G2', 'E2', 'F#2', 'F#2', 'G2', 'C3', 'F#2']
    for i, bar in enumerate(range(A, A + 24)):
        r = roots[i]
        heart.at(bar).play(f'@pp {r}q {r}e rq. rq |')
    bells = s.part('bells', 'bells', role='accent', gain=-8)
    for bar in (A + 1, B + 1, C + 1):
        bells.at(bar).play('@p rh F#4h | rw |')

    ob = s.part('ob', 'oboe', role='lead')
    ob.at(A + 2).play('@mp F#4q B4q C#5q rq | rw |')
    ob.at(A + 6).play('@mp F#4q B4q C#5q F#5q~ | F#5h. rq |')
    ob.at(B + 2).play('@mf F#4q B4q C#5q F#5q~ | F#5h E5q D5q | C#5w | rw |')
    ob.at(C + 4).play('@mp F#4q B4q C#5q rq | rw | rw | rw |')
    bsn = s.part('bsn', 'bassoon', role='counter')
    bsn.at(A + 4).play('@mp B2q. C3e B2q A2q | G2h. rq |')
    bsn.at(B + 6).play('@mp B2q. C3e B2q A2q | G2h. rq |')
    bsn.at(C + 2).play('@mf B2q. C3e B2q A2q | F#2h. rq |')
    oohs = s.part('choir', 'oohs', role='choir', gain=-4)
    oohs.at(C).play('@p [F#3 B3 D4]w~ | [G3 B3 D4]w | [E3 G3 B3]w | [F#3 A#3 C#4]w~ | [F#3 A#3 C#4]w | rw | rw | rw |')
    shim = s.part('thread', 'shimmer', role='fx', gain=-6)
    shim.at(B + 2).play('@p F#6w~ | F#6w |')
    return s
