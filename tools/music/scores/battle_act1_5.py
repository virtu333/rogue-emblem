"""Act I battle V — "Double Time".

Quick time is 120 paces a minute and double time is 180: the march breaks into
a run without anyone calling it. The piece changes speed by **metric
modulation**, never by a jump. In A2 the strings and the snare fall into
triplet eighths under the march; at B those triplets are simply eighths, and
the beat they belong to is half as fast again (120 -> 180). The same tune comes
back at the new speed, note for note. Coming home, the run's accents gather in
dotted quarters across the bar line (three bars, eight strokes), and at C a
dotted quarter of the run is a beat of the march again (180 -> 120). Nothing
ever slows or speeds by degrees; the pulse is handed over intact both ways.

The tune is this piece's own, in A major with the Mixolydian G: a falling
fanfare call (E C# A, then up), a scale run down to B, the call again leaping
to A, a held G natural over the flat seventh chord, the call on the
supertonic, and a plain cadence home. In B it is the same eight bars at 180.
C is a broad strain at quick time that climbs by step, F G A (bVI bVII I),
turns to D minor (the minor iv) and comes back to the dominant, so the loop's
return to the tune is the one perfect cadence in the piece.

Form: intro 1-2 (snare and kick) | A 3-10 at 120 | A2 11-18 at 120 (the
triplets creep in from bar 15) | B 19-26 at 180 (the tune at the run) |
B2 27-34 at 180 (the tune's first half on horns, then a run-out; bars 32-34 in
dotted-quarter strokes) | C 35-42 at 120.

  calm  one solo voice per strain (flute, solo violin, oboe, clarinet, solo
        violin) over the calm bed; the triplets and the strokes are in the calm
        piano too, so the speed changes the same way in both mixes
  full  strings, horns and trumpets, kit and bass guitar. No choir (Act I).
"""

from engine.patterns import Kit, arp, bass, chart, ostinato, pad
from engine.score import Score

from scores._battle import Battle

KEY = 'music_battle_act1_5'

QUICK, DOUBLE = 120, 180
INTRO, A0, A2, B0, B2, C0 = 1, 3, 11, 19, 27, 35

TUNE = """
E5q. C#5e A4q E5q | F#5e E5e D5e C#5e B4h | E5q. C#5e A4q A5q | G5h. F#5e E5e |
F#5q. D5e B4q F#5q | G#5e F#5e E5e D5e C#5h | D5q B4q E5q. D5e | C#5h A4h |
"""
CH_A = 'A D:2 Bm:2 A G Bm E7:2 A/C#:2 D:2 E7:2 A'
# B2: the call on horns, then the run-out; the last three bars in dotted quarters
B2_TUNE = """
E5q. C#5e A4q E5q | F#5e E5e D5e C#5e B4h | E5q. C#5e A4q A5q | G5h. F#5e E5e |
F#5e G5e A5e B5e A5e G5e F#5e E5e | D5q. D5q. D5q~ | D5e F#5q. F#5q. E5e~ | E5q E5q. E5q. |
"""
CH_B2 = 'A D:2 Bm:2 A G D D:4.5 Bm:3 E:4.5'
# C: broad, at quick time: F G A climbing by step, then the minor iv
C_TUNE = """
A5h. C6q | B5h. D6q | C#6h. E6q | E6h C#6h |
D6h. A5q | C#6h. A5q | B5h E5h | E5w |
"""
CH_C = 'F G A A Dm A/C# Bm7:2 E:2 E'

# grooves (16 steps; 12 for triplet bars)
MARCH = {'kick': 'x.......x.......', 'snare': '....x..o....x.o.', 'hat': 'x.x.x.x.x.x.x.x.'}
MARCH_FILL = {'kick': 'x.......x.......', 'snare': '....x..o..x.xxxx', 'hat': 'x.x.x.x.x.......'}
TRIP = {'kick': 'x.....x.....', 'snare': '...x.o...x.o', 'hat': 'x.xx.xx.xx.x'}
# the last two triplet bars: the hat and kick already in the new beat's twos
TRIP_TWOS = {'kick': 'x...x...x...', 'snare': '..o...x...o.', 'hat': 'x.x.x.x.x.x.'}
TRIP_FILL = {'kick': 'x...x...x...', 'snare': '..o...x.xxXX', 'hat': 'x.x.x.x.....'}
RUN = {'kick': 'x...x...x...x...', 'snare': '....x.......x...', 'hat': 'x.x.x.x.x.x.x.x.'}
RUN_FILL = {'kick': 'x...x...x...x...', 'snare': '....x...x.x.xxXX', 'hat': 'x.x.x.x.x.......'}
# the run-out: eight dotted-quarter strokes across three bars
STROKES = [{'kick': 'x.....x.....x...', 'snare': 'x.....x.....x...'},
           {'kick': '..x.....x.....x.', 'snare': '..x.....x.....x.'},
           {'kick': '....x.....x.....', 'snare': '....x.....x.xxXX'}]
