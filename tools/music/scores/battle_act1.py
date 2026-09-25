"""Act I battle — "Ember Dusk" (the Border Marches).

The main battle theme. Its melody is the Thread motif (A-D-E-A: Sera's sight,
a line pulled taut) set at battle tempo. Two layers share one timeline:

  calm  ("rain")    strings, piano, harp and winds carry the tune; light kit
  full  ("thunder") rock kit, bass, brass unisons, choir

Form (bars): intro 1-4 | A1 5-12 | A2 13-20 | B 21-28 (relative major; the
thread motif sequenced down, the celli sing it augmented) | C 29-36 (the
Empire's drill, Phrygian) | A3 37-44 (up a step, E minor) | build 45-48.
"""

from engine.patterns import Kit, arp, bass, chart, drums, ostinato, pad
from engine.score import Score

KEY = 'music_battle_act1'

# ------------------------------------------------------------------ material
MEL_A = """
A4q D5q E5e A5q.~ | A5h G5e F5e G5q | E5q. D5e C5q D5q | E5w |
A4q D5q E5e A5q.~ | A5q C6q D6e C6q. | Bb5q. A5e G5q E5q | F5q. E5e D5h |
"""
# the same line with breaths, for brass
MEL_A_BR = """
A4q D5q E5e A5q.~ | A5h G5e F5e G5q | E5q. D5e C5q D5q | E5h. rq |
A4q D5q E5e A5q.~ | A5q C6q D6e C6q. | Bb5q. A5e G5q E5q | F5q. E5e D5q rq |
"""
# B: the thread motif (rest, pickup, reach) sequenced down by step, each
# reach answered by a sighing suspension
MEL_B = """
rq F5e Bb5e C6q F6q~ | F6q. E6e E6h | rq E5e A5e B5q E6q~ | E6q. D6e D6h |
rq D5e G5e A5q D6q~ | D6q. C6e C6q E6q | F6q. E6e D6q C6q | C#6h E6h |
"""
THREAD_B = """
A3h D4h | rq. E4e A4h | A4w | rq. F4e D4h | D4h G4h | E4h C4h | C4h F4h | E4w |
"""
# the Empire's drill (Phrygian half-step), low brass
EMPIRE_C = """
D3q. Eb3e D3q C3q | Bb2h. G2q | D3q. Eb3e D3q F3q | G3h. Eb3q |
F3q. F3e F3q Bb3q | C4h. G3q | C4q. D4e E4q G4q | F#4h. D#4q |
"""
EMPIRE_C_TOP = """
F3q. F3e F3q Bb3q | C4h. G3q | C4q. D4e E4q G4q | F#4h. D#4q |
"""
BUILD_VN = """
C5e D5e E5e G5e C6h | D5e E5e F#5e A5e D6h | Bb4e C5e D5e F5e Bb5h | A4e C#5e E5e G5e A5q C#6q |
"""

CH_INTRO = chart('Dm:4 Dm:4 Dm:4 Bb:2 C:2')
CH_A = chart('Dm Bbmaj7 C A Dm F Gm:2 A7:2 Dm')
CH_B = chart('Bbmaj7 Csus4:1.5 C:2.5 Am7 Dsus2:1.5 Dm:2.5 Gm7 C F/A A')
CH_C = chart('Dm Eb Dm Eb Bb C C B7')
CH_A3 = chart('Em Cmaj7 D B Em G Am:2 B7:2 Em')
CH_BUILD = chart('C D Bb A7')

# drum grids, 16 steps per bar
A1_BEAT = {'kick': 'x.......x.x.....', 'snare': '....x.......x...', 'hat': 'X.x.x.x.X.x.x.x.'}
A1_FILL = {'kick': 'x.......x.......', 'snare': '....x.......xoxx', 'hat': 'X.x.x.x.X.......',
           'tom_hi': '..............x.'}
