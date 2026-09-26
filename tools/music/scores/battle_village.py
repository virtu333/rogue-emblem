"""Village battles — "Bells Over the Village".

A village under attack: no army, only people and a bell. The alarm rings
E-A-A ("ding-dong-dong"), and a fiddle takes the bell's words and makes a
call of them. The village answers with a tune of its own, a falling line of
long-short-long steps (A-G-E, G-F-D) that turns the minor key towards F and
G: the answer is what moves the harmony. Fast 3/4 on dry hand drums (a low
"doum" on one and three, a rim "tek" between) and plucked low strings that
stamp the answer's own long-short-long rhythm.

The same call gets three kinds of answer as the loop goes on:

  A   a few:  one accordion answers, then an accordion and a clarinet
  A2  many:   everyone who can hold a tune, fiddle included, in thirds
  B   the fight in the lanes: C major, the answer's rhythm carried forward,
      the bell turned into a rallying ring on every phrase
  C   none:   the call goes out and nothing answers. With no answer the
      harmony cannot move: the band sits on A under the alarm bell, which
      keeps ringing; the second call is cried an octave higher

Whoever answers plays the same upbeat, E-G-sharp, into the answer; in C one
accordion still plays it, alone, and nobody follows. At the end of the loop
the band stamps the answer's rhythm in unison, stops dead on the downbeat,
and for a bar and a half only the bell rings on into the call; when the loop
comes round, a few answer again. Under the band the bell is struck and caught
by hand (it never rings over the answer's chords); only where nobody answers
is it left to ring. No choir: the answer is a melody played by people, not a
crowd sound (that is the Colosseum's). No leitmotif is quoted; this is the
villagers' own music.

What it takes from Silver for Monsters: the one upbeat that every answering
voice shares, and a stop on the downbeat instead of a cadence. The bell is
this piece's own device. The study behind it heard Silver's long note as a
held pitch with a wrong side, consonant over half the loop and a tritone over
the rest. That note is really Silver's tonic, held with no tritone under it.
So the bell here does the opposite: it is caught short under every answer and
rings freely only where nobody answers. The few / many / none scheme is not
Silver's either (its later sections bring new material rather than the same
tune with voices removed). It follows the brief's call and answers.
"""

from engine.patterns import Kit, bass, chart, drums, ostinato, pad
from engine.score import Score

from scores._battle import Battle

KEY = 'music_battle_village'

# ------------------------------------------------------------------ material
# the bell's alarm, and the call built on it
ALARM = 'E5q A4q A4q |'
# the upbeat every answering voice plays into the answer (over the call's E chord)
PICKUP = 'rh E5e G#5e |'
CALL1 = 'E5q> A4q A4q | E5q.> D5e C5q | B4q> C5q D5q | E5h.> |'
CALL2 = 'E5q> A4q A4q | E5q.> F5e G5q | A5q> G5q F5q | E5h.> |'
CH_CALL1 = 'Am:3 Am:3 G:3 E:3'
CH_CALL2 = 'Am:3 C:3 Dm:3 E:3'

# the village's answer: long-short-long, falling
ANS1 = 'A5q.> G5e E5q | G5q.> F5e D5q | E5q> C5q B4q | A4h.> |'
ANS2 = 'A5q.> G5e E5q | G5q.> F5e D5q | C5q.> D5e B4q | A4h.> |'
# a second voice under it, thirds and sixths the way people sing together
ANS1_LO = 'F5q. E5e C5q | B4q. D5e B4q | C5q A4q G#4q | E4h. |'
ANS2_LO = 'F5q. E5e C5q | B4q. D5e B4q | A4q. F4e G#4q | E4h. |'
CH_ANS1 = 'F:2 C/E:1 G:3 Am:2 E:1 Am:3'
CH_ANS2 = 'F:2 C/E:1 G:3 Dm:2 E:1 Am:3'

