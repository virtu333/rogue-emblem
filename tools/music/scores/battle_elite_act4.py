"""Act IV elite battles — "The Emperor's Own".

The Emperor's household guard, holding a stronghold of the ashen capital at
night. B-flat minor, the Emperor's key, at 164: the fastest Act IV music, and
the one that marches forward instead of tolling.

The company's tune is a cry and a fall: a leap up a sixth, held, and a step
down (B-flat to G-flat, then F), three times, each a step lower over a bass
that walks down with it (E-flat, D-flat, C-flat), so the figure keeps its
place in each chord (fifth, third, ninth). The second phrase opens the leap
to a major sixth, reaches the high B-flat and falls an octave by step to the
company's cadence: C-flat in the bass, A natural in the tune (an augmented
sixth), both closing onto B-flat. The Empire's half-step (C-flat to B-flat)
is that cadence, and it takes the dominant's place: no strain has a V-i.

The strain follows Tearing Through Heaven as its verified reading has it (not
the seven-bar loop an earlier study miscounted): a square eight bars, 3 +
stop bar + 3 + tonic bar. In the stop bar (bar 4) the band withdraws after
its downbeat (the bass, the stabs, the held chords, and in B the running
eighths), the kit keeps going, the held note of the tune fades, and the
trumpets come back in forte with a three-note pickup on beats 3-4, in every
strain, whoever holds the tune: the company's bugles. The downbeat is a
stamp (timpani and a low brass hit with the bass's last eighth; in B the
tuba takes its low C, under the trombones' floor) and the snare doubles the
pickup, so the stop reads as a halt, not a lost bass. The tonic is never on
a downbeat inside a strain: it arrives only by anticipation, on the last
eighth of bar 7, and bar 8 is the tonic bar.

The groove is a hocket, not a rhythm with rests. The bass plays 1, 2.5, 4
and 4.5, the last eighth tied over the bar line: each new bass note arrives
an eighth early, except at the phrase starts and in the stop and tonic bars,
which breathe. The snare hits 2 and 3.5, and the brass stabs are the snare
hits (horns, trombones and the strings' chords with it, never with the
bass); the kick takes every eighth the snare leaves. Every eighth is struck
by exactly one drum, and the tune's long notes lock to the bass (1, 2.5, 4).

The intro, and the turn that closes the loop, is two chords, G-flat over
B-flat and A-flat, grouped 3+3+2 in quarters across two bars: the bass on 1,
4, 7 and the and-of-8 tied over, chord stabs between, and the tonic only as a
single repeated cello note, a voice and not yet a chord.

The company's standard is the head of the Emperor's own anthem (boss_emperor
ANTHEM, F Bb. C D) turned minor: F, B-flat, C, D-flat. It is raised once per
loop, in C, on the company's brass (trumpets, the horns an octave below,
violins above), and it is the only place the tonic stands on a downbeat under
the whole band: the choir enters there for the first and only time, the bass
goes to whole notes and the snare to a roll (sixteenths while the standard is
raised) that keeps the hocket's accents. Between its two raisings comes the
company's cry (the held G-flat becomes the flat ninth of F7, the choir under
it on A diminished seven with no F of its own, and falls to F); after
them, its cadence. It is approached from its dominant: the build is one
unbroken crescendo over an F pedal, as in the verified reading of Tearing's
(no rest before the arrival), and the trumpets' pickup, the Empire's half-step
climbing (C, D-flat, E-flat), calls the standard in on the downbeat. The
standard is where the dominant is allowed: the build's F7 lands on its first
raising (32-33) and the cry's F7 on its second (C4-C5), the piece's only two
V-i. The Emperor's anthem keeps his leading-tone cadence; his guard's
strains do not.

B is the second verse, in F minor (the tonic bar of A2 is its first chord,
B-flat minor as iv): the same rhythm and harmony, but its sequence climbs
where A's falls (the leaps reach C, then E-flat, then the horns' high F over
G-flat major 7) against the bass walking down (the contrabasses from B-flat
1; the bass guitar, which has nothing under A1, walks it an octave up with
the fifth below each root, never folding); horns with trombones below;
flute and second violins run eighths through the stab rests.

The build (29-32) is the piece's own material sped up: two bars of the
intro's 3+3+2 cell in quarters over an F pedal, then the same grouping in
eighths, which is the strain's groove (bass 1, 2.5, 4; stabs 2 and 3.5),
with a sixteenth surface and the snare growing under the trumpets' pickup.

Form (bars, 4/4 at 164): intro 1-4 | A1 5-12 (trumpets) | A2 13-20 (violins,
horns below; the trumpets on the stabs and the pickup) | B 21-28 (F minor) |
build 29-32 (the intro's cell over an F pedal, then the groove, a sixteenth
surface and the trumpets' pickup) | C 33-40 (the standard, B-flat minor) |
A3 41-48 (the tune on trumpets and horns under a high violin descant) |
turn 49-52 (the intro's two chords, back to A1). Loop 5-52.

Leitmotifs: none of the Thread (this is the enemy's music). The Emperor's
anthem head, turned minor, is the standard; the Empire's half-step closes
every strain.

Distinct from Against the Standard (Act I's elite theme): no seven-sixteenth
cycle and no dead stop; here the pulse never stops, only the band does.
Distinct from Ashfall: no bells, no doom march.

calm: the same hocket heard from the walls at night: pizzicato basses on the
bass's rhythm, harp chords and a distant side drum on 2 and 3.5, a bass drum
on one, soft violas; the tune on an oboe (A1), clarinet (A2), horn (B),
clarinet over a soft horn (the standard) and solo violin (A3); a muted
trumpet gives every pickup. The stop bars stop here too: the harp's stabs
and the violas leave with the bass.
"""

from engine.patterns import Kit, arp, bass, chart, drums, pad
from engine.score import Score
from engine.theory import pitch as P

from scores._battle import Battle

KEY = 'music_battle_elite_act4'

