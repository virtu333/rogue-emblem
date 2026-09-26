"""Eclipsed battles — "Totality".

A battle on a node the Eclipse has taken: the light going out of a place
you were meant to reach. D minor, and it begins where the Eclipse cue left
off: a boom, the dry bell calling D and then A, and the answer that never
comes. The tune is that call with a voice behind it. Each bar is the call
(D held, A) or an attempt at answering it. The call climbs into the light;
the answers stay under it, in its shadow, the first one dropping a sixth
from the call's A (C B-flat A, and back up to C). Every attempt ends a
step away from the call's D and never on it: C from below (C B-flat A C;
D C B-flat C; B-flat C D C, which touches D and cannot stay) or E from
above (E F G E; F E D E, which passes through it). At the end of each
phrase the line turns away instead (C, G: the call upside down). Never
the tonic: the Thread's cadence stays where it is reserved. It drags: 6/8
at a dotted quarter of 72, slower than any other battle, a light going
out.

Two things drain across the loop.

  Breath. The phrase is stated in 6/8: five eighths of attacks, then a
  rest. It returns in 5/8 with the rest taken out: the same attacks, one
  eighth less air between them. The last four bars are 4/8: the longest
  note is shortened too, and the bell calls with no breath at all, twice,
  before the loop jumps and the breath is back.

  Colour. Each strain has less light than the one before, from the top
  down. S1 has strings, horns, choir, harp (its chords with added ninths),
  the high light (flute and glockenspiel on the call) and the hat in
  eighths. S2 loses the light; the hat gives way to the softer ride, the
  harp's ninths go, and B-flat and C lose their thirds. S3 loses the harp
  and the violins' lower octave; F and A lose their thirds; the ride keeps
  only the two beats and the choir sinks.
  S4 loses the horns and every cymbal (kick and cross-stick, the fills on
  the low tom), the choir sinks again, and every chord is an open fifth:
  the tune is the only third left. The loop point restores them all. The
  light returns only because the loop does.

Not the Entity's language: no hum, no drone, nothing taken from the
Thread; the bell is the Eclipse's own, from `stingers/eclipse.py`.

The meter changes are real bars (`Score.meter_change`): 6/8 from bar 1,
5/8 from bar 37, 4/8 from bar 65. Form (bars): intro 1-4 | S1 5-20 | S2
21-36 | S3 37-52 | S4 53-68 (65-68 in 4/8). Loop 5-68, 108 bpm (dotted
quarter 72).

calm: one voice on the tune (flute, oboe, clarinet, then the solo violin
alone) over piano, soft low strings and the bell; the bed thins with the
strains too.
"""

from engine.patterns import Kit, arp, bass, chart, ostinato, pad
from engine.score import Score

from scores._battle import Battle

KEY = 'music_battle_eclipsed'

# eighths per bar, strain by strain
S1 = [6] * 16
S2 = [6] * 16
S3 = [5] * 16
S4 = [5] * 12 + [4] * 4

# ------------------------------------------------------------------ the tune
# sixteen bars of attacks, (pitch, eighths); every bar is five eighths of
# attacks, the sixth eighth is the breath that 6/8 keeps and 5/8 removes
# The answers live under the call, in its shadow, and each one ends a step
# away from the call's D, never on it: C (from below) or E (from above).
P = [
    [('D5', 3), ('A5', 2)], [('C5', 1), ('Bb4', 1), ('A4', 1), ('C5', 2)],
    [('D5', 3), ('A5', 2)], [('D5', 1), ('C5', 1), ('Bb4', 1), ('C5', 2)],
    [('F5', 3), ('D5', 2)], [('E5', 1), ('F5', 1), ('G5', 1), ('E5', 2)],
    [('D5', 3), ('A5', 2)], [('C5', 3), ('G4', 2)],
    [('D5', 3), ('A5', 2)], [('F5', 1), ('E5', 1), ('D5', 1), ('E5', 2)],
    [('D5', 3), ('A5', 2)], [('Bb4', 1), ('C5', 1), ('D5', 1), ('C5', 2)],
    [('G5', 3), ('F5', 2)], [('E5', 1), ('D5', 1), ('C5', 1), ('E5', 2)],
    [('D5', 3), ('A5', 2)], [('C5', 3), ('G4', 2)],
]
CALL_BARS = (0, 2, 4, 6, 8, 10, 12, 14)   # the call itself (D, A) and its sisters


