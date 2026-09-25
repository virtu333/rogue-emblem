"""The Entity, awakened — "All of Us Across".

The Entity's theme is composed by removal: it takes away the answer, then
the downbeat, then every note but one. This is everything it took, coming
back at once. It starts the moment someone first wounds the Entity: the hum
stops (the first time the music has ever stopped), a single violin plays the
Thread (stingers/entity_answer.py), and the whole army answers it on this
piece's first downbeat.

  intro  the answer: a tutti D minor chord, then the motor starts and the
         horns call Edric's oath (D-A-G-A-D) over the dominant.
  A      Ember Dusk, the first battle theme of the run, augmented: every note
         twice as long over a 12/8 motor. The motor groups its eighths in
         fours against the bar's two halves (3 against 2, the device of
         "Twilight of the Gods"), so the ground keeps moving under a line
         that has all the time in the world ("The Apex of the World").
  B      the coalition ("Id (Purpose)"): D minor walks a descending-fifths
         chain (i iv bVII bIII bVI ii° V); horns, then trumpets, then violins
         and the choir join one at a time, and the complete Thread arrives
         only when they all sing it, over the dominant.
  A2     the choir Act I never had sings Ember Dusk. The phrase climbs to the
         leading tone (C#) and stops there: the Hollow Sun's gesture. The
         cadence it withholds is completed by The Last Light, which starts
         with the killing blow.

The Entity pushes back from underneath: its hum (D against E-flat, the
cluster and the col legno pulse) is a separate stem on the same timeline
(`<key>_hum`). The game sets its level from the Entity's remaining HP, so the
dissonance drains out of the harmony as the players wound it.
"""

from engine.patterns import Kit, arp, bass, chart, drums, ostinato, pad
from engine.score import Score

KEY = 'music_boss_entity_finale'

# 12/8: a bar is 6 quarter beats; durations in beats (1.5 = dotted quarter)
# Ember Dusk's A melody, every duration doubled (a quarter becomes two pulses)
MEL_A1 = """
A4:3 D5:3 | E5:1.5 A5:4.5~ | A5:6 | G5:1.5 F5:1.5 G5:3 |
E5:4.5 D5:1.5 | C5:3 D5:3 | E5:6~ | E5:3 r:3 |
"""
MEL_A2 = """
A4:3 D5:3 | E5:1.5 A5:4.5~ | A5:3 C6:3 | D6:1.5 C6:4.5 |
Bb5:4.5 A5:1.5 | G5:3 E5:3 | F5:4.5 E5:1.5 | D5:6 |
"""
# A2's second phrase: the same climb, but it stops on the leading tone
MEL_END = """
A4:3 D5:3 | E5:1.5 A5:4.5~ | A5:3 C6:3 | D6:1.5 C6:4.5 |
F5:3 G5:3 | A5:3 B5:1.5 C#6:1.5~ | C#6:6~ | C#6:4.5 r:1.5 |
"""
# Edric's oath (the Old Kingdom horn call), broad
OATH = 'D4:1.5 A4:1.5 G4:1.5 A4:1.5 | D5:3 C#5:3 |'

# B: the coalition. Each voice enters two bars after the last.
B_HORNS = """
A3:3 D4:3 | D4:3 Bb3:3 | C4:3 E4:3 | F4:3 C4:3 |
D4:3 F4:3 | E4:3 G4:3 | A4:6 | G4:3 C#4:3 |
"""
B_TRUMPETS = """
r:6 | r:6 | G4:1.5 C5:1.5 D5:3 | G5:6 |
F4:1.5 Bb4:1.5 C5:3 | Bb4:3 G4:3 | A4:6 | A4:3 G4:3 |
"""
B_VIOLINS = """
r:6 | r:6 | r:6 | r:6 |
D5:3 F5:3 | G5:3 Bb5:3 | A4:1.5 D5:1.5 E5:3 | A5:6 |
"""
# the complete Thread, everyone together, over the dominant
THREAD_ALL = 'A4:1.5 D5:1.5 E5:3 | A5:6 |'

