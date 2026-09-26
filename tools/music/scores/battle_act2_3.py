"""Act II battle III — "Old Kingdom Roads".

The occupied provinces. The Empire paved these roads and drills along them;
the partisans move between its columns. The piece is theirs, and the roads
are the Empire's.

The partisans own one cell, a signal passed from hill to hill: two quick
notes on the same pitch and a leap of a minor seventh, then a fall (G G F
... D C). It is the invariant. It opens every phrase in every key the loop
visits (G minor, C minor, D minor, A minor), it is re-barred into three when
the meter changes, and it is always the partisans' voice. The Empire's drill
(D-Eb-D-C, falling to B-flat) is heard only as what the road belongs to:
muted horns and a distant side drum passing under the tune in the first
strain, and again at the very end.

The whole loop is natural minor. No strain has a leading tone: D minor has
no C-sharp, A minor no G-sharp, and G minor no F-sharp, until the long
descent. There the bass walks the whole minor collection down from A (A G F
E-flat D C B-flat; the harmony drifts flatward from A minor, one flat at a
time) while the horns pass the signal down the road with it, turns to
A-flat (the lowered second) and leaps to D major: the first F-sharp in the
piece. Over it the melody sings the Empire's own drill, D-Eb-D-C,
harmonised so that it points home, and one bar of accented eighths runs up
the dominant's scale (the drill's E-flat and the new F-sharp together) into
the new meter.

The meter change has a job. The road is the Empire's and it marches in
four: the drill is a four-beat figure and the partisans walk in its step for
the first thirty-two bars. When the leading tone arrives the partisans stop
walking in step: the bar becomes three, the signal gets a longer landing,
and the band dances instead of marching. At the end of the dance the drill
comes back, forced into three, and the loop returns to four: the road still
belongs to the Empire, and the next ambush begins.

  intro  1-4   the drill on muted horns and side drum; the signal answers
                from far off (a clarinet)
  A      1-8   G minor: the partisans' tune, clarinet and violas (calm: a
                solo violin, a fiddle; not a clarinet, which is the shop's
                voice in the same key, heard just before on the Act II map);
                the drill passes underneath twice
  A'     9-16  the same tune a fourth up in C minor, violins and oboe
  B     17-24  the signal in D minor, then A minor: horns and violins
  C     25-32  the descent: A G F Eb D C Bb, bII (A-flat), V (D major); the
                violins rise in long notes against it and end on D-Eb-D-C
  D     33-44  3/4, sixteen bars: the dance, tutti, over a mazurka stamp,
                not an oom-pah-pah. Under the tune the downbeat belongs to
                the kick and the basses (low strings, bass guitar) alone,
                with no tuba; the accent is beat 2, where the signal's
                landing falls (violas and trombones in short chords, snare,
                tambourine, timpani); beat 3 is left to the hat and the tune,
                with a ghost snare and the bass's pickup into the next bar.
                The drill returns in the last two bars (in three) and hands
                the road back to four

Bar numbers are loop bars in 4/4 units (the 3/4 section is sixteen bars of
three beats, twelve bars of four).

  calm  solo violin / oboe / flute / solo violin / clarinet on the tune over
        the calm bed (in the dance the piano and celli lean on beat 2 too);
        the drill stays, far off
  full  strings, horns, winds, kit and bass guitar; no choir (voices are
        kept for the rite in Act III)
"""

from engine.patterns import Kit, bass, chart, drums, ostinato, pad
from engine.score import Score

from scores._battle import Battle

KEY = 'music_battle_act2_3'

