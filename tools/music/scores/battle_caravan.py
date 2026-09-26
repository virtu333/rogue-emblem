"""Caravan battles — "Coin and Canvas".

Old Kingdom traders running goods under the occupation, and the army walking
beside the wagons: the soundtrack's first joyful battle. E major at 146,
bright and busy, and still a fight (the wagons can burn).

Confidence in the tune, tension in the bass. This is the division of labour
the verified reading finds in *Conquest*: a tune that states its key plainly
over a bass that never gives it the root. Nothing else is taken from it (not
its tune, not its loop, not its tresillo). The tune's first bar rises 5-1-3,
B, E, G-sharp, and its second leaps the octave to the high E and leans on
the D-sharp above the IV chord, its bright raised fourth. Every bar starts
on a long note, and one run of eighths closes each four bars. Under it the
bass sits on IV and on inversions (A, A, B/D#, E/G#; A, F#7/A#, E/B,
F#m7/C#, the second half climbing A, A-sharp, B, C-sharp) and never plays
an E: the tonic belongs to the tune, and the loop never closes.

The caravan's own groove: a strummed nylon guitar (down, down-up, up-down-
up), the tambourine on the off-beats, the harness jingling on the last
off-beat of each bar, and the wheel, the bass rolling in eighths, octave
and back, with one eighth missing after beat three: the lurch of a laden
wagon. No 3+3+2 anywhere.

Form (bars): intro 1-4 (the road alone; the same four bars as the link) |
A 5-12 | A2 13-20 (turns into the minor in its last bar) | B 21-28 (the
wagons can burn: the same tune in C-sharp minor over a G-sharp pedal, its
octave leap landing on a suspension over G-sharp seven; the guitar strums
every eighth and the harness stops) | C 29-36 (the way back: a long line
coming down while the bass climbs A, B, C-sharp, D-sharp, the drums at
half time for four bars; then the line's D-sharp steps onto E over E/G-sharp, the
horns join and the snare builds) | A3 37-44 (everyone) | link
45-48. Loop 5-48, 72.3 s.

calm: the traders' own band. The flute and the clarinet in duet, the
clarinet a tenth below (in A2 it takes the tune an octave down and the flute
sings the second voice above; in A3 the violins pluck the tune with the
flute), over the guitar, the celli's short-bowed wheel, pizzicato basses,
the tambourine, the harness and a guards' field drum on two and four.
full: the tune on violins (in octaves in A), then on trumpets and horns an
octave down with the violins plucking it at pitch (A2), violins and horns
(B), everyone with the trumpets on the second voice (A3); the trumpets,
trombones and timpani punch the downbeats of the strong bars and stab the
off-beats in B; a backbeat kit, four on the floor in B and A3.

Left out on purpose: Open Ground's groove handed from the kick to the brass,
its lift-hold-cut-hit and its minor-third key travel; the Oath's rising horn
gesture; the accordion, a fiddle call and the Old Kingdom horn call; the
choir. No leitmotif. Lint lists only the intended colours: the tune on the
major seventh of IV (G-sharp over A), which is its brightest note.
"""

from engine.patterns import Kit, chart, drums
from engine.score import Score

from scores._battle import Battle

KEY = 'music_battle_caravan'

INTRO, A, A2, B, C, A3, LINK = 1, 5, 13, 21, 29, 37, 45
END = 49

