"""The Dark Rider — sealed orders on empty roads.

A clipped gallop in the low strings leans on the semitone above the root
(D-Eb) and muted horns crawl D-Eb-D... then fall a tritone to Ab. In the key
of the Act II boss theme.
"""

from stingers._common import cue

KEYED = False
TONIC = 'F'


def build(transpose=0):
    s = cue('boss_dark_rider', bpm=126, bars=2, title='Dark Rider', transpose=transpose,
            seed=41, lufs=-17.0)
    gallop = 'D2e Eb2s D2s ' * 4
    cb = s.part('cb', 'basses', role='low', art='spic')
    cb.at(1).play(f'@f {gallop}| D2e Eb2s D2s D2e Eb2s D2s D2h |')
    vc = s.part('vc', 'celli', role='section', art='spic')
    vc.at(1).play(f"@mf {gallop.replace('D2', 'D3').replace('Eb2', 'Eb3')}| rw |")
    hn = s.part('horns', 'horns', role='lead', art='mute')
    hn.at(1).play('@f D4e. Eb4s D4q rq Ab3q~ | Ab3h D3h |')
    tk = s.part('taiko', 'taiko', role='drums')
    tk.at(1).play('@mf D2q D2q D2q D2q | D2q rq rh |')
    return s