A2_BEAT = {'kick': 'x.....x.x.....x.', 'rim': '....x.......x...', 'ride': 'X.x.X.x.X.x.X.x.'}
A2_FILL = {'kick': 'x.....x.x.......', 'rim': '....x.......', 'snare': '............xxXX',
           'ride': 'X.x.X.x.X.x.....'}
B_BEAT = {'kick': 'x.......x.x.....', 'rim': '........X.......', 'ride': 'X.x.x.x.X.x.x.x.'}
B_FILL = {'kick': 'x.......x.......', 'rim': '........X.......', 'tom_hi': '..........xx....',
          'tom_lo': '............xxXX'}
C_MARCH = {'kick': 'x.......x.......', 'snare': 'x.oox.o.x.oox.oo', 'tom_lo': '...x.......x....'}
A3_BEAT = {'kick': 'x.x...x.x.x...x.', 'rim': '....X.......X...', 'ride': 'X.x.X.x.X.x.X.x.',
           'ride_bell': 'x.......x.......'}
A3_FILL = {'kick': 'x.x...x.x.......', 'rim': '....X.......', 'snare': '............xxXX',
           'tom_lo': '..........xx....'}
CALM_BEAT = {'kick': 'x.........x.....', 'xstick': '........x.......', 'shaker': 'xoxoxoxoxoxoxoxo'}


def kit_section(kit, start, n, beat, fill, fill_every=4):
    for b in range(start, start + n):
        last = (b - start) % fill_every == fill_every - 1
        kit.play(b, fill if last else beat, vel=0.74)


