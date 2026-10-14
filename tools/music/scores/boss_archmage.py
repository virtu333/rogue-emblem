"""The Archmage — "The Sums Still Balance".

Act II boss. The Archmage, Keeper of the Middle Pages: he keeps the ritual's
middle pages and swears the summoning can still be steered, and he has said so
since long past the hour it could be. He talks in models and iterations
("Half integrity lost... recalculating"). Under his sums Sera finds a page
pressed hard enough to tear: NOT WAKING. BEING FED. He knew, and he kept on
doing sums. (Title: his last words in a later run, "the sums still balance.
I simply am not among them.") 152 bpm, 4/4, E minor.

Mechanism: A CALCULATION, AND WHAT IT FEEDS.

  * The tune is a palindrome. Its eight bars read the same backwards, notes
    and rhythm: E F# G B, A G F# D# (the encounter card's figure E F# G B,
    slowed down, then a fall to the leading tone) | a low climb F# A B C, D#
    E A to C | then the same notes backwards, from C down and out on E. The
    middle page is the bar line between bars 4 and 5: the high C is struck on
    each side of it. The harmony under the mirror is not mirrored (bar 4's A
    minor becomes bar 5's F, the flat second, under the same C).
  * The palindrome is built from a line (bars 1-2) and a counterpoint to it
    (written backwards as bars 3-4), every pair of notes a third or a sixth.
    So the tune against itself started at its middle page is a strict crab
    canon: each half meets its own retrograde in consonance. That is the
    fold (strain C): the book closed on its middle page, the tune in the
    violins and trumpets, the tune from bar 5 in the horns, trombones and
    celli a register below. The fold's harmony is a palindrome too.
  * The count: a marimba in sixteenths works a sum. Each group runs up the
    chord's scale from its root, one note longer than the last (3, 4, 5 ... 10,
    then 12), so the accents spread out across four bars and snap back: the
    working starts over every four bars, never finished. In the fold a
    celesta plays the marimba's eight bars exactly backwards (groups
    shrinking, runs falling, each landing on its root), a crab canon of the
    count.
  * BEING FED: a low swell the calculation never acknowledges. It is there
    from the first bar (the basses on a low E) and grows strain by strain in
    weight and in pitches (E; then the tuba's F, a semitone above; then the
    trombones' B-flat, the tritone, and low oohs on E and F; then the cluster
    and a timpani roll), each strain from where the last left it. Nothing in
    the band answers it. At the loop's turn it is cut dead on the third beat
    ("recalculating"), and in the hole the marimba and celesta tap the card's
    figure (E F# G B) twice: the loop restarts clean, the swell back at a whisper.

Form (bars): intro 1-4 (the count alone over the low E, then the cut and the
card's figure) | A1 5-12 (the palindrome: violins with a piano in octaves;
the swell's low E) | A2 13-20 (horns double it below, glockenspiel above, a
counter-line in clarinet and second violins that sings above the tune where
it dips, harp counting with the marimba; the tuba's F joins the swell) | B
21-28 (the model: a new tune that counts too, one note in its first bar, two
in its second ... eight eighths in its last, horns and celli, violins and
clarinet from bar 25, the drums building with it; trombones and oohs join
the swell) | C 29-36 (the fold:
the crab canon, the count against its retrograde, the middle page at bar
33; the swell's cluster and timpani) | T 37-44 (recalculating: the tune's
first line again, then again an octave higher, then only its first bar,
then half of it, stuck on E, while the swell takes the foreground and lands
on F; cut on bar 44's third beat). Loop 5-44, 40 bars.

enrage_archmage: it answers. On every downbeat the thing being fed strikes
back (a low E-F cluster in tuba and trombones over a bass drum) and then
breathes in through the bar (low oohs swelling into the next downbeat), so
every bar of the calculation begins under it.
"""

from engine.patterns import Kit, bass, chart, drums, ostinato, pad
from engine.score import Score
from engine.theory import pc as parse_pc
from scores._battle import Battle

KEY = 'music_boss_archmage'

