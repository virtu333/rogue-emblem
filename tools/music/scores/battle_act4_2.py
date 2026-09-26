"""Act IV battle II — "Ember Dusk, in Ash".

The run's first battle theme, remembered in the ashen capital after the
ritual completed. Ember Dusk's (Act I) form and tune, a semitone down in the
Act IV key, C-sharp minor, but heard in Act IV's world, not replayed in
Act I's: the tune is remembered in the place where Ashfall is played. The
memory is intact where it hurts and broken where it matters:

  * the first phrase of the tune is note for note the Act I melody (the
    text is imported from battle_act1.py, so it cannot drift), over its own
    harmony;
  * but not over its own band. In A1 and A2 Ember Dusk's rock kit, its
    spiccato viola and cello eighths and its walking quarters are gone.
    Ashfall's ground carries the tune instead: Ashfall's half-time doom
    groove (kick, snare on three, the low tom pushing the offbeats; the
    grids are imported from battle_act4.py), the low strings and the bass
    guitar locked to its kick in one heavy figure, tremolo upper strings,
    and the bells tolling every phrase as they toll in Ashfall;
  * the second phrase keeps its notes but the bass under it is changed: it
    moves through inversions and a flat-second chord that never settles;
  * the answering note (the tonic the old phrase landed on) is omitted; where
    the old answer was, the altered answer of E04 sounds instead: b3, b2, 7,
    rest — the lowered second held against the leading tone, then silence;
  * the B strain (the relative major, the sighing suspensions) is thinned:
    no octave doubling, no glock reaches after the first, the bass in first
    inversions; the C strain — the Empire's drill — is untouched: it won.
  * each return breaks a little more: in A2 the horns and the trumpet stabs
    answer only the first phrase; in A3 (a step up, as the old A3 was)
    Ember Dusk's own band (its rock kit, its spiccato figures) comes back
    for the first phrase only, the one time the tune is heard as it was, with
    the horns and violins carrying it, and drops out under the second,
    leaving Ashfall's tom pulse and the altered answer.

No choir sings the tune: "the choir sings Ember Dusk" is the Entity
finale's, and this plays in half of Act IV's field battles. The only voices
are the oohs under the Empire's strain.

Written in Ember Dusk's D-minor notation and rendered a semitone down
(`Score(transpose=-1)`, tonic Db) so the damage can be read against the
original. Leitmotifs: the Thread (the melody, as in Act I); the Empire drill
(C strain, intact). The calm mix is the tune alone, remembered: a solo
voice over a low string bed, the heartbeat and the tolling bells.

Form (bars): intro 1-4 | A1 5-12 | A2 13-20 | B 21-28 | C 29-36 | A3 37-44
(up a step) | build 45-48 — the form of Ember Dusk, bar for bar.
"""

from engine.patterns import Kit, arp, bass, chart, drums, ostinato, pad
from engine.score import Score
from engine.theory import Chord

from scores.battle_act1 import BUILD_VN, EMPIRE_C, EMPIRE_C_TOP, MEL_A, MEL_A_BR, MEL_B, THREAD_B
from scores.battle_act4 import DOOM, DOOM_FILL

KEY = 'music_battle_act4_2'

# ------------------------------------------------------------------ material
# The first phrase of Ember Dusk, exactly (checked against the import below).
P1 = 'A4q D5q E5e A5q.~ | A5h G5e F5e G5q | E5q. D5e C5q D5q | E5w |'
P1_BR = 'A4q D5q E5e A5q.~ | A5h G5e F5e G5q | E5q. D5e C5q D5q | E5h. rq |'
assert MEL_A.strip().startswith(P1), 'the first phrase must be Ember Dusk note for note'
assert MEL_A_BR.strip().startswith(P1_BR)