def build():
    s = Score('battle_act1', tonic='D', bpm=152, intro_bars=4, loop_bars=44, title='Ember Dusk', seed=17)
    s.reverb = dict(rt60=2.1, predelay_ms=26, wet_db=-1.0)
    s.master = dict(lufs=-14.0, glue_ratio=1.5)
    calm_only = ['pno', 'fl', 'ob', 'cl', 'bsn', 'hp', 'ckit_*', 'mel_calm', 'lowpad*',
                 'va_calm', 'solo']
    full_only = ['kit_*', 'ebass', 'tpt_mel', 'tbn', 'tuba', 'lowbrass', 'hn_c', 'choir*', 'sub',
                 'hn_mel', 'stabs', 'riser', 'picc']
    s.variant('full', {p: None for p in calm_only}, lufs=-14.0)
    s.variant('calm', {**{p: None for p in full_only + ['mel_vn', 'mel_vn8', 'ost_hi', 'ost_vn',
                                                         'va', 'vc', 'cb']},
                       'hn': -6, 'timp': -8, 'perc': -8, 'vc_mel': -2, 'glock': -4,
                       'riff_vc': -6, 'va_pad': -2}, lufs=-17.0)

    # ================================================================ strings
    mel = s.part('mel_vn', 'violins', role='lead')
    mel.at(1).play('%trem @p [A4 D5]w~ | [A4 D5]w | rw | rw |')
    mel.expr((1, 0.3), (2.9, 0.95), (3, 0.9))
    mel.at(5).play('%sus @mf' + MEL_A)
    mel.at(13).play('@f' + MEL_A)
    mel.at(21).play('@ff' + MEL_B)
    mel.at(37).play('@ff' + MEL_A, transpose=2)
    mel.at(45).play('@f' + BUILD_VN)
    mel.expr((5, 0.78), (12.9, 0.85), (13, 0.9), (20.9, 0.95), (21, 0.95), (28.9, 1.0),
             (37, 1.0), (44.9, 1.0), (45, 0.7), (48.9, 1.0))

    mel8 = s.part('mel_vn8', 'violins2', role='lead2')
    mel8.at(5).play('%sus @mf' + MEL_A, transpose=-12)
    mel8.at(21).play('@f' + MEL_B, transpose=-12)
    mel8.at(37).play('@ff' + MEL_A, transpose=-10)

    ost = s.part('ost_vn', 'violins2', role='ostinato', art='spic', pan=-0.3)
    arp(ost, 13, CH_A, '0 1 2 1', step=0.25, lo=62, hi=81, vel=0.6, accent_every=1)
    arp(ost, 29, CH_C, '0 1 2 1', step=0.25, lo=57, hi=74, vel=0.6, accent_every=1)
    arp(ost, 45, CH_BUILD, '0 1 2 3', step=0.25, lo=60, hi=84, vel=0.62, accent_every=1)

    osth = s.part('ost_hi', 'violins', role='ostinato', art='spic')
    arp(osth, 29, CH_C, '2 1 0 1', step=0.25, lo=64, hi=84, vel=0.6, accent_every=1)
    arp(osth, 37, CH_A3, '0 1 2 1', step=0.25, lo=64, hi=83, vel=0.62, accent_every=1)

    va = s.part('va', 'violas', role='ostinato', art='spic')
    acc8 = '> - - > - - > -'
    ostinato(va, 3, CH_INTRO[2:], 'e e e e e e e e', '0 1 2 1 0 1 2 1', lo=50, hi=67, vel=0.6)
    for bar, ch in ((5, CH_A), (13, CH_A)):
        ostinato(va, bar, ch, 'e e e e e e e e', '0 1 2 1 0 1 2 1', lo=50, hi=67, vel=0.6,
                 accents=acc8)
    ostinato(va, 29, CH_C, 'e e e e e e e e', '0 0 1 0 0 0 2 0', lo=50, hi=67, vel=0.62,
             accents=acc8)
    ostinato(va, 37, CH_A3, 'e e e e e e e e', '0 1 2 1 0 1 2 1', lo=52, hi=69, vel=0.64,
             accents=acc8)
    va_pad = s.part('va_pad', 'violas', role='pad')
    pad(va_pad, 21, CH_B, n=2, lo=53, hi=67, vel=0.55, art='sus')
    pad(va_pad, 45, CH_BUILD, n=2, lo=53, hi=67, vel=0.6, art='trem')

    vc = s.part('vc', 'celli', role='ostinato', art='spic')
    vc.at(1).play('%trem @p [D3 A3]w~ | [D3 A3]w |')
    vc.expr((1, 0.3), (2.9, 1.0), (3, 0.95))
    for bar, ch in ((3, CH_INTRO[2:]), (5, CH_A), (13, CH_A), (37, CH_A3)):
        ostinato(vc, bar, ch, 'e e e e e e e e', 'b b b b b b b b', lo=38, hi=55, vel=0.64,
                 accents=acc8)
    # C: the whole low end plays the Empire's drill as one riff
    riff = s.part('riff_vc', 'celli', role='lead2', art='sus')
    riff.at(29).play('@ff' + EMPIRE_C)
    vc_mel = s.part('vc_mel', 'celli', role='counter')
    vc_mel.at(21).play('%sus @f' + THREAD_B)
    vc_mel.at(45).play('%sus @f C3w | D3w | Bb2w | A2w |')

    cb = s.part('cb', 'basses', role='low')
    cb.at(1).play('%trem @p D2w~ | D2w |')
    cb.expr((1, 0.3), (2.9, 1.0), (3, 0.95))
    for bar, ch in ((3, CH_INTRO[2:]), (5, CH_A), (13, CH_A), (37, CH_A3)):
        bass(cb, bar, ch, 'q q q q', 'r r r r', floor=26, vel=0.66, art='spic')
    cb.at(29).play('%sus @f' + EMPIRE_C, transpose=-12)
    bass(cb, 21, CH_B, 'w', 'r', floor=26, vel=0.64, art='sus')
    bass(cb, 45, CH_BUILD, 'w', 'r', floor=26, vel=0.68, art='sus')

    # ================================================================ brass
    hn = s.part('hn', 'horns', role='pad')
    hn.at(1).play('@mf A3h D4h | E4h A4h |')                   # the thread, broad
    pad(hn, 5, CH_A, n=3, lo=50, hi=65, vel=0.5)
    pad(hn, 21, CH_B, n=3, lo=53, hi=69, vel=0.58)
    pad(hn, 45, CH_BUILD, n=3, lo=55, hi=69, vel=0.62)
    hn.expr((1, 0.8), (4.9, 0.8), (5, 0.65), (12.9, 0.7), (21, 0.8), (28.9, 1.0),
            (45, 0.55), (48.9, 1.0))

    hn_mel = s.part('hn_mel', 'horns', role='lead', pan=-0.2)
    hn_mel.at(13).play('@f' + MEL_A_BR, transpose=-12)
    hn_mel.at(37).play('@ff' + MEL_A_BR, transpose=-10)

    tpt_mel = s.part('tpt_mel', 'trumpets', role='lead2')
    tpt_mel.at(37).play('@f' + MEL_A_BR, transpose=-10)

    stabs = s.part('stabs', 'trumpets', role='accent', art='stac', pan=0.2)
    ostinato(stabs, 13, CH_A, 'q. q. q', '1 1 2', lo=62, hi=76, vel=0.64)
    ostinato(stabs, 13, CH_A, 'q. q. q', '0 0 1', lo=62, hi=76, vel=0.58)
    # beat-one hits where the B melody breathes
    for bar, c in ((21, '[D4 F4 Bb4]'), (23, '[C4 E4 A4]'), (25, '[D4 G4 Bb4]')):
        stabs.at(bar).play(f'@f {c}q rq rh |')
    stabs.at(33).play('@f rq [D4 F4]q rq [D4 F4]q | rq [E4 G4]q rq [E4 G4]q |'
                      ' rq [E4 G4]q rq [E4 G4]q | rq [D#4 F#4]q [D#4 F#4]q [D#4 F#4]q |')

    tbn = s.part('tbn', 'trombones', role='pad')
    pad(tbn, 13, CH_A, n=2, lo=43, hi=60, vel=0.5)
    pad(tbn, 37, CH_A3, n=2, lo=45, hi=62, vel=0.6)
    pad(tbn, 45, CH_BUILD, n=2, lo=45, hi=60, vel=0.64)

    low = s.part('lowbrass', 'trombones', role='lead')
    low.at(29).play('@ff' + EMPIRE_C)
    tuba = s.part('tuba', 'tuba', role='low')
    tuba.at(29).play('@ff' + EMPIRE_C, transpose=-12)
    bass(tuba, 37, CH_A3, 'h h', 'r r', floor=28, vel=0.6)
    bass(tuba, 45, CH_BUILD, 'w', 'r', floor=28, vel=0.62)
    hn_c = s.part('hn_c', 'horns', role='lead2', pan=-0.35)
    hn_c.at(33).play('@ff' + EMPIRE_C_TOP)

    # air on the tune: piccolo an octave above the violins (full only)
    picc = s.part('picc', 'piccolo', role='lead2', gain=-5)
    picc.at(5).play('@mf' + MEL_A_BR, transpose=12)
    picc.at(37).play('@f' + MEL_A_BR, transpose=14)

    # ================================================================ percussion
    timp = s.part('timp', 'timpani', role='timp')
    timp.at(1).play('%roll @p D2w~ | D2w |')
    timp.expr((1, 0.25), (2.95, 1.0), (3, 1.0))
    timp.at(3).play('%default @f D2q rq rq D2e D2e | D2q rq A2q A2q |')
    for bar in (5, 13):
        timp.at(bar).play('@f D2q rq rh |')
    timp.at(21).play('@ff F2q rq rh |')
    timp.at(23).play('@f A2q rq rh |')
    timp.at(25).play('@f G2q rq rh |')
    for bar in (29, 31):
        timp.at(bar).play('@f D2e D2e rq D2e D2e rq | Eb2q rq Bb2q Bb2q |')
    timp.at(33).play('@f Bb2e Bb2e rq Bb2e Bb2e rq | C3q rq G2q G2q |')
    timp.at(35).play('@f C3e C3e rq C3e C3e rq | B2q rq F#2q F#2q |')
    timp.at(37).play('@ff E2q rq rh |')
    timp.at(45).play('%roll @mf C3w | D3w | Bb2w | A2w |')

    perc = s.part('perc', 'orch_perc', role='accent')
    for bar in (5, 13, 21, 29, 37):
        drums(perc, bar, {'crash': 'x', 'bd': 'x'}, vel=0.8)
    drums(perc, 1, {'swell_l': 'x'}, vel=0.6)

    kit = Kit(s, 'kit')
    kit.play(3, {'kick': 'x...x...x...x...', 'hat': 'x.x.x.x.x.x.x.x.'}, vel=0.7)
    kit.play(4, {'kick': 'x...x...x.......', 'snare': '........xxxxxxxx'}, vel=0.8, ramp=0.5)
    kit_section(kit, 5, 8, A1_BEAT, A1_FILL)
    kit_section(kit, 13, 8, A2_BEAT, A2_FILL)
    kit_section(kit, 21, 8, B_BEAT, B_FILL)
    kit_section(kit, 29, 8, C_MARCH, C_MARCH, fill_every=8)
    kit_section(kit, 37, 8, A3_BEAT, A3_FILL)
    kit.play(45, {'kick': 'x.......x.......', 'tom_lo': 'x...x...x...x...'}, vel=0.66)
    kit.play(46, {'kick': 'x...x...x...x...', 'tom_lo': 'x.x.x.x.x.x.x.x.'}, vel=0.7)
    kit.play(47, {'kick': 'x...x...x...x...', 'snare': 'x.x.x.x.xxxxxxxx'}, vel=0.72, ramp=0.4)
    kit.play(48, {'kick': 'x...x...x.x.x.x.', 'snare': 'xxxxxxxxxxxxxxxx'}, vel=0.84, ramp=0.5)
    for b in (5, 13, 21, 37):
        kit.play(b, {'crash': 'X'})
    for b in (9, 17, 25, 41):
        kit.play(b, {'crash2': 'x'})
    kit.play(36, {'tom_hi': '........x.x.', 'tom_lo': '............xxXX'})

    glock = s.part('glock', 'glock', role='accent')
    glock.at(21).play('@mf rq F6e Bb6e C7q F7q | rw | rq E6e A6e B6q E7q | rw |')

    # ================================================================ rhythm section
    eb = s.part('ebass', 'rbass', role='bass', duck='kit_kick')
    bass(eb, 3, CH_INTRO[2:], 'e e e e e e e e', 'r r r r r r 8 r', floor=28, vel=0.72)
    for bar, ch in ((5, CH_A), (13, CH_A), (37, CH_A3)):
        bass(eb, bar, ch, 'e e e e e e e e', 'r r r r r r 8 r', floor=28, vel=0.74,
             accents='> - - > - - > -')
    bass(eb, 21, CH_B, 'q. e h', 'r r 5', floor=28, vel=0.72)
    eb.at(29).play('@f' + EMPIRE_C, transpose=-12)
    bass(eb, 45, CH_BUILD, 'e e e e e e e e', 'r r r r r r r r', floor=28, vel=0.72)

    choir = s.part('choir_b', 'oohs', role='choir')
    pad(choir, 21, CH_B, n=3, lo=55, hi=72, vel=0.6)
    choir_a = s.part('choir_a', 'choir', role='choir')
    pad(choir_a, 33, CH_C[4:], n=3, lo=55, hi=72, vel=0.66)
    pad(choir_a, 37, CH_A3, n=3, lo=57, hi=74, vel=0.68)

    sub = s.part('sub', 'sub', role='sub')
    for bar, ch in ((5, CH_A), (13, CH_A), (21, CH_B), (37, CH_A3), (45, CH_BUILD)):
        bass(sub, bar, ch, 'w', 'r', floor=26, vel=0.6)

    riser = s.part('riser', 'riser', role='fx')
    riser.note(s.bar(35), 60, 8, vel=0.7)
    riser.note(s.bar(47), 60, 8, vel=0.7)
    riser.note(s.bar(19), 60, 8, vel=0.5)

    # ================================================================ calm-only layer
    # Rain: restrained. A solo violin and the winds carry the tune over legato
    # low strings; the piano moves in quarters, the harp only marks phrase starts.
    pno = s.part('pno', 'grand', role='keys')
    for bar, ch in ((5, CH_A), (13, CH_A), (37, CH_A3)):
        arp(pno, bar, ch, '0 2 4 2', step=1.0, lo=50, hi=79, vel=0.46, accent_every=2,
            accent=0.08)
    arp(pno, 21, CH_B, '0 2 4 5', step=1.0, lo=48, hi=81, vel=0.48, accent_every=2, accent=0.08)
    arp(pno, 29, CH_C, '0 1 2 1', step=1.0, lo=43, hi=62, vel=0.46)
    arp(pno, 45, CH_BUILD, '0 1 2 3 4 5 6 7', step=0.5, lo=48, hi=86, vel=0.5)
    arp(pno, 3, CH_INTRO[2:], '0 2 4 2', step=1.0, lo=50, hi=74, vel=0.42)

    solo = s.part('solo', 'solo_violin', role='lead')
    solo.at(5).play('@mf' + MEL_A)
    solo.at(37).play('@f' + MEL_A, transpose=2)
    solo.expr((5, 0.8), (12.9, 1.0), (37, 0.9), (44.9, 1.0))
    fl = s.part('fl', 'flute', role='lead2')
    fl.at(37).play('@mf' + MEL_A_BR, transpose=2)
    ob = s.part('ob', 'oboe', role='lead')
    ob.at(13).play('@mf' + MEL_A_BR)
    ob.at(33).play('@mf' + EMPIRE_C_TOP, transpose=12)
    mel_c = s.part('mel_calm', 'violins', role='lead', art='soft')
    mel_c.at(21).play('@mf' + MEL_B)
    cl = s.part('cl', 'clarinet', role='counter')
    cl.at(21).play('@mp' + THREAD_B, transpose=12)
    bsn = s.part('bsn', 'bassoon', role='counter')
    bsn.at(29).play('@mf' + EMPIRE_C)
    hp = s.part('hp', 'harp', role='accent')
    for bar, ch in ((5, CH_A[:1]), (13, CH_A[:1]), (21, CH_B[:1]), (37, CH_A3[:1])):
        arp(hp, bar, [(ch[0][0], 2)], '0 1 2 3 4 5 6 7', step=0.25, lo=55, hi=91, vel=0.5)
    lowp = s.part('lowpad', 'celli', role='bass', art='soft')
    lowpb = s.part('lowpad_cb', 'basses', role='low', art='soft')
    for bar, ch in ((5, CH_A), (13, CH_A), (21, CH_B), (37, CH_A3), (45, CH_BUILD)):
        bass(lowp, bar, ch, 'h h', 'r 5', floor=38, vel=0.5, art='soft')
        bass(lowpb, bar, ch, 'w', 'r', floor=26, vel=0.5, art='soft')
    vpad = s.part('va_calm', 'violas', role='pad', art='soft')
    for bar, ch in ((5, CH_A), (13, CH_A), (37, CH_A3)):
        pad(vpad, bar, ch, n=2, lo=53, hi=69, vel=0.45, art='soft')
    kc = Kit(s, 'ckit', gains={'kick': -4})
    for b in list(range(5, 29)) + list(range(37, 45)):
        kc.play(b, {'kick': 'x.......x.......'}, vel=0.42)
    return s
