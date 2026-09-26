"""Castle battles — "Stone That Remembers".

Old Kingdom halls with the Empire in them, taken room by room. The music is
a ground, like a passacaglia: C minor, A-flat, B-flat, C minor (i-bVI-bVII-i),
round and round in the organ pedal and the low brass. It never needs a
dominant; the stone just goes on. Over it a stately tune: a falling fourth
(C-G) and a sigh from A-flat to G. Pizzicato strings play a small figure and
the violas echo it a dotted eighth later from the other side of the hall; the
reverb is the hall itself.

Once in each loop the ground breaks. The bass takes the tune's sigh (A-flat
to G) and lands on G major, the only G chord in the piece; the violins hold
the G... and underneath it the chord turns to D-flat major with a major
seventh, so the same G is now a bright raised fourth. There, and only there,
the horns remember Edric's oath (the Old Kingdom call), a half step down and
bent onto the held G: the stone remembers who built it. D-flat then slips a
semitone down into C minor and the ground resumes without ever having had a
dominant.

  V1  the tune on horns                    V2  the tune on violins, full
  B   the tune's arpeggio climbing (Fm Ab Bb Eb)
  M   the moment: Cm Ab | G | Dbmaj7(#11) and the oath | Db -> C
  V3  the whole hall                       V4  a corridor: horn alone, building

No choir (castles are heard from Act II). Leitmotif: the Old Kingdom oath,
once per loop, at the moment.
"""

from engine.patterns import Kit, arp, bass, chart, drums, ostinato, pad
from engine.score import Score

from scores._battle import Battle

KEY = 'music_battle_castle'

# ------------------------------------------------------------------ material
# the head falls a fourth; the answer is the sigh, turned like a carved moulding
# (a dotted note, a quick upper neighbour, the step down held): four times
THEME_1 = 'C5h. G4q | Ab4q. Bb4s Ab4s G4q Eb4q | Bb4h. F4q | G4q. Ab4s G4s Eb4h |'
THEME_2 = 'C5h. Eb5q | Eb5q. F5s Eb5s C5h | D5h. F5q | Eb5q. D5s C5s G4h |'
THEME = THEME_1 + ' ' + THEME_2
# B: the tune's arpeggio climbing through the circle, then settling
MEL_B = """
C5h. Ab4q | Eb5q. F5s Eb5s C5h | F5h. D5q | G5q. Ab5s G5s Eb5h |
Ab5h. F5q | Eb5q. F5s Eb5s C5h | D5h F5h | D5w |
"""
# the moment: the sigh lands on G and the G is held while the world turns under it
MOMENT_VN = """
C6h. G5q | Ab5q. Bb5s Ab5s G5h~ | G5w~ | G5w~ |
G5w~ | G5h Ab5h | C6w | Db6h C6h |
"""
# Edric's oath (the Old Kingdom call) a half step down, in D-flat, bent onto the held G
OATH = 'Db4q. Ab4e Ab4q G4e Ab4e | Db5h Ab4h |'
OATH2 = 'Db4q. Ab4e Ab4q G4e Ab4e | Db5h. rq |'

# lint: every remaining "clash" is intended. The tune's G passes over A-flat for one
# beat (Abmaj7 colour); in the moment the sigh's G is held two beats over A-flat
# before the bass follows it; D-flat carries its major 7th (C) and raised 4th (G),
# always voiced a major 7th above the note they rub against, never a semitone below.
GROUND = 'Cm Ab Bb Cm'
CH_V = chart(f'{GROUND} {GROUND}')
CH_B = chart('Fm Ab Bb Eb Fm Ab Bb Bb')
CH_M = chart('Cm Ab G G Dbmaj7#11 Dbmaj7#11 Dbmaj7#11 Db')

# drums: 16 steps
HALL = {'kick': 'x.......x.x.....', 'tom_lo': '....x.......x...', 'rim': '............x...'}
HALL_FILL = {'kick': 'x.......x.......', 'tom_lo': '....x.......xxXX', 'tom_hi': '........xx......'}
DRIVE = {'kick': 'x.....x.x.x.....', 'snare': '....x.......x...', 'hat': 'x.x.x.x.x.x.x.x.'}
DRIVE_FILL = {'kick': 'x.....x.x.......', 'snare': '....x.......xxXX', 'tom_lo': '........xx......'}


