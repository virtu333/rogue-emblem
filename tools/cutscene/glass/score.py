"""Every Way It Ends: the score of "The Far Side of the Glass" (docs/specs/cutscene-far-side.md).

One-shot, D minor, 60 bpm in 4/4 throughout, so one beat is one second and a bar is
four: the narration (LINES) and the picture sit on the same clock as the notes.
The music never resolves to D. It quotes the game's motifs (tools/music/SCORE.md):

  I    The Morning (1-8)       the thread's high A alone; the Thread cell on celesta
                               as the Dawn weaves; the first morning in F, flute
  II   The Spending (9-18)     the Sleeper turns (boom, taiko, D against E-flat); she
                               kneels; the starfall (celesta, harp, rising choir); the
                               dragons lie down (the Thread, augmented, horns); the
                               Hollow Sun phrase climbs to C-sharp and a bar of silence
                               follows where D should be; one bell sounds F, the third
  III  The Unsworn Night       the Old Kingdom horn call (the oath); the hum (D and its
       (19-29)                 shadow) down the stair; the quill; a heartbeat in the
                               Hearthstone; three midnight bells, and a crack on
                               "broke"; the Empire drill for the man on the wall
  IV   The Roll (30-36)        the siege, cut off; a lament for the king; the crown
                               sinks on the celesta; the Empire's semitone ticks as
                               names are entered; the choir reads them into the dark
  V    The officers (37-42)    a machine: taiko and spiccato on D/E-flat, a brass stab
                               on every cut; the Emperor's organ chord
  VI   The one who counts      fire; then the home fire (nylon guitar and harp in F,
       (42-49)                 as at home base); Sera's Thread (solo violin); the Lieutenant's motif
                               (A-D-C-A) and its shadow a tritone away, a beat late
  VII  Every way it ends       a heartbeat; a hit on each death; the rewind (a
       (50-55)                 reversed swell, the Thread backwards); the fire again
  VIII The far side (55-62)    the Lieutenant's motif on the solo violin, the shadow in
                               the violas; silence; the title: a hit, the bells'
                               A-G-E, the Hollow Sun cadence stopping on C-sharp

Render: python3 tools/cutscene/glass/music.py
"""

from engine.patterns import arp, bass, chart, drums, ostinato, pad
from engine.score import Score

TITLE = 'Every Way It Ends'

# The score is written on a first clock (bars of four seconds), then time is inserted
# where the picture needs to breathe: (at, seconds) on that first clock. Notes after a
# point move later; notes held across it are held longer; the gaps get their own music
# (end of build()). edit.mjs applies the same WARP to the cut.
WARP = [(32, 4), (88, 4)]   # after "last of all, us"; after the oath's horn call


def w(t):
    """A time on the first clock -> the film's clock."""
    return t + sum(d for at, d in WARP if t >= at - 1e-9)


def w_end(t):
    """The end of a note: a note that ends where time is inserted is not held over it."""
    return t + sum(d for at, d in WARP if t > at + 1e-9)


BARS = 64

# where each narration line starts, on the first clock (w() gives film seconds)
_LINES = {
    'l01': 4, 'l02': 10, 'l03': 20, 'l04': 34, 'l05': 40, 'l06': 44, 'l07': 62,
    'l08': 74, 'l09': 82, 'l10': 88, 'l11': 101, 'l12': 110, 'l13': 122, 'l14': 134,
    'l15': 144, 'l16': 158, 'l17': 165, 'l18': 176, 'l19': 185, 'l20': 193,
    'l21': 196, 'l22': 205, 'l23': 221, 'l24': 227,
}
# lines placed by hand, in film seconds: l06 clears the end of l05; around the second
# gap the oath's line ends at 86.2, the dark comes, then "It took one man"; l22 breathes
# after the last death
_PLACED = {'l06': 49, 'l09': 90, 'l10': 97, 'l22': 213.5}
LINES = {k: _PLACED.get(k, w(v)) for k, v in _LINES.items()}
# the four deaths of l21 ("at the Ford. On the bridge. In the fens. At my feet."):
# word onsets measured from the take (first clock)
_DEATHS = [198.5, 200.2, 201.7, 203.4]
# officer cuts (every two beats) and the Emperor (first clock)
_OFFICERS = [144, 146, 148, 150, 152, 154, 156]
_EMPEROR = 158
DEATHS = [w(t) for t in _DEATHS]
OFFICERS = [w(t) for t in _OFFICERS]
EMPEROR = w(_EMPEROR)

