"""Escape battles, second theme — "We Came This Far Also".

Carved into the old kings' stair under the Seat, in the oldest hand: WE CAME
THIS FAR ALSO. Every thread climbs, and every thread gets this far. The
escape maps are a climb that has no top: the exit is always one more rise
away and the waves behind never stop. So the piece climbs forever.

The mechanism: an endless climb (a Shepard-Risset scale). Under everything
the strings climb F minor's scale with the raised seventh added (F G A-flat
B-flat C D-flat E-flat E: the last two steps close in by semitones), one
pitch class sounding in every octave from about G2 up to A-flat 5. Each
octave's loudness follows a bell over the whole span (E-flat 2 to B5):
silent at both edges, full from A-flat 3 to G4. As the climb rises, the top voice fades out as it
leaves and a new one swells in at the bottom, so every step goes up and the
whole never gets higher.
  * Who plays it. Four sections (basses, celli, violas, second violins) each
    cover two octaves, overlapping their neighbours by one, and each plays
    two rising lines an octave apart. A line swells in at the bottom of its
    section's window and is gone at the top, then comes back in at the bottom
    with the next octave. No section is ever heard to leap down: a section's
    two lines take turns, so each section on its own is a small climb that
    never arrives. The shares are power-complementary (s^2 over the root of
    s^4 + c^4), so the octaves hand over without a bump. The bell thins out
    below the tune's register (18 dB down at G5, the head's lowest note, and
    gone by A5), so the tune sings above the climb, not inside it.
  * How the loudness is made. Each line's expression lane is its octave's
    weight (the bell times its section's share), gliding toward where the
    note goes next. The string libraries play a lane as their dynamics
    control, which stops at about -29 dB, so a note quieter than -18 dB
    moves to a copy of its part set 18 dB lower: the edges fade to silence
    instead of stopping at the floor. A small table (CORR, measured on the
    samples that sound in F) evens out the ones that come out louder or
    softer than their neighbours.
  * The wrap is hidden. Each strain's octave of the climb starts on C (the
    fifth), so the step where the pitch classes come round again (E to F)
    falls in a strain's fifth bar (in B and B2, its third and seventh),
    mid-phrase, under D-flat major or B-flat minor with the bass on D-flat or
    B-flat: never under the tonic, never with the bass on F, never where the
    tune starts.
  * Seamless by construction. The loop is 96 steps, twelve octaves: a whole
    number of pairs of octaves, so each line ends the loop on the note it
    began it with.
  * Its speed is the form: one step a bar (A, A2), two (B), one (A3), two
    (B2), four, then eight: in the sprint the climb goes through a whole
    octave every bar. Then it stops.
  * Heard: the full mix adds the steps as a spiccato pulse that quickens with
    the climb (quarters, then eighths, then every note a step); the calm mix
    has the sustained climb and a harp that plucks every step (one harp
    across the whole span under the same bell, so its hand-offs are one
    sound). The climb drops back while the tune breathes (B, A3).

The tune (violins in the full mix; in the calm, the flute sings A, A2 and
B2's answers, the oboe B's answers and A3, the clarinet B's calls, B2's low
shivers and the sprint's head).
The head is a shiver and a leap: G5 A-flat5 G5 A-flat5 C6, the semitone
above the fifth worried twice and then left for the top, answered by B-flat5.
A-flat5 G5 E5, a fall to the leading tone. The shiver is heard only at a
strain's head, twice, while the climb goes up two steps under it. Then a
line in long notes that falls while the climb rises (contrary motion is what
makes the climb audible):
  A    D-flat6 C6 B-flat5 A-flat5, a step a bar, each with a rising echo;
  A2   the repeat a third higher, then three falling arpeggios and E;
  A3   A-flat4 G4 E-flat4 D-flat4, low, on the horns (calm: the oboe, an
       octave higher): the loop's valley.

The tonic and tempo: F minor, which no Act III, Act IV or final-act battle
theme uses (the lead re-keyed the set so the four new themes stand apart).
4/4 at 174, a tempo no battle theme uses, with the drums mostly in half time;
One More Crossing is a 12/8 walk at 162, and this piece has no compound
motor. The piece is written in D minor and sounds a minor third up
(Score(transpose=3)); the note names below are sounding pitch.

Form (score bars; loop 3-50, 48 bars, 66.2 s):
  intro 1-2  the landing: one blow, the climb holding still, then a gather
  A    3-10  the head twice, then the falling answer; the wrap at bar 7
             under D-flat
  A2  11-18  the head, its repeat a third up, falling arpeggios; ends on the
             dominant with its seventh in the bass
  B   19-26  the climb twice as fast; the shiver called twice, low (horns;
             calm: clarinet), answered high (violins; calm: oboe); the climb's
             E-flat then E decides whether each C chord is minor or major
  A3  27-34  the climb back to one step a bar, dropping back; the head on the
             horns (calm: oboe) with no bass guitar and light toms: the
             valley, and the one bright turn (D-flat, E-flat, A-flat, E-flat7)
  B2  35-42  the head worked out: the shiver climbs by thirds (G, B-flat,
             then E-flat on top), horns, horns, violins, each answered by
             the fall, and a long line rises into the sprint
  C   43-48  the sprint: the climb in quarters (43-44), then an octave a bar
             (45-48). Bars 45-46 are the climb alone, with the brass striking
             each octave's arrival; the head comes in at 47, at its own speed,
             on violins and trumpets with horns and trombones below
  L   49-50  the landing: one blow on C, and on the next beat everything is
             gone but the climb standing on B-flat and the tune's held E.
             The gather starts on bar 50.

The wow: bars 45-50 (60.7-69.0 s): four octaves of climb in 5.5 s, the head
thrown over it, a blow (66.2 s), three beats of the stair standing still
under the held E, and the gather (67.6 s).
calm: the strings drop out for bars 45-48 and leave the harp climbing its
four octaves alone (the illusion with nothing covering it), the clarinet's
head over it at 47, then the same stop.

No leitmotif: the head is its own. The landing's held leading tone is the
Hollow Sun's gesture without its notes. No choir; no Thread; no drill, so the
piece can share Act II with One More Crossing.

calm: the strings climbing, the harp on every step, the tune on a solo wind,
pizzicato basses in half notes, a clarinet pair holding the harmony; no kit
(the timpani and bass drum mark the strains, far back).
full: the climb as a pulse too, bass guitar and arco basses, trombone chords,
brass at the sprint, a kit mostly in half time.
"""

