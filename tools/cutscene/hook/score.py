"""The Roll: the score of the opening cutscene (docs/specs/cutscene-the-roll.md).

One-shot, D minor, about two minutes. It is written for the picture, bar by bar:
every cut and word in roll.js is a bar or beat of this score (cues.json).

  I    The name (3/4, 84)     A lullaby on the Thread cell. It climbs to the
                              leading tone and stops: the knock at the door comes
                              on the downbeat where D should be.
  II   The Roll (4/4, 60)     The Empire's drill, the eclipse bell, a quill's
                              scratch (violas, the Empire semitone). The mother
                              unravels. The girl hums the lullaby and loses the note.
  III  The thread (72)        EDRIC is written. A grab, and one held violin A (the
                              thread pulled taut), then Sera's Thread theme. It
                              rewinds (the retrograde cell) and accelerates.
  IV   The March (120)        The Old Kingdom horn call, the Thread theme at full
                              drive, one hero per bar. It ends on the unresolved
                              leading tone; the drums drop out; the call returns;
                              a tutti hit on the dominant, then silence.
  V    The title (60)         Not D: B-flat major seventh with the thread's high A
                              on top, the bells' A-G-E, and no tonic.

Render: python3 tools/cutscene/hook/music.py
"""

from engine.patterns import arp, bass, chart, drums, ostinato, pad
from engine.score import Score

TITLE = 'The Roll'

# bars where each section starts (roll.js reads them from cues.json, not from here)
SECTIONS = {'name': 1, 'knock': 10, 'roll': 11, 'thread': 17, 'accel': 24, 'march': 25,
            'drop': 35, 'rise': 37, 'hit': 40, 'title': 41, 'end': 45}

THREAD_THEME_HOLLOW = """
A4h D5q E5q | A5w | G5q. F5e E5q D5q | E5w |
A4h D5q E5q | A5h C6h | Bb5q. A5e G5q C#5q~ | C#5q rq rh |
"""
OLD_KINGDOM = 'D4q. A4e A4q G4e A4e | D5h A4h |'
EMPIRE = 'D3q. Eb3e D3q C3q | Bb2h. rq |'


