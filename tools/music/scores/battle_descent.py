"""Act V battle — "Ember Dusk, Below".

The Old Kings' Stair, the Mortuary Column and the Landing: a long way down
under the capital. The run's first battle theme, remembered a third time,
further hollowed than "Ember Dusk, in Ash" (Act IV) left it. The tune is the
first phrase of Ember Dusk (imported from battle_act1.py, so it cannot
drift) with its reach taken out, and the mechanism is the stair:

  * FOUR LANDINGS. The phrase is stated four times, each a minor third
    lower than the last: D, B, G-sharp, F, the four notes of a diminished
    seventh, so the fourth landing steps back onto the first and the loop
    closes with no leap. Each landing keeps Ember Dusk's harmony (i VI VII V,
    Dm Bbmaj7 C A, shifted with it); its V chord never resolves down a
    fifth. It steps UP a second onto the next landing's i (A to B, F-sharp
    to G-sharp, D-sharp to F, C to D). The tonal centre falls while the
    harmony tries to climb.
  * THE REACH IS MISSING. The tune's high held A (Ember Dusk's bar-two
    climax) is a rest, and the same note sounds three octaves down, low
    strings (and in the second telling tuba and trombones) on beat 1 of bar
    two: the climb has fallen through the stair. On the beat where the A5
    would have sounded a harp runs down the VI chord from that A to the low
    one, so the hole is heard as a fall, not a missing note. Nothing above the
    staff answers it. (The intro's retrograde Thread, A E D A, lands on that
    low A before the stair begins.)
  * COLD AND SPARSE. In the first telling the tune is violins, celesta and
    oboe over bare fifths (a third-less tremolo), a kit that plays only
    footfalls (three toms stepping down the bar, a kick on the landing) and
    a bell tolling each landing's root. The Thread is never played whole:
    where it returns (the lament ground, X) its fourth note is the one that
    is missing.

Leitmotifs: the Thread (the tune; its fragments over the ground), the Hollow
Sun (B: the climb F-G-A-B-flat-C-sharp that stops short, over a D pedal that
leaves the bass for the last three bars, so the C-sharp is the third of an A
that never goes home: in the hole, bar 36, the bass falls to C, the stair's
own last chord, which steps up onto the second telling's D as every landing
does; never V-i). No Empire drill, no choir sings the tune.

Form (bars): intro 1-4 | A1 5-20 (the four landings, sparse) | X 21-28 (the
lament ground D C B-flat A twice, the Thread in fragments over a driving
sixteenth figure) | B 29-36 (the Hollow Sun; 36 is the hole) | A2 37-52 (the
four landings again, with the band). Loop 5-52, 48 bars.

calm: a solo violin carries the tune over legato low strings, the piano in
quarters (root and fifth) and a soft heartbeat; the oboe and the bassoon
take the climb and the fragments.
"""

from engine.patterns import Kit, arp, bass, chart, drums, ostinato, pad
from engine.score import Score
from engine.theory import Chord
from engine.theory import pitch as parse_pitch

from scores._battle import Battle
from scores.battle_act1 import MEL_A

KEY = 'music_battle_descent'

# ------------------------------------------------------------------ material
# Ember Dusk's first phrase, exactly (the import above is the check) ...
P1 = 'A4q D5q E5e A5q.~ | A5h G5e F5e G5q | E5q. D5e C5q D5q | E5w |'
assert MEL_A.strip().startswith(P1), 'the tune must be Ember Dusk note for note'
# ... without its reach: the held A5 (bar 1's last note tied into bar 2) is a
# rest. The Thread's last note is the one that is gone.
TUNE = 'A4q D5q E5q rq | rh G5e F5e G5q | E5q. D5e C5q D5q | E5w |'
TUNE_BR = 'A4q D5q E5q rq | rh G5e F5e G5q | E5q. D5e C5q D5q | E5h. rq |'

# the lament ground (X): the Thread's first three notes follow it down, the
# fourth is never played. One cell a bar, transposed with the ground.
FRAG = ('A3q D4q E4q rq | G3q C4q D4q rq | F3q Bb3q C4q rq | E3q A3q B3q rq |')
# the Hollow Sun (B): the church hymn's climb, third to leading tone
CLIMB = 'F5w | G5w | A5w | Bb5w | C#6w~ | C#6w~ | C#6h rh | rw |'

