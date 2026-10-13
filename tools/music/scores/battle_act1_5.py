"""Act I battle V — "Double Time".

Quick time is 132 paces a minute and double time is 198: the march breaks into
a run without anyone calling it. The piece changes speed by **metric
modulation**, never by a jump. In A2 the strings and the snare fall into
triplet eighths under the march; at B those triplets are simply eighths, and
the beat they belong to is half as fast again (132 -> 198). The same tune comes
back at the new speed, note for note. Coming home, the run's accents gather in
dotted quarters across the bar line (three bars, eight strokes), and at C a
dotted quarter of the run is a beat of the march again (198 -> 132). Nothing
ever slows or speeds by degrees; the pulse is handed over intact both ways.

It is a fighting march, not a parade. The tune is this piece's own, in A minor
with the raised seventh only on the dominant: a falling call (E C A, then up),
a scale run down to B, the call again leaping to A, a held G over the flat
seventh chord, the call on D, a run down from G-sharp over E7 with its flat
ninth, and a plain cadence home. In B it is the same eight bars at 198.

What drives it, borrowed in kind (never in notes) from the Kanazaki battle
scores Dave pointed at:

  - a marching orchestral snare in dotted figures over the kit, and a floor
    of toms under the intro
  - the whole low end (celli, basses, bass guitar, piano octaves, timpani)
    striking one syncopated rhythm together, 1 . 2 . 3 . . a | (the last hit
    an anticipation of the next bar), the chord's root only
  - a 3+3+2 eighth-note ostinato in the second violins under everything from
    A2 on, and repeated sixteenths in the violas once the run starts
  - the tune on unison horns, trumpets joining from A2, everyone at the run
  - cymbal swells into every strain's downbeat

C is a broad strain at quick time that climbs F G A (bVI bVII I) into A
*major*, the piece's only daylight, turns to D minor and comes back to the
dominant, so the loop's return to the tune is the one perfect cadence.

Form: intro 1-2 (toms and snare) | A 3-10 at 132 | A2 11-18 at 132 (the
triplets creep in from bar 15) | B 19-26 at 198 (the tune at the run) |
B2 27-34 at 198 (the call on horns, then a run-out; bars 32-34 in
dotted-quarter strokes, D minor, B-flat, E) | C 35-42 at 132.

  calm  one solo voice per strain (flute, solo violin, oboe, clarinet, solo
        violin) over the calm bed; the triplets and the strokes are in the calm
        piano too, so the speed changes the same way in both mixes
  full  strings, horns, trumpets, trombones, piano, orchestral snare, kit and
        bass guitar. No choir (Act I).
"""

from engine.patterns import Kit, arp, bass, chart, drums, ostinato
from engine.score import Score

from scores._battle import Battle

KEY = 'music_battle_act1_5'

QUICK, DOUBLE = 132, 198
INTRO, A0, A2, B0, B2, C0 = 1, 3, 11, 19, 27, 35

TUNE = """
E5q. C5e A4q E5q | F5e E5e D5e C5e B4h | E5q. C5e A4q A5q | G5h. F5e E5e |
F5q. D5e A4q F5q | G#5e F5e E5e D5e C5h | D5q B4q E5q. D5e | C5h A4h |
"""
CH_A = 'Am F:2 G:2 Am G Dm E7:2 Am/C:2 Dm:2 E7:2 Am'
# B2: the call on horns, then the run-out; the last three bars in dotted quarters
B2_TUNE = """
E5q. C5e A4q E5q | F5e E5e D5e C5e B4h | E5q. C5e A4q A5q | G5h. F5e E5e |
F5e G5e A5e G5e F5e E5e D5e E5e | D5q. D5q. D5q~ | D5e F5q. F5q. E5e~ | E5q E5q. E5q. |
"""
CH_B2 = 'Am F:2 G:2 Am G Dm Dm:4.5 Bb:3 E:4.5'
STROKES_CH = 'Dm:3/2 Dm:3/2 Dm:3/2 Bb:3/2 Bb:3/2 E:3/2 E:3/2 E:3/2'
# C: broad, at quick time: F G A climbing by step, into A major, then the minor iv
C_TUNE = """
A5h. C6q | B5h. D6q | C#6h. E6q | E6h C#6h |
D6h. A5q | C6h. A5q | B5h E5h | E5w |
"""
CH_C = 'F G A A Dm Am/C Dm:2 E:2 E'

