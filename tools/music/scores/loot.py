"""Loot — "Spoils of the March". A short, bright loop for dividing the take:
Edric's oath turned light and quick on the horns over bouncing strings."""

from engine.patterns import arp, bass, chart, drums, ostinato, pad
from engine.score import Score

KEY = 'music_loot'

MEL = """
C5q F5q. E5e F5q | A5h G5h | F5q A5q. G5e F5q | E5w |
D5q F5q. E5e D5q | C5h A4h | Bb4q D5q C5q E5q | F5w |
"""
CH = chart('F C Dm C Bb F Gm:2 C:2 F')


def build():
    s = Score('loot', tonic='F', bpm=128, intro_bars=1, loop_bars=8, title='Spoils of the March', seed=29)
    s.reverb = dict(rt60=1.8, predelay_ms=18, wet_db=-2.0)
    s.master = dict(lufs=-16.5, glue_ratio=1.4)
    s.variant('full', {}, lufs=-16.5)
    hn = s.part('hn', 'horns', role='lead')
    hn.at(2).play('@f' + MEL, transpose=-12)
    vn = s.part('vn', 'violins', role='lead2', art='sus')
    vn.at(2).play('@mf' + MEL)
    ost = s.part('ost', 'violins2', role='ostinato', art='spic')
    arp(ost, 2, CH, '0 1 2 1', step=0.5, lo=62, hi=79, vel=0.55, accent_every=1)
    va = s.part('va', 'violas', role='ostinato', art='spic')
    ostinato(va, 2, CH, 'e e e e e e e e', '0 - 1 - 0 - 2 -', lo=53, hi=67, vel=0.5)
    cb = s.part('cb', 'basses', role='bass', art='pizz')
    bass(cb, 2, CH, 'q q q q', 'r 5 r 5', floor=29, vel=0.6, art='pizz')
    hp = s.part('harp', 'harp', role='accent')
    hp.at(1).play('@mf C4s F4s A4s C5s F5s A5s C6s F6s rh |')
    glock = s.part('glock', 'glock', role='accent', gain=-3)
    glock.at(2).play('@mp rw | A6h G6h | rw | E6w | rw | C6h A5h | rw | F6w |')
    perc = s.part('perc', 'orch_perc', role='accent')
    for b in range(2, 10):
        drums(perc, b, {'tamb': '..x...x...x...x.'}, vel=0.45)
    drums(perc, 2, {'sus': 'x'}, vel=0.5)
    return s