def echo(part, src, beats, vel_scale=0.72):
    """Copy the notes a source ostinato just wrote, `beats` later and softer."""
    for n in src:
        part.note(n.start + beats, n.pitch, n.dur, vel=n.vel * vel_scale, art=n.art)


def build():
    s = Score('battle_castle', tonic='C', bpm=132, intro_bars=2, loop_bars=48,
              title='Stone That Remembers', seed=151)
    # the hall: longer and later than the field battles' rooms
    s.reverb = dict(rt60=3.4, predelay_ms=42, wet_db=-1.0, damp=0.45)
    # the organ and low brass crowd the low mids: carve them out, lift the presence band
    s.master = dict(lufs=-14.0, glue_ratio=1.5, eq=[('peak', 280, 0.8, -3.0),
                    ('peak', 3200, 1.0, 1.0), ('highshelf', 9000, 0.7, 1.0)])
    b = Battle(s, calm_lufs=-17.0, full_lufs=-14.0)
    INTRO, V1, V2, B, M, V3, V4 = 1, 3, 11, 19, 27, 35, 43
    b.section('intro', INTRO, chart('Cm Cm'))
    for name, bar in (('V1', V1), ('V2', V2), ('V3', V3), ('V4', V4)):
        b.section(name, bar, CH_V)
    b.section('B', B, CH_B).section('M', M, CH_M)
    ALL = ('V1', 'V2', 'B', 'M', 'V3', 'V4')

    # ================================================================ the ground
    org = b.part('organ', 'organ', role='pad', calm_db=-1, gain=-3.5, hpf=110,
                 eq=[('peak', 250, 1.0, -3.0)])
    org.at(INTRO).play('@mp [C3 G3 Eb4]w~ | [C3 G3 Eb4]w |')
    for sec in ('V1', 'V2', 'B', 'V3', 'V4'):
        loud = sec in ('V2', 'V3')
        pad(org, b.bar(sec), b.chart(sec), n=4, lo=53 if loud else 48, hi=72, vel=0.5,
            art='loud' if loud else None)
    # the moment, voiced by hand: the organ keeps the major seventh (C) out of the
    # horns' register (the violins sing it, two octaves up, when the time comes)
    org.at(M).play('%loud @0.5 [G3 C4 Eb4 G4]w | [Ab3 C4 Eb4 Ab4]w | %default [G3 B3 D4 G4]w~ |'
                   ' [G3 B3 D4 G4]w | [Ab3 Db4 F4 Ab4]w~ | [Ab3 Db4 F4 Ab4]w~ |'
                   ' [Ab3 Db4 F4 Ab4]w | [Ab3 Db4 F4 Ab4]w |')
    # (the organ ignores velocity: its level is shaped with expression instead)
    org.expr((V1, 1.0), (M + 1.9, 1.0), (M + 2.5, 0.8), (M + 4, 0.62), (M + 7.5, 0.62),
             (M + 8, 1.0))
    ped = b.part('pedal', 'organ', role='low', calm_db=-4, gain=-2)
    ped.at(INTRO).play('@mp C2w~ | C2w |')
    for sec in ('V1', 'M', 'V4'):          # the brass take the ground in the loud strains
        bass(ped, b.bar(sec), b.chart(sec), 'w', 'r', floor=36, vel=0.5)

    tbn = b.part('tbn', 'trombones', role='section', layer='full', gain=-2,
                 eq=[('peak', 300, 1.0, -3.0)])
    tuba = b.part('tuba', 'tuba', role='low', layer='full')
    for sec in ('V2', 'B', 'V3'):
        bass(tbn, b.bar(sec), b.chart(sec), 'h. q', 'r 5', floor=41, vel=0.62)
        bass(tuba, b.bar(sec), b.chart(sec), 'h. q', 'r r', floor=29, vel=0.62)
    bass(tuba, V1, CH_V, 'w', 'r', floor=29, vel=0.55)
    cb = b.part('cb', 'basses', role='low', art='sus', calm_db=-4, gain=-2)
    for sec in ALL:
        bass(cb, b.bar(sec), b.chart(sec), 'w', 'r', floor=28, vel=0.58, art='sus')

    # ================================================================ echoing pizzicato
    pz = b.part('pz_vn', 'violins2', role='ostinato', art='pizz', pan=-0.5, calm_db=-2)
    pz_echo = b.part('pz_va', 'violas', role='ostinato', art='pizz', pan=0.55, calm_db=-3,
                     gain=-2)
    pz_lo = b.part('pz_vc', 'celli', role='section', art='pizz', calm_db=-3, gain=-3)
    # the figure stops while the hall remembers (the moment's middle five bars)
    spans = [b.sections[sec] for sec in ('intro', 'V1', 'V2', 'B', 'V3', 'V4')]
    spans += [(M, CH_M[:2]), (M + 7, CH_M[7:])]
    for bar, ch in spans:
        n0 = len(pz.notes)
        ostinato(pz, bar, ch, 'e e e e e e e e', '0 2 1 - 1 3 2 -', lo=60, hi=79, vel=0.6,
                 art='pizz', accents='> - - - > - - -')
        echo(pz_echo, pz.notes[n0:], 0.75)
        bass(pz_lo, bar, ch, 'q q h', 'r 8 r', floor=36, vel=0.6, art='pizz')

    # ================================================================ the tune
    hn = b.part('hn', 'horns', role='lead', layer='full', gain=2.0, depth=0.35,
                eq=[('peak', 1200, 1.0, 2.5)])
    hn.at(V1).play('@f ' + THEME)
    b.lead('V1', THEME, inst='clarinet', layer='calm', dyn='mf')
    vn = b.part('vn', 'violins', role='lead', layer='full', art='sus',
                eq=[('peak', 3000, 1.0, -2.5), ('highshelf', 7000, 0.7, -1.5)])
    vn.at(V2).play('@f ' + THEME, transpose=12)
    vn2 = b.part('vn2', 'violins2', role='lead2', layer='full', art='sus')
    vn2.at(V2).play('@f ' + THEME)
    b.lead('V2', THEME, inst='solo_violin', name='solo', layer='calm', dyn='mf', transpose=12)
    # B: the climb, violins and horns together; trumpets far off echo each peak
    vn.at(B).play('@f ' + MEL_B)
    hn.at(B).play('@f ' + MEL_B, transpose=-12)
    tpt = b.part('tpt', 'trumpets', role='accent', layer='full', pan=0.4)
    tpt.at(B).play('@mf rh. C5q~ | C5h rh | rh. G4q~ | G4h rh |'
                   ' rh. C5q~ | C5h rh | rh. D5q~ | D5h rh |')
    b.lead('B', MEL_B, inst='oboe', layer='calm', dyn='mf')

    # ================================================================ the moment
    vn.at(M).play('@ff ' + MOMENT_VN)
    # the held G sits back so the horns' memory can be heard through it
    vn.expr((M, 1.0), (M + 1.5, 0.9), (M + 2.2, 0.55), (M + 4, 0.6), (M + 6, 0.6),
            (M + 6.2, 0.9), (M + 8, 1.0))
    vn2.at(M).play('@f C6h. G5q | Ab5q. Bb5s Ab5s G5h |')
    b.lead('M', MOMENT_VN, inst='solo_violin', name='solo', layer='calm', dyn='f')
    oath = b.part('oath', 'horns', role='lead', calm_db=-3, pan=-0.1, gain=5.0, depth=0.3,
                  eq=[('peak', 1200, 1.0, 3.0)])
    oath.at(M + 4).play('@ff ' + OATH + ' @f ' + OATH2)
    oath_b = b.part('oath_b', 'horns', role='lead2', layer='full', pan=0.2, depth=0.35)
    oath_b.at(M + 4).play('@f ' + OATH + ' @mf ' + OATH2)
    vc = b.part('vc_m', 'celli', role='counter', art='sus', layer='full')
    # G major to D-flat: only the held G stays; every other voice moves a step or less.
    # The chord opens in two stages: D-flat with the raised fourth (the held G) first,
    # then the violins add its major seventh (C) two octaves up, clear of the horns
    vc.at(M).play('@f C4h. G3q | Ab3h G3h | B3w~ | B3w | Ab3w~ | Ab3w | F3w | F3h Eb3h |')

    # ================================================================ the whole hall
    vn.at(V3).play('@ff ' + THEME, transpose=12)
    hn.at(V3).play('@ff ' + THEME, transpose=-12)
    b.lead('V3', THEME, inst='flute', layer='calm', dyn='mf', transpose=12)
    b.lead('V3', THEME, inst='clarinet', layer='calm', dyn='mf')

    # ================================================================ the corridor
    solo_hn = b.part('hn_solo', 'horns', role='lead', calm_db=-2, pan=-0.2)
    solo_hn.at(V4).play('@mf ' + THEME_1, transpose=-12)
    bsn = b.part('bsn', 'bassoon', role='lead', calm_db=0)
    bsn.at(V4 + 4).play('@mf ' + THEME_2, transpose=-12)

    # ================================================================ percussion
    timp = b.part('timp', 'timpani', role='timp', calm_db=-6)
    timp.at(INTRO).play('%roll @mp C2w~ | C2h. %default @f G2e G2e |')
    tp = {'Cm': 'C2', 'Ab': 'Ab2', 'Bb': 'Bb2', 'Fm': 'F2', 'Eb': 'Eb2', 'G': 'G2'}
    for sec in ('V1', 'V2', 'B', 'V3'):
        bar, ch = b.sections[sec]
        for i, (c, _) in enumerate(ch):
            r = tp[c.symbol]
            timp.at(bar + i).play(f'@f {r}q rq rq {r}e {r}e |')
    timp.at(M).play('@f C2q rq rh | Ab2q rq rh | %roll @mp G2w~ | @f G2w |'
                    ' %default @ff Db2q rq rh | rw | rw | %roll @mp Db2w |')
    timp.at(V4).play('%default @mf C2q rq rh | rw | rw | rw | C2q rq rh | rw |'
                     ' %roll @mp G2w~ | @f G2w |')

    b.groove('V1', HALL, HALL_FILL, every=4, vel=0.7, crash=False)
    b.groove('V2', DRIVE, DRIVE_FILL, every=4, vel=0.74)
    b.groove('B', DRIVE, DRIVE_FILL, every=4, vel=0.76)
    b.kit.play(M, {'crash': 'X', 'kick': 'x.......x.......'})
    b.kit.play(M + 1, {'kick': 'x.......x.......', 'tom_lo': '....x.......xxxx'})
    b.groove('V3', DRIVE, DRIVE_FILL, every=4, vel=0.78)
    b.kit.play(V4 + 6, {'kick': 'x.......x.......', 'tom_lo': '....x...x...x...'}, vel=0.6)
    b.kit.play(V4 + 7, {'kick': 'x...x...x...x...', 'snare': '........xxxxxxxx'}, vel=0.66,
               ramp=0.5)
    perc = b.part('perc', 'orch_perc', role='accent', calm_db=-8)
    for bar in (V2, B, V3):
        drums(perc, bar, {'crash': 'x', 'bd': 'x'}, vel=0.8)
    drums(perc, M + 4, {'sus': 'x', 'bd': 'x'}, vel=0.7)
    drums(perc, M + 2, {'swell_l': 'x'}, vel=0.55)

    b.sub('V3')

    # ================================================================ calm bed
    for sec in ALL:
        bar, ch = b.sections[sec]
        lp = b.part('c_low', 'celli', layer='calm', role='bass', art='soft', gain=-4)
        bass(lp, bar, ch, 'w', 'r', floor=36, vel=0.48, art='soft')
    b.calm_kit = Kit(s, 'ckit', gains={'kick': -4})
    b.calm_only.update(b.calm_kit.names())
    for bar in range(V1, V4 + 8):
        b.calm_kit.play(bar, {'kick': 'x.......x.......'}, vel=0.4)
    return b.finish()
