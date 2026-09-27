"""Battle (draft) — "Under the Broken Sun": the anime OP (欠けた太陽, round 1's guitar
version) turned into a battle theme. DRAFT: an audition, not wired into the game.

150 bpm, E minor. The band is a J-rock band (Karoryfer Emilyguitar through
engine/guitar.py: double-tracked distorted rhythm, palm mutes, a singing lead; the
Growlybass; the Virtuosity kit) and the choir is the house Sonatina chorus on "ah".

  intro 1-4    the OP's kime: C, D, Bm struck and pushed, then the Empire drill in unison
  A     5-12   the hook: the Thread high on the lead guitar, the choir holding chords
  B     13-20  the verse tune on the lead; under it the low choir CHANTS the Empire's
               drill (E-F-E-D, falling to C; then on A, A-Bb-A-G) against palm mutes
  C     21-28  the B-melo in half time, the choir swelling; bar 28 a hit and an
               accelerating snare roll, the choir's pickup over it
  D     29-44  the sabi: the CHOIR sings the tune (the Thread on its first four notes),
               sopranos and tenors in octaves; the lead guitar harmonises a third
               below; a pumping pad underneath (the round-2 sidechain)
  E     45-52  a new strain, the choir's own: a hymn over palm mutes alone (the Thread
               augmented, a note a bar), then the band crashes back in under it
  F     53-56  the turnaround is the Hollow Sun: choir and lead climb to D#, the
               leading tone, the band cuts on 56's downbeat, and three beats of silence
               stand where E should be; the loop comes back on C

Calm layer (same timeline): the tune on a clean chorused guitar, clean arpeggios, a
string pad, the clean bass, brushes-light drums. No distortion, no choir.
"""

from engine.patterns import Kit, arp, chart, pad, pad_under
from engine.score import Score

from scores._battle import Battle

KEY = 'music_battle_broken_sun'
DRAFT = True   # an audition: build.py --all leaves it out; not in musicConfig
BAR = 4.0

# ------------------------------------------------------------------ the tunes (from the OP)
HOOK = ('B4:0.5 E5:0.5 F#5:0.5 B5:1.5 A5:0.5 G5:0.5 | F#5:1.5 E5:0.5 F#5:1 A5:1 |'
        ' B5:1.5 A5:0.5 F#5:1 D5:1 | E5:3 r:1 |')
HOOK2 = ('B4:0.5 E5:0.5 F#5:0.5 B5:1.5 A5:0.5 G5:0.5 | F#5:1.5 E5:0.5 F#5:1 A5:1 |'
         ' B5:1.5 A5:0.5 F#5:1 D#5:1 | E5:2 r:2 |')
VERSE = ('r:0.5 B3:0.5 E4:0.5 E4:0.5 F#4:0.5 G4:0.5 F#4:0.5 E4:0.5 D4:1.5 r:1 E4:0.5 G4:0.5 '
         'A4:1 G4:0.5 F#4:0.5 E4:2.5 r:3 B3:0.5 E4:0.5 E4:0.5 F#4:0.5 G4:0.5 A4:0.5 G4:0.5 '
         'F#4:1 r:0.5 B4:0.5 A4:0.5 G4:0.5 F#4:0.5 G4:0.5 F#4:0.5 E4:0.5 E4:1.5 C4:1.5 r:4.5 '
         'E4:0.5 G4:0.5')
PRE = ('G4:1 A4:1 B4:1 G4:0.5 D5:1 C5:0.5 B4:1 A4:2 G4:1 A4:1 B4:1 G4:0.5 E5:1 D5:0.5 B4:1 '
       'B4:2 G4:0.5 A4:0.5 B4:1 B4:0.5 C5:0.5 D5:0.5 E5:1 D5:1.5 B4:0.5 D5:0.5 E5:0.5 F#5:1 '
       'E5:1.5 F#5:0.5 E5:0.5 E5:0.5 D#5:0.5 B4:1.5 r:0.5')