STEP = -3                         # each landing a minor third lower
LAND = chart('Dm Bbmaj7 C A')     # Ember Dusk's i VI VII V
# the calm bed's chart: bar two's first two beats (the tune rests) stand on the
# fallen reach, voiced as the third of F, so its low strings join the low A instead
# of holding B-flat a semitone above it (exposed in the calm mix, the full mix's
# VI-over-its-seventh reads as a wrong bass note)
LAND_CALM = chart('Dm F/A:2 Bb:2 C A')


def shift(ch, n):
    """A chart moved by n semitones (a landing sits n lower)."""
    out = []
    for c, beats in ch:
        c2 = Chord(c.symbol)
        c2.root = (c.root + n) % 12
        c2.bass = (c.bass + n) % 12
        out.append((c2, beats))
    return out


def stair(n=4, land=LAND):
    """The four landings' chart, one after another."""
    out = []
    for i in range(n):
        out += shift(land, STEP * i)
    return out


CH_A = stair()
CH_A_CALM = stair(land=LAND_CALM)
CH_X = chart('Dm C Bb A Dm C Bb A')
CH_B = chart('Dm Gm/D Dm Bb/D A7:4 A7:4 A7:4 C:4', default_beats=4.0)
CH_INTRO = chart('Dm:4 Dm:4 Dm:4 Dm:4')

INTRO, A1, X, B, A2 = 1, 5, 21, 29, 37

# drum grids, 16 steps a bar. The stair: three toms stepping down the bar and
# a kick on each landing; nothing else keeps time in the first telling.
STAIR = {'kick': 'x.......x.......', 'tom_hi': '..x.............',
         'tom_mid': '......x.........', 'tom_lo': '..........x...x.',
         'rim': '........X.......'}
STAIR_FILL = {'kick': 'x.......x.......', 'tom_hi': '........xx......',
              'tom_mid': '..........xx....', 'tom_lo': '............xxXX'}
# with the band: the stair under a hard two-feel
STAIR2 = {'kick': 'x.....x.x.......', 'snare': '........X.......',
          'hat': 'x.x.x.x.x.x.x.x.', 'tom_hi': '..x.............',
          'tom_mid': '......x.........', 'tom_lo': '..........x...x.'}
STAIR2_FILL = {'kick': 'x.....x.x.......', 'snare': '........x.x.xxXX',
               'tom_hi': '........xx......', 'tom_mid': '..........xx....',
               'tom_lo': '............xxXX'}
DRIVE = {'kick': 'x.x.....x.x.....', 'snare': '....X.......X...',
         'hat': 'x.x.x.x.x.x.x.x.', 'tom_lo': '.......x......x.'}
DRIVE_FILL = {'kick': 'x.x.....x.......', 'snare': '....X.......xxXX',
              'hat': 'x.x.x.x.x.......', 'tom_lo': '..........xx....'}


def at_or_above(name, shift_by, floor):
    """A pitch moved with its landing, kept above the part's floor."""
    p = parse_pitch(name) + shift_by
    while p < floor:
        p += 12
    return p


def low_note(part, bar, name, dur, shift_by, floor, vel):
    """The displaced reach, moved with its landing."""
    part.note(part.score.bar(bar), at_or_above(name, shift_by, floor), dur, vel=vel)


def landing_bass(part, bar0, ch, rhythm, notes, floor, vel, accents, art):
    """A landing's low end, minus the second bar's first two beats."""
    kw = dict(floor=floor, vel=vel, accents=accents)
    if art:
        kw['art'] = art
    bass(part, bar0, ch[:1], rhythm, notes, **kw)
    bass(part, bar0 + 1.5, [(ch[1][0], 2.0)], rhythm, notes, **kw)
    bass(part, bar0 + 2, ch[2:], rhythm, notes, **kw)


