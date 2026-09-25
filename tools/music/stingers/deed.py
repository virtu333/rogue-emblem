"""Deed — a unit earns an epithet (the title card).

Timed to the card at normal speed (128 bpm, a beat is 469 ms): the band cuts
in with a string slash and a low tom (0), the epithet slams on brass and taiko
(beat 1.25, ~0.59 s), the brush draws with a falling harp sweep (beat 2,
~0.94 s) and the seal rings in bells and celesta (beat 3, ~1.41 s).
"""

from engine.patterns import drums
from stingers._common import cue

KEYED = True


def build(transpose=0):
    s = cue('deed', bpm=128, bars=1, title='Deed', transpose=transpose, seed=13, lufs=-16.5)
    vn = s.part('vn', 'violins', role='section', art='spic')
    vn.at(1).play('@f D5x E5x A5x D6x A6e rq rh |')
    va = s.part('va', 'violas', role='section', art='spic')
    va.at(1).play('@f A3x D4x E4x A4x D5e rq rh |')
    br = s.part('brass', 'trombones', role='section')
    br.at(1).play('@ff rq rs [D3 A3]q..> rq |')
    hn = s.part('horns', 'horns', role='section')
    hn.at(1).play('@f rq rs [D4 A4]q..> rq |')
    tk = s.part('taiko', 'taiko', role='drums')
    tk.at(1).play('@f D3e re rs D2s D2e D2q rq |')
    hp = s.part('harp', 'harp', role='keys')
    hp.at(1).play('@mf rh A6s E6s D6s A5s E5s D5s A4s D4s |')
    cel = s.part('celesta', 'celesta', role='lead')
    cel.at(1).play('@mf rh. [A5 E6]q |')
    bells = s.part('bells', 'bells', role='accent')
    bells.at(1).play('@mp rh. D5q |')
    cb = s.part('cb', 'basses', role='low')
    cb.at(1).play('@f rq rs D2q..> rq |')
    perc = s.part('perc', 'orch_perc', role='accent')
    drums(perc, 1, {'crash': '.....x..........', 'swell_s': 'x...............'}, vel=0.7)
    return s
