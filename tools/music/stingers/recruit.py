"""Recruit — someone joins the company.

Edric's oath (the Old Kingdom horn call, D-A-A-G-A) on a warm solo horn,
answered by the flute with the Thread's first three notes: a gathering, not
a loot sparkle. Open fifths and a suspended fourth, no third, so it sits
over any track. 3/4 at 100: two bars, 3.6 s, under the join card's hold.
"""

from stingers._common import cue

KEYED = True


def build(transpose=0):
    s = cue('recruit', bpm=100, bars=2, meter=(3, 4), title='Recruit', transpose=transpose,
            seed=15, lufs=-17.5, rt60=2.4)
    hn = s.part('horn', 'horns', role='lead')
    hn.at(1).play('@mf D4q. A4e A4q | G4e A4e A4h |')
    hn.expr_beats((0, 0.8), (1.5, 1.0), (6, 0.7))
    fl = s.part('flute', 'flute', role='lead2')
    fl.at(1).play('@mp rh. | rq D5e E5e A5q |')
    hp = s.part('harp', 'harp', role='keys')
    hp.at(1).play('@mp D3e A3e D4e A4e E5q | [D3 G3 D4 G4]q. A3e [D3 A3 E4]q |')
    vc = s.part('vc', 'celli', role='low', art='soft')
    vc.at(1).play('@mp D3h.~ | D3h. |')
    va = s.part('va', 'violas', role='pad', art='soft')
    va.at(1).play('@p A3h. | G3q. A3e~ A3q |')
    vn = s.part('vn', 'violins2', role='pad', art='soft')
    vn.at(1).play('@p rq D4h | D4h. |')
    return s