# B: the fight in the lanes, the answer's rhythm carried into C major
MEL_B = """
C5q. D5e E5q | G5h E5q | F5q. E5e D5q | E5h C5q |
A4q. B4e C5q | E5h D5q | C5q B4q A4q | G#4h. |
C5q. D5e E5q | G5h A5q | B5q. A5e G5q | E5h C5q |
D5q. E5e F5q | A5h G5q | F5q E5q D5q | E5h. |
"""
MEL_B_LO2 = """
E4q. F4e G4q | C5h C5q | D5q. C5e B4q | G4h E4q |
F4q. G4e A4q | C5h E5q | A4q G4q F4q | G#4h. |
"""
MEL_B_LO = """
E4q. F4e G4q | C5h G4q | A4q. G4e F4q | G4h E4q |
C4q. D4e E4q | G4h F4q | E4q D4q C4q | B3h. |
""" + MEL_B_LO2
CH_B = ('C:3 C:3 Dm:3 C:3 Am:3 C:2 G:1 Am:1 E/G#:1 Am:1 E:3 '
        'C:3 C:2 F:1 G:3 C:3 Dm:3 F:2 C:1 Dm:1 C:1 Dm:1 E:3')

# ------------------------------------------------------------------ drums (12 steps = 3/4 in 16ths)
FEW = {'tom_lo': 'X.......x...', 'rim': '....x.....x.', 'tamb': 'x...x...x...'}
FEW_FILL = {'tom_lo': 'X.......x...', 'rim': '....x.......', 'tom_hi': '........x.xx'}
MANY = {'kick': 'x.......x...', 'tom_lo': 'X.....x.x...', 'rim': '....x.....x.',
        'tamb': 'x.x.x.x.x.x.'}
MANY_FILL = {'kick': 'x.......x...', 'tom_lo': 'X.....x.....', 'rim': '....x.......',
             'tom_hi': '........xxXX'}
LANES = {'kick': 'x.......x...', 'rim': '..x...x...x.', 'tom_lo': 'X...........',
         'tamb': 'xxxxxxxxxxxx'}
LANES_FILL = {'kick': 'x...x...x...', 'tom_lo': 'X.......xxxx', 'tom_hi': '....xxxx....'}
NONE = {'tom_lo': 'X...x...x...', 'rim': '..o...o...x.', 'tamb': 'x.x.x.x.x.x.'}
NONE_FILL = {'kick': 'x...x...x...', 'tom_lo': 'X.x.x.x.xxxx', 'tom_hi': '.x.x.x.x....'}


