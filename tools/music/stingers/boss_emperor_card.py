"""The Emperor — the anthem's cadence, and its collapse.

The organ sets D minor; trumpets sound the imperial anthem's head and its
leading-tone cadence (C#-D)... then the line sinks a flat second (Eb-D):
assertion become collapse. In the key of the Emperor's theme.
"""

from engine.patterns import drums
from stingers._common import cue

KEYED = False
TONIC = 'Bb'


def build(transpose=0):
    s = cue('boss_emperor_card', bpm=104, bars=2, title='The Emperor', transpose=transpose,
            seed=49, lufs=-16.0, rt60=2.8)
    org = s.part('organ', 'organ', role='pad', art='loud')
    org.at(1).play('@f [D3 F3 A3 D4]h. [C#3 E3 A3 C#4]q | [D3 F3 A3 D4]h [Eb3 G3 Bb3 D4]h |')
    tpt = s.part('tpt', 'trumpets', role='lead')
    tpt.at(1).play('@f A4e D5e F5q E5q C#5q | D5h Eb5q D5q |')
    tbn = s.part('tbn', 'trombones', role='section')
    tbn.at(1).play('@f [D3 A3]h. [A2 E3]q | [D3 A3]h [Eb3 Bb3]q [D3 A3]q |')
    timp = s.part('timp', 'timpani', role='timp')
    timp.at(1).play('@f D3q rq rq A2q | D3q rq rh |')
    perc = s.part('perc', 'orch_perc', role='accent')
    drums(perc, 1, {'bd': 'x', 'crash': 'x'}, vel=0.8)
    return s