# the sabi, from its pickup (bar 28 beat 3) to the end of bar 42
CHORUS = ('B3:0.5 E4:0.5 F#4:0.5 B4:1.5 A4:0.5 G4:0.5 G4:0.5 E4:1 A4:1 B4:0.5 D5:0.5 E5:1 '
          'F#5:1 E5:1 D5:2.5 r:1.5 G4:0.5 A4:0.5 B4:1 D5:0.5 D5:0.5 E5:1 r:0.5 E5:0.5 E5:0.5 '
          'D5:0.5 E5:1 G5:1 F#5:1 E5:0.5 D5:0.5 D5:0.5 r:0.5 B4:1.5 r:2 F#4:0.5 A4:0.5 B4:1 '
          'B4:0.5 D5:0.5 E5:0.5 D5:0.5 B4:1 r:1.5 E5:0.5 E5:0.5 F#5:0.5 G5:0.5 F#5:2.5 r:1 '
          'D5:0.5 E5:1 D5:0.5 B4:1 D5:0.5 E5:0.5 F#5:0.5 E5:1.5 r:1.5 B4:0.5 D5:0.5 E5:1 D5:0.5 '
          'E5:0.5 F#5:5.5 r:1')
# E: the choir's own strain. The Thread augmented across 49-52 (B E F# B)
HYMN = ('B4h. A4q | G4h E5h | E5h. D5q | D#5w |'
        ' B4w | E5h. D5q | F#5h A5h | B5h B4h |')
HYMN_CH = 'Em C Am B Em C D B'
# F: the Hollow Sun, climbing to the leading tone and cut there
HOLLOW = 'A4h B4h | C5h. B4e C5e | D#5w~ | D#5q r:3 |'

CH = {
    'intro': 'C D Bm Em',
    'A': 'C D Bm Em C D B7sus4:2 B7:2 Em',
    'B': 'Em C Em D Em C Am B',
    'C': 'C D Em Em/D Cmaj7 D B7sus4:2 B7:2 B7',
    'D': 'C D Bm Em C D G:2 D#dim7:2 Em C D Bm Em Am D B7sus4:2 B7:2 Em',
    'E': HYMN_CH,
    'F': 'Am C B B',
}
START = {'intro': 1, 'A': 5, 'B': 13, 'C': 21, 'D': 29, 'E': 45, 'F': 53}


def timeline():
    out = []
    for sec, bar in START.items():
        t = (bar - 1) * BAR
        for c, beats in chart(CH[sec]):
            out.append((t, beats, c))
            t += beats
    return out


TL = timeline()


def chord_at(beat):
    for t, d, c in TL:
        if t - 1e-9 <= beat < t + d - 1e-9:
            return c
    return TL[-1][2]


def power(c, low=False):
    """Power-chord voicing for a Chord: root in E2..Eb3 (low: C2..B2, two notes)."""
    if low:
        r = 36 + c.root % 12
        return [r, r + (6 if c.symbol.startswith('D#dim') else 7)]
    r = 40 + (c.root - 4) % 12
    if c.symbol.startswith('D#dim'):
        return [51, 57, 63]
    if 'sus4' in c.symbol:
        return [r, r + 5, r + 7]
    return [r, r + 7, r + 12]


def bass_key(c):
    return 28 + (c.bass - 4) % 12


def strum(part, t, dur, notes, vel):
    for i, p in enumerate(notes):
        part.note(t + i * 0.014, p, max(0.05, dur - i * 0.014), vel=vel)


def events(bars, steps, push=True, gate=0.92):
    """Strums on `steps` over `bars`; with `push`, a chord change on a downbeat is struck
    on the 4& before, tied over, and not struck again on the downbeat."""
    evs = []
    for bar in bars:
        b0 = (bar - 1) * BAR
        for i, p in enumerate(steps):
            t = b0 + p
            nxt = b0 + steps[i + 1] if i + 1 < len(steps) else b0 + BAR
            c = chord_at(t)
            acc = p in (0.0, 2.0)
            if push and abs(p - 3.5) < 1e-9 and (bar + 1) in bars \
                    and chord_at(b0 + BAR).symbol != c.symbol:
                c, acc = chord_at(b0 + BAR), True
            evs.append([t, nxt - t, c, acc])
    out = []
    for e in evs:
        on_bar = abs(e[0] / BAR - round(e[0] / BAR)) < 1e-9
        if push and out and on_bar and out[-1][2].symbol == e[2].symbol \
                and abs(out[-1][0] % BAR - 3.5) < 1e-9:
            out[-1][1] += e[1]
            continue
        out.append(e)
    return [(t, d * gate, c, a) for t, d, c, a in out]


