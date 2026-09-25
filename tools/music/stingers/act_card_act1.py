"""Act I title — Ember Dusk. Edric's oath on a warm horn, harp and strings
answering in D dorian: the road begins."""

from stingers._act import OATH
from stingers._common import cue

KEYED = False
TONIC = 'D'


def build(transpose=0):
    s = cue('act_card_act1', bpm=96, bars=2, title='Act I', transpose=transpose, seed=53,
            lufs=-17.0, rt60=2.6)
    hn = s.part('horn', 'horns', role='lead')
    hn.at(1).play(f'@mf {OATH} | D5h A4h |')
    hp = s.part('harp', 'harp', role='keys')
    hp.at(1).play('@mp D3e A3e D4e E4e A4e D5e E5e A5e | [G3 D4 B4]h [D3 A3 E4]h |')
    vc = s.part('vc', 'celli', role='low', art='soft')
    vc.at(1).play('@mp D3w | G2h D3h |')
    va = s.part('va', 'violas', role='pad', art='soft')
    va.at(1).play('@p A3w | B3h A3h |')
    fl = s.part('flute', 'flute', role='lead2')
    fl.at(2).play('@mp rh E5q A5q |')
    return s
