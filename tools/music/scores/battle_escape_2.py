"""Escape battles, second theme — "We Came This Far Also".

Carved into the old kings' stair under the Seat, in the oldest hand: WE CAME
THIS FAR ALSO. Every thread climbs, and every thread gets this far. The
escape maps are a climb that has no top: the exit is always one more rise
away and the waves behind never stop. So the piece climbs forever.

The mechanism: an endless climb (a Shepard-Risset scale). Under everything
the strings climb D minor's scale with the raised seventh added (D E F G A
B-flat C C-sharp: the last two steps close in by semitones), one pitch class
sounding in every octave from C2 to C6. Each octave's loudness follows a bell
over the whole span: silent at both edges, full around middle C. As the
climb rises, the top voice fades out as it leaves and a new one swells in at
the bottom, so every step goes up and the whole never gets higher.
  * Who plays it. Four sections (basses, celli, violas, second violins) each
    cover two octaves, overlapping their neighbours by one, and each plays
    two rising lines an octave apart. A line swells in at the bottom of its
    section's window and is gone at the top, then comes back in at the bottom
    with the next octave. No section is ever heard to leap down: a section's
    two lines take turns, so each section on its own is a small climb that
    never arrives. The shares are power-complementary (s^2 over the root of
    s^4 + c^4), so the octaves hand over without a bump.
  * How the loudness is made. Each line's expression lane is its octave's
    weight (the bell times its section's share), gliding toward where the
    note goes next. The string libraries play a lane as their dynamics
    control, which stops at about -29 dB, so a note quieter than -18 dB
    moves to a copy of its part set 18 dB lower: the edges fade to silence
    instead of stopping at the floor. A small table (CORR) evens out the
    samples that come out louder or softer than their neighbours.
  * Seamless by construction. The loop is 96 steps, twelve octaves: a whole
    number of pairs of octaves, so each line ends the loop on the note it
    began it with.
  * Its speed is the form: one step a bar (A, A2), two (B), one (A3), two
    (B2), four, then eight: in the sprint the climb goes through a whole
    octave every bar. Then it stops.
  * Heard: the full mix adds the steps as a spiccato pulse that quickens with
    the climb (quarters, then eighths, then every note a step); the calm mix
    has the sustained climb alone and a harp that plucks every step (one harp
    across four octaves under the same bell, so its hand-offs are one sound).
    The climb drops back while the tune breathes (B, A3) and is loudest in the
    sprint.

The tune (violins in the full mix; clarinet, oboe and flute in the calm):
D5 D5 F5 D5 A5, a stutter on the root that jumps to the fifth and holds it,
answered by G5. F5 E5 C#5, a fall to the leading tone. It comes back note for
note while the climb goes up two steps under it: the same tune on higher
ground. Every return keeps the hook and changes what follows. A: the
answer climbs to D6 and ends on the dominant; A2: the repeat reaches a third
higher and the answer falls, ending on C-sharp diminished (the tonic never
comes: B opens on G minor over D); A3: the answer lifts through F, B-flat and C
major, the one bright turn.

The tonic and tempo: D, one of the two least used battle tonics, and absent
from the Acts this piece is aimed at (no Act III or Act IV field theme is in
D; only Totality, which can fall in any act, is). In the world's reckoning D
is the Root the climb reaches for: the climb touches it once an octave and
steps straight past it, and the loop's long landing is on C#, a step short.
4/4 at 174, a tempo no battle theme uses, with the drums mostly in half time;
One More Crossing is a 12/8 walk at 162, and this piece has no compound
motor.

Form (bars; loop 3-50, 48 bars, 66.2 s):
  intro 1-2  the landing: the climb holds C#, drums and bass gather
  A    3-10  the hook twice, the answer; the bass on roots (it never walks
             with the climb, so it never pins the climb to one octave)
  A2  11-18  the hook, its repeat a third up, a falling answer
  B   19-26  the climb twice as fast; the hook's stutter called low (horns;
             calm: clarinet) and answered high (violins; calm: oboe); the
             climb's C then C# decides whether each A chord is minor or major
  A3  27-34  the climb back to one step a bar; the hook in the horns (calm:
             flute), toms like running feet
  B2  35-42  the Empire's drill (D-Eb-D-C, falling to B-flat), first a fifth
             up, then at its own pitch in the trombones and tuba (calm:
             bassoon), falling onto B-flat over an E-flat chord; the horns
             answer with the hook
  C   43-48  the sprint: the climb in quarters (43-44), then an octave a bar
             (45-48) while the hook comes broad in long notes on violins and
             trumpets, with horns and trombones an octave below (the loop's
             one octave-doubled statement and its heaviest stack)
  L   49-50  the landing: one blow on A, and the climb stops dead on its C#
             (the tune holds it too) while the drums and the bass's eighths
             gather; the C# steps up to D as the loop begins again

The wow: the sprint and the stop, bars 45-50 (60.7-69.0 s): four octaves of
climb in 5.5 s under the broad hook, a blow, and the stair standing still
on the leading tone for two bars while the pursuit keeps coming.

Leitmotif: the Empire's drill (B2), at its own pitch, as the pursuers. The
landing stops on the leading tone as the Hollow Sun does, but quotes none of
its notes. No choir (Act II may share this piece); no Thread.

calm: the strings climbing, the harp on every step, the tune on a solo wind,
pizzicato basses in half notes, a clarinet pair holding the harmony; no kit
(the timpani and bass drum mark the strains, far back).
full: the climb as a pulse too, bass guitar and arco basses, trombone chords,
brass for the drill and the sprint, a kit mostly in half time.
"""

