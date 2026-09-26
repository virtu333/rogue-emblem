"""Act I battle IV — "The Oath at the Ford".

Edric's oath (the Old Kingdom horn call, the open-fourths figure the title,
home base and the victory fanfare already know) turned into a fighting march
in E. The horns carry it, in parallel fourths where it is still the call and
in unison where it becomes a tune; a snare drum and the low strings drive.

The ground does not move. Celli and basses hammer E in leaping octaves, the
tuba and bass guitar sit on it, and above that insistence the horizon keeps
changing colour: an open fifth, then A over E (the C-sharp, a major sixth
above the pedal: the sky brightening), D over E (the Old Kingdom's flat
seventh), C and A minor over E (the shadow of the flat sixth), and in the
trio F-sharp minor, B minor and at last E major itself, the first G-sharp,
when the pedal becomes the root of the chord it has been holding. None of
this is a modulation: the bass never agrees to leave E, except once.

  A     1-8    the oath: E. B B A B | E B, the call itself, horns in
                fourths over the pedal; then the same rise twice more, its
                landing re-pitched to the sky: E-C# over A/E, E-D over D/E.
                The call touches the upper E on every second downbeat; what
                moves is the landing after it, which climbs B, C#, D, and a
                run (A B C# D) carries it on to E: the phrase closes on the
                tonic by step from the flat seventh, never from a D-sharp
  A'    9-16   the same oath under a shadowed sky: the second landing is C
                natural over C/E and the run goes through it (Am/E). Above
                the call the violins trace the landings in long notes, B, C,
                D, E, each arriving with the horns' landing or ahead of it,
                so the line under the call is heard on its own
  B    17-24   the crossing: the only time the bass walks (E F# G A C D B),
                the violins climb in dotted figures while the horns hold the
                call in augmentation; it ends on B7
  trio 25-32   B7 resolves to E in the bass but A over it: the oath sworn a
                fourth higher (horns, violins an octave above, plucked violas
                for the colours), the whole strain in A major over the E
                pedal, until the last bar lets E be a chord (E major)
  A''  33-40   the trio's last bar lets E be a chord (E major) while the
                snare rolls in under the whole band; then the bright oath for
                the last time, violins an octave above, ending on D over E
                so the loop returns through the flat seventh, no leading tone

The call is planted in the intro on one muted horn, far off, before the
march has begun.

Bar numbers are loop bars (score bars minus the 4-bar intro).

Against the other Act I themes: horns lead (not violins or a trumpet), the
kit plays a rudimental march cadence with flams rather than a rock or
half-time beat, and the harmony is a pedal, not a progression. No choir, no
trumpets at all (Act I budget).

  calm  oboe / clarinet / solo violin / flute on the tune over the calm bed;
        pizzicato celli keep the E pedal ticking, the horns' call stays soft
  full  horns, violins, trombones and tuba, octave-leaping low strings, snare
        cadence and kit, bass guitar
"""

from engine.patterns import Kit, arp, bass, chart, drums, ostinato, pad
from engine.score import Score

from scores._battle import Battle

KEY = 'music_battle_act1_4'

