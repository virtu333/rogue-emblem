"""Elite battles — "Against the Standard".

A picked enemy company: danger with discipline. C minor at 168, and two
things that never agree. Underneath, a bass pulse nobody could lose: the
contrabasses, the bass guitar and the kick on every quarter of every bar.
On top, one displaced pattern: a seven-sixteenth cell (3+2+2, the accent on
the chord root an octave up, then a run through the chord below it) that
runs straight through the bar lines. Sixteen sixteenths a bar, seven a
cell: the accent lands with the bar only every seventh bar, so the surface
leans and the ground never moves.

The cycle has its own voice, so it is heard as a pattern and not as a
wash of spiccato: every cell head (one attack every seven sixteenths) is
struck by a rim click and a high marimba on the chord root. The marimba
alone teaches it in the intro and keeps it in the calm mix; the click
joins at the first strain. Against the quarter-note floor they make a
plain 4-against-7 that the ear can follow while the strings fill in the
cell.

The tune (a straight-mute trumpet over horns, then open trumpets, then
the violins) is a drill of repeated notes that reaches for two leading
tones: in its sixth bar it climbs D, E-flat, F-sharp (an augmented second,
over a D7) onto the G of a cadential 6/4, and only then takes B to C. One
lead at a time: every doubling is a lead2, so the brass never stacks up
over the pulse.

The cycle's rule: the cell re-forms at the start of every strain (bars 5,
13, 29, 37, 45), like a company dressing its line, and runs uninterrupted
inside a strain. A2 is cut to seven bars: 112 sixteenths, sixteen cycles
exactly, so the accent realigns with the bar at the very instant of the
interruption (bar 20). There everything stops on a unison G, two beats of
nothing but the ring, and on beat 3 the pattern (and its click) resumes
from the top of its cell, on a downbeat that isn't the bar's. It does not
re-form at B: the whole second theme (E-flat, the enemy's colours raised)
runs over a pattern that is half a bar out, and the company only dresses
its line again at C.

These devices (the seven-sixteenth cell, the seven-bar A2, the dead stop
and the half-bar resumption) are this piece's own. They are not taken from
*Tearing Through Heaven*, whose strain is a square eight bars with a stop
bar that keeps its kit and carries a pickup, over a hocketed groove; this
piece keeps a plain quarter floor instead, because the seven-cycle is
easiest to hear against a pulse that never varies.

No leitmotif is quoted: an elite fight can happen in any act, so there is
no choir, no piccolo, and no Empire drill (that belongs to Act II).

Form (bars): intro 1-4 | A1 5-12 | A2 13-19 | stop 20 | B 21-28 (E-flat)
| C 29-36 (the pattern foregrounded, a low-brass call answered by it) |
A3 37-44 | build 45-48. Loop 5-48.

calm: oboe / solo violin / flute on the tune over the calm bed; the viola
pattern and the marimba heads stay under it, and the contrabass pulse
never leaves.
"""

from engine.patterns import Kit, bass, chart
from engine.score import Score

from scores._battle import Battle

KEY = 'music_battle_elite'

