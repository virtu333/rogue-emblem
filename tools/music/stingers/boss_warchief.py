"""The Warchief — the clan's own dignity, not the Empire's brass.

Taiko in 3+3+2 under horns in open fifths (D-A, down to C-G, back to D-A)
and a low hum of the clan's voices on the fifth. In the Act I boss key.
"""

from stingers._common import cue

KEYED = False
TONIC = 'D'


def build(transpose=0):
    s = cue('boss_warchief', bpm=120, bars=2, title='Warchief', transpose=transpose, seed=35,
            lufs=-16.5)
    tk = s.part('taiko', 'taiko', role='drums')
    tk.at(1).play('@f D2e> re re D2e> re re D2e D2e | D2e> re re D2e> re re D2e> re |')
    hn = s.part('horns', 'horns', role='lead')
    hn.at(1).play('@f [D3 A3]q. [D3 A3]q. [C3 G3]q | [D3 A3]w |')
    oohs = s.part('oohs', 'oohs', role='choir')
    oohs.at(1).play('@mp [D3 A3]w | [D3 A3]w |')
    cb = s.part('cb', 'basses', role='low', art='sus')
    cb.at(1).play('@mf D2w | D2w |')
    return s