# ------------------------------------------------------------------ the palindrome
# H1 (bars 1-2) and CP, a counterpoint to it note against note (the same rhythm,
# every pair a third or a sixth: E/C, F#/A, G/E, B/D#, A/C, G/B, F#/A, D#/F#).
# The tune is H1 | CP backwards | CP | H1 backwards: a palindrome, and the tune
# against itself from bar 5 is H1 against CP throughout (a crab canon).
H1 = [('E5', 1.5), ('F#5', 0.5), ('G5', 1), ('B5', 1),
      ('A5', 0.5), ('G5', 0.5), ('F#5', 1), ('D#5', 2)]
CP = [('C6', 1.5), ('A5', 0.5), ('E5', 1), ('D#5', 1),
      ('C5', 0.5), ('B4', 0.5), ('A4', 1), ('F#4', 2)]
TUNE = H1 + CP[::-1] + CP + H1[::-1]

DUR = {0.25: 's', 0.5: 'e', 1: 'q', 1.5: 'q.', 2: 'h', 3: 'h.', 4: 'w'}


def text(notes):
    """[(pitch, beats)] -> a note string with bar checks."""
    out, pos = [], 0.0
    for p, d in notes:
        out.append(f'{p}{DUR[d]}')
        pos += d
        if abs(pos % 4) < 1e-9:
            out.append('|')
    return ' '.join(out)


THEME = text(TUNE)
assert [p for p, _ in TUNE] == [p for p, _ in TUNE[::-1]], 'the tune must read the same backwards'

# B: the model. A tune that counts: one note in its first bar, two in its second,
# ... eight eighths in its last (and the bass with it)
MODEL = ('B4w | A4h D5h | F#5h E5q D5q | G5q F#5q E5q B4q | C5q. B4e A4q E5e G5e | '
         'F#5q E5e F#5e A5q G5e F#5e | A5q G5e A5e B5e C6e B5e A5e | '
         'B5e A5e G5e F#5e E5e F#5e G5e A5e |')
MODEL_BASS = ('C2w | D2h A1h | B1h F#2q B1q | E2q B1q E2q G2q | A1q. E2e A2q E2e G2e | '
              'D2q A1e D2e F#2q A2e D2e | F2q C2e F2e A2e C3e F2e C2e | '
              'B1e B2e A2e F#2e D#2e F#2e A2e B2e |')

# A2's counter-line, above the tune where it dips, below it elsewhere
COUNTER = ('B4h G4h | C5h B4h | D5q. E5e F#5h | F#5q G5q E5h | F5h G5q F#5q | E5h F#5h | '
           'B4h A4h | G4w |')

# T: recalculating. The first line, again an octave up, then its first bar,
# then half of it, then E alone (cut on beat 3 of the last bar)
RECALC = ('E5q. F#5e G5q B5q | A5e G5e F#5q D#5h | E6q. F#6e G6q B6q | A6e G6e F#6q D#6h | '
          'E5q. F#5e G5q B5q | E5q. F#5e G5q B5q | E5q. F#5e E5q. F#5e | E5h rh |')
# the encounter card's figure (D E F A, sounding E F# G B), twice: the restart
CARD = 'E5s F#5s G5s B5s E5s F#5s G5s B5s'

CH_INTRO = chart('Em:4 Em:4 Cmaj7:2 B7:2 Fmaj7:2')
CH_A = chart('Em:4 Cmaj7:2 B:2 D:4 B7:1 Em:1 Am:2 Fmaj7:2 Em:1 B7:1 Am:2 D:2 B7:4 Em:2 Cmaj7:2')
CH_B = chart('Cmaj7 D Bm7 Em7 Am7 D Fmaj7 B7')
_FOLD = 'C:2 Em:1 B:1 Am:1 D:1 B:2 B:2 D:1 Am:1 B:1 Em:1 C:2'   # a palindrome
CH_C = chart(_FOLD + ' ' + _FOLD)
CH_T = chart('Em:4 Cmaj7:2 B:2 Em:4 Cmaj7:2 B:2 Em:2 Cmaj7:2 Em:2 Cmaj7:2 Em:2 Cmaj7:2 Fmaj7:2')

INTRO, A1, A2, B, C, T = 1, 5, 13, 21, 29, 37
END = 45            # loop end (bar 44's third beat is the cut)
CUT = 44.5          # bar position of the cut