# The second phrase: its notes kept until the answer. The old answer was
# F-E-D (b3-2-1); the answer is now F-Eb-C#-rest (b3-b2-7-rest, E04) — the
# Eb held into the beat where the harmony's leading tone C# arrives.
P2_ASH = 'A4q D5q E5e A5q.~ | A5q C6q D6e C6q. | Bb5q. A5e G5q E5q | F5q. Eb5e~ Eb5e C#5e rq |'
P2_ASH_BR = 'A4q D5q E5e A5q.~ | A5q C6q D6e C6q. | Bb5q. A5e G5q E5q | F5q. Eb5e~ Eb5e C#5e rq |'
# the horns in A2 answer the first phrase, then fail to answer the second
P2_SILENT = 'rw | rw | rw | rw |'

CH_INTRO = chart('Dm:4 Dm:4 Dm:4 Bb:2 C:2')
# phrase 1: Ember Dusk's harmony; phrase 2: the bass changed (the old chart
# was Dm F Gm:2 A7:2 Dm) — inversions, then the flat second against the
# dominant seventh, and no tonic
CH_A_ASH = chart('Dm Bbmaj7 C A F/A Bbmaj7/D Eb:2 A7:2 Eb/G:2 A7:2')
# B: the old chart (Bbmaj7 Csus4 C Am7 Dsus2 Dm Gm7 C F/A A) over first inversions
CH_B_ASH = chart('Bbmaj7/D Csus4:1.5 C:2.5 Am7/C Dsus2:1.5 Dm/F:2.5 Gm7/Bb C/E F/A A')
CH_C = chart('Dm Eb Dm Eb Bb C C B7')          # Ember Dusk's C strain, intact
CH_BUILD = chart('C D Bb A7')


def up(ch, n):
    """A chart transposed by n semitones (the A3 strain sits a step up, as in Act I)."""
    out = []
    for c, beats in ch:
        c2 = Chord(c.symbol)
        c2.root = (c.root + n) % 12
        c2.bass = (c.bass + n) % 12
        out.append((c2, beats))
    return out


CH_A3_ASH = up(CH_A_ASH, 2)

# drum grids, 16 steps per bar.
# A1 and A2 are Ashfall's: its half-time doom groove (kick on one and three,
# snare on three, the low tom on the offbeats), imported so it cannot drift;
# in A2 the ride takes the hat's quarters over to eighths. The rest are
# Ember Dusk's own patterns, which come back for B, C and A3's first phrase.
ASH_A1, ASH_A1_FILL = DOOM, DOOM_FILL
ASH_A2 = {**{k: v for k, v in DOOM.items() if k != 'hat'}, 'ride': 'X.x.x.x.X.x.x.x.'}
ASH_A2_FILL = {**DOOM_FILL, 'ride': 'X.x.x.x.X.......'}
# the low strings and the bass guitar lock to the doom kick (one, three,
# and-of-three): Ashfall's heavy unison ground, on Ember Dusk's chords
ASH_LOW = 'h e q.'
# Ashfall's tremolo pads, voiced by hand: under Bbmaj7/D the horns already
# hold the A against the B-flat, so the strings leave both out there
TREM_HI = {'Dm': 'F4 A4', 'Bbmaj7': 'F4 A4', 'C': 'E4 G4', 'A': 'E4 A4', 'F/A': 'F4 A4',
           'Bbmaj7/D': 'F4 A4', 'Eb': 'Eb4 Bb4', 'A7': 'G4 C#5', 'Eb/G': 'Eb4 Bb4'}
TREM_VA = {'Dm': 'A3 D4', 'Bbmaj7': 'A3 D4', 'C': 'G3 C4', 'A': 'A3 C#4', 'F/A': 'A3 C4',
           'Bbmaj7/D': 'F3 D4', 'Eb': 'G3 Bb3', 'A7': 'A3 E4', 'Eb/G': 'G3 Bb3'}


def voiced(part, bar, ch, table, vel):
    """Sustained chords from a chart with fixed voicings per chord symbol."""
    t = part.score.bar(bar)
    for c, beats in ch:
        for p in table[c.symbol].split():
            part.note(t, p, beats, vel=vel, rearticulate=True)
        t += beats