def third_below(p, c):
    """A diatonic third under p in E minor (D# where the chord has it), moved onto a
    chord tone of c when it would not be one."""
    scale = {4, 6, 7, 9, 11, 0, 2}
    if 3 in c.pcs:
        scale = (scale - {2}) | {3}
    q = p - 1
    steps = 0
    while steps < 2:
        if q % 12 in scale:
            steps += 1
            if steps == 2:
                break
        q -= 1
    if q % 12 not in c.pcs:
        for d in (1, -1, 2, -2):
            if (q + d) % 12 in c.pcs and q + d < p:
                return q + d
    return q


def build():
    s = Score('battle_broken_sun', tonic='E', bpm=150, intro_bars=4, loop_bars=52,
              title='Under the Broken Sun', seed=151)
    s.reverb = dict(rt60=1.9, predelay_ms=24, wet_db=-1.5, room_db=-4)
    s.master = dict(lufs=-14.0, glue_ratio=1.6, lead_duck=2.0)
    b = Battle(s, calm_lufs=-17.0, full_lufs=-14.0)
    for sec, bar in START.items():
        b.section(sec, bar, chart(CH[sec]))
    # the Hollow Sun's silence: bar 56 is struck on its downbeat only
    s.silent_ok = set()

    amp_rhythm = dict(rig=True, gain_db=26, mid_hz=650, mid_db=1.5, bias=0.3, treble_db=1.0)
    amp_pm = dict(rig=True, gain_db=24, palm=True, mid_db=1.0, bias=0.3, treble_db=0.5)
    amp_lead = dict(rig=True, gain_db=31, tight=160, mid_hz=850, mid_db=4.5, bias=0.2,
                    treble_db=2.0, presence_db=2.0, delay_mix=0.16, delay_s=0.3, delay_fb=0.32)
    # the chorus LFO turns a whole number of times per loop (67 cycles in 52 bars), so the
    # loop seam matches
    loop_s = 52 * 4 * 60 / 150
    amp_clean = dict(rig=True, gain_db=-8, stages=1, bias=0.05, tight=90, mid_db=0,
                     treble_db=2.0, chorus_mix=0.5, chorus_rate=67 / loop_s, delay_mix=0.12,
                     delay_s=0.3)

    # ------------------------------------------------ full: the band and the choir
    gL = b.part('gtr_L', 'egtr', layer='full', role='section', pan=-0.9, width=0.0,
                amp=amp_rhythm, reverb=0.06)
    gR = b.part('gtr_R', 'egtr2', layer='full', role='section', pan=0.9, width=0.0,
                amp=amp_rhythm, reverb=0.06)
    pL = b.part('pm_L', 'egtr_pm', layer='full', role='section', pan=-0.8, width=0.0,
                amp=amp_pm, reverb=0.04, gain=-1.0)
    pR = b.part('pm_R', 'egtr_pm2', layer='full', role='section', pan=0.8, width=0.0,
                amp=amp_pm, reverb=0.04, gain=-1.0)
    lead = b.part('lead', 'egtr', layer='full', role='lead', pan=0.05, width=0.0, amp=amp_lead,
                  reverb=0.18, humanize_ms=3)
    bass = b.part('ebass', 'rbass', layer='full', role='bass', duck='kit_kick')
    sop = b.part('choir_sop', 'choir', layer='full', role='lead', gain=0.0)
    ten = b.part('choir_ten', 'choir', layer='full', role='lead2', gain=-3.0)
    chords = b.part('choir_pad', 'choir', layer='full', role='choir', gain=-2.0)
    low = b.part('choir_low', 'choir', layer='full', role='lead2', gain=0.0)
    ppad = b.part('pump_pad', 'saw_pad', layer='full', role='pad', gain=-5.0,
                  eq=[('peak', 2600, 0.7, -4.0)])
    # faders (dB by bar): where the choir has the tune, the guitars make room for it. The
    # loop's points wrap (bar 56.9 glides back to bar 5's level through the silent bar)
    lead.opts['fader'] = [(1, 0), (5, 0), (28.4, 0), (28.5, -7), (42.9, -7), (43, -1),
                          (44.9, -1), (45, -5), (52.9, -5), (53, -2), (56.5, -2), (56.9, 0)]
    for g in (gL, gR):
        g.opts['fader'] = [(1, 0), (5, 0), (28.9, 0), (29, -2), (44.9, -2), (45, -2.5),
                           (52.9, -2.5), (53, -1), (56.5, -1), (56.9, 0)]
    sop.opts['gain'] = 3.0
    ten.opts['gain'] = -1.5
    b.kit = Kit(s, 'kit', gains={'kick': 1.0, 'snare': 1.0, 'toms': 0.0, 'cym': 1.0})
    b.full_only.update(b.kit.names())
    kit = b.kit

    # ------------------------------------------------ calm: clean guitars, pad, bass, light kit
    ctune = b.part('c_tune', 'egtr3', layer='calm', role='lead', pan=0.1, width=0.8,
                   amp=amp_clean, reverb=0.3)
    carp = b.part('c_arp', 'egtr', layer='calm', role='keys', pan=-0.35, width=0.8,
                  amp=amp_clean, reverb=0.3, gain=-3.0)
    cpad = b.part('c_pad', 'violas', layer='calm', role='pad', art='soft', gain=-2.0)
    cbass = b.part('c_bass', 'rbass_clean', layer='calm', role='bass', duck='ckit_kick')
    b.calm_kit = Kit(s, 'ckit', gains={'kick': -3.0, 'snare': -5.0, 'cym': -6.0})
    b.calm_only.update(b.calm_kit.names())
    ckit = b.calm_kit

    def rhythm(bars, steps=None, push=True, gate=0.92, vel=0.74, acc=0.86, parts=(gL, gR),
               low=False, dur=None):
        for t, d, c, a in events(list(bars), steps or [i * 0.5 for i in range(8)], push, gate):
            for i, part in enumerate(parts):
                strum(part, t + 0.01 * i, dur or d, power(c, low), acc if a else vel)

    def bassline(part, bars, steps=None, push=True, gate=0.9, vel=0.7, acc=0.82):
        for t, d, c, a in events(list(bars), steps or [i * 0.5 for i in range(8)], push, gate):
            part.note(t, bass_key(c), d, vel=acc if a else vel)

    def hits(bar, spec, vel=0.9):
        b0 = (bar - 1) * BAR
        for p, d in spec:
            c = chord_at(b0 + p)
            for i, part in enumerate((gL, gR)):
                strum(part, b0 + p + 0.01 * i, d, power(c), vel)
            bass.note(b0 + p, bass_key(c), d, vel=vel)

    def drill(part_list, bar, notes, vel=0.9, low=True):
        b0 = (bar - 1) * BAR
        for (p, d), key in zip(((0, 1.5), (1.5, 0.5), (2.0, 1.0), (3.0, 1.0)), notes):
            for i, part in enumerate(part_list):
                strum(part, b0 + p + 0.01 * i, d * 0.95, [key, key + 7] if low else
                      [key, key + 7, key + 12], vel)

    # ================================================= intro 1-4: the kime
    hits(1, [(0, 1.0), (1.5, 0.5), (2.5, 0.75), (3.5, 1.5)])
    hits(2, [(1.5, 0.5), (2.5, 0.75), (3.5, 1.5)])
    hits(3, [(1.5, 0.5), (2.5, 0.5)])
    drill((gL, gR), 4, (40, 41, 40, 38), low=False)
    for (p, d), k in zip(((0, 1.5), (1.5, 0.5), (2.0, 1.0), (3.0, 1.0)), (40, 41, 40, 38)):
        bass.note(3 * BAR + p, k, d * 0.95, vel=0.9)
    lead.at(1).play('@f B5:1~ B5:0.5 A5:0.5 G5:0.5 A5:1~ A5:0.5 | A5:1.5 G5:0.5 F#5:0.5 '
                    'F#5:1.5~ | F#5:1.5 E5:0.5 D5:0.5 r:1.5 | @ff E5:1.5 F5:0.5 E5:1 D5:1 |')
    low.at(4).play('@f E3:1.5 F3:0.5 E3:1 D3:1 |')
    K = kit.play
    K(1, {'kick': 'X.....x...x...X.', 'snare': 'x.....x...x...x.', 'crash': 'X.............X.',
          'hat': 'o.o.o.o.o.o.o.o.'})
    K(2, {'kick': '......x...x...X.', 'snare': '......x...x...x.', 'crash': '..............X.',
          'hat': 'o.o.o.o.o.o.o.o.'})
    K(3, {'kick': '......x...x.....', 'snare': '......x...x.xxxx', 'hat': 'o.o.o.o.o.o.....'},
      ramp=0.2)
    K(4, {'kick': 'X.....x.x...x...', 'snare': 'X.....x.x...x...', 'crash': 'X.......x.......'})
    # calm intro: the kime as soft ringing chords, the drill on the clean bass
    for bar, spec in ((1, [(0, 1.5), (3.5, 2.0)]), (2, [(3.5, 2.0)]), (3, [(1.5, 1.0)])):
        for p, d in spec:
            c = chord_at((bar - 1) * BAR + p)
            strum(carp, (bar - 1) * BAR + p, d, [x + 12 for x in power(c)], 0.6)
    cbass.at(1).play('@mf C2:3.5 D2:0.5~ | D2:3.5 B1:0.5~ | B1:4 | E2:1.5 F2:0.5 E2:1 D2:1 |')
    ctune.at(1).play('@mf B5:3 A5:1 | A5:2 F#5:2 | F#5:2 D5:2 | E5:1.5 F5:0.5 E5:1 D5:1 |')
    ckit.play(4, {'kick': 'x.......x.......', 'stick': '....x.......x...'}, vel=0.5)

    # ================================================= A 5-12: the hook
    lead.at(5).play('@ff ' + HOOK + ' ' + HOOK2)
    rhythm(range(5, 12))
    hits(12, [(0, 0.45), (0.5, 0.45), (1.0, 0.45), (1.5, 0.45), (2.5, 0.4), (3.0, 0.4)])
    bassline(bass, range(5, 12))
    pad(chords, 5, b.chart('A'), n=4, lo=52, hi=71, vel=0.55)
    chords.expr((5, 0.7), (11, 0.9), (12.9, 0.9))
    DRIVE = {'kick': 'x.....x.x.....x.', 'snare': '....x.......x...', 'ride': 'X.x.X.x.X.x.X.x.'}
    for bar in range(5, 12):
        K(bar, {**DRIVE, **({'crash': 'X...............'} if bar in (5, 9) else {})})
    K(12, {'kick': 'x.x.x.x...X.X...', 'snare': '....x.....X.X...', 'crash': 'X.........X.....',
           'ride': 'x.x.x.x.........'})
    ctune.at(5).play('@mf ' + HOOK + ' ' + HOOK2)

    # ================================================= B 13-20: the verse, the chanted drill
    lead.at(13).play('@f ' + VERSE)
    for bar in range(13, 21):
        b0 = (bar - 1) * BAR
        c = chord_at(b0)
        if c.symbol == 'Em':
            seq = [40, 40, 40, 41, 40, 40, 38, 38]      # the drill, E E E F | E E D D
        elif c.symbol == 'Am':
            seq = [45, 45, 45, 46, 45, 45, 43, 43]      # the drill on A: A A A Bb | A A G G
        else:
            seq = [power(c, True)[0]] * 8
        for i, r in enumerate(seq):
            for j, part in enumerate((pL, pR)):
                strum(part, b0 + i * 0.5 + 0.01 * j, 0.28, [r, r + 7],
                      0.84 if i in (0, 3) else 0.68)
            bass.note(b0 + i * 0.5, r if r < 44 else r - 12, 0.4, vel=0.8 if i in (0, 3) else 0.64)
    # the low choir chants it (tenors and basses in octaves), a word a note
    CHANT = {'Em': 'E3:1.5 F3:0.5 E3:1 D3:1', 'C': 'C3:3 r:1', 'D': 'D3:3 r:1',
             'Am': 'A2:1.5 Bb2:0.5 A2:1 G2:1', 'B': 'B2:3 r:1'}
    for bar in range(13, 21):
        text = CHANT[chord_at((bar - 1) * BAR).symbol]
        low.at(bar).play('@f ' + text + ' |')
    for bar in range(13, 21):
        K(bar, {'kick': 'x.x...x.x.x...x.', 'snare': '....x.......x...',
                'hat': 'x.X.x.X.x.X.x.X.'} if bar not in (16, 20) else
          {'kick': 'x.......x...X.X.', 'snare': '....x.......X.X.', 'hat': 'x.x.x.x.x.x.....',
           'crash': '............X...'}, vel=0.74)
    K(13, {'crash': 'X...............'}, vel=0.8)
    ctune.at(13).play('@mf ' + VERSE)

    # ================================================= C 21-28: the B-melo, half time
    lead.at(21).play('@f ' + PRE)
    rhythm(range(21, 25), steps=[0.0, 2.5], push=False, gate=0.97, vel=0.76, acc=0.82)
    rhythm(range(25, 27), steps=[0.0, 1.0, 2.0, 3.0], push=False, gate=0.9, vel=0.76, acc=0.84)
    rhythm([27], push=False, gate=0.85, vel=0.78, acc=0.88)
    bassline(bass, range(21, 25), steps=[0.0, 2.5, 3.5], push=False, vel=0.72, acc=0.8)
    bassline(bass, range(25, 28), push=False, vel=0.7, acc=0.82)
    hits(28, [(0, 1.0)], vel=0.95)
    pad(chords, 21, b.chart('C'), n=4, lo=52, hi=72, vel=0.6)
    chords.expr((21, 0.55), (27, 1.0), (28, 1.0), (28.3, 0.0), (28.95, 0.0), (29, 1.0))
    HALF = {'kick': 'x.........x.....', 'snare': '........x.......', 'ride': 'x...x...x...x...'}
    for bar in range(21, 25):
        K(bar, {**HALF, **({'crash': 'X...............'} if bar in (21, 23) else {})}, vel=0.72)
    for bar in (25, 26):
        K(bar, {**HALF, 'tom_lo': 'x.x.x.x.x.x.x.x.', 'crash': 'X.......'}, vel=0.76, ramp=0.2)
    K(27, {'kick': 'x...x...x...x...', 'snare': 'x.x.x.x.xxxxxxxx', 'crash': 'X...............'},
      vel=0.8, ramp=0.35)
    K(28, {'kick': 'X...............', 'crash': 'X...............'}, vel=0.84)
    # an accelerating roll: eighths, triplets, sixteenths, sextuplets
    sn = kit.parts['snare']
    ts = [0, 0.5] + [1 + i / 3 for i in range(3)] + [2 + i / 4 for i in range(4)] + \
        [3 + i / 6 for i in range(6)]
    for i, t in enumerate(ts):
        sn.note(27 * BAR + t, 38, 0.1, vel=0.4 + 0.58 * (i / (len(ts) - 1)) ** 1.3)
    ctune.at(21).play('@mf ' + PRE)

    # ================================================= D 29-44: the choir sings the sabi
    sop.at(28).play('r:2 @f ' + CHORUS)
    ten.at(28).play('r:2 @f ' + CHORUS, transpose=-12)
    sop.expr((28, 0.85), (33, 0.9), (41, 1.0), (44.9, 1.0))
    # the lead guitar a third below, then a fill over the dominant
    for n in list(sop.notes):
        if n.start >= 28 * BAR:
            lead.note(n.start, third_below(n.pitch, chord_at(n.start)), n.dur, vel=0.8)
    lead.at(43).play('@ff F#5:0.5 A5:0.5 B5:1 A5:0.5 F#5:0.5 D#5:1 | E5:1 B4:0.5 E5:0.5 '
                     'G5:1.5 r:0.5 |')
    rhythm(range(29, 44))
    hits(44, [(0, 1.8)], vel=0.95)
    bassline(bass, range(29, 44))
    pad(chords, 43, chart('B7sus4:2 B7:2 Em:2'), n=4, lo=52, hi=72, vel=0.66)
    pad(ppad, 29, b.chart('D'), n=4, lo=48, hi=72, vel=0.6)
    ppad.opts['pump'] = dict(beats=[(bb - 1) * BAR + q for bb in range(29, 45) for q in range(4)],
                             depth_db=9.0, release=0.3)
    CHORUS_BEAT = {'kick': 'x.....x.x.....x.', 'snare': '....x.......x...',
                   'ride': 'X.x.X.x.X.x.X.x.'}
    for bar in range(29, 44):
        g = dict(CHORUS_BEAT)
        if bar in (29, 33, 37, 41):
            g['crash'] = 'X...............'
        if bar == 35:
            g['kick'] = 'x.....x.X.....x.'
            g['crash'] = '........X.......'
        if bar in (32, 36, 40):
            g['snare'] = '....x.......x.xx'
        if bar == 43:
            g = {'kick': 'x.....x.X.......', 'snare': '....x...X...xxxx', 'ride': 'X.x.X.x.',
                 'tom_hi': '..........xx....', 'crash': '........X.......'}
        K(bar, g, vel=0.82)
    K(44, {'kick': 'X...............', 'crash': 'X...............', 'snare': 'X...........'},
      vel=0.86)
    ctune.at(28).play('r:2 @mf ' + CHORUS)
    ctune.at(43).play('@mf F#5:0.5 A5:0.5 B5:1 A5:0.5 F#5:0.5 D#5:1 | E5:2 r:2 |')

    # ================================================= E 45-52: the choir's hymn
    sop.at(45).play('@mf ' + HYMN)
    sop.expr((45, 0.6), (48.9, 0.8), (49, 1.0), (52.9, 1.0))
    pad_under(chords, 45, chart(HYMN_CH), sop, n=3, lo=45, gap=2, vel=0.6)
    chords.expr((45, 0.6), (48.9, 0.8), (49, 1.0), (52.9, 1.0))
    ten.at(49).play('@f ' + ' | '.join(HYMN.split('|')[4:]), transpose=-12)
    # 45-48: the choir alone over palm mutes and a kick in quarters
    rhythm(range(45, 49), push=False, gate=0.5, parts=(pL, pR), low=True, vel=0.62, acc=0.78,
           dur=0.28)
    for bar in range(45, 49):
        K(bar, {'kick': 'x...x...x...x...'}, vel=0.6 + 0.04 * (bar - 45))
    K(48, {'snare': '............xxxx', 'tom_lo': '........x.x.....'}, vel=0.7, ramp=0.3)
    # 49-52: the band crashes back in under it; the lead a descant over the hymn
    rhythm(range(49, 53))
    bassline(bass, range(45, 53), push=False, vel=0.66, acc=0.8)
    lead.at(49).play('@f E5:2 D#5:1 E5:1 | G5:3 E5:1 | F#5:2 D5:2 | D#5:2 F#5:2 |')
    for bar in range(49, 53):
        K(bar, {**CHORUS_BEAT, **({'crash': 'X...............'} if bar == 49 else {})}, vel=0.84)
    ctune.at(45).play('@mf ' + HYMN)

    # ================================================= F 53-56: the Hollow Sun
    sop.at(53).play('@ff ' + HOLLOW)
    ten.at(53).play('@f ' + HOLLOW, transpose=-12)
    lead.at(53).play('@ff ' + HOLLOW)
    pad_under(chords, 53, chart('Am C B B:1'), sop, n=3, lo=45, gap=2, vel=0.66)
    rhythm(range(53, 56), push=False)
    bassline(bass, range(53, 56), push=False)
    hits(56, [(0, 1.0)], vel=1.0)
    for bar in (53, 54):
        K(bar, dict(CHORUS_BEAT), vel=0.84)
    K(55, {'kick': 'x.x.x.x.x.x.x.x.', 'snare': 'x.x.x.x.xxxxxxxx', 'crash': 'X...............'},
      vel=0.8, ramp=0.4)
    K(56, {'kick': 'X...', 'snare': 'X...', 'crash': 'X...', 'tom_lo': 'X...'}, vel=0.95,
      step=0.25)
    kit.parts['cym'].expr((1, 1.0), (56.3, 1.0), (56.45, 0.0), (56.95, 0.0), (57, 1.0))
    ctune.at(53).play('@mf ' + HOLLOW)

    # ================================================= the calm bed (every section)
    ARP = {'A': ('0 2 4 3 5 4 3 2', 0.5), 'B': ('0 2 4 3 5 4 3 2', 0.5),
           'C': ('0 1 2 3 4 3 2 1', 0.5), 'D': ('0 2 4 2', 1.0), 'E': ('0 2 4 3', 1.0),
           'F': ('0 2 4 2', 1.0)}
    for sec, (patt, step) in ARP.items():
        arp(carp, START[sec], b.chart(sec), pattern=patt, step=step, lo=52, hi=79,
            dur=step * 2.2, vel=0.5)
        pad(cpad, START[sec], b.chart(sec), n=3, lo=50, hi=69, vel=0.45, art='soft')
        bassline(cbass, range(START[sec], START[sec] + b._bars(sec)),
                 steps=[0.0, 2.0] if sec in ('C', 'E') else [0.0, 1.5, 2.5],
                 push=sec in ('A', 'D'), vel=0.6, acc=0.68)
    for bar in range(5, 56):
        half = 21 <= bar <= 28 or 45 <= bar <= 48
        ckit.play(bar, {'kick': 'x.........x.....' if half else 'x.......x.x.....',
                        'stick': '........x.......' if half else '....x.......x...',
                        'hat': 'x.x.x.x.x.x.x.x.'}, vel=0.5)
    ckit.play(56, {'kick': 'x...', 'stick': 'x...'}, vel=0.6, step=0.25)
    return b.finish()
