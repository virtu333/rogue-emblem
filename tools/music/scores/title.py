"""Title — "The Hollow Sun".

The goddess's name was spent; the eclipse is the hole where she was. A drone
on an open fifth (no third: nothing warm yet), a single high thread held over
it, and bells tolling A-G-E and stopping where D should be. A solo violin
states the Thread theme; the horns answer with Edric's oath; the orchestra
takes the theme up, reaches the leading tone... and the name never comes: a
bar of silence, bells, then the dark again.

The calm variant (strings, harp, bells, choir) is the login screen's loop.
"""

from engine.patterns import arp, bass, chart, drums, pad
from engine.score import Score

from scores._motifs import THREAD_THEME, THREAD_THEME_HOLLOW

KEY = 'music_title'

HORN_CALL = """
D4q F4q Bb4h | A4q. G4e F4h | G4q Bb4q D5q. C5e | C#5w |
D5q. C5e Bb4q F4q | A4h C5h | Bb4q. A4e G4q A4q | A4w |
"""
DESCANT = 'Bb5w | A5w | Bb5h G5h | A5w | D6w | C6w | Bb5h G5h | A5w |'
CELLO_A = 'F3w | F3w | Bb3h G3h | A3w | F3w | A3w | G3h E3h | F3w |'

CH_A = chart('Dm Bbmaj7 Gm7:2 C/E:2 A Dm F Gm:2 A7:2 Dm')
CH_B = chart('Bb F/A Gm A Bb F/A Gm A')
CH_C = chart('Dm Bbmaj7 Gm7:2 C/E:2 A Dm F Gm:2 A7:2')     # 7 bars; bar 28 is the hollow


