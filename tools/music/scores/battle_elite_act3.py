"""Act III elite battles — "The Consecrated".

The rite's own picked guard, zealots on sacred ground. A minor with the
Phrygian B-flat, in cut time at half note = 80, and a choir that doesn't
sing a tune until the very end.

The choir recites. Its whole part in the first two strains is one pitch,
the reciting tone E, in syllabic halves and quarters (a litany: long, long |
short short long | long, long | a-men), inflected only at the ends of its
phrases, F to E and then G, F, E. It is reiteration, not a held note (a
held note changing meaning is Rime's): each syllable is let go at six
tenths of its length and sung dry (a reverb send under half the choir's
usual), so each is heard as a new syllable, and the celli (plucked violas
in the calm mix) give the syllables their consonants. Under it a stepwise
Phrygian stab bass rises A, B-flat, C, D, one accented chord a bar and
every other bar empty, so the same E is the fifth of A minor, the raised
fourth over B-flat, the third of C and the second over D (God-Shattering
Star's chant over its rising stabs, as verified). The chords that carry the steps keep F away from the reciting
tone.

The voices always move slower than their accompaniment: under the litany
the violas run in eighths from the first bar; in P, the busiest bars (the
brass shouting in eighths, the strings in sixteenths, the drums driving),
the choir sings whole notes.

P is the dominant as a pedal: E in the bass for six bars with its upper
neighbours F and G, never resolved as a V. The low band then walks down in
octaves, E, D, C, B-flat, and A arrives on a downbeat hit (H0).

The biggest moment goes to the key a major third below. The choir holds
its E over the hit and into the first bar of F major, where the E is the
leading tone, and stops; the hymn belongs to the trumpets and horns in
octaves (the trumpets above, clear of the strings' pad), over trombones
hammering the chords (in eighths, with an eighth's breath at the end of
each bar: at sixteenths the library's staccato trombones stop sounding
like brass). The hymn is the zealots' song to the
goddess whose name was spent, in the old mode (F with the Mixolydian
E-flat); its bass comes to F from E-flat, B-flat or A, never from C:

    C. C F | C'. Bb A F | G Eb | D  (three times, varied)   A Bb | C D | E ...

Its last phrase is the Hollow Sun, the climb the church hymn sings (A,
B-flat, C, D to the leading tone), and it stops on E, which the harmony
turns into the fifth of A minor. So the reprise begins at home: the choir
takes the hymn back, ff over sustained brass, in A minor with the Phrygian
B-flat; its climb reaches G-sharp over B-flat seven and stops, and the
bar where A should be is a rest, as the Dawn office's hymn rests where her
name would be sung: the band, the brass, the choir and the drums are gone,
and only the B-flat pedal and a soft timpani swell remain (the calm intro's
second bar; the full intro holds the horns' B-flat seven there too). The
loop's first stab is that A, from the B-flat under the silence (bII7 to i,
never V to i).

Leitmotif: the Hollow Sun (SCORE.md), twice: the hymn's climb to E in F,
the choir's climb to G-sharp in A, each followed by silence where its
tonic would be. No Thread, no Empire drill.

Form (bars, cut time, half = 80): intro 1-2 (B-flat seven) | A1 3-10 (the
litany over the rising stabs) | A2 11-18 (the same with the band; in the
empty bars the trumpets call the hymn's head, E. E A, climbing with the
steps) | P 19-26 (the E pedal and the descent) | H0 27 (the hit) | H
28-43 (the hymn in F; the violins join the trumpets for its third phrase
and take its climb an octave above them) | R 44-51 (the choir's reprise and
the Hollow Sun; 51 is the near-silent bar). Loop 3-51, 49 bars.

calm: the litany on oohs, a harp an octave above it and plucked violas
under it, a triangle far off on each step, the stabs plucked and on the
timpani, the low strings holding each step; an oboe traces P's
neighbours a fifth above the bass; the hymn on clarinet and bassoon an
octave apart (a flute joins for its second half) over plucked violas and
held basses; the oohs sing the reprise.
full: choir, brass stabs with the orchestra, kit (a processional in A1,
a two-feel in A2, driving in P, full in H and R), bass guitar from P on.

lint: the only sustained semitone is at bar 28, the choir's E held over
the first F-major bar and released: the reciting tone becoming the hymn's
leading tone, intended.

The lines `even` (from battle_elite_act2) is given are levelled only where
the palette still plays the legacy VSCO instrument (the calm mix's clarinet,
bassoon and flute); the house palette's strings, brass and oboe are left as
written.
"""
from engine.patterns import Kit, arp, bass, chart, drums, ostinato, pad
from engine.score import Score
from engine.theory import pitch as parse_pitch