def phrase(bars, meters):
    """The attacks laid into bars of `meters` eighths. 6: the rest stays.
    5: the rest is removed. 4: the longest attack loses an eighth as well."""
    out = []
    for attacks, m in zip(bars, meters):
        atk = list(attacks)
        if m == 4:
            i = max(range(len(atk)), key=lambda k: atk[k][1])
            atk[i] = (atk[i][0], atk[i][1] - 1)
        toks = [f'{p}:{e * 0.5}' for p, e in atk]
        if m == 6:
            toks.append('r:0.5')
        out.append(' '.join(toks) + ' |')
    return ' '.join(out)


MEL_S1 = phrase(P, S1)
MEL_S2 = phrase(P, S2)
MEL_S3 = phrase(P, S3)
MEL_S4 = phrase(P, S4)


def ch(symbols, meters):
    return chart(' '.join(f'{sym}:{m * 0.5}' for sym, m in zip(symbols.split(), meters)))


CH_INTRO = chart('Dm:3 Dm:3 Dm:3 Dm:3')
# the answer that passes through D and rests on E (bar 9 of the strain) sits on
# A minor: the minor dominant, never a V with a leading tone
CH_S1 = ch('Dm Bb Dm F Bb C Dm C Dm Am Dm F Bb C Dm C', S1)
CH_S2 = ch('Dm Bb5 Dm F Bb5 C5 Dm C5 Dm Am Dm F Bb5 C5 Dm C5', S2)
CH_S3 = ch('Dm Bb5 Dm F5 Bb5 C5 Dm C5 Dm A5 Dm F5 Bb5 C5 Dm C5', S3)
CH_S4 = ch('D5 Bb5 D5 F5 Bb5 C5 D5 C5 D5 A5 D5 F5 D5 G5 D5 C5', S4)
CH_HARP1 = ch('Dmadd9 Bbadd9 Dmadd9 Fadd9 Bbadd9 Cadd9 Dmadd9 Cadd9 '
              'Dmadd9 Am7 Dmadd9 Fadd9 Bbadd9 Cadd9 Dmadd9 Cadd9', S1)

# kit grids per strain (sixteenth cells: 12 / 10 / 8 per 6/8, 5/8, 4/8 bar),
# beat and fill. The kit loses its light with the rest: the hat in eighths
# (S1), the softer ride in eighths (S2), the ride only on the two beats (S3),
# then no cymbal at all, a cross-stick for the snare and the fills on the low
# tom (S4).
KIT = {
    'S1': {6: ({'kick': 'x........x..', 'snare': '......x.....', 'hat': 'x.x.x.x.x.x.'},
               {'kick': 'x........x..', 'snare': '......x..xxX', 'hat': 'x.x.x.x.x...'})},
    'S2': {6: ({'kick': 'x........x..', 'snare': '......x.....', 'ride': 'x.x.x.x.x.x.'},
               {'kick': 'x........x..', 'snare': '......x..xxX', 'ride': 'x.x.x.x.x...'})},
    'S3': {5: ({'kick': 'x.......x.', 'snare': '......x...', 'ride': 'x.....x...'},
               {'kick': 'x.......x.', 'snare': '......xxxX', 'ride': 'x.........'})},
    'S4': {5: ({'kick': 'x.......x.', 'xstick': '......x...'},
               {'kick': 'x.......x.', 'xstick': '......x...', 'tom_lo': '.......xxX'}),
           4: ({'kick': 'x.....x.', 'xstick': '....x...'},
               {'kick': 'x.....x.', 'tom_lo': '....xxxX'})},
}
KIT_VEL = {'S1': 0.72, 'S2': 0.70, 'S3': 0.66, 'S4': 0.62}