def build():
    s = Score('battle_descent', tonic='D', bpm=140, intro_bars=4, loop_bars=48,
              title='Ember Dusk, Below', seed=511)
    s.reverb = dict(rt60=3.2, predelay_ms=30, wet_db=0.2, damp=0.62)
    s.master = dict(lufs=-14.0, glue_ratio=1.5)
    b = Battle(s, calm_lufs=-17.0, full_lufs=-14.0)
    b.section('intro', INTRO, CH_INTRO).section('A1', A1, CH_A).section('X', X, CH_X)
    b.section('B', B, CH_B).section('A2', A2, CH_A)
    lands = [(A1 + 4 * i, STEP * i) for i in range(4)]
    lands2 = [(A2 + 4 * i, STEP * i) for i in range(4)]

    # ================================================================ the tune
    # violins (full) / solo violin (calm); the second telling is louder, the
    # last landing is low, so the oboe takes it up an octave
    vn = b.part('mel_vn', 'violins', layer='full', role='lead')
    sv = b.part('solo', 'solo_violin', layer='calm', role='lead')
    for bar, t in lands:
        vn.at(bar).play('%sus @mf ' + TUNE, transpose=t)
        sv.at(bar).play('@mf ' + TUNE, transpose=t)
    for bar, t in lands2:
        vn.at(bar).play('%sus @f ' + TUNE, transpose=t)
        sv.at(bar).play('@f ' + TUNE, transpose=t)
    vn.expr((A1, 0.7), (A1 + 15.9, 0.85), (A2, 0.9), (A2 + 15.9, 1.0))
    sv.expr((A1, 0.85), (A1 + 15.9, 0.95), (A2, 0.95), (A2 + 15.9, 1.0))

    # cold doubling: the celesta on the first and third landings (an octave up),
    # the oboe on the second and fourth
    ces = b.part('mel_ces', 'celesta', layer='full', role='accent', gain=-1)
    ob = b.part('mel_ob', 'oboe', role='lead2', gain=-2, calm_db=-3)
    for bars in (lands, lands2):
        for i, (bar, t) in enumerate(bars):
            if i % 2 == 0:
                ces.at(bar).play('@mf ' + TUNE, transpose=t + 12)
            else:
                ob.at(bar).play('@mf ' + TUNE_BR, transpose=t + 12)
    # second telling: horns an octave under the violins (the first has none)
    hn = b.part('mel_hn', 'horns', layer='full', role='lead2', pan=-0.2, gain=-1)
    for bar, t in lands2:
        hn.at(bar).play('@mf ' + TUNE_BR, transpose=t - 12)

    # the reach, fallen: the low strings, and in the second telling brass too
    rvc = b.part('reach_vc', 'celli', role='low', art='sus', calm_db=-2, gain=3)
    rcb = b.part('reach_cb', 'basses', role='low', art='sus', calm_db=-2, gain=3)
    rtb = b.part('reach_tbn', 'trombones', layer='full', role='section', gain=-1)
    rtu = b.part('reach_tuba', 'tuba', layer='full', role='low')
    for bars, brass in ((lands, False), (lands2, True)):
        for bar, t in bars:
            low_note(rvc, bar + 1, 'A2', 2.0, t, 36, 0.9)
            low_note(rcb, bar + 1, 'A1', 2.0, t, 27, 0.9)
            if brass:
                low_note(rtb, bar + 1, 'A2', 2.0, t, 34, 0.8)
                low_note(rtu, bar + 1, 'A1', 2.0, t, 28, 0.8)
    # the fall itself: on the beat where the A5 would have sounded, a harp runs down
    # from that A to the low A that took its place (through A F C, the F the calm bed
    # holds there, so no note a semitone from the A rings into the landing), and the
    # hole is heard as a fall through the stair, not as a missing note (louder in the
    # calm mix, where the tune is barest)
    fhp = b.part('fall_hp', 'harp', role='accent', calm_db=3)
    for bars in (lands, lands2):
        for bar0, t in bars:
            top = parse_pitch('A5') + t
            low = at_or_above('A2', t, 36)
            pcs = {(pc + t) % 12 for pc in (9, 0, 5)}          # A C F, moved
            run = [p for p in range(top, low - 1, -1) if p % 12 in pcs]
            step = 1.0 / (len(run) - 1)
            # (damped at the landing: only the low note rings, so the chord's root
            # never sounds a semitone above it)
            for k, p in enumerate(run):
                last = k == len(run) - 1
                fhp.note(s.bar(bar0) + 3.0 + k * step, p, 1.5 if last else 1.0 - k * step,
                         vel=0.5 + 0.3 * k / (len(run) - 1))
    # the landings' roots, tolled (as Ashfall tolls them)
    bells = b.part('bells', 'bells', role='accent', calm_db=-3)
    for bars in (lands, lands2):
        for bar, t in bars:
            bells.at(bar).play('@mf D5h A4h |', transpose=t)
    bells.at(INTRO).play('@mf D5h A4h |')
    timp = b.part('timp', 'timpani', role='timp', calm_db=-8)
    for bars in (lands, lands2):
        for bar, t in bars:
            vel = 0.82 if bars is lands else 0.9
            timp.note(s.bar(bar), at_or_above('D3', t, 36), 1.0, vel=vel)
            timp.note(s.bar(bar + 1), at_or_above('A2', t, 36), 1.0, vel=0.78)

    # ================================================================ intro
    # the Thread read backwards (A E D A) falls onto the low A the stair begins on
    icb = b.part('i_cb', 'basses', role='low', art='trem', calm_db=0)
    icb.at(INTRO).play('@p D2w~ | D2w~ | D2w~ | D2w |')
    icb.expr((INTRO, 0.3), (INTRO + 2.9, 1.0), (INTRO + 3, 0.95))
    ivc = b.part('i_vc', 'celli', role='low', art='trem', calm_db=0)
    ivc.at(INTRO).play('@p [D3 A3]w~ | [D3 A3]w |')
    ivc.expr((INTRO, 0.3), (INTRO + 1.9, 1.0), (INTRO + 2, 0.0))
    ivr = b.part('i_vc_thread', 'celli', role='lead', art='sus', calm_db=0)
    ivr.at(INTRO + 2).play('@mf A3h E3h | D3h A2h |')
    ti = b.part('timp_i', 'timpani', role='timp', calm_db=-8)
    ti.at(INTRO).play('%roll @p D3w~ | D3w |')
    ti.expr((INTRO, 0.25), (INTRO + 1.95, 1.0))
    ti.at(INTRO + 2).play('%default @f D3q rq rq D3e D3e | D3q rq A2q A2q |')

    # ================================================================ ground and fifths
    # the landings' low end: eighths locked to the kick, roots only. A1 starts
    # with the strings alone; the bass guitar joins at the second landing
    cb = b.part('cb', 'basses', role='low', art='spic', calm_db=-3)
    vc = b.part('vc', 'celli', layer='full', role='ostinato', art='spic')
    ebs = b.part('ebass', 'rbass', layer='full', role='bass', duck='kit_kick')
    sub = b.part('sub', 'sub', layer='full', role='sub', gain=-2)
    # (the first telling is sparse: bass quarters alone, the celli's eighths from the second
    # landing, the bass guitar from the fourth. On the second bar's first two beats the floor
    # is gone: the reach is alone)
    for bars, ebass_from, vc_from in ((lands, 3, 1), (lands2, 0, 0)):
        for i, (bar0, t) in enumerate(bars):
            for part, rhythm, notes, floor, vel, acc in (
                    (cb, 'q q q q', 'b b b b', 26, 0.64, None),
                    (vc, 'e e e e e e e e', 'b b b b b b b b', 38, 0.62, '> - - > - - > -'),
                    (sub, 'w', 'b', 26, 0.6, None),
                    (ebs, 'e e e e e e e e', 'b b b b b b 8 b', 29, 0.74, '> - - > - - > -')):
                if (part is ebs and i < ebass_from) or (part is vc and i < vc_from):
                    continue
                art = 'spic' if part in (cb, vc) else None
                landing_bass(part, bar0, shift(LAND, t), rhythm, notes, floor, vel, acc, art)

    # bare fifths held on tremolo strings (no thirds: the tune supplies them)
    th = b.part('trem_hi', 'violins2', layer='full', role='pad', art='trem', gain=-3)
    tv = b.part('trem_va', 'violas', layer='full', role='pad', art='trem', gain=-3)
    for bar0, ch in ((A1, CH_A), (A2, CH_A)):
        t0 = s.bar(bar0)
        for c, beats in ch:
            for part, lo in ((th, 62), (tv, 55)):
                root = c.root_note(lo)
                part.note(t0, root, beats, vel=0.5, art='trem', rearticulate=True)
                part.note(t0, root + 7, beats, vel=0.5, art='trem', rearticulate=True)
            t0 += beats
    th.expr((A1, 0.7), (A1 + 15.9, 0.9), (A2, 0.9), (A2 + 15.9, 1.0))

    # ================================================================ X: the lament ground
    # D C B-flat A twice. The Thread's three notes follow it down (the fourth
    # is never played); the pass repeats an octave up, and louder
    fvc = b.part('frag_vc', 'celli', role='lead', art='sus', calm_db=-3)
    fvn = b.part('frag_vn', 'violins', layer='full', role='lead2')
    fbn = b.part('frag_bn', 'bassoon', layer='calm', role='lead')
    fob = b.part('frag_ob', 'oboe', layer='calm', role='lead2')
    for k in range(4):
        cell = FRAG.split('|')[k].strip()
        fvc.at(X + k).play('@mf ' + cell + ' |')
        fvc.at(X + 4 + k).play('@f ' + cell + ' |', transpose=0)
        fvn.at(X + 4 + k).play('@f ' + cell + ' |', transpose=12)
        fbn.at(X + k).play('@mf ' + cell + ' |')
        fob.at(X + 4 + k).play('@mf ' + cell + ' |', transpose=12)
    # the figure that drives: root and fifth in sixteenths, the strings straight
    xva = b.part('x_va', 'violas', layer='full', role='ostinato', art='spic')
    arp(xva, X, CH_X, '0 2 0 2', step=0.25, lo=55, hi=70, vel=0.58, accent_every=0.75,
        accent=0.14)
    xvn = b.part('x_vn', 'violins2', layer='full', role='ostinato', art='spic', pan=-0.3)
    arp(xvn, X + 4, CH_X[4:], '0 2 0 2', step=0.25, lo=62, hi=79, vel=0.6, accent_every=0.75,
        accent=0.14)
    bass(cb, X, CH_X, 'q q q q', 'b b b b', floor=26, vel=0.66, art='spic')
    bass(vc, X, CH_X, 'e e e e e e e e', 'b b b b b b b b', floor=38, vel=0.64,
         accents='> - - > - - > -')
    bass(ebs, X, CH_X, 'e e e e e e e e', 'b b b b b b 8 b', floor=29, vel=0.76,
         accents='> - - > - - > -')
    bass(sub, X, CH_X, 'w', 'b', floor=26, vel=0.6)
    xtb = b.part('x_tbn', 'trombones', layer='full', role='pad')
    pad(xtb, X + 4, CH_X[4:], n=2, lo=41, hi=58, vel=0.56)
    timp.at(X).play('@f D2e D2e rq D2e D2e rq | C2e C2e rq C2e C2e rq | Bb1e Bb1e rq Bb1e Bb1e rq'
                    ' | A1e A1e rq A1e A1e rq |', transpose=12)
    timp.at(X + 4).play('@ff D2e D2e rq D2e D2e rq | C2e C2e rq C2e C2e rq | Bb1e Bb1e rq Bb1e '
                        'Bb1e rq | A1e A1e rq A1e A1e rq |', transpose=12)

    # ================================================================ B: the Hollow Sun
    clv = b.part('climb_vn', 'violins', role='lead', calm_db=-3)
    clv.at(B).play('%sus @mf ' + CLIMB)
    clv.expr((B, 0.65), (B + 4, 0.8), (B + 5.9, 1.0), (B + 6, 1.0), (B + 6.4, 0.5))
    clh = b.part('climb_hn', 'horns', layer='full', role='lead2', pan=-0.25)
    clh.at(B).play('@mf ' + CLIMB, transpose=-12)
    clh.expr((B, 0.6), (B + 4, 0.85), (B + 6, 1.0), (B + 6.4, 0.4))
    clo = b.part('climb_ob', 'oboe', layer='calm', role='lead2')
    clo.at(B).play('@mf ' + CLIMB, transpose=-12)
    clf = b.part('climb_fl', 'flute', layer='calm', role='lead2')
    clf.at(B + 4).play('@mf ' + 'C#6w~ | C#6w~ | C#6h rh | rw |', transpose=-12)
    # the pedal leaves at the C-sharp: D through bar 32, then A
    pcb = b.part('ped_cb', 'basses', role='low', art='sus', calm_db=0)
    pcb.at(B).play('@f D1w | D1w | D1w | D1w | A1w | A1w | A1w |')
    pvc = b.part('ped_vc', 'celli', role='low', art='sus', calm_db=0)
    pvc.at(B).play('@f D2w | D2w | D2w | D2w | A2w | A2w | A2w |')
    ptb = b.part('ped_tbn', 'trombones', layer='full', role='pad')
    ptb.at(B).play('@mf D2w | D2w | D2w | D2w | A2w | A2w | A2h rh | rw |')
    ptb.expr((B, 0.7), (B + 5.9, 1.0), (B + 6.5, 0.5))
    tsu = b.part('trem_b', 'violins2', layer='full', role='pad', art='trem')
    pad(tsu, B, CH_B[:7], n=2, lo=62, hi=75, vel=0.5, art='trem')
    tsu.expr((B, 0.6), (B + 5.9, 1.0), (B + 6.4, 0.4))
    bva = b.part('b_va', 'violas', layer='full', role='ostinato', art='spic')
    arp(bva, B, CH_B[:7], '0 2 0 2', step=0.25, lo=55, hi=70, vel=0.56, accent_every=0.75,
        accent=0.14)
    boh = b.part('b_oohs', 'oohs', layer='full', role='choir')
    pad(boh, B, CH_B[:7], n=3, lo=52, hi=69, vel=0.5)
    boh.expr((B, 0.5), (B + 5.9, 1.0), (B + 6.4, 0.3))
    tb = b.part('timp_b', 'timpani', role='timp', calm_db=-8)
    tb.at(B).play('%default @mf D2q rq rh | D2q rq rh | D2q rq rh | D2q rq rh |')
    tb.at(B + 4).play('%roll @f A2w | A2w | A2h rh |')
    tb.expr((B, 0.7), (B + 4, 0.7), (B + 6, 1.0), (B + 6.4, 0.3))
    # the hole at bar 36: the C-sharp falls to C, low, and nothing else. C is the stair's
    # own last chord (each landing's V steps up a second onto the next), so the second
    # telling begins by the stair's step, never by V-i: the Hollow Sun stays unresolved.
    # A timpani roll and the toms' footfalls on the last beat lead back in
    hole = b.part('hole', 'basses', role='low', art='soft', calm_db=0)
    hole.at(B + 7).play('@p C2w |')
    hole_vc = b.part('hole_vc', 'celli', role='low', art='soft', calm_db=0)
    hole_vc.at(B + 7).play('@pp C3w |')
    th_ = b.part('timp_h', 'timpani', role='timp', calm_db=-6)
    th_.at(B + 7).play('%roll @mp rh C3h |')
    th_.expr((B + 7.5, 0.3), (B + 7.97, 1.0))

    # ================================================================ the second telling's weight
    # oohs, far, on the fifths of each landing (voices begin here)
    oo = b.part('oohs', 'oohs', layer='full', role='choir', gain=-2)
    t0 = s.bar(A2)
    for c, beats in CH_A:
        root = c.root_note(50)
        oo.note(t0, root, beats, vel=0.46, rearticulate=True)
        oo.note(t0, root + 7, beats, vel=0.46, rearticulate=True)
        t0 += beats
    oo.expr((A2, 0.6), (A2 + 15.9, 1.0))
    # the sixteenths come back, straight, from the second landing of the
    # second telling (Ember Dusk's leaning accent is gone)
    a2v = b.part('a2_va', 'violas', layer='full', role='ostinato', art='spic')
    arp(a2v, A2 + 4, CH_A[4:], '0 2 0 2', step=0.25, lo=55, hi=70, vel=0.58, accent_every=1,
        accent=0.08)

    # ================================================================ percussion
    perc = b.part('perc', 'orch_perc', role='accent', calm_db=-8)
    for bar in (A1, X, B + 4, A2):
        drums(perc, bar, {'crash': 'x', 'bd': 'x'}, vel=0.8)
    drums(perc, INTRO, {'swell_l': 'x'}, vel=0.6)
    drums(perc, B + 7, {'gong': 'x'}, vel=0.5)
    b.riser(B + 3, beats=16, vel=0.6)

    kit = Kit(s, 'kit')
    b.kit = kit
    b.full_only.update(kit.names())
    kit.play(INTRO, {'kick': 'x...............'}, vel=0.6)
    kit.play(INTRO + 1, {'kick': 'x...............'}, vel=0.62)
    kit.play(INTRO + 2, {'kick': 'x.......x.......', 'tom_hi': '..x.............',
                         'tom_mid': '......x.........', 'tom_lo': '..........x.....'}, vel=0.7)
    kit.play(INTRO + 3, STAIR_FILL, vel=0.76, ramp=0.4)
    for i in range(16):
        kit.play(A1 + i, STAIR_FILL if i % 4 == 3 else STAIR, vel=0.7)
        if i >= 4:
            kit.play(A1 + i, {'hat': 'o.x.o.x.o.x.o.x.'}, vel=0.56)
    for i in range(8):
        kit.play(X + i, DRIVE_FILL if i % 4 == 3 else DRIVE, vel=0.76)
    for i in range(4):
        kit.play(B + i, {'kick': 'x.......x.......', 'tom_lo': 'x.x.x.x.x.x.x.x.'},
                 vel=0.66 + 0.02 * i)
    kit.play(B + 4, {'kick': 'x...x...x...x...', 'tom_lo': 'x.x.x.x.x.x.x.x.',
                     'snare': '....x...x...x...'}, vel=0.78)
    kit.play(B + 5, {'kick': 'x...x...x...x...', 'snare': 'x.x.x.x.xxxxxxxx'}, vel=0.8,
             ramp=0.5)
    kit.play(B + 6, {'kick': 'x...x...x...x...', 'snare': 'xxxxxxxxxxxxxxxx'}, vel=0.88,
             ramp=0.6)
    # (bar 35's last beats and 36 are the hole: no kit until the footfalls on its last beat)
    kit.play(B + 7, {'tom_hi': '............x...', 'tom_mid': '.............x..',
                     'tom_lo': '..............xX'}, vel=0.64)
    for i in range(16):
        kit.play(A2 + i, STAIR2_FILL if i % 4 == 3 else STAIR2, vel=0.76)
    for bar in (A1, X, A2, A2 + 8):
        kit.play(bar, {'crash': 'X'})
    kit.play(B + 4, {'crash': 'X'})

    # ================================================================ calm bed
    b.section('A1c', A1, CH_A_CALM).section('A2c', A2, CH_A_CALM)
    b.calm_bed('A1c', piano='0 2 0 2', pad_n=2)
    b.calm_bed('X', piano='0 2 0 2', pad_n=2)
    b.calm_bed('A2c', piano='0 2 0 2', pad_n=2)
    # under the climb the calm mix keeps its heartbeat and a soft pad (no low strings:
    # the pedal is shared)
    for bar in range(B, B + 7):
        b.calm_kit.play(bar, {'kick': 'x.......x.......'}, vel=0.42)
    cpad = b.part('c_pad', 'violas', layer='calm', role='pad', art='soft')
    pad(cpad, B, CH_B[:7], n=2, lo=53, hi=69, vel=0.42, art='soft')
    bpn = b.part('c_pno', 'grand', layer='calm', role='keys')
    arp(bpn, B, CH_B[:6], '0 2 0 2', step=1.0, lo=48, hi=75, vel=0.46, accent_every=2,
        accent=0.08)
    return b.finish()
