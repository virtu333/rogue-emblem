"""Act III title — Bleached Rite. The oath high on a solo violin over organ
and wordless choir, bending through the Phrygian flat second: holy, and
slightly wrong."""

from stingers._common import cue

KEYED = False
TONIC = 'E'


def build(transpose=0):
    s = cue('act_card_act3', bpm=80, bars=2, title='Act III', transpose=transpose, seed=57,
            lufs=-18.0, rt60=3.4)
    vn = s.part('solo', 'solo_violin', role='lead')
    vn.at(1).play('@mf D5q. A5e A5q G5e A5e | Eb5h D5h |')
    org = s.part('organ', 'organ', role='pad')
    org.at(1).play('@mp [D3 A3 F#4]w | [Eb3 Bb3 G4]h [D3 A3 F#4]h |')
    oohs = s.part('oohs', 'oohs', role='choir')
    oohs.at(1).play('@p [A3 D4]w | [Bb3 Eb4]h [A3 D4]h |')
    return s