from scores._battle import Battle
from scores.battle_elite_act2 import even

KEY = 'music_battle_elite_act3'

# ------------------------------------------------------------------ material
# the recitation: one reciting tone (E), syllabic, inflected only at the
# ends of its phrases (F-E, then G-F-E)
CHANT = """
E4h> E4h | E4q E4q E4h> | E4h E4h | F4h> E4h |
E4h> E4h | E4q E4q E4h> | E4h G4q F4q | E4w |
"""
# the hymn, in F (the key a major third below): its last phrase is the
# Hollow Sun, the church hymn's climb A B-flat C D to the leading tone,
# and it stops there
HYMN = """
C4q.^ C4e F4h> | C5q. Bb4e A4q F4q | G4h Eb4h | D4w |
C4q.^ C4e F4h> | D5q. C5e Bb4q A4q | G4h A4h | G4w |
C4q.^ C4e F4h> | C5q. Bb4e A4q F4q | G4h Eb4h | D4w |
A3h> Bb3h> | C4h> D4h> | E4w~ | E4h rh |
"""
# the reprise: the choir takes the hymn back in A minor; the climb now
# reaches G-sharp over B-flat seven, and the bar where A should be is silent
REPRISE = """
E4q.^ E4e A4h> | E5q. D5e C5q A4q | Bb4h G4h | F4w |
C5h D5h | E5h F5h | G#5w | rw |
"""

# stab chords of the recitation: the bass rises A, B-flat, C, D (one chord a
# bar, every other bar empty), the top in octaves with it
VOICE = {
    'Am': dict(tpt='E4 A4', hn='A3 C4 E4', tbn='A2 E3', tuba='A1', timp='A2', vn='C5 E5 A5'),
    'Bb': dict(tpt='D4 Bb4', hn='Bb3 D4 Bb4', tbn='Bb2 D3', tuba='Bb1', timp='Bb2',
               vn='D5 Bb5'),
    'C': dict(tpt='G4 C5', hn='C4 E4 G4', tbn='C3 G3', tuba='C2', timp='C3', vn='E5 G5 C6'),
    'Dm': dict(tpt='A4 D5', hn='D4 A4 D5', tbn='D3 A3', tuba='D2', timp='D3', vn='A5 D6'),
}
STEPS = ('Am', 'Bb', 'C', 'Dm')

INTRO, A1, A2, P, H0, H, R = 1, 3, 11, 19, 27, 28, 44

CH_A = 'Am:8 Bb:8 C:8 Dm:8'
CH_P = 'E E F E G F E:2 Dm:2 C:2 Bb:2'
CH_H = ('F Am:2 F:2 Cm:2 Eb:2 Bb F Bb:3 F:1 Eb:2 F:2 Eb F Am:2 F:2 Cm:2 Eb:2 Bb '
        'Dm/A:2 Bb:2 C:2 Dm:2 Am Am')
CH_R = 'Am Am Bb:2 C:2 F F:2 Bb:2 C:2 Dm:2 Bb7 Bb7'

