"""Defeat — "The Thread Is Cut". A solo cello begins the Thread theme and
stops mid-line, where Sera's vision collapses. What loops afterwards is the
dark: a low drone, a far bell, and the first three notes of the thread on the
piano, never reaching the fourth."""

from engine.score import Score

KEY = 'music_defeat'


def build():
    s = Score('defeat', tonic='D', bpm=58, intro_bars=5, loop_bars=8, title='The Thread Is Cut', seed=37)
    s.reverb = dict(rt60=3.8, predelay_ms=36, wet_db=1.5)
    s.silent_ok = {5}  # the bar of dark after the cello breaks off
    s.master = dict(lufs=-20.0, glue_ratio=1.2, lead_duck=0)
    s.variant('full', {}, lufs=-20.0)
    vc = s.part('cello', 'celli', role='lead', art='sus')
    vc.at(1).play('@mf A3h D4q E4q | A4w | G4q. F4e E4q D4q~ | D4h rh | rw |')
    vc.expr((1, 0.8), (2, 1.0), (3, 0.9), (4, 0.5), (4.5, 0.2))
    vn = s.part('pad', 'violins2', role='pad', art='soft')
    vn.at(1).play('@p [F4 A4]w | [F4 A4]w | [E4 G4]w | rw | rw |')
    va = s.part('va', 'violas', role='pad', art='soft')
    va.at(1).play('@p D4w | D4w | Bb3w | rw | rw |')
    cb = s.part('drone', 'basses', role='low', art='soft')
    cb.at(1).play('@p D2w | D2w | G1w | rw | rw |')
    cb.at(6).play('@pp D2w~ | D2w~ | D2w~ | D2w | D2w~ | D2w~ | D2w~ | D2w |')
    cb.expr((6, 0.6), (8, 0.9), (10, 0.6), (12, 0.9), (14, 0.6))
    org = s.part('organ', 'organ', role='pad', gain=-6)
    org.at(6).play('@pp [D3 A3]w~ | [D3 A3]w~ | [D3 A3]w~ | [D3 A3]w | [D3 F3]w~ | [D3 F3]w~ | [D3 F3]w~ | [D3 F3]w |')
    pno = s.part('piano', 'grand', role='lead')
    pno.at(6).play('@mp A4q D5q E5q rq | rw | rw | rw | A3q D4q E4q rq | rw | rw | rw |')
    bells = s.part('bells', 'bells', role='accent', gain=-6)
    bells.at(8).play('@p rh A4h | rw | rw | rw | rh E4h | rw |')
    shim = s.part('thread', 'shimmer', role='fx', gain=-2)
    shim.at(6).play('@p A6w~ | A6w | rw | rw | rw | rw | rw | rw |')
    return s
