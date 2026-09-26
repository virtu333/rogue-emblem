"""Swamp battles — "The Mire".

Acid water and footing that fails. Everything stands on F: a drone held in
the middle of the texture (bassoon, low clarinet, violas) with a low F under
it, so the smallest movement counts. The ground is a cell in 5/4 for low
strings: one heavy step, two light ones, a long dragging step, a last light
one... and a kept rest where the foot is stuck. Its only pitch motion is a
flinch, F-G-flat-F faster than the beat: on the downbeat in one bar, and in
the next bar a sixteenth before the barline, so the same flinch arrives late,
then early. Calm plays the cell thinned (only its heavy steps); full doubles
it in octaves and puts the low brass on it.

The tune sinks. Each two bars it holds a note, slips a semitone, climbs back
and loses a whole step: C-B-C-Bb, Bb-A-Bb-Ab, Ab-G-Ab-Gb, Gb-F. Over the
drone every slip changes the colour (the fifth, a tritone, the fourth, a
bright major third, the minor third, the Phrygian second, home).

  A   the tune on muted horns (calm: low clarinet)
  A2  the tune in open horns and violas; the cell doubled; a high C is held
  B   the ground gives: the drone slides up to G-flat under the held C, which
      turns from a fifth into a tritone... and the cell stamps back in and
      cuts it off. The tune returns in running dotted eighths (three
      sixteenths each, so the accent drifts later across the bar and snaps
      back at the barline) while the drone sinks to E and climbs home to F.
  C   everything: the tune in the violins, the cell in the low brass

No leitmotif is quoted: the fen has its own voice.

What comes from Silver for Monsters, and what doesn't. Taken from it: a drone
that carries the mode by itself, a one-pitch cell built additively with a rest
kept in it, one semitone flinch that lands on the beat in one bar and early in
the next, and an answer in three-sixteenth groups (B's dotted eighths). Two
devices are this piece's own, though they were first credited to Silver.
Calm's thinned cell: Silver's riff never loses attacks (its m.13 has the same
eleven, only engraved wider), so thinning the cell for the quiet mix is
invented here. The held C turning into a tritone: Silver's long held note is
its tonic, D, and there is no tritone under it. Here the note is a fifth over
F that the ground slides out from under.
"""

from engine.patterns import Kit, chart, drums
from engine.score import Score

from scores._battle import Battle

KEY = 'music_battle_swamp'

# ------------------------------------------------------------------ material
# the cell: heavy (with the flinch on it), light, light, the long dragging step,
# light, and the kept rest. In the second bar the flinch comes early instead.
CELL_LATE = "@f F2x> Gb2x F2:0.75 @p F2e F2e @mf F2q._ @p F2e rq |"
CELL_EARLY = "@f F2q> @p F2e F2e @mf F2q._ @p F2e re rs @mf F2x Gb2x |"
CELL = CELL_LATE + ' ' + CELL_EARLY
# thinned (calm): only the heavy steps, the flinch kept
CELL_THIN = "@mf F2x> Gb2x F2:0.75 rq rq. rq. | @mf F2q rq rq. rq rs F2x Gb2x |"

# the tune: hold, slip a semitone, climb back, lose a whole step, rest.
# lint: its G-flat (two to three beats against the F drone), the cell's F against the
# sliding drone in B and the tremolo's G-flat are the piece's semitones, all intended
MEL = """
C4h. B3h | C4q Bb3h. rq |
Bb3h. A3h | Bb3q Ab3h. rq |
Ab3h. G3h | Ab3q Gb3h. rq |
Gb3h F3h. | F3h. rh |
"""
# B: the same slips run in dotted eighths (six per bar and an eighth to catch up),
# over G-flat, then a semitone lower over E, then home over F
DRAG = """
C4e. B3e. C4e. Bb3e. A3e. Bb3e. Ab3e | G3e. Ab3e. Gb3e. F3e. Gb3e. Ab3e. Bb3e |
B3e. A#3e. B3e. A3e. G#3e. A3e. G3e | F#3e. G3e. F3e. E3e. F3e. G3e. A3e |
C4e. B3e. C4e. Bb3e. A3e. Bb3e. Ab3e | G3e. Ab3e. Bb3e. B3e. C4e. Db4e. C4e |
"""

# drums, 5/4 in 16ths (20 steps). The cell's rest (steps 16-19) keeps its low end
# empty: only a ghost and the hats walk through it.
WADE = {'kick': 'x.......x...........', 'tom_lo': '....x.........x.....',
        'rim': '..................o.'}