def build():
    s = Score('title', tonic='D', bpm=66, intro_bars=4, loop_bars=28, title='The Hollow Sun', seed=3)
    s.reverb = dict(rt60=3.2, predelay_ms=34, wet_db=1.0, damp=0.45)
    s.master = dict(lufs=-16.0, glue_ratio=1.3, lead_duck=1.5)
    s.tempo(27, 66, ramp_to=56)
    s.tempo(29, 66)
    s.variant('full', {}, lufs=-16.0)
    s.variant('calm', {'hn*': None, 'tpt': None, 'tbn': None, 'tuba': None, 'timp': None,
                       'perc': None, 'choir_c': None, 'vn2_c': -3, 'vn_c': -4}, lufs=-19.0)
    s.variant_keys['calm'] = 'music_login'
    s.whole_loop.add('calm')

    # ---------------------------------------------------------------- the dark
    drone = s.part('drone_cb', 'basses', role='low', art='soft')
    drone.at(1).play('@p D2w~ | D2w~ | D2w~ | D2w |')
    drone.at(29).play('@p D2w~ | D2w~ | D2w~ | D2w |')
    drone.expr((1, 0.4), (3, 1.0), (29, 0.9), (32.9, 0.6))
    org = s.part('organ', 'organ', role='pad', gain=-4)
    org.at(1).play('@mp [D3 A3]w~ | [D3 A3]w~ | [D3 A3]w~ | [D3 A3]w |')
    org.at(29).play('@mp [D3 A3]w~ | [D3 A3]w~ | [D3 A3]w~ | [D3 A3]w |')
    oohs = s.part('choir_oohs', 'oohs', role='choir')
    oohs.at(2).play('@p [D4 A4]w~ | [D4 A4]w~ | [D4 A4]w |')
    oohs.at(28).play('@p rq [A4 E5]h.~ | [A4 E5]w~ | [A4 E5]w | rw | rw |')
    oohs.expr((2, 0.3), (4.5, 1.0), (28, 0.8), (31, 0.2))
    thread = s.part('thread', 'shimmer', role='fx', gain=4)
    thread.at(1).play('@mp A6w~ | A6w~ | A6w~ | A6w |')
    thread.at(29).play('@mp A6w~ | A6w~ | A6w~ | A6w |')
    bells = s.part('bells', 'bells', role='accent')
    bells.at(2).play('@mf A4h G4h | E4w | rw |')             # the hollow sun: A G E ...
    bells.at(28).play('@mf rq A4h. |')
    bells.at(30).play('@mp A4h G4h | E4w | rw |')

    # ---------------------------------------------------------------- A: the thread theme
    solo = s.part('solo', 'solo_violin', role='lead')
    solo.at(5).play('@mp' + THREAD_THEME)
    solo.expr((5, 0.75), (8, 0.95), (9, 0.8), (11, 1.0), (12.9, 0.8))
    vn2 = s.part('vn2', 'violins2', role='pad', art='soft')
    pad(vn2, 5, CH_A, n=2, lo=62, hi=77, vel=0.42, art='soft')
    va = s.part('va', 'violas', role='pad', art='soft')
    pad(va, 5, CH_A, n=2, lo=53, hi=67, vel=0.42, art='soft')
    pad(va, 13, CH_B, n=2, lo=53, hi=67, vel=0.5, art='soft')
    vc = s.part('vc', 'celli', role='counter', art='soft')
    vc.at(5).play('@mp' + CELLO_A)
    cb = s.part('cb', 'basses', role='low', art='soft')
    bass(cb, 5, CH_A, 'w', 'b', floor=26, vel=0.45, art='soft')
    bass(cb, 13, CH_B, 'w', 'b', floor=26, vel=0.5, art='soft')
    hp = s.part('hp', 'harp', role='keys')
    arp(hp, 5, CH_A, '0 1 2 3 4 3 2 1', step=0.5, lo=50, hi=81, vel=0.42, accent_every=2,
        accent=0.08)
    arp(hp, 13, CH_B, '0 1 2 3 4 3 2 1', step=0.5, lo=50, hi=81, vel=0.46, accent_every=2,
        accent=0.08)

    # ---------------------------------------------------------------- B: Edric's oath
    hn = s.part('hn_call', 'horns', role='lead')
    hn.at(13).play('@mf' + HORN_CALL)
    hn.expr((13, 0.8), (16, 1.0), (17, 0.85), (20.9, 1.0))
    desc = s.part('descant', 'violins', role='counter', art='soft')
    desc.at(13).play('@mp' + DESCANT)
    vc.at(13).play('@mf Bb2w | A2w | G2w | A2w | Bb2w | A2w | G2w | A2h. rq |')

    # ---------------------------------------------------------------- C: the theme, and the hole
    vn_c = s.part('vn_c', 'violins', role='lead')
    vn_c.at(21).play('%sus @f' + THREAD_THEME_HOLLOW)
    vn_c.expr((21, 0.8), (24, 0.95), (25, 0.9), (27, 1.0), (28.9, 1.0))
    vn2_c = s.part('vn2_c', 'violins2', role='lead2')
    vn2_c.at(21).play('%sus @f' + THREAD_THEME_HOLLOW, transpose=-12)
    hn_c = s.part('hn_c', 'horns', role='lead2', pan=-0.2)
    hn_c.at(21).play('@f' + THREAD_THEME_HOLLOW, transpose=-12)
    tpt = s.part('tpt', 'trumpets', role='lead2')
    tpt.at(25).play('@f A3h D4q E4q | A4h C5h | Bb4q. A4e G4q C#4q~ | C#4q rq rh |')
    tbn = s.part('tbn', 'trombones', role='pad')
    pad(tbn, 21, CH_C, n=2, lo=43, hi=60, vel=0.62)
    tbn.at(28).play('@f A2q rq rh |')
    tuba = s.part('tuba', 'tuba', role='low')
    bass(tuba, 21, CH_C, 'w', 'b', floor=28, vel=0.62)
    tuba.at(28).play('@f A1q rq rh |')
    va.at(21)
    pad(va, 21, CH_C, n=2, lo=53, hi=67, vel=0.6, art='sus')
    va.at(28).play('%sus @f [C#4 E4]q rq rh |')
    vc.at(21).play('%sus @f D3w | Bb2w | G2h C3h | A2w | D3w | F2w | G2h A2h | A2q rq rh |')
    bass(cb, 21, CH_C, 'w', 'b', floor=26, vel=0.62, art='sus')
    cb.at(28).play('%sus @f A1q rq rh |')
    choir = s.part('choir_c', 'choir', role='choir')
    pad(choir, 21, CH_C, n=3, lo=55, hi=72, vel=0.62)
    choir.at(28).play('@f [A4 C#5 E5]q rq rh |')
    timp = s.part('timp', 'timpani', role='timp')
    timp.at(20).play('%roll @p A2w |')
    timp.expr((20, 0.3), (20.95, 1.0), (21, 1.0))
    timp.at(21).play('%default @f D2h rh | rw | rw | A2h. A2q | D2h rh | rw | G2h A2q A2q | A2q rq rh |')
    perc = s.part('perc', 'orch_perc', role='accent')
    drums(perc, 19, {'swell_l': 'x'}, vel=0.7)
    drums(perc, 21, {'crash': 'x', 'bd': 'x'}, vel=0.75)
    drums(perc, 28, {'gong': 'x'}, vel=0.55)

    # ---------------------------------------------------------------- D: the dark returns
    cel = s.part('celesta', 'celesta', role='keys')
    cel.at(29).play('@mp A5q D6q E6q A6q~ | A6w | rw | A5q D6q E6q rq |')
    return s