# ------------------------------------------------------------------ material
MEL = """
G4e C5e C5q C5q Eb5q | D5q. C5e B4h | G4e C5e C5q C5q F5q | Eb5q. D5e C5h |
Ab5q G5e F5e Eb5q C5q | D5q. Eb5e F#5h | G5q Eb5q D5q B4q | C5w |
"""
MEL_BR = """
G4e C5e C5q C5q Eb5q | D5q. C5e B4h | G4e C5e C5q C5q F5q | Eb5q. D5e C5q rq |
Ab5q G5e F5e Eb5q C5q | D5q. Eb5e F#5h | G5q Eb5q D5q B4q | C5h. rq |
"""
# the tune cut at its seventh bar: the leading tone left in the air
MEL_CUT = """
G4e C5e C5q C5q Eb5q | D5q. C5e B4h | G4e C5e C5q C5q F5q | Eb5q. D5e C5q rq |
Ab5q G5e F5e Eb5q C5q | D5q. Eb5e F#5h | G5q Eb5q D5q B4q |
"""
MEL_B = """
Bb4q Eb5q G5q. F5e | Eb5h. Bb4q | C5q F5q Ab5q. G5e | F5h. D5q |
G5q Bb5q C6q. Bb5e | Ab5q F5q Eb5q C5q | D5q. Eb5e F5q D5q | G5w |
"""
MEL_B_BR = """
Bb4q Eb5q G5q. F5e | Eb5h. Bb4q | C5q F5q Ab5q. G5e | F5h. D5q |
G5q Bb5q C6q. Bb5e | Ab5q F5q Eb5q C5q | D5q. Eb5e F5q D5q | G5h. rq |
"""
CALL = 'G3e C4e C4q C4q Eb4q | D4q. C4e B3h |'
CALL2 = 'C4e F4e F4q F4q Ab4q | G4q. F4e E4h |'
BUILD_VN = 'Ab4q C5q Eb5q Ab5q | Bb4q D5q F5q Bb5q | G4h B4h | D5h. rq |'

CH_INTRO = chart('Cm Cm Cm G')
CH_A = chart('Cm G Cm Ab Fm D7 Cm/G:2 G:2 Cm')
CH_A7 = CH_A[:8]                     # seven bars: the eighth never comes
CH_STOP = chart('G')
CH_B = chart('Eb Eb Fm Bb Cm Fm Bb G')
CH_C = chart('Cm G Cm Cm Fm C Ab G')
CH_BUILD = chart('Ab Bb G G')

CELL = [3, 0, 1, 2, 0, 2, 1]          # seven sixteenths: root above, run below

DRILL = {'kick': 'x...x...x...x...', 'snare': '....x.......x...', 'hat': 'X.x.x.x.X.x.x.x.'}
DRILL_FILL = {'kick': 'x...x...x...x...', 'snare': '....x.......xxXX',
              'hat': 'X.x.x.x.X.......', 'tom_hi': '..........x.....'}
RIDE = {'kick': 'x...x...x...x...', 'snare': '....x.......x...', 'ride': 'X.x.x.x.X.x.x.x.'}
RIDE_FILL = {'kick': 'x...x...x...x...', 'snare': '....x.......x.xx', 'ride': 'X.x.x.x.X.x.....',
             'tom_lo': '..............xx'}
TOMS = {'kick': 'x...x...x...x...', 'snare': '....x.......x...', 'tom_lo': '......x.......x.',
        'hat': 'x.x.x.x.x.x.x.x.'}
CALM_BEAT = {'kick': 'x...x...x...x...'}


def timeline(sections):
    """[(start_beat, end_beat, Chord)] over the sections' charts."""
    out = []
    for bar, ch in sections:
        t = (bar - 1) * 4.0
        for c, beats in ch:
            out.append((t, t + beats, c))
            t += beats
    return out


def chord_at(tl, t):
    for a, b, c in tl:
        if a - 1e-9 <= t < b - 1e-9:
            return c
    return tl[-1][2]


def pattern(part, tl, start_bar, end_bar, lo, vel, accent=0.22, phase=0):
    """The displaced cell on a straight sixteenth grid from start_bar (may be
    fractional) to the end of end_bar. The cell index runs continuously across
    bar lines; it starts at `phase`."""
    s = part.score
    t0 = s.bar(start_bar)
    t1 = s.bar(end_bar + 1)
    steps = int(round((t1 - t0) / 0.25))
    for i in range(steps):
        t = t0 + i * 0.25
        c = chord_at(tl, t)
        root = c.root_note(lo)
        tones = c.tones_in_range(root, root + 24)
        k = (i + phase) % len(CELL)
        p = tones[CELL[k] % len(tones)]
        v = min(1.0, vel + (accent if k == 0 else 0.0))
        part.note(t, p, 0.25, vel=v, art='spic')