# ------------------------------------------------------------------ material
# the company's tune (A strain): the cry (a sixth up, held, a step down) three
# times, the stop bar and the trumpets' pickup, the high B-flat, the fall and
# the cadence (C-flat, A natural, B-flat anticipated)
TUNE = """
Bb4q. Gb5e~ Gb5q F5q | Ab4q. F5e~ F5q Eb5q | Gb4q. Eb5e~ Eb5q. Db5e~ | Db5h F4q> Ab4e Db5e~ |
Db5q. Bb5e~ Bb5q Ab5q | Gb5q. F5e~ F5q Eb5q | Db5q. Cb5e~ Cb5q A4e Bb4e~ | Bb4h. rq |
"""
# the same line when another section holds it: the pickup is the trumpets',
# and the holder rejoins on its last note
TUNE_HELD = """
Bb4q. Gb5e~ Gb5q F5q | Ab4q. F5e~ F5q Eb5q | Gb4q. Eb5e~ Eb5q. Db5e~ | Db5h rq re Db5e~ |
Db5q. Bb5e~ Bb5q Ab5q | Gb5q. F5e~ F5q Eb5q | Db5q. Cb5e~ Cb5q A4e Bb4e~ | Bb4h. rq |
"""
PICKUP = 'rw | rw | rw | rh F4q> Ab4e Db5e~ | Db5q rq rh | rw | rw | rw |'

# B (F minor): the second verse. Same rhythm and harmony, but the sequence
# climbs where A's falls: each leap reaches higher (C, E-flat, then the high
# horn F over G-flat major 7) while the bass walks down under it; the stop bar
# holds the fifth of A-flat
TUNE_B = """
F4q. C5e~ C5q Bb4q | Ab4q. Eb5e~ Eb5q C5q | Bb4q. F5e~ F5q. Eb5e~ | Eb5h rq re Ab4e~ |
Ab4q. F5e~ F5q Eb5q | Db5q. C5e~ C5q Bb4q | Ab4q. Gb4e~ Gb4q E4e F4e~ | F4h. rq |
"""
PICKUP_B = 'rw | rw | rw | rh C4q> Eb4e Ab4e~ | Ab4q rq rh | rw | rw | rw |'

# C: the company's standard: the head of the Emperor's anthem (F Bb. C D),
# turned minor, raised twice; between, the company's cry; then its cadence
STANDARD = """
F4q Bb4q. C5e Db5q~ | Db5w | Bb4q. Gb5e~ Gb5h~ | Gb5h F5h |
F4q Bb4q. C5e Db5q~ | Db5q. Bb5e~ Bb5q Ab5q | Db5q. Cb5e~ Cb5q A4e Bb4e~ | Bb4h. rq |
"""
# the same with breaths, for the calm mix's winds
STANDARD_BR = """
F4q Bb4q. C5e Db5q~ | Db5h. rq | Bb4q. Gb5e~ Gb5h~ | Gb5h F5q rq |
F4q Bb4q. C5e Db5q~ | Db5q. Bb5e~ Bb5q Ab5q | Db5q. Cb5e~ Cb5q A4e Bb4e~ | Bb4h. rq |
"""
# A3: the violins' descant over the tune, held high on D-flat (lifting to
# E-flat over C-flat) and closing with it: its A natural doubles the tune's
# leading tone
DESCANT = """
Db6w | Db6w | Eb6w | Db6h rh |
Db6w | Bb5w | Cb6h. A5e Bb5e~ | Bb5h. rq |
"""

CH_A = chart('Ebm9 Db Cbmaj7 Db/F Gbmaj7 Ebm9 Cbmaj7:2.5 Cb7:1.5 Bbm')
CH_B = chart('Bbm9 Ab Gbmaj7 Ab/C Dbmaj7 Bbm9 Gbmaj7:2.5 Gb7:1.5 Fm')
CH_BUILD = chart('Db/F Gb/F Bbm/F F7')
CH_C = chart('Bbm Gb Ebm F7 Bbm Gbmaj7 Cb:3 Cb7:1 Bbm')
CH_CELL = chart('Gb/Bb Ab Gb/Bb Ab')
# sustained harmony leaves the colour notes (the ninths of m1 and m6, the major
# sevenths under the tune's roots in m5 and m7) to the tune itself.
# The semitones lint still reports are all intended: the tune's ninth over the
# chord's minor third in m1 and m6 (F over G-flat; C over D-flat in B), the
# C-flat major 7 of m3, the horns' high F as the major seventh of G-flat (B
# m3), G-flat over the build's F pedal, and the standard's G-flat as the
# ninth of F7 falling to F (C4).
CH_A_PAD = chart('Ebm7 Db Cbmaj7 Db/F Gb Ebm7 Cb:2.5 Cb7:1.5 Bbm')
CH_B_PAD = chart('Bbm7 Ab Gbmaj7 Ab7/C Db Bbm7 Gb:2.5 Gb7:1.5 Fm')
# (C4: while the cry holds G-flat the chord is A diminished seven, the F7's
# upper notes with the flat ninth, so no voice sits on F a semitone under the
# horns' G-flat; F7 comes with the fall)
CH_C_PAD = chart('Bbm Gb Ebm Adim7:2 F7:2 Bbm Gb Cb:3 Cb7:1 Bbm')

# the hocket's bass, per strain bar: (the bar's bass, the note on 2.5, the
# note on 4); every bar but the phrase starts is anticipated on the and-of-4
BASS_A = [('Eb2', 'Bb2', 'Eb2'), ('Db2', 'Ab2', 'Db2'), ('Cb2', 'Gb2', 'Cb2'), ('F2', None, None),
          ('Gb1', 'Db2', 'Gb1'), ('Eb2', 'Bb2', 'Eb2'), ('Cb2', 'Gb2', 'Cb2'),
          ('Bb1', 'F2', 'Bb1')]
BASS_B = [('Bb1', 'F2', 'Bb1'), ('Ab1', 'Eb2', 'Ab1'), ('Gb1', 'Db2', 'Gb1'), ('C2', None, None),
          ('Db2', 'Ab2', 'Db2'), ('Bb1', 'F2', 'Bb1'), ('Gb1', 'Db2', 'Gb1'), ('F1', 'C2', 'F1')]
