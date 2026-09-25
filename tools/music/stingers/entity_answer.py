"""The Entity is wounded — the answer.

The hinge into the Entity's finale. The game stops the Entity's hum (the
first time its music has ever stopped), leaves two seconds of silence, then
plays this: one violin, alone, plays the Thread (A-D-E-A) at the finale's
tempo. It holds the last A to the end of bar 2, where the whole army answers
it: that downbeat is the first beat of music_boss_entity_finale, which the
game starts HANDOFF_BARS bars after this cue (sample-aligned).

In the Entity's theme the Thread is only ever heard with its answer missing;
here the answer comes.
"""

from stingers._common import cue

KEYED = False
TONIC = 'D'
# the finale's first downbeat falls at the end of this many bars
HANDOFF_BARS = 2


def build(transpose=0):
    s = cue('entity_answer', bpm=204, bars=HANDOFF_BARS, meter=(12, 8), title='The Answer',
            transpose=transpose, seed=223, lufs=-18.0, rt60=2.6)
    vn = s.part('solo', 'solo_violin', role='lead')
    vn.at(1).play('@mf A4:3 D5:3 | E5:1.5 A5:4.5 |')
    vn.expr((1, 0.7), (2, 0.85), (2.99, 1.0))
    return s
