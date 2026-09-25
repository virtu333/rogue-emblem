"""Run victory — "The Last Light".

The Thread theme in D major, whole at last. The horns sing it first, the
violins take it up over the celli's counter-line, and in the tutti the
phrase that the title leaves hanging on C-sharp finally resolves to D: the
bells toll the root, the note the rest of the score never plays.
"""

from engine.patterns import arp, bass, chart, drums, pad
from engine.score import Score

KEY = 'music_run_win'

THEME = """
A4h D5q E5q | A5w | G5q. F#5e E5q D5q | E5w |
A4h D5q E5q | A5h D6h | B5q. A5e G5q C#5q | D5w |
"""
COUNTER = """
F#3w | D3h F#3h | E3h A3h | C#4w |
F#3w | F#3h B3h | G3h A3h | F#3w |
"""
CH = chart('D Bm7 Em7:2 G/D:2 A D F#m:2 Bm:2 G:2 A7:2 D')


def build():
    s = Score('run_win', bpm=76, intro_bars=2, loop_bars=28, title='The Last Light', seed=41)
    s.reverb = dict(rt60=2.8, predelay_ms=30, wet_db=0.5)
    s.master = dict(lufs=-16.0, glue_ratio=1.3)
    s.tempo(25, 76, ramp_to=64)
    s.tempo(27, 70)
    s.variant('full', {}, lufs=-16.0)
    A, B, C, D = 3, 11, 19, 27

    hp = s.part('harp', 'harp', role='keys')
    arp(hp, 1, chart('D Gmaj7'), '0 1 2 3 4 3 2 1', step=0.5, lo=50, hi=81, vel=0.45)
    for bar in (A, B):
        arp(hp, bar, CH, '0 1 2 3 4 3 2 1', step=0.5, lo=50, hi=81, vel=0.45)
    arp(hp, D, chart('D Gmaj7 D D'), '0 2 4 6 4 2', step=0.5, lo=50, hi=86, vel=0.4)

    hn = s.part('hn', 'horns', role='lead')
    hn.at(A).play('@mf' + THEME, transpose=-12)
    hn.at(C).play('@f' + THEME, transpose=-12)
    hn.expr((A, 0.85), (B - 0.1, 1.0), (B, 0.6), (C, 0.95))
    vn = s.part('vn', 'violins', role='lead', art='sus')
    vn.at(B).play('@mf' + THEME)
    vn.at(C).play('@ff' + THEME)
    vn.at(D).play('@mp A5w | rw | rw | rw |')
    vn.expr((B, 0.8), (C, 1.0), (D, 0.7), (D + 1, 0.3))
    vn2 = s.part('vn2', 'violins2', role='pad', art='soft')
    pad(vn2, A, CH, n=2, lo=62, hi=76, vel=0.45, art='soft')
    pad(vn2, C, CH, n=2, lo=64, hi=79, vel=0.55, art='sus')
    va = s.part('va', 'violas', role='pad', art='soft')
    for bar in (A, B, C):
        pad(va, bar, CH, n=2, lo=53, hi=67, vel=0.45, art='soft')
    vc = s.part('vc', 'celli', role='counter', art='sus')
    vc.at(B).play('@mp' + COUNTER)
    bass(vc, C, CH, 'h h', 'r 5', floor=38, vel=0.55, art='sus')
    cb = s.part('cb', 'basses', role='low', art='soft')
    for bar in (A, B, C):
        bass(cb, bar, CH, 'w', 'b', floor=26, vel=0.5, art='soft')
    cb.at(D).play('@p D2w~ | D2w~ | D2w~ | D2w |')

    choir = s.part('choir', 'choir', role='choir')
    pad(choir, C, CH, n=3, lo=55, hi=72, vel=0.55)
    tpt = s.part('tpt', 'trumpets', role='lead2', gain=-2)
    tpt.at(C + 4).play('@f A4h D5q E5q | A5h D5h | B4q. A4e G4q C#5q | D5w |')
    tbn = s.part('tbn', 'trombones', role='pad')
    pad(tbn, C, CH, n=2, lo=45, hi=60, vel=0.55)
    timp = s.part('timp', 'timpani', role='timp')
    timp.at(C - 1).play('%roll @p A2w |')
    timp.expr((C - 1, 0.25), (C - 0.05, 1.0), (C, 1.0))
    timp.at(C).play('%default @f D2h rh | rw | rw | A2h A2h | D2h rh | rw | G2h A2h | D2w |')
    perc = s.part('perc', 'orch_perc', role='accent')
    drums(perc, C - 2, {'swell_l': 'x'}, vel=0.65)
    drums(perc, C, {'crash': 'x', 'bd': 'x'}, vel=0.75)
    drums(perc, D, {'sus': 'x'}, vel=0.4)
    bells = s.part('bells', 'bells', role='accent')
    bells.at(C + 7).play('@f D5w |')                # the root, at last
    bells.at(D + 1).play('@mp D5h A4h | D5w |')
    return s