# the scale each group of the count runs up, per chord
_SC = {
    'Em': 'E F# G A B C D#', 'Em7': 'E F# G A B C D', 'C': 'C D E F# G A B',
    'B': 'B C D# E F# G A', 'D': 'D E F# G A B C', 'Am': 'A B C D E F# G',
    'F': 'F G A B C D E', 'Bm': 'B C D E F# G A',
}
SCALES = {'Em': _SC['Em'], 'Em7': _SC['Em7'], 'C': _SC['C'], 'Cmaj7': _SC['C'],
          'B': _SC['B'], 'B7': _SC['B'], 'D': _SC['D'], 'Am': _SC['Am'],
          'Am7': _SC['Am'], 'F': _SC['F'], 'Fmaj7': _SC['F'], 'Bm7': _SC['Bm']}

# ------------------------------------------------------------------ drums (16 steps a bar)
G_A1 = {'kick': 'x.......x.x.....', 'snare': '....x.......x...', 'hat': 'x.x.x.x.x.x.x.x.'}
G_A2 = {'kick': 'x.....x.x.......', 'snare': '....X.......X...', 'hat': 'x.x.x.x.x.x.x.x.'}
G_C = {'kick': 'x.x...x.x.x...x.', 'snare': '....X.......X...', 'ride': 'X.x.X.x.X.x.X.x.'}
FILL = {'kick': 'x.....x.x.......', 'snare': '....X.....x.xxXX', 'tom_mid': '..........x.....'}
G_B = (
    {'kick': 'x.........x.....', 'snare': '........X.......', 'hat': 'x...x...x...x...'},
    {'kick': 'x.......x.x.....', 'snare': '....X.......X...', 'hat': 'x.x.x.x.x.x.x.x.'},
    {'kick': 'x.....x.x.....x.', 'snare': '....X.......X...', 'hat': 'x.xxx.xxx.xxx.xx'},
    {'kick': 'x.x.x.x.x.x.x.x.', 'snare': '....X.......X..x', 'hat': 'xxxxxxxxxxxxxxxx'},
)
B_FILL = {'kick': 'x.x.x.x.x.......', 'snare': 'x.x.x.x.xxxxXXXX'}
G_T2 = {'kick': 'x...x...x...x...', 'snare': '....X.......X...', 'tom_lo': 'x.x.x.x.x.x.x.x.'}
G_T3 = {'kick': 'x.x.x.x.x.x.x.x.', 'snare': '....X.......X...', 'tom_lo': 'xxxxxxxxxxxxxxxx'}


# ------------------------------------------------------------------ the count
def _spans(s, bar, ch):
    t, out = s.bar(bar), []
    for c, beats in ch:
        out.append((t, t + beats, c))
        t += beats
    return out


def _sizes(n16, first=3):
    """Group sizes 3, 4, 5, ... filling n16 sixteenths; the last is cut short
    (a remainder under 3 joins the group before it)."""
    sizes, k, total = [], first, 0
    while total < n16:
        rem = n16 - total
        if rem < k:
            if rem < 3 and sizes:
                sizes[-1] += rem
            else:
                sizes.append(rem)
            break
        sizes.append(k)
        total += k
        k += 1
    return sizes


def count(s, bar, ch, beats, lo=59, cycle=16):
    """The sum being worked: [(beat, pitch, head)] in sixteenths. Each group
    starts on the chord's root in [lo, lo+12) and runs up the chord's scale,
    one note longer than the group before; the sum starts over every `cycle`
    beats."""
    spans = _spans(s, bar, ch)

    def chord_at(t):
        for a, z, c in spans:
            if a - 1e-9 <= t < z - 1e-9:
                return c
        return spans[-1][2]

    t0, pos, out = s.bar(bar), 0.0, []
    while pos < beats - 1e-9:
        span = min(cycle, beats - pos)
        t = t0 + pos
        for n in _sizes(round(span * 4)):
            prev = None
            for i in range(n):
                c = chord_at(t)
                scale = {parse_pc(x) for x in SCALES[c.symbol].split()}
                if i == 0:
                    p = lo + ((c.root - lo) % 12)
                else:
                    p = prev + 1
                    while p % 12 not in scale:
                        p += 1
                out.append((t, p, i == 0))
                prev = p
                t += 0.25
        pos += span
    return out


def lay(part, notes, vel, transpose=0, head=0.16):
    """Each group leans on its head and climbs a little toward its last note."""
    k = 0
    for t, p, h in notes:
        k = 0 if h else k + 1
        part.note(t, p + transpose, 0.25, vel=min(1.0, vel + (head if h else 0.012 * k)))