_SECTIONS = {'morning': 1, 'spending': 9, 'unsworn': 19, 'roll': 30, 'officers': 37,
             'counts': 42, 'ends': 50, 'far': 55, 'title': 59, 'end': 63}
SECTIONS = {k: round(1 + w(4 * (b - 1)) / 4, 2) for k, b in _SECTIONS.items()}

OLD_KINGDOM = 'D4q. A4e A4q G4e A4e | D5h A4h |'
EMPIRE = 'D3q. Eb3e D3q C3q | Bb2h. rq |'


def build():
    s = Score('far_side', bpm=60, meter=(4, 4), intro_bars=BARS, title=TITLE, seed=23,
              one_shot=True, tonic='D')
    s.reverb = dict(rt60=3.4, predelay_ms=35, wet_db=1.0, damp=0.45)
    s.master = dict(lufs=-17.0, glue_ratio=1.4, lead_duck=1.0)
    s.variant('full', {}, lufs=-17.0)
    # the house palette (SSO4 strings, solo violin, celesta and choir), brass on the legacy
    # instruments: VPO3's SFZ brass is not fetchable here (its repo carries only the
    # DecentSampler edition). An older engine ignores this attribute.
    s.palette = {'horns': 'legacy', 'trumpets': 'legacy', 'trombones': 'legacy'}

    thread = s.part('thread', 'shimmer', role='fx', gain=-4)
    drone = s.part('drone', 'drone', role='low', gain=-4)
    cel = s.part('celesta', 'celesta', role='lead', gain=-7)
    hp = s.part('harp', 'harp', role='keys', gain=-6)
    fl = s.part('flute', 'flute', role='lead', gain=-4)
    vn = s.part('vn', 'violins', role='lead', art='soft', gain=-3)
    # Sera's violin (the house palette performs it: tools/music/engine/perform.py)
    solo = s.part('solo', 'solo_violin', role='lead', gain=-2)
    vn2 = s.part('vn2', 'violins2', role='pad', art='soft', gain=-5)
    va = s.part('va', 'violas', role='pad', art='soft', gain=-5)
    vc = s.part('vc', 'celli', role='counter', art='soft', gain=-4)
    cb = s.part('cb', 'basses', role='low', gain=-2)
    oohs = s.part('oohs', 'oohs', role='choir', gain=-6)
    choir = s.part('choir', 'choir', role='choir', gain=-3)
    hn = s.part('hn', 'horns', role='lead2', gain=-2)
    tbn = s.part('tbn', 'trombones', role='lead2', gain=-2)
    tuba = s.part('tuba', 'tuba', role='low', gain=-2)
    timp = s.part('timp', 'timpani', role='timp')
    taiko = s.part('taiko', 'taiko', role='drums', gain=0)
    perc = s.part('perc', 'orch_perc', role='accent', gain=-1)
    bells = s.part('bells', 'bells', role='accent', gain=-3)
    boom = s.part('boom', 'boom', role='accent', gain=-1)
    riser = s.part('riser', 'riser', role='fx', gain=-4)
    rev = s.part('rev', 'reverse', role='fx', gain=-3)
    organ = s.part('organ', 'organ', role='pad', gain=-6)
    nylon = s.part('nylon', 'nylon', role='keys', gain=-5)
    glock = s.part('glock', 'glock', role='accent', gain=-10)
    pizz = s.part('pizz', 'violas', role='ostinato', art='pizz', gain=-6)
    spic = s.part('spic', 'celli', role='ostinato', art='spic', gain=-4)

    # ============================================================ I. The Morning (1-8)
    # black: the thread's high A alone; it holds under the whole myth
    thread.at(1).play('@mp ' + 'A6w~ | ' * 15 + 'A6w |')
    thread.expr((1, 0.0), (2, 0.7), (5, 0.9), (8.8, 0.9), (9, 0.2), (13, 0.8), (16.9, 0.4))
    drone.at(3).play('@p D2w~ | D2w~ | D2w~ | D2w~ | D2w~ | D2w |')
    drone.expr((3, 0.2), (5, 0.5), (8.9, 0.6))
    # the Dawn weaves: the Thread cell (A-D-E-A), as the gold is drawn
    cel.at(3).play('@mp rh A4q D5q | E5q A5h. |')
    cel.at(5).play('@p A5q D6q E6q A6q~ | A6w |')
    weave = chart('Dmadd9 Bbmaj7')
    arp(hp, 3, weave, '0 1 2 3 4 3 2 1', step=0.5, lo=50, hi=81, vel=0.34, accent_every=4,
        accent=0.05)
    pad(va, 3, weave, n=2, lo=55, hi=67, vel=0.26, art='soft')
    # the first morning, in F: the sun is still whole
    morning = chart('F Bb/F C/E F')
    arp(hp, 5, morning, '0 1 2 3 4 5 4 3', step=0.5, lo=53, hi=86, vel=0.4, accent_every=4,
        accent=0.06)
    pad(vn2, 5, morning, n=3, lo=60, hi=79, vel=0.4, art='soft')
    pad(va, 5, morning, n=2, lo=53, hi=69, vel=0.38, art='soft')
    oohs.at(5).play('@mp [F4 C5]w | [F4 D5]w | [E4 C5]w | [F4 C5]w |')
    vc.at(5).play('@mp F2w | F2w | E2w | F2w |')
    fl.at(5).play('@mf C5h F5q G5q | C6w | Bb5q. A5e G5q F5q | G5h. rq |')
    fl.expr((5, 0.8), (6, 1.0), (8, 0.8), (8.9, 0.4))
    hn.at(7).play('@mp [F3 C4]w | [F3 C4]h rh |')

    # ============================================================ II. The Spending (9-18)
    # the Sleeper turns over
    boom.at(9).play('@ff D1w |')
    drums(perc, 9, {'bd': 'X', 'gong': 'x'}, vel=0.85)
    drums(taiko, 9, {45: 'X..x..x.X...x.x.'}, vel=0.8, keys={})
    drums(taiko, 10, {45: 'X..x....X..x.xxx'}, vel=0.7, keys={}, ramp=0.2)
    tbn.at(9).play('@f [D2 Eb2]w | [D2 Eb2]h rh |')
    tuba.at(9).play('@f D2w~ | D2h rh |')
    cb.at(9).play('%trem @f D2w~ | D2h rh |')
    vn.at(9).play('%trem @mf [D5 Eb5]w~ | [D5 Eb5]h rh |')
    vn.expr((9, 1.0), (10.5, 0.6), (10.9, 0.0), (11, 1.0))
    timp.at(9).play('%roll @f D2w~ | D2h rh |')
    timp.expr((9, 1.0), (10.6, 0.2))
    # she kneels; she could not fight it; she spends herself
    kneel = chart('Dm Bb Gm A')
    pad(va, 10.5, chart('Dm:2'), n=2, lo=55, hi=67, vel=0.3, art='soft')
    pad(vn2, 11, kneel, n=3, lo=60, hi=77, vel=0.36, art='soft')
    pad(va, 11, kneel, n=2, lo=53, hi=67, vel=0.34, art='soft')
    vc.at(11).play('%soft @mp D3w | Bb2w | G2w | A2w |')
    oohs.at(11).play('@p [D4 A4]w | [D4 Bb4]w | [D4 Bb4]w | [C#4 A4]w |')
    oohs.expr((11, 0.5), (14, 1.0))
    vn.at(12).play('%soft @mp rh D5q E5q | F5h. E5q | E5w |')
    # the starfall: her change comes down over the land
    star = chart('Dmadd9 Bbmaj7')
    arp(cel, 13, star, '5 4 3 2 1 0 1 2', step=0.25, lo=72, hi=100, vel=0.36)
    arp(glock, 13, star, '4 3 2 1 0 2 1 3', step=0.5, lo=76, hi=100, vel=0.3)
    arp(hp, 13, star, '0 1 2 3 4 5 6 5 4 3 2 1', step=0.25, lo=50, hi=88, vel=0.44)
    choir.at(13).play('@mp [D4 A4]w | [D4 F4 Bb4]w |')
    choir.expr((13, 0.5), (14.9, 1.0))
    cb.at(13).play('%sus @mp D2w | Bb1w |')
    # the dragons lie down: the Thread slowed to a breath
    hn.at(15).play('@mp A3w | D4h E4h |')
    hn.expr((15, 0.6), (16.9, 0.9))
    pad(vn2, 15, chart('F/A Gm'), n=3, lo=60, hi=77, vel=0.38, art='soft')
    vc.at(15).play('%soft @mp A2w | G2w |')
    bells.at(15).play('@p A4w | rw |')
    # the Hollow Sun: the phrase climbs to C-sharp and stops
    vn.at(16).play('%sus @mf A4q D5q E5q F5q | G5q A5q Bb5q C#6q |')
    vn.expr((16, 0.7), (17, 0.9), (17.9, 1.0))
    pad(vn2, 16, chart('Dm Gm:2 Bb:2 A'), n=3, lo=57, hi=77, vel=0.44, art='sus')
    choir.at(16).play('@mf [D4 A4]w | [D4 A4]h [C#4 A4]h |')
    cb.at(16).play('%sus @mf D2w | A1w |')
    timp.at(17).play('%roll @mp A2w |')
    timp.expr((17, 0.3), (17.95, 0.9))
    # ...and a bar of silence where the name should be; one bell sounds the third
    bells.at(18).play('@mp F5w |')
    drone.at(9).play('@mp D2w~ | ' * 9 + 'D2w |')
    drone.expr((9, 0.8), (11, 0.4), (17, 0.5), (18, 0.25))

    # ============================================================ III. The Unsworn Night (19-29)
    # the oath at the Ford: the Old Kingdom call
    hn.at(19).play('@mf' + OLD_KINGDOM + ' D4q. A4e A4q G4e A4e | D5w |')
    pad(vn2, 19, chart('D5 D5 G5/D D5'), n=2, lo=57, hi=74, vel=0.4, art='soft')
    vc.at(19).play('%soft @mp [D2 A2]w | [D2 A2]w | [D2 A2]w | [D2 A2]w |')
    timp.at(19).play('@mp D2q rq rh | rw | D2q rq rh | rw |')
    # down the stair: the hum (D and its shadow)
    drone.at(19).play('@mp D2w~ | ' * 10 + 'D2w |')
    drone.expr((19, 0.5), (21, 0.8), (25, 1.0), (27.2, 1.0), (27.3, 0.5))
    hum = s.part('hum', 'drone', role='low', gain=-9)
    hum.at(21).play('@p Eb2w~ | Eb2w~ | Eb2w~ | Eb2w~ | Eb2w~ | Eb2w~ | Eb2q rq rh |')
    hum.expr((21, 0.3), (24, 0.8), (26, 1.0))
    vc.at(21).play('%pizz @mp D3q rq Eb3q rq | D3q rq C3q rq |', art='pizz')
    cb.at(21).play('%sus @p D2w | D2w |')
    # the list: a quill scratching the Empire's semitone; a bell as his own name goes down
    pizz.at(23).play('@p ' + 'D4e Eb4e ' * 4 + '| ' + 'D4e Eb4e ' * 4 + '|')
    pizz.expr((23, 0.7), (24.9, 1.0))
    bells.at(23).play('@mp D5w |')
    # the Hearthstone: a heartbeat in the rock; the circle reads
    for b in (24, 25):
        drums(taiko, b, {45: 'X..x........X..x'[:12] + '....'}, vel=0.6, keys={})
    choir.at(24).play('@mp D3w~ | D3w |')
    oohs.at(24).play('@p [D4 Eb4]w~ | [D4 Eb4]w |')
    oohs.expr((24, 0.4), (25.9, 1.0))
    cb.at(24).play('%trem @mp D2w~ | D2w |')
    riser.note(s.bar(25), 60, 4, vel=0.5)
    # midnight: three bells; every oath breaks at once (on "broke", 105 s)
    bells.at(26).play('@f D5h D5h | D5q rq rh |')
    vn.at(26).play('%trem @pp [D6 Eb6]w | [D6 Eb6]q rq rh |')
    vn.expr((26, 0.2), (27, 1.0))
    cb.at(26).play('%sus @mp D2w | D2q rq rh |')
    brk = s.bar(27) + 1
    boom.note(brk, 'D1', 3, vel=1.0)
    perc.note(brk, 49, 2, vel=0.9)
    perc.note(brk, 46, 3, vel=0.8)
    for p in ('D4', 'Eb4', 'Ab4', 'A4', 'D5', 'Eb5'):
        vn2.note(brk, p, 0.5, vel=0.95, art='sus')
    tbn.note(brk, 'D2', 0.6, vel=0.95)
    tbn.note(brk, 'Ab2', 0.6, vel=0.95)
    timp.note(brk, 'D2', 0.5, vel=1.0, art='default')
    # the man on the wall: the Empire drill
    tbn.at(28).play('@f' + EMPIRE)
    hn.at(28).play('@f D4q. Eb4e D4q C4q | Bb3h. rq |')
    choir.at(28).play('@f D3q. Eb3e D3q C3q | Bb2h. rq |', transpose=12)
    vc.at(28).play('%sus @f' + EMPIRE)
    cb.at(28).play('%sus @f D2w | Bb1h. rq |')
    tuba.at(28).play('@f D2w | Bb1h. rq |')
    drums(taiko, 28, {45: 'X...x...X...x.x.'}, vel=0.7, keys={})
    drums(taiko, 29, {45: 'X...x...X..xX.xx'}, vel=0.76, keys={})
    drums(perc, 28, {'sn': '....x.......x...'}, vel=0.5)
    drums(perc, 29, {'sn': '....x.......x.xx'}, vel=0.55)
    timp.at(28).play('%default @f D2q rq D2q rq | Bb2q rq Bb2q A2q |')
    drone.at(28).play('@mp D2w~ | D2w |')

    # ============================================================ IV. The Roll (30-36)
    # the Nine Days: the siege (116-122), cut off mid-bar
    siege = chart('Dm Bb:2')
    for b in (30, 31):
        drums(taiko, b, {45: 'X.xxX.x.X.xxXxXx' if b == 30 else 'X.xxX.x.'}, vel=0.86, keys={})
        drums(perc, b, {'bd': 'x...x...x...x...' if b == 30 else 'x...x...',
                        'sn': '..x...x...x.x.xx' if b == 30 else '..x...xx'}, vel=0.66)
    drums(perc, 30, {'crash': 'x'}, vel=0.8)
    ostinato(spic, 30, siege, 'e e e e e e e e e e e e', 'b b b b b b b b b b b b', lo=38,
             hi=55, vel=0.7, art='spic', accents='> - > - > - > - > - > -')
    tbn.at(30).play('@ff D3q. Eb3e D3q C3q | Bb2h rh |')
    hn.at(30).play('@ff D4q. Eb4e D4q C4q | Bb3h rh |')
    tuba.at(30).play('@ff D2w | Bb1h rh |')
    vn.at(30).play('%trem @f [D5 A5]w | [D5 Bb5]h rh |')
    drone.at(30).play('@mp D2w~ | D2w~ | D2w~ | D2w~ | D2w~ | D2w~ | D2w |')
    drone.expr((30, 0.5), (31.5, 0.3), (34, 0.7), (36.9, 1.0))
    # the last king in the river: a lament
    vc.at(31).play('%soft @mp rh A3h | D4w | C4h Bb3h | A3w |')
    pad(va, 31.5, chart('Dm:2 Bb Gm A'), n=2, lo=53, hi=67, vel=0.34, art='soft')
    # the crown sinks
    cel.at(32).play('@p rh. A6e F6e | D6e A5e F5e D5e A4h |')
    hp.at(33).play('@p D4q A3q F3q D3q |')
    # the Roll: names entered in red, the Empire's semitone ticking
    pizz.at(33.25).play('@p ' + 'D4e Eb4e ' * 3 + '  ' + 'D4e Eb4e ' * 4 + ' ')
    bells.at(34).play('@mf D5w |')
    # read into the dark
    choir.at(35).play('@mf D3q. Eb3e D3q C3q | Bb2h. rq |')
    oohs.at(35).play('@mp [D4 Eb4]w~ | [D4 Eb4]w |')
    oohs.expr((35, 0.4), (36.9, 1.0))
    cb.at(35).play('%trem @mp D2w~ | D2w |')
    cb.expr((35, 0.5), (36.95, 1.0))
    hum.at(35).play('@mp Eb2w~ | Eb2w |')
    hum.expr((35, 0.4), (36.95, 1.0))
    riser.note(s.bar(36), 60, 4, vel=0.65)
    timp.at(36).play('%roll @mp D2w |')
    timp.expr((36, 0.2), (36.95, 1.0))
    drums(taiko, 36, {45: 'x...x...x.x.xxxx'}, vel=0.6, keys={}, ramp=0.5)

    # ============================================================ V. The officers (37-42)
    mach = chart('Dm Dm Dm Dm:2')
    for b in (37, 38, 39):
        drums(taiko, b, {45: 'X.x.X.xxX.x.X.xx'}, vel=0.84, keys={})
        drums(perc, b, {'bd': 'x.......x.......', 'sn': '....x.......x..x'}, vel=0.62)
    drums(taiko, 40, {45: 'X.x.X.xx'}, vel=0.84, keys={})
    ostinato(spic, 37, mach, 's s s s s s s s s s s s s s s s', 'b b 1 b b b 1 b b b 1 b b 1 b 1',
             lo=38, hi=52, vel=0.62, art='spic', accents='> - - - > - - - > - - - > - - -')
    cb.at(37).play('%sus @mf D2w~ | D2w~ | D2w~ | D2h rh |')
    tuba.at(37).play('@mf D2w~ | D2w~ | D2w~ | D2h rh |')
    for t in _OFFICERS:
        boom.note(t, 'D1', 1.2, vel=0.8)
        perc.note(t, 49, 1.5, vel=0.7)
        for p in ('D3', 'A3', 'D4'):
            hn.note(t, p, 0.4, vel=0.85)
        tbn.note(t, 'D2', 0.4, vel=0.85)
        tbn.note(t, 'A2', 0.4, vel=0.85)
    # the stab shifts up the Empire cell as the ranks rise
    for t, p in zip(_OFFICERS, ['D5', 'Eb5', 'D5', 'C5', 'D5', 'Eb5', 'F5']):
        vn.note(t, p, 0.4, vel=0.8, art='sus')
    vn.note(_EMPEROR, 'D5', 6, vel=0.7, art='sus')
    # the Emperor: an organ chord, the choir, gold
    boom.note(_EMPEROR, 'D1', 4, vel=0.95)
    perc.note(_EMPEROR, 46, 4, vel=0.8)
    organ.note(_EMPEROR, 'D2', 6, vel=0.8)
    for p in ('D3', 'A3', 'D4', 'F4', 'A4'):
        organ.note(_EMPEROR, p, 6, vel=0.7)
        choir.note(_EMPEROR, p, 6, vel=0.7)
    tbn.note(_EMPEROR, 'D2', 5, vel=0.8)
    tbn.note(_EMPEROR, 'A2', 5, vel=0.8)
    timp.note(_EMPEROR, 'D2', 0.5, vel=0.95, art='default')
    drone.at(37).play('@mp D2w~ | D2w~ | D2w~ | D2w~ | D2w |')
    drone.expr((37, 0.6), (41.9, 0.8))

    # ============================================================ VI. The one who counts (42-49)
    # the last hall in the west burns (164-175)
    vn.at(42).play('%trem @mp [A4 D5]w~ | [A4 D5]w | [Bb4 D5]h. rq |')
    vn.expr((42, 0.4), (43, 0.8), (44.5, 0.3))
    cb.at(42).play('%trem @mp D2w~ | D2w | Bb1h. rq |')
    drums(taiko, 42, {45: 'X.......x.......'}, vel=0.6, keys={})
    drums(taiko, 43, {45: 'X.......x...x...'}, vel=0.6, keys={})
    hn.at(42.5).play('@mf D4q. A4e A4h   rh A4q G4e F4e   D4h. rq  ')
    hn.expr((42.5, 0.9), (44, 0.5))
    oohs.at(42).play('@p [D4 A4]w | [D4 A4]w | [D4 Bb4]h. rq |')
    drone.at(42).play('@mp D2w~ | D2w~ | D2h. rq |')
    # the home fire: as at home base (nylon, harp, flute, in F)
    home = chart('F C/E Dm Bb F:2 C:2')
    arp(nylon, 44.75, chart('F:1'), '0 1 2 3', step=0.25, lo=48, hi=72, vel=0.44)
    arp(nylon, 45, home, '0 2 1 2 3 2 1 2', step=0.5, lo=48, hi=76, vel=0.46,
        accent_every=4, accent=0.06)
    arp(hp, 45, home, '0 1 2 3 4 3 2 1', step=0.5, lo=41, hi=77, vel=0.3)
    vc.at(45).play('%soft @p F2w | E2w | D2w | Bb2w | F2h C2h |')
    pad(va, 45, home, n=2, lo=53, hi=69, vel=0.28, art='soft')
    fl.at(46).play('@mp C5h F5q G5q | C6h. rq | rw |')
    drone.at(45).play('@p F2w~ | F2w~ | F2w~ | F2w |')
    drone.expr((45, 0.3), (48.9, 0.3))
    # the Glass: Sera's Thread
    sight = chart('Dm Bbmaj7 Gm:2 A:2')
    thread.at(47).play('@mp A6w~ | A6w~ | A6w |')
    thread.expr((47, 0.2), (47.5, 0.8), (49.9, 0.6))
    solo.at(47.25).play('@mp A4h D5q   E5q A5h.   rw  ')
    solo.expr((47.25, 0.8), (48, 1.0), (48.9, 0.6))
    pad(vn2, 47.25, sight[:1], n=2, lo=60, hi=74, vel=0.34, art='soft')
    arp(hp, 48, sight[1:], '0 1 2 3 4 3 2 1', step=0.5, lo=50, hi=81, vel=0.34)
    # "and saw him coming": the Lieutenant's motif, and its shadow a beat late a tritone off
    cel.at(49).play('@mp A5q D5q C5q A4q |')
    glock.at(49).play('@p rq Eb6q G#5q F#5q | Eb5q rq rh |')
    va.at(49).play('%soft @pp [D4 Eb4]w |')

    # ============================================================ VII. Every way it ends (50-55)
    drone.at(50).play('@mp D2w~ | D2w~ | D2w |')
    hum.at(50).play('@p Eb2w~ | Eb2w~ | Eb2q rq rh |')
    hum.expr((50, 0.6), (52, 1.0))
    for b in (50, 51):
        drums(taiko, b, {45: 'X..x....X..x....'}, vel=0.62, keys={})
    drums(taiko, 52, {45: 'X..x....'}, vel=0.62, keys={})
    vn.at(50).play('%trem @pp [D5 Eb5]w~ | [D5 Eb5]w~ | [D5 Eb5]q rq rh |')
    vn.expr((50, 0.3), (52, 1.0))
    cb.at(50).play('%trem @mp D2w~ | D2w~ | D2q rq rh |')
    for i, t in enumerate(_DEATHS):
        boom.note(t, 'D1', 1.4, vel=0.8 + 0.05 * i)
        timp.note(t, 'D2', 0.5, vel=0.85 + 0.03 * i, art='default')
        perc.note(t, 49, 1.2, vel=0.6 + 0.05 * i)
        tbn.note(t, 'D2', 0.5, vel=0.8)
        tbn.note(t, ['Eb2', 'Ab2', 'Eb2', 'A2'][i], 0.5, vel=0.8)
    # the rewind (205): a reversed swell, the Thread backwards
    rev.note(203.2, 'C4', 2.0, vel=0.7)
    cel.at(52.25).play('@mf A5e E5e D5e A4e rh  ')
    riser.note(205.5, 60, 3.5, vel=0.4)
    # the fire again, the night before (209.5-216)
    arp(nylon, 53.375, chart('F:2.5 C/E:4 Dm:4 Bb:4'), '0 2 1 2 3 2 1 2', step=0.5, lo=48,
        hi=76, vel=0.44)
    arp(hp, 53.5, chart('F:2 C/E:4 Dm:4'), '0 1 2 3 4 3 2 1', step=0.5, lo=41, hi=77,
        vel=0.3)
    hn.at(53.5).play('@p D4q. A4e A4q   G4e A4e D5h A4h  ', transpose=-2)
    pad(va, 53.5, chart('F:2 C/E Dm'), n=2, lo=53, hi=69, vel=0.3, art='soft')
    vc.at(53.5).play('%soft @p F2h   E2w   D2w  ')
    drone.at(53).play('@p F2w~ | F2w~ | F2w |')
    drone.expr((53, 0.2), (55.9, 0.3))

    # ============================================================ VIII. The far side (55-62)
    # sinking through the Glass
    rev.note(s.bar(55) - 1.5, 'C3', 1.5, vel=0.6)
    boom.at(55).play('@mp D1w |')
    hum.at(55).play('@mp Eb2w~ | Eb2w~ | Eb2w~ | Eb2w |')
    hum.expr((55, 0.8), (57, 0.5), (58.7, 0.3), (58.75, 0.0))
    drone.at(55).play('@mp D2w~ | D2w~ | D2w~ | D2w |')
    drone.expr((55, 0.9), (57, 0.6), (58.7, 0.4), (58.8, 0.0))
    cb.at(55).play('%sus @p D1w~ | D1w |')
    oohs.at(55).play('@pp [D4 A4]w~ | [D4 A4]w |')
    arp(glock, 55, chart('Dmadd9'), '4 3 2 1 0 1 2 1', step=0.5, lo=76, hi=100, vel=0.22)
    # him: the motif on the violins, the shadow in the violas a beat late
    solo.at(56).play('@mp A4h D5h | C5h A4h | A4w |')
    solo.expr((56, 0.7), (57, 0.9), (58, 0.6), (58.7, 0.0))
    va.at(56).play('%soft @p rq Eb4h G#3q~ | G#3q F#3h Eb3q~ | Eb3h. rq |')
    va.expr((56, 0.6), (58.7, 0.0))
    thread.at(57).play('@p A6w~ | A6h. rq |')
    thread.expr((57, 0.3), (58.5, 0.6), (58.75, 0.0))
    # the title: a hit, then the Hollow Sun, stopping on C-sharp
    t0 = s.bar(59)
    boom.note(t0, 'D1', 4, vel=1.0)
    perc.note(t0, 49, 3, vel=0.9)
    perc.note(t0, 46, 4, vel=0.85)
    timp.note(t0, 'D2', 0.5, vel=1.0, art='default')
    for p in ('Bb2', 'F3', 'D4', 'A4'):
        choir.note(t0, p, 3, vel=0.85)
        tbn.note(t0, p, 1.5, vel=0.9) if p in ('Bb2', 'F3') else hn.note(t0, p, 2, vel=0.85)
    tuba.note(t0, 'Bb1', 2, vel=0.9)
    title = chart('Bbmaj7 Gm7 Bbmaj7 A')
    pad(vn2, 59, title, n=3, lo=62, hi=81, vel=0.46, art='soft')
    pad(va, 59, title, n=2, lo=55, hi=69, vel=0.42, art='soft')
    vc.at(59).play('%soft @mp Bb2w | G2w | Bb2w | A2w |')
    cb.at(59).play('%sus @mp Bb1w | G1w | Bb1w | A1w |')
    arp(hp, 59.5, title[:3], '0 1 2 3 4 5 4 3', step=0.5, lo=46, hi=86, vel=0.38)
    thread.at(59).play('@mp A6w~ | A6w~ | A6w~ | A6w |')
    thread.expr((59, 0.3), (59.5, 1.0), (62, 0.8), (62.95, 0.0))
    solo.at(60).play('@mf A4q D5q E5q F5q | G5q A5q Bb5q C#6q~ | C#6w |')
    solo.expr((60, 0.7), (61, 0.9), (62, 0.8), (62.95, 0.1))
    bells.at(60).play('@mf A4h G4h | E4w | rw |')          # A, G, E... and not D
    drone.at(59).play('@p D2w~ | D2w~ | D2w~ | D2w |')
    drone.expr((59, 0.3), (61, 0.5), (62.95, 0.0))

    # ============================================================ the breaths
    warp(s)
    # (1) after "last of all, us" (32-36): the morning holds, then something stirs
    for p, v in (('F3', 0.34), ('A3', 0.32), ('C4', 0.3), ('F4', 0.3), ('A4', 0.28)):
        hp.note(32 + 0.35 * ['F3', 'A3', 'C4', 'F4', 'A4'].index(p), p, 3, vel=v)
    for p in ('F4', 'C5'):
        oohs.note(32, p, 2.5, vel=0.34)
    for p in ('A4', 'C5', 'F5'):
        vn2.note(32, p, 2.6, vel=0.32, art='soft')
    vn2.expr_beats((32, 0.8), (34.6, 0.0), (36, 1.0))
    hum.note(33, 'Eb2', 3, vel=0.45)
    drone.note(33.5, 'D2', 2.5, vel=0.5)
    timp.note(34, 'D2', 2, vel=0.5, art='roll')
    timp.expr_beats((34, 0.15), (35.95, 1.0))
    riser.note(33, 60, 3, vel=0.45)
    rev.note(34.5, 'C3', 1.5, vel=0.55)
    # (2) after the oath (92-96): the call dies away; a bell; the stair in the dark
    bells.note(92, 'D5', 4, vel=0.55)
    for p in ('D3', 'A3'):
        choir.note(92.5, p, 3.5, vel=0.4)
    cb.note(92, 'D2', 4, vel=0.4, art='trem')
    return s


def warp(s):
    """Insert WARP's time into a built score (see the top of this file)."""
    for part in s.parts.values():
        for n in part.notes:
            a, b = n.start, n.start + n.dur
            n.start, n.dur = w(a), w_end(b) - w(a)
        part.expr_points = [(w(t), v) for t, v in part.expr_points]