import math

from engine.patterns import Kit, chart
from engine.score import Score

from scores._battle import Battle

KEY = 'music_battle_escape_2'

INTRO, A, A2, B, A3, B2, C, L = 1, 3, 11, 19, 27, 35, 43, 49
END = 51

D = 2   # pitch class of the tonic

# ------------------------------------------------------------------ the climb
# the climb's scale, from D: D E F G A Bb C C# (natural minor with the raised
# seventh added, so the last two steps close in by semitones)
SCALE8 = [0, 2, 3, 5, 7, 8, 10, 11]
# (first bar, bars, steps per bar); the loop is 96 steps, twelve octaves: a
# multiple of two octaves, so every line comes back to itself at the seam
PLAN = [(A, 8, 1), (A2, 8, 1), (B, 8, 2), (A3, 8, 1), (B2, 8, 2), (C, 2, 4), (C + 2, 4, 8)]

# the bell: four octaves, C2 to C6, loudest around middle C. Its top edge is
# where the tune lives, so the tune stands above the climb
LO, WIDTH = 36, 48
# each component's measured level against the bell (tools: the stack's level
# pitch by pitch in the render) differs by a few dB where a sample is louder
# or softer than its neighbours; these corrections flatten it, so no pitch
# class of the climb is brighter or darker than the rest
CORR = {40: -8.0, 41: -4.0, 43: -3.3, 45: -1.4, 46: -1.4, 53: -1.1, 57: 1.5, 60: -2.4,
        61: -0.9, 65: 1.0, 67: 1.3, 70: 1.4, 72: 1.5, 73: 1.4, 74: 2.3, 76: 1.6}
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
# drops back while the tune breathes (B, A3) and is loudest in the sprint
STAIR_DYN = {INTRO: (0.6, -4.0), A: (0.66, -2.0), A2: (0.64, -3.0), B: (0.55, -7.0),
             A3: (0.52, -8.0), B2: (0.62, -5.0), C: (0.8, -3.0), C + 2: (0.9, -5.0),
             L: (0.62, -4.0)}


