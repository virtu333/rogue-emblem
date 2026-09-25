"""Route map, Act II — "The Loom: Iron Rain".

Contested ground: cold steel, drained colour. Celesta and marimba fall like
rain in quiet sixteenths; the Empire's half-step drill sounds far off on
muted horns and a snare that never quite stops. The oboe keeps the Thread
motif alive in C minor, and in the last strain the violins take it up under
tremolo while the drill closes in.
"""

from engine.patterns import Kit, arp, bass, chart, drums, pad
from engine.score import Score

KEY = 'music_explore_act2'

EMPIRE = 'C4q. Db4e C4q Bb3q | Ab3h. rq |'
THREAD = """
G4q C5q D5e G5q.~ | G5h F5q Eb5q | D5q. Eb5e F5q Eb5q | D5w |
G4q C5q D5e G5q.~ | G5q Bb5q Ab5q G5q | F5q. Eb5e D5q B4q | C5w |
"""
CH_A = chart('Cm Db Cm Bb Ab Db G7sus4 G7')
CH_B = chart('Cm Ab Bb Gsus4:2 G:2 Cm Eb Fm:2 G7:2 Cm')
CH_C = chart('Fm Db Fm Db Bbm Db G7sus4 G7')


def build():
    s = Score('loom_act2', tonic='C', bpm=92, intro_bars=2, loop_bars=32, title='The Loom: Iron Rain', seed=47)
    s.reverb = dict(rt60=2.4, predelay_ms=24, wet_db=0.0, damp=0.55)
    s.master = dict(lufs=-18.0, glue_ratio=1.3)
    s.variant('full', {}, lufs=-18.0)
    A, B, A2, C = 3, 11, 19, 27

    rain = s.part('celesta', 'celesta', role='keys', gain=-3)
    rain2 = s.part('marimba', 'marimba', role='keys', gain=-6)
    drops = '0 3 1 4 2 5 3 1'
    arp(rain, 1, chart('Cm Cm'), drops, step=0.25, lo=72, hi=96, vel=0.32)
    for bar, ch in ((A, CH_A), (B, CH_B), (A2, CH_B), (C, CH_C)):
        arp(rain, bar, ch, drops, step=0.25, lo=72, hi=96, vel=0.32, accent_every=1, accent=0.06)
        arp(rain2, bar, ch, '0 2 1 3', step=0.5, lo=60, hi=79, vel=0.3)

    low = s.part('low', 'celli', role='bass', art='soft')
    cb = s.part('cb', 'basses', role='low', art='soft')
    for bar, ch in ((A, CH_A), (B, CH_B), (A2, CH_B), (C, CH_C)):
        bass(low, bar, ch, 'w', 'b', floor=36, vel=0.5, art='soft')
        bass(cb, bar, ch, 'w', 'b', floor=24, vel=0.5, art='soft')
    va = s.part('va', 'violas', role='pad', art='trem')
    pad(va, A, CH_A, n=2, lo=53, hi=67, vel=0.4, art='trem')
    pad(va, C, CH_C, n=2, lo=53, hi=67, vel=0.5, art='trem')
    va.expr((A, 0.5), (B, 0.6), (C, 0.6), (C + 7.9, 1.0))

    hn = s.part('hn_mute', 'horns', role='counter', art='mute')
    hn.at(A).play('@mf' + EMPIRE + EMPIRE + EMPIRE + ' Db4q. D4e Db4q C4q | B3w |')
    hn.at(C).play('@f' + EMPIRE + EMPIRE + ' F4q. Gb4e F4q Eb4q | Db4w |')
    tpt = s.part('tpt_mute', 'trumpets', role='counter', art='mute', gain=-3)
    tpt.at(C + 4).play('@mf C5q. Db5e C5q Bb4q | Ab4h. rq | C5q. D5e C5q B4q | B4w |')

    ob = s.part('ob', 'oboe', role='lead')
    ob.at(B).play('@mf' + THREAD)
    vn = s.part('vn', 'violins', role='lead', art='sus')
    vn.at(A2).play('@mp' + THREAD)
    vn.expr((A2, 0.75), (A2 + 4, 0.9), (C, 0.7))
    vn2 = s.part('vn2', 'violins2', role='pad', art='soft')
    pad(vn2, B, CH_B, n=2, lo=60, hi=72, vel=0.38, art='soft')

    kit = Kit(s, 'kit', gains={'snare': -9, 'kick': -10})
    for b in range(A, C + 8):
        kit.play(b, {'snare': 'o.oo..o.o.oo..o.' if b < C else 'x.oox.o.x.oox.oo'}, vel=0.36)
    timp = s.part('timp', 'timpani', role='timp', gain=-3)
    for bar in (A, B, A2):
        timp.at(bar).play('@p C2q rq rh |')
    timp.at(C + 6).play('%roll @p G2w~ | G2w |')
    timp.expr((C + 6, 0.3), (C + 7.95, 1.0))
    return s