# the low end's one rhythm: 1 . 2 . 3 . . a (the "a" anticipates the next bar)
LOW = 'X...x...x..X..x.'
LOW_C = 'X.......x..X....'

# kit grooves (16 steps; 12 for triplet bars)
MARCH = {'kick': 'X.....x.x..x..x.', 'snare': '....X..o....X.o.', 'hat': 'x.x.x.x.x.x.x.x.'}
MARCH_FILL = {'kick': 'X.....x.x.......', 'snare': '....X..o..x.xxXX', 'tom_lo': '........x.x.....'}
TRIP = {'kick': 'X..x..x..x..', 'snare': '...X.o...X.o', 'hat': 'x.xx.xx.xx.x'}
# the last two triplet bars: the hat and kick already in the new beat's twos
TRIP_TWOS = {'kick': 'X...x...x...', 'snare': '..o...X...o.', 'hat': 'x.x.x.x.x.x.'}
TRIP_FILL = {'kick': 'X...x...x...', 'snare': '..o...X.xxXX', 'tom_lo': '......x.x...'}
RUN = {'kick': 'X...x...x...x...', 'snare': '....X.......X...', 'hat': 'x.xxx.xxx.xxx.xx'}
RUN_FILL = {'kick': 'X...x...x...x...', 'snare': '....X...x.x.xxXX', 'tom_lo': '........x.x.....'}
# the run-out: eight dotted-quarter strokes across three bars
STROKES = [{'kick': 'X.....x.....x...', 'snare': 'X.....x.....x...'},
           {'kick': '..x.....x.....x.', 'snare': '..x.....x.....x.'},
           {'kick': '....x.....x.....', 'snare': '....x.....x.xxXX'}]
BROAD = {'kick': 'X.......x..x....', 'snare': '....X.......X...', 'ride': 'x.x.x.x.x.x.x.x.'}
BROAD_FILL = {'kick': 'X.......x.......', 'snare': '....X...x...xxXX', 'ride': 'x.x.x.x.x.......'}

# the marching snare (orchestral), in dotted figures
SIDE = {'sn': 'X..xx..Xx..X.xxx'}
SIDE_FILL = {'sn': 'X..xx..XxxxxXXXX'}
SIDE_TRIP = {'sn': 'X.xx.xX.xx.x'}
SIDE_RUN = {'sn': 'X.x.x.xxX.x.x.xx'}
SIDE_BROAD = {'sn': 'X.......x..x....'}
TOMS = {'tom_lo': 'xxxxxxxxxxxxxxxx', 'tom_mid': 'X.......X.......'}


def chord_at(ch, beat):
    """The chord sounding `beat` beats into a chart."""
    pos = 0.0
    for c, beats in ch:
        if beat < pos + beats - 1e-9:
            return c
        pos += beats
    return ch[-1][0]


def hits(part, s, bar, ch, grid, lo, hi=None, octave=False, vel=0.72, n_bars=None, dur=0.5):
    """Strike the chart's bass note on a 16-step grid in every bar of the chart
    (X accented); with octave, the octave above too."""
    total = sum(beats for _, beats in ch)
    bars = n_bars or int(round(total / 4))
    for k in range(bars):
        for i, c in enumerate(grid):
            if c in '.-':
                continue
            beat = k * 4 + i * 0.25
            p = chord_at(ch, beat).bass_note(lo)
            v = min(1.0, vel + (0.14 if c == 'X' else 0.0))
            t = s.bar(bar + k) + i * 0.25
            part.note(t, p, dur, vel=v)
            if octave:
                part.note(t, p + 12, dur, vel=v * 0.9)