def build():
    s = Score('the_roll', bpm=84, meter=(3, 4), intro_bars=44, title=TITLE, seed=11,
              one_shot=True, tonic='D')
    s.reverb = dict(rt60=3.0, predelay_ms=30, wet_db=0.5, damp=0.45)
    s.master = dict(lufs=-15.5, glue_ratio=1.4, lead_duck=1.0)
    s.variant('full', {}, lufs=-15.5)
    s.meter_change(11, (4, 4))
    s.tempo(11, 60)
    s.tempo(17, 72)
    s.tempo(24, 72, ramp_to=120)
    s.tempo(25, 120)
    s.tempo(41, 60)

    # ============================================================ I. the name (3/4)
    thread = s.part('thread', 'shimmer', role='fx', gain=-2)
    thread.at(1).play('@mp ' + 'A6h.~ | ' * 8 + 'A6h. |')
    thread.expr((1, 0.6), (3, 1.0), (9, 0.8), (9.9, 0.2))
    cel = s.part('celesta', 'celesta', role='lead', gain=-8)
    # the Thread cell, alone: the gold line draws on these four notes
    cel.at(1).play('@mp A4q D5q E5q | A5h. |')
    # the lullaby, climbing to the leading tone; bar 10 (the knock) is where D would be
    cel.at(3).play('@mp A4q D5q E5q | F5h D5q | D5q Bb4q G4q | A4h. |'
                   ' A4q D5q E5q | F5q E5q D5q | E5h C#5q |')
    cel.expr((3, 0.8), (6, 0.9), (7, 0.85), (9, 1.0), (9.9, 0.9))
    lull = chart('Dm:3 Bb:3 Gm:3 A:3 Dm:3 Bb:3 Gm:1.5 A:1.5')
    hp = s.part('harp', 'harp', role='keys', gain=-7)
    arp(hp, 3, lull, '0 1 2', step=1, lo=50, hi=74, vel=0.36, accent_every=3, accent=0.06)
    va = s.part('va', 'violas', role='pad', art='soft', gain=-5)
    pad(va, 3, lull, n=2, lo=55, hi=67, vel=0.3, art='soft')
    vc = s.part('vc', 'celli', role='counter', art='soft', gain=-4)
    vc.at(3).play('@pp D3h. | Bb2h. | G2h. | A2h. | D3h. | Bb2h. | G2q. A2q. |')

    # the knock: three blows on the downbeat the lullaby was reaching for
    knock = s.part('knock', 'orch_perc', role='accent', gain=4)
    drums(knock, 10, {'bd': 'X...x...X...'}, vel=0.8)
    tk = s.part('knock_t', 'taiko', role='accent', gain=-2)
    drums(tk, 10, {45: 'x...o...x...'}, vel=0.55, keys={})
    drone = s.part('drone', 'drone', role='low', gain=-3)
    drone.at(10).play('@p rh D2q~ |')

    # ============================================================ II. the Roll (4/4, 60)
    drone.at(11).play('@mp D2w~ | D2w~ | D2w~ | D2w~ | D2w~ | D2w |')
    drone.expr((10, 0.2), (11, 0.7), (13, 0.8), (15, 1.0), (16.9, 1.0))
    cb = s.part('cb', 'basses', role='low')
    cb.at(11).play('%trem @pp D2w~ | D2w~ | D2w | rw | %sus @mf D2w~ | D2w |')
    cb.expr((11, 0.3), (12.9, 0.7), (13, 0.5), (15, 0.8), (16.9, 1.0))
    tbn = s.part('tbn', 'trombones', role='lead2')
    tbn.at(11).play('@mf' + EMPIRE)
    vc.at(11).play('%sus @mf' + EMPIRE)
    bells = s.part('bells', 'bells', role='accent')
    bells.at(12).play('@mf D5w |')                    # the eclipse bell: a name is entered
    # the quill: the Empire's semitone, scratched
    scratch = s.part('scratch', 'violas', role='ostinato', art='pizz', gain=-4)
    scratch.at(12).play('%pizz @p ' + 'D4e Eb4e ' * 4 + '|')
    scratch.expr((12, 0.6), (12.9, 1.0))
    # the mother unravels
    vn = s.part('vn', 'violins', role='pad')
    vn.at(13).play('%trem @p [A5 Bb5]w |')
    vn.expr((13, 0.2), (13.9, 1.0))
    rev = s.part('rev', 'reverse', role='fx')
    rev.at(13).play('@mf C4w |')
    oohs = s.part('oohs', 'oohs', role='choir', gain=-4)
    oohs.at(13).play('@p [D5 Eb5]w |')
    oohs.expr((13, 0.3), (13.9, 1.0))
    # the girl hums the lullaby and the note is gone
    cel.at(14).play('@p A4q D5q E5q rq |')
    boom = s.part('boom', 'boom', role='accent')
    boom.at(15).play('@f D1w |')
    # the capital: the drill in the choir and brass, a heartbeat, a riser
    choir = s.part('choir', 'choir', role='choir')
    choir.at(15).play('@mf D3q. Eb3e D3q C3q | Bb2h. rq |', transpose=12)
    hn = s.part('hn', 'horns', role='lead')
    hn.at(15).play('@f D4q. Eb4e D4q C4q | Bb3h. rq |')
    tbn.at(15).play('@f' + EMPIRE)
    taiko = s.part('taiko', 'taiko', role='drums', gain=2)
    drums(taiko, 15, {45: 'X..x....X..x....'}, vel=0.7, keys={})
    drums(taiko, 16, {45: 'X..x....X..x.xxx'}, vel=0.78, keys={}, ramp=0.3)
    timp = s.part('timp', 'timpani', role='timp')
    timp.at(16).play('%roll @p D2w |')
    timp.expr((16, 0.2), (16.95, 1.0))
    riser = s.part('riser', 'riser', role='fx')
    riser.note(s.bar(16), 60, 4, vel=0.6)

    # ============================================================ III. the thread (72)
    # EDRIC is written
    boom.at(17).play('@ff D1h rh |')
    timp.at(17).play('%default @ff D2q rq rh |')
    tuba = s.part('tuba', 'tuba', role='low')
    tuba.at(17).play('@ff D2q rq rh |')
    tbn.at(17).play('@ff [D2 A2]q rq rh |')
    bells.at(17).play('@f D5w |')
    drone.at(17).play('@mp D2w~ | D2w |')
    scratch.at(17).play('%pizz @p rq ' + 'D4e Eb4e ' * 3 + '|')
    # the hand frays
    vn.at(18).play('%trem @pp [D6 Eb6]w |')
    vn.expr((18, 0.2), (18.95, 1.0))
    riser.note(s.bar(18), 60, 4, vel=0.55)
    drums(taiko, 18, {45: 'X...x...X.x.x.xx'}, vel=0.6, keys={}, ramp=0.5)
    # the grab, and the thread pulled taut
    timp.at(19).play('@ff D2q rq rh |')
    cb.at(19).play('%sus @ff D2q rq rh |')
    solo = s.part('solo', 'violins', role='lead', art='soft', gain=-3)
    solo.at(19).play('%sus @mf A5w |')
    solo.expr((19, 0.5), (19.9, 1.0))
    thread.at(19).play('@mp A6w~ | A6w~ | A6w~ | A6w~ | A6w |')
    thread.expr((19, 0.8), (22, 1.0), (23.9, 0.5))
    # Sera's sight: the Thread theme
    solo.at(20).play('%soft @mf A4h D5q E5q | A5w | G5q. F5e E5q D5q | E5h. rq |')
    solo.expr((20, 0.85), (21, 1.0), (22, 0.9), (23, 0.8))
    sight = chart('Dm Bbmaj7 Gm7:2 C/E:2 A')
    arp(hp, 20, sight, '0 1 2 3 4 3 2 1', step=0.5, lo=50, hi=81, vel=0.44, accent_every=2,
        accent=0.08)
    pad(va, 20, sight, n=2, lo=55, hi=69, vel=0.44, art='soft')
    vn2 = s.part('vn2', 'violins2', role='pad', art='soft', gain=-3)
    pad(vn2, 20, sight, n=2, lo=62, hi=77, vel=0.4, art='soft')
    vc.at(20).play('%soft @mp D3w | Bb2w | G2h C3h | A2w |')
    # the rewind: the Thread backwards
    rev.at(23).play('@mf rh C4h |')
    cel.at(23).play('@mf rh. A5e E5e |')
    cel.at(24).play('@mf D5e A4e rq rh |')
    # accelerando into the March
    drums(taiko, 24, {45: 'x.x.x.x.xxxxXXXX'}, vel=0.6, keys={}, ramp=0.6)
    timp.at(24).play('%roll @mp A2w |')
    timp.expr((24, 0.3), (24.95, 1.0))
    riser.note(s.bar(24), 60, 4, vel=0.7)
    perc = s.part('perc', 'orch_perc', role='accent')

    # ============================================================ IV. the March (120)
    march = chart('Dm Dm Dm Bbmaj7 Gm7:2 C/E:2 A Dm F Gm:2 A7:2 A')
    drums(perc, 25, {'crash': 'x', 'bd': 'x'}, vel=0.85)
    for b in range(25, 35):
        pat = 'X..x..x.X.x.x...' if b % 2 else 'X..x..x.X.x.xxxx'
        drums(taiko, b, {45: pat}, vel=0.8, keys={})
        drums(perc, b, {'bd': 'x.......x.......', 'sn': '....x.......x...'}, vel=0.62)
    drums(perc, 29, {'crash': 'x'}, vel=0.7)
    drums(perc, 33, {'crash': 'x'}, vel=0.7)
    # the ostinato under everything
    low = s.part('low', 'celli', role='ostinato', art='spic')
    ostinato(low, 25, march, 'e e e e e e e e', 'b b b b b b b b', lo=38, hi=55, vel=0.66,
             art='spic', accents='> - - > - - > -')
    cb.at(25)
    bass(cb, 25, march, 'q q q q', 'r r r r', floor=26, vel=0.66, art='spic')
    spic = s.part('spic', 'violins2', role='ostinato', art='spic')
    ostinato(spic, 27, march[2:], 's s s s s s s s s s s s s s s s', '0 1 2 1 0 1 2 1',
             lo=62, hi=81, vel=0.5, art='spic')
    # the Old Kingdom call
    hn.at(25).play('@f' + OLD_KINGDOM)
    # the Thread theme at full drive; it ends on the leading tone and stops
    vn_l = s.part('vn_l', 'violins', role='lead')
    vn_l.at(27).play('%sus @f' + THREAD_THEME_HOLLOW)
    hn.at(27).play('@f' + THREAD_THEME_HOLLOW, transpose=-12)
    tpt = s.part('tpt', 'trumpets', role='lead2')
    tpt.at(31).play('@f A4h D5q E5q | A5h C5h | Bb4q. A4e G4q C#5q~ | C#5q rq rh |',
                    transpose=-12)
    pad(tbn, 27, march[2:], n=2, lo=43, hi=60, vel=0.5)
    choir.at(27)
    pad(choir, 31, march[7:], n=3, lo=55, hi=72, vel=0.6)
    timp.at(27).play('%default @f D2q rq D2q rq | Bb2q rq Bb2q rq | G2q rq C2q rq | A2q rq A2q A2q |'
                     ' D2q rq D2q rq | F2q rq F2q rq | G2q rq A2q rq | A2q rq rh |')
    # the drop: what it costs
    vn_l.at(35).play('%soft @mp C#5h D5h~ | D5w |')
    oohs.at(35).play('@p [F4 A4]w | [F4 Bb4]w |')
    solo.at(35).play('%soft @mp A4h D5q E5q | A5w |')
    solo.expr((35, 0.7), (36.9, 0.9))
    drone.at(35).play('@mp D2w~ | D2w |')
    # the rise: the call again, everyone, and the dominant
    rise = chart('Dm Bb A')
    for b in range(37, 40):
        drums(taiko, b, {45: 'X.xxX.x.X.xxXxXx'}, vel=0.86, keys={})
        drums(perc, b, {'bd': 'x...x...x...x...', 'sn': '....x.......x.xx'}, vel=0.66)
    drums(perc, 37, {'crash': 'x'}, vel=0.85)
    hn.at(37).play('@ff' + OLD_KINGDOM + ' Bb4q C5q D5q E5q |')
    tpt.at(37).play('@ff' + OLD_KINGDOM + ' Bb4q C5q D5q E5q |')
    vn_l.at(37).play('%sus @ff D6w | D6w | C#6w |')
    vn2.at(37)
    pad(vn2, 37, rise, n=2, lo=62, hi=81, vel=0.7, art='sus')
    pad(tbn, 37, rise, n=2, lo=43, hi=60, vel=0.72)
    pad(choir, 37, rise, n=3, lo=55, hi=74, vel=0.72)
    ostinato(low, 37, rise, 'e e e e e e e e', 'b b b b b b b b', lo=38, hi=55, vel=0.72,
             art='spic', accents='> - > - > - > -')
    bass(cb, 37, rise, 'q q q q', 'r r r r', floor=26, vel=0.72, art='spic')
    timp.at(39).play('%roll @f A2w |')
    riser.note(s.bar(38), 60, 8, vel=0.75)
    # the hit, then nothing
    boom.at(40).play('@ff A1q rq rh |')
    drums(perc, 40, {'crash': 'x', 'bd': 'X', 'gong': 'x'}, vel=0.9)
    timp.at(40).play('%default @ff A2q rq rh |')
    tutti = '[A3 C#4 E4 A4]q rq rh |'
    tbn.at(40).play('@ff [A2 E3]q rq rh |')
    tuba.at(40).play('@ff A1q rq rh |')
    hn.at(40).play('@ff [A3 C#4 E4]q rq rh |')
    vn2.at(40).play('%sus @ff ' + tutti, transpose=12)
    choir.at(40).play('@ff ' + tutti)
    cb.at(40).play('%sus @ff A1q rq rh |')
    low.at(40).play('%sus @ff A2q rq rh |')

    # ============================================================ V. the title (60)
    title = chart('Bbmaj7 Gm7 Bbmaj7 Dm/A')
    pad(va, 41, title, n=2, lo=55, hi=69, vel=0.46, art='soft')
    pad(vn2, 41, title, n=2, lo=62, hi=77, vel=0.42, art='soft')
    vc.at(41).play('%soft @mp Bb2w | G2w | Bb2w | A2w |')
    oohs.at(41).play('@mp [D4 A4]w | [D4 Bb4]w | [F4 A4]w~ | [F4 A4]w |')
    arp(hp, 41, title[:3], '0 1 2 3 4 5 4 3', step=0.5, lo=46, hi=86, vel=0.4)
    thread.at(41).play('@mp A6w~ | A6w~ | A6w~ | A6w |')
    thread.expr((41, 0.2), (41.5, 1.0), (44, 0.8), (44.9, 0.1))
    cel.at(41).play('@mf A5q D6q E6q A6q~ | A6w |')
    bells.at(43).play('@mf A4h G4h | E4w |')           # A, G, E... and not D
    drone.at(41).play('@p D2w~ | D2w~ | D2w~ | D2w |')
    drone.expr((41, 0.3), (43, 0.6), (44.9, 0.2))
    return s