# ...and B for the bass guitar, which has nothing below A1: an octave up with
# the fifth below each root, so the walk down (B-flat, A-flat, G-flat; then
# D-flat, B-flat, G-flat, F) stays one line (C2-D-flat 3) instead of folding
# up a seventh wherever a root fell under A1
BASS_B_EB = [('Bb2', 'F2', 'Bb2'), ('Ab2', 'Eb2', 'Ab2'), ('Gb2', 'Db2', 'Gb2'), ('C3', None, None),
             ('Db3', 'Ab2', 'Db3'), ('Bb2', 'F2', 'Bb2'), ('Gb2', 'Db2', 'Gb2'), ('F2', 'C2', 'F2')]

# the 'Choir Aahs' tuning, per key, for this score's held choir notes: every
# note rendered alone at its own length and dynamic, its pitch measured over
# the note body (harmonic sum, 0.3 s windows), averaged per key
CHOIR_AAH_CENTS = {57: 23, 58: -3, 59: 0, 60: -2, 61: 4, 63: 13, 65: 9, 66: 12, 69: -3, 70: -1,
                   71: 1, 73: -5, 75: 15}
CHOIR_FIX = {k: -v for k, v in CHOIR_AAH_CENTS.items()}

# brass stabs (2 and 3.5), voiced by hand: trombones two notes, horns three.
# m7 turns on its second stab: C-flat with A natural, the augmented sixth
STAB_TBN = {'Ebm9': 'Eb3 Bb3', 'Db': 'Db3 Ab3', 'Cbmaj7': 'Cb3 Gb3', 'Db/F': 'F3 Db4',
            'Gbmaj7': 'Gb3 Db4', 'Cb7': 'Cb3 A3', 'Bbm': 'Bb2 F3'}
STAB_HN = {'Ebm9': 'Gb4 Bb4 Db5', 'Db': 'F4 Ab4 Db5', 'Cbmaj7': 'Eb4 Gb4 Bb4',
           'Db/F': 'F4 Ab4 Db5', 'Gbmaj7': 'Gb4 Bb4 Db5', 'Cb7': 'Eb4 Gb4 A4',
           'Bbm': 'Db4 F4 Bb4'}
STAB_STR = {'Ebm9': 'Eb3 Gb3 Bb3 Db4', 'Db': 'Db3 F3 Ab3 Db4', 'Cbmaj7': 'Cb3 Gb3 Bb3 Eb4',
            'Db/F': 'F3 Ab3 Db4', 'Gbmaj7': 'Gb2 Db3 Gb3 Bb3', 'Cb7': 'Cb3 Gb3 A3 Eb4',
            'Bbm': 'Bb2 F3 Bb3 Db4'}
# the B strain is the A strain's harmony a fourth lower: its chords borrow the
# A voicings, transposed
B_SYMBOL = {'Bbm9': 'Ebm9', 'Ab': 'Db', 'Gbmaj7': 'Cbmaj7', 'Ab/C': 'Db/F', 'Dbmaj7': 'Gbmaj7',
            'Gb7': 'Cb7', 'Fm': 'Bbm'}
B_SHIFT = -5
# the stop bar's stamp: a low brass hit on the downbeat, with the bass's last
# eighth (in B the low C is the tuba's: the trombones stop at E2)
STAMP = {'Db/F': 'F2 F3 Db4', 'Ab/C': 'C3 Ab3'}
STAMP_TUBA = {'Ab/C': 'C2'}

# drum grids (16 steps a bar). The hocket: the kick takes every eighth the
# snare (2, 3.5) leaves; accents with the bass (1, 2.5, 4, 4.5)
HOCKET = {'kick': 'x.o...x.o...x.x.', 'snare': '....X.....x.....', 'hat': 'x.x.x.x.x.x.X.X.'}
HOCKET_FILL = {'kick': 'x.o...x.o.......', 'snare': '....X.....x.xxXX', 'hat': 'x.x.x.x.x.x.....'}
HOCKET_RIDE = {'kick': 'x.o...x.o...x.x.', 'snare': '....X.....x.....',
               'ride': 'X.x.x.x.X.x.x.x.'}
RIDE_FILL = {'kick': 'x.o...x.o.......', 'snare': '....X.....x.xxXX', 'ride': 'X.x.x.x.X.x.....',
             'tom_lo': '............x.x.'}
HOCKET_A3 = {'kick': 'x.o...x.o...x.x.', 'snare': '....X.....x.....',
             'ride': 'X.x.x.x.X.x.x.x.', 'ride_bell': '............x.x.'}
# the stop bar: the kit keeps going and its snare doubles the trumpets' pickup
STOP = {'kick': 'X.o...x.o...x.x.', 'snare': '....X...X...X.X.', 'hat': 'x.x.x.x.x.......',
        'crash2': 'x...............'}
STOP_RIDE = {'kick': 'X.o...x.o...x.x.', 'snare': '....X...X...X.X.', 'ride': 'X.x.x.x.X.......',
             'crash2': 'x...............'}
# C: the harmony broadens, the snare rolls in sixteenths and keeps the
# hocket's accents on 2 and 3.5
ROLL = {'kick': 'X.o...x.o...x.x.', 'snare': 'ooooXoooooxooooo'}
ROLL8 = {'kick': 'X.o...x.o...x.x.', 'snare': 'o.o.X.o.o.x.o.o.'}
# the intro cell's kit: the bass hits, then a tom and snare fill every other bar
CELL_A = {'kick': 'x...........x...', 'hat': 'x.x.x.x.x.x.x.x.'}
CELL_B = {'kick': '........x.....x.', 'tom_hi': 'X...X...........', 'tom_lo': '..........x.X...',
          'snare': '.....x.......xx.'}


