"""Promotion, part two — the crown, from the moment the new name burns in.

An impact (timpani, bass drum, cymbal, low brass on D), then the Thread
broad in trumpets and horns (A-D-E) with the violins taking the top A, over
the heroic bVI-bVII (Bb, C)... and then the answer: the melody falls to D,
the tonic the Thread never reaches. Only this cue and the run's final
victory resolve it. 132 bpm, 4.5 s of notes over the stats and seals.
"""

from engine.patterns import drums
from stingers._common import cue

KEYED = True


def build(transpose=0):
    s = cue('promotion_crown', bpm=132, bars=2.5, title='Promotion — Crown',
            transpose=transpose, seed=19, lufs=-15.5, rt60=2.6)
    tpt = s.part('tpt', 'trumpets', role='lead')
    tpt.at(1).play('@f A4q D5q E5h | [F5 D5]h [G5 E5]h | [F#5 D5]h')
    tpt.expr_beats((0, 0.9), (4, 1.0), (8, 1.0), (10, 0.85))
    hn = s.part('horns', 'horns', role='lead2')
    hn.at(1).play('@f A3q D4q E4h | [Bb3 D4]h [C4 E4]h | [D4 F#4 A4]h')
    vn = s.part('vn', 'violins', role='lead', art='sus')
    vn.at(1).play('@f rh. A5q~ | A5h~ A5h | @ff D6h')
    vn.expr_beats((0, 0.8), (6, 1.0), (10, 0.95))
    vn2 = s.part('vn2', 'violins2', role='section', art='sus')
    vn2.at(1).play('@f [D5 A5]h [D5 A5]h | [D5 F5]h [E5 G5]h | [D5 F#5]h')
    va = s.part('va', 'violas', role='section', art='sus')
    va.at(1).play('@f A4h A4h | F4h G4h | F#4h')
    tbn = s.part('tbn', 'trombones', role='section')
    tbn.at(1).play('@ff [D3 A3]q> rq rh | @f [Bb2 F3]h [C3 G3]h | @ff [D3 A3]h')
    tuba = s.part('tuba', 'tuba', role='low')
    tuba.at(1).play('@ff D2q> rq rh | @f Bb1h C2h | @ff D2h')
    cb = s.part('cb', 'basses', role='low')
    cb.at(1).play('@f D2w | Bb1h C2h | D2h')
    vc = s.part('vc', 'celli', role='low')
    vc.at(1).play('@f D3w | Bb2h C3h | D3h')
    timp = s.part('timp', 'timpani', role='timp')
    timp.at(1).play('@ff D3q rq rh | rh %roll A2h | %default D3q rq')
    hp = s.part('harp', 'harp', role='keys')
    hp.at(1).play('@f rh D4e A4e D5e E5e | [Bb3 F4 D5]h [C4 G4 E5]h | [D4 A4 F#5]h')
    cel = s.part('celesta', 'celesta', role='accent')
    cel.at(3).play('@mf [D6 F#6 A6]h')
    perc = s.part('perc', 'orch_perc', role='accent')
    drums(perc, 1, {'crash': 'x', 'bd': 'x'}, vel=0.85)
    drums(perc, 3, {'crash': 'x'}, vel=0.7)
    return s
