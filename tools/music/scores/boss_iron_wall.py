"""Iron Wall — "The Order That Never Came".

The Act III boss, the Holder of the Breach. He held the breach at the old
capital until the order to fall back rotted unread in a courier's bag, and
the Empire made his stand its doctrine. "None have breached these walls.
None ever will." 112 bpm, 4/4, D-flat minor (written as C-sharp minor),
Phrygian over the floor: a low brass tune and a hammering chant over a fast
sawing surface that never leaves its note.

Mechanism: THE PEDAL THAT WILL NOT MOVE. One low C-sharp holds under the
whole loop (contrabasses, the organ's pedal, the sub; the tuba in the last
strain), and the celli and violas saw it, straight eighths in A and
sixteenths after, hammering the C-sharp and pricking it late in each group
with its neighbours (the Phrygian D above, E, the B-sharp below). Every
chord is built on it and grinds against it (the Neapolitan D minor a minor
ninth up, A minor, A-sharp diminished, G minor a tritone away). The tune
walks in the march's step, a half and two quarters, low in the horns and
trombones: three two-bar cells down the tonic triad, G-sharp, E, C-sharp,
each struck twice with the semitone above pressing on it, then a fall of a
tritone, to D, A-sharp and G; it ends on the G, unresolved, and the wall
answers it.

The order: at the end of every strain a distant open trumpet (far right,
all hall, its top and bottom rolled away) sounds the order to fall back, a
bugle call on F-sharp minor, the key a fifth below: the bass told to move.
Each time the wall comes down on it, a dissonant stab (tuba and trombones on
C-sharp with the tritone G, horns on D and G-sharp, a trumpet cluster C-sharp
D, timpani, gong, bass drum, tremolo violas) and the note the call was about
to sound is swallowed under the hit. It is cut sooner every strain: five
notes heard, then four, then three, then two.

Form (bars): intro 1-4 (the card: C-sharp and G-sharp in the trombones, the
leading tone B-sharp leans and fails; a gong scrape; the saw begins; the
tune's first step in the low horns; the first wall) | A 5-12 (the tune in
the low horns and trombones, the second violins holding the chords far
above; half-time kit, taiko, the orchestra's bass drum; the call at 11, the
wall at 12) | B 13-20 (the chant: the men of the choir, doubled by the
horns, hammer the fifth of chords a third apart (C-sharp, A, E minor), then
the semitone above, and fall through G and D minor to the dominant's minor
ninth; trombones and horns stab the chords in the march's step, taiko, an
anvil; call at 19, wall at 20) | C 21-28 (the hammer: no progression, the
tune's cell beaten flat, C-sharp struck, the D above held against it, the
tritone G below, in horns, trombones, celli and tuba, louder each pair of
bars; the choir holds the wall's own chord, C-sharp, D and G; trumpets
stab the cluster C-sharp D off the beat, the violins tremble on C-sharp and
D at the top, the saw turns to a tremolo scrape; irregular taiko and anvil;
call at 27, wall at 28) | D 29-32 (near silence, no tune: the pedal, a
timpani heartbeat, men's oohs on the tritone C-sharp G, violas trembling on
C-sharp and D, the trombones breathing the same cluster, closer each bar,
the G joining in the last; a roll into) | A2 33-40 (the tune with everyone:
horns, trombones, celli and the men of the choir on it, the rest of the
choir chanting the chords, the tuba on the pedal; the call barely begun at
39, the wall at 40, into A). Loop 5-40, 36 bars.

Enrage ("then I am the wall. Come and break against ME"): the wall stops
waiting for the order, which is never heard at all. Its blows (trombones on
C-sharp and G, the tuba and the orchestra's bass drum on the heavy ones,
taiko on every one) take the place of the taiko and bass drum and land in
every bar, cut to what the band is doing there: against the tune's long
notes in A, in the chant's step in B, with and against the hammer in C,
growing from a heartbeat in the quiet strain to a full bar of blows into
A2. The horns' D and the men shouting C-sharp and G-sharp join only where no
tune sits in their register: the call bars and the quiet strain.
"""