# ------------------------------------------------------------------ material
# the oath (horns, sounding pitch). Edric's call exactly as the title and the
# victory fanfare know it (E. B B A B | E B), then the same rise twice more
# with its landing re-pitched to the sky: C-sharp (A over E, the major sixth
# above the pedal) and D (D over E, the Old Kingdom's flat seventh). The call
# itself strikes the upper E on bar 2's downbeat; the landings after it climb
# B, C#, D, and a run carries them on to E, so the phrase closes on the tonic
# by step from D natural, never by a leading tone.
OATH = """
E4q. B4e B4q A4e B4e | E5h B4h | E4q. B4e B4q A4e B4e | E5h C#5h |
E4q. B4e B4q A4e B4e | E5h D5h | A4q. B4e C#5q. D5e | E5w |
"""
# the same oath under a shadowed sky: the second landing is C natural (C over
# E), and the run to E goes through it
OATH_SH = """
E4q. B4e B4q A4e B4e | E5h B4h | E4q. B4e B4q A4e B4e | E5h C5h |
E4q. B4e B4q A4e B4e | E5h D5h | A4q. B4e C5q. D5e | E5w |
"""
# the second horn: parallel fourths under the call, the chord root under
# each landing
OATH_2 = """
B3q. F#4e F#4q E4e F#4e | B4h F#4h | B3q. F#4e F#4q E4e F#4e | B4h A4h |
B3q. F#4e F#4q E4e F#4e | B4h A4h | E4h A4h | B4w |
"""
# A': the violins' descant, the landings in long notes. B arrives with the
# first landing; C with the C/E bar (two beats ahead of the horns' C); D with
# the E5 bar before the horns reach it, held over the run; E with the run's E
DESCANT = 'rw | rh B5h~ | B5w | C6w | D6w~ | D6w | D6w | E6w |'
OATH_2_SH = """
B3q. F#4e F#4q E4e F#4e | B4h F#4h | B3q. F#4e F#4q E4e F#4e | G4w |
B3q. F#4e F#4q E4e F#4e | B4h A4h | E4h A4h | B4w |
"""
# the crossing: a dotted figure climbing with the bass
CROSSING = """
G5q. F#5e E5q B4q | A5q. G5e F#5q D5q | B5q. A5e G5q D5q | C6q. B5e A5q E5q |
E6q. D6e C6q G5q | F#6q. E6e D6q A5q | E6h D#6h | F#6q. E6e D#6q B5q |
"""
# the horns hold the call in augmentation under the crossing
CROSS_HN = 'E4h. B4q | B4h A4q B4q | E5w | A4w | C5h. G4q | A4h D5h | E5h D#5h | B4w |'
# the trio: the oath sworn a fourth higher, A major over the E pedal
TRIO = """
A4q. E5e E5q D5e E5e | A5h E5h | F#5q. E5e D5q A4q | C#5q. D5e E5h |
A5q. F#5e F#5q E5e F#5e | D6h A5h | B5q. A5e F#5q D5q | E5h rh |
"""
TRIO_HN = """
rh E4q. B4e | E4w | rh F#4q. A4e | A4w |
rh A4q. F#4e | F#4w | rh F#4q. D4e | E4w |
"""

CH_A = 'E5:4 E5:4 E5:4 A/E:4 E5:4 D/E:4 A/E:4 E5:4'
CH_A2 = 'E5:4 E5:4 E5:4 C/E:4 E5:4 D/E:4 Am/E:4 E5:4'
CH_A3 = 'E5:4 E5:4 E5:4 A/E:4 E5:4 D/E:4 A/E:4 D/E:4'
CH_B = 'Em:4 Bm/F#:4 Em/G:4 Am:4 C:4 D:4 Bsus4:2 B:2 B7:4'
CH_TRIO = 'A/E:4 A/E:4 D/E:4 A/E:4 F#m/E:4 D/E:4 Bm7/E:4 E:4'
CH_INTRO = 'E5:4 E5:4 A/E:4 D/E:4'

# the pedal: E in leaping octaves, sixteenths, accents on the beat
PEDAL = 'E2s> E3s E2s E3s ' * 4

# a rudimental march cadence (16 steps; f = flam)
CADENCE = {'kick': 'x.......x.......', 'snare': 'f..o.xo.X..o.xox', 'hat_pedal': '....x.......x...'}
CADENCE_2 = {'kick': 'x.......x.......', 'snare': 'f..o.xo.X.oxf.xX', 'hat_pedal': '....x.......x...'}
CROSS_BEAT = {'kick': 'x.....x.x.....x.', 'snare': '....f.......f...', 'ride': 'x.x.x.x.x.x.x.x.',
              'tom_lo': '..............xx'}
TRIO_BEAT = {'kick': 'x.......x.......', 'snare': '....o.......o..o', 'ride': 'x.x.x.x.x.x.x.x.'}
FULL_MARCH = {'kick': 'x.....x.x.......', 'snare': 'f..o.xo.X..o.xoX', 'hat': 'x.x.x.x.x.x.x.x.'}
ROLL_IN = {'kick': 'x...x...x...x...', 'snare': 'x.x.x.x.xxxxxxxx'}


def pedal(part, bar, n_bars, vel=0.62):
    for i in range(n_bars):
        part.at(bar + i).play(f'@{vel} ' + PEDAL)


def cadence(kit, bar, n, a=CADENCE, b=CADENCE_2, vel=0.72):
    for i in range(n):
        kit.play(bar + i, a if i % 2 == 0 else b, vel=vel)


