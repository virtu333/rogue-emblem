"""Shop — "Varen's Mark".

Iron with the old smith's stamp, two centuries running, sold by people who
know exactly what it's worth. A sly G minor strut: clarinet with chromatic
neighbour notes, walking pizzicato, bassoon staccato, marimba on the
offbeats, accordion vamping; the B strain lifts to E-flat major like a
merchant warming to a sale.
"""

from engine.patterns import arp, bass, chart, drums, ostinato, pad
from engine.score import Score

KEY = 'music_shop'

MEL_A = """
D5e. D5s D5e Eb5e D5q Bb4q | C5e D5e Eb5e F5e G5h | F5e. Eb5s D5e C5e Bb4q G4q | A4e Bb4e C5e D5e A4h |
D5e. D5s D5e Eb5e D5q Bb4q | C5e D5e Eb5e F5e G5q Bb5q | A5e G5e F5e Eb5e D5q C5q | Bb4q A4q G4h |
"""
MEL_B = """
G5q. Eb5e Bb4q Eb5q | F5q. D5e Bb4h | C5e Eb5e G5e C6e Bb5q G5q | F#5h. D5q |
G5q. Eb5e Bb4q Eb5q | F5q. D5e Bb4q D5q | Eb5e D5e C5e Bb4e A4q F#4q | G4h. rq |
"""
CH_A = chart('Gm Cm Gm D7 Gm Cm F7:2 D7:2 Gm')
CH_B = chart('Eb Bb Cm D7 Eb Bb/D Cm:2 D7:2 Gm')


def build():
    s = Score('shop', bpm=112, intro_bars=1, loop_bars=24, title="Varen's Mark", seed=11)
    s.reverb = dict(rt60=1.4, predelay_ms=14, wet_db=-3.0)
    s.master = dict(lufs=-17.0, glue_ratio=1.4)
    s.variant('full', {}, lufs=-17.0)
    A1, A2, B = 2, 10, 18

    cl = s.part('cl', 'clarinet', role='lead')
    cl.at(A1).play('@mf' + MEL_A)
    fl = s.part('fl', 'flute', role='lead')
    fl.at(A2).play('@mf' + MEL_A, transpose=12)
    ob = s.part('ob', 'oboe', role='lead')
    ob.at(B).play('@mf' + MEL_B)
    cl.at(B).play('@mp' + MEL_B, transpose=-12)
    cl.expr((A1, 0.9), (B, 0.7))

    acc = s.part('accordion', 'accordion', role='keys', gain=-2)
    for bar, ch in ((A1, CH_A), (A2, CH_A), (B, CH_B)):
        ostinato(acc, bar, ch, 'e e e e e e e e', '- 0 - 1 - 0 - 2', lo=55, hi=72, vel=0.5)
    acc.at(1).play('@mf rh [G4 Bb4 D5]e r:1.5 |')

    pz = s.part('pizz', 'basses', role='bass', art='pizz')
    walk = 'q q q q'
    for bar, ch in ((A1, CH_A), (A2, CH_A)):
        bass(pz, bar, ch, walk, 'r 5 8 5', floor=31, vel=0.6, art='pizz')
    bass(pz, B, CH_B, walk, 'r 3 5 3', floor=31, vel=0.6, art='pizz')
    pz.at(1).play('%pizz @mf G2q D2q G2q D2q |')
    vc = s.part('vc', 'celli', role='ostinato', art='pizz')
    for bar, ch in ((A2, CH_A), (B, CH_B)):
        ostinato(vc, bar, ch, 'q q q q', '- 1 - 2', lo=48, hi=62, vel=0.5, art='pizz')
    bsn = s.part('bsn', 'bassoon', role='counter', art='stac')
    for bar, ch in ((A2, CH_A),):
        ostinato(bsn, bar, ch, 'e e q e e q', '0 1 2 2 1 0', lo=43, hi=62, vel=0.55, art='stac')
    mar = s.part('marimba', 'marimba', role='keys', gain=-3)
    for bar, ch in ((A1, CH_A), (A2, CH_A), (B, CH_B)):
        ostinato(mar, bar, ch, 'e e e e e e e e', '- 1 - 2 - 1 - 3', lo=60, hi=79, vel=0.5)
    vn = s.part('vn', 'violins2', role='pad', art='soft')
    pad(vn, B, CH_B, n=2, lo=62, hi=76, vel=0.45, art='soft')

    perc = s.part('perc', 'orch_perc', role='accent')
    for b in range(A1, B + 8):
        drums(perc, b, {'tamb': '....x.......x...', 'claves': 'x.....x.....x...'}, vel=0.5)
    drums(perc, B, {'tri': 'x'}, vel=0.5)
    return s