from engine.instruments import INSTRUMENTS
from engine.patterns import Kit, chart, drums, pad
from engine.score import Score
from engine.theory import pitch

from scores._battle import Battle

KEY = 'music_boss_iron_wall'

# ------------------------------------------------------------------ material
# A: the tune (bars 5-10). Two-bar cells down the tonic triad, in the march's
# step (a half, two quarters): a note struck twice, the semitone above pressing
# on it, the note, a fall of a tritone; it ends on the G.
TUNE_A = """
G#4h G#4q A4q | G#4h D4h | E4h E4q F4q | E4h A#3h |
C#4h C#4q D4q | C#4h G3h |
"""
# B: the chant (bars 13-18): the fifth of each chord hammered, then the semitone above
TUNE_B = """
G#3q G#3q G#3e G#3e A3q | E3q E3q E3e E3e F3q | B3q B3q B3e B3e C4q |
Bb3q Bb3q A3q A3q | F3q F3q E3e E3e D3q | D#3q D#3q F#3q A3q |
"""
# C: the hammer (bars 21-26), the tune's cell beaten flat: the C-sharp struck,
# then the semitone above held against it, then the tritone below
RIFF_C = 'C#4q C#4e C#4e D4h | C#4q C#4e C#4e G3h |'

CH_A_TXT = 'C#m Dm/C# Am/C# A#dim7/C# F#m/C# Gm/C# C#5 C#5'
CH_B_TXT = 'C#m Am/C# Em/C# Gm/C# Dm/C# G#7b9/C# C#5 C#5'
# (C has no progression: the hammer beats against the wall's own chord, held)
CH_C_TXT = 'C#m C#m C#m C#m C#m C#m C#5 C#5'
CH_D_TXT = 'C#m Dm/C# Am/C# A#dim7/C#'

INTRO, A1, B1, C1, D1, A2 = 1, 5, 13, 21, 29, 33
END = 41                                          # first bar after the loop
WALLS = (4, 12, 20, 28, 40)                       # the wall comes down on beat 1
CALL_BARS = (11, 19, 27, 39)                      # the band holds its breath
# the order to fall back, (onset, pitch, beats): a bugle call on F-sharp minor
CALL = ((0.0, 'C#5', 0.75), (0.75, 'C#5', 0.25), (1.0, 'C#5', 1.0), (2.0, 'A4', 1.0),
        (3.0, 'F#4', 1.0), (4.0, 'C#4', 1.5), (5.5, 'A3', 0.5), (6.0, 'F#3', 2.0))
# (wall bar, notes heard before it lands)
CALLS = ((12, 5), (20, 4), (28, 3), (40, 2))

# drum grids, 16 steps a bar
HALF = {'kick': 'x.....x...x.....', 'snare': '........X.......',
        'tom_floor': 'x.......x.....o.'}
HALF2 = {'kick': 'x.....x...x...x.', 'snare': '........X.....o.',
         'tom_floor': 'x...x...x...x.x.'}
CHANT = {'kick': 'x.......x...x...', 'snare': '....X.......X...', 'tom_floor': '......o.......o.'}
CHANT_FILL = {'kick': 'x.......x...x...', 'snare': '....X.......XxXX'}
CALL_BAR = {'kick': 'x...............', 'hat_pedal': '..x...x...x...x.'}
WALL_BAR = {'kick': 'x...............', 'crash': 'X...............',
            'tom_hi': '............x...', 'tom_mid': '.............x..',
            'tom_floor': '..............xx'}
# the march's step over a bar, a half and two quarters: (onset, beats) of each blow
CUT = ((0.0, 2.0), (2.0, 1.0), (3.0, 1.0))


def _breathe(part, bars, lo=0.8):
    """A brass player's breath: each bar leans in and swells, then eases."""
    for bar in bars:
        part.expr((bar, lo), (bar + 0.4, 1.0), (bar + 0.97, 0.9))


def _chant(ch):
    """Each 4-beat chord re-struck in the march's step."""
    out = []
    for c, beats in ch:
        if beats == 4.0:
            out += [(c, d) for _, d in CUT]
        else:
            out.append((c, beats))
    return out