# ------------------------------------------------------------------ the tune
# E major. Bar 1 rises 5-1-3 (B, E, G-sharp) and says the key out loud; bar 2
# leaps the octave to the high tonic and leans on the D-sharp above the IV
# chord (its bright raised fourth); every bar starts on a long note; one run
# of eighths closes each four bars.
TUNE = """
B4q E5h G#5q | E6h. D#6q | C#6q B5h A5q | G#5q F#5e G#5e A5e G#5e F#5e E5e |
B4q E5h G#5q | F#6h. E6q | D#6q E6h B5q | A5q G#5e F#5e E5e D#5e C#5e D#5e |
"""
# the clarinet's second voice, in thirds and sixths below
DUET = """
E4q C#5h E5q | C#6h. B5q | F#5q D#5h F#5q | B4q A4e B4e C#5e B4e A4e G#4e |
E4q C#5h E5q | C#6h. A#5q | B5q G#5h E5q | F#5q E5e D#5e C#5e B4e A4e B4e |
"""
# A2 turns in its last bar and runs down into C-sharp minor
TUNE2 = TUNE.replace('A5q G#5e F#5e E5e D#5e C#5e D#5e |', 'A5q G#5e F#5e E5e D#5e B#4e D#5e |')
DUET2 = DUET.replace('F#5q E5e D#5e C#5e B4e A4e B4e |', 'C#5q B#4e A4e G#4e F#4e D#4e F#4e |')
# the horns (an octave down) can't reach the F-sharp: in bar 6 they take the
# clarinet's third below; the trumpets on the second voice in A3 go under
# the high notes of bars 2 and 6 by a fifth instead of a third
HORN = TUNE.replace('F#6h. E6q |', 'C#6h. A#5q |')
HORN2 = TUNE2.replace('F#6h. E6q |', 'C#6h. A#5q |')
DUET_TPT = DUET.replace('C#6h. A#5q |', 'A#5h. F#5q |').replace('C#6h. B5q |', 'A5h. B5q |')
# B: the same tune in C-sharp minor (the wagons can burn), over a G-sharp
# pedal; its octave leap lands on a suspension (C-sharp over G-sharp seven)
TUNE_B = """
G#4q C#5h E5q | C#6h. B#5q | A5q G#5h F#5q | E5q D#5e E5e F#5e E5e D#5e C#5e |
G#4q C#5h E5q | D#6h. C#6q | B#5q C#6h G#5q | F#5q E5e D#5e C#5e B#4e A4e B#4e |
"""
DUET_B = """
E4q G#4h C#5q | F#5h. D#5q | F#5q E5h C#5q | C#5q B#4e C#5e D#5e C#5e B#4e G#4e |
E4q G#4h C#5q | B#5h. G#5q | G#5q E5h C#5q | D#5q C#5e B#4e A4e G#4e F#4e G#4e |
"""
# C: the way back. A long line coming down while the bass climbs
TUNE_C = """
C#6h. B5q | B5h. G#5q | G#5h. F#5q | F#5q G#5e A5e B5e C#6e B5e D#6e |
E6h. C#6q | B5h. G#5q | A5h C#6h | B5q A5e G#5e F#5e E5e D#5e C#5e |
"""
DUET_C = """
A5h. G#5q | G#5h. E5q | E5h. C#5q | D#5q E5e F#5e G#5e A5e G#5e B5e |
B5h. G#5q | G#5h. E5q | E5h A5h | G#5q F#5e E5e D#5e C#5e B4e A4e |
"""

# ------------------------------------------------------------------ harmony
# The bass never plays E under the tune: IV and inversions, so the loop
# never closes. B sits on a G-sharp pedal and the leading-tone B-sharp.
CH_A = 'A A B/D# E/G# A F#7/A# E/B F#m7/C#'
CH_A2 = 'A A B/D# E/G# A F#7/A# E/B G#7/D#'
CH_B = 'C#m/G# G#7 A C#m/G# C#m/G# G#7/B# C#m/G# G#7/B#'
CH_C = 'A E/B C#m7 B/D# E/G# C#m7 A E/G#'
CH_LINK = 'A B/A C#m7 G#m7'
# the second note of each bar's bass (never E)
ALT = {'A': 'C#', 'B/D#': 'F#', 'E/G#': 'B', 'B/A': 'F#', 'F#7/A#': 'C#', 'E/B': 'G#',
       'F#m7/C#': 'A', 'C#m7': 'G#', 'G#7/D#': 'G#', 'C#m/G#': 'G#', 'G#7': 'D#',
       'G#7/B#': 'D#', 'F#m7': 'C#', 'G#m7': 'D#'}