# ------------------------------------------------------------------ helpers
def strain_bass(part, bar, rows, vel=0.74, art=None, tied_in=False, octave=0):
    """The hocket's bass over one eight-bar strain (3 + stop + 3 + tonic).

    Each bar plays its note on 1 (unless the last bar anticipated it), then 2.5,
    4, and on the and-of-4 the next bar's note, tied over the bar line. The
    phrase starts (bars 1 and 5) are struck on the beat; the stop bar keeps
    only its anticipated eighth; the tonic bar rests on the and-of-4."""
    s = part.score
    for i, (b1, b25, b4) in enumerate(rows):
        t = s.bar(bar + i)
        stop, tonic = i == 3, i == 7
        struck = i in (0, 4) and not (i == 0 and tied_in)
        if struck:
            part.note(t, P(b1) + octave, 1.5, vel=vel + 0.06, art=art)
        if stop:
            continue
        part.note(t + 1.5, P(b25) + octave, 1.5, vel=vel, art=art)
        part.note(t + 3.0, P(b4) + octave, 0.5, vel=vel, art=art)
        if tonic:
            continue
        nxt = rows[i + 1][0]
        # into the stop bar the tie lasts only through the downbeat's eighth
        dur = 1.0 if i + 1 == 3 else 2.0
        part.note(t + 3.5, P(nxt) + octave, dur, vel=vel + 0.04, art=art)


def stabs_at(part, bar, ch, table, positions=(2.0, 3.5), dur=0.5, vel=0.7, art=None,
             transpose=0, rename=None):
    """Hand-voiced chords struck at `positions` (beats) in every bar of `ch`."""
    s = part.score
    t = s.bar(bar)
    spans = []
    for c, beats in ch:
        spans.append((t, t + beats, c.symbol))
        t += beats
    end = t
    b = bar
    while s.bar(b) < end - 1e-9:
        for pos in positions:
            x = s.bar(b) + pos - 1.0
            sym = next(sym for a, z, sym in spans if a - 1e-9 <= x < z - 1e-9)
            if rename:
                sym = rename.get(sym, sym)
            for p in table[sym].split():
                part.note(x, P(p) + transpose, dur, vel=vel, art=art, rearticulate=True)
        b += 1


def cell(s, bar, bars, parts, into=None, vel=0.72, chords=('Db3 Gb3 Bb3', 'Eb3 Ab3 C4'),
         low=('Bb1', 'Ab1'), single='Bb2'):
    """The intro's two chords, G-flat over B-flat and A-flat, grouped 3+3+2 in
    quarters across each pair of bars: the bass on 1, 4, 7 and the and-of-8
    (tied into the next pair, or into `into`, the note the next section
    starts on); chord stabs on 2, 3, 5, 6, 8; the tonic, a single cello B-flat,
    on the offbeats between. Every eighth is struck by exactly one of the
    three. `parts` maps role -> [(part, transpose, art)]."""
    chords = {'odd': chords[0], 'even': chords[1]}
    for k in range(0, bars, 2):
        t = s.bar(bar + k)
        last_pair = k + 2 >= bars
        ant = into if (last_pair and into) else low[0]
        bass_ev = [(0.0, low[0], 1.0), (3.0, low[0], 1.0), (6.0, low[1], 1.5), (7.5, ant, 1.5)]
        if k > 0:
            bass_ev = bass_ev[1:]         # tied in from the last pair's anticipation
        for part, tr, art in parts.get('bass', ()):
            for off, p, d in bass_ev:
                part.note(t + off, P(p) + tr, d, vel=vel + (0.08 if off == 0 else 0.04), art=art)
        for part, tr, art in parts.get('stab', ()):
            for off in (1.0, 2.0, 4.0, 5.0, 7.0):
                ch = chords['odd'] if off < 4.0 else chords['even']
                for p in ch.split():
                    part.note(t + off, P(p) + tr, 0.5, vel=vel + 0.06, art=art, rearticulate=True)
        for part, tr, art in parts.get('tonic', ()):
            for off in (0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5):
                part.note(t + off, P(single) + tr, 0.5, vel=vel - 0.08, art=art)


def hold_dim(part, bar, low=0.3):
    """The stop bar's fade: the held note of the tune dies away to beat 3,
    where the trumpets' pickup comes back in forte."""
    t = part.score.bar(bar)
    part.expr_beats((t - 0.02, 1.0), (t + 0.3, 1.0), (t + 1.95, low), (t + 2.0, 1.0))


def _timp(p):
    """A bass pitch moved into the timpani's range (F2..F3)."""
    x = P(p)
    while x < P('F2'):
        x += 12
    while x > P('F3'):
        x -= 12
    return x