CH_INTRO = chart('Dm:6 Dm:6 Gm:6 Asus4:3 A:3')
CH_A = chart('Dm:12 Bbmaj7:12 C:12 A:12 Dm:12 F:12 Gm:6 A7:6 Dm:12')
CH_B = chart('Dm:6 Gm:6 C:6 F:6 Bb:6 Edim:6 Asus4:3 A:3 A7:6')
CH_A2 = chart('Dm:12 Bbmaj7:12 C:12 A:12 Dm:12 F:12 Bb:6 A:18')

# the motor: twelve eighths, grouped in fours (accents on eighths 0, 4, 8)
# against the bar's two halves in the low end (0 and 6)
MOTOR = ' '.join(['e'] * 12)
MOTOR_DEG = '0 1 2 1 0 1 2 1 0 1 2 1'
MOTOR_ACC = '> - - - > - - - > - - -'

# 12/8 kit (12 cells a bar)
DRIVE = {'kick': 'x.....x..x..', 'snare': '...x.....x..', 'hat': 'x.xx.xx.xx.x'}
DRIVE_FILL = {'kick': 'x.....x.....', 'snare': '...x.....xxx', 'tom_lo': '......x.x...'}
TWO = {'kick': 'x.....x.....', 'ride': 'x..x..x..x..'}


