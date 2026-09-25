"""Victory — "Routed". Edric's oath as a brass fanfare in D major (the
battle's D minor, lit), then the Thread theme at rest on strings and harp."""

from engine.patterns import arp, bass, chart, drums, pad
from engine.score import Score

KEY = 'music_victory'

FANFARE_TOP = 'A4q. D5e D5q C#5e D5e | F#5h D5h | G5q. F#5e E5q D5q | F#5w |'
FANFARE_MID = 'F#4q. A4e A4q A4e A4e | D5h A4h | B4q. A4e G4q A4q | A4w |'
FANFARE_LOW = 'D4q. F#4e F#4q E4e F#4e | A4h F#4h | G4q. D4e E4q E4q | D4w |'
MEL = """
A4h D5q E5q | F#5w | E5q. D5e C#5q B4q | A4w |
A4h D5q E5q | F#5h A5h | G5q. F#5e E5q C#5q | D5w |
"""
CH = chart('D Bm7 A:2 E/G#:2 A D F#m:2 Bm:2 G:2 A7:2 D')


def build():
    s = Score('victory', bpm=104, intro_bars=4, loop_bars=8, title='Routed', seed=31)
    s.tempo(5, 80)
    s.reverb = dict(rt60=2.4, predelay_ms=26, wet_db=0.0)
    s.master = dict(lufs=-16.5, glue_ratio=1.3)
    s.variant('full', {}, lufs=-16.5)
    tpt = s.part('tpt', 'trumpets', role='lead')
    tpt.at(1).play('@f' + FANFARE_TOP)
    hn = s.part('hn', 'horns', role='lead2')
    hn.at(1).play('@f' + FANFARE_MID)
    tbn = s.part('tbn', 'trombones', role='pad')
    tbn.at(1).play('@f' + FANFARE_LOW, transpose=-12)
    tuba = s.part('tuba', 'tuba', role='low')
    tuba.at(1).play('@f D2w | D2w | G1h A1h | D2w |')
    timp = s.part('timp', 'timpani', role='timp')
    timp.at(1).play('@f D2q. A2e A2q A2e A2e | D2h A2h | G2q rq A2q A2q | %roll D2w |')
    perc = s.part('perc', 'orch_perc', role='accent')
    drums(perc, 1, {'crash': 'x', 'bd': 'x'}, vel=0.8)
    drums(perc, 4, {'crash': 'x'}, vel=0.7)
    vn_f = s.part('vn_f', 'violins', role='lead2', art='sus')
    vn_f.at(1).play('@f' + FANFARE_TOP, transpose=12)

    fl = s.part('fl', 'flute', role='lead')
    fl.at(5).play('@mp' + MEL)
    vn = s.part('vn', 'violins2', role='pad', art='soft')
    pad(vn, 5, CH, n=2, lo=62, hi=76, vel=0.42, art='soft')
    va = s.part('va', 'violas', role='pad', art='soft')
    pad(va, 5, CH, n=2, lo=53, hi=66, vel=0.42, art='soft')
    vc = s.part('vc', 'celli', role='counter', art='soft')
    vc.at(5).play('@mp F#3w | D3w | C#3h B2h | A2w | F#3w | A3h F#3h | E3h A2h | D3w |')
    cb = s.part('cb', 'basses', role='low', art='pizz')
    bass(cb, 5, CH, 'h h', 'r 5', floor=26, vel=0.5, art='pizz')
    hp = s.part('harp', 'harp', role='keys')
    arp(hp, 5, CH, '0 1 2 3 4 3 2 1', step=0.5, lo=50, hi=81, vel=0.42)
    return s