def heads(part, tl, start_bar, end_bar, lo=None, vel=0.7, key=None, phase=0):
    """One attack on each head of the cell `pattern` lays over the same span
    (every seventh sixteenth): the chord root placed at or above `lo`, or a
    fixed drum `key`."""
    s = part.score
    t0 = s.bar(start_bar)
    steps = int(round((s.bar(end_bar + 1) - t0) / 0.25))
    for i in range(steps):
        if (i + phase) % len(CELL):
            continue
        t = t0 + i * 0.25
        p = key if key is not None else chord_at(tl, t).root_note(lo)
        part.note(t, p, 0.25, vel=vel)


def build():
    s = Score('battle_elite', tonic='C', bpm=168, intro_bars=4, loop_bars=44,
              title='Against the Standard', seed=193)
    s.reverb = dict(rt60=1.9, predelay_ms=20, wet_db=-1.5)
    s.master = dict(lufs=-14.0, glue_ratio=1.5)
    b = Battle(s, calm_lufs=-17.0, full_lufs=-14.0)
    b.section('intro', 1, CH_INTRO).section('A1', 5, CH_A).section('A2', 13, CH_A7)
    b.section('stop', 20, CH_STOP).section('B', 21, CH_B).section('C', 29, CH_C)
    b.section('A3', 37, CH_A).section('build', 45, CH_BUILD)
    tl = timeline(b.sections.values())

    # ---------------------------------------------------------------- the pattern
    va = b.part('pat_va', 'violas', role='ostinato', art='spic', calm_db=-7, gain=1.5)
    vn2 = b.part('pat_vn2', 'violins2', role='ostinato', art='spic', layer='full', gain=1.5)
    vn = b.part('pat_vn', 'violins', role='ostinato', art='spic', layer='full', pan=-0.4)
    vc = b.part('pat_vc', 'celli', role='ostinato', art='spic', layer='full')
    # the cell re-forms at each strain, runs through it, and is never reset at B
    for a, z in ((1, 4), (5, 12), (13, 19), (29, 36), (37, 44), (45, 48)):
        pattern(va, tl, a, z, lo=48, vel=0.6)
    for a, z in ((13, 19), (29, 36), (37, 44), (45, 48)):
        pattern(vn2, tl, a, z, lo=60, vel=0.58)
    # after the stop: resumes on beat 3 of bar 20, from the top of the cell,
    # and stays out of step with the bar until C
    pattern(va, tl, 20.5, 28, lo=48, vel=0.62)
    pattern(vn2, tl, 20.5, 28, lo=60, vel=0.6)
    pattern(vn, tl, 29, 36, lo=72, vel=0.56)
    pattern(vc, tl, 29, 36, lo=36, vel=0.6)

    # the cycle made audible: every cell head (one attack every seven
    # sixteenths) is struck by its own timbre, a rim click and a high marimba
    # on the chord root, so the line crossing the bar is heard as a pattern
    # and not as a wash. The marimba teaches it in the intro and stays in the
    # rain; the click joins with the first strain and resumes with the pattern
    # on beat 3 of the stop bar.
    spans = ((5, 12), (13, 19), (20.5, 28), (29, 36), (37, 44), (45, 48))
    mar = b.part('head_mar', 'marimba', role='accent', gain=4.5, calm_db=-4.5)
    click = b.part('head_click', 'kit', role='accent', layer='full', gain=2.5)
    heads(mar, tl, 1, 4, lo=79, vel=0.62)
    for a, z in spans:
        heads(mar, tl, a, z, lo=79, vel=0.74)
        heads(click, tl, a, z, key=88, vel=0.8)

    # ---------------------------------------------------------------- the pulse
    for sec in ('intro', 'A1', 'A2', 'B', 'C', 'A3', 'build'):
        b.low(sec, 'q', vel=0.68, calm_db=-2)
    for sec in ('A1', 'A2', 'A3', 'build'):
        b.rbass(sec, rhythm='e e e e e e e e', notes='r r r r r r r r', accents='> - > - > - > -')
    b.rbass('B', rhythm='q q q q', notes='r r r r', accents='> - > -')
    b.rbass('C', rhythm='e e e e e e e e', notes='r r r r r r 8 r', accents='> - > - > - > -')
    for sec in ('A1', 'A2', 'B', 'C', 'A3', 'build'):
        b.sub(sec)

    # ---------------------------------------------------------------- the tune
    # one lead at a time; doublings are lead2, so the brass never stacks
    b.lead('A1', MEL_BR, inst='trumpets', name='tpt_mute', dyn='f', layer='full', art='mute')
    b.lead('A1', MEL_BR, inst='horns', name='hn_double', transpose=-12, dyn='mf',
           role='lead2', layer='full')
    b.lead('A2', MEL_CUT, inst='trumpets', dyn='f', layer='full')
    b.lead('A2', MEL_CUT, inst='horns', name='hn_double', transpose=-12, dyn='f',
           role='lead2', layer='full')
    b.lead('B', MEL_B_BR, inst='trumpets', dyn='f', layer='full')
    b.lead('B', MEL_B, inst='violins', name='b_vn', dyn='f', role='lead2', layer='full',
           art='sus')
    b.lead('C', CALL, inst='trombones', name='call_tbn', dyn='ff', layer='full')
    b.lead('C', CALL, inst='tuba', name='call_tuba', transpose=-12, dyn='f', layer='full',
           role='lead2')
    b.lead('C', CALL, inst='horns', name='call_hn', dyn='f', layer='full', role='lead2')
    b.part('call_tbn', 'trombones').at(33).play('@ff' + CALL2)
    b.part('call_tuba', 'tuba').at(33).play('@f' + CALL2, transpose=-12)
    b.part('call_hn', 'horns').at(33).play('@f' + CALL2)
    b.lead('A3', MEL, inst='violins', name='a3_vn', transpose=12, dyn='f', layer='full',
           art='sus')
    b.lead('A3', MEL_BR, inst='trumpets', name='tpt_double', dyn='f', role='lead2',
           layer='full')
    b.lead('A3', MEL_BR, inst='horns', name='hn_double', transpose=-12, dyn='f', role='lead2',
           layer='full')
    b.lead('build', BUILD_VN, inst='violins', name='a3_vn', dyn='f', layer='full', art='sus')

    # the calm voices
    b.lead('A1', MEL, inst='oboe', dyn='mf', layer='calm')
    b.lead('A2', MEL_CUT, inst='solo_violin', dyn='mf', layer='calm')
    b.lead('B', MEL_B, inst='flute', dyn='mf', layer='calm')
    b.lead('C', CALL, inst='clarinet', dyn='mf', layer='calm')
    b.part('lead_clarinet', 'clarinet').at(33).play('@mf' + CALL2)
    b.lead('A3', MEL, inst='solo_violin', dyn='f', layer='calm')
    b.lead('build', BUILD_VN, inst='flute', dyn='mf', layer='calm')

    # ---------------------------------------------------------------- harmony
    # sustained harmony is kept light and out of the low mids: the pulse and the
    # pattern are the texture
    vc_sus = b.part('vc_sus', 'celli', role='pad', art='sus', layer='full')
    for sec in ('B', 'A3'):
        bass(vc_sus, b.bar(sec), b.chart(sec), 'h h', 'r 5', floor=48, vel=0.46, art='sus')
    b.pads('B', 'violas', n=2, lo=55, hi=69, art='sus', name='b_va_pad', layer='full')
    b.brass_pad('B', 'horns', n=3, lo=50, hi=65, vel=0.5)
    b.brass_pad('A3', 'trombones', n=2, lo=48, hi=62, vel=0.55)
    b.brass_pad('build', 'horns', n=3, lo=53, hi=69, vel=0.6)

    # ---------------------------------------------------------------- the stop
    # bar 20: a unison G in every octave on the downbeat, a crash and one
    # timpani stroke, and nothing but their ring until the pattern resumes
    for name, inst, text in (
        ('hn_double', 'horns', '@fff [G3 G4]q> rq rh |'),
        ('lead_trumpets', 'trumpets', '@fff [G4 G5]q> rq rh |'),
        ('call_tbn', 'trombones', '@fff [G2 G3]q> rq rh |'),
        ('call_tuba', 'tuba', '@fff G2q> rq rh |'),
        ('a3_vn', 'violins', '@fff G5q> rq rh |'),
        ('b_va_pad', 'violas', '@fff G4q> rq rh |'),
        ('vc_sus', 'celli', '@fff G3q> rq rh |'),
    ):
        b.part(name, inst).at(20).play(text)
    b.part('cb', 'basses').at(20).play('%sus @ff G2q> rq rh |')
    b.part('ebass', 'rbass').at(20).play('@ff G2q> rq rh |')
    b.timp('stop', '@fff G2q> rq rh |')
    b.hit(20, pieces=('crash', 'bd'), vel=0.95)

    # ---------------------------------------------------------------- drums
    b.kit = Kit(s, 'kit', gains={'kick': 1.0, 'snare': 2.0})
    b.full_only.update(b.kit.names())
    b.groove('intro', {'kick': 'x...x...x...x...', 'hat': 'x.x.x.x.x.x.x.x.'}, crash=False,
             vel=0.66)
    b.kit.play(4, {'snare': '............xxXX'}, vel=0.78)
    b.groove('A1', DRILL, DRILL_FILL, every=4)
    b.groove('A2', DRILL, DRILL_FILL, every=4, n_bars=6)
    b.kit.play(19, {'kick': 'x...x...x...x...', 'snare': '....x...x.x.xxxx',
                    'hat': 'X.x.x.x.X.......'}, vel=0.8, ramp=0.3)
    b.kit.play(20, {'kick': 'x...............', 'crash': 'X...............'}, vel=0.9)
    b.groove('B', RIDE, RIDE_FILL, every=4)
    b.groove('C', TOMS, DRILL_FILL, every=4)
    b.groove('A3', DRILL, DRILL_FILL, every=4, vel=0.78)
    b.groove('build', {'kick': 'x...x...x...x...', 'snare': 'x.x.x.x.xxxxxxxx',
                       'hat': 'x.x.x.x.x.x.x.x.'}, crash=False, vel=0.72)
    b.kit.play(48, {'kick': 'x...x...x.x.x.x.', 'snare': 'xxxxxxxxxxxxxxxx'}, vel=0.84, ramp=0.5)

    b.timp('intro', '@mf C2q rq rh | rw | C2q rq rh | G2q rq G2e G2e G2q |')
    for sec, t in (('A1', '@f C2q rq rh |'), ('A2', '@f C2q rq rh |'), ('B', '@ff Eb2q rq rh |'),
                   ('A3', '@ff C2q rq rh |')):
        b.timp(sec, t)
    b.timp('C', '@f C2q rq rh | rw | C2q rq rh | rw | F2q rq rh | C2q rq rh |'
              ' Ab2q rq Ab2q rq | G2e G2e G2e G2e G2e G2e G2e G2e |')
    b.timp('build', '%roll @mf Ab2w | Bb2w | G2w | G2w |')
    for bar in (5, 13, 21, 29, 37):
        b.hit(bar)
    b.riser(27, beats=8, vel=0.55)
    b.riser(47, beats=8)

    # ---------------------------------------------------------------- calm bed
    for sec in ('intro', 'A1', 'A2', 'B', 'C', 'A3', 'build'):
        b.calm_bed(sec, piano='0 2 4 2', heartbeat=False)
    # the pulse nobody could lose, in the rain too: a soft kick on every quarter
    ck = Kit(s, 'ckit', gains={'kick': -4})
    b.calm_only.update(ck.names())
    for bar in list(range(1, 20)) + list(range(21, 49)):
        ck.play(bar, CALM_BEAT, vel=0.44)
    return b.finish()
