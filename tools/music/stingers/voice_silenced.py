"""A Voice falls silent — the Vigil's chant loses one of its four.

The four Voices hold the chant's last chord, the Hollow Sun's leading tone in
organum (the line, a fourth below it, an octave below, a fourth below that:
C-sharp, G-sharp, C-sharp, G-sharp in D; F-sharp and C-sharp in the Vigil's
G). The top Voice stops mid-chord; where it stops the tam-tam is scraped and
the bass drum rubbed, the word falling through the floor (the theme's own
fall, no synth); the three that are left hold the open fifths and thin away
over the next bar. Nothing resolves.

Keyed: it is written in D and sounds in the key of the Vigil's theme (G) and of
whatever else is playing.
"""

from engine.patterns import drums
from stingers._common import cue

KEYED = True


def build(transpose=0):
    s = cue('voice_silenced', bpm=96, bars=2, title='A Voice Falls Silent',
            transpose=transpose, seed=47, lufs=-18.5, rt60=3.2)
    top = s.part('v1', 'choir', role='lead', humanize_ms=8)
    top.at(1).play('@mf C#5h rh | rw |')
    top.expr_beats((0, 0.9), (1.7, 1.0), (2.0, 0.0))
    for name, inst, pitch in (('v2', 'oohs', 'G#4'), ('v3', 'choir', 'C#4'),
                              ('v4', 'oohs', 'G#3')):
        p = s.part(name, inst, role='lead2', humanize_ms=8)
        p.at(1).play(f'@mf {pitch}w~ | {pitch}w |')
        p.expr_beats((0, 0.9), (2.0, 1.0), (4.0, 0.7), (7.5, 0.0))
    # the scrape and the rub levelled apart: the rub is only the floor under the scrape
    scr = s.part('scrape', 'orch_perc', role='accent', pan=0.0, gain=0)
    drums(scr, 1 + 0.45, {'gong_scrape': 'X'}, vel=0.85)
    rub = s.part('rub', 'orch_perc', role='accent', pan=0.0, gain=-6)
    drums(rub, 1 + 0.45, {'bd_rub': 'x'}, vel=0.7)
    return s