# drum grids (16 steps a bar of cut time)
PROC = {'kick': 'x...............', 'tom_lo': 'x.......x.......', 'tom_hi': '............x...'}
TWO = {'kick': 'x.......x.x.....', 'snare': '....X.......X...', 'hat': 'x.x.x.x.x.x.x.x.'}
TWO_FILL = {'kick': 'x.......x.......', 'snare': '....X.......xxXX', 'hat': 'x.x.x.x.x.......'}
SHOUT = {'kick': 'x.x.x.x.x.x.x.x.', 'snare': '....X.......X...', 'ride': 'x.x.x.x.x.x.x.x.'}
HYMN_BEAT = {'kick': 'x.......x.......', 'snare': '....X.......X...', 'tom_lo': '......x.......x.',
             'ride': 'X.x.x.x.X.x.x.x.'}
HYMN_FILL = {'kick': 'x.......x.......', 'snare': '....X.......x.xx', 'tom_lo': '......x...xx..xx',
             'ride': 'X.x.x.x.X.......'}


def arcs(part, spans, lo=0.78, hi=1.0, length=4):
    """Breathe: each phrase of `length` bars swells to its third bar and
    eases off, instead of every note at one level."""
    pts = list(part.expr_points)
    for a, n in spans:
        for k in range(n):
            b0 = a + k * length
            pts += [(part.score.bar(b0), lo), (part.score.bar(b0 + length * 0.7), hi),
                    (part.score.bar(b0 + length) - 0.05, lo + 0.08)]
    part.expr_points = sorted(pts)
    return part