def call(part, hit_bar, heard, s):
    """The order: `heard` notes, then the one the wall swallows (under the hit)."""
    hit = s.bar(hit_bar)
    start = hit - CALL[heard][0]
    for onset, p, dur in CALL[:heard]:
        part.note(start + onset, p, dur, vel=0.58 if onset else 0.64, rearticulate=True)
    onset, p, _ = CALL[heard]
    part.note(start + onset, p, 0.35, vel=0.3, rearticulate=True)


def saw(parts, bar, top, vel, step, art='spic'):
    """One bar of the saw on the pedal, straight `step`s (eighths, or
    sixteenths), the C-sharp hammered and pricked late in each group by its
    neighbours. `top`: three neighbours in semitones from the C-sharp (D is 1)."""
    t0 = parts[0][0].score.bar(bar)
    groups = ((0, 0, 0, 0, 0, 0, top[0], 0), (0, 0, 0, 0, top[1], 0, top[2], 0))
    n = int(round(4.0 / step))
    for i in range(n):
        k = i % 8
        seq = groups[(i // 8 + (bar if n == 8 else 0)) % 2]
        acc = k in (0, 4)
        for part, base, dv in parts:
            p = base + seq[k]
            lo = INSTRUMENTS[part.inst]['range'][0]
            v = min(1.0, vel + dv + (0.14 if acc else 0.0) - (0.03 if i >= 8 else 0.0))
            part.note(t0 + step * i, p + 12 if p < lo else p, step, vel=v, art=art)


def build():
    s = Score('boss_iron_wall', tonic='Db', bpm=112, intro_bars=4, loop_bars=36,
              title='The Order That Never Came', seed=619)
    # a fortress hall, dark: the low mids crowd (the saw, low brass, the pedal)
    s.reverb = dict(rt60=3.0, predelay_ms=30, wet_db=-2.0, damp=0.6)
    s.master = dict(lufs=-13.5, glue_ratio=1.6, eq=[('peak', 250, 0.8, -3.0),
                                                    ('peak', 450, 1.2, -1.5),
                                                    ('peak', 2500, 1.0, 1.5),
                                                    ('highshelf', 8000, 0.7, -0.5)])
    b = Battle(s, full_lufs=-13.5, adaptive=False)
    CH_A, CH_B, CH_C, CH_D = (chart(t) for t in (CH_A_TXT, CH_B_TXT, CH_C_TXT, CH_D_TXT))
    b.section('intro', INTRO, chart('C#5 C#5 C#5 C#5')).section('A1', A1, CH_A)
    b.section('B1', B1, CH_B).section('C1', C1, CH_C).section('D1', D1, CH_D)
    b.section('A2', A2, CH_A)

    # ================================================================ the pedal
    cb = b.part('ped_cb', 'basses', role='low', art='sus', gain=1)
    org_ped = b.part('ped_org', 'organ', role='low', gain=-10, hpf=30)
    sub = b.part('ped_sub', 'sub', role='sub', gain=-3)
    loud = set(range(C1, D1)) | set(range(A2, END))
    for bar in range(INTRO, END):
        t = s.bar(bar)
        quiet = D1 <= bar < A2 or bar < 3
        v = 0.5 if quiet else (0.74 if bar in loud else 0.66)
        cb.note(t, 'C#1', 4.0, vel=v, art='sus', rearticulate=True)
        org_ped.note(t, 'C#2', 4.0, vel=0.6, art='loud' if bar in loud else 'default',
                     rearticulate=True)
        if not quiet:
            sub.note(t, 'C#1', 4.0, vel=0.6)
    cb.expr((INTRO, 0.35), (INTRO + 1.9, 1.0), (A1, 1.0))
    tuba = b.part('ped_tuba', 'tuba', role='low', gain=-2)
    for bar in range(A2, END):
        if bar not in WALLS:
            tuba.note(s.bar(bar), 'C#2', 4.0, vel=0.66, rearticulate=True)

    # the saw: celli on C#2, violas an octave up (and basses below in C)
    saw_vc = b.part('saw_vc', 'celli', role='ostinato', art='spic', gain=1,
                    eq=[('peak', 180, 1.0, -1.5)])
    saw_va = b.part('saw_va', 'violas', role='ostinato', art='spic', gain=-2)
    saw_cb = b.part('saw_cb', 'basses', role='ostinato', art='spic', gain=-3)
    c2 = pitch('C#2')
    pair = [(saw_vc, c2, 0.0), (saw_va, c2 + 12, -0.06)]
    clear = [(saw_vc, c2, 0.0), (saw_va, c2 + 24, -0.08)]     # the violas out of the tune's way
    saw(pair, 3, (1, 1, 3), 0.54, 0.5, art='stac')
    # C: the saw stops and scrapes, a tremolo on the pedal and the D above it
    for k in range(6):
        t = s.bar(C1 + k)
        saw_vc.note(t, c2, 4.0, vel=0.7, art='trem', rearticulate=True)
        saw_cb.note(t, c2 - 12, 4.0, vel=0.66, art='trem', rearticulate=True)
        saw_va.note(t, c2 + 12, 4.0, vel=0.62, art='trem', rearticulate=True)
        saw_va.note(t, c2 + 13, 4.0, vel=0.6, art='trem', rearticulate=True)
    saw_vc.expr((C1, 0.7), (C1 + 5.95, 1.0), (C1 + 6, 1.0))
    saw_va.expr((C1, 0.7), (C1 + 5.95, 1.0), (C1 + 6, 1.0))
    for k in range(6):
        saw(clear, A1 + k, (1, 1, 3), 0.58, 0.5, art='stac')        # eighths: D, D, E
        saw(pair, B1 + k, (1, 1, -1) if k < 3 else (1, 1, 1), 0.58, 0.25)
        saw(clear, A2 + k, (1, 1, 3), 0.62, 0.25)

    # ================================================================ the intro: the card
    tbn_i = b.part('card_tbn', 'trombones', role='section', gain=1)
    tbn_i.at(INTRO).play('@f [C#3 G#3]w | [B#2 G#3]h [C#3 G#3]h |')
    tbn_i.expr((INTRO, 0.6), (INTRO + 0.9, 1.0))
    hn_card = b.part('card_hn', 'horns', role='section')
    hn_card.at(INTRO).play('@mf G#3w | G#3w |')

    # ================================================================ the tune
    hn = b.part('lead_hn', 'horns', role='lead', gain=2, depth=0.4,
                eq=[('peak', 320, 1.0, -2.0), ('peak', 1600, 1.0, 3.0)])
    hn.at(3).play('@f G#2h G#2q A2q | rw |')                         # the first step
    hn.at(A1).play('@ff ' + TUNE_A + ' rw |', transpose=-12)          # low, with the trombones
    hn.at(B1).play('@mf ' + TUNE_B + ' G#3q rq rh |')                 # with the men
    hn.at(A2).play('@fff ' + TUNE_A + ' rw |', transpose=-12)
    hn.at(C1).play('@f ' + RIFF_C + ' @ff ' + RIFF_C + ' @fff ' + RIFF_C + ' rw |')
    _breathe(hn, list(range(A1, A1 + 6)) + list(range(C1, C1 + 6)) + list(range(A2, A2 + 6)))

    # the tune's doubling: trombones in A, C and A2, celli in C and A2
    low_t = b.part('tune_vc', 'celli', role='lead2', art='sus', gain=-1)
    low_t.at(A2).play('%sus @ff ' + TUNE_A + ' rw |', transpose=-12)
    tbn_t = b.part('tune_tbn', 'trombones', role='lead2', gain=-1)
    tbn_t.at(A1).play('@ff ' + TUNE_A + ' rw |', transpose=-12)
    tbn_t.at(A2).play('@fff ' + TUNE_A + ' rw |', transpose=-12)
    _breathe(tbn_t, range(A1, A1 + 6))
    tbn_t.at(C1).play('@f ' + RIFF_C + ' @ff ' + RIFF_C + ' @fff ' + RIFF_C, transpose=-12)
    low_t.at(C1).play('%sus @f ' + RIFF_C + ' @ff ' + RIFF_C + ' @ff ' + RIFF_C,
                      transpose=-12)
    tuba.at(C1).play('@f ' + RIFF_C + ' @ff ' + RIFF_C + ' @ff ' + RIFF_C, transpose=-24)
    _breathe(tbn_t, list(range(C1, C1 + 6)) + list(range(A2, A2 + 6)))

    # ================================================================ the chant
    men = b.part('chant', 'choir', role='lead2', gain=4, eq=[('highshelf', 5000, 0.7, -3.0)])
    men.at(B1).play('@f ' + TUNE_B + ' G#3q rq rh |')
    men.at(A2).play('@f ' + TUNE_A + ' rw |', transpose=-12)        # the men take up the tune
    # C: the choir holds the wall's own chord (C-sharp, D, G) under the hammer;
    # in A2 it chants the chords in the march's step
    choir = b.part('choir', 'choir', role='choir', gain=-2, eq=[('highshelf', 5000, 0.7, -3.0)])
    for k in range(6):
        t = s.bar(C1 + k)
        for p in ('C#3', 'D3', 'G3', 'C#4'):
            choir.note(t, p, 4.0, vel=0.66 + 0.02 * k, rearticulate=True)
    pad(choir, A2, _chant(CH_A[:-2]), n=4, lo=47, hi=66, vel=0.66, legato_gap=0.12)

    # ================================================================ the order
    # off stage: far right, nearly all hall, its top and bottom rolled away
    order = b.part('order', 'trumpets', role='counter', pan=0.6, depth=1.0, reverb=1.4,
                   gain=-1, hpf=260, eq=[('highshelf', 3500, 0.7, -10.0),
                                         ('lowpass', 6000, 0.7, 0), ('peak', 1100, 1.0, 2.0)])
    for hit_bar, heard in CALLS:
        call(order, hit_bar, heard, s)

    # ================================================================ the wall
    w_tbn = b.part('wall_tbn', 'trombones', role='section', gain=3)
    w_tuba = b.part('wall_tuba', 'tuba', role='low', gain=2)
    w_hn = b.part('wall_hn', 'horns', role='section', gain=1)
    w_tpt = b.part('wall_tpt', 'trumpets', role='section', gain=-3)
    w_timp = b.part('wall_timp', 'timpani', role='timp', gain=2)
    w_perc = b.part('wall_perc', 'orch_perc', role='accent', gain=3)
    for bar in WALLS:
        dyn = '@f' if bar == 4 else '@ff'
        w_tbn.at(bar).play(dyn + ' [C#3 G3 C#4]h.> rq |')
        w_tuba.at(bar).play(dyn + ' C#2h.> rq |')
        w_hn.at(bar).play(dyn + ' [D4 G#4]h.> rq |')
        if bar != 4:
            w_tpt.at(bar).play(dyn + ' [C#5 D5]q> rq rh |')
        w_timp.at(bar).play(dyn + ' C#2q> rq rq C#2e C#2e |')
        drums(w_perc, bar, {'bd': 'X', 'gong': 'x', 'crash': 'x'}, step=4.0, vel=0.82)
    ring = b.part('ring', 'violas', role='pad', art='trem', gain=-2)
    for bar in WALLS:
        ring.at(bar).play('@f [C#4 G4 C#5]h. rq |')
    scrape = b.part('scrape', 'orch_perc', role='accent', gain=-2)
    drums(scrape, INTRO, {'gong_scrape': 'x'}, step=4.0, vel=0.6)
    drums(scrape, D1, {'gong_scrape': 'x'}, step=4.0, vel=0.55)

    # ================================================================ harmony over the floor
    # A: the second violins hold the chords above the low tune; D: men's oohs on the tritone
    hold = b.part('hold', 'violins2', role='pad', art='sus', gain=-6)
    pad(hold, A1, CH_A[:-2], n=3, lo=60, hi=74, vel=0.5, art='sus')
    pad(hold, A2, CH_A[:-2], n=3, lo=62, hi=76, vel=0.56, art='sus')
    oohs = b.part('oohs', 'oohs', role='choir', gain=-5)
    oohs.at(D1).play('@mp [C#3 G3]w | [C#3 G3]w | [C#3 G3]w | [C#3 G3]w |')
    # B and C: low brass stab the chords with the chant, in the march's step
    stab = b.part('stab', 'trombones', role='section', art='stac', gain=-1,
                  eq=[('peak', 300, 1.0, -2.0)])
    pad(stab, B1, _chant(CH_B[:6]), n=3, lo=48, hi=60, vel=0.7, art='stac')
    hn_stab = b.part('hn_stab', 'horns', role='section', art='stac', gain=-4)
    pad(hn_stab, B1, _chant(CH_B[:6]), n=2, lo=55, hi=67, vel=0.6, art='stac')
    tpt_stab = b.part('tpt_stab', 'trumpets', role='section', art='stac', gain=-6)
    for k in range(6):                          # the cluster C-sharp D, off the beat
        t = s.bar(C1 + k) + (3.5 if k % 2 else 2.5)
        tpt_stab.note(t, 'C#4', 0.4, vel=0.76, art='stac')
        tpt_stab.note(t, 'D4', 0.4, vel=0.7, art='stac')
    # violins tremble high on a minor second through the hammer
    trem = b.part('trem', 'violins', role='pad', art='trem', gain=-7)
    for bar in range(C1, C1 + 6):
        trem.at(bar).play('@mf [C#6 D6]w |')
    trem.expr((C1, 0.55), (C1 + 5.9, 1.0))
    # D: the violas tremble on the pedal and its neighbour; a low bell
    trem_lo = b.part('trem_lo', 'violas', role='pad', art='trem', gain=-6)
    trem_lo.at(D1).play('@p [C#4 D4]w | [C#4 D4]w | [C#4 D4]w | [C#4 D4]w |')
    trem_lo.expr((D1, 0.5), (D1 + 3, 0.8), (D1 + 3.97, 1.0))
    # and the low brass breathe on the pedal and its D, closer each bar
    dread = b.part('dread', 'trombones', role='section', gain=-3, eq=[('peak', 300, 1.0, -2.0)])
    dread.at(D1).play('@mp [C#3 D3]w | [C#3 D3]w | [C#3 D3]w | [C#3 D3 G3]w |')
    dread.expr((D1, 0.35), (D1 + 2, 0.6), (D1 + 3.97, 1.0))

    # ================================================================ drums
    kit = Kit(s, 'kit', gains={'cym': -8})
    b.kit = kit
    b.full_only.update(kit.names())
    kit.play(3, HALF, vel=0.68)
    for bar in range(A1, A1 + 6):
        kit.play(bar, HALF, vel=0.72)
    for i, bar in enumerate(range(B1, B1 + 6)):
        kit.play(bar, CHANT_FILL if i == 5 else CHANT, vel=0.74)
    kit.play(C1 + 5, {'snare': '............XxXX', 'tom_floor': '..............xx'}, vel=0.76)
    for bar in range(A2, A2 + 6):
        kit.play(bar, HALF2, vel=0.78)
    for bar in CALL_BARS:
        kit.play(bar, CALL_BAR, vel=0.6)
    for bar in WALLS:
        kit.play(bar, WALL_BAR, vel=0.8)
    for bar in (B1, C1):
        kit.play(bar, {'crash': 'X'}, vel=0.7)

    # the weight: taiko and the orchestra's bass drum under every strain
    taiko = b.part('taiko', 'taiko', role='drums', gain=3)
    for i, bar in enumerate(range(A1, A1 + 6)):
        taiko.at(bar).play('@f C#2q rq C#2q rq |' if i % 2 == 0 else
                           '@f C#2q rq C#2q C#2e C#2e |')
    for bar in range(B1, B1 + 6):
        taiko.at(bar).play('@f C#2h C#2q C#2q |')
    for i, bar in enumerate(range(C1, C1 + 6)):                  # blows that will not settle
        taiko.at(bar).play(('@ff C#2q. C#2e rq C#2q |', '@ff C#2q rq C#2e C#2e C#2q |',
                            '@ff C#2h rq C#2e C#2e |', '@ff C#2q. C#2e C#2q. C#2e |')[i % 4])
    for i, bar in enumerate(range(A2, A2 + 6)):
        taiko.at(bar).play('@ff C#2q rq C#2q rq |' if i % 2 == 0 else
                           '@ff C#2q C#2q C#2q C#2e C#2e |')
    bd = b.part('bd', 'orch_perc', role='accent', gain=2)
    for sec in (A1, B1, C1, A2):
        for bar in range(sec, sec + 6):
            drums(bd, bar, {'bd': 'X.......x.......'}, vel=0.7)
    # iron struck: the anvil on the chant's last blow, then where it is not expected
    anvil = b.part('anvil', 'orch_perc', role='accent', gain=-5)
    for bar in range(B1, B1 + 6):
        drums(anvil, bar, {'anvil': '............x...'}, vel=0.55)
    for i, bar in enumerate(list(range(C1, C1 + 6)) + list(range(A2, A2 + 6))):
        drums(anvil, bar, {'anvil': ('......x.........', '..........x.....',
                                     '...x............', '..............x.')[i % 4]}, vel=0.55)

    timp = b.part('timp', 'timpani', role='timp')
    timp.at(INTRO + 1).play('%default @f C#2q rq C#2q rq |')
    timp.at(3).play('%default @f C#2q rq C#2q rq |')
    for bar in range(A1, A1 + 6):
        timp.at(bar).play('%default @f C#2q rq C#2q C#2e C#2e |')
    for bar in CALL_BARS:
        timp.at(bar).play('%default @mf C#2q rq rh |')
    for bar in range(B1, B1 + 6):
        timp.at(bar).play('%default @f C#2h C#2q C#2q |')
    for bar in range(C1, C1 + 6):
        timp.at(bar).play('%default @ff C#2q rq rq C#2q |')
    roll = b.part('timp_roll', 'timpani', role='timp', gain=-1)
    roll.at(INTRO).play('%roll @mf C#2w |')
    for bar in range(D1, D1 + 3):
        timp.at(bar).play('%default @mp C#2q C#2e. rs rh |')          # the heartbeat
    roll.at(D1 + 3).play('%roll @mf C#2w |')
    for bar in range(A2, A2 + 6):
        timp.at(bar).play('%default @ff C#2q rq C#2q C#2e C#2e |')
    roll.expr((INTRO, 0.4), (INTRO + 0.95, 1.0), (D1 + 3, 0.35), (D1 + 3.97, 1.0))

    perc = b.part('perc', 'orch_perc', role='accent', gain=-2)
    for bar in range(D1, D1 + 3):
        drums(perc, bar, {'bd': 'x.......x.......'}, vel=0.6)
    drums(perc, D1 + 3, {'swell_m': 'x'}, vel=0.65)
    snr = b.part('snare_roll', 'orch_perc', role='accent', gain=-3)
    drums(snr, D1 + 3, {'sn': 'oooooooxxxxxXXXX'}, vel=0.6, ramp=0.5)

    # ================================================================ enrage: then I am the wall
    _enrage(b, s)
    return b.finish()


# the wall's blows in each bar, (onset, beats, weight), shaped to what the
# band is doing there: X full, x lighter, o a ghost
_BLOWS = {
    'A': (((0, 1.5, 'X'), (2.5, 0.5, 'x'), (3, 1, 'x')),        # the held note
          ((0, 1, 'X'), (2, 2, 'X'))),                         # with the tritone fall
    'B': (((0, 2, 'X'), (2, 1, 'x'), (3, 1, 'X')),              # the chant's step
          ((0, 2, 'X'), (2, 1, 'x'), (3, 0.5, 'x'), (3.5, 0.5, 'x'))),
    'C': (((0, 1, 'X'), (2, 1.5, 'X'), (3.5, 0.5, 'x')),        # with the hammer, and
          ((0, 1, 'X'), (1.5, 0.5, 'x'), (2, 2, 'X'))),         # against it
    'call': (((0, 1, 'X'), (3.5, 0.5, 'x')),),                 # the breath, then on
    'D': (((0, 1, 'x'), (0.75, 0.5, 'o')),),                   # a heartbeat, growing
    'D_last': (((0, 1, 'X'), (2, 1, 'x'), (3, 0.5, 'x'), (3.5, 0.5, 'X')),),
    'A2': (((0, 1.5, 'X'), (2.5, 0.5, 'x'), (3, 0.5, 'x'), (3.5, 0.5, 'x')),
           ((0, 1, 'X'), (2, 1.5, 'X'), (3.5, 0.5, 'x'))),
}


def _blows_for(bar):
    """(blows, base velocity) for one bar of the loop, or None on a wall."""
    if bar in WALLS:
        return None
    if bar in CALL_BARS:
        return _BLOWS['call'][0], 0.86
    k = (bar - A1) % 2
    if bar < B1:
        return _BLOWS['A'][k], 0.74
    if bar < C1:
        return _BLOWS['B'][k], 0.74
    if bar < D1:
        return _BLOWS['C'][k], 0.78 + 0.03 * (bar - C1)
    if bar < A2:
        if bar == A2 - 1:
            return _BLOWS['D_last'][0], 0.82
        return _BLOWS['D'][0], 0.5 + 0.1 * (bar - D1)
    return _BLOWS['A2'][k], 0.86


def _enrage(b, s):
    """The wall stops waiting for the order: it strikes in every bar; the call is gone."""
    v = 'enrage_iron_wall'
    # its blows take the place of the taiko and bass drum, and of the order
    b.extra_variant(v, mute=('order', 'taiko', 'bd'))
    tbn = b.extra(v, 'iw_tbn', 'trombones', role='section', gain=0,
                  eq=[('peak', 250, 1.0, -3.0), ('peak', 700, 1.0, -3.0)])
    tuba = b.extra(v, 'iw_tuba', 'tuba', role='low', gain=-1)
    hn = b.extra(v, 'iw_hn', 'horns', role='section', gain=-2)
    men = b.extra(v, 'iw_men', 'choir', role='choir', gain=-1)
    taiko = b.extra(v, 'iw_taiko', 'taiko', role='drums', gain=2)
    bd = b.extra(v, 'iw_bd', 'orch_perc', role='accent', gain=0)
    weight = {'X': 0.0, 'x': -0.12, 'o': -0.25}
    # the voices and the horns' D only where no tune sits in their register:
    # in the call's bars and the quiet strain
    voiced = set(CALL_BARS) | set(range(D1, A2))
    for bar in range(A1, END):
        got = _blows_for(bar)
        if got is None:
            continue
        blows, base = got
        t0 = s.bar(bar)
        for i, (on, dur, w) in enumerate(blows):
            lean = ((bar * 7 + i * 3) % 5 - 2) * 0.015      # no two blows quite alike
            vv = max(0.2, min(1.0, base + weight[w] + lean))
            d = max(0.35, dur * 0.8)
            taiko.note(t0 + on, 'C#2', 0.5, vel=vv)
            if w == 'o':
                continue
            tbn.note(t0 + on, 'C#3', d, vel=vv, rearticulate=True)
            tbn.note(t0 + on, 'G3', d, vel=vv - 0.04, rearticulate=True)
            if w == 'X':
                tuba.note(t0 + on, 'C#2', d, vel=vv, rearticulate=True)
                bd.note(t0 + on, 36, 1.0, vel=min(1.0, vv - 0.05))
            if dur >= 1.0 and bar in voiced:
                hn.note(t0 + on, 'D4', d, vel=vv - 0.08, rearticulate=True)
                men.note(t0 + on, 'C#3', d, vel=vv - 0.1, rearticulate=True)
                men.note(t0 + on, 'G#3', d, vel=vv - 0.14, rearticulate=True)