import math

from engine.patterns import Kit, chart
from engine.score import Score

from scores._battle import Battle

KEY = 'music_battle_escape_2'

INTRO, A, A2, B, A3, B2, C, L = 1, 3, 11, 19, 27, 35, 43, 49
END = 51

D = 2   # pitch class of the written tonic (the score sounds a minor third up)

# ------------------------------------------------------------------ the climb
# the climb's scale, written from D: D E F G A Bb C C# (natural minor with the
# raised seventh added, so the last two steps close in by semitones)
SCALE8 = [0, 2, 3, 5, 7, 8, 10, 11]
START = 4          # each strain's octave of the climb starts on the fifth (A)
# (first bar, bars, steps per bar); the loop is 96 steps, twelve octaves: a
# multiple of two octaves, so every line comes back to itself at the seam
PLAN = [(A, 8, 1), (A2, 8, 1), (B, 8, 2), (A3, 8, 1), (B2, 8, 2), (C, 2, 4), (C + 2, 4, 8)]

# the bell (written pitch): C2 to G#5, loudest around B-flat 3. Its top is
# gone before the tune's register
LO, WIDTH = 36, 44
# each component's measured level against the bell (the stack's level pitch
# by pitch in the render, at sounding pitch) differs by a few dB where a sample
# is louder or softer than its neighbours; these corrections flatten it
CORR = {40: -5.2, 41: -3.6, 45: -1.0, 46: -2.1, 48: -0.9, 49: -1.1, 50: -2.9, 52: -2.1,
        53: 1.1, 55: 1.3, 57: -2.3, 58: -1.4, 62: 1.0, 64: 1.7, 65: 1.1, 67: 1.2, 69: 1.5,
        70: 2.6, 72: 1.4, 73: 3.0, 74: 3.7, 76: 4.3}
