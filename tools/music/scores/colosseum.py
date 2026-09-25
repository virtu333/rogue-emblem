"""The colosseum — "The Pit Answers".

A human arena, not an imperial one: a fiddle calls, the crowd answers. A
drone on the open fifth and a 3+3+2 beat on bass drum and taiko hold the
ground. The call is a dry, repeated-note figure; the answer is short and
sung together (choir and horns, clipped). Across the loop the same call gets
three answers: the whole crowd, then a few voices, then none at all (only the
drums where the reply should be)... and when the loop comes round, the crowd
is back.

  A   call / crowd, call / crowd
  B   the fiddle dances over pizzicato strings; a few voices answer
  C   call / a few, call / nobody
"""

from engine.patterns import bass, chart, drums, pad
from engine.score import Score

KEY = 'music_colosseum'

CALL = 'A4e A4e C5q B4e A4e rq | E5q. D5e C5e B4e A4q |'
CROWD = "A3q' A3q' G3e' E3e' G3q' | A3h rh |"
FEW = 'A3h. rq | rw |'
DANCE = """
A4e B4e C5e A4e E5e D5e C5e B4e | G4e A4e B4e G4e D5e C5e B4e A4e |
A4e B4e C5e D5e E5e F#5e E5e D5e | E5q. D5e C5e B4e A4q |
C5e D5e E5e C5e G5e F#5e E5e D5e | B4e C5e D5e B4e F#5e E5e D5e C5e |
A4e B4e C5e D5e E5e G5e F#5e E5e | A5q. G5e F#5e E5e A4q |
"""
CH_B = chart('Am G Am Em C G D Am')
BEAT = {'bd': 'x..x..x.', 'claves': '..x..x.x', 'tamb': 'xxxxxxxx'}


def build():
    s = Score('colosseum', tonic='A', bpm=138, intro_bars=2, loop_bars=24,
              title='The Pit Answers', seed=137)
    s.reverb = dict(rt60=1.6, predelay_ms=16, wet_db=-3.0)
    s.master = dict(lufs=-15.5, glue_ratio=1.5)
    s.variant('full', {}, lufs=-15.5)
    A, B, C = 3, 11, 19

    # ------------------------------------------------------------ ground
    vc = s.part('drone_vc', 'celli', role='pad', art='sus')
    cb = s.part('drone_cb', 'basses', role='low', art='sus')
    for bar in range(1, 27):
        vc.at(bar).play('@mp [A2 E3]w')
        cb.at(bar).play('@mp A1w')
    perc = s.part('perc', 'orch_perc', role='drums')
    tk = s.part('taiko', 'taiko', role='drums')
    for bar in range(1, 27):
        drums(perc, bar, BEAT, step=0.5, vel=0.62)
        tk.at(bar).play('@mf A2e> re re A2e re re A2e A2e')

    # ------------------------------------------------------------ call and answer
    fid = s.part('fiddle', 'solo_violin', role='lead', art='spic')
    choir = s.part('crowd', 'choir', role='choir')
    choir_hi = s.part('crowd_hi', 'choir', role='choir')
    hn = s.part('crowd_hn', 'horns', role='section')
    few = s.part('few', 'oohs', role='choir')
    for bar in (A, A + 4, C, C + 4):
        fid.at(bar).play('@f' + CALL)
    for bar in (A + 2, A + 6):
        choir.at(bar).play('@f' + CROWD)
        choir_hi.at(bar).play('@f' + CROWD, transpose=12)
        hn.at(bar).play('@f' + CROWD)
    few.at(C + 2).play('@p' + FEW)
    # C+6: nobody answers; only the drums and the drone hold the place

    # ------------------------------------------------------------ the dance
    fid.at(B).play('@f' + DANCE)
    pz = s.part('pizz', 'violas', role='section', art='pizz')
    bass(pz, B, CH_B, 'e e e e e e e e', 'r 5 8 5 r 5 8 5', floor=48, vel=0.5, art='pizz')
    pvn = s.part('pizz_vn', 'violins2', role='pad', art='pizz')
    pad(pvn, B, CH_B, n=2, lo=62, hi=74, vel=0.42, art='pizz')
    few.at(B + 3).play('@pp rh A3h |')
    few.at(B + 7).play('@p rh A3h |')
    return s