# ------------------------------------------------------------------ material
SIGNAL = 'G4e G4e F5q. D5e C5q'
# A: G minor; the signal, answered by a furtive snap (dotted eighth,
# sixteenth, a long note), twice; then a climb to G and back
TUNE = """
G4e G4e F5q. D5e C5q | D5e. C5s Bb4h. | G4e G4e F5q. Eb5e C5q | C5e. Bb4s A4h. |
Bb4e C5e D5q G5q. F5e | Eb5q. D5e C5q Bb4q | C5q. D5e Eb5q G5q | F5w |
"""
CH_A = 'Gm:4 Bb:4 Cm:4 F:4 Gm:4 Eb:4 Cm:4 Dm:4'
# B: the signal in D minor, then A minor (natural minor both)
UPROAD = """
D5e D5e C6q. A5e G5q | F5e. E5s D5h. | D5e D5e C6q. Bb5e G5q | G5h. rq |
A4e A4e G5q. E5e D5q | C5e. B4s A4h. | A4e A4e G5q. F5e D5q | D5h. rq |
"""
CH_B = 'Dm:4 Bb:4 Gm:4 C:4 Am:4 F:4 Dm:4 Em:4'
# C: the long descent. The bass walks the minor collection down; the violins
# climb in long notes against it and end on the Empire's drill, D-Eb-D-C,
# over bII-V, so it points home
DESCENT = 'C5w | D5w | F5h. Eb5q | G5w | A5h. G5q | C6w | D6h Eb6h | D6h C6h |'
CH_C = 'Am:4 Gm:4 F:4 Eb:4 Dm:4 Cm:4 Bb:2 Ab:2 D7:4'
# the partisans' signal passed down the road, under the descent
DESCENT_HN = 'A3e A3e G4h. | G3e G3e F4h. | F3e F3e Eb4h. | Eb4w | D4w | Eb4w | F4h Eb4h | F#4w |'
DESCENT_BASS = 'A2w | G2w | F2w | Eb2w | D2w | C2w | Bb1h Ab1h | D2w |'
# D: the dance, sixteen bars of 3/4. The signal re-barred: the two quick
# notes now lead to a landing that lasts two beats. The first half takes up
# the descent's register (G5 to G6); the second comes down, so the loop can
# hand the tune back to the clarinet at G4
DANCE_HI = """
G5e G5e F6h | D6q C6q Bb5q | G5e G5e Eb6h | C6h. |
G5e G5e F6h | G6q F6q D6q | Eb6q C6q G5q | D6h. |
"""
DANCE_LO = """
Bb4e Bb4e G5h | A5q G5q F5q | G4e G4e F5h | Eb5q Bb4q G4q |
C5q. Bb4e G4q | A4h F4q | D5h. | Eb5h. |
"""
# the launch: one bar of accented eighths up the scale of the dominant, the
# drill's E-flat and the new F-sharp in the same run, into the first bar of 3
LAUNCH = 'D3e> Eb3e> F#3e> G3e> A3e> Bb3e> C4e> D4e> |'
CH_D = ('Gm:3 Gm:3 Eb:3 F:3 Gm:3 Gm:3 Cm:3 Dm:3 '
        'Eb:3 F:3 Gm:3 Eb:3 Cm:3 Dm:3 Gm:3 Cm7:3')
# the Empire's drill: in four on the road, forced into three at the end
DRILL = 'D4q. Eb4e D4q C4q | Bb3h. rq |'
# (its E-flat against the dance's held D in the next-to-last bar is the one
# semitone lint lists: the Empire's grind, intended)
DRILL_34 = 'D3q Eb3q D3q | C3q Bb2h |'

A0, A2, B0, C0, D0 = 5, 13, 21, 29, 37     # section starts (4/4 bars)


def tb(k):
    """Score bar (fractional, in 4/4 units) of the k-th bar (0-based) of the
    3/4 dance."""
    return D0 + 3 * k / 4


def play34(part, k0, text, prefix=''):
    """Play 3/4 bars (text split at '|') from dance bar k0, one bar at a time,
    checking that each bar holds exactly three beats."""
    bars = [b for b in text.replace('\n', ' ').split('|') if b.strip()]
    for i, t in enumerate(bars):
        part.at(tb(k0 + i))
        start = part.cursor
        part.play(prefix + ' ' + t.strip())
        if abs(part.cursor - start - 3) > 1e-6:
            raise ValueError(f'{part.name}: 3/4 bar {k0 + i} holds {part.cursor - start} beats')


# drum grids (16 steps per 4/4 bar, 12 per 3/4 bar)
ROAD = {'kick': 'x.......x.x.....', 'rim': '....x.......x...', 'hat': 'x.x.x.x.x.x.x.x.'}
ROAD_FILL = {'kick': 'x.......x.......', 'rim': '....x.......', 'tom_lo': '..........xx.xx.'}
STRIDE = {'kick': 'x.....x.x.....x.', 'snare': '....x.......x...', 'hat': 'x.xxx.xxx.xxx.xx'}
STRIDE_FILL = {'kick': 'x.....x.x.......', 'snare': '....x.......xxXX', 'tom_hi': '........xx......'}
DESCEND = {'kick': 'x...............', 'hat': 'x.x.x.x.x.x.x.x.'}
# the dance: a mazurka stamp. Kick alone on the downbeat (with the low
# strings), the stamp on beat 2, a ghost pickup on the "and" of 3
DANCE_BEAT = {'kick': 'x...........', 'snare': '....X.....o.', 'hat': '..x.x.x.x.x.', 'tamb': '....x.......'}
DANCE_FILL = {'kick': 'x...........', 'snare': '....X...x.xx', 'tom_lo': '..........x.'}
# the Empire's side drum: the drill's own rhythm
SIDE_DRUM = {'sn': 'x.....x.x...x...'}