def build():
    s = Score('battle_elite_act3', tonic='A', bpm=160, meter=(2, 2), intro_bars=2, loop_bars=49,
              title='The Consecrated', seed=307)
    s.reverb = dict(rt60=2.8, predelay_ms=30, wet_db=-0.5, damp=0.45)
    s.master = dict(lufs=-14.0, glue_ratio=1.6)
    b = Battle(s, calm_lufs=-17.0, full_lufs=-14.0)
    b.section('intro', INTRO, chart('Bb7:8'))
    b.section('A1', A1, chart(CH_A)).section('A2', A2, chart(CH_A))
    b.section('P', P, chart(CH_P)).section('H0', H0, chart('Am'))
    b.section('H', H, chart(CH_H)).section('R', R, chart(CH_R))

    # ================================================================ the recitation
    # (dry, and each syllable let go at six tenths of its length, a 0.3 s gap
    # after a half and 0.15 s after a quarter, so the reiteration is heard as
    # reiteration and not as a held note: Rime's device is the held note)
    chw = b.part('ch_w', 'choir', role='lead', layer='full', reverb=0.25, gain=1, humanize_ms=16,
                 vel_jitter=0.1)
    chm = b.part('ch_m', 'choir', role='lead2', layer='full', reverb=0.25, gain=1, humanize_ms=16,
                 vel_jitter=0.1)
    cho = b.part('c_ch', 'oohs', role='lead', layer='calm', reverb=0.25, humanize_ms=16)
    for bar, dyn in ((A1, 'f'), (A2, 'f')):
        chw.at(bar).play(f'@{dyn} ' + CHANT, gate=0.6)
        chm.at(bar).play(f'@{dyn} ' + CHANT, transpose=-12, gate=0.6)
        cho.at(bar).play('@mf ' + CHANT, gate=0.6)
    # the syllables' consonants: low strings on the reciting tone, short
    cons = b.part('chant_str', 'celli', role='accent', art='spic', calm_db=-4, gain=-2)
    consv = b.part('chant_va', 'violas', role='accent', art='pizz', layer='calm', gain=-3)
    chp = b.part('chant_hp', 'harp', role='accent', layer='calm', gain=4)
    for bar in (A1, A2):
        cons.at(bar).play('%spic @mf ' + CHANT, transpose=-12)
        consv.at(bar).play('%pizz @mf ' + CHANT)
        chp.at(bar).play('@mf ' + CHANT, transpose=12)

    # the stabs: one chord a bar, every other bar empty
    stp = b.part('stab_tpt', 'trumpets', role='section', layer='full', gain=4)
    shn = b.part('stab_hn', 'horns', role='section', layer='full', gain=5)
    stb = b.part('stab_tbn', 'trombones', role='section', layer='full', gain=4)
    stu = b.part('stab_tuba', 'tuba', role='low', layer='full', gain=3)
    svn = b.part('stab_vn', 'violins', role='accent', layer='full', gain=5)
    tmp = b.part('timp', 'timpani', role='timp', calm_db=-2)
    perc = b.part('perc', 'orch_perc', role='accent', calm_db=-6, gain=2)
    cpz = b.part('c_stab_pz', 'celli', role='section', layer='calm', gain=2)

    def stab(bar, ch, vel=0.9):
        v = VOICE[ch]
        t = s.bar(bar)
        for key, part in (('tpt', stp), ('hn', shn), ('tbn', stb), ('vn', svn)):
            for p in v[key].split():
                part.note(t, p, 1.0, vel=vel, art='stac')
        stu.note(t, v['tuba'], 1.0, vel=vel, art='stac')
        tmp.note(t, v['timp'], 1.0, vel=vel - 0.05, art='default')
        perc.note(t, 36, 1.0, vel=vel)
        for p in (v['tbn'] + ' ' + v['hn']).split():
            cpz.note(t, parse_pitch(p) + (12 if parse_pitch(p) < 48 else 0), 1.0,
                     vel=0.7, art='pizz')

    for a in (A1, A2):
        for i, ch in enumerate(STEPS):
            stab(a + 2 * i, ch, vel=0.86 if a == A1 else 0.94)
    # calm: a triangle marks each step, far off
    tri = b.part('c_tri', 'orch_perc', role='accent', layer='calm', gain=-2, pan=0.35)
    for a in (A1, A2):
        for i in range(4):
            drums(tri, a + 2 * i, {'tri': 'x'}, vel=0.55)
    drums(tri, H0, {'bell_tree': 'x'}, vel=0.5)
    drums(tri, R, {'bell_tree': 'x'}, vel=0.5)

    # the low strings hold each step and swell into the next
    lo = b.part('low_vc', 'celli', role='pad', calm_db=0)
    lob = b.part('low_cb', 'basses', role='low', calm_db=0, hpf=32)
    for a in (A1, A2):
        for i, ch in enumerate(STEPS):
            r = VOICE[ch]['tbn'].split()[0]
            lo.at(a + 2 * i).play(f'%trem @mf {r}w~ | {r}w |')
            lob.at(a + 2 * i).play(f'%sus @mf {r}w~ | {r}w |', transpose=-12)
    lo.expr(*[(a + 2 * i + d, v) for a in (A1, A2) for i in range(4)
              for d, v in ((0, 0.5), (1.95, 1.0), (2.0, 0.5))])

    # under the recitation the accompaniment always moves faster than the
    # voices: the violas' eighths from the first bar
    a1v = b.part('a1_va', 'violas', role='ostinato', art='spic', calm_db=-2, gain=-3)
    # (no F against the reciting E: over B-flat its sixth, over D its second)
    CH_ARP = 'Am:8 Gm:8 C:8 Dsus2:8'
    arp(a1v, A1, chart(CH_ARP + ' ' + CH_ARP), '0 1 2 1', step=0.5, lo=57, hi=72, vel=0.52,
        accent_every=2)
    # A2: the band. The trumpets call in the empty bars: the hymn's opening
    # fourth, climbing with the steps
    calls = b.part('calls', 'trumpets', role='counter', layer='full')
    for i, (lo_, hi_) in enumerate((('E4', 'A4'), ('F4', 'Bb4'), ('G4', 'C5'), ('A4', 'D5'))):
        calls.at(A2 + 2 * i + 1).play(f'@f {lo_}q.^ {lo_}e {hi_}h> |')
    ost = b.part('a2_ost', 'violins2', role='ostinato', art='spic', calm_db=-2)
    arp(ost, A2, chart(CH_ARP), '0 1 2 1', step=0.5, lo=64, hi=81, vel=0.6, accent_every=2)
    b.spic8('A2', 'celli', degrees='b b b b b b b b', lo=36, hi=55, name='a2_vc', layer='full')

    # ================================================================ the dominant
    # E held in the bass with its upper neighbours F and G, then a descent by
    # step, E D C B-flat, onto A with a downbeat hit. The choir, in whole
    # notes, is the slowest layer in the busiest bars
    pb = 'E2w | E2w | F2w | E2w | G2w | F2w | E2h D2h | C2h Bb1h |'
    b.part('p_cb', 'basses', role='low', calm_db=0, hpf=32).at(P).play('%sus @f ' + pb)
    ebp = b.part('ebass', 'rbass', layer='full', role='bass', duck='kit_kick')
    bass(ebp, P, chart(CH_P), 'e e e e e e e e', 'r r r r r r r r', floor=28, vel=0.74,
         accents='> - - - > - - -')
    b.choir('P', 'choir', n=3, lo=52, hi=72, vel=0.8)
    # calm: an oboe traces the neighbours a fifth above the bass, in whole notes
    b.part('c_p_ob', 'oboe', role='lead', layer='calm').at(P).play(
        '@mf B4w | B4w | C5w | B4w | D5w | C5w | B4h A4h | G4h F4h |')
    b.part('c_p_oohs', 'oohs', role='choir', layer='calm')
    pad(s.parts['c_p_oohs'], P, chart(CH_P), n=3, lo=52, hi=72, vel=0.55)
    shout = b.part('shout_br', 'trombones', role='section', layer='full', art='stac', gain=3)
    shh = b.part('shout_hn', 'horns', role='section', layer='full', art='stac', gain=3)
    sht = b.part('shout_tpt', 'trumpets', role='section', layer='full', art='stac', gain=2)
    for p_, lo_, hi_ in ((shout, 43, 60), (shh, 55, 70), (sht, 64, 79)):
        ostinato(p_, P, chart(CH_P)[:6], 'e e e e q e e', '0 0 0 - - 1 1', lo=lo_, hi=hi_,
                 vel=0.8, art='stac', accents='> - > - - - -')
    # the descent: the low band in octaves, E D C B-flat, onto the hit
    desc = 'E3h D3h | C3h Bb2h |'
    for name_, inst_, tr in (('desc_tbn', 'trombones', 0), ('desc_hn', 'horns', 12),
                             ('desc_tuba', 'tuba', -12), ('desc_vc', 'celli', 0)):
        dp = b.part(name_, inst_, role='section', layer='full', gain=2)
        dp.at(P + 6).play('@ff ' + desc, transpose=tr)
    b.spic16('P', 'violins', pattern='0 1 2 1', lo=64, hi=84, vel=0.62, name='p_vn', calm_db=-4)
    s.parts['p_vn'].opts['gain'] = 2
    b.spic16('P', 'violas', pattern='2 1 0 1', lo=55, hi=72, vel=0.6, name='p_va', calm_db=-6)
    for name_ in ('shout_br', 'shout_hn', 'shout_tpt', 'p_vn', 'p_va', 'choir_choir'):
        s.parts[name_].expr((P, 0.6), (P + 7.9, 1.0), (P + 8, 1.0))
    # (written into the parts, not through b.timp / b.hit, which would reset
    # their calm levels to the helpers' defaults)
    tmp.at(P).play('@f E2q rq E2q rq | E2q rq E2e E2e E2q | F2q rq F2q rq | E2q rq E2e E2e E2q |'
                   ' G2q rq G2q rq | F2q rq F2e F2e F2q | %roll E2h D2h | C2h Bb2h |')

    # ================================================================ the hit, then the hymn
    # the descent lands on A: the whole band, and the choir holds its E into
    # the first bar of the hymn and stops
    drums(perc, H0, {'crash': 'x', 'bd': 'x', 'gong': 'x'}, vel=0.95)
    for part, text in ((stp, '[E4 A4 C5]h rh'), (shn, '[A3 C4 E4]h rh'), (stb, '[A2 E3]h rh'),
                       (stu, 'A1h rh'), (svn, '[C5 E5 A5]h rh')):
        part.at(H0).play(f'%default @ff {text} |')
    chw.at(H0).play('@ff [A4 E5]w~ | E5h rh |')
    chm.at(H0).play('@ff [A3 E4]w |')
    cho.at(H0).play('@mf E4w~ | E4h rh |')
    b.part('p_cb', 'basses').at(H0).play('%sus @ff A1w |')
    tmp.at(H0).play('%default @ff A2q rq rh |')

    # the hymn: trumpets and horns in octaves, tongued, not slurred (every
    # note of it is struck), over trombones hammering the chord below them.
    # The trumpets are the octave above (C5-D6, the climb A4-E5): at pitch they
    # sat in their weak bottom fifth, inside the violas' pad; the horns stay
    # at pitch, the pad's own register
    b.lead('H', HYMN, inst='trumpets', name='hymn_tpt', transpose=12, dyn='ff', layer='full',
           gain=3, legato=False, humanize_ms=14, vel_jitter=0.08)
    b.lead('H', HYMN, inst='horns', name='hymn_hn', dyn='ff', layer='full',
           role='lead2', legato=False)
    # (in eighths: at sixteenths the library's staccato trombones stop
    # sounding like brass), with an eighth's breath at the end of each bar
    # (one part per voice, so each can be levelled on its own)
    for deg in ('0', '1', '2'):
        ham = b.part(f'hammer{deg}', 'trombones', role='section', layer='full', art='stac',
                     gain=-2)
        ostinato(ham, H, chart(CH_H), 'e e e e e e e e', ' '.join([deg] * 7 + ['-']),
                 lo=41, hi=56, vel=0.8, art='stac', accents='> - > - > - > -')
    b.part('hymn_tuba', 'tuba', role='low', layer='full')
    bass(s.parts['hymn_tuba'], H, chart(CH_H), 'h h', 'b b', floor=29, vel=0.8)
    b.part('p_cb', 'basses')
    bass(s.parts['p_cb'], H, chart(CH_H), 'h h', 'b b', floor=28, vel=0.8, art='sus')
    bass(ebp, H, chart(CH_H), 'e e e e e e e e', 'b b b b b b b b', floor=28, vel=0.74,
         accents='> - - - > - - -')
    # the violins join the trumpets for the hymn's third phrase (C5-C6), and
    # take its climb an octave above them (A5-E6); the third phrase an octave
    # higher still would put them on C7 at ff
    vt = b.part('h_vn', 'violins', role='lead2', layer='full', art='sus', gain=2)
    hymn_bars = [x.strip() + ' |' for x in HYMN.strip().rstrip('|').split('|')]
    vt.at(H + 8).play('@ff ' + ' '.join(hymn_bars[8:12]), transpose=12)
    vt.at(H + 12).play('@ff ' + ' '.join(hymn_bars[12:]), transpose=24)
    tmp.at(H).play('%default @f F2h F2h | A2h F2h | C3h Eb2h | Bb2h Bb2h | F2h F2h | Bb2h Bb2q F2q |'
                   ' Eb2h F2h | Eb2h Eb2h | F2h F2h | A2h F2h | C3h Eb2h | Bb2h Bb2h | A2h Bb2h |'
                   ' C3h D3h | %roll A2w~ | A2w |')
    # the strings hold the hymn's harmony under the brass
    hst = b.part('h_str', 'violas', role='pad', layer='full', art='sus')
    # (under the hymn's passing D the minor v is held as a bare fifth)
    pad(hst, H, chart(CH_H.replace('Cm', 'C5')), n=3, lo=57, hi=72, vel=0.6, art='sus')
    hvc = b.part('h_vc', 'celli', role='pad', layer='full', art='sus')
    bass(hvc, H, chart(CH_H), 'h h', 'b 5', floor=41, vel=0.66, art='sus')
    # calm: the hymn on clarinet and bassoon in octaves over plucked strings
    b.lead('H', HYMN, inst='clarinet', name='c_hymn_cl', transpose=12, dyn='mf', layer='calm')
    b.lead('H', HYMN, inst='bassoon', name='c_hymn_bn', dyn='mf', layer='calm', role='lead2')
    cpl = b.part('c_h_pizz', 'violas', role='ostinato', layer='calm', art='pizz')
    ostinato(cpl, H, chart(CH_H), 'q q q q', '0 1 2 0', lo=55, hi=72, vel=0.6, art='pizz')

    # ================================================================ the reprise
    # the choir takes the hymn back, ff, over sustained brass; it climbs to
    # G-sharp over B-flat seven and stops; the bar where A would be is silent
    rpw = b.part('rep_w', 'choir', role='lead', layer='full', gain=1)
    rpm = b.part('rep_m', 'choir', role='lead2', layer='full')
    rpw.at(R).play('@ff ' + REPRISE)
    rpm.at(R).play('@ff ' + REPRISE, transpose=-12)
    # (the calm reprise in the hall, not as dry as the litany)
    b.part('c_rep', 'oohs', role='lead', layer='calm', humanize_ms=16, gain=2).at(R).play(
        '@f ' + REPRISE)
    b.brass_pad('R', 'horns', n=3, lo=53, hi=69, vel=0.7, name='r_hn')
    b.brass_pad('R', 'trombones', n=3, lo=43, hi=60, vel=0.7, name='r_tbn')
    bass(s.parts['hymn_tuba'], R, chart(CH_R), 'w', 'b', floor=29, vel=0.8)
    bass(s.parts['p_cb'], R, chart(CH_R), 'w', 'b', floor=28, vel=0.8, art='sus')
    bass(ebp, R, chart(CH_R), 'e e e e e e e e', 'b b b b b b b b', floor=28, vel=0.74,
         accents='> - - - > - - -')
    b.spic16('R', 'violins', pattern='0 1 2 1', lo=64, hi=86, vel=0.64, name='p_vn')
    b.spic16('R', 'violas', pattern='2 1 0 1', lo=55, hi=72, vel=0.6, name='p_va')
    # (the roll under the choir's G-sharp, then, in the silent bar, the intro's
    # soft swell again: bar 51 is intro bar 2, so the loop's turn is the start's)
    tmp.at(R).play('%default @ff A2q rq rh | A2q rq rh | Bb2q rq C3q rq | F2q rq rh |'
                   ' F2q rq Bb2q rq | C3q rq D3q rq | %roll Bb2w | @p Bb2w |')
    cpad = b.part('c_r_pad', 'violas', role='pad', art='soft', layer='calm')
    pad(cpad, R, chart(CH_R), n=3, lo=53, hi=69, vel=0.5, art='soft')

    # the sub under the band
    sub = b.part('sub', 'sub', layer='full', role='sub')
    bass(sub, A2, chart(CH_A), 'w', 'b', floor=26, vel=0.6)
    sub.at(P).play('@0.6 E1w | E1w | F1w | E1w | G1w | F1w | E1h D1h | C1h Bb0h |')
    bass(sub, H0, chart('Am'), 'w', 'b', floor=26, vel=0.6)
    bass(sub, H, chart(CH_H), 'h h', 'b b', floor=26, vel=0.6)
    bass(sub, R, chart(CH_R), 'w', 'b', floor=26, vel=0.6)
    # calm: the low strings hold the hymn's and the reprise's roots
    clo = b.part('c_lo', 'basses', role='low', art='soft', layer='calm', gain=2, hpf=32)
    bass(clo, H, chart(CH_H), 'w', 'b', floor=28, vel=0.55, art='soft')
    bass(clo, R, chart(CH_R), 'w', 'b', floor=28, vel=0.55, art='soft')
    # calm: a flute joins the clarinet for the hymn's second half and its climb
    cfl = b.part('c_hymn_fl', 'flute', role='lead2', layer='calm', gain=-3)
    cfl.at(H + 8).play('@mf ' + '|'.join(HYMN.strip().split('|')[8:]), transpose=12)

    # ================================================================ intro
    # B-flat seven swells into the first step (the loop ends the same way)
    b.brass_pad('intro', 'horns', n=3, lo=53, hi=67, vel=0.5, name='r_hn')
    b.part('p_cb', 'basses').at(INTRO).play('%sus @mf Bb1w~ | Bb1w |')
    tmp.at(INTRO).play('%roll @p Bb2w~ | Bb2w |')
    tmp.expr((1, 0.3), (2.95, 1.0), (3, 1.0))
    # the loop's last bar, where A should be, is a rest: only the B-flat pedal
    # (at the intro's mf) and the timpani swelling on the intro's lane, as in
    # the calm intro's second bar; everything else is gone, the horns' chord
    # too, so the G-sharp falls into silence and the first stab is the A
    silent = (s.bar(R + 7), s.bar(R + 8))
    for name in ('p_vn', 'p_va', 'ebass', 'r_tbn', 'r_hn', 'sub', 'hymn_tuba', 'c_r_pad',
                 'c_lo'):
        s.parts[name].notes[:] = [n for n in s.parts[name].notes
                                  if not silent[0] - 1e-6 <= n.start < silent[1] - 1e-6]
    for n in s.parts['p_cb'].notes:
        if silent[0] - 1e-6 <= n.start < silent[1] - 1e-6:
            n.vel = 0.62
    tmp.expr((R + 6.97, 1.0), (R + 7, 0.3 + 0.7 * 4 / 7.8), (R + 7.95, 1.0))

    # ================================================================ drums
    kit = Kit(s, 'kit', gains={'snare': 1.0})
    b.kit = kit
    b.full_only.update(kit.names())
    for i in range(8):
        kit.play(A1 + i, PROC, vel=0.7)
    for i in range(8):
        kit.play(A2 + i, TWO_FILL if i % 4 == 3 else TWO, vel=0.66)
    for i in range(6):
        kit.play(P + i, SHOUT, vel=0.7 + 0.02 * i)
    kit.play(P + 6, {'kick': 'x.x.x.x.x.x.x.x.', 'snare': '....X...X.X.XXXX'}, vel=0.8)
    kit.play(P + 7, {'kick': 'x...x...x...x...', 'snare': 'xxxxxxxxxxxxXXXX',
                     'tom_lo': 'x...x...x...x...'}, vel=0.82, ramp=0.4)
    kit.play(H0, {'kick': 'x...............', 'crash': 'X...............'}, vel=0.9)
    for i in range(16):
        kit.play(H + i, HYMN_FILL if i % 4 == 3 else HYMN_BEAT, vel=0.86)
    for i in range(7):
        kit.play(R + i, HYMN_FILL if i % 4 == 3 else HYMN_BEAT, vel=0.82)
    # (R + 7, where A should be: no kit, as in the intro)
    for bar in (A2, P, H, R):
        kit.play(bar, {'crash': 'X'})
    for bar in (H + 4, H + 8, H + 12, R + 4):
        kit.play(bar, {'crash2': 'x'})
    b.riser(P + 6, beats=8)

    # ================================================================ phrasing
    for name in ('ch_w', 'ch_m', 'c_ch'):
        arcs(s.parts[name], ((A1, 4),), lo=0.72)
    for name in ('hymn_tpt', 'hymn_hn', 'c_hymn_cl', 'c_hymn_bn', 'h_vn', 'c_hymn_fl'):
        arcs(s.parts[name], ((H, 4),), lo=0.8)
    for name in ('rep_w', 'rep_m'):
        arcs(s.parts[name], ((R, 2),), lo=0.82)

    # ================================================================ even zones
    for name in ('calls', 'hymn_tpt', 'hymn_hn', 'c_hymn_cl', 'c_hymn_bn', 'p_cb', 'low_vc',
                 'low_cb', 'h_vn', 'c_p_ob', 'hammer0', 'hammer1', 'hammer2', 'c_lo',
                 'c_hymn_fl'):
        even(s.parts[name])
    return b.finish()