WADE_FILL = {'kick': 'x.......x...........', 'tom_lo': '....x.........x.x.x.',
             'tom_hi': '...............x.x.x'}
TRUDGE = {'kick': 'x.......x.x.........', 'tom_lo': '....x.........x.....',
          'snare': '............x.......', 'hat': 'x.x.x.x.x.x.x.x.x.x.'}
TRUDGE_FILL = {'kick': 'x.......x.x.........', 'snare': '............x.x.xxXX',
               'tom_lo': '....x.........x.....'}
LOGS = {'log_lo': 'x.......x.....x.....', 'log_hi': '....x.x.....x.....x.'}


def build():
    s = Score('battle_swamp', tonic='F', bpm=112, meter=(5, 4), intro_bars=2, loop_bars=32,
              title='The Mire', seed=157)
    s.reverb = dict(rt60=2.4, predelay_ms=20, wet_db=-1.5, damp=0.65)
    s.master = dict(lufs=-14.0, glue_ratio=1.5)
    b = Battle(s, calm_lufs=-17.0, full_lufs=-14.0)
    INTRO, A, A2, B, C = 1, 3, 11, 19, 27
    # open fifths only: the tune's A and G naturals must never meet a minor third
    F8 = 'F5:40'
    b.section('intro', INTRO, chart('F5:10'))
    b.section('A', A, chart(F8)).section('A2', A2, chart(F8)).section('C', C, chart(F8))
    b.section('B', B, chart('Gb5:20 E5:10 F5:10'))

    # ================================================================ the drone
    # inner voice: F3 in bassoon, clarinet and violas; F1 underneath. In B it slides.
    ground = {INTRO: 'F' * 2, A: 'F' * 8, A2: 'F' * 8, B: 'GGGGEEFF', C: 'F' * 8}
    mid = {'F': 'F3', 'G': 'Gb3', 'E': 'E3'}
    lowp = {'F': 'F1', 'G': 'Gb1', 'E': 'E1'}
    dr_bsn = b.part('drone_bsn', 'bassoon', role='pad', calm_db=-3)
    dr_cl = b.part('drone_cl', 'clarinet', role='pad', layer='calm', gain=-3)
    dr_va = b.part('drone_va', 'violas', role='pad', art='soft', calm_db=-2)
    dr_cb = b.part('drone_cb', 'basses', role='low', art='soft', calm_db=1, gain=-3)
    runs = []                                    # (start beat, root, beats)
    for start, roots in ground.items():
        for k, r in enumerate(roots):
            t = s.bar(start + k)
            # (never merge across the loop start: the intro's notes are not looped)
            if runs and runs[-1][1] == r and start + k not in (A, C):
                runs[-1][2] += 5
            else:
                runs.append([t, r, 5])
    # where the ground moves it moves a sixteenth early: the foot slips before it lands
    for prev, run in zip(runs, runs[1:]):
        if prev[1] != run[1]:
            prev[2] -= 0.25
            run[0] -= 0.25
            run[2] += 0.25
    for t, r, beats in runs:
        if t < s.bar(C) - 1:
            dr_bsn.at_beat(t).play(f'@mp {mid[r]}:{beats}')
        dr_cl.at_beat(t).play(f'@p {mid[r]}:{beats}')
        dr_va.at_beat(t).play(f'%soft @mp {mid[r]}:{beats}')
        dr_cb.at_beat(t).play(f'%soft @mp {lowp[r]}:{beats}')

    # ================================================================ the cell
    # one line, in octaves where the band is walking; B thins it to its heavy steps
    # so the running dotted eighths read against a plain downbeat
    vc = b.part('cell_vc', 'celli', role='ostinato', art='spic', layer='full')
    cb = b.part('cell_cb', 'basses', role='low', art='spic', layer='full', gain=-2)
    thin = b.part('cell_thin', 'celli', role='ostinato', art='spic', calm_db=3)
    tuba = b.part('cell_tuba', 'tuba', role='low', layer='full', art='stac', gain=-4)
    pairs = lambda bar: [bar + 2 * k for k in range(4)]  # noqa: E731
    for bar in [INTRO] + pairs(A) + pairs(A2) + pairs(C):
        vc.at(bar).play('%spic ' + CELL)
    for bar in pairs(A2):
        cb.at(bar).play('%spic ' + CELL, transpose=-12)
    for bar in pairs(C):
        tuba.at(bar).play('%stac ' + CELL, transpose=-12)
    # calm hears the thinned cell throughout; full hears it only in B
    thin_calm = b.part('cell_thin_c', 'celli', role='ostinato', art='spic', layer='calm')
    for bar in [INTRO] + pairs(A) + pairs(A2) + pairs(C):
        thin_calm.at(bar).play('%spic ' + CELL_THIN)
    for bar in (B + 2, B + 4, B + 6):
        thin.at(bar).play('%spic ' + CELL_THIN)

    # ================================================================ the tune
    # A: low clarinet, a far horn under it; A2: horns and violas; C: the violins
    cl = b.part('mel_cl', 'clarinet', role='lead', calm_db=0)
    cl.at(A).play('@mf ' + MEL, transpose=12)
    hn = b.part('hn', 'horns', role='lead2', layer='full', depth=0.7)
    hn.at(A).play('@mp ' + MEL)
    hn.at(A2).play('@f ' + MEL)
    va = b.part('va_mel', 'violas', role='lead2', layer='full', art='sus', gain=2)
    va.at(A2).play('@f ' + MEL)
    b.lead('A2', MEL, inst='oboe', layer='calm', dyn='mf', transpose=12)

    # the held note that goes wrong: a fifth over F, a tritone over G-flat, cut off
    held = b.part('held', 'violins2', role='lead2', calm_db=-2, art='soft',
                  eq=[('peak', 3000, 1.0, -3.0)])
    held.at(A2 + 6).play('%soft @mp C5:20~ | C5e r:4.5 |')
    held.expr((A2 + 6, 0.6), (B, 0.85), (B + 1.9, 1.0), (B + 2.1, 1.0))

    # B: the tune's slips run in dotted eighths, in the low reeds and celli
    cl.at(B + 2).play('@f ' + DRAG, transpose=12)
    bsn = b.part('drag_bsn', 'bassoon', role='lead2', calm_db=-2)
    bsn.at(B + 2).play('@f ' + DRAG)

    vn = b.part('vn_mel', 'violins', role='lead', layer='full', art='sus',
                eq=[('peak', 3000, 1.0, -2.0)])
    vn.at(C).play('@ff ' + MEL, transpose=12)
    hn.at(C).play('@mf ' + MEL)
    hn.expr((A, 1.0), (C - 0.1, 1.0), (C, 0.8), (C + 7.9, 0.8))
    b.lead('C', MEL, inst='clarinet', layer='calm', dyn='f', transpose=12, name='lead_cl_hi')

    # acid on the water: a high tremolo F that sours to G-flat when the tune sinks there
    shim = b.part('shimmer_vn', 'violins2', role='pad', layer='full', art='trem', gain=-3)
    for bar in (A2, C):
        shim.at(bar).play('%trem @p F5:10 | F5:10 | F5:5 | Gb5:5 | F5:10 |')

    # ================================================================ drums
    b.groove('A', WADE, WADE_FILL, every=4, vel=0.7, crash=False)
    b.kit.parts['snare'].opts['gain'] = -5.0     # a dry snap, not a march
    b.groove('A2', TRUDGE, TRUDGE_FILL, every=4, vel=0.74, crash=False)
    b.kit.play(B, {'tom_lo': 'x...................'}, vel=0.6)
    b.kit.play(B + 1, {'tom_lo': '..............x.x.xx'}, vel=0.62, ramp=0.4)
    for bar in range(B + 2, B + 8):
        b.kit.play(bar, TRUDGE_FILL if bar == B + 7 else TRUDGE, vel=0.76)
    b.groove('C', TRUDGE, TRUDGE_FILL, every=4, vel=0.78, crash=False)
    b.kit.play(B + 2, {'crash': 'X'})
    logs = b.part('logs', 'orch_perc', role='accent', calm_db=-5)
    for bar in list(range(INTRO + 1, B)) + list(range(B + 2, C + 8)):
        drums(logs, bar, LOGS, vel=0.6)
    boom = b.part('bd', 'orch_perc', role='accent', layer='full')
    for bar in (A2, B + 2, C):
        drums(boom, bar, {'bd': 'x'}, vel=0.8)
    b.timp('B', '@f Gb2q rw | %roll @mp Gb2:5 | %default @f F2q rw | rw rq | @f E2q rw |'
                ' rw rq | @f F2q rw | %roll @mp C3:5 |')

    # ================================================================ calm heartbeat
    b.calm_kit = Kit(s, 'ckit', gains={'kick': -4})
    b.calm_only.update(b.calm_kit.names())
    for bar in range(A, C + 8):
        b.calm_kit.play(bar, {'kick': 'x.......x...........'}, vel=0.42)
    return b.finish()