def build():
    s = Score('battle_act2_3', tonic='G', bpm=138, intro_bars=4, loop_bars=44,
              title='Old Kingdom Roads', seed=173)
    s.reverb = dict(rt60=2.2, predelay_ms=26, wet_db=-1.0)
    s.master = dict(lufs=-14.0, glue_ratio=1.5)
    b = Battle(s, calm_lufs=-17.0, full_lufs=-14.0)
    b.section('intro', 1, chart('Gm:4 Gm:4 Gm:4 Dm:4'))
    b.section('A', A0, chart(CH_A)).section('A2', A2, chart(CH_A)).section('B', B0, chart(CH_B))
    b.section('C', C0, chart(CH_C)).section('D', D0, chart(CH_D))
    # A2 is the A strain a fourth up
    ch_a2 = chart('Cm:4 Eb:4 Fm:4 Bb:4 Cm:4 Ab:4 Fm:4 Gm:4')
    b.sections['A2'] = (A2, ch_a2)

    # ================================================================ the tune
    cl = b.part('cl_mel', 'clarinet', role='lead', layer='full', gain=2)
    va = b.part('va_mel', 'violas', role='lead2', layer='full', art='sus')
    cl.at(3).play('@mp ' + SIGNAL + ' | rw |')          # the signal, far off
    cl.at(A0).play('@f ' + TUNE)
    va.at(A0).play('@f ' + TUNE)
    vn = b.part('vn_mel', 'violins', role='lead', layer='full', art='sus')
    vn.at(A2).play('@f ' + TUNE, transpose=5)
    ob = b.part('ob_mel', 'oboe', role='lead2', layer='full')
    ob.at(A2).play('@f ' + TUNE, transpose=5)
    hn = b.part('hn_mel', 'horns', role='lead', layer='full')
    hn.at(B0).play('@f ' + UPROAD, transpose=-12)
    vn.at(B0).play('@f ' + UPROAD)
    vn.at(C0).play('@f ' + DESCENT)
    vn2 = b.part('vn2_mel', 'violins2', role='lead2', layer='full', art='sus')
    vn2.at(C0).play('@f ' + DESCENT, transpose=-12)
    hn2 = b.part('hn_sig', 'horns', role='counter', layer='full', pan=-0.4)
    hn2.at(C0).play('@mf ' + DESCENT_HN)
    # the dance: violins and horns, flute and clarinet on top of it
    play34(vn, 0, DANCE_HI, '@ff')
    play34(vn, 8, DANCE_LO, '@f')
    play34(vn2, 0, DANCE_HI, '@f <-12')
    play34(vn2, 8, DANCE_LO, '@f')
    play34(hn, 0, DANCE_HI, '@f <-24')
    play34(hn, 8, DANCE_LO, '@f <-12')
    fl = b.part('fl_dance', 'flute', role='lead2', layer='full', gain=-2)
    play34(fl, 0, DANCE_HI, '@f')
    play34(fl, 8, DANCE_LO, '@f <12')

    # calm: one solo voice at a time. The battle opens calm, straight after the
    # Act II map's shop (a G-minor clarinet with snaps): the opening strain is
    # a fiddle's, and the clarinet waits for the dance
    csv = b.part('lead_solo_violin', 'solo_violin', role='lead', layer='calm', gain=3)
    csv.at(A0).play('@mf ' + TUNE)
    ccl = b.part('lead_clarinet', 'clarinet', role='lead', layer='calm', gain=3)
    play34(ccl, 0, DANCE_HI, '@mf <-12')
    play34(ccl, 8, DANCE_LO, '@mf')
    cob = b.part('lead_oboe', 'oboe', role='lead', layer='calm', gain=3)
    cob.at(A2).play('@mf ' + TUNE, transpose=5)
    cfl = b.part('lead_flute', 'flute', role='lead', layer='calm', gain=3)
    cfl.at(B0).play('@mf ' + UPROAD)
    csv.at(C0).play('@mf ' + DESCENT)

    # ================================================================ the drill
    dr = b.part('drill', 'horns', role='counter', art='mute', calm_db=-4, pan=0.35)
    dr.at(1).play('@mf ' + DRILL + ' rw | rw |')
    for bar in (A0, A0 + 4):
        dr.at(bar).play('@mf ' + DRILL)
    play34(dr, 14, DRILL_34, '@f')
    lowdr = b.part('drill_low', 'trombones', role='counter', layer='full')
    play34(lowdr, 14, DRILL_34, '@f')
    side = b.part('side', 'orch_perc', role='accent', calm_db=-6, pan=0.4)
    for bar in (1, 2, A0, A0 + 1, A0 + 4, A0 + 5):
        drums(side, bar, SIDE_DRUM, vel=0.5)

    # ================================================================ strings
    vc = b.part('vc', 'celli', role='ostinato', layer='full', art='spic')
    cb = b.part('cb', 'basses', role='low', layer='full')
    for sec in ('A', 'A2', 'B'):
        bar, ch = b.sections[sec]
        ostinato(vc, bar, ch, 'e e e e e e e e', 'b b b b b b b b', lo=38, hi=55, vel=0.62,
                 accents='> - - > - - > -' if sec != 'A' else '> - - - > - - -')
        bass(cb, bar, ch, 'q q q q', 'r r r r', floor=26, vel=0.64, art='spic')
    cb.at(C0).play('%sus @f ' + DESCENT_BASS)
    vcd = b.part('vc_desc', 'celli', role='section', layer='full', art='sus')
    vcd.at(C0).play('@f ' + DESCENT_BASS.rsplit('|', 2)[0] + '|', transpose=12)
    vcd.at(C0 + 7).play('@f ' + LAUNCH)
    ostinato(vc, 1, chart('Gm:4 Gm:4 Gm:4 Dm:4'), 'e e e e e e e e', 'b - b - b - b b',
             lo=38, hi=55, vel=0.56)
    # the dance: a mazurka stamp. The low strings take the downbeat alone;
    # beat 2 is the stamp, a short chord in the violas (and trombones, below);
    # beat 3 is left empty
    bass(cb, D0, b.chart('D'), 'q h', 'r -', floor=26, vel=0.66, art='spic')
    bass(vc, D0, b.chart('D'), 'q q q', 'r - -', floor=38, vel=0.66, art='spic')
    vst = b.part('va_stamp', 'violas', role='ostinato', layer='full', art='spic')
    for deg in ('0', '1'):
        ostinato(vst, D0, b.chart('D'), 'q q q', f'- {deg} -', lo=53, hi=67, vel=0.6,
                 accents='- > -')
    pads = b.part('pad_vn2', 'violins2', role='pad', layer='full', art='soft')
    pad(pads, A0, b.chart('A'), n=2, lo=62, hi=74, vel=0.45, art='soft')
    b.pads('A2', 'violas', n=2, lo=53, hi=67, art='sus', layer='full')
    b.spic16('B', 'violins2', pattern='0 1 2 1', lo=62, hi=81, vel=0.5, layer='full')
    b.pads('C', 'violas', n=3, lo=53, hi=69, art='sus', layer='full')

    # ================================================================ brass & winds
    b.brass_pad('A2', 'horns', n=3, lo=50, hi=65, vel=0.5, name='hn_pad')
    b.brass_pad('B', 'trombones', n=2, lo=43, hi=57, vel=0.45, name='tbn')
    tb_ = b.part('tbn', 'trombones')
    tb_.at(C0).play('@f ' + DESCENT_BASS.rsplit('|', 2)[0] + '|', transpose=12)
    tb_.at(C0 + 7).play('%stac @f ' + LAUNCH)
    tuba = b.part('tuba', 'tuba', role='low', layer='full')
    tuba.at(C0).play('@f ' + DESCENT_BASS)
    # the dance: no tuba oom, and no held brass chord re-struck on each
    # downbeat; the trombones join the violas' stamp on beat 2 instead
    tst = b.part('tbn_stamp', 'trombones', role='accent', layer='full', art='stac')
    for deg in ('0', '1', '2'):
        ostinato(tst, D0, b.chart('D'), 'q q q', f'- {deg} -', lo=50, hi=62, vel=0.6,
                 accents='- > -')

    # ================================================================ rhythm section
    k = Kit(s, 'kit', gains={'cym': -3.0})
    b.kit = k
    b.full_only.update(k.names())
    k.play(3, {'kick': 'x.......x.......'}, vel=0.6)
    k.play(4, {'kick': 'x.......x.x.....', 'tom_lo': '........x.x.xxxx'}, vel=0.66, ramp=0.4)
    b.groove('A', ROAD, ROAD_FILL, every=4)
    b.groove('A2', STRIDE, STRIDE_FILL, every=4)
    b.groove('B', STRIDE, STRIDE_FILL, every=4, vel=0.74)
    # the descent: the kit thins to a kick on one and a hat that fades
    for i in range(6):
        k.play(C0 + i, DESCEND, vel=0.7 - 0.06 * i)
    k.play(C0 + 6, {'kick': 'x.......x.......', 'snare': '........x.x.xxxx'}, vel=0.62, ramp=0.5)
    k.play(C0 + 7, {'kick': 'x...x...x...x...', 'snare': 'x.x.x.x.xxxxXXXX', 'tom_lo': 'x.x.x.x.........'},
           vel=0.76, ramp=0.6)
    for i in range(16):
        k.play(tb(i), DANCE_FILL if i % 8 == 7 else DANCE_BEAT, vel=0.76, step=0.25)
    k.play(tb(0), {'crash': 'X'}, step=0.25)
    k.play(tb(8), {'crash': 'x'}, step=0.25)

    eb = b.part('ebass', 'rbass', layer='full', role='bass', duck='kit_kick')
    for sec in ('A', 'A2', 'B'):
        bar, ch = b.sections[sec]
        bass(eb, bar, ch, 'e e e e e e e e', 'r r 8 r r r 8 r', floor=31, vel=0.74,
             accents='> - - > - - > -')
    eb.at(C0).play('@f ' + DESCENT_BASS)
    # the dance: the root with the kick, held through the stamp, and a pickup
    # fifth on the "and" of 3 (with the ghost snare) into the next downbeat
    bass(eb, D0, b.chart('D'), 'h e e', 'r - 5', floor=31, vel=0.74)
    for sec in ('A', 'A2', 'B', 'D'):
        b.sub(sec)

    tp = b.part('timp', 'timpani', role='timp', calm_db=-8)
    tp.at(1).play('@mf G2q rq rh | rw | G2q rq rh | %roll @p D2w |')
    tp.expr((4, 0.4), (4.95, 1.0), (5, 1.0))
    tp.at(A0).play('%default @f G2q rq rh |')
    tp.at(A2).play('@f C3q rq rh |')
    tp.at(B0).play('@f D2q rq rh | rw | rw | rw | A2q rq rh |')
    tp.at(C0).play('@f A2q rq rh | G2q rq rh | F2q rq rh | Eb2q rq rh | D2q rq rh | C2q rq rh |'
                   ' Bb2h Ab2h | %roll D2w |')
    # in the dance the timpani stamp on beat 2
    for k_ in (0, 4, 8, 12):
        tp.at(tb(k_)).play('%default @f rq G2q rq' if k_ != 8 else '%default @f rq Eb2q rq')
    for bar in (A0, A2, B0):
        b.hit(bar)
    b.hit(D0, pieces=('crash', 'bd'), vel=0.9)
    b.riser(C0 + 6, beats=8)

    # ================================================================ calm bed
    for sec in ('A', 'A2', 'B'):
        b.calm_bed(sec, piano='0 2 4 2', piano_lo=55, piano_hi=77)
    # the descent: the calm low strings walk the same line
    b.calm_bed('C', piano='0 2 4 2', piano_lo=55, piano_hi=77, low=False)
    s.parts['c_low'].at(C0).play('%soft @0.5 ' + DESCENT_BASS, transpose=12)
    s.parts['c_lowcb'].at(C0).play('%soft @0.5 ' + DESCENT_BASS)
    # the calm dance leans on beat 2 as well: the piano's second quarter is
    # the accented one, and the celli move to the fifth there
    cpno = s.parts['c_pno']
    ostinato(cpno, D0, b.chart('D'), 'q q q', '0 2 4', lo=55, hi=77, vel=0.42,
             accents='- > -')
    clow = s.parts['c_low']
    bass(clow, D0, b.chart('D'), 'q h', 'r 5', floor=38, vel=0.5, art='soft')
    clcb = s.parts['c_lowcb']
    bass(clcb, D0, b.chart('D'), 'h.', 'r', floor=26, vel=0.5, art='soft')
    cpad = s.parts['c_pad']
    pad(cpad, D0, b.chart('D'), n=2, lo=53, hi=69, vel=0.45, art='soft')
    for i in range(16):
        b.calm_kit.play(tb(i), {'kick': 'x...........'}, vel=0.42, step=0.25)
    return b.finish()