def retrograde(notes, start, length):
    """The same sixteenths read backwards over [start, start+length)."""
    return [(start + length - (t - start) - 0.25, p, h) for t, p, h in notes]


def build():
    s = Score('boss_archmage', tonic='E', bpm=152, intro_bars=4, loop_bars=40,
              title='The Sums Still Balance', seed=2413)
    s.reverb = dict(rt60=2.4, predelay_ms=24, wet_db=-0.5)
    s.master = dict(lufs=-13.5, glue_ratio=1.6)
    b = Battle(s, full_lufs=-13.5, adaptive=False)
    b.section('intro', INTRO, CH_INTRO).section('A1', A1, CH_A).section('A2', A2, CH_A)
    b.section('B', B, CH_B).section('C', C, CH_C).section('T', T, CH_T)

    # ================================================================ the tune
    vn = b.part('lead_vn', 'violins', role='lead', eq=[('peak', 2800, 1.0, 2.0)])
    vn.at(A1).play('%sus @f ' + THEME)
    vn.at(A2).play('%sus @ff ' + THEME)
    vn.at(C).play('%sus @ff ' + THEME)                     # the fold: the tune forwards
    vn.at(B + 4).play('%sus @f ' + MODEL.split('|', 4)[4])  # the model's second half
    vn.at(T).play('%sus @ff ' + RECALC)
    # A1: a piano in octaves gives the tune its edge (the count is mallets: the
    # tune is not); the celesta above it at the turn, the glockenspiel in A2
    pno = b.part('tune_pno', 'grand', role='lead2', gain=-1)
    pno.at(A1).play('@f ' + THEME.replace('|', ''), transpose=0)
    pno.at(A1).play('@mf ' + THEME.replace('|', ''), transpose=-12)
    cel = b.part('tune_cel', 'celesta', role='lead2', gain=-3)
    cel.at(T).play('@mf ' + RECALC.replace('E6q. F#6e G6q B6q | A6e G6e F#6q D#6h',
                                           'E5q. F#5e G5q B5q | A5e G5e F#5q D#5h'),
                   transpose=12)
    gl = b.part('tune_gl', 'glock', role='accent', gain=-5)
    gl.at(A2).play('@mf ' + THEME, transpose=12)
    # A2: the horns double it an octave below; a counter-line (clarinet and second
    # violins) sings above the tune where it dips (bars 15 and 18) and below it elsewhere
    hn = b.part('tune_hn', 'horns', role='lead2')
    hn.at(A2).play('@f ' + THEME, transpose=-12)
    for name, inst, g in (('ctr_cl', 'clarinet', -1), ('ctr_vn2', 'violins2', -2)):
        p = b.part(name, inst, role='counter', gain=g)
        p.at(A2).play('@mf ' + ('%sus ' if inst == 'violins2' else '') + COUNTER)
    # the turn: trumpets with the violins
    tp = b.part('tune_tpt', 'trumpets', role='lead2', gain=-2)
    tp.at(T).play('@f ' + RECALC.replace('E6q. F#6e G6q B6q | A6e G6e F#6q D#6h',
                                         'E5q. F#5e G5q B5q | A5e G5e F#5q D#5h'))
    # the fold: the tune from its middle page (bar 5, i.e. its second half first)
    # in horns, trombones and celli an octave below the violins
    fold = text(CP + H1[::-1] + H1 + CP[::-1])
    for name, inst, dyn, g in (('fold_hn', 'horns', 'ff', 0), ('fold_tbn', 'trombones', 'f', -2),
                               ('fold_vc', 'celli', 'f', 0)):
        p = b.part(name, inst, role='lead2', gain=g + 1)
        p.at(C).play(f'@{dyn} ' + ('%sus ' if inst == 'celli' else '') + fold, transpose=-12)

    # ================================================================ B: the model
    mh = b.part('model_hn', 'horns', role='lead')
    mh.at(B).play('@f ' + MODEL, transpose=-12)
    mc = b.part('model_vc', 'celli', role='lead2')
    mc.at(B).play('%sus @f ' + MODEL, transpose=-12)
    mcl = b.part('model_cl', 'clarinet', role='lead2', gain=-3)
    mcl.at(B + 4).play('@mf ' + MODEL.split('|', 4)[4])

    # ================================================================ the count
    mar = b.part('count_mar', 'marimba', role='ostinato', gain=1,
                 eq=[('peak', 400, 1.0, -2.0), ('highshelf', 3000, 0.7, 1.0)])
    cc = b.part('count_cel', 'celesta', role='ostinato', gain=-3)
    hp = b.part('count_hp', 'harp', role='ostinato', gain=-2)
    intro_n = count(s, INTRO, CH_INTRO, 14)
    lay(mar, intro_n, 0.5)
    lay(cc, [n for n in intro_n if n[0] >= s.bar(2)], 0.4, transpose=12)
    for bar, ch, vel in ((A1, CH_A, 0.42), (A2, CH_A, 0.5), (B, CH_B, 0.44)):
        notes = count(s, bar, ch, 32)
        lay(mar, notes, vel)
        if bar == A2:
            lay(hp, notes, 0.5, transpose=12)
    # the fold: the marimba forwards, the celesta the same eight bars backwards
    # (groups shrinking, runs falling, each landing on its root): a crab canon
    # of the count, levelled up out of the brass
    marc = b.part('crab_mar', 'marimba', role='counter', gain=1, pan=0.4,
                  eq=[('peak', 400, 1.0, -2.0), ('highshelf', 3000, 0.7, 3.0)])
    celc = b.part('crab_cel', 'celesta', role='counter', gain=0, pan=-0.45)
    notes = count(s, C, CH_C, 32)
    lay(marc, notes, 0.62)
    lay(celc, retrograde(notes, s.bar(C), 32), 0.58, transpose=12, head=0.2)
    tn = count(s, T, CH_T, 30)
    lay(mar, tn, 0.6)
    lay(cc, tn, 0.44, transpose=12)
    # the restart, in the hole after the cut: the card's figure, twice
    for bar in (4, 44):
        mar.at(bar + 0.5).play('@mf ' + CARD)
        cc.at(bar + 0.5).play('@mf ' + CARD)

    # ================================================================ harmony
    b.pads('A1', 'violas', n=2, lo=55, hi=69, vel=0.42, art='soft', name='pad_va')
    b.pads('A1', 'violins2', n=2, lo=62, hi=76, vel=0.38, art='soft', name='pad_vn2')
    # (A2's pads are triads: the counter-line takes the sevenths' place)
    triads = chart('Em:4 Am:2 B:2 D:4 B7:1 Em:1 Am:2 F:2 Em:1 B7:1 Am:2 D:2 B7:4 Em:2 C:2')
    pad(b.part('pad_va', 'violas'), A2, triads, n=2, lo=55, hi=69, vel=0.5, art='soft')
    pad(b.part('pad_vn2', 'violins2'), A2, triads, n=2, lo=62, hi=76, vel=0.46, art='soft')
    b.pads('B', 'violins2', n=3, lo=60, hi=76, vel=0.5, art='sus', name='pad_vn2')
    b.pads('T', 'violas', n=2, lo=55, hi=69, vel=0.58, art='trem', name='pad_va_trem')
    # B: a pizzicato pulse in eighths under the model
    pz = b.part('pulse_pizz', 'violins2', role='ostinato', art='pizz', gain=-2)
    ostinato(pz, B, CH_B, 'e e e e e e e e', '0 1 2 1 0 1 2 1', lo=62, hi=79, vel=0.55)
    # the fold and the turn: horn chords under the trumpets
    b.brass_pad('T', 'horns', n=3, lo=52, hi=67, vel=0.56, name='bpad_hn')

    # ================================================================ bass
    cb = b.part('cb', 'basses', role='low', calm_db=0)
    cp = b.part('cb_pizz', 'basses', role='low', art='pizz')
    bass(cp, 3, CH_INTRO[2:4], 'q q q q', 'b b b b', floor=28, vel=0.66, art='pizz')
    bass(cp, A1, CH_A, 'q q q q', 'b b b b', floor=28, vel=0.66, art='pizz')
    b.spic8('A1', 'celli', degrees='b b 8 b b b 8 b', lo=40, hi=55, vel=0.56)
    for sec in ('A2', 'C', 'T'):
        bar, ch = b.sections[sec]
        if sec == 'T':
            ch = ch[:-1]
        b.spic8(sec, 'celli', degrees='b b 8 b b b 8 b', lo=40, hi=55)
        bass(cb, bar, ch, 'q q q q', 'b b b b', floor=28, vel=0.64, art='spic')
    ebs = b.part('ebass', 'rbass', layer='full', role='bass', duck='kit_kick')
    sub = b.part('sub', 'sub', layer='full', role='sub')
    for sec in ('A2', 'C', 'T'):
        bar, ch = b.sections[sec]
        if sec == 'T':
            ch = ch[:-1]
        bass(ebs, bar, ch, 'e e e e e e e e', 'r r 8 r r r 8 r', floor=28, vel=0.74,
             accents='> - - > - - - -')
        bass(sub, bar, ch, 'w' if sec != 'C' else 'h', 'b', floor=26, vel=0.6)
    ebs.at(CUT - 0.5).play('@f F1q F1q')                   # bar 44: F, then the cut
    sub.at(CUT - 0.5).play('F1h')
    ebs.at(B).play('@f ' + MODEL_BASS)
    sub.at(B).play('C1w | D1w | B0w | E1w | A0w | D1w | F1w | B0w |')

    # ================================================================ BEING FED
    # one swell, growing strain by strain in weight and in pitches; cut at bar 44
    # beat 3. Each strain picks up where the last one left it.
    LV = {INTRO: (0.08, 0.16), A1: (0.16, 0.3), A2: (0.3, 0.44), B: (0.44, 0.58),
          C: (0.58, 0.76), T: (0.76, 1.0)}
    MUD = [('peak', 380, 1.0, -4.0)]      # the swell stays out of the band's low mids

    def swell(name, inst, pitches, sections, art=None, gain=0.0, role='pad', **opts):
        opts.setdefault('eq', MUD)
        p = b.part(name, inst, role=role, gain=gain, **opts)
        for sec in sections:
            bar = {'intro': INTRO, 'A1': A1, 'A2': A2, 'B': B, 'C': C, 'T': T}[sec]
            end = CUT if sec == 'T' else bar + (4 if sec == 'intro' else 8)
            if sec == 'intro':
                end = 4.5
            dur = s.bar(end) - s.bar(bar)
            for q in pitches[sec]:
                p.note(s.bar(bar), q, dur, vel=0.6, art=art or 'default', rearticulate=True)
            lo, hi = LV[bar]
            p.expr((bar, lo), (end - 0.02, hi), (end, 0.02 if sec in ('T', 'intro') else hi))
        return p

    E1, F1, E2, F2, Bb2, B2, E3, F3, Fs3 = 28, 29, 40, 41, 46, 47, 52, 53, 54
    swell('feed_cb', 'basses', {'intro': [E1], 'A1': [E1], 'A2': [E1], 'B': [E1], 'C': [E1],
                                'T': [E1]},
          ('intro', 'A1', 'A2', 'B', 'C', 'T'), art='trem', role='low', gain=0)
    swell('feed_tuba', 'tuba', {'A2': [F1], 'B': [F1], 'C': [F1], 'T': [E1 + 12, F1]},
          ('A2', 'B', 'C', 'T'), role='low', gain=-4)
    swell('feed_tbn', 'trombones', {'B': [Bb2], 'C': [Bb2, B2], 'T': [F2, Bb2, B2]},
          ('B', 'C', 'T'), role='pad', gain=-5)
    swell('feed_oohs', 'oohs', {'B': [E3, F3], 'C': [Bb2, E3, F3], 'T': [Bb2, E3, F3, Fs3]},
          ('B', 'C', 'T'), role='choir', gain=-4,
          eq=[('peak', 350, 1.0, -3.0), ('peak', 1800, 1.0, 2.0)])
    swell('feed_timp', 'timpani', {'C': [E2], 'T': [E2]}, ('C', 'T'), art='roll', role='timp',
          gain=-2)
    # the swell's floor: a bowed cymbal under its last two strains, bass-drum rubs in the turn
    fp = b.part('feed_perc', 'orch_perc', role='accent', gain=-3)
    # (none after bar 37: a bowed cymbal rings six seconds, and the cut must be dead)
    for bar in (C, C + 4, T):
        drums(fp, bar, {'bowed': 'x'}, vel=0.5 if bar < T else 0.66)
    # (the rubs ring long: none in the last two bars, so nothing sounds through the cut)
    for bar in range(T + 4, T + 6):
        drums(fp, bar, {'bd_rub': 'x.......x.......'}, vel=0.55)

    # ================================================================ percussion
    timp = b.part('timp', 'timpani', role='timp')
    timp.at(3).play('@mf E2q rq rh |')
    for bar, t in ((A1, 'E2q rq rh |'), (A2, 'E2q rq E2q rq |'), (B, 'C2q rq rh |'),
                   (C, 'C3q rq rh |'), (C + 4, 'C3q rq rh |'), (T, 'E2q rq rh |')):
        timp.at(bar).play('@f ' + t)
    timp.at(B + 7).play('@f B2e B2e B2e B2e B2q B2q |')
    perc = b.part('perc', 'orch_perc', role='accent')
    for bar in (A1, A2, B, C, T):
        drums(perc, bar, {'crash': 'x', 'bd': 'x'}, vel=0.78)
    drums(perc, C + 4, {'sus': 'x', 'tri': 'x'}, vel=0.7)          # the middle page
    drums(perc, 44, {'bd': 'x'}, vel=0.86)               # (no cymbal: the cut is dead)
    for bar in range(B, B + 8, 2):
        drums(perc, bar, {'tri': 'x'}, vel=0.45)
    bt = b.part('bell_tree', 'orch_perc', role='accent', gain=-4)
    for bar in (A1 + 4, A2 + 4, C + 4):
        drums(bt, bar - 0.5, {'bell_tree': 'x'}, vel=0.5)

    kit = Kit(s, 'kit')
    b.kit = kit
    b.full_only.update(kit.names())
    kit.play(4, {'kick': 'x...x...', 'snare': '....x.xx', 'tom_mid': '..x.....'}, step=0.25)
    for i in range(8):
        kit.play(A1 + i, FILL if i == 7 else G_A1, vel=0.66)
    for i in range(8):
        kit.play(A2 + i, FILL if i in (3, 7) else G_A2, vel=0.72)
    for i in range(8):
        kit.play(B + i, B_FILL if i == 7 else G_B[i // 2], vel=0.68 + 0.015 * i)
    for i in range(8):
        kit.play(C + i, FILL if i in (3, 7) else G_C, vel=0.76)
    for i in range(4):
        kit.play(T + i, FILL if i == 3 else G_C, vel=0.76)
    for i in range(4, 7):
        kit.play(T + i, G_T3 if i == 6 else G_T2, vel=0.72 + 0.03 * i)
    kit.play(44, {'kick': 'X...x...', 'snare': 'X...X...'}, step=0.25)
    for bar in (A1, A2, B, C, C + 4, T):
        kit.play(bar, {'crash': 'X'})

    # ================================================================ enrage: it answers
    enrage(b)
    return b.finish()


def enrage(b):
    """On every downbeat the thing being fed answers: a low E-F cluster in the
    tuba and trombones over a bass drum, then a breath (low oohs) swelling
    through the bar into the next downbeat. Bar 44 answers too, and its
    breath is cut with everything else on beat 3."""
    s = b.s
    v = 'enrage_archmage'
    tb = b.extra(v, 'en_tbn', 'trombones', role='section', art='default')
    tu = b.extra(v, 'en_tuba', 'tuba', role='low')
    bd = b.extra(v, 'en_bd', 'orch_perc', role='drums')
    br = b.extra(v, 'en_breath', 'oohs', role='choir',
                 eq=[('peak', 350, 1.0, -3.0), ('peak', 1800, 1.0, 2.0)])
    for bar in range(A1, END):
        t = s.bar(bar)
        last = bar == END - 1
        tb.note(t, 40, 1.0, vel=0.9, rearticulate=True)      # E2
        tb.note(t, 41, 1.0, vel=0.86, rearticulate=True)     # F2
        tu.note(t, 28, 1.0, vel=0.92, rearticulate=True)     # E1
        drums(bd, bar, {'bd': 'X'}, vel=0.8)
        dur = 2.0 if last else 4.0
        for q in (46, 52, 53):                               # Bb2 E3 F3
            br.note(t, q, dur, vel=0.6, rearticulate=True)
        br.expr((bar, 0.95), (bar + 0.22, 0.2), (bar + (0.48 if last else 0.97), 0.95),
                (bar + (0.5 if last else 0.999), 0.02 if last else 0.95))
