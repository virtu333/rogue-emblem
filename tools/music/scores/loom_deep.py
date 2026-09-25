"""Route map, the last act — "The Loom: Unlight".

The Deep, where the Entity waits. This is Act I's loom (the same harp
shuttle over the same D dorian chords) with its notes taken away in three
stages, so what is missing is what you hear:

  A   the shuttle calls, and every answering bar is gone;
  B   every bar keeps its figure but loses its downbeat;
  C   only one inner note of each bar is left.

A low D drone and a faint heartbeat never stop, so the silence is never
mistaken for the music failing. Once, the flute begins the Thread and does
not finish it.
"""

from engine.patterns import arp, chart
from engine.score import Score

KEY = 'music_explore_deep'

CH = chart('Dm C/E F G Dm Am Dm:2 D/F#:2 G')
SHUTTLE = '0 1 2 3 4 3 2 1'


def build():
    s = Score('loom_deep', tonic='D', bpm=76, intro_bars=2, loop_bars=24,
              title='The Loom: Unlight', seed=141)
    s.reverb = dict(rt60=4.2, predelay_ms=40, wet_db=2.0, damp=0.5)
    s.master = dict(lufs=-24.0, glue_ratio=1.1, lead_duck=0)
    s.variant('full', {}, lufs=-24.0)
    A, B, C = 3, 11, 19
    bb = s.bar_beats

    hp = s.part('harp', 'harp', role='keys')
    for bar in (A, B, C):
        arp(hp, bar, CH, SHUTTLE, step=0.5, lo=50, hi=81, vel=0.46)

    def keep(n):
        rel = n.start - s.bar(A)
        bar_i, pos = int(rel // bb), rel % bb
        if bar_i < 8:
            return bar_i % 2 == 0                 # A: the answers are gone
        if bar_i < 16:
            return pos > 1e-9                     # B: every downbeat is gone
        return abs(pos - 1.0) < 1e-9 and bar_i % 2 == 0  # C: one inner note
    hp.notes = [n for n in hp.notes if keep(n)]

    drone = s.part('drone', 'drone', role='pad')
    cb = s.part('cb', 'basses', role='low', art='soft')
    for bar in range(1, 27):
        drone.at(bar).play('@pp D2w')
        cb.at(bar).play('@ppp D2w')
    boom = s.part('heart', 'boom', role='accent')
    for bar in range(1, 27, 2):
        boom.at(bar).play('@pp D2q rq rh')
    fl = s.part('flute', 'flute', role='lead')
    fl.at(A + 5).play('@p A4q D5q E5e rq. | rw |')
    sh = s.part('thread', 'shimmer', role='fx')
    sh.at(C).play('@pp A5w~ | A5w |')
    return s