BROAD = {'kick': 'x.......x.......', 'snare': '........x.......', 'ride': 'x...x...x...x...'}
BROAD_FILL = {'kick': 'x.......x.......', 'snare': '........x...xxXX', 'ride': 'x...x...x.......'}


def build():
    s = Score('battle_act1_5', tonic='A', bpm=QUICK, intro_bars=2, loop_bars=40,
              title='Double Time', seed=151)
    s.tempo(B0, DOUBLE)
    s.tempo(C0, QUICK)
    s.reverb = dict(rt60=2.0, predelay_ms=22, wet_db=-1.0)
    s.master = dict(lufs=-14.0, glue_ratio=1.5)
    b = Battle(s, calm_lufs=-17.0, full_lufs=-14.0)
    b.section('intro', INTRO, chart('A A'))
    b.section('A', A0, chart(CH_A)).section('A2', A2, chart(CH_A))
    b.section('B', B0, chart(CH_A)).section('B2', B2, chart(CH_B2))
    b.section('C', C0, chart(CH_C))

    # ================================================================ the tune
    vn = b.part('vn_mel', 'violins', role='lead', layer='full', art='sus')
    vn.at(A0).play('@f ' + TUNE)
    vn.at(A2).play('@f ' + TUNE)
    vn.at(B0).play('@ff ' + TUNE)
    vn.at(C0).play('@f ' + C_TUNE)
    cl = b.part('cl_mel', 'clarinet', role='lead2', layer='full', gain=-2)
    cl.at(A0).play('@f ' + TUNE)
    hn = b.part('hn_mel', 'horns', role='lead2', layer='full')
    hn.at(A2).play('@f ' + TUNE, transpose=-12)
    hn.at(B2).play('@ff ' + B2_TUNE, transpose=-12)
    hn.at(C0).play('@f ' + C_TUNE, transpose=-12)
    tpt = b.part('tpt_mel', 'trumpets', role='lead2', layer='full', gain=-3)
    tpt.at(B0).play('@f ' + TUNE)
    vn.at(B2 + 4).play('@ff ' + ' '.join(B2_TUNE.split('|')[4:]).replace('\n', ' '))
    # (the violins answer the horns' call an octave up, then take the run-out)
    vn.at(B2).play('@f %spic ' + 'rh A5q C#6q | rw | rh A5q E6q | rw |')

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

    # ================================================================ the pulse handed over
    # A2's last four bars: triplet eighths in the second violins and violas (and
    # the calm piano); at B they are plain eighths at the new beat
    trip = b.part('trip_vn2', 'violins2', role='ostinato', layer='full', art='spic')
    trip_va = b.part('trip_va', 'violas', role='ostinato', layer='full', art='spic')
    # (in its last two bars the triplets are accented in twos: the new beat is
    # heard before it is the beat)
    tail = chart('Bm E7:2 A/C#:2 D:2 E7:2 A')
    tail1, tail2 = tail[:3], tail[3:]
    ostinato(trip, A2 + 4, tail1, 'e3', '0 1 2', lo=64, hi=81, vel=0.5, accents='> - -')
    ostinato(trip, A2 + 6, tail2, 'e3', '0 1', lo=64, hi=81, vel=0.5, accents='> -')
    ostinato(trip_va, A2 + 4, tail1, 'e3', '0 0 0', lo=52, hi=64, vel=0.5, accents='> - -')
    ostinato(trip_va, A2 + 6, tail2, 'e3', '0 0', lo=52, hi=64, vel=0.5, accents='> -')
    trip.expr((A2 + 4, 0.55), (A2 + 7.9, 1.0), (B0, 1.0))
    trip_va.expr((A2 + 4, 0.55), (A2 + 7.9, 1.0), (B0, 1.0))
    for sec in ('B', 'B2'):
        bar, ch = b.sections[sec]
        ostinato(trip, bar, ch, 'e', '0 1 2 1', lo=64, hi=81, vel=0.52, accents='> - - -')
        ostinato(trip_va, bar, ch, 'e', '0', lo=52, hi=64, vel=0.5)
    # the run-out's strokes in the strings and brass: eight dotted quarters
    stroke_ch = chart('D:3/2 D:3/2 D:3/2 Bm:3/2 Bm:3/2 E:3/2 E:3/2 E:3/2')
    for p, lo, hi in ((trip, 64, 81), (trip_va, 52, 67)):
        p.notes = [n for n in p.notes if not (s.bar(B2 + 5) <= n.start < s.bar(C0))]
        ostinato(p, B2 + 5, stroke_ch, 'q.', '0', lo=lo, hi=hi, vel=0.7, accents='>')
        ostinato(p, B2 + 5, stroke_ch, 'q.', '2', lo=lo, hi=hi, vel=0.65)
    tbn_st = b.part('tbn_strokes', 'trombones', role='accent', layer='full', art='stac')
    ostinato(tbn_st, B2 + 5, stroke_ch, 'q.', '0', lo=45, hi=60, vel=0.7)
    ostinato(tbn_st, B2 + 5, stroke_ch, 'q.', '1', lo=45, hi=60, vel=0.66)

    # ================================================================ low strings, harmony
    vc = b.part('vc', 'celli', role='ostinato', layer='full', art='spic')
    for sec in ('A', 'A2'):
        bar, ch = b.sections[sec]
        ostinato(vc, bar, ch, 'q q q q', 'b 1 b 1', lo=38, hi=57, vel=0.6, accents='> - > -')
    for sec in ('B', 'B2'):
        bar, ch = b.sections[sec]
        ostinato(vc, bar, ch, 'e e e e e e e e', 'b b b b b b b b', lo=38, hi=55, vel=0.6,
                 accents='> - > - > - > -')
    vc.notes = [n for n in vc.notes if not (s.bar(B2 + 5) <= n.start < s.bar(C0))]
    ostinato(vc, B2 + 5, stroke_ch, 'q.', 'b', lo=38, hi=55, vel=0.7)
    bass(vc, C0, b.chart('C'), 'h h', 'r 5', floor=38, vel=0.6, art='sus')
    b.low('A', 'q')
    b.low('A2', 'q')
    b.low('B', 'q', vel=0.7)
    cb = s.parts['cb']
    bass(cb, B2, chart('A D:2 Bm:2 A G D'), 'q q q q', 'b b b b', floor=26, vel=0.7, art='spic')
    ostinato(cb, B2 + 5, stroke_ch, 'q.', 'b', lo=26, hi=45, vel=0.7)
    b.low('C', 'w')
    b.pads('A', 'violas', n=2, lo=55, hi=67, vel=0.45, layer='full', name='va_pad')
    b.brass_pad('A2', 'horns', n=2, lo=55, hi=65, vel=0.45, name='hn_pad')
    b.brass_pad('B', 'horns', n=3, lo=52, hi=65, vel=0.55, name='hn_pad')
    b.brass_pad('C', 'trombones', n=3, lo=45, hi=60, vel=0.55, name='tbn_pad')
    b.pads('C', 'violins2', n=3, lo=62, hi=76, vel=0.5, layer='full', name='vn2_pad')
    hp = b.part('harp', 'harp', role='keys', layer='full', gain=-2)
    arp(hp, C0, b.chart('C'), '0 1 2 3 4 3 2 1', step=0.5, lo=50, hi=79, vel=0.48)

    # ================================================================ rhythm section
    k = Kit(s, 'kit', gains={'cym': -3.0, 'snare': -3.0})
    b.kit = k
    b.full_only.update(k.names())
    k.play(1, {'snare': 'x..o..o.x..o..o.'}, vel=0.6)
    k.play(2, {'kick': 'x.......x.......', 'snare': 'x..o..o.x.xxxxxx'}, vel=0.64, ramp=0.4)
    b.groove('A', MARCH, MARCH_FILL, every=4, vel=0.68)
    for i in range(8):
        bar = A2 + i
        if i < 4:
            k.play(bar, MARCH_FILL if i == 3 else MARCH, vel=0.7)
        else:
            k.play(bar, TRIP_FILL if i == 7 else (TRIP_TWOS if i == 6 else TRIP), vel=0.72)
    k.play(A2, {'crash': 'X'})
    b.groove('B', RUN, RUN_FILL, every=4, vel=0.76)
    for i in range(5):
        k.play(B2 + i, RUN, vel=0.76)
    k.play(B2, {'crash': 'X'})
    for i, g in enumerate(STROKES):
        k.play(B2 + 5 + i, g, vel=0.8)
    b.groove('C', BROAD, BROAD_FILL, every=4, vel=0.72)
    for sec in ('A2', 'B', 'C'):
        b.rbass(sec, rhythm='e e e e e e e e', notes='r r 8 r r r 8 r',
                accents='> - - > - - > -')
    b.rbass('B2', rhythm='e e e e e e e e', notes='r r 8 r r r 8 r',
            accents='> - - > - - > -')
    eb = s.parts['ebass']
    eb.notes = [n for n in eb.notes if not (s.bar(B2 + 5) <= n.start < s.bar(C0))]
    ostinato(eb, B2 + 5, stroke_ch, 'q.', 'b', lo=33, hi=50, vel=0.76)
    for sec in ('A2', 'B', 'B2', 'C'):
        b.sub(sec)

    timp = b.part('timp', 'timpani', role='timp', calm_db=-8)
    timp.at(1).play('@mf rw | rh %roll @mp E2h |')
    timp.at(A0).play('%default @f A2q rq rh |')
    timp.at(A2).play('@f A2q rq rh |')
    timp.at(B0).play('@ff A2q rq rh |')
    timp.at(B2 + 5).play('@f D3q. D3q. D3q~ | D3e B2q. B2q. E2e~ | E2q E2q. E2q. |')
    timp.at(C0).play('@ff F2q rq rh |')
    for bar in (A0, A2, B0, C0):
        b.hit(bar)
    b.riser(A2 + 6, beats=8)

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