def build():
    s = Score('battle_elite_act4', tonic='Bb', bpm=164, intro_bars=4, loop_bars=48,
              title="The Emperor's Own", seed=409)
    s.reverb = dict(rt60=2.4, predelay_ms=24, wet_db=-0.5, damp=0.55)
    s.master = dict(lufs=-14.0, glue_ratio=1.6)
    b = Battle(s, calm_lufs=-17.0, full_lufs=-14.0)
    b.section('intro', 1, CH_CELL).section('A1', 5, CH_A).section('A2', 13, CH_A)
    b.section('B', 21, CH_B).section('build', 29, CH_BUILD).section('C', 33, CH_C)
    b.section('A3', 41, CH_A).section('turn', 49, CH_CELL)

    # ================================================================ the tune
    tpt = b.part('tpt', 'trumpets', layer='full', role='lead', art='vib', pan=0.1)
    tpt.at(5).play('@f' + TUNE)
    tpt.at(13).play('@f' + PICKUP)
    tpt.at(21).play('@f' + PICKUP_B)
    # the build's last bar: the trumpets' pickup (the Empire's half-step,
    # climbing: C, D-flat, E-flat) calls the standard, which alone lands
    # squarely on its downbeat (the strains' pickups tie into theirs)
    tpt.at(32).play('@ff rh C4q> Db4e Eb4e |' + STANDARD)
    tpt.at(41).play('@f' + TUNE)
    for bar in (8, 44):
        hold_dim(tpt, bar)
    # a second trumpet in unison, softer, on the plain samples: one lead with a halo
    halo = b.part('tpt_halo', 'trumpets', layer='full', role='lead2', gain=-5, pan=0.25,
                  humanize_ms=14)
    halo.at(5).play('@mf' + TUNE)
    halo.at(32).play('@f rh C4q> Db4e Eb4e |' + STANDARD)
    halo.at(41).play('@mf' + TUNE)
    for bar in (8, 44):
        hold_dim(halo, bar)

    vn = b.part('vn', 'violins', layer='full', role='lead', art='sus')
    vn.at(13).play('@f' + TUNE_HELD, transpose=12)
    vn.at(33).play('@f' + STANDARD, transpose=12)
    hold_dim(vn, 16)
    # A3: the descant, kept under the tune it floats over
    dsc = b.part('descant', 'violins', layer='full', role='lead2', art='sus', gain=-4)
    dsc.at(41).play('@mf' + DESCANT)
    hold_dim(dsc, 44)

    hn = b.part('hn', 'horns', layer='full', role='lead2')
    hn.at(13).play('@f' + TUNE_HELD, transpose=-12)
    hn.at(21).play('@ff' + TUNE_B)
    hn.at(33).play('@ff' + STANDARD, transpose=-12)
    hn.at(41).play('@mf' + TUNE_HELD, transpose=-12)
    for bar in (16, 24, 44):
        hold_dim(hn, bar)
    tbn = b.part('tbn', 'trombones', layer='full', role='lead2', pan=0.3)
    tbn.at(21).play('@f' + TUNE_B, transpose=-12)
    hold_dim(tbn, 24)

    # ================================================================ the hocket
    # bass on 1, 2.5, 4, 4.5 (tied over): bass guitar, contrabasses, tuba in A3
    eb = b.part('ebass', 'rbass', layer='full', role='bass', duck='kit_kick')
    cb = b.part('cb', 'basses', layer='full', role='low', art='spic')
    for sec, rows in (('A1', BASS_A), ('A2', BASS_A), ('B', BASS_B), ('A3', BASS_A)):
        tied = sec == 'A1'
        strain_bass(eb, b.bar(sec), BASS_B_EB if sec == 'B' else rows, vel=0.78, tied_in=tied)
        strain_bass(cb, b.bar(sec), rows, vel=0.72, tied_in=tied, art='spic')
    tuba = b.part('tuba', 'tuba', layer='full', role='low', art='stac')
    strain_bass(tuba, 41, BASS_A, vel=0.7, art='stac')

    # the stabs on 2 and 3.5: the snare's hits
    st_hn = b.part('stab_hn', 'horns', layer='full', role='section', art='stac', pan=-0.25)
    st_tbn = b.part('stab_tbn', 'trombones', layer='full', role='section', art='stac', pan=0.35)
    st_tpt = b.part('stab_tpt', 'trumpets', layer='full', role='section', art='stac', pan=0.3)
    st_str = b.part('stab_str', 'violas', layer='full', role='ostinato', art='spic')
    st_vc = b.part('stab_vc', 'celli', layer='full', role='ostinato', art='spic')
    for sec in ('A1', 'A2', 'A3'):
        stabs_at(st_hn, b.bar(sec), CH_A, STAB_HN, vel=0.72)
        stabs_at(st_tbn, b.bar(sec), CH_A, STAB_TBN, vel=0.72)
    stabs_at(st_tpt, 13, CH_A, STAB_HN, vel=0.66)
    # B: the horns and trombones sing, so the trumpets take the stabs
    stabs_at(st_tpt, 21, CH_B, STAB_HN, vel=0.68, transpose=B_SHIFT, rename=B_SYMBOL)
    lower = {k: ' '.join(v.split()[:2]) for k, v in STAB_STR.items()}
    upper = {k: ' '.join(v.split()[2:]) for k, v in STAB_STR.items()}
    for sec, ch in (('A1', CH_A), ('A2', CH_A), ('B', CH_B), ('A3', CH_A)):
        tr, ren = (B_SHIFT, B_SYMBOL) if sec == 'B' else (0, None)
        stabs_at(st_vc, b.bar(sec), ch, lower, vel=0.7, transpose=tr, rename=ren)
        stabs_at(st_str, b.bar(sec), ch, upper, vel=0.7, transpose=tr, rename=ren)

    # the stop bar's stamp: low brass and timpani on the downbeat, with the
    # bass's last eighth; then only the kit, the fading tune and the bugles'
    # pickup (the stabs leave with the bass: see the end of the build)
    stamp = b.part('stamp', 'trombones', layer='full', role='accent', art='stac', gain=3)
    timp = b.part('timp', 'timpani', role='timp', calm_db=-6)
    for bar, sym in ((8, 'Db/F'), (16, 'Db/F'), (24, 'Ab/C'), (44, 'Db/F')):
        for p in STAMP[sym].split():
            stamp.note(s.bar(bar), P(p), 0.5, vel=0.86, art='stac', rearticulate=True)
        if sym in STAMP_TUBA:
            tuba.note(s.bar(bar), P(STAMP_TUBA[sym]), 0.5, vel=0.86, art='stac')
        timp.note(s.bar(bar), _timp(STAMP[sym].split()[0]), 1.0, vel=0.9)

    # the violins' long chords under the trumpets (A1), swelling to each stop.
    # (In B the horns and their trombones fill that register; the shimmer
    # carries the harmony there.)
    lc = b.part('longch', 'violins2', layer='full', role='pad', art='sus')
    pad(lc, 5, CH_A_PAD, n=3, lo=60, hi=74, vel=0.5, art='sus')
    lc.expr((5, 0.55), (7.9, 1.0), (8.0, 0.6), (9, 0.55), (11.9, 1.0), (12.0, 0.7))
    lo_pad = b.part('lo_pad', 'celli', layer='full', role='pad', art='sus')
    for sec in ('A2', 'A3'):
        bass(lo_pad, b.bar(sec), CH_A, 'w', 'b', floor=43, vel=0.5, art='sus')
    # everything low leaves the stop bars with the bass
    stops = [s.bar(x) for x in (8, 16, 24, 44)]
    for n in lo_pad.notes:
        if any(abs(n.start - t0) < 1e-6 for t0 in stops):
            n.dur = 0.5

    # B: the shimmer, running eighths through the stab rests
    sh_vn = b.part('shim_vn2', 'violins2', layer='full', role='ostinato', art='spic', pan=-0.35)
    arp(sh_vn, 21, CH_B_PAD, '0 1 2 3 2 1 2 3', step=0.5, lo=69, hi=88, vel=0.55)
    sh_fl = b.part('shim_fl', 'flute', layer='full', role='accent', art='stac')
    arp(sh_fl, 21, CH_B_PAD, '2 1 2 3 4 3 2 3', step=0.5, lo=74, hi=93, vel=0.52)

    # ================================================================ the intro cell
    cvc = b.part('cell_vc', 'celli', layer='full', role='ostinato', art='spic')
    cva = b.part('cell_va', 'violas', layer='full', role='ostinato', art='spic')
    ctb = b.part('cell_tbn', 'trombones', layer='full', role='section', art='stac', gain=-3)
    for bar in (1, 49):
        cell(s, bar, 4, {'bass': [(eb, 0, None), (cb, 0, 'spic')],
                         'stab': [(cva, 0, 'spic')] + ([(ctb, 0, 'stac')] if bar == 49 else []),
                         'tonic': [(cvc, 0, 'spic')]}, into='Eb2')

    # ================================================================ build: 29-32
    # the intro's 3+3+2 in quarters over an F pedal (D-flat, G-flat), then the
    # same grouping in eighths, the strain's groove (B-flat minor, F7), under a
    # sixteenth surface: one unbroken crescendo, kept under the standard
    cell(s, 29, 2, {'bass': [(eb, 0, None), (cb, 0, 'spic'), (timp, 12, None)],
                    'stab': [(cva, 0, 'spic')], 'tonic': [(cvc, 0, 'spic')]},
         into='F1', vel=0.68, chords=('F3 Ab3 Db4', 'Gb3 Bb3 Db4'), low=('F1', 'F1'),
         single='F2')
    for part, art in ((eb, None), (cb, 'spic')):
        part.note(s.bar(31) + 1.5, P('Db2'), 1.5, vel=0.72, art=art)
        part.note(s.bar(31) + 3.0, P('F1'), 0.5, vel=0.72, art=art)
        part.note(s.bar(31) + 3.5, P('F1'), 2.0, vel=0.76, art=art)
        part.note(s.bar(32) + 1.5, P('C2'), 1.5, vel=0.76, art=art)
        part.note(s.bar(32) + 3.0, P('F1'), 1.0, vel=0.8, art=art)
    build_ch = chart('Bbm/F F7')
    stabs_at(st_hn, 31, build_ch, {'Bbm/F': 'Db4 F4 Bb4', 'F7': 'Eb4 A4 C5'}, vel=0.66)
    stabs_at(st_tbn, 31, build_ch, {'Bbm/F': 'F3 Db4', 'F7': 'F3 Eb4'}, vel=0.66)
    stabs_at(st_vc, 31, build_ch, {'Bbm/F': 'F3 Bb3', 'F7': 'F3 A3'}, vel=0.66)
    stabs_at(st_str, 31, build_ch, {'Bbm/F': 'Db4 F4', 'F7': 'C4 Eb4'}, vel=0.66)
    surf = b.part('surf_vn', 'violins', layer='full', role='ostinato', art='spic', pan=-0.2)
    sp = b.part('surf_pno', 'grand', layer='full', role='keys')
    for i, (c, bts) in enumerate(CH_BUILD[2:]):
        arp(surf, 31 + i, [(c, bts)], '0 1 2 3 1 2 3 4', step=0.25, lo=65 + 3 * i,
            hi=84 + 3 * i, vel=0.54 + 0.04 * i)
        arp(sp, 31 + i, [(c, bts)], '3 2 1 0 1 2 3 4', step=0.25, lo=55 + 2 * i, hi=79 + 2 * i,
            vel=0.46)
    for part, lo_ in ((surf, 0.5), (sp, 0.45)):
        part.expr((31, lo_), (32.95, 0.85), (33, 1.0))
    bh = b.part('build_hold', 'violas', layer='full', role='pad', art='sus')
    bhn = b.part('build_hn', 'horns', layer='full', role='pad')
    pad(bh, 29, CH_BUILD, n=3, lo=56, hi=70, vel=0.55)
    pad(bhn, 29, CH_BUILD, n=3, lo=53, hi=67, vel=0.5)
    bh.expr((29, 0.55), (32.95, 0.85), (33, 1.0))
    bhn.expr((29, 0.5), (32.95, 0.85), (33, 1.0))
    timp.at(31).play('%roll @p F2w~ | F2w |')
    timp.expr((30.97, 1.0), (31, 0.35), (32.95, 1.0), (33, 1.0))

    # ================================================================ C: the standard
    # the choir, one part per voice: the 'Choir Aahs' samples are out of tune by
    # zone, and a single line can be corrected note by note (a pitch bend per
    # note, render key_cents), a chord on one channel cannot
    tmp = s.part('_choir_voicing', 'choir')
    pad(tmp, 33, CH_C_PAD, n=4, lo=57, hi=77, vel=0.72)
    del s.parts['_choir_voicing']
    chords = {}
    for n in tmp.notes:
        chords.setdefault(round(n.start, 4), []).append(n)
    voices = [b.part(f'choir_{i}', 'choir', layer='full', role='choir', gain=-6,
                     key_cents=CHOIR_FIX) for i in range(4)]
    for start in sorted(chords):
        for v, n in zip(voices, sorted(chords[start], key=lambda n: n.pitch)):
            # (a voice that keeps its note across C4's mid-bar change holds it)
            prev = v.notes[-1] if v.notes else None
            if (prev and prev.pitch == n.pitch and abs(prev.end - n.start) < 1e-6
                    and not s.on_barline(n.start)):
                prev.dur += n.dur
                continue
            v.notes.append(n)
    for v in voices:
        v.expr((33, 0.8), (36.9, 0.95), (37, 0.9), (40.9, 1.0))
    c_bass = 'Bb1w | Gb1w | Eb2w | F1w | Bb1w | Gb1w | Cb2h.~ Cb2e Bb1e~ | Bb1h. rq |'
    for part in (eb, cb):
        part.at(33).play('%sus @f ' + c_bass)
    tuba.at(33).play('%default @f ' + c_bass)
    run = b.part('run_vn2', 'violins2', layer='full', role='ostinato', art='spic', pan=-0.35)
    arp(run, 33, CH_C_PAD, '0 1 2 3 2 1 2 3', step=0.5, lo=62, hi=81, vel=0.56)

    # ================================================================ drums
    b.kit = Kit(s, 'kit', gains={'kick': 0.5, 'snare': 1.5})
    b.full_only.update(b.kit.names())
    for k in (0, 2):
        b.kit.play(1 + k, CELL_A, vel=0.62)
        b.kit.play(2 + k, CELL_B, vel=0.76)
        b.kit.play(49 + k, CELL_A, vel=0.66)
        b.kit.play(50 + k, CELL_B, vel=0.78)
    for sec in ('A1', 'A2', 'B', 'A3'):
        start = b.bar(sec)
        grid, fill, stop = {'A1': (HOCKET, HOCKET_FILL, STOP), 'A2': (HOCKET, HOCKET_FILL, STOP),
                            'B': (HOCKET_RIDE, RIDE_FILL, STOP_RIDE),
                            'A3': (HOCKET_A3, HOCKET_FILL, STOP)}[sec]
        for i in range(8):
            b.kit.play(start + i, fill if i == 7 else stop if i == 3 else grid, vel=0.76)
        b.kit.play(start, {'crash': 'X'})
    b.kit.play(29, CELL_A, vel=0.64)
    b.kit.play(30, CELL_B, vel=0.7)
    b.kit.play(31, {'kick': 'x.o...x.o...x.x.', 'hat': 'x.x.x.x.x.x.x.x.'}, vel=0.7)
    b.kit.play(32, {'kick': 'x...x...x...x...', 'snare': 'o.o.o.o.xxxxXXXX'}, vel=0.84, ramp=0.5)
    # sixteenths while the standard is raised, eighths between
    for bar in range(33, 41):
        b.kit.play(bar, ROLL if bar in (33, 34, 37, 38) else ROLL8, vel=0.8)
    for bar in (33, 37):
        b.kit.play(bar, {'crash': 'X'})
    b.kit.play(40, {'snare': '....X.....x.xxXX'}, vel=0.82)

    b.sub('C')
    sub = b.part('sub', 'sub', layer='full', role='sub')
    for sec, rows in (('A1', BASS_A), ('A2', BASS_A), ('B', BASS_B), ('A3', BASS_A)):
        for i, (b1, _, _) in enumerate(rows):
            # the stop bar keeps only its downbeat
            sub.note(s.bar(b.bar(sec) + i), P(b1) - (12 if P(b1) > P('E2') else 0),
                     0.5 if i == 3 else 4.0, vel=0.6)

    # ================================================================ timpani and hits
    for bar in (1, 3, 49, 51):
        timp.at(bar).play('@f Bb2q rq rq Bb2q | rh Ab2q re Bb2e |')
    for sec in ('A1', 'A2'):
        bb = b.bar(sec)
        timp.at(bb).play('@f Eb3q rq rh |')
        timp.at(bb + 4).play('@f Gb2q rq rh |')
        timp.at(bb + 7).play('@f Bb2q rq F2q rq |')
    timp.at(21).play('@f Bb2q rq rh |')
    timp.at(25).play('@f Db3q rq rh |')
    timp.at(28).play('@f F2q rq C3q rq |')
    timp.at(33).play('@ff Bb2q rq rh | Gb2q rq rh | Eb3q rq rh | F2q rq F2q F2q |'
                     ' Bb2q rq rh | Gb2q rq rh | Cb3q rq rq. Bb2e | Bb2q rq F2q rq |')
    # A3: the timpani double the hocket's bass
    strain_bass(timp, 41, [tuple(_timp(p) if p else None for p in r) for r in BASS_A], vel=0.66)
    for bar in (5, 13, 21, 41):
        b.hit(bar, pieces=('crash', 'bd'))
    b.hit(33, pieces=('crash', 'bd', 'gong'), vel=0.9)
    b.hit(37, pieces=('crash', 'bd'))
    b.part('riser', 'riser', layer='full', role='fx').note(s.bar(31), 60, 8, vel=0.65)

    # the standard is the loudest music in the loop: the band that runs through
    # every strain (kit, bass, stabs) plays a little under it there
    under = 0.86
    for name in ('kit_kick', 'kit_snare', 'kit_cym', 'ebass', 'cb', 'stab_hn', 'stab_tbn',
                 'stab_tpt', 'stab_str', 'stab_vc'):
        s.parts[name].expr((1, under), (32.9, under), (33, 1.0), (40.9, 1.0), (41, under))

    # the bass guitar (Growlybass) has no samples below A1: its lower notes
    # would be silent, so they sound an octave up (the contrabasses keep the
    # low octave)
    for n in s.parts['ebass'].notes:
        if n.pitch < 33:
            n.pitch += 12
    # and the tuba's lowest samples (E1-G#1) drift by a third of a tone within
    # a note: its notes there move up an octave too
    for n in s.parts['tuba'].notes:
        if n.pitch < 33:
            n.pitch += 12

    # ================================================================ calm
    # the hocket from the walls: pizzicato basses on the bass's rhythm, harp
    # chords and a distant side drum on 2 and 3.5, a bass drum on one
    c_pz = b.part('c_pizz', 'basses', layer='calm', role='bass', art='pizz')
    c_vc = b.part('c_pizz_vc', 'celli', layer='calm', role='low', art='pizz')
    for sec, rows in (('A1', BASS_A), ('A2', BASS_A), ('B', BASS_B), ('A3', BASS_A)):
        strain_bass(c_pz, b.bar(sec), rows, vel=0.7, art='pizz', tied_in=sec == 'A1')
        strain_bass(c_vc, b.bar(sec), rows, vel=0.62, art='pizz', tied_in=sec == 'A1', octave=12)
    c_hp = b.part('c_harp', 'harp', layer='calm', role='keys')
    for sec, ch_, tr, ren in (('A1', CH_A, 0, None), ('A2', CH_A, 0, None),
                              ('B', CH_B, B_SHIFT, B_SYMBOL), ('A3', CH_A, 0, None)):
        stabs_at(c_hp, b.bar(sec), ch_, STAB_HN, vel=0.6, transpose=tr, rename=ren)
    c_cvc = b.part('c_cell_vc', 'celli', layer='calm', role='ostinato', art='pizz')
    for bar in (1, 49):
        cell(s, bar, 4, {'bass': [(c_pz, 0, 'pizz')], 'stab': [(c_hp, 12, None)],
                         'tonic': [(c_cvc, 0, 'pizz')]}, into='Eb2', vel=0.64)
    # the build, heard from the walls: the cell, then the groove
    cell(s, 29, 2, {'bass': [(c_pz, 0, 'pizz')], 'stab': [(c_hp, 12, None)],
                    'tonic': [(c_cvc, 0, 'pizz')]}, into='F1', vel=0.6,
         chords=('F3 Ab3 Db4', 'Gb3 Bb3 Db4'), low=('F1', 'F1'), single='F2')
    for bt, p, d in ((1.5, 'Db2', 1.5), (3.0, 'F1', 0.5), (3.5, 'F1', 2.0), (5.5, 'C2', 1.5),
                     (7.0, 'F1', 1.0)):
        c_pz.note(s.bar(31) + bt, P(p), d, vel=0.68, art='pizz')
    stabs_at(c_hp, 31, chart('Bbm/F F7'), {'Bbm/F': 'Db4 F4 Bb4', 'F7': 'Eb4 A4 C5'}, vel=0.56)
    # far off: dark, wet and a little under the harp
    c_dr = b.part('c_drum', 'orch_perc', layer='calm', role='accent', gain=-1.5, depth=0.95,
                  reverb=0.95, eq=[('highshelf', 3500, 0.7, -7.0), ('peak', 250, 1.0, 2.0)])
    for bar in list(range(5, 29)) + [31, 32] + list(range(41, 49)):
        drums(c_dr, bar, {'sn': '....x.....x.....', 'bd': 'x...............'}, vel=0.5)
    for bar in range(33, 41):
        drums(c_dr, bar, {'sn_roll': 'x...............', 'bd': 'x.......x.......'}, vel=0.4)
    for bar in (2, 4, 50, 52):
        drums(c_dr, bar, {'sn': '............x.x.'}, vel=0.45)
    c_pad = b.part('c_pad', 'violas', layer='calm', role='pad', art='soft')
    for sec, ch_ in (('A1', CH_A_PAD), ('A2', CH_A_PAD), ('B', CH_B_PAD), ('C', CH_C_PAD),
                     ('A3', CH_A_PAD)):
        pad(c_pad, b.bar(sec), ch_, n=2, lo=53, hi=67, vel=0.45, art='soft')
    c_hp2 = b.part('c_harp_surf', 'harp', layer='calm', role='keys')
    arp(c_hp2, 31, CH_BUILD[2:], '0 1 2 3 1 2 3 4', step=0.5, lo=55,
        hi=84, vel=0.5)
    c_low = b.part('c_low', 'celli', layer='calm', role='bass', art='soft', gain=-4)
    c_low.at(29).play('@mp F2w | F2w | F2w | F2w |')
    bass(c_low, 33, CH_C, 'w', 'b', floor=38, vel=0.5, art='soft')

    # the calm voices on the tune; a muted trumpet gives every pickup (VPO3
    # has no mute, so it plays the legacy muted trumpet: kept to the bugle
    # calls, the tune itself on the house instruments)
    lead = dict(layer='calm', role='lead', gain=-1.5)
    c_tpt = b.part('c_tpt', 'trumpets', art='mute', **lead)
    c_tpt.at(5).play('@mf' + PICKUP)
    c_tpt.at(13).play('@mf' + PICKUP)
    c_tpt.at(21).play('@mf' + PICKUP_B)
    c_tpt.at(32).play('@mf rh C4q> Db4e Eb4e |')
    c_tpt.at(41).play('@mf' + PICKUP)
    c_ob = b.part('c_ob', 'oboe', **lead)
    c_ob.at(5).play('@mf' + TUNE_HELD)
    hold_dim(c_ob, 8, low=0.45)
    c_cl = b.part('c_cl', 'clarinet', **lead)
    c_cl.at(13).play('@mf' + TUNE_HELD)
    c_cl.at(33).play('@mf' + STANDARD_BR)
    hold_dim(c_cl, 16, low=0.45)
    c_hn = b.part('c_hn', 'horns', **lead)
    c_hn.at(21).play('@mp' + TUNE_B)
    hold_dim(c_hn, 24, low=0.45)
    # the standard, far off: a soft horn an octave under the clarinet
    c_hn2 = b.part('c_hn_std', 'horns', layer='calm', role='lead2', gain=-3)
    c_hn2.at(33).play('@p' + STANDARD_BR, transpose=-12)
    c_sv = b.part('c_sv', 'solo_violin', art='soft', **lead)
    c_sv.at(41).play('@mf' + TUNE_HELD)
    hold_dim(c_sv, 44, low=0.45)

    # ================================================================ the stop bars stop
    # after the stamp only the kit, the fading held note and the bugles'
    # pickup: the stabs (and B's shimmer, and the calm harp) leave with the
    # bass, and the chords held into the bar let go on its first eighth
    for x in (8, 16, 24, 44):
        a, z = s.bar(x) - 1e-6, s.bar(x + 1) - 1e-6
        for name in ('stab_hn', 'stab_tbn', 'stab_tpt', 'stab_str', 'stab_vc', 'shim_vn2',
                     'shim_fl', 'c_harp'):
            s.parts[name].notes[:] = [n for n in s.parts[name].notes if not a <= n.start < z]
        for name in ('longch', 'c_pad'):
            for n in s.parts[name].notes:
                if a <= n.start < z:
                    n.dur = min(n.dur, 0.5)
    return b.finish()