def build():
    s = Score('battle_act1_4', tonic='E', bpm=116, intro_bars=4, loop_bars=40,
              title='The Oath at the Ford', seed=149)
    s.reverb = dict(rt60=2.3, predelay_ms=30, wet_db=-1.0)
    s.master = dict(lufs=-14.0, glue_ratio=1.5)
    b = Battle(s, calm_lufs=-17.0, full_lufs=-14.0)
    b.section('intro', 1, chart(CH_INTRO))
    b.section('A', 5, chart(CH_A)).section('A2', 13, chart(CH_A2)).section('B', 21, chart(CH_B))
    b.section('T', 29, chart(CH_TRIO)).section('A3', 37, chart(CH_A3))

    # ================================================================ the oath
    hn = b.part('hn_oath', 'horns', role='lead', layer='full', gain=1.0)
    hn2 = b.part('hn_oath2', 'horns', role='lead2', layer='full', pan=-0.4)
    for sec, dyn, tune, second in (('A', 'f', OATH, OATH_2), ('A2', 'f', OATH_SH, OATH_2_SH),
                                   ('A3', 'ff', OATH, OATH_2)):
        hn.at(b.bar(sec)).play(f'@{dyn} ' + tune)
        hn2.at(b.bar(sec)).play(f'@{dyn} ' + second)
    # the call planted before the march: one muted horn, far off, in the intro
    seed = b.part('hn_seed', 'horns', role='counter', art='mute', calm_db=-3, pan=-0.5)
    seed.at(3).play('@mp E4q. B4e B4q A4e B4e | E5h B4h |')
    hn.at(b.bar('B')).play('@f ' + CROSS_HN)
    # the trio: the horns keep the tune, the violins sing it an octave above
    hn.at(b.bar('T')).play('@f ' + TRIO, transpose=-12)
    vn = b.part('vn_mel', 'violins', role='lead', layer='full')
    # A': not the call again an octave up, but its landings, held above it
    vn.at(b.bar('A2')).play('@mf %sus ' + DESCANT)
    # the descant grows toward its E; the rest of the loop stays at full
    # (the lane is circular, so it is pinned at both ends of A')
    a2 = b.bar('A2')
    vn.expr((b.bar('A'), 1.0), (a2 + 1.4, 0.75), (a2 + 3, 0.85), (a2 + 4, 0.9), (a2 + 7, 1.0),
            (b.bar('A3') + 7.9, 1.0))
    vn.at(b.bar('B')).play('@f ' + CROSSING)
    vn.at(b.bar('T')).play('@f ' + TRIO)
    vn.at(b.bar('A3')).play('@ff ' + OATH, transpose=12)
    vn2 = b.part('vn2_mel', 'violins2', role='lead2', layer='full')
    vn2.at(b.bar('B')).play('@mf ' + CROSSING, transpose=-12)
    fl = b.part('fl_full', 'flute', role='lead2', layer='full')
    fl.at(b.bar('T')).play('@mf ' + TRIO)

    # calm: one solo voice at a time
    b.lead('A', OATH, inst='oboe', dyn='mf', layer='calm', transpose=12, gain=3)
    b.lead('A2', OATH_SH, inst='clarinet', dyn='mf', layer='calm', gain=3)
    b.lead('B', CROSSING, inst='solo_violin', dyn='mf', layer='calm', gain=3.5)
    b.lead('T', TRIO, inst='flute', dyn='mf', layer='calm', gain=4.5)
    b.lead('A3', OATH, inst='oboe', dyn='mf', layer='calm', transpose=12)
    hc = b.part('hn_calm', 'horns', role='counter', layer='calm', gain=-2)
    hc.at(b.bar('B')).play('@mp ' + CROSS_HN)
    hc.at(b.bar('T')).play('@mp ' + TRIO_HN)

    # ================================================================ the pedal
    vc = b.part('vc_ped', 'celli', role='ostinato', layer='full', art='spic', gain=-1.5,
                eq=[('highshelf', 2500, 0.7, -3.0)])
    cb = b.part('cb_ped', 'basses', role='low', layer='full', art='spic')
    pedal(vc, 2, 3, vel=0.6)
    for sec in ('A', 'A2', 'T', 'A3'):
        pedal(vc, b.bar(sec), 8)
    for bar in range(2, 5):
        cb.at(bar).play('@0.64 ' + 'E1e E1e E1e E1e E1e E1e E1e E1e')
    for sec in ('A', 'A2', 'T', 'A3'):
        for i in range(8):
            cb.at(b.bar(sec) + i).play('@0.66 E1e> E1e E1e E1e E1e> E1e E1e E1e')
    # the crossing: the low strings walk with the bass line
    for p_, lo in ((vc, 40), (cb, 28)):
        ostinato(p_, b.bar('B'), b.chart('B'), 'e e e e e e e e', 'b b b b b b b b', lo=lo,
                 hi=lo + 16, vel=0.64, accents='> - - > - - > -')
    va = b.part('va', 'violas', role='ostinato', layer='full', art='spic')
    for sec in ('A2', 'B', 'A3'):
        ostinato(va, b.bar(sec), b.chart(sec), 'e e e e e e e e', '0 1 2 1 0 1 2 1', lo=52, hi=67,
                 vel=0.56, accents='> - - - > - - -')
    # the trio's colours, plucked, so nothing sustained sits on the tune
    ostinato(va, b.bar('T'), b.chart('T'), 'e e e e e e e e', '0 1 2 3 2 1 2 1', lo=55, hi=76,
             vel=0.5, art='pizz', accents='> - - - > - - -')

    # the horizon: high strings (and winds) hold each colour over the pedal
    hz = b.part('horizon', 'violins2', role='pad', layer='full', art='trem')
    pad(hz, 3, chart('A/E:4 D/E:4'), n=3, lo=69, hi=86, vel=0.5, art='trem')
    for sec in ('A', 'A2', 'A3'):
        pad(hz, b.bar(sec), b.chart(sec), n=3, lo=69, hi=86, vel=0.5, art='trem')
    hz.expr((3, 0.4), (4.9, 1.0), (5, 0.8), (12.9, 0.8), (13, 0.9), (20.9, 0.9), (37, 1.0))
    ww = b.part('ww_horizon', 'clarinet', role='pad', layer='full', gain=-2)
    for sec in ('A2', 'A3'):
        pad(ww, b.bar(sec), b.chart(sec), n=2, lo=62, hi=76, vel=0.5)
    b.pads('B', 'violas', n=3, lo=55, hi=70, art='sus', layer='full', name='b_va')

    # ================================================================ low brass
    tbn = b.part('tbn', 'trombones', role='pad', layer='full')
    for sec in ('A2', 'B', 'A3'):
        # voiced above the pedal's E3: no low seconds against it
        pad(tbn, b.bar(sec), b.chart(sec), n=3, lo=55, hi=67, vel=0.52 if sec != 'A3' else 0.6)
    tuba = b.part('tuba', 'tuba', role='low', layer='full')
    for sec in ('A', 'A2', 'T', 'A3'):
        tuba.at(b.bar(sec)).play('@mf ' + 'E1w | ' * 8)
    bass(tuba, b.bar('B'), b.chart('B'), 'h h', 'b 5', floor=28, vel=0.6)

    # ================================================================ drums
    k = Kit(s, 'kit', gains={'cym': -3.0})
    b.kit = k
    b.full_only.update(k.names())
    k.play(1, {'snare': 'f..o.xo.X..o.xox'}, vel=0.56, ramp=0.25)
    k.play(2, {'snare': 'f..o.xo.X.oxf.xX', 'kick': 'x.......x.......'}, vel=0.62, ramp=0.2)
    k.play(3, CADENCE, vel=0.68)
    k.play(4, ROLL_IN, vel=0.72, ramp=0.5)
    cadence(k, b.bar('A'), 7)
    k.play(b.bar('A') + 7, CADENCE_2, vel=0.76)
    cadence(k, b.bar('A2'), 7, a=FULL_MARCH, b=CADENCE_2)
    k.play(b.bar('A2') + 7, ROLL_IN, vel=0.74, ramp=0.4)
    for i in range(8):
        k.play(b.bar('B') + i, CROSS_BEAT if i < 7 else ROLL_IN, vel=0.74)
    for i in range(8):
        k.play(b.bar('T') + i, TRIO_BEAT if i < 7 else ROLL_IN, vel=0.66 if i < 7 else 0.78,
               ramp=0.0 if i < 7 else 0.5)
    cadence(k, b.bar('A3'), 7, a=FULL_MARCH, b=CADENCE_2, vel=0.78)
    k.play(b.bar('A3') + 7, ROLL_IN, vel=0.8, ramp=0.5)
    for bar in (5, 13, 21, 29, 37):
        k.play(bar, {'crash': 'X'})

    # concert bass drum and clash cymbals: the band's downbeats
    perc = b.part('perc', 'orch_perc', role='accent', calm_db=-10)
    for bar in range(5, 45):
        if 21 <= bar < 29:
            continue
        drums(perc, bar, {'bd': 'x...x...x...x...'}, vel=0.5)
    for bar in (5, 13, 29, 37):
        drums(perc, bar, {'crash': 'x', 'bd': 'X'}, vel=0.8)

    # the bass guitar is kept dark: the pedal's upper partials (G-sharp) must
    # not fight the colours above it
    eb = b.part('ebass', 'rbass', layer='full', role='bass', duck='kit_kick', gain=-2,
                eq=[('lowpass', 900, 0.7, 0)])
    for sec in ('A', 'A2', 'T', 'A3'):
        for i in range(8):
            eb.at(b.bar(sec) + i).play('@f E1e E2e E1e E1e E1e E2e E1e E1e')
    bass(eb, b.bar('B'), b.chart('B'), 'e e e e e e e e', 'b b 8 b b b 8 b', floor=28, vel=0.74)
    sub = b.part('sub', 'sub', layer='full', role='sub')
    for sec in ('A', 'A2', 'T', 'A3'):
        sub.at(b.bar(sec)).play('@0.6 ' + 'E1w | ' * 8)
    b.sub('B')

    tp = b.part('timp', 'timpani', role='timp', calm_db=-8)
    tp.at(2).play('@mf E2q rq B2q rq | %roll @p E2w | %default @f B2q B2q B2e B2e B2q |')
    tp.expr((3, 0.4), (3.95, 1.0), (4, 1.0))
    for sec in ('A', 'A2', 'A3'):
        tp.at(b.bar(sec)).play('%default @f E2q rq rh | rw | rw | rw | E2q rq rh | rw | rw | '
                               'B2q B2q B2q B2q |')
    tp.at(b.bar('B')).play('%default @f E2q rq rh | F#2q rq rh | G2q rq rh | A2q rq rh | C3q rq rh |'
                           ' D3q rq rh | B2q rq B2q rq | %roll B2w |')
    tp.at(b.bar('T')).play('%default @f E2q rq rh |')
    b.riser(b.bar('B') + 6, beats=8)

    # ================================================================ calm bed
    cp = b.part('c_pno', 'grand', role='keys', layer='calm')
    cl = b.part('c_low', 'celli', role='bass', layer='calm', art='pizz', gain=-3)
    cw = b.part('c_lowcb', 'basses', role='low', layer='calm', art='soft')
    cpad = b.part('c_pad', 'violas', role='pad', layer='calm', art='soft')
    ckit = Kit(s, 'ckit', gains={'kick': -4})
    b.calm_only.update(ckit.names())
    for bar in range(1, 5):
        cl.at(bar).play('@0.46 %pizz E2q E3q E2q E3q')
        cw.at(bar).play('@0.42 %soft E1w')
    for sec in ('A', 'A2', 'B', 'T', 'A3'):
        bar, ch = b.sections[sec]
        arp(cp, bar, ch, '0 2 4 2', step=1.0, lo=57, hi=79, vel=0.46, accent_every=2, accent=0.08)
        pad(cpad, bar, ch, n=2, lo=55, hi=69, vel=0.45, art='soft')
        if sec == 'B':
            bass(cl, bar, ch, 'q q q q', 'b b b b', floor=40, vel=0.5, art='pizz')
            bass(cw, bar, ch, 'w', 'b', floor=28, vel=0.5, art='soft')
        else:
            for i in range(8):
                cl.at(bar + i).play('@0.5 %pizz E2q E3q E2q E3q')
                cw.at(bar + i).play('@0.5 %soft E1w')
        for i in range(8):
            ckit.play(bar + i, {'kick': 'x.......x.......'}, vel=0.42)
    return b.finish()