def build():
    s = Score('battle_village', tonic='A', bpm=172, meter=(3, 4), intro_bars=4, loop_bars=64,
              title='Bells Over the Village', seed=149)
    s.reverb = dict(rt60=2.0, predelay_ms=20, wet_db=-1.0)
    s.master = dict(lufs=-14.0, glue_ratio=1.5)
    b = Battle(s, calm_lufs=-17.0, full_lufs=-14.0)

    INTRO, A, A2, B, C = 1, 5, 21, 37, 53
    b.section('intro', INTRO, chart('Am:3 Am:3 Am:3 Am:3'))
    b.section('A', A, chart(' '.join([CH_CALL1, CH_ANS1, CH_CALL2, CH_ANS2])))
    b.section('A2', A2, chart(' '.join([CH_CALL1, CH_ANS1, CH_CALL2, CH_ANS2])))
    b.section('B', B, chart(CH_B))
    # C: nobody answers, so the answer's harmony never arrives: the band sits on A
    b.section('C', C, chart(' '.join([CH_CALL1, 'Am:12', CH_CALL2, 'Am:12'])))

    # ================================================================ the call
    fid = b.part('fiddle', 'solo_violin', role='lead', calm_db=0, gain=1.5,
                 eq=[('peak', 3000, 1.0, -2.0)])
    for bar, text in ((A, CALL1), (A + 8, CALL2), (A2, CALL1), (A2 + 8, CALL2),
                      (C, CALL1)):
        fid.at(bar).play('@f ' + text)
    fid.at(C + 8).play('@ff ' + CALL2, transpose=12)      # the call cried higher
    # the caller joins the many: its held E becomes the shared upbeat
    for bar in (A2 + 3, A2 + 11):
        fid.notes = [n for n in fid.notes if not (s.bar(bar) - 1e-9 <= n.start < s.bar(bar + 1))]
        fid.at(bar).play('@f E5h E5e G#5e |')
    fid.at(A2 + 4).play('@f ' + ANS1)
    fid.at(A2 + 12).play('@f ' + ANS2)
    fid.at(B).play('@f ' + MEL_B)
    fid.expr((A, 0.85), (A2, 0.95), (B, 1.0), (C, 0.9), (C + 8, 1.0), (C + 15.9, 1.0))

    # ================================================================ the answers
    # a few: one accordion, then an accordion and a clarinet
    acc = b.part('acc', 'accordion', role='lead', calm_db=-1,
                 eq=[('peak', 2800, 1.0, -2.5), ('highshelf', 6000, 0.7, -2.0)])
    acc.at(A + 4).play('@f ' + ANS1)
    acc.at(A + 12).play('@f ' + ANS2)
    cl = b.part('cl', 'clarinet', role='lead2', calm_db=0)
    cl.at(A + 12).play('@mf ' + ANS2_LO)
    acc.expr((A, 1.0), (A2, 0.85), (B, 0.75), (C, 1.0))
    for bar in (A + 3, A + 11, A2 + 3, A2 + 11):
        acc.at(bar).play('@f ' + PICKUP)
    # none: one accordion still draws breath to answer... and nobody follows
    for bar in (C + 3, C + 11):
        acc.at(bar).play('@mp ' + PICKUP)
    # many: accordion in thirds, violins, clarinet, violas, celli and horns below
    acc.at(A2 + 4).play('@f ' + ANS1)
    acc.at(A2 + 12).play('@f ' + ANS2)
    acc_lo = b.part('acc_lo', 'accordion', role='counter', calm_db=-2,
                    eq=[('peak', 2800, 1.0, -2.5), ('highshelf', 6000, 0.7, -2.0)])
    acc_lo.at(A2 + 4).play('@f ' + ANS1_LO)
    acc_lo.at(A2 + 12).play('@f ' + ANS2_LO)
    cl.at(A2 + 4).play('@mf ' + ANS1_LO)
    cl.at(A2 + 12).play('@mf ' + ANS2_LO)
    vn = b.part('vn', 'violins', layer='full', role='lead2', art='sus',
                eq=[('peak', 3000, 1.0, -2.0)])
    for bar in (A2 + 3, A2 + 11):
        vn.at(bar).play('@f ' + PICKUP)
    vn.at(A2 + 4).play('@f ' + ANS1)
    vn.at(A2 + 12).play('@f ' + ANS2)
    va_h = b.part('va_h', 'violas', layer='full', role='counter', art='sus')
    va_h.at(A2 + 4).play('@f ' + ANS1_LO, transpose=-12)
    va_h.at(A2 + 12).play('@f ' + ANS2_LO, transpose=-12)
    vc_m = b.part('vc_m', 'celli', layer='full', role='counter', art='sus')
    vc_m.at(A2 + 4).play('@f ' + ANS1, transpose=-24)
    for bar in (A2 + 3, A2 + 11):
        vc_m.at(bar).play('@f ' + PICKUP, transpose=-24)
    vc_m.at(A2 + 12).play('@f ' + ANS2, transpose=-24)
    hn = b.part('hn', 'horns', layer='full', role='section')
    hn.at(A2 + 4).play('@f ' + ANS1, transpose=-12)
    for bar in (A2 + 3, A2 + 11):
        hn.at(bar).play('@f ' + PICKUP, transpose=-12)
    hn.at(A2 + 12).play('@f ' + ANS2, transpose=-12)

    # ================================================================ B: the lanes
    vn.at(B).play('@f ' + MEL_B)
    acc.at(B).play('@mf ' + MEL_B)
    acc_lo.at(B).play('@mf ' + MEL_B_LO)
    cl.at(B + 8).play('@mf ' + MEL_B_LO2)
    # lint: the tune's passing notes on weak beats (B over Am in bar 43, E over Dm in
    # bar 51, C over G in the call) brush the held pads for one beat; intended
    b.brass_pad('B', inst='horns', name='hn_pad', n=2, lo=55, hi=69, vel=0.46)

    # ================================================================ the bell
    # struck and caught by hand (damp) so it never rings over the answer's chords;
    # only where nobody answers is it left to ring, strike over strike
    # rung in the square, not beside the listener: far back in the room
    bell = b.part('bell', 'bells', role='accent', calm_db=-3, gain=-7, art='damp', depth=0.95,
                  eq=[('peak', 2600, 1.0, -4.0), ('highshelf', 4000, 0.7, -4.0)],
                  comp=dict(thresh_db=-32, ratio=3.0, attack_ms=1, release_ms=180))
    bell.at(INTRO).play('%damp @f ' + ALARM * 3 + ' E5q A4q A4q |')
    for bar in (A, A + 8, A2, A2 + 8, C, C + 8):
        bell.at(bar).play('%damp @f E5q A4q A4q+h. |')
    for bar in (B, B + 4, B + 8, B + 12):                # the rallying ring
        bell.at(bar).play('%damp @f C5h. |')
    # the alarm where the answer was: every strike left ringing over the next ones
    for bar in (C + 4, C + 12):
        for k in range(4):
            v = (0.76, 0.62, 0.8, 0.88)[k]
            for beat, p in ((0, 'E5'), (1, 'A4'), (2, 'A4')):
                bell.note(s.bar(bar + k) + beat, p, 4.0, vel=v, art='damp')

    # ================================================================ plucked low strings
    # the answer's long-short-long is the groove
    for sec in ('A', 'A2', 'B', 'C'):
        bar, ch = b.sections[sec]
        pc = b.part('pz_cb', 'basses', role='low', art='pizz', calm_db=-2)
        bass(pc, bar, ch, 'q. e q', 'r r 5', floor=28, vel=0.7, art='pizz')
        pv = b.part('pz_vc', 'celli', role='section', art='pizz', calm_db=-4, gain=-3)
        bass(pv, bar, ch, 'q. e q', 'r 8 5', floor=40, vel=0.62, art='pizz')
    b.s.parts['pz_cb'].at(INTRO + 2).play('%pizz @f A1q. A1e E2q | A1q. A1e E2q |')
    b.s.parts['pz_vc'].at(INTRO + 2).play('%pizz @mf A2q. A3e E3q | A2q. A3e E3q |')

    # a running viola figure keeps the feet moving (full)
    for sec in ('A2', 'B', 'C'):
        b.spic8(sec, 'violas', degrees='0 1 2 1 2 1', lo=52, hi=67, vel=0.56,
                accents='> - - - > -', layer='full')
    b.spic8('A', 'violas', degrees='0 1 2 1 2 1', lo=52, hi=67, vel=0.5,
            accents='> - - - > -', layer='full')
    # C: the dread under the unanswered call
    trem = b.part('vc_trem', 'celli', layer='full', role='pad', art='trem')
    for bar in (C + 4, C + 12):
        trem.at(bar).play('@mf [A2 E3]h.~ | [A2 E3]h.~ | [A2 E3]h.~ | [A2 E3]h. |')

    # ================================================================ drums
    b.groove('intro', {'tom_lo': 'X.......x...', 'tamb': 'x...x...x...'}, crash=False,
             n_bars=2)
    b.kit.play(INTRO + 2, FEW, vel=0.6)
    b.kit.play(INTRO + 3, FEW_FILL, vel=0.66, ramp=0.3)
    b.kit.parts['snare'].opts['gain'] = -7.0     # the rim is a tap, not a backbeat
    b.groove('A', FEW, FEW_FILL, every=4, vel=0.66, crash=False)
    b.groove('A2', MANY, MANY_FILL, every=4, vel=0.74, crash=False)
    b.groove('B', LANES, LANES_FILL, every=4, vel=0.76, crash=False)
    b.groove('C', NONE, NONE_FILL, every=8, vel=0.72, crash=False)
    perc = b.part('perc', 'orch_perc', role='accent', calm_db=-8)
    for bar in (A2, A2 + 4, A2 + 8, A2 + 12, B, B + 4, B + 8, B + 12):
        drums(perc, bar, {'bd': 'x'}, vel=0.75)
    drums(perc, C, {'bd': 'x', 'sus': 'x'}, vel=0.7)

    # ================================================================ calm bed
    for sec in ('A', 'A2', 'B', 'C'):
        bar, ch = b.sections[sec]
        vp = b.part('c_pad', 'violas', layer='calm', role='pad', art='soft')
        pad(vp, bar, ch, n=2, lo=53, hi=67, vel=0.42, art='soft')
        lb = b.part('c_low', 'basses', layer='calm', role='low', art='soft')
        bass(lb, bar, ch, 'h.', 'r', floor=28, vel=0.46, art='soft')
    b.calm_kit = Kit(s, 'ckit', gains={'toms': -3})
    b.calm_only.update(b.calm_kit.names())
    for bar in range(INTRO + 2, C + 16):
        b.calm_kit.play(bar, {'tom_lo': 'x.......x...'}, vel=0.44)
    # the loop's end: the band stamps the answer's long-short-long in unison, stops
    # dead on the next downbeat, and for a bar and a half only the bell rings on
    stop_after_downbeat(s, C + 14, keep=('bell',))
    for name, part in s.parts.items():
        if name != 'bell':
            clear_bar(part, C + 15)
    for name in b.kit.names() + b.calm_kit.names() + ['ost8_violas']:
        for bar in (C + 13, C + 14, C + 15):
            clear_bar(s.parts[name], bar)
    b.kit.play(C + 13, {'kick': 'X.....x.X...', 'tom_lo': 'X.....x.X...',
                        'tom_hi': '......x.X...', 'rim': 'X.....x.X...'}, vel=0.8)
    b.calm_kit.play(C + 13, {'tom_lo': 'x.....x.x...'}, vel=0.5)
    b.kit.play(C + 14, {'kick': 'X', 'tom_lo': 'X', 'tom_hi': 'X', 'tamb': 'X'}, vel=0.85)
    b.calm_kit.play(C + 14, {'tom_lo': 'x'}, vel=0.5)
    drums(perc, C + 14, {'bd': 'x'}, vel=0.8)
    b.timp('C', 'rh. | rh. | rh. | rh. | rh. | rh. | rh. | rh. | rh. | rh. | rh. | rh. | rh. |'
                ' @ff A2q rh |')
    # in the break the bell is the only voice: it comes forward (its own part, so
    # its level is set apart from the far-off strikes under the band)
    solo = b.part('bell_solo', 'bells', role='lead2', calm_db=-3, depth=0.9, gain=-2,
                  eq=[('peak', 2600, 1.0, -3.0), ('highshelf', 4000, 0.7, -3.0)])
    t14 = s.bar(C + 14) + 1 - 1e-6
    solo.notes = [n for n in bell.notes if n.start >= t14]
    bell.notes = [n for n in bell.notes if n.start < t14]
    s.parts['vc_trem'].notes = [n for n in s.parts['vc_trem'].notes if n.start < s.bar(C + 13)]
    for n in s.parts['vc_trem'].notes:
        if n.end > s.bar(C + 13):
            n.dur = s.bar(C + 13) - n.start
    stab = b.part('stab_acc', 'accordion', role='accent', layer='full')
    stab.at(C + 13).play('@f [A3 C4 E4]q. [A3 C4 E4]e [A3 C4 E4]q | [A3 C4 E4]q rh |')
    return b.finish()


def clear_bar(part, bar):
    s = part.score
    part.notes = [n for n in part.notes if not (s.bar(bar) - 1e-9 <= n.start < s.bar(bar + 1) - 1e-9)]


def stop_after_downbeat(s, bar, keep=()):
    """Every part but `keep` stops after the first beat of `bar`: later notes go,
    notes still sounding are cut off at the second beat."""
    t0, t1, t2 = s.bar(bar), s.bar(bar) + 1, s.bar(bar + 1)
    for name, part in s.parts.items():
        if name in keep:
            continue
        part.notes = [n for n in part.notes if not (t0 + 1e-6 < n.start < t2 - 1e-9)]
        for n in part.notes:
            if n.start < t1 < n.end:
                n.dur = t1 - n.start