TIER_DB = 18.0     # a quiet component moves to a copy of its part set this much lower
FLOOR_DB = -44.0   # below this a component is left out


def weight(p):
    """Bell over log frequency: silent at both edges, full in the middle."""
    x = (p - LO) / WIDTH
    if x <= 0 or x >= 1:
        return 0.0
    return math.sin(math.pi * x) ** 2


def arch(u):
    """A section's share of a component u semitones into its two-octave
    window: gone at both edges, full in the middle, and power-complementary
    with the section an octave away (s^2 over sqrt(s^4 + c^4))."""
    if u <= 0 or u >= 24:
        return 0.0
    s2 = math.sin(math.pi * u / 24) ** 2
    c2 = 1 - s2
    return s2 / math.sqrt(s2 * s2 + c2 * c2)


# sections: (window start, instrument, tag). Each covers two octaves and
# plays two rising lines an octave apart; a line swells in at the bottom of
# its window and is gone at the top, then comes back in at the bottom with the
# next component. Neighbouring sections overlap by an octave.
STRINGS = [(24, 'basses', 'cb'), (36, 'celli', 'vc'), (48, 'violas', 'va'),
           (60, 'violins2', 'vn2')]

# the climb's own dynamics, strain by strain: (velocity, level in dB). It
# drops back while the tune breathes (B, A3)
STAIR_DYN = {INTRO: (0.5, -10.0), A: (0.66, -2.0), A2: (0.64, -3.0), B: (0.55, -7.0),
             A3: (0.5, -9.0), B2: (0.62, -5.0), C: (0.8, -3.0), C + 2: (0.9, -5.0),
             L: (0.5, -10.0)}


