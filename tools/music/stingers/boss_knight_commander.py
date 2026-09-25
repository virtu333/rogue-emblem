"""The Knight Commander — a polished imperial arpeggio, an expensive charge.

Trumpets climb the D minor arpeggio and close with a hard leading-tone
cadence (C#-D) over a cavalry gallop (long-short-short) in the low strings.
In the key of the Act II boss theme.
"""

from engine.patterns import drums
from stingers._common import cue

KEYED = False
TONIC = 'F'


def build(transpose=0):
    s = cue('boss_knight_commander', bpm=132, bars=2, title='Knight Commander',
            transpose=transpose, seed=37, lufs=-16.0)
    tpt = s.part('tpt', 'trumpets', role='lead')
    tpt.at(1).play('@f D4e F4e A4q D5q. C#5e | @ff D5h rh |')
    hn = s.part('horns', 'horns', role='section')
    hn.at(1).play('@f [D4 F4]q [D4 F4]q [D4 A4]q. [C#4 E4]e | [D4 F4]h rh |')
    gallop = 'D2e D2s D2s ' * 4
    cb = s.part('cb', 'basses', role='low', art='spic')
    cb.at(1).play(f'@f {gallop}| D2e D2s D2s D2e D2s D2s D2h |')
    vc = s.part('vc', 'celli', role='section', art='spic')
    vc.at(1).play(f"@f {gallop.replace('D2', 'D3')}| D3e D3s D3s D3e D3s D3s D3h |")
    timp = s.part('timp', 'timpani', role='timp')
    timp.at(1).play('@f D3q A2q D3q A2q | D3q rq rh |')
    perc = s.part('perc', 'orch_perc', role='accent')
    drums(perc, 2, {'crash': 'x', 'bd': 'x'}, vel=0.75)
    return s