def stair_events(s):
    """[(beat, dur, x, vel, db)]: x in semitones above D, unwrapped."""
    ev = [(s.bar(INTRO), 8.0, -1, *STAIR_DYN[INTRO])]     # the landing: C#
    i = 0
    for bar, n, rate in PLAN:
        d = 4.0 / rate
        beat = s.bar(bar)
        for _ in range(n * rate):
            ev.append((beat, d, 12 * (i // 8) + SCALE8[i % 8], *STAIR_DYN[bar]))
            beat += d
            i += 1
    assert i % 16 == 0, i
    # the landing: the last C# struck again and held
    last = ev[-1]
    ev.append((s.bar(L), 8.0, last[2], *STAIR_DYN[L]))
    return ev, 12 * (i // 8)


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
    ev, loop = stair_events(s)
    loop_x = loop

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
# One chord a bar (the climb's note, or both of its notes where it takes two
# steps a bar, is always a chord tone or a tension the chord has room for)
CH_A = chart('Dm A7/E Dm/F A7/G Dm/A Gm/Bb Am/C A/C#')  # the climb walks up the chords
CH_A2 = chart('Dm A7/E Dm7/F Em7b5/G Dm/A Gm/Bb Am/C C#dim7')
CH_B = chart('Gm6/D F C A5 Dsus2 Gm7 C A5')           # the climb's third decides A's quality
CH_A3 = chart('Dm A7/E Dm/F A7/G F/A Bb C A')
CH_B2 = chart('Dsus2 F C A5 Gm6/D Eb C A5')           # the drill's chord: E-flat
CH_C = chart('Gm/D E5 Dm A7 Dm A7')
CH_L = chart('A:8')

# the bass keeps to roots (it never walks with the climb, so it never pins it
# to one octave)
BASS = {
    A: 'D2 A1 D2 A1 D2 G1 C2 A1',
    A2: 'D2 A1 D2 E2 D2 G1 C2 C#2',
    B: 'D2 F1 C2 A1 D2 G1 C2 A1',
    A3: 'D2 A1 D2 A1 F1 Bb1 C2 A1',
    B2: 'D2 F1 C2 A1 D2 Eb2 C2 A1',
    C: 'D2 E2 D2 A1 D2 A1',
}

# ------------------------------------------------------------------ the tune
# The hook: four running eighths that stutter on D and jump to F, then the
# fifth held; the answer runs down to the leading tone. It comes back note
# for note while the climb goes up under it (i, V, i6, V4/2): the same tune,
# higher ground. Every strain keeps the hook and changes what follows it.
HOOK = 'D5e D5e F5e D5e A5h | G5q. F5e E5q C#5q |'
HOOK_UP = 'F5e F5e A5e F5e C6h | Bb5q. A5e G5q E5q |'   # the repeat reaching a third higher
TUNE_A = (HOOK + HOOK + ' F5e F5e A5e F5e D6h | C6q. Bb5e G5q D5q |'
          ' E5e E5e G5e E5e C6h | A5h. rq |')
TUNE_A2 = (HOOK + HOOK_UP + ' D6q. C6e A5q F5q | G5q. F5e D5q Bb4q |'
           ' C5q. D5e E5q G5q | E5h. rq |')
TUNE_A3 = (HOOK + HOOK + ' A5e A5e C6e A5e F6h | D6q. C6e Bb5q F5q |'
           ' G5e G5e C6e G5e E6h | C#6h. rq |')
# the sprint: the hook in long notes (the climb spins, the tune broadens), its
# last C# held through the landing
HOOK_LONG = 'D5q D5q F5q D5q | A5w | G5h. F5q | E5h C#5h~ | C#5w~ | C#5h. rq |'
LANDING = 'C#5w~ | C#5h. rq |'
# B: the hook's stutter called low, answered high, while the climb runs twice
# as fast; the call takes whatever note the climb's chord allows
B_CALL = ('D4e D4e G4e D4e Bb4h | rw | C4e C4e E4e C4e G4h | rw |'
          ' D4e D4e E4e D4e A4h | rw | E4e E4e G4e E4e C5h | rw |')
B_ANS = ('rw | A5q. G5e F5q C5q | rw | E5h. A4q |'
         ' rw | Bb5q. A5e G5q D5q | rw | E5w |')
DRILL_HI = 'A3q. Bb3e A3q G3q | F3h. rq |'
DRILL = 'D4q. Eb4e D4q C4q | Bb3h. rq |'          # the Empire, at its own pitch
ANSWER = 'E4e E4e G4e E4e C5q. Bb4e | A4e G4e F4e G4e E4h |'   # the hook, answering the drill

# ------------------------------------------------------------------ drums
HALF = {'kick': 'x.....x.x.......', 'snare': '........X.....o.', 'hat': '..x...x...x...x.',
        'tom_lo': '...........x....'}
HALF_FILL = {'kick': 'x.....x.x.......', 'snare': '........X...xoxX', 'hat': '..x...x.........'}
LIGHT = {'kick': 'x.......x.......', 'rim': '....x.......x..o', 'ride': 'x...x...x...x...'}
LIGHT_FILL = {'kick': 'x.......x.......', 'rim': '....x.......', 'tom_lo': '..........x.xxXX'}
FEET = {'kick': 'x.......x.......', 'tom_lo': '..x...x...x...x.', 'rim': '....x.......x...'}
FEET_FILL = {'kick': 'x.......x.......', 'tom_lo': '..x...x...x.x.xx', 'rim': '....x.......'}
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


def harp_stair(b, s):
    """The calm's stair: a harp plucks every step of the climb, one part per
    octave band, the same bell (one instrument across the whole window, so
    its hand-offs between bands are the same sound)."""
    ev, loop_x = stair_events(s)
    parts = [b.part(f'c_hp{k}', 'harp', layer='calm', role='climb', life=0.0, gain=-3.0,
                    pan=-0.35) for k in range(WIDTH // 12)]
    for beat, dur, x, vel, sdb in ev:
        for k in range(WIDTH // 12):
            p = LO + ((D + x - LO) % 12) + 12 * k
            w = weight(p) * 10 ** (sdb / 20)
            if w < 10 ** (-40 / 20):
                continue
            pt = parts[k]
            pt.note(beat, p, min(dur, 3.0), vel=0.5 + 0.2 * (vel - 0.6))
            pt.expr_points.append((beat, max(w, 1e-4) ** (1 / 1.3)))
            pt.expr_points.append((beat + dur - 0.05, max(w, 1e-4) ** (1 / 1.3)))
    for pt in parts:
        pt.expr_points.sort()


def build():
    s = Score('battle_escape_2', tonic='D', bpm=174, intro_bars=2, loop_bars=END - A,
              title='We Came This Far Also', seed=4001)
    s.reverb = dict(rt60=2.3, predelay_ms=24, wet_db=-0.6)
    s.master = dict(lufs=-14.0, glue_ratio=1.5)
    b = Battle(s, calm_lufs=-17.0, full_lufs=-14.0)
    for name, bar, ch in (('A', A, CH_A), ('A2', A2, CH_A2), ('B', B, CH_B), ('A3', A3, CH_A3),
                          ('B2', B2, CH_B2), ('C', C, CH_C), ('L', L, CH_L),
                          ('intro', INTRO, CH_L)):
        b.section(name, bar, ch)

    # ============================================================ the climb
    g = dict(cb=4.8, vc=-2.1, va=0.0, vn2=-0.5, vn1=-1.2)
    climb(b, s, 'stair', STRINGS, 'sus', gains=g, gain=-4.0, calm_db=3.0, depth=0.6, width=0.9,
          eq=[('peak', 1500, 1.0, -3.0)])
    harp_stair(b, s)
    # the full mix hears the steps as a pulse that quickens with the climb:
    # half notes, quarters, eighths, then every note a step
    pulses = {A: 1.0, A2: 1.0, B: 0.5, B2: 0.5, C: None}

    def pulse(beat):
        bar = s.bar_at(beat) + 1
        return pulses[max(k for k in pulses if k <= bar)]
    rng = [(s.bar(A), s.bar(A3)), (s.bar(B2), s.bar(L))]
    climb(b, s, 'spc', STRINGS, 'spic', layer='full', gains=g, gain=-7.0, pulse=pulse, width=1.0,
          eq=[('peak', 1500, 1.0, -3.0)],
          accents={0.0: 0.1, 2.0: 0.05}, only=rng, depth=0.45, vel_jitter=0.07)

    # ============================================================ the tune
    # the tune stays above the climb's core (D5 to A5 and up): violins in the
    # full mix, a solo wind or violin in the calm one
    vn = b.part('tune_vn', 'violins', role='lead', layer='full', art='sus',
                eq=[('peak', 4000, 1.0, -2.5)])
    vn.at(INTRO).play('@mf ' + LANDING)
    vn.at(A).play('@f ' + TUNE_A)
    vn.at(A2).play('@f ' + TUNE_A2)
    vn.at(C + 2).play('@ff ' + HOOK_LONG)
    cla = b.part('tune_cla', 'clarinet', role='lead', layer='calm')
    cla.at(INTRO).play('@mp ' + LANDING)
    cla.at(A).play('@mf ' + TUNE_A)
    cla.at(C + 2).play('@mf ' + HOOK_LONG)
    ob = b.part('tune_ob', 'oboe', role='lead', layer='calm')
    ob.at(A2).play('@mf ' + TUNE_A2)
    ob.at(B).play('@mf ' + B_ANS)
    cla.at(B).play('@mf ' + B_CALL)
    bh = b.part('bth_hn', 'horns', role='lead', layer='full', pan=0.2)
    bh.at(B).play('@f ' + B_CALL)
    vn.at(B).play('@f ' + B_ANS)
    fl = b.part('tune_fl', 'flute', role='lead', layer='calm')
    fl.at(A3).play('@mf ' + TUNE_A3)
    # A3: the hook in the horns, the army's own voice, in the middle of the
    # climb (which has dropped back to let it through)
    hn = b.part('tune_hn', 'horns', role='lead', layer='full', pan=-0.2,
                 eq=[('peak', 2600, 1.0, 2.0)])
    hn.at(A3).play('@f ' + TUNE_A3, transpose=-12)
    # the brass join the sprint's tune and strike the landing, then let go
    brass_hook = HOOK_LONG.split('| C#5w~')[0].replace('C#5h~', 'C#5h') + '| C#5q^ rq rh |'
    hn.at(C + 2).play('@ff ' + brass_hook, transpose=-12)
    tbh = b.part('tune_tbn', 'trombones', role='lead2', layer='full', pan=0.3)
    tbh.at(C + 2).play('@ff ' + brass_hook, transpose=-12)
    drill = DRILL_HI + ' rw | rw |' + DRILL + ' rw | rw |'
    tb = b.part('drill_tbn', 'trombones', role='lead', layer='full', depth=0.7, vel_jitter=0.08,
                eq=[('peak', 1200, 1.0, 2.5), ('peak', 300, 1.0, -2.0)])
    tb.at(B2).play('@f ' + drill)
    tu = b.part('drill_tuba', 'tuba', role='lead2', layer='full', depth=0.75)
    tu.at(B2).play('@f ' + drill, transpose=-12)
    bn = b.part('drill_bsn', 'bassoon', role='lead', layer='calm')
    bn.at(B2).play('@mf ' + drill)
    ans = b.part('ans_hn', 'horns', role='lead2', pan=0.3, calm_db=-4)
    ans.at(B2 + 2).play('@f ' + ANSWER)
    ans.at(B2 + 6).play('@f ' + ANSWER)
    tp = b.part('tune_tpt', 'trumpets', role='lead', layer='full', eq=[('peak', 2600, 1.0, 2.0)])
    tp.at(C + 2).play('@ff ' + brass_hook)

    # ============================================================ harmony
    for sec in ('A', 'A2', 'B', 'A3'):
        b.pads(sec, inst='trombones', name='pad_tbn', n=3, lo=48, hi=65, vel=0.42, layer='full')
        b.pads(sec, inst='clarinet', name='c_pad', n=2, lo=53, hi=67, vel=0.4, art='default',
               layer='calm')
    s.parts['pad_tbn'].opts['gain'] = -4.0     # a floor under the tune, not a second tune
    st = b.part('stab_br', 'trumpets', role='accent', art='stac', layer='full')
    st.at(C).play('@f [D4 G4 Bb4]q. [D4 G4 Bb4]q. [D4 G4 Bb4]q | [E4 G4]q. [E4 G4]q. [E4 G4]q |')

    # ============================================================ bass
    eb = b.part('ebass', 'rbass', role='bass', layer='full', duck='kit_kick')
    cb = b.part('cb_arco', 'basses', role='low', layer='full', art='spic', gain=-3.0)
    pz = b.part('c_pizz', 'basses', role='bass', layer='calm', art='pizz', gain=-3.0,
               depth=0.6)
    # the bass guitar's rhythm follows the strain's energy
    eighths = ('e e e e e e e e', '- - - - - - 8 -')
    bass_rh = {A: eighths, A2: eighths, B: ('q. q. q', '- 8 -'), A3: ('q q q q', '- - 8 -'),
               C: eighths}
    for sec in (A, A2, B, A3, C):
        rh, ups = bass_rh[sec]
        play_bass(eb, s, sec, BASS[sec], rh, 0.72, ups=ups)
    b2 = BASS[B2].split()
    play_bass(eb, s, B2, ' '.join(b2[:4]), 'h h', 0.7)
    play_bass(eb, s, B2 + 4, ' '.join(b2[4:]), eighths[0], 0.74, ups=eighths[1])
    for sec in (A, A2, B, A3, B2, C):
        play_bass(cb, s, sec, BASS[sec], 'h h', 0.6)
        play_bass(pz, s, sec, BASS[sec], 'h h', 0.6)
    for bar in (INTRO, L):
        # the landing: the climb holds, the pursuit does not
        eb.at(bar).play('@mf A1e A1e A1e A1e A1e A1e A1e A1e | A1e A1e A1e A1e A1e A1e A1e A1e |')
        pz.at(bar).play('@mf A1h rh | A1h rh |')
    # the bass's weight strain by strain (it gathers again through each landing)
    eb.expr((INTRO, 0.55), (INTRO + 1.97, 1.0), (A, 1.0), (A2 - 0.01, 1.0), (A2, 0.88),
            (B - 0.01, 0.88), (B, 0.74), (A3 - 0.01, 0.74), (A3, 0.82), (B2 - 0.01, 0.82),
            (B2, 0.8), (C - 0.01, 1.0), (L - 0.01, 1.0), (L, 0.55), (L + 1.97, 1.0))

    # ============================================================ drums
    b.kit = Kit(s, 'kit', gains={'kick': -1.0, 'snare': -7.0, 'toms': -3.0, 'cym': -9.0})
    b.full_only.update(b.kit.names())
    b.groove('A', HALF, fill=HALF_FILL, every=4, vel=0.72)
    b.groove('A2', HALF, fill=HALF_FILL, every=4, vel=0.66, crash=False)
    b.groove('B', LIGHT, fill=LIGHT_FILL, every=4, vel=0.56, crash=False)
    b.groove('A3', FEET, fill=FEET_FILL, every=4, vel=0.62, crash=False)
    # B2 builds: the drill's first half over a light pulse, the second driven
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
    # the landing: one blow, then the climb stands still on its held note
    # while the pursuit does not: toms and the bass's eighths gather into the
    # loop's first bar
    boom = b.part('boom', 'boom', role='accent', layer='full', gain=3.0)
    low = b.part('blow_low', 'tuba', role='accent', layer='full', art='stac')
    tbl = b.part('blow_tbn', 'trombones', role='accent', layer='full', art='stac')
    for bar in (INTRO, L):
        b.kit.play(bar, {'kick': 'x.......x.......', 'crash': 'X', 'tom_lo': '....x.x...x.x.x.'},
                   vel=0.62)
        b.kit.play(bar + 1, {'kick': 'x.......x.......', 'tom_lo': 'x.x.x.x.x.x.x.x.',
                             'snare': '........oooxxxXX'}, vel=0.66, ramp=0.6)
        b.hit(bar, ('bd', 'crash'), vel=0.85)
        boom.at(bar).play('@f A1q rq rh |')
        low.at(bar).play('@ff A1q^ rq rh |')
        tbl.at(bar).play('@ff [A2 E3 A3]q^ rq rh |')
    tm = b.timp('A', '@f D2q rq rh |')
    for bar in (B, A3, B2):
        tm.at(bar).play('@f D2q rq rh |')
    tm.at(C).play('%roll @mf D2w | E2w |')
    tm.at(C + 2).play('%default @ff D2q rq rh |')
    tm.at(C + 5).play('%roll @f A2w |')
    for bar in (INTRO, L):
        tm.at(bar).play('%default @ff A2q rq rh | %roll @mf A2w |')
    tm.expr((INTRO + 1, 0.35), (INTRO + 1.97, 1.0), (A, 1.0), (C + 4.99, 1.0), (C + 5, 0.3),
            (C + 5.97, 1.0), (L + 0.99, 1.0), (L + 1, 0.35), (L + 1.97, 1.0))
    return b.finish()