def xpos(i):
    return 12 * (i // 8) + SCALE8[i % 8]


def stair_events(s):
    """[(beat, dur, x, vel, db)]: x in written semitones above D, unwrapped."""
    ev = [(s.bar(INTRO), 8.0, xpos(START - 1), *STAIR_DYN[INTRO])]   # the landing
    i = START
    for bar, n, rate in PLAN:
        d = 4.0 / rate
        beat = s.bar(bar)
        for _ in range(n * rate):
            ev.append((beat, d, xpos(i), *STAIR_DYN[bar]))
            beat += d
            i += 1
    assert (i - START) % 16 == 0, i
    # the landing: the sprint's last note struck again and held
    last = ev[-1]
    ev.append((s.bar(L), 8.0, last[2], *STAIR_DYN[L]))
    return ev, xpos(i)


def climb(b, s, prefix, sections, art, layer='both', gain=0.0, overlap=0.12, gains=None,
          vel_scale=1.0, only=None, calm_db=None, pulse=None, accents=None, **opts):
    """Lay the climb onto its sections. Each line's expression lane follows
    its component's weight (the bell times the section's arch), gliding
    toward where the component goes next.

    The string libraries play a lane as their dynamics control, which stops at
    about -29 dB, so a component quieter than -TIER_DB goes to a second part on
    the same instrument set TIER_DB lower (its lane raised to match): the
    edges fade to silence instead of stopping at the floor."""
    gains = gains or {}
    parts = {}
    ev, loop_x = stair_events(s)

    def part(sec, line, tier):
        start, inst, tag = sec
        name = f'{prefix}_{tag}{"ab"[line]}' + ('' if tier == 0 else f'_q{tier}')
        if name not in parts:
            parts[name] = b.part(name, inst, layer=layer, role='climb', art=art,
                                 gain=gain + gains.get(tag, 0.0) - TIER_DB * tier, life=0.0,
                                 calm_db=calm_db, **opts)
        return parts[name]

    for i, (beat, dur, x, vel, sdb) in enumerate(ev):
        if only and not any(a <= beat < z for a, z in only):
            continue
        if i + 1 < len(ev):
            nxt, ndb = ev[i + 1][2], ev[i + 1][4]
        else:
            nxt, ndb = loop_x, ev[1][4]      # the loop's first step, a cycle on
        step = nxt - x
        for sec in sections:
            lo = sec[0]
            p1 = lo + ((D + x - lo) % 12)
            for p in (p1, p1 + 12):
                wv = weight(p) * arch(p - lo)
                w_db = 20 * math.log10(max(wv, 1e-9))
                if w_db < FLOOR_DB:
                    continue
                wv *= 10 ** (CORR.get(p, 0.0) / 20)
                w_db = 20 * math.log10(max(wv, 1e-9))
                if w_db < FLOOR_DB:
                    continue
                # the line a component belongs to: its octave's parity (the loop
                # advances by whole pairs of octaves, so this is seamless)
                line = ((p - D - x) // 12) % 2
                tier = 0 if w_db + sdb >= -TIER_DB else 1
                pt = part(sec, line, tier)
                pl = pulse(beat) if callable(pulse) else pulse
                if pl and dur > pl + 1e-6:
                    # the step repeated as a pulse; `accents` lifts given offsets
                    k = 0
                    while k * pl < dur - 1e-6:
                        t = beat + k * pl
                        acc = accents.get(round((t - s.bar(s.bar_at(t) + 1)) % 4, 3), 0.0) \
                            if accents else 0.0
                        pt.note(t, p, pl, vel=min(1.0, vel * vel_scale + acc), art=art)
                        k += 1
                else:
                    pt.note(beat, p, dur + (0 if pulse else overlap), vel=vel * vel_scale, art=art,
                            rearticulate=True)
                boost = 10 ** (TIER_DB * tier / 20)
                w0 = max(wv * boost * 10 ** (sdb / 20), 1e-4) ** (1 / 1.3)
                w1 = max(weight(p + step) * arch(p + step - lo) * boost
                         * 10 ** ((CORR.get(p + step, 0.0) + ndb) / 20), 1e-4) ** (1 / 1.3)
                pt.expr_points.append((beat, min(w0, 1.0)))
                pt.expr_points.append((beat + dur - 0.06, min(w1, 1.0)))
    for pt in parts.values():
        pt.expr_points.sort()
    return parts


# ------------------------------------------------------------------ harmony
# Written in D minor. One chord a bar; the climb's note (or both notes, where
# it takes two steps a bar) is a chord tone or a tension the chord has room
# for. The wrap (C# to D) falls in bar 5 of A, A2 and A3 and in bars 3 and 7
# of B and B2: always under B-flat or G minor, the bass on B-flat or G.
CH_A = chart('Dm C#dim7/E Dm7/F A7 Bb Am7/C Gm7 C7sus4')
CH_A2 = chart('Dm C#dim7/E Am7/C C#dim7/G Gm/Bb C Bb/F A7/G')
CH_B = chart('C A5 Gm6 F C A5 Gm6/Bb Bb')
CH_A3 = chart('Dm C#dim7/E Dm7/F A7 Bb C F C7')
CH_B2 = chart('C A5 Gm6 F C A5 Gm6/Bb Bbmaj7')
CH_L = chart('A7:8')

# the bass keeps to roots and inversions and is never on D at a wrap
BASS = {
    A: 'D2 E1 F1 A1 Bb1 C2 G1 C2',
    A2: 'D2 E1 C2 G1 Bb1 C2 F1 G1',
    B: 'C2 A1 G1 F1 C2 A1 Bb1 Bb1',
    A3: 'D2 E1 F1 A1 Bb1 C2 F1 C2',
    B2: 'C2 A1 G1 F1 C2 A1 Bb1 Bb1',
    C: 'E1 G1 Bb1 G1 F1 A1',
}

# ------------------------------------------------------------------ the tune
# The head (written): E F E F, the semitone above the fifth worried twice, then
# A held; the fall G. F E C#. Twice at each strain's head, then a line.
HEAD = 'E5e F5e E5e F5e A5h | G5q. F5e E5q C#5q |'
HEAD_UP = 'G5e A5e G5e A5e C6h | Bb5q. A5e G5q E5q |'     # the repeat a third higher
TUNE_A = HEAD + HEAD + ' Bb5w | A5h. C6q | G5h. Bb5q | F5w |'
TUNE_A2 = (HEAD + HEAD_UP + ' Bb5q. G5e D5h | C6q. G5e E5h | D6q. Bb5e F5h |'
           ' E5h. rq |')
TUNE_A3 = HEAD + HEAD + ' F5w | E5w | C5w | Bb4w |'
# the sprint: the head at its own speed from bar 47, its C# held through the
# landing
HEAD_C = 'E5e F5e E5e F5e A5h | G5q. F5e E5q C#5q | @pp C#5w~ | C#5h. rq |'
BRASS_C = 'E5e F5e E5e F5e A5h | G5q. F5e E5q C#5q | C#5q^ rq rh |'
LANDING = '@pp C#5w~ | C#5h. rq |'
# B: the shiver called low twice, each answered high, with a long line between
B_CALL = 'E4e F4e E4e F4e G4h | rw | rw | rw | E4e F4e E4e F4e C5h | rw | rw | rw |'
B_ANS = 'rw | A5q. G5e E5h | Bb5w | C6h A5h | rw | E5q. D5e C#5h | G5w | F5w |'
# B2: the head worked out; the shiver climbs by thirds, each answered by the fall
B2_LOW = ('E4e F4e E4e F4e G4h | rw | G4e A4e G4e A4e Bb4h | rw | rw |'
          ' A4q. G4e E4q C#4q | rw | rw |')
B2_HIGH = ('rw | G5q. F5e E5q C#5q | rw | C6q. Bb5e A5q F5q | C6e D6e C6e D6e E6h | rw |'
           ' Bb5w | D6h C6h |')

# ------------------------------------------------------------------ drums
HALF = {'kick': 'x.....x.x.......', 'snare': '........X.....o.', 'hat': '..x...x...x...x.',
        'tom_lo': '...........x....'}
HALF_FILL = {'kick': 'x.....x.x.......', 'snare': '........X...xoxX', 'hat': '..x...x.........'}
LIGHT = {'kick': 'x.......x.......', 'rim': '....x.......x..o', 'ride': 'x...x...x...x...'}
LIGHT_FILL = {'kick': 'x.......x.......', 'rim': '....x.......', 'tom_lo': '..........x.xxXX'}
FEET = {'kick': 'x...............', 'tom_lo': '..x...x...x...x.', 'rim': '........x.......'}
FEET_FILL = {'kick': 'x...............', 'tom_lo': '..x...x...x.x.xx', 'rim': '........x.......'}
DRIVE = {'kick': 'x..x..x.x..x..x.', 'snare': '....X.......X...', 'tom_lo': '..x.......x.....',
         'hat': 'x.x.x.x.x.x.x.x.'}
DRIVE_FILL = {'kick': 'x..x..x.x.......', 'snare': '....X.......xxXX', 'tom_lo': '..x.......xx....'}
SPRINT = {'kick': 'x...x...x...x...', 'snare': '....X.......X...', 'hat': 'xxxxxxxxxxxxxxxx'}


def play_bass(part, s, bar, notes, rhythm, vel, art=None, ups=None):
    """One bass note a bar, played in `rhythm`; '8' in `ups` marks the notes
    taken an octave up."""
    from engine.score import parse_duration
    from engine.theory import pitch
    durs = [parse_duration(d) for d in rhythm.split()]
    ups = (ups or '').split()
    for k, name in enumerate(notes.split()):
        t = s.bar(bar + k)
        pos = 0.0
        for j, d in enumerate(durs):
            up = 12 if ups and ups[j % len(ups)] == '8' else 0
            part.note(t + pos, pitch(name) + up, d, vel=vel, art=art)
            pos += d


# the harp comes forward when it climbs alone (the calm mix's sprint)
HARP_DB = {C + 2: 9.0}


def harp_stair(b, s):
    """The calm's stair: a harp plucks every step of the climb, one part per
    octave band, the same bell (one instrument across the whole window, so
    its hand-offs between bands are the same sound)."""
    ev, _ = stair_events(s)
    nb = -(-WIDTH // 12)
    parts = [b.part(f'c_hp{k}', 'harp', layer='calm', role='climb', life=0.0, gain=-3.0,
                    pan=-0.35) for k in range(nb)]
    for beat, dur, x, vel, sdb in ev:
        bar = s.bar_at(beat) + 1
        extra = HARP_DB.get(C + 2, 0.0) if C + 2 <= bar < L else 0.0
        for k in range(nb):
            p = LO + ((D + x - LO) % 12) + 12 * k
            w = weight(p) * 10 ** ((sdb + extra - 3.0) / 20)
            if w < 10 ** (-46 / 20):
                continue
            pt = parts[k]
            pt.note(beat, p, min(dur, 3.0), vel=0.5 + 0.2 * (vel - 0.6))
            pt.expr_points.append((beat, max(w, 1e-4) ** (1 / 1.3)))
            pt.expr_points.append((beat + dur - 0.05, max(w, 1e-4) ** (1 / 1.3)))
    for pt in parts:
        pt.expr_points.sort()


def build():
    s = Score('battle_escape_2', tonic='F', bpm=174, intro_bars=2, loop_bars=END - A,
              title='We Came This Far Also', seed=4001, transpose=3)
    s.reverb = dict(rt60=2.3, predelay_ms=24, wet_db=-0.6)
    s.master = dict(lufs=-14.0, glue_ratio=1.5)
    b = Battle(s, calm_lufs=-17.0, full_lufs=-14.0)
    for name, bar, ch in (('A', A, CH_A), ('A2', A2, CH_A2), ('B', B, CH_B), ('A3', A3, CH_A3),
                          ('B2', B2, CH_B2), ('C', C, chart('E5 Gm Bb Gm Dm/F A7')),
                          ('L', L, CH_L), ('intro', INTRO, CH_L)):
        b.section(name, bar, ch)

    # ============================================================ the climb
    g = dict(cb=4.8, vc=-2.1, va=0.0, vn2=-0.5)
    sprint = (s.bar(C + 2), s.bar(L))
    # shared by both mixes, except the sprint's octave-a-bar bars: there the
    # calm mix leaves the harp climbing alone
    climb(b, s, 'stair', STRINGS, 'sus', gains=g, gain=-4.0, calm_db=3.0, depth=0.6, width=0.9,
          eq=[('peak', 1500, 1.0, -3.0)], only=[(0.0, sprint[0]), (sprint[1], s.bar(END))])
    climb(b, s, 'stairF', STRINGS, 'sus', layer='full', gains=g, gain=-4.0, depth=0.6,
          width=0.9, eq=[('peak', 1500, 1.0, -3.0)], only=[sprint])
    harp_stair(b, s)
    # the full mix hears the steps as a pulse that quickens with the climb:
    # quarters, eighths, then every note a step
    pulses = {A: 1.0, A2: 1.0, B: 0.5, B2: 0.5, C: None}

    def pulse(beat):
        bar = s.bar_at(beat) + 1
        return pulses[max(k for k in pulses if k <= bar)]
    rng = [(s.bar(A), s.bar(A3)), (s.bar(B2), s.bar(L))]
    climb(b, s, 'spc', STRINGS, 'spic', layer='full', gains=g, gain=-7.0, pulse=pulse, width=1.0,
          eq=[('peak', 1500, 1.0, -3.0)],
          accents={0.0: 0.1, 2.0: 0.05}, only=rng, depth=0.45, vel_jitter=0.07)

    # ============================================================ the tune
    # the tune stays above the climb: violins in the full mix, a solo wind in
    # the calm one (each calm voice plays the same notes as the full mix's)
    vn = b.part('tune_vn', 'violins', role='lead', layer='full', art='sus',
                eq=[('peak', 4000, 1.0, -2.5)])
    vn.at(INTRO).play('@mf ' + LANDING)
    vn.at(A).play('@f ' + TUNE_A)
    vn.at(A2).play('@f ' + TUNE_A2)
    vn.at(B).play('@f ' + B_ANS)
    vn.at(B2).play('@f ' + B2_HIGH)
    vn.at(C + 4).play('@ff ' + HEAD_C)
    cla = b.part('tune_cla', 'clarinet', role='lead', layer='calm')
    cla.at(INTRO).play('@mp ' + LANDING)
    cla.at(B).play('@mf ' + B_CALL)
    cla.at(B2).play('@mf ' + B2_LOW)
    cla.at(C + 4).play('@mf ' + HEAD_C)
    fl = b.part('tune_fl', 'flute', role='lead', layer='calm')
    fl.at(A).play('@mf ' + TUNE_A)
    fl.at(A2).play('@mf ' + TUNE_A2)
    fl.at(B2).play('@mf ' + B2_HIGH)
    ob = b.part('tune_ob', 'oboe', role='lead', layer='calm')
    ob.at(B).play('@mf ' + B_ANS)
    ob.at(A3).play('@mp ' + TUNE_A3)
    bh = b.part('bth_hn', 'horns', role='lead', layer='full', pan=0.2)
    bh.at(B).play('@f ' + B_CALL)
    bh.at(B2).play('@f ' + B2_LOW)
    # A3: the head in the horns, low, the army's own voice, in the valley
    hn = b.part('tune_hn', 'horns', role='lead', layer='full', pan=-0.2, gain=-4.0,
                eq=[('peak', 2600, 1.0, 2.0)])
    hn.at(A3).play('@mf ' + TUNE_A3, transpose=-12)
    # the sprint's head, at its own speed: trumpets, horns and trombones play
    # the violins' line an octave below them (the trumpets' top stays under
    # their ceiling); they strike the landing, then let go
    hns = b.part('tune_hn_c', 'horns', role='lead', layer='full', pan=-0.2, gain=-5.0,
                 eq=[('peak', 2600, 1.0, 2.0)])     # under the violins, not over them
    hns.at(C + 4).play('@ff ' + BRASS_C, transpose=-12)
    tbh = b.part('tune_tbn', 'trombones', role='lead2', layer='full', pan=0.3)
    tbh.at(C + 4).play('@ff ' + BRASS_C, transpose=-12)
    tp = b.part('tune_tpt', 'trumpets', role='lead', layer='full', eq=[('peak', 2600, 1.0, 2.0)])
    tp.at(C + 4).play('@ff ' + BRASS_C, transpose=-12)

    # ============================================================ harmony
    for sec in ('A', 'A2', 'B', 'A3', 'B2'):
        b.pads(sec, inst='trombones', name='pad_tbn', n=3, lo=48, hi=65, vel=0.42, layer='full')
        b.pads(sec, inst='clarinet', name='c_pad', n=2, lo=53, hi=67, vel=0.4, art='default',
               layer='calm')
    s.parts['pad_tbn'].opts['gain'] = -4.0     # a floor under the tune, not a second tune
    # the sprint: brass strike each octave's arrival, then the climb runs alone
    st = b.part('stab_br', 'trumpets', role='accent', art='stac', layer='full')
    st.at(C).play('@f [E4 G4]q. [E4 G4]q. [E4 G4]q | [D4 G4 Bb4]q. [D4 G4 Bb4]q. [D4 G4 Bb4]q |'
                  ' @ff [D4 F4 Bb4]q^ rq rh | [D4 G4 Bb4]q^ rq rh |')

    # ============================================================ bass
    eb = b.part('ebass', 'rbass', role='bass', layer='full', duck='kit_kick')
    cb = b.part('cb_arco', 'basses', role='low', layer='full', art='spic', gain=-3.0)
    pz = b.part('c_pizz', 'basses', role='bass', layer='calm', art='pizz', gain=-3.0,
                depth=0.6)
    # the bass guitar's rhythm follows the strain's energy; it sits out A3
    eighths = ('e e e e e e e e', '- - - - - - 8 -')
    bass_rh = {A: eighths, A2: eighths, B: ('q. q. q', '- 8 -'), C: eighths}
    for sec in (A, A2, B, C):
        rh, ups = bass_rh[sec]
        play_bass(eb, s, sec, BASS[sec], rh, 0.72, ups=ups)
    b2 = BASS[B2].split()
    play_bass(eb, s, B2, ' '.join(b2[:4]), 'h h', 0.7)
    play_bass(eb, s, B2 + 4, ' '.join(b2[4:]), eighths[0], 0.74, ups=eighths[1])
    for sec in (A, A2, B, A3, B2, C):
        play_bass(cb, s, sec, BASS[sec], 'h h', 0.6)
        play_bass(pz, s, sec, BASS[sec], 'h h', 0.6)
    for bar in (INTRO, L):
        # the landing: the blow, then nothing until the gather in its second bar
        eb.at(bar).play('@f A1q rq rh | A1e A1e A1e A1e A1e A1e A1e A1e |')
        pz.at(bar).play('@mf A1q rq rh | A1h A1h |')
    # the bass's weight strain by strain (it gathers again through each landing)
    eb.expr((INTRO, 1.0), (INTRO + 1, 0.55), (INTRO + 1.97, 1.0), (A, 1.0), (A2 - 0.01, 1.0),
            (A2, 0.88), (B - 0.01, 0.88), (B, 0.74), (B2 - 0.01, 0.74), (B2, 0.8),
            (C - 0.01, 1.0), (L + 0.99, 1.0), (L + 1, 0.55), (L + 1.97, 1.0))

    # ============================================================ drums
    b.kit = Kit(s, 'kit', gains={'kick': -1.0, 'snare': -7.0, 'toms': -3.0, 'cym': -9.0})
    b.full_only.update(b.kit.names())
    b.groove('A', HALF, fill=HALF_FILL, every=4, vel=0.72)
    b.groove('A2', HALF, fill=HALF_FILL, every=4, vel=0.66, crash=False)
    b.groove('B', LIGHT, fill=LIGHT_FILL, every=4, vel=0.56, crash=False)
    b.groove('A3', FEET, fill=FEET_FILL, every=4, vel=0.44, crash=False)
    # B2 builds: a light pulse under its first half, driven in the second
    for k in range(8):
        grid = (LIGHT if k < 3 else LIGHT_FILL) if k < 4 else (DRIVE if k < 7 else DRIVE_FILL)
        b.kit.play(B2 + k, grid, vel=0.62 if k < 4 else 0.72)
    b.kit.play(B2 + 4, {'crash2': 'x'})
    b.groove('C', SPRINT, fill=None, vel=0.84, n_bars=5)
    # the sprint's last bar gathers into the blow
    b.kit.play(C + 5, {'kick': 'x...x...x...x...', 'snare': 'x.x.x.x.xxxxXXXX',
                       'tom_lo': '........x.x.x.x.'}, vel=0.8, ramp=0.5)
    b.riser(C + 4, beats=8, vel=0.6)
    b.hit(A, ('bd', 'crash'), vel=0.8)
    # the landing: one blow on beat 1; the rest of the bar is the held note
    # alone; the gather starts on its second bar
    boom = b.part('boom', 'boom', role='accent', layer='full', gain=3.0)
    low = b.part('blow_low', 'tuba', role='accent', layer='full', art='stac')
    tbl = b.part('blow_tbn', 'trombones', role='accent', layer='full', art='stac')
    for bar in (INTRO, L):
        b.kit.play(bar, {'kick': 'x...............'}, vel=0.8)
        b.kit.play(bar + 1, {'kick': 'x.......x.......', 'tom_lo': 'x.x.x.x.x.x.x.x.',
                             'snare': '........oooxxxXX'}, vel=0.66, ramp=0.6)
        b.hit(bar, ('bd',), vel=0.85)
        boom.at(bar).play('@f A1q rq rh |')
        low.at(bar).play('@ff A1q^ rq rh |')
        tbl.at(bar).play('@ff [A2 E3 A3]q^ rq rh |')
    tm = b.timp('A', '@f D2q rq rh |')
    tm.at(B).play('@f C2q rq rh |')
    tm.at(A3).play('@mf D2q rq rh |')
    tm.at(B2).play('@f C2q rq rh |')
    tm.at(C).play('%roll @mf E2w | G2w |')
    tm.at(C + 2).play('%default @ff Bb2q rq rh | G2q rq rh |')
    tm.at(C + 5).play('%roll @f A2w |')
    for bar in (INTRO, L):
        tm.at(bar).play('%default @ff A2q rq rh | %roll @mf A2w |')
    tm.expr((INTRO + 1, 0.35), (INTRO + 1.97, 1.0), (A, 1.0), (C + 4.99, 1.0), (C + 5, 0.3),
            (C + 5.97, 1.0), (L + 0.99, 1.0), (L + 1, 0.35), (L + 1.97, 1.0))
    return b.finish()