def build():
    s = Score('battle_eclipsed', tonic='D', bpm=108, meter=(6, 8), intro_bars=4, loop_bars=64,
              title='Totality', seed=211)
    s.meter_change(37, (5, 8))
    s.meter_change(65, (4, 8))
    s.reverb = dict(rt60=3.2, predelay_ms=30, wet_db=0.0, damp=0.5)
    s.master = dict(lufs=-14.0, glue_ratio=1.5)
    b = Battle(s, calm_lufs=-17.0, full_lufs=-14.0)
    b.section('intro', 1, CH_INTRO).section('S1', 5, CH_S1).section('S2', 21, CH_S2)
    b.section('S3', 37, CH_S3).section('S4', 53, CH_S4)
    strains = (('S1', 5, S1), ('S2', 21, S2), ('S3', 37, S3), ('S4', 53, S4))

    # ---------------------------------------------------------------- the bell
    # the Eclipse cue's bell: it calls at the head of every phrase, and at the
    # end with no breath left
    bells = b.part('bells', 'bells', role='accent', calm_db=-3, gain=3.0)
    bells.at(1).play('@mf D4q. A4q')
    for n in (5, 13, 21, 29, 37, 45, 53, 61):
        bells.at(n).play('@mp D4q. A4q')
    bells.at(65).play('@mf D4q A4q')
    bells.at(67).play('@mf D4q A4q')
    boom = b.part('boom', 'boom', role='accent', calm_db=-6)
    boom.at(1).play('@mf D2q')
    boom.at(53).play('@mp D2q')

    # ---------------------------------------------------------------- strings
    b.lead('S1', MEL_S1, inst='violins', dyn='f', layer='full', art='sus')
    b.lead('S1', MEL_S1, inst='violins2', name='vn2_tune', transpose=-12, dyn='mf',
           role='lead2', layer='full', art='sus')
    b.lead('S2', MEL_S2, inst='violins', dyn='f', layer='full', art='sus')
    b.lead('S2', MEL_S2, inst='violins2', name='vn2_tune', transpose=-12, dyn='mf',
           role='lead2', layer='full', art='sus')
    b.lead('S3', MEL_S3, inst='violins', dyn='f', layer='full', art='sus')
    b.lead('S4', MEL_S4, inst='violins', dyn='f', layer='full', art='sus')

    va = b.part('ost_va', 'violas', role='ostinato', art='spic', calm_db=-5)
    for sec in ('S1', 'S2', 'S3', 'S4'):
        ostinato(va, b.bar(sec), b.chart(sec), 'e e e e e e', '0 1 2 1 2 1', lo=50, hi=67,
                 vel=0.58 if sec != 'S4' else 0.48, accents='> - - > - -')
    ostinato(va, 3, CH_INTRO[2:], 'e e e e e e', '0 1 2 1 2 1', lo=50, hi=67, vel=0.5)
    vn2o = b.part('ost_vn2', 'violins2', role='ostinato', art='spic', layer='full')
    for sec in ('S2', 'S3'):
        ostinato(vn2o, b.bar(sec), b.chart(sec), 'e e e e e e', '2 1 0 1 0 1', lo=62, hi=79,
                 vel=0.52)

    # the celli sustain is a low part, not a section: it must not crowd the kick
    vc = b.part('vc', 'celli', role='low', art='sus', calm_db=-4)
    vc.at(1).play('%trem @p [D3 A3]:3 | [D3 A3]:3 |')
    vc.expr((1, 0.3), (2.9, 0.9))
    for sec in ('S1', 'S2', 'S3'):
        bass(vc, b.bar(sec), b.chart(sec), 'q. q.', 'r 5', floor=43, vel=0.52, art='sus')
    bass(vc, b.bar('S4'), b.chart('S4'), 'q. q.', 'r r', floor=43, vel=0.5, art='sus')
    cb = b.part('cb', 'basses', role='low', calm_db=-2)
    cb.at(1).play('%sus @p D2:3 | D2:3 |')
    cb.expr((1, 0.4), (2.9, 0.9))
    bass(cb, 3, CH_INTRO[2:], 'q. q.', 'r r', floor=26, vel=0.6, art='spic')
    for sec in ('S1', 'S2', 'S3', 'S4'):
        bass(cb, b.bar(sec), b.chart(sec), 'q. q.', 'r r', floor=26, vel=0.64, art='spic')

    # ---------------------------------------------------------------- colours
    # horns: S1-S3 (gone at S4)
    b.brass_pad('S1', 'horns', n=3, lo=50, hi=65, vel=0.5)
    b.brass_pad('S2', 'horns', n=3, lo=50, hi=65, vel=0.52)
    b.lead('S3', MEL_S3, inst='horns', transpose=-12, dyn='f', layer='full')
    # choir: S1-S4 (the last colour beside the strings), but it fades and
    # sinks as the light goes: softer each strain, its top voice lower, and
    # in S4 only two voices on the open fifths
    # (kept under the answers, which sink to A4)
    for sec, n, lo, hi, vel in (('S1', 3, 50, 66, 0.5), ('S2', 3, 50, 66, 0.46),
                                ('S3', 3, 48, 63, 0.42), ('S4', 2, 48, 60, 0.37)):
        b.choir(sec, 'oohs', n=n, lo=lo, hi=hi, vel=vel)
    # harp: S1-S2 (gone at S3)
    hp = b.part('harp', 'harp', role='keys', layer='full')
    arp(hp, b.bar('S1'), CH_HARP1, '0 2 4 5 4 2', step=0.5, lo=55, hi=86, vel=0.5,
        accent_every=1.5, accent=0.08)
    arp(hp, b.bar('S2'), b.chart('S2'), '0 2 4 2 4 2', step=0.5, lo=55, hi=86, vel=0.48,
        accent_every=1.5, accent=0.08)
    # the high light: flute and glockenspiel on the call bars (S1 only)
    fl = b.part('light_fl', 'flute', role='lead2', layer='full', gain=2.0)
    gl = b.part('light_gl', 'glock', role='accent', layer='full', gain=2.0)
    for i in CALL_BARS:
        text = ' '.join(f'{p}:{e * 0.5}' for p, e in P[i])
        fl.at(5 + i).play('@mf ' + text)
        gl.at(5 + i).play('@mf ' + text, transpose=12)

    # ---------------------------------------------------------------- rhythm
    kit = Kit(s, 'kit', gains={'kick': 0.5, 'snare': 2.0})
    b.full_only.update(kit.names())
    kit.play(4, {'snare': '......xxxxxX', 'kick': 'x...........'}, vel=0.7, step=0.25)
    for sec, start, meters in strains:
        for k, m in enumerate(meters):
            beat, fill = KIT[sec][m]
            kit.play(start + k, fill if k % 4 == 3 else beat, vel=KIT_VEL[sec], step=0.25)
        if sec in ('S1', 'S2'):
            kit.play(start, {'crash': 'X'}, step=0.25)
    for sec in ('S1', 'S2', 'S3', 'S4'):
        b.rbass(sec, rhythm='q. q.', notes='r r', accents='> -')
        b.sub(sec)

    timp = b.part('timp', 'timpani', role='timp', calm_db=-8)
    timp.at(1).play('@mf D2q. rq')
    for n in (5, 13, 21, 29, 37, 45, 53, 61):
        timp.at(n).play('@f D2q. rq')
    timp.at(20).play('@mf D2e D2e D2e A2e A2e A2e |')
    timp.at(36).play('@mf D2e D2e D2e A2e A2e A2e |')
    timp.at(52).play('@mf D2e D2e D2e A2e A2e |')
    timp.at(65).play('@f D2q A2q | D2q A2q | D2e D2e A2e A2e | D2e D2e D2e D2e |')
    for n in (5, 21):
        b.hit(n)
    b.hit(37, pieces=('bd',), vel=0.75)
    b.hit(53, pieces=('bd',), vel=0.7)

    # ---------------------------------------------------------------- calm
    b.lead('S1', MEL_S1, inst='flute', name='c_flute', dyn='mf', layer='calm')
    b.lead('S2', MEL_S2, inst='oboe', dyn='mf', layer='calm')
    b.lead('S3', MEL_S3, inst='clarinet', dyn='mf', layer='calm')
    # the last voice alone, on its quiet samples: less light, not more
    b.lead('S4', MEL_S4, inst='solo_violin', dyn='mf', layer='calm', art='soft')
    pno = b.part('c_pno', 'grand', layer='calm', role='keys')
    for sec in ('S1', 'S2', 'S3', 'S4'):
        arp(pno, b.bar(sec), b.chart(sec), '0 2 4 2 4 2', step=0.5, lo=50, hi=79, vel=0.46,
            accent_every=1.5, accent=0.08)
    arp(pno, 3, CH_INTRO[2:], '0 2 4 2 4 2', step=0.5, lo=50, hi=74, vel=0.42)
    clow = b.part('c_low', 'celli', layer='calm', role='bass', art='soft')
    for sec in ('S1', 'S2', 'S3', 'S4'):
        bass(clow, b.bar(sec), b.chart(sec), 'q. q.', 'r 5', floor=38, vel=0.5, art='soft')
    cpad = b.part('c_pad', 'violas', layer='calm', role='pad', art='soft')
    for sec in ('S1', 'S2', 'S3'):
        pad(cpad, b.bar(sec), b.chart(sec), n=2, lo=53, hi=69, vel=0.45, art='soft')
    ck = Kit(s, 'ckit', gains={'kick': -4})
    b.calm_only.update(ck.names())
    for sec, start, meters in strains:
        for k, m in enumerate(meters):
            ck.play(start + k, {'kick': 'x' + '.' * (2 * m - 1)}, vel=0.42, step=0.25)
    return b.finish()