B_BEAT = {'kick': 'x.......x.x.....', 'rim': '........X.......', 'ride': 'X.x.x.x.X.x.x.x.'}
B_FILL = {'kick': 'x.......x.......', 'rim': '........X.......', 'tom_hi': '..........xx....',
          'tom_lo': '............xxXX'}
C_MARCH = {'kick': 'x.......x.......', 'snare': 'x.oox.o.x.oox.oo', 'tom_lo': '...x.......x....'}
A3_BEAT = {'kick': 'x.x...x.x.x...x.', 'rim': '....X.......X...', 'ride': 'X.x.X.x.X.x.X.x.',
           'ride_bell': 'x.......x.......'}
A3_FILL = {'kick': 'x.x...x.x.......', 'rim': '....X.......', 'snare': '............xxXX',
           'tom_lo': '..........xx....'}
# under the failing second phrase of A3 the kit thins to Ashfall's tom pulse
ASH_PULSE = {'kick': 'x...............', 'tom_lo': '........x.......'}


def kit_section(kit, start, n, beat, fill, fill_every=4, vel=0.74):
    for b in range(start, start + n):
        last = (b - start) % fill_every == fill_every - 1
        kit.play(b, fill if last else beat, vel=vel)


def build():
    s = Score('battle_act4_2', tonic='Db', bpm=144, intro_bars=4, loop_bars=44,
              title='Ember Dusk, in Ash', seed=97, transpose=-1)
    s.reverb = dict(rt60=2.8, predelay_ms=30, wet_db=0.0, damp=0.6)
    s.master = dict(lufs=-14.0, glue_ratio=1.5)
    calm_only = ['fl', 'ob', 'bsn', 'mel_calm', 'lowpad*', 'solo', 'ckit_*', 'c_pno']
    full_only = ['kit_*', 'ebass', 'tbn', 'tuba', 'lowbrass', 'hn_c', 'choir*', 'sub',
                 'hn_mel', 'stabs', 'riser', 'ost_vn', 'ost_hi', 'va', 'vc', 'cb', 'va_pad',
                 'mel_vn8', 'riff_vc', 'vc_mel', 'glock', 'hn', 'mel_vn', 'trem_*']
    s.variant('full', {p: None for p in calm_only}, lufs=-14.0)
    s.variant('calm', {**{p: None for p in full_only}, 'timp': -8, 'perc': -8, 'bells': -3,
                       'hn_intro': -4}, lufs=-17.0)

    # ================================================================ strings
    mel = s.part('mel_vn', 'violins', role='lead')
    mel.at(1).play('%trem @p [A4 D5]w~ | [A4 D5]w | rw | rw |')
    mel.expr((1, 0.3), (2.9, 0.95), (3, 0.9))
    mel.at(5).play('%sus @mf' + P1).play(P2_ASH)
    mel.at(13).play('@f' + P1).play(P2_ASH)
    mel.at(21).play('@ff' + MEL_B)
    mel.at(37).play('@ff' + P1, transpose=2).play(P2_ASH, transpose=2)
    mel.at(45).play('@f' + BUILD_VN)
    mel.expr((5, 0.78), (12.9, 0.85), (13, 0.9), (20.9, 0.95), (21, 0.95), (28.9, 1.0),
             (37, 1.0), (40.9, 1.0), (41, 0.8), (44.9, 0.9), (45, 0.7), (48.9, 1.0))

    # the octave doubling only knows the first phrase
    mel8 = s.part('mel_vn8', 'violins2', role='lead2')
    mel8.at(5).play('%sus @mf' + P1, transpose=-12)
    mel8.at(37).play('@ff' + P1, transpose=-10)

    ost = s.part('ost_vn', 'violins2', role='ostinato', art='spic', pan=-0.3)
    # A2: Ember Dusk's sixteenth grid, but its leaning accents (every third
    # note) are gone: the figure runs straight, a memory without its pulse
    arp(ost, 13, CH_A_ASH, '0 1 2 1', step=0.25, lo=62, hi=81, vel=0.56, accent_every=1,
        accent=0.1)
    arp(ost, 29, CH_C, '0 1 2 1', step=0.25, lo=57, hi=74, vel=0.6, accent_every=1)
    arp(ost, 45, CH_BUILD, '0 1 2 3', step=0.25, lo=60, hi=84, vel=0.62, accent_every=1)

    osth = s.part('ost_hi', 'violins', role='ostinato', art='spic')
    arp(osth, 29, CH_C, '2 1 0 1', step=0.25, lo=64, hi=84, vel=0.6, accent_every=1)
    arp(osth, 37, CH_A3_ASH[:4], '0 1 2 1', step=0.25, lo=64, hi=83, vel=0.62, accent_every=1)

    va = s.part('va', 'violas', role='ostinato', art='spic')
    acc8 = '> - - > - - > -'
    ostinato(va, 3, CH_INTRO[2:], 'e e e e e e e e', '0 1 2 1 0 1 2 1', lo=50, hi=67, vel=0.6)
    # A1, A2: no spiccato figure under the tune; Ashfall's tremolo upper
    # strings hold the chords instead (its A strain's voicing and registers)
    trem_hi = s.part('trem_hi', 'violins2', role='pad', art='trem')
    trem_va = s.part('trem_va', 'violas', role='pad', art='trem')
    for bar in (5, 13):
        voiced(trem_hi, bar, CH_A_ASH, TREM_HI, vel=0.55)
        voiced(trem_va, bar, CH_A_ASH, TREM_VA, vel=0.55)
    trem_hi.expr((5, 0.8), (12.9, 0.85), (13, 0.95), (20.9, 1.0))
    trem_va.expr((5, 0.8), (12.9, 0.85), (13, 0.95), (20.9, 1.0))
    ostinato(va, 29, CH_C, 'e e e e e e e e', '0 0 1 0 0 0 2 0', lo=50, hi=67, vel=0.62,
             accents=acc8)
    ostinato(va, 37, CH_A3_ASH[:4], 'e e e e e e e e', '0 1 2 1 0 1 2 1', lo=52, hi=69, vel=0.64,
             accents=acc8)
    va_pad = s.part('va_pad', 'violas', role='pad')
    pad(va_pad, 21, CH_B_ASH, n=2, lo=53, hi=67, vel=0.55, art='sus')
    # A3, second phrase: the violas hold the changed harmony alone, tremolo
    pad(va_pad, 41, CH_A3_ASH[4:], n=2, lo=53, hi=67, vel=0.5, art='trem')
    pad(va_pad, 45, CH_BUILD, n=2, lo=53, hi=67, vel=0.6, art='trem')

    vc = s.part('vc', 'celli', role='ostinato', art='spic')
    vc.at(1).play('%trem @p [D3 A3]w~ | [D3 A3]w |')
    vc.expr((1, 0.3), (2.9, 1.0), (3, 0.95))
    for bar, ch in ((3, CH_INTRO[2:]), (37, CH_A3_ASH[:4])):
        ostinato(vc, bar, ch, 'e e e e e e e e', 'b b b b b b b b', lo=38, hi=55, vel=0.64,
                 accents=acc8)
    for bar in (5, 13):
        bass(vc, bar, CH_A_ASH, ASH_LOW, 'b b b', floor=38, vel=0.66, art='sus',
             accents='> - >')
    # C: the whole low end plays the Empire's drill, exactly as in Act I
    riff = s.part('riff_vc', 'celli', role='lead2', art='sus')
    riff.at(29).play('@ff' + EMPIRE_C)
    vc_mel = s.part('vc_mel', 'celli', role='counter')
    vc_mel.at(21).play('%sus @f' + THREAD_B)
    vc_mel.at(41).play('%sus @mf ' + 'F2w | Bb2w | Eb2h A2h | Eb2h A2h |', transpose=2)
    vc_mel.at(45).play('%sus @f C3w | D3w | Bb2w | A2w |')

    cb = s.part('cb', 'basses', role='low')
    cb.at(1).play('%trem @p D2w~ | D2w |')
    cb.expr((1, 0.3), (2.9, 1.0), (3, 0.95))
    for bar, ch in ((3, CH_INTRO[2:]), (37, CH_A3_ASH[:4])):
        bass(cb, bar, ch, 'q q q q', 'b b b b', floor=26, vel=0.66, art='spic')
    for bar in (5, 13):
        bass(cb, bar, CH_A_ASH, ASH_LOW, 'b b b', floor=26, vel=0.68, art='sus',
             accents='> - >')
    cb.at(29).play('%sus @f' + EMPIRE_C, transpose=-12)
    bass(cb, 21, CH_B_ASH, 'w', 'b', floor=26, vel=0.64, art='sus')
    bass(cb, 41, CH_A3_ASH[4:], 'w', 'b', floor=26, vel=0.56, art='sus')
    bass(cb, 45, CH_BUILD, 'w', 'r', floor=26, vel=0.68, art='sus')

    # ================================================================ brass
    hn_intro = s.part('hn_intro', 'horns', role='pad')
    hn_intro.at(1).play('@mf A3h D4h | E4h A4h |')             # the thread, broad (Act I's intro)
    hn_intro.expr((1, 0.8), (2.9, 0.8))
    hn = s.part('hn', 'horns', role='pad')
    pad(hn, 5, CH_A_ASH, n=3, lo=50, hi=65, vel=0.5)
    pad(hn, 21, CH_B_ASH, n=2, lo=53, hi=67, vel=0.5)          # thinner than it was
    pad(hn, 45, CH_BUILD, n=3, lo=55, hi=69, vel=0.62)
    hn.expr((5, 0.65), (12.9, 0.7), (21, 0.7), (28.9, 0.9), (45, 0.55), (48.9, 1.0))

    hn_mel = s.part('hn_mel', 'horns', role='lead', pan=-0.2)
    # A2: the horns answer the first phrase and fall silent for the second
    hn_mel.at(13).play('@f' + P1_BR, transpose=-12).play(P2_SILENT)
    hn_mel.at(37).play('@ff' + P1_BR, transpose=-10)

    # Ember Dusk's trumpet stabs remember the first phrase with the horns and
    # fall silent with them for the second
    stabs = s.part('stabs', 'trumpets', role='accent', art='stac', pan=0.2)
    ostinato(stabs, 13, CH_A_ASH[:4], 'q. q. q', '1 1 2', lo=62, hi=76, vel=0.64)
    ostinato(stabs, 13, CH_A_ASH[:4], 'q. q. q', '0 0 1', lo=62, hi=76, vel=0.58)
    # beat-one hits where the B melody breathes (the same three, over the new bass)
    for bar, c in ((21, '[D4 F4 Bb4]'), (23, '[C4 E4 A4]'), (25, '[D4 G4 Bb4]')):
        stabs.at(bar).play(f'@f {c}q rq rh |')
    stabs.at(33).play('@f rq [D4 F4]q rq [D4 F4]q | rq [E4 G4]q rq [E4 G4]q |'
                      ' rq [E4 G4]q rq [E4 G4]q | rq [D#4 F#4]q [D#4 F#4]q [D#4 F#4]q |')

    tbn = s.part('tbn', 'trombones', role='pad')
    pad(tbn, 13, CH_A_ASH, n=2, lo=43, hi=60, vel=0.5)
    pad(tbn, 37, CH_A3_ASH[:4], n=2, lo=45, hi=62, vel=0.6)
    pad(tbn, 45, CH_BUILD, n=2, lo=45, hi=60, vel=0.64)

    low = s.part('lowbrass', 'trombones', role='lead')
    low.at(29).play('@ff' + EMPIRE_C)
    tuba = s.part('tuba', 'tuba', role='low')
    tuba.at(29).play('@ff' + EMPIRE_C, transpose=-12)
    bass(tuba, 37, CH_A3_ASH[:4], 'h h', 'b b', floor=29, vel=0.6)
    bass(tuba, 45, CH_BUILD, 'w', 'r', floor=29, vel=0.62)
    hn_c = s.part('hn_c', 'horns', role='lead2', pan=-0.35)
    hn_c.at(33).play('@ff' + EMPIRE_C_TOP)

    # ================================================================ choir
    # Only oohs under the Empire's strain. No voice sings the tune: "the choir
    # sings Ember Dusk" belongs to the Entity's finale.
    oohs = s.part('choir_oohs', 'oohs', role='choir')
    pad(oohs, 29, CH_C, n=3, lo=52, hi=69, vel=0.5)

    # ================================================================ percussion
    timp = s.part('timp', 'timpani', role='timp')
    timp.at(1).play('%roll @p D2w~ | D2w |')
    timp.expr((1, 0.25), (2.95, 1.0), (3, 1.0))
    timp.at(3).play('%default @f D2q rq rq D2e D2e | D2q rq A2q A2q |')
    for bar in (5, 13):
        timp.at(bar).play('@f D2q rq rh |')
    timp.at(21).play('@ff D2q rq rh |')
    timp.at(23).play('@f C3q rq rh |')
    timp.at(25).play('@f Bb2q rq rh |')
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

    # Ashfall's bells toll the tonic and fifth at every phrase of the tune, as
    # they toll every four bars in Ashfall (and nothing on the altered answer:
    # a tubular bell rings for six seconds, and a flat second there would hang
    # over the next strain; the second phrase's toll is caught by hand before
    # the flat-second chord arrives). A3 tolls its own key, a step up.
    bells = s.part('bells', 'bells', role='accent')
    for bar in (3, 5, 13):
        bells.at(bar).play('@mf D5h A4h |')
    for bar in (9, 17):
        bells.at(bar).play('%damp @mf D5h A4h | %default')
    bells.at(37).play('@mf E5h B4h |')

    kit = Kit(s, 'kit')
    kit.play(1, ASH_PULSE, vel=0.6)
    kit.play(2, ASH_PULSE, vel=0.62)
    kit.play(3, {'kick': 'x...x...x...x...', 'hat': 'x.x.x.x.x.x.x.x.'}, vel=0.7)
    kit.play(4, {'kick': 'x...x...x.......', 'snare': '........xxxxxxxx'}, vel=0.8, ramp=0.5)
    kit_section(kit, 5, 8, ASH_A1, ASH_A1_FILL)
    kit_section(kit, 13, 8, ASH_A2, ASH_A2_FILL)
    kit_section(kit, 21, 8, B_BEAT, B_FILL)
    kit_section(kit, 29, 8, C_MARCH, C_MARCH, fill_every=8)
    kit_section(kit, 37, 4, A3_BEAT, A3_FILL)
    for b in range(41, 45):
        kit.play(b, ASH_PULSE, vel=0.66)
    kit.play(45, {'kick': 'x.......x.......', 'tom_lo': 'x...x...x...x...'}, vel=0.66)
    kit.play(46, {'kick': 'x...x...x...x...', 'tom_lo': 'x.x.x.x.x.x.x.x.'}, vel=0.7)
    kit.play(47, {'kick': 'x...x...x...x...', 'snare': 'x.x.x.x.xxxxxxxx'}, vel=0.72, ramp=0.4)
    kit.play(48, {'kick': 'x...x...x.x.x.x.', 'snare': 'xxxxxxxxxxxxxxxx'}, vel=0.84, ramp=0.5)
    for b in (5, 13, 21, 37):
        kit.play(b, {'crash': 'X'})
    for b in (9, 17, 25):
        kit.play(b, {'crash2': 'x'})
    kit.play(36, {'tom_hi': '........x.x.', 'tom_lo': '............xxXX'})

    # the glockenspiel remembers one reach of the B strain, then nothing
    glock = s.part('glock', 'glock', role='accent')
    glock.at(21).play('@mf rq F6e Bb6e C7q F7q | rw |')

    # ================================================================ rhythm section
    # (floor 29, not 28: the score renders a semitone down and the bass
    # guitar's lowest note is E1)
    eb = s.part('ebass', 'rbass', role='bass', duck='kit_kick')
    bass(eb, 3, CH_INTRO[2:], 'e e e e e e e e', 'r r r r r r 8 r', floor=29, vel=0.72)
    for bar in (5, 13):
        bass(eb, bar, CH_A_ASH, ASH_LOW, 'b b 8', floor=29, vel=0.76, accents='> - >')
    bass(eb, 37, CH_A3_ASH[:4], 'e e e e e e e e', 'b b b b b b 8 b', floor=29, vel=0.74,
         accents='> - - > - - > -')
    bass(eb, 21, CH_B_ASH, 'q. e h', 'b b 5', floor=29, vel=0.72)
    eb.at(29).play('@f' + EMPIRE_C, transpose=-12)
    bass(eb, 41, CH_A3_ASH[4:], 'w', 'b', floor=29, vel=0.6)
    bass(eb, 45, CH_BUILD, 'e e e e e e e e', 'r r r r r r r r', floor=29, vel=0.72)

    sub = s.part('sub', 'sub', role='sub')
    for bar, ch in ((5, CH_A_ASH), (13, CH_A_ASH), (21, CH_B_ASH), (37, CH_A3_ASH),
                    (45, CH_BUILD)):
        bass(sub, bar, ch, 'w', 'b', floor=26, vel=0.6)

    riser = s.part('riser', 'riser', role='fx')
    riser.note(s.bar(35), 60, 8, vel=0.7)
    riser.note(s.bar(47), 60, 8, vel=0.7)
    riser.note(s.bar(19), 60, 8, vel=0.5)

    # ================================================================ calm-only layer
    # The tune alone, remembered: one voice over a low string bed and the
    # heartbeat. No piano, no harp, no inner pad.
    solo = s.part('solo', 'solo_violin', role='lead')
    solo.at(5).play('@mf' + P1).play(P2_ASH)
    solo.at(37).play('@f' + P1, transpose=2).play(P2_ASH, transpose=2)
    solo.expr((5, 0.8), (12.9, 1.0), (37, 0.9), (44.9, 1.0))
    ob = s.part('ob', 'oboe', role='lead')
    ob.at(13).play('@mf' + P1_BR).play(P2_ASH_BR)
    ob.at(33).play('@mf' + EMPIRE_C_TOP, transpose=12)
    fl = s.part('fl', 'flute', role='lead2')
    fl.at(37).play('@mf' + P1_BR, transpose=2)
    mel_c = s.part('mel_calm', 'violins', role='lead', art='soft')
    mel_c.at(21).play('@mf' + MEL_B)
    bsn = s.part('bsn', 'bassoon', role='counter')
    bsn.at(29).play('@mf' + EMPIRE_C)
    c_pno = s.part('c_pno', 'grand', role='keys')
    arp(c_pno, 45, CH_BUILD, '0 1 2 3 4 5 6 7', step=0.5, lo=48, hi=86, vel=0.5)
    arp(c_pno, 3, CH_INTRO[2:], '0 2 4 2', step=1.0, lo=50, hi=74, vel=0.42)
    lowp = s.part('lowpad', 'celli', role='bass', art='soft')
    lowpb = s.part('lowpad_cb', 'basses', role='low', art='soft')
    for bar, ch in ((5, CH_A_ASH), (13, CH_A_ASH), (21, CH_B_ASH), (29, CH_C), (37, CH_A3_ASH),
                    (45, CH_BUILD)):
        bass(lowp, bar, ch, 'h h', 'b 5', floor=38, vel=0.5, art='soft')
        bass(lowpb, bar, ch, 'w', 'b', floor=26, vel=0.5, art='soft')
    kc = Kit(s, 'ckit', gains={'kick': -4})
    for b in list(range(5, 29)) + list(range(37, 45)):
        kc.play(b, {'kick': 'x.......x.......'}, vel=0.42)
    return s