def build():
    s = Score('boss_entity_finale', tonic='D', bpm=204, meter=(12, 8), intro_bars=4,
              loop_bars=40, title='All of Us Across', seed=211)
    s.reverb = dict(rt60=2.4, predelay_ms=28, wet_db=-0.5)
    s.master = dict(lufs=-13.5, glue_ratio=1.6)
    INTRO, A, B, A2 = 1, 5, 21, 29
    sections = {'intro': (INTRO, CH_INTRO), 'A': (A, CH_A), 'B': (B, CH_B), 'A2': (A2, CH_A2)}

    # ================================================================ the answer
    # bar 1, beat 1: the tutti chord that answers the hinge's solo violin
    hit_br = s.part('hit_brass', 'trombones', role='section')
    hit_br.at(1).play('@ff [D3 A3 D4]:4.5 r:1.5 |')
    hit_hn = s.part('hit_hn', 'horns', role='section')
    hit_hn.at(1).play('@ff [D4 F4 A4]:4.5 r:1.5 |')
    hit_tpt = s.part('hit_tpt', 'trumpets', role='section')
    hit_tpt.at(1).play('@ff [F4 A4 D5]:3 r:3 |')
    hit_tuba = s.part('hit_tuba', 'tuba', role='low')
    hit_tuba.at(1).play('@ff D2:4.5 r:1.5 |')
    perc = s.part('perc', 'orch_perc', role='accent')
    for bar in (1, A, B, A2):
        drums(perc, bar, {'crash': 'x', 'bd': 'x'}, vel=0.85)
    drums(perc, A2 - 1, {'swell_l': 'x'}, vel=0.6)

    # ================================================================ the motor
    va = s.part('motor_va', 'violas', role='ostinato', art='spic')
    vn2 = s.part('motor_vn2', 'violins2', role='ostinato', art='spic', pan=-0.3)
    vc = s.part('motor_vc', 'celli', role='section', art='spic')
    for sec, (bar, ch) in sections.items():
        if sec == 'intro':
            bar, ch = 2, ch[1:]
        ostinato(va, bar, ch, MOTOR, MOTOR_DEG, lo=50, hi=67, vel=0.58, accents=MOTOR_ACC)
        if sec in ('A', 'B', 'A2'):
            ostinato(vn2, bar, ch, MOTOR, '2 1 0 1 2 1 0 1 2 1 0 1', lo=62, hi=79, vel=0.54,
                     accents=MOTOR_ACC)
        # the low strings keep the bar's two halves: the "2" against the motor's "3"
        ostinato(vc, bar, ch, 'h. h.', 'b b', lo=38, hi=55, vel=0.66, accents='> -')
    va.expr((2, 0.5), (4.9, 1.0), (5, 0.85), (20.9, 0.9), (21, 0.8), (28.9, 1.0), (29, 1.0))

    cb = s.part('cb', 'basses', role='low')
    cb.at(1).play('%sus @ff D2:4.5 r:1.5 |')
    for sec in ('A', 'B', 'A2'):
        bar, ch = sections[sec]
        # (B walks through a diminished chord: octaves there, not a perfect fifth)
        bass(cb, bar, ch, 'q. q. q. q.', 'r r 8 r' if sec == 'B' else 'r r 5 r', floor=26,
             vel=0.66, art='spic')
    bass(cb, 2, CH_INTRO[1:], 'h. h.', 'r r', floor=26, vel=0.6, art='sus')

    # ================================================================ the tune
    mel = s.part('mel_vn', 'violins', role='lead', art='sus')
    mel.at(1).play('@ff [A4 D5 A5]:4.5 r:1.5 |')          # part of the answer
    mel.at(A).play('@f' + MEL_A1 + MEL_A2)
    mel.at(B).play('@f' + B_VIOLINS)
    mel.at(A2).play('@ff' + MEL_A1 + MEL_END)
    mel.expr((A, 0.8), (20.9, 0.95), (B, 0.8), (28.9, 1.0), (A2, 0.95), (44.9, 1.0))

    hn_mel = s.part('hn_mel', 'horns', role='lead2', pan=-0.2)
    hn_mel.at(3).play('@f' + OATH)
    hn_mel.at(A).play('@f' + MEL_A1 + MEL_A2, transpose=-12)
    hn_mel.at(B).play('@f' + B_HORNS)
    tpt = s.part('tpt', 'trumpets', role='counter', pan=0.2)
    tpt.at(B).play('@f' + B_TRUMPETS)
    tpt.at(A2 + 8).play('@ff' + MEL_END, transpose=-12)

    # the choir Act I never had: pads in A, joining in B, the tune in A2
    choir = s.part('choir', 'choir', role='choir')
    choir.at(1).play('@ff [D4 F4 A4]:6 |')
    pad(choir, A, CH_A, n=3, lo=55, hi=72, vel=0.5)
    pad(choir, B + 4, CH_B[4:6], n=3, lo=55, hi=72, vel=0.62)
    choir.at(B + 6).play('@ff' + THREAD_ALL)
    choir_mel = s.part('choir_mel', 'choir', role='lead')
    choir_mel.at(A2).play('@ff' + MEL_A1 + MEL_END, transpose=-12)
    choir_mel.expr((A2, 0.9), (44.9, 1.0))
    choir.expr((A, 0.6), (20.9, 0.8), (B + 4, 0.8), (28.9, 1.0))

    # ================================================================ harmony
    hn = s.part('hn_pad', 'horns', role='pad')
    pad(hn, 2, CH_INTRO[1:], n=3, lo=50, hi=65, vel=0.52)
    pad(hn, A2, CH_A2, n=3, lo=50, hi=67, vel=0.6)
    tbn = s.part('tbn', 'trombones', role='pad')
    pad(tbn, A, CH_A, n=2, lo=43, hi=58, vel=0.5)
    pad(tbn, B, CH_B, n=3, lo=43, hi=60, vel=0.58)
    pad(tbn, A2, CH_A2, n=3, lo=43, hi=60, vel=0.62)
    tuba = s.part('tuba', 'tuba', role='low')
    for sec in ('B', 'A2'):
        bar, ch = sections[sec]
        bass(tuba, bar, ch, 'h. h.', 'r r', floor=28, vel=0.62)
    va_pad = s.part('va_pad', 'violas', role='pad', art='trem')
    pad(va_pad, B, CH_B, n=2, lo=53, hi=67, vel=0.5, art='trem')
    vn_hi = s.part('vn_hi', 'violins2', role='pad', art='trem')
    pad(vn_hi, A2 + 12, CH_A2[-2:], n=2, lo=69, hi=81, vel=0.55, art='trem')

    # ================================================================ drums
    timp = s.part('timp', 'timpani', role='timp')
    timp.at(1).play('@ff D2:3 r:3 | r:6 | G2:1.5 r:4.5 | %roll A2:6 |')
    timp.at(A).play('%default @f D2:1.5 r:4.5 |')
    timp.at(B).play('@f D2:1.5 r:4.5 | G2:1.5 r:4.5 | C3:1.5 r:4.5 | F2:1.5 r:4.5 |'
                    ' Bb2:1.5 r:4.5 | E2:1.5 r:4.5 | %roll A2:6 | A2:6 |')
    timp.at(A2).play('%default @ff D2:1.5 r:4.5 |')
    timp.at(A2 + 13).play('%roll @f A2:6 | A2:6 | A2:6 |')
    timp.expr((A2 + 13, 0.5), (44.9, 1.0))

    taiko = s.part('taiko', 'taiko', role='drums')
    for bar in range(2, 45):
        # the bar's two halves, the "2"
        taiko.at(bar).play(('@mf' if bar < A else '@f') + ' D2:0.5 r:2.5 D2:0.5 r:2.5 |')

    kit = Kit(s, 'kit')
    for bar in range(A, B):
        kit.play(bar, DRIVE_FILL if (bar - A) % 4 == 3 else TWO, vel=0.64)
    for bar in range(B, A2):
        kit.play(bar, TWO, vel=0.66)
    for bar in range(A2, 45):
        kit.play(bar, DRIVE_FILL if (bar - A2) % 4 == 3 else DRIVE, vel=0.74)
    kit.play(A2, {'crash': 'X'})
    kit.play(A, {'crash': 'X'})

    glock = s.part('glock', 'glock', role='accent')
    glock.at(B + 6).play('@mf A5:1.5 D6:1.5 E6:3 | A6:6 |')
    bells = s.part('bells', 'bells', role='accent')
    bells.at(A2).play('@mf D5:6 |')
    bells.at(A2 + 8).play('@mf D5:6 |')

    # ================================================================ the Entity, underneath
    # its own stem: a hum on D with its E-flat shadow, the cluster, the col
    # legno pulse without its downbeat. The game sets this stem's level from the
    # Entity's remaining HP.
    hum = s.part('hum_drone', 'drone', role='fx', gain=2)
    for bar in range(1, 45, 4):
        hum.at(bar).play('@mf rq D1:5 | D1:6~ | D1:6~ | D1:6 |')
    cl = s.part('hum_cluster', 'basses', role='low', art='trem')
    for bar in range(1, 45, 2):
        cl.at(bar).play('@mp [D2 Eb2]:6~ | [D2 Eb2]:6 |')
    col = s.part('hum_col', 'celli', role='ostinato', art='spic')
    for bar in range(2, 45):
        col.at(bar).play('@mf r:1 Eb3:0.5 D3:0.5 r:1 Eb3:0.5 D3:0.5 r:1 Eb3:0.5 D3:0.5 |')
    hi = s.part('hum_hi', 'violins2', role='pad', art='trem')
    for bar in range(B, 45, 4):
        hi.at(bar).play('@pp [D6 Eb6]:6~ | [D6 Eb6]:6~ | [D6 Eb6]:6~ | [D6 Eb6]:6 |')

    hum_parts = [p for p in s.parts if p.startswith('hum_')]
    s.variant('full', {p: None for p in hum_parts}, lufs=-13.5)
    s.variant('hum', {p: None for p in s.parts if p not in hum_parts}, lufs=-20.0)
    return s