SECTIONS = [(INTRO, CH_LINK), (A, CH_A), (A2, CH_A2), (B, CH_B), (C, CH_C), (A3, CH_A),
            (LINK, CH_LINK)]

PC = {'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7,
      'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11, 'B#': 0}


def bars(text):
    return chart(' '.join(f'{c}:4' for c in text.split()))


def chord_of(bar):
    for bar0, text in SECTIONS:
        syms = text.split()
        if bar0 <= bar < bar0 + len(syms):
            return syms[bar - bar0]
    raise KeyError(bar)


def at_or_above(pc, lo):
    return lo + (pc - lo) % 12


# ------------------------------------------------------------------ the guitar
# a strummed nylon guitar: down, down-up, up-down-up (eighths); downstrokes
# rake from the bass string up, upstrokes flick the top three strings
STRUM = [(0.0, 'D', 0.6), (1.0, 'D', 0.7), (1.5, 'U', 0.44), (2.5, 'U', 0.5), (3.0, 'D', 0.7),
         (3.5, 'U', 0.46)]
# B: straight eighths, every one struck (the caravan hurrying)
HURRY = [(k * 0.5, 'D' if k % 2 == 0 else 'U', 0.66 if k % 2 == 0 else 0.5) for k in range(8)]


def _jit(*key):
    """A small, repeatable wobble for one string of one strum."""
    import zlib
    return (zlib.crc32(repr(key).encode()) % 1000) / 1000.0 - 0.5


def guitar_voicing(sym, floor=40):
    from engine.theory import Chord
    c = Chord(sym)
    b = at_or_above(c.bass, floor)
    out = [b]
    for p in range(b + 1, 76):
        if p % 12 in c.pcs and p - out[-1] >= 3 and len(out) < 5:
            out.append(p)
    return out


def strum(part, bar, sym, pattern=STRUM, floor=40):
    t0 = part.score.bar(bar)
    v = guitar_voicing(sym, floor)
    for k, (off, d, vel) in enumerate(pattern):
        nxt = pattern[k + 1][0] if k + 1 < len(pattern) else 4.0
        strings = v if d == 'D' else list(reversed(v[-3:]))
        rake = 0.045 if d == 'D' else 0.03
        for i, p in enumerate(strings):
            j = _jit(bar, k, i)
            vv = vel * (0.9 if d == 'U' else 1.0) * (1 - 0.05 * i / len(strings)) + 0.06 * j
            # the strum is damped before the next one: a strum, not a pad
            ring = min(nxt - off, 0.85) - i * rake + 0.05
            part.note(t0 + off + i * rake + 0.01 * j, p, ring, vel=vv, rearticulate=True)


# the wheel: rolling eighths on the bass, octave and back, with one
# eighth missing after beat three every bar (the lurch of a laden wagon)
WHEEL = ['b', 'b8', 'a', 'b8', 'b', None, 'a', 'b8']


def wheel(bar, sym):
    """[(beat offset, pitch)] of the wheel figure on this bar's chord."""
    from engine.theory import Chord
    c = Chord(sym)
    lo = at_or_above(c.bass, 28)
    alt = at_or_above(PC[ALT[sym]], lo + 1)
    if alt - lo > 9:
        alt -= 12
    out = []
    for k, w in enumerate(WHEEL):
        if w is None:
            continue
        p = {'b': lo, 'b8': lo + 12, 'a': alt}[w]
        out.append((k * 0.5, p))
    return out


def build():
    s = Score('battle_caravan', tonic='E', bpm=146, intro_bars=4, loop_bars=44,
              title='Coin and Canvas', seed=331)
    s.reverb = dict(rt60=1.8, predelay_ms=20, wet_db=-2.0)
    s.master = dict(lufs=-14.0, glue_ratio=1.5)
    b = Battle(s, calm_lufs=-17.0, full_lufs=-14.0)
    for bar0, text in SECTIONS:
        b.section({INTRO: 'intro', A: 'A', A2: 'A2', B: 'B', C: 'C', A3: 'A3',
                   LINK: 'link'}[bar0], bar0, bars(text))

    tunes(b, s)
    road(b, s)
    full(b, s)
    return b.finish()


def tunes(b, s):
    # ---------------------------------------------------------------- calm: the duet
    fl = b.part('duet_fl', 'flute', role='lead', layer='calm', gain=2)
    cl = b.part('duet_cl', 'clarinet', role='lead2', layer='calm', gain=1)
    fl.at(A).play('@mf' + TUNE)
    cl.at(A).play('@mf' + DUET, transpose=-12)
    # A2: the clarinet takes the tune an octave down, the flute the second
    # voice above it
    b.part('duet_cl2', 'clarinet', role='lead', layer='calm', gain=1).at(A2).play(
        '@mf' + TUNE2, transpose=-12)
    b.part('duet_fl2', 'flute', role='lead2', layer='calm', gain=2).at(A2).play(
        '@mp' + DUET2)
    fl.at(B).play('@mf' + TUNE_B)
    cl.at(B).play('@mf' + DUET_B, transpose=-12)
    fl.at(C).play('@mf' + TUNE_C)
    cl.at(C).play('@mf' + DUET_C, transpose=-12)
    fl.at(A3).play('@f' + TUNE)
    b.part('c_pz', 'violins', role='lead2', layer='calm', art='pizz', gain=-3).at(A3).play(
        '@mf' + TUNE)
    cl.at(A3).play('@mf' + DUET, transpose=-12)

    # ---------------------------------------------------------------- full: the band
    # (the tune climbs to F-sharp 6: the violins' presence is taken down)
    vn = b.part('tune_vn', 'violins', role='lead', layer='full', art='sus',
                eq=[('peak', 3500, 0.9, -3.0), ('highshelf', 7000, 0.7, -2.0)])
    vn.at(A).play('@f' + TUNE)
    vn.at(B).play('@f' + TUNE_B)
    vn.at(C).play('@f' + TUNE_C)
    vn.at(A3).play('@ff' + TUNE)
    vn2 = b.part('tune_vn2', 'violins2', role='lead2', layer='full', art='sus')
    vn2.at(A).play('@f' + TUNE, transpose=-12)
    vn2.at(C).play('@f' + DUET_C)
    # A2: the brass take the tune an octave down, the violins pluck it at pitch
    # above them, and the violas sing the second voice underneath
    pz = b.part('tune_pz', 'violins', role='lead2', layer='full', art='pizz', gain=-2)
    pz.at(A2).play('@f' + TUNE2)
    b.part('duet_va', 'violas', role='counter', layer='full', art='sus').at(A2).play(
        '@mf' + DUET2, transpose=-12)
    tpt = b.part('tune_tpt', 'trumpets', role='lead', layer='full', art='vib')
    tpt.at(A2).play('@f' + TUNE2, transpose=-12)
    b.part('duet_tpt', 'trumpets', role='counter', layer='full', art='vib',
           gain=-2).at(A3).play('@mf' + DUET_TPT)
    hn = b.part('tune_hn', 'horns', role='lead2', layer='full')
    for part in (vn, vn2, tpt, hn, pz):
        part.expr(*[(bar + d, v) for bar in range(A, LINK, 2) for d, v in
                    ((0, 0.86), (0.4, 1.0), (1.5, 0.95), (1.95, 0.84))])
    hn.at(A2).play('@f' + HORN2, transpose=-12)
    hn.at(B).play('@f' + TUNE_B, transpose=-12)
    hn.at(A3).play('@f' + HORN, transpose=-12)


def road(b, s):
    """What both mixes share: the guitar, the wheel, the tambourine, the harness."""
    gtr = b.part('guitar', 'nylon', role='keys', gain=-3, calm_db=0)
    pvc = b.part('wheel_vc', 'celli', role='ostinato', art='spic', gain=-4, calm_db=3)
    pz = b.part('bass_pz', 'basses', role='low', art='pizz', gain=-6, calm_db=4)
    for bar in range(1, END):
        sym = chord_of(bar)
        pattern = HURRY if B <= bar < C else STRUM
        strum(gtr, bar, sym, pattern, floor=47 if B <= bar < A3 else 40)
        t = s.bar(bar)
        for off, p in wheel(bar, sym):
            accent = off in (0.0, 2.0)
            pvc.note(t + off, p + 12, 0.5, vel=0.62 if accent else 0.48)
            if accent:
                pz.note(t + off, p, 1.0, vel=0.66)

    # the guards' drum, in the calm only (the kit takes over in the full mix):
    # taps on two and four and a ghost before each; a roll into each strain
    guard = b.part('guard', 'orch_perc', role='accent', layer='calm', gain=-6)
    for bar in range(1, END):
        grid = {'sn_taps': '...ox......ox...'} if not B <= bar < C else \
            {'sn_taps': '..oxx.o...oxx.ox'}
        drums(guard, bar, grid, vel=0.55)
    # (not into A: a roll there would ring across the loop point)
    for bar in (A2 - 1, B - 1, C - 1, A3 - 1):
        guard.note(s.bar(bar) + 3.0, 39, 1.0, vel=0.4)
    perc = b.part('tamb', 'orch_perc', role='accent', gain=-6)
    harness = b.part('harness', 'orch_perc', role='accent', gain=-6)
    for bar in range(1, END):
        drums(perc, bar, {'tamb': '..x...x...x...x.'}, vel=0.5)
        # the harness jingles on the last off-beat, louder every other bar; it
        # stops while the caravan is under attack (B)
        if not B <= bar < C:
            harness.note(s.bar(bar) + 3.5, 82, 0.5, vel=0.55 if bar % 2 else 0.4)


def full(b, s):
    from engine.theory import Chord
    kit = Kit(s, 'kit', gains={'kick': -4.0, 'snare': -7.0, 'cym': -4.0, 'toms': -6.0})
    b.kit = kit
    b.full_only.update(kit.names())
    # the road: kick on one and three and a bump on the last sixteenth, a
    # backbeat with a ghost, the shaker in eighths
    ROAD = {'kick': 'x.......x......x', 'snare': '....X......oX...',
            'shaker': 'x.o.x.o.x.o.x.o.'}
    ROAD_FILL = {'kick': 'x.......x.......', 'snare': '....X.......X...',
                 'tom_lo': '..........x.x.XX', 'tom_hi': '..........x.....',
                 'shaker': 'xoxoxoxoxo......'}
    HUNT = {'kick': 'x...x...x...x...', 'snare': '....X.......X...', 'ride': 'x.x.x.x.x.x.x.x.',
            'tom_lo': '..............x.'}
    HUNT_FILL = {'kick': 'x...x...x...x...', 'snare': '....X.......XXXX',
                 'tom_lo': '..........xx....'}
    HALF = {'kick': 'x.......x.......', 'snare': '........X.......', 'ride': 'x.x.x.x.x.x.x.x.'}
    for sec in ('intro', 'A', 'A2', 'link'):
        b.groove(sec, ROAD, ROAD_FILL, every=4, vel=0.7, crash=sec not in ('intro', 'link'))
    DRIVE = {'kick': 'x...x...x...x..x', 'snare': '....X..o.o..X..o',
             'ride': 'x.x.x.x.x.x.x.x.'}
    b.groove('A3', DRIVE, ROAD_FILL, every=4, vel=0.72)
    kit.play(A3 + 4, {'crash2': 'x'})
    b.groove('B', HUNT, HUNT_FILL, every=4, vel=0.74)
    b.groove('C', HALF, None, n_bars=4, vel=0.66)
    for bar in range(C + 4, C + 8):
        kit.play(bar, ROAD if bar < C + 7 else {'kick': 'x...x...x...x...',
                                                  'snare': 'x.x.x.x.xxxxxxxx'},
                 vel=0.72, ramp=0.4 if bar == C + 7 else 0.0)
    kit.play(C + 4, {'crash': 'X'})

    rb = b.part('ebass', 'rbass', layer='full', role='bass', duck='kit_kick', gain=-2)
    for bar in range(1, END):
        for off, p in wheel(bar, chord_of(bar)):
            rb.note(s.bar(bar) + off, p, 0.5, vel=0.74 if off in (0.0, 2.0) else 0.62)

    # strings: violas in eighths under C; the second violins' sixteenths where
    # the road is fastest (A2, B)
    b.spic8('C', 'violas', degrees='0 1 2 1 0 1 2 1', lo=55, hi=71, vel=0.5,
            accents='> - - - > - - -', layer='full')
    for sec in ('A2', 'B'):
        b.spic16(sec, 'violins2', pattern='0 1 2 1', lo=67, hi=86, vel=0.46, layer='full')

    # brass: the horns join C's line an octave down for its second half, as
    # it climbs; the punches of the trumpets and trombones mark the strong
    # bars of A, A2 and A3; in B the trumpets stab the off-beats
    s.parts['tune_hn'].at(C + 4).play('@f' + TUNE_C.strip().split('\n')[1], transpose=-12)
    punch = b.part('punch', 'trumpets', role='accent', art='stac', layer='full')
    punch_tb = b.part('punch_tbn', 'trombones', role='accent', art='stac', layer='full')
    for bar0 in (A, A2, A3):
        for k in ((0, 2, 4, 6) if bar0 != A3 else (0, 4)):
            c = Chord(chord_of(bar0 + k))
            top = [p for p in range(60, 77) if p % 12 in c.pcs][:3]
            # the trombones put the bar's bass under the punch
            bs = at_or_above(c.bass, 40)
            low = [bs] + [p for p in range(bs + 5, 60) if p % 12 in c.pcs][:1]
            for p in top:
                punch.note(s.bar(bar0 + k), p, 0.5, vel=0.72)
            for p in low:
                punch_tb.note(s.bar(bar0 + k), p, 0.5, vel=0.7)
    for bar in range(B, C):
        c = Chord(chord_of(bar))
        top = [p for p in range(64, 77) if p % 12 in c.pcs][:2]
        for off in (0.5, 1.5, 2.5, 3.5):
            for p in top:
                punch.note(s.bar(bar) + off, p, 0.25, vel=0.6 if off != 3.5 else 0.68)

    b.timp('intro', 'rw | rw | rw | %roll @mp G#2h @f B2h |')
    # the timpani strike with the punches, on the bass of the bar
    for bar0 in (A, A2, A3):
        for k in (0, 2, 4, 6):
            c = Chord(chord_of(bar0 + k))
            b.part('timp', 'timpani', role='timp', calm_db=-8).note(
                s.bar(bar0 + k), at_or_above(c.bass, 40), 1.0, vel=0.78 if k in (0, 4) else 0.66)
    b.timp('B', '%default @f G#2q G#2q G#2q G#2e G#2e |' * 2)
    b.timp('C', 'rw | rw | rw | rw | rw | rw | rw | %roll @mp G#2h @f G#2h |')
    b.timp('link', 'rw | rw | rw | %roll @mp G#2h @f B2h |')
    for bar in (A, A2, B, C, A3):
        b.hit(bar)
    s.parts['perc'].opts['gain'] = -5
    # the timpani are heard in the calm mix too, further off
    b.calm_gain['timp'] = -5