def build():
    s = Score('battle_act1_5', tonic='A', bpm=QUICK, intro_bars=2, loop_bars=40,
              title='Double Time', seed=151)
    s.tempo(B0, DOUBLE)
    s.tempo(C0, QUICK)
    s.reverb = dict(rt60=1.8, predelay_ms=20, wet_db=-1.5)
    s.master = dict(lufs=-14.0, glue_ratio=1.7)
    b = Battle(s, calm_lufs=-17.0, full_lufs=-14.0)
    b.section('intro', INTRO, chart('Am Am'))
    b.section('A', A0, chart(CH_A)).section('A2', A2, chart(CH_A))
    b.section('B', B0, chart(CH_A)).section('B2', B2, chart(CH_B2))
    b.section('C', C0, chart(CH_C))
    stroke_ch = chart(STROKES_CH)

    # ================================================================ the tune
    hn = b.part('hn_mel', 'horns', role='lead', layer='full')
    hn.at(A0).play('@ff ' + TUNE, transpose=-12)
    hn.at(A2).play('@ff ' + TUNE, transpose=-12)
    hn.at(B0).play('@ff ' + TUNE, transpose=-12)
    hn.at(B2).play('@ff ' + B2_TUNE, transpose=-12)
    hn.at(C0).play('@ff ' + C_TUNE, transpose=-12)
    vn = b.part('vn_mel', 'violins', role='lead2', layer='full', art='sus')
    vn.at(A0).play('@f ' + TUNE)
    vn.at(A2).play('@ff ' + TUNE)
    vn.at(B0).play('@ff ' + TUNE)
    vn.at(C0).play('@ff ' + C_TUNE)
    tpt = b.part('tpt_mel', 'trumpets', role='lead2', layer='full', gain=-2)
    tpt.at(A2).play('@f ' + TUNE)
    tpt.at(B0).play('@ff ' + TUNE)
    # (the violins answer the horns' call an octave up, then take the run-out)
    vn.at(B2).play('@f %spic ' + 'rh A5q C6q | rw | rh A5q E6q | rw |')
    vn.at(B2 + 4).play('@ff %sus ' + ' '.join(B2_TUNE.split('|')[4:]).replace('\n', ' '))

    # calm: one solo voice per strain
    c_fl = b.part('c_fl', 'flute', role='lead', layer='calm')
    c_fl.at(A0).play('@mf ' + TUNE)
    c_sv = b.part('c_solo', 'solo_violin', role='lead', layer='calm')
    c_sv.at(A2).play('@mf ' + TUNE)
    c_sv.at(C0).play('@mf ' + C_TUNE, transpose=-12)
    c_ob = b.part('c_ob', 'oboe', role='lead', layer='calm')
    c_ob.at(B0).play('@mf ' + TUNE)
    c_cl = b.part('c_cl', 'clarinet', role='lead', layer='calm')
    c_cl.at(B2).play('@mf ' + B2_TUNE)

    # ================================================================ the motor
    # second violins: 3+3+2 eighths from A2, through the triplets, into the run
    drv = b.part('drv_vn2', 'violins2', role='ostinato', layer='full', art='spic')
    trip_va = b.part('trip_va', 'violas', role='ostinato', layer='full', art='spic')
    a2_head = chart('Am F:2 G:2 Am G')
    ostinato(drv, A2, a2_head, 'e e e e e e e e', '0 1 2 0 1 2 0 1', lo=64, hi=81, vel=0.56,
             accents='> - - > - - > -')
    ostinato(trip_va, A2, a2_head, 'e e e e e e e e', '0', lo=52, hi=64, vel=0.5,
             accents='> - - > - - > -')
    # A2's last four bars: triplet eighths; at B they are plain eighths at the new beat
    # (in the last two bars the triplets are accented in twos: the new beat is
    # heard before it is the beat)
    tail = chart('Dm E7:2 Am/C:2 Dm:2 E7:2 Am')
    tail1, tail2 = tail[:3], tail[3:]
    ostinato(drv, A2 + 4, tail1, 'e3', '0 1 2', lo=64, hi=81, vel=0.56, accents='> - -')
    ostinato(drv, A2 + 6, tail2, 'e3', '0 1', lo=64, hi=81, vel=0.56, accents='> -')
    ostinato(trip_va, A2 + 4, tail1, 'e3', '0 0 0', lo=52, hi=64, vel=0.52, accents='> - -')
    ostinato(trip_va, A2 + 6, tail2, 'e3', '0 0', lo=52, hi=64, vel=0.52, accents='> -')
    drv.expr((A2, 0.7), (A2 + 4, 0.75), (A2 + 7.9, 1.0), (B0, 1.0))
    for sec in ('B', 'B2'):
        bar, ch = b.sections[sec]
        ostinato(drv, bar, ch, 'e e e e e e e e', '0 1 2 0 1 2 0 1', lo=64, hi=81, vel=0.58,
                 accents='> - - > - - > -')
        # the violas saw repeated sixteenths at the run
        ostinato(trip_va, bar, ch, 's s s s', '0 0 1 0', lo=55, hi=67, vel=0.5,
                 accents='> - - -')
    # the run-out's strokes in the strings and brass: eight dotted quarters
    for p, lo, hi in ((drv, 64, 81), (trip_va, 52, 67)):
        p.notes = [n for n in p.notes if not (s.bar(B2 + 5) <= n.start < s.bar(C0))]
        ostinato(p, B2 + 5, stroke_ch, 'q.', '0', lo=lo, hi=hi, vel=0.74, accents='>')
        ostinato(p, B2 + 5, stroke_ch, 'q.', '2', lo=lo, hi=hi, vel=0.7)
    tbn_st = b.part('tbn_strokes', 'trombones', role='accent', layer='full', art='stac')
    ostinato(tbn_st, B2 + 5, stroke_ch, 'q.', '0', lo=45, hi=60, vel=0.74)
    ostinato(tbn_st, B2 + 5, stroke_ch, 'q.', '1', lo=45, hi=60, vel=0.7)
    # trumpet and trombone stabs, 3+3+2, under the tune at the run
    b.stabs('B', rhythm='q. q. q', lo=60, hi=74, vel=0.7, inst='trumpets')
    b.stabs('A2', rhythm='q. q. q', lo=45, hi=60, vel=0.7, inst='trombones')

    # ================================================================ the low end, as one
    vc = b.part('vc', 'celli', role='ostinato', layer='full', art='spic')
    cbh = b.part('cb_hits', 'basses', role='bass', layer='full', art='spic')
    pno = b.part('pno_low', 'grand', role='keys', layer='full', gain=-2)
    timp = b.part('timp', 'timpani', role='timp', calm_db=-8)
    for sec in ('A', 'A2', 'B', 'B2'):
        bar, ch = b.sections[sec]
        n = 5 if sec == 'B2' else 8
        hits(vc, s, bar, ch, LOW, lo=40, octave=True, vel=0.66, n_bars=n)
        hits(cbh, s, bar, ch, LOW, lo=28, vel=0.7, n_bars=n)
        hits(pno, s, bar, ch, LOW, lo=28, octave=True, vel=0.62, n_bars=n, dur=0.4)
    # A2's triplet bars keep the hits but the run's twos already sound under them
    for p in (vc, cbh, pno):
        p.notes = [n for n in p.notes if not (s.bar(A2 + 6) <= n.start < s.bar(B0))]
    for p, lo, oc in ((vc, 40, True), (cbh, 28, False), (pno, 28, True)):
        hits(p, s, A2 + 6, tail2, 'X...x...x...x...', lo=lo, octave=oc, vel=0.66, n_bars=2)
        ostinato(p, B2 + 5, stroke_ch, 'q.', 'b', lo=lo, hi=lo + 17, vel=0.76)
        hits(p, s, C0, b.chart('C'), LOW_C, lo=lo, octave=oc, vel=0.64)
    b.low('A', 'q', vel=0.5)
    b.low('B', 'q', vel=0.55)
    b.low('C', 'w')

    b.brass_pad('A', 'trombones', n=3, lo=45, hi=60, vel=0.5, name='tbn_pad')
    b.brass_pad('B', 'horns', n=3, lo=52, hi=65, vel=0.55, name='hn_pad')
    b.brass_pad('C', 'trombones', n=3, lo=45, hi=60, vel=0.6, name='tbn_pad')
    b.pads('A', 'violas', n=2, lo=55, hi=67, vel=0.45, layer='full', name='va_pad')
    b.pads('C', 'violins2', n=3, lo=62, hi=76, vel=0.5, layer='full', name='vn2_pad')
    hp = b.part('harp', 'harp', role='keys', layer='full', gain=-2)
    arp(hp, C0, b.chart('C'), '0 1 2 3 4 3 2 1', step=0.5, lo=50, hi=79, vel=0.48)

    # ================================================================ drums
    side = b.part('side', 'orch_perc', role='snare', layer='full')
    drums(side, 1, {'sn': 'x..xx..xx..x.xxx'}, vel=0.5)
    drums(side, 2, {'sn': 'x..xx..xxxxxxxxx'}, vel=0.56, ramp=0.4)
    for i in range(8):
        drums(side, A0 + i, SIDE_FILL if i % 4 == 3 else SIDE, vel=0.58)
        if i < 4:
            drums(side, A2 + i, SIDE_FILL if i == 3 else SIDE, vel=0.6)
        else:
            drums(side, A2 + i, SIDE_TRIP, vel=0.6, step=1 / 3)
        drums(side, B0 + i, SIDE_FILL if i % 4 == 3 else SIDE_RUN, vel=0.62)
        drums(side, C0 + i, SIDE_FILL if i % 4 == 3 else SIDE_BROAD, vel=0.58)
    for i in range(5):
        drums(side, B2 + i, SIDE_FILL if i == 4 else SIDE_RUN, vel=0.62)
    toms = Kit(s, 'toms_intro', gains={'toms': 6.0})
    b.full_only.update(toms.names())
    toms.play(1, TOMS, vel=0.56)
    toms.play(2, TOMS, vel=0.62, ramp=0.4)
    toms.play(B0 - 1, {'tom_lo': '........xxxxxxxx'}, vel=0.6, ramp=0.5)

    k = Kit(s, 'kit', gains={'cym': -3.0, 'snare': -3.0})
    b.kit = k
    b.full_only.update(k.names())
    k.play(2, {'kick': 'X.......X.......', 'snare': '........x.xxxxXX'}, vel=0.64, ramp=0.4)
    b.groove('A', MARCH, MARCH_FILL, every=4, vel=0.72)
    for i in range(8):
        bar = A2 + i
        if i < 4:
            k.play(bar, MARCH_FILL if i == 3 else MARCH, vel=0.74)
        else:
            k.play(bar, TRIP_FILL if i == 7 else (TRIP_TWOS if i == 6 else TRIP), vel=0.76)
    k.play(A2, {'crash': 'X'})
    b.groove('B', RUN, RUN_FILL, every=4, vel=0.8)
    for i in range(5):
        k.play(B2 + i, RUN, vel=0.8)
    k.play(B2, {'crash': 'X'})
    for i, g in enumerate(STROKES):
        k.play(B2 + 5 + i, g, vel=0.84)
    b.groove('C', BROAD, BROAD_FILL, every=4, vel=0.76)
    for sec in ('A', 'A2', 'B', 'C'):
        b.rbass(sec, rhythm='e e e e e e e e', notes='r r 8 r r r 8 r',
                accents='> - - > - - > -')
    b.rbass('B2', rhythm='e e e e e e e e', notes='r r 8 r r r 8 r',
            accents='> - - > - - > -')
    eb = s.parts['ebass']
    eb.notes = [n for n in eb.notes if not (s.bar(B2 + 5) <= n.start < s.bar(C0))]
    ostinato(eb, B2 + 5, stroke_ch, 'q.', 'b', lo=33, hi=50, vel=0.8)
    for sec in ('A', 'A2', 'B', 'B2', 'C'):
        b.sub(sec)

    timp.at(1).play('@mf E2q E2q E2q E2q | %roll @mp E2h. %default @f E2q |')
    for bar, root in ((A0, 'A2'), (A0 + 4, 'A2'), (A2, 'A2'), (A2 + 4, 'D3'),
                      (B0, 'A2'), (B0 + 4, 'D3'), (C0, 'F2'), (C0 + 4, 'D3')):
        timp.at(bar).play(f'%default @ff {root}e re {root}e re {root}q rq |')
    timp.at(B2 + 5).play('@ff D3q. D3q. D3q~ | D3e Bb2q. Bb2q. E2e~ | E2q E2q. E2q. |')
    for bar in (A0, A2, B0, B2, C0):
        b.hit(bar)
    for bar in (A2, B0, C0):
        b.riser(bar - 2, beats=8)

    # ================================================================ calm bed
    for sec in ('A', 'A2', 'B', 'C'):
        b.calm_bed(sec, piano='0 2 4 2', piano_lo=55, piano_hi=76)
    b.calm_bed('B2', piano='0 2 4 2', piano_lo=55, piano_hi=76)
    b.calm_bed('intro', piano='0 2 4 2', piano_lo=55, piano_hi=76, pad_n=0)
    # the calm piano carries the triplets into B and the strokes out of B2
    cp = s.parts['c_pno']
    cp.notes = [n for n in cp.notes
                if not (s.bar(A2 + 4) <= n.start < s.bar(B0))
                and not (s.bar(B2 + 5) <= n.start < s.bar(C0))]
    ostinato(cp, A2 + 4, tail1, 'e3', '0 1 2', lo=57, hi=76, vel=0.42, accents='> - -')
    ostinato(cp, A2 + 6, tail2, 'e3', '0 1', lo=57, hi=76, vel=0.42, accents='> -')
    ostinato(cp, B2 + 5, stroke_ch, 'q.', '0', lo=57, hi=76, vel=0.5)
    ostinato(cp, B2 + 5, stroke_ch, 'q.', '2', lo=57, hi=76, vel=0.46)
    return b.finish()
