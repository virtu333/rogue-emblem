"""Act IV battle III — "The Name Is Not Spoken".

The ritual spent the goddess's name. The ashen capital still chants the
Empire's public creed; the one tune that stands for a person is never sung.
B minor, fast (176), in 3/4 until the creed becomes an anthem in 4/4.

The personal tune is only ever instrumental. It calls across an octave (F#
to F#), answers down the scale, and in its second phrase climbs through the
Dorian G-sharp, A and A-sharp to the leading tone, where it stops: the Hollow
Sun, the spent name. It never arrives on B. Each time it returns it is a new
colour in a new key, and the band gets there first: a bar of the new key's
ostinato, the timpani striking its tonic, before the tune comes in: the
clarinet in B minor (over the intro's drone), the piano in D minor (bar 37),
the horns in E minor (bar 54). The band does not stop for it: a bar where only
the bass is left would be the stop bar The Emperor's Own owns in the same act.

The choir sings only the public chant: one syllable on every quarter, a
narrow creed that ends on its tonic as the tune cannot, over a marcato
ostinato that alternates on and off the beat inside the 3/4 bar (attacks
on 1, 1.75, 2.25, 3 and 3.25; the kit splits it, the kick on the beat and
the snare off it). The men and the women answer each other line by line
(men, women, men, then everyone), the violas doubling the line under them.
The chant enters on the bar where the tune's tonic should have been: the
crowd says what the name cannot.

Under T3's last climb the city falls back, then falls into step: the low
strings and the kit drop the syncopated ostinato for plain quarters, which
the 4/4 simply regroups, while the low brass swell on the held B major and,
on the anthem's downbeat, the same players turn it minor (D-sharp to D).

The anthem (4/4) is the creed made public, and its tune is the crowd's, not
the person's: the chant's own syllables, a quarter each, and like the chant's
lines each motto opens on a repeated note; but where the chant steps down from
it, the anthem climbs, through the chant's turn on its own notes (B B C# D |
E F# D; the men sing D E F# where the chant did). It starts on B, climbs three
times and ends on B, the note the personal tune never reaches. Under it, an
eight-bar modal cycle, i - VI - VII - i - IV (E major, the Dorian colour) - IV
- a bass that walks up by semitones under a held E major (G#, A, A#) - i. The
walk-up is its only leading tone. Where the motto climbs off its repeated B
(and E), the bass steps down a tone and back, so the climbing notes sit a
tenth above it (A under C#, B under D; D under F#, E under G#) rather than
doubling it in octaves. It is built in three blocks,
each entering on a downbeat: the low instruments with the men (a tenor
trombone on their line); then everything else with the women (brass, strings,
snare rolls, the gong); then the high winds. The loudest music is not the
last: the third block falls away in its last bars, and the loop turns on the
personal tune alone.

After *Id (Purpose)*'s medley arrangement, as verified (refscores/id_purpose.md
sections 2-5): the instrumental tune through keys and colours, the chant
over an on/off marcato ostinato, the move from 3/4 to 4/4 for the anthem,
the three-block build, the cycle's chromatic bass approach, and the
decrescendo back to the tune. No melody is taken from it.

Form (bars; 3/4 unless marked; 176): intro 1-4 | T1 5-20 (clarinet, B minor:
eight bars alone over a B drone, then the ostinato and the toms gather) |
chant 21-36 | D bass 37 | T2 38-53 (piano, D minor, in two octaves) | E bass 54 | T3 55-70
(horns, E minor, violins in long notes above; 67-70 the climb, the city
falling back and then into step) | anthem 71-94 in 4/4 (block one 71-78,
block two 79-86, block three 87-94, falling away from 91). Loop 5-94.

The semitones lint reports are passing notes of the tune, the chant and the
anthem's motto (a quarter each: the motto's F-sharp over G in bars 72, 80 and
88 is VI's major seventh on a weak beat), and the walk-up's A and A-sharp
under the held E major, which is the point of it.

Leitmotif: the Hollow Sun (the personal tune). No Thread: the tune is the
goddess's, not Sera's.

calm: the same form heard from a side street: the ostinato plucked
(pizzicato celli and basses on the beat, harp off it), the tune in the same
colours but softer, the chant and the anthem hummed far off (oohs), a flute
for the third block; no kit.
"""

from engine.patterns import Kit, arp, bass, chart, drums, pad
from engine.score import Score
from engine.theory import pitch as P

from scores._battle import Battle

KEY = 'music_battle_act4_3'

# ------------------------------------------------------------------ material
# the personal tune (B minor): the call across an octave, the answer down the
# scale; the second phrase climbs to the leading tone and stops there
TUNE = """
F#4q F#5h | E5q D5q C#5q | D5h. | E5q F#5q G5q | F#5h. | E5q D5q C#5q | D5q C#5q A4q | C#5h. |
F#4q F#5h | G5q F#5q E5q | F#5h. | E5q F#5q G5q | G#5h. | A5h. | A#5h.~ | A#5h. |
"""
CH_TUNE = 'Bm A G Em D A F#m A Bm Em D C E D F# F#'

# the public creed: one syllable a quarter, a narrow line that ends on its tonic
CHANT = """
F#4q F#4q E4q | D4q E4q F#4q | B4q A4q G4q | F#4h. |
F#4q F#4q E4q | D4q E4q F#4q | G4q F#4q E4q | D4h. |
D4q D4q C#4q | B3q C#4q D4q | G4q F#4q E4q | D4h. |
F#4q G4q A4q | B4q A4q G4q | F#4q E4q C#4q | B3h. |
"""
CH_CHANT = 'Bm Bm G Bm Bm Bm Em Bm D Bm Em Bm D G A Bm'
CHANT_BARS = [x.strip() + ' |' for x in CHANT.strip().rstrip('|').split('|')]


def chant_phrase(k):
    """The chant's k-th four-bar line (0-3)."""
    return ' '.join(CHANT_BARS[4 * k:4 * k + 4])


# the anthem (4/4, the women's octave; the men sing it an octave down): the
# chant made public. Its syllables stay a quarter each, and like three of the
# chant's four lines each motto opens on a repeated note; but where the chant
# steps down from it, the anthem climbs (bars 1-2 pass through the chant's own
# turn, D E F-sharp, on its notes). It starts on the tonic, climbs three times and ends on
# it: the crowd owns the note the personal tune never reaches, and shares none
# of its shape. (Not a dotted march head: that is the Emperor's anthem, which
# his guard's standard already turns minor in the same act.)
ANTHEM = """
B4q B4q C#5q D5q | E5q F#5q D5h | C#5q C#5q D5q E5q | F#5w |
E5q E5q F#5q G#5q | A5h G#5h | F#5h E5h | B4w |
"""
ANTHEM_BARS = [x.strip() + ' |' for x in ANTHEM.strip().rstrip('|').split('|')]


def anthem_upto(n):
    """The anthem's first n bars (block three's voices leave one by one)."""
    return ' '.join(ANTHEM_BARS[:n])


# the cycle: i VI VII i IV IV, the walk-up under a held E major, i. Where the
# motto climbs off its repeated tonic (bars 1 and 5) the bass steps down and
# back under it, so the climbing notes sound a tenth above the bass (A under
# C-sharp, B under D; D under F-sharp, E under G-sharp) instead of doubling it
# in octaves; in bar 3 it falls against the climb (A, F-sharp, E)
CH_ANTHEM = chart('Bm:2 A:1 Bm:1 G A:2 D/F#:1 A/E:1 Bm E:2 D:1 E:1 Esus4:2 E:2 '
                  'E/G#:2 E/A:1 E/A#:1 Bm')
ANTHEM_BASS = [('B', 'B', 'A', 'B'), 'G', ('A', 'A', 'F#', 'E'), 'B', ('E', 'E', 'D', 'E'), 'E',
               ('G#', 'G#', 'A', 'A#'), 'B']

# The GeneralUser 'Choir Aahs' samples are out of tune by zone, and their pitch
# drifts inside a note (C#3-D3 start near true and sink 45 cents; F#3-A3 start
# 40 cents flat). The correction is fitted to this score's own notes: every
# choir note rendered alone at its own length and dynamic, its pitch measured
# over the note body (harmonic sum, 0.3 s windows), averaged per key weighted by
# duration, separately for the short notes and the held ones; the 'oohs'
# program reads within 2 cents by the same method. It is applied as a pitch
# bend on each note of the choir's single lines (render key_cents).
CHOIR_AAH_CENTS = {47: 39, 49: 6, 50: 5, 52: -6, 54: -39, 55: -39, 57: -40, 59: 30, 61: 12,
                   62: 12, 64: 16, 66: 17, 67: 17, 68: 2, 69: 2, 71: 1, 73: -6, 74: -6,
                   76: 25, 78: 5, 80: 4}
CHOIR_FIX = {k: -v for k, v in CHOIR_AAH_CENTS.items()}
# ...and for the held notes (0.6 s and longer), which sit in the samples' sustain
CHOIR_AAH_CENTS_LONG = {47: 31, 50: -25, 54: -6, 59: -2, 62: 0, 64: 13, 66: 9, 68: -3, 69: -3,
                        71: 0, 74: -5, 76: 0, 78: 4, 80: 9, 81: 3}
CHOIR_FIX_LONG = {k: -v for k, v in CHOIR_AAH_CENTS_LONG.items()}

# the marcato ostinato inside a 3/4 bar: on, off, off, on, off
OST_AT = (0.0, 0.75, 1.25, 2.0, 2.25)
OST_DUR = (0.75, 0.25, 0.5, 0.25, 0.25)
OST_ON = (True, False, False, True, False)

# kit, 12 steps a 3/4 bar: the kick takes the ostinato's on-beat attacks, the
# snare its off-beat ones
CITY = {'kick': 'x.......x...', 'snare': '...x.x...x..', 'hat': 'x.x.x.x.x.x.'}
CITY_FILL = {'kick': 'x.......x...', 'snare': '...x.x..xxXX', 'hat': 'x.x.x.x.....'}
CITY_RIDE = {'kick': 'x.......x...', 'snare': '...x.x...x..', 'ride': 'X.x.x.X.x.x.'}
GATHER = {'kick': 'x...........', 'tom_lo': '...x.x...x..'}
# the anthem, 16 steps a 4/4 bar
BLOCK1 = {'kick': 'x...x...x...x...', 'snare': '....o.......o...', 'hat': 'x.x.x.x.x.x.x.x.'}
BLOCK2 = {'kick': 'x...x...x...x...', 'snare': '....X.......X...', 'hat': 'x.x.x.x.x.x.x.x.'}
BLOCK2_ROLL = {'kick': 'x...x...x...x...', 'snare': '....X...xxxxXXXX', 'hat': 'x.x.x.x.........'}
BLOCK3 = {'kick': 'x...x...x...x...', 'snare': '....X.......X...', 'ride': 'X.x.X.x.X.x.X.x.'}


def ch3(text, shift=0):
    """A chart of one chord per 3/4 bar, optionally transposed by `shift`."""
    names = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
    sharp = {'C#': 'Db', 'D#': 'Eb', 'F#': 'Gb', 'G#': 'Ab', 'A#': 'Bb'}
    out = []
    for sym in text.split():
        if shift:
            root = sym[:2] if len(sym) > 1 and sym[1] in '#b' else sym[:1]
            rest = sym[len(root):]
            pc = names.index(sharp.get(root, root))
            sym = names[(pc + shift) % 12] + rest
        out.append(sym + ':3')
    return chart(' '.join(out))


def ostinato3(part, bar, ch, lo, vel=0.7, art=None, fifth=False, octave=False, on_only=False,
              accent=0.12):
    """The marcato ostinato over a 3/4 chart: the chord root (and its fifth, or
    octave) on 1, 1.75, 2.25, 3 and 3.25; the on-beat attacks accented."""
    t = part.score.bar(bar)
    for c, beats in ch:
        root = c.bass_note(lo)
        for off, d, on in zip(OST_AT, OST_DUR, OST_ON):
            if on_only and not on:
                continue
            v = min(1.0, vel + (accent if on else 0.0))
            ps = [root]
            if fifth:
                ps.append(root + 7)
            if octave:
                ps.append(root + 12)
            for p in ps:
                part.note(t + off, p, d, vel=v, art=art, rearticulate=True)
        t += beats


def offbeats(part, bar, ch, lo, hi, vel=0.6, art=None, n=3):
    """The ostinato's off-beat attacks (1.75, 2.25, 3.25) as short chords."""
    from engine.theory import voice_lead
    t = part.score.bar(bar)
    prev = None
    for c, beats in ch:
        v = voice_lead(prev, c, n, lo, hi)
        prev = v
        for off, d, on in zip(OST_AT, OST_DUR, OST_ON):
            if on:
                continue
            for p in v:
                part.note(t + off, p, d, vel=vel, art=art, rearticulate=True)
        t += beats


def stagger(part, bar, ch, lo, hi, vel=0.5, pattern='0 1 2 3 2 1'):
    """The fast layer: running sixteenths through the chord, played loosely
    (the part's humanise is wide), a shimmer rather than a figure."""
    arp(part, bar, ch, pattern, step=0.25, lo=lo, hi=hi, vel=vel)


def anthem_bass(part, bar, vel=0.72, art=None, lo='B1'):
    """Staccato quarters on the cycle's bass, one per beat; bar 7 walks up.
    Each bar starts at or above `lo`; inside a bar each note is the octave
    nearest the last (bar 1's A steps down under the motto, not up a seventh)."""
    s = part.score
    base = P(lo)
    for i, b_ in enumerate(ANTHEM_BASS):
        t = s.bar(bar + i)
        notes = b_ if isinstance(b_, tuple) else (b_,) * 4
        prev = None
        for k, name in enumerate(notes):
            p = base + ((P(name + '1') - base) % 12)
            if prev is not None:
                p = prev + ((p - prev + 6) % 12) - 6
            prev = p
            part.note(t + k, p, 0.5, vel=vel + (0.08 if k == 0 else 0.0), art=art)


def build():
    s = Score('battle_act4_3', tonic='B', bpm=176, meter=(3, 4), intro_bars=4, loop_bars=90,
              title='The Name Is Not Spoken', seed=733)
    s.meter_change(71, (4, 4))
    # a drier hall than the slower tracks: at 176 the ostinato's off-beats
    # smeared into one another under a 2.6 s tail (a listener heard it as mud)
    s.reverb = dict(rt60=2.1, predelay_ms=28, wet_db=-1.5, damp=0.6)
    s.master = dict(lufs=-14.0, glue_ratio=1.6)
    b = Battle(s, calm_lufs=-17.0, full_lufs=-14.0)
    CH_T1 = ch3(CH_TUNE)
    CH_T2 = ch3(CH_TUNE, 3)           # D minor
    CH_T3 = ch3(CH_TUNE, 5)           # E minor
    b.section('intro', 1, ch3('Bm Bm Bm Bm')).section('T1', 5, CH_T1)
    b.section('chant', 21, ch3(CH_CHANT)).section('Dbar', 37, ch3('Dm'))
    b.section('T2', 38, CH_T2).section('Ebar', 54, ch3('Em')).section('T3', 55, CH_T3)
    b.section('A1', 71, CH_ANTHEM).section('A2', 79, CH_ANTHEM).section('A3', 87, CH_ANTHEM)

    # ================================================================ the personal tune
    # never sung: clarinet, then piano, then horns; each a new key
    cl = b.part('t_cl', 'clarinet', role='lead', calm_db=3, gain=-5)
    cl.at(5).play('@mp' + TUNE)
    # alone, it is quiet; it grows only as the city gathers under it
    cl.expr((5, 0.62), (12.9, 0.68), (16, 0.8), (20.9, 1.0))
    pno = b.part('t_pno', 'grand', role='lead', calm_db=0, gain=2)
    pno.at(38).play('@f' + TUNE, transpose=3)
    pno.at(38).play('@f' + TUNE, transpose=3 + 12)       # and an octave up, where it rings
    # (the horns sing low, B3-D#5, right where the ostinato sits: less body, more edge)
    hn = b.part('t_hn', 'horns', role='lead', calm_db=0,
                eq=[('peak', 280, 1.0, -3.5), ('peak', 1800, 1.0, 3.0)])
    hn.at(55).play('@f' + TUNE, transpose=5 - 12)

    # ================================================================ the drone and heartbeat
    # T1's first phrase: the tune alone over a B that does not move
    drone = b.part('drone', 'basses', role='low', art='sus', calm_db=0, gain=-3)
    drone.at(1).play('@p B1h.~ | B1h.~ | B1h.~ | B1h. |')
    drone.at(5).play('@p ' + 'B1h.~ | ' * 7 + 'B1h. |')
    drone.expr((1, 0.6), (4.9, 0.7), (5, 0.7), (12.9, 0.85))
    timp = b.part('timp', 'timpani', role='timp', calm_db=-5)
    for bar in list(range(1, 5)) + list(range(5, 13)):
        timp.at(bar).play('@mp B2q rh |' if bar % 2 else '@p B2q rh |')

    # ================================================================ the ostinato
    # marcato, on and off the beat: trombones on the chord's root and fifth,
    # celli and basses on the root, the bass guitar on the beat only (no horns:
    # staccato horns under the chant added body and nothing a listener could hear)
    o_tbn = b.part('ost_tbn', 'trombones', layer='full', role='section', art='stac', pan=0.3)
    o_vc = b.part('ost_vc', 'celli', layer='full', role='ostinato', art='spic')
    o_cb = b.part('ost_cb', 'basses', layer='full', role='low', art='spic')
    eb = b.part('ebass', 'rbass', layer='full', role='bass', duck='kit_kick',
                eq=[('peak', 260, 0.8, -4.0)])
    spans = [(13, CH_T1[8:]), (21, ch3(CH_CHANT)), (37, ch3('Dm')), (38, CH_T2), (54, ch3('Em')),
             (55, CH_T3)]
    for bar, ch in spans:
        # (the celli on the root alone: their octave doubled every other part's middle)
        ostinato3(o_vc, bar, ch, lo=38, vel=0.66, art='spic')
        ostinato3(o_cb, bar, ch, lo=28, vel=0.66, art='spic')
        ostinato3(eb, bar, ch, lo=28, vel=0.72, on_only=True)
    for bar, ch in spans[1:-1]:
        ostinato3(o_tbn, bar, ch, lo=45, vel=0.66, art='stac', fifth=True)
    # T3: the brass ostinato on the root alone, under the horns' tune, and it
    # leaves before the tune's climb (bars 67-70)
    ostinato3(o_tbn, 55, CH_T3[:12], lo=45, vel=0.6, art='stac')
    # T1, second phrase: the ostinato gathers (celli and basses only, rising)
    for part in (o_vc, o_cb, eb):
        part.expr((12.9, 0.4), (13, 0.4), (20.9, 1.0), (21, 1.0))

    # the fast layer, loose sixteenths (chant, T2, T3)
    stg = b.part('stagger', 'violins2', layer='full', role='ostinato', art='spic', pan=-0.35,
                 humanize_ms=16)
    # (not under the piano in T2: the piano is its own shimmer)
    for bar, ch in ((21, ch3(CH_CHANT)), (55, CH_T3[:12])):
        stagger(stg, bar, ch, lo=66, hi=86, vel=0.5)

    # sustained harmony under the tune (T2, T3) and the chant
    pv = b.part('pad_va', 'violas', layer='full', role='pad', art='sus')
    # (not under T3: the horns' tune lies in the violas' register)
    for bar, ch in ((21, ch3(CH_CHANT)), (38, CH_T2)):
        pad(pv, bar, ch, n=2, lo=52, hi=65, vel=0.5)
    # T3: the violins above the horns, in long notes
    vn_hi = b.part('t3_vn', 'violins', layer='full', role='counter', art='sus')
    vn_hi.at(55).play('@mf B5h. | A5h. | G5h. | A5h. | B5h. | A5h. | F#5h. | A5h. |'
                      ' B5h. | C6h. | B5h. | A5h. | A5h. | B5h. | B5h.~ | B5h. |')

    # ================================================================ the chant
    # a crowd, not a metronome: loose timing, a second vowel in the middle
    # of it, the downbeats leaned on and every four-bar line pushed to its end
    # (the sampled 'aah' is thick around 900 Hz: scooped there, lifted for
    # presence, so the voices read through the tutti)
    vox_eq = [('peak', 850, 1.0, -3.5), ('peak', 3000, 1.0, 2.0)]
    ch_w = b.part('choir_w', 'choir', layer='full', role='lead', pan=-0.1, humanize_ms=18,
                  eq=vox_eq, key_cents=CHOIR_FIX)
    ch_m = b.part('choir_m', 'choir', layer='full', role='lead2', pan=0.1, humanize_ms=18,
                  eq=vox_eq, key_cents=CHOIR_FIX, hpf=110)
    ch_x = b.part('choir_x', 'oohs', layer='full', role='choir', gain=-4, humanize_ms=26)
    # one syllable a quarter, every note re-struck; the men and the women
    # answer each other line by line (men, women, men, then everyone)
    for k in (0, 2, 3):
        ch_m.at(21 + 4 * k).play('@f ' + chant_phrase(k), transpose=-12)
    for k in (1, 3):
        ch_w.at(21 + 4 * k).play('@f ' + chant_phrase(k))
    ch_x.at(21).play('@mf' + CHANT)
    for part in (ch_w, ch_m, ch_x):
        for n in part.notes:
            n.rearticulate = True
            if s.on_barline(n.start):
                n.vel = min(1.0, n.vel + 0.1)
        part.expr((21, 0.8), (24.95, 1.0), (25, 0.8), (28.95, 1.0), (29, 0.8), (32.95, 1.0),
                  (33, 0.85), (36.95, 1.0))
    # the city's strings under the crowd: the chant, legato, in the violas
    ch_va = b.part('chant_va', 'violas', layer='full', role='counter', art='sus', gain=-2,
                   eq=[('peak', 280, 1.0, -2.5)])
    ch_va.at(21).play('@f' + CHANT)
    ch_va.expr((21, 0.8), (24.95, 1.0), (25, 0.8), (28.95, 1.0), (29, 0.8), (32.95, 1.0),
               (33, 0.85), (36.95, 1.0))

    # ================================================================ the anthem (4/4)
    # block one (71): the low instruments and the men
    ch_m.at(71).play('@f' + ANTHEM, transpose=-12)
    ch_m.at(79).play('@ff' + ANTHEM, transpose=-12)
    ch_m.at(87).play('@ff' + ANTHEM, transpose=-12)
    for sec in ('A1', 'A2', 'A3'):
        anthem_bass(o_vc, b.bar(sec), vel=0.7, art='spic', lo='B2')
        anthem_bass(o_cb, b.bar(sec), vel=0.7, art='spic', lo='B1')
        anthem_bass(eb, b.bar(sec), vel=0.74, lo='B1')
    # the last bar: the low strings stop marching and hold the B the tune's
    # drone will take over; the bass guitar is gone
    for part in (o_vc, o_cb, eb):
        part.notes[:] = [n for n in part.notes if n.start < s.bar(94) - 1e-6]
    o_vc.at(94).play('%sus @mp [B2 F#3]w |')
    o_cb.at(94).play('%sus @mp B1w |')
    # the anthem's downbeat is heavy: low brass, timpani, crash and drum (the
    # boom takes the low B: the trombones stop at E2)
    hit_b = b.part('an_hit', 'trombones', layer='full', role='accent', art='stac', gain=3)
    for p_ in 'B2 F#3 B3 D4'.split():
        hit_b.note(s.bar(71), P(p_), 1.0, vel=0.92, art='stac', rearticulate=True)
    tuba = b.part('tuba', 'tuba', layer='full', role='low')
    low_tbn = b.part('an_tbn', 'trombones', layer='full', role='pad')
    # (written out: the tuba's lowest samples, E1 and G1, are out of tune, so
    # its E and G sit an octave up; the walk-up stays low). Under the motto's
    # climbs it steps down and back with the bass, a tenth under the tune
    for sec in ('A1', 'A2', 'A3'):
        tuba.at(b.bar(sec)).play('@mf B1h A1q B1q | G2w | A1h F#2q E2q | B1w | E2h D2q E2q |'
                                 ' E2w | G#1h A1q A#1q | B1w |')
        pad(low_tbn, b.bar(sec), CH_ANTHEM, n=2, lo=47, hi=60, vel=0.55)
    # the men's tune has a brass edge: a tenor trombone with them (block one)
    euph = b.part('an_tbn_mel', 'trombones', layer='full', role='lead', pan=0.2,
                  eq=[('peak', 300, 1.0, -3.0), ('peak', 1500, 1.0, 2.0)])
    euph.at(71).play('@f' + ANTHEM, transpose=-12)
    for n in tuba.notes + low_tbn.notes:
        if n.start >= s.bar(94) - 1e-6:
            n.vel *= 0.8
    # block one's fast layer: the piano's sixteenths
    pno_run = b.part('an_pno', 'grand', layer='full', role='keys')
    # (above the men and the trombone, not among them)
    arp(pno_run, 71, CH_ANTHEM, '0 1 2 3 2 1 2 3', step=0.25, lo=62, hi=84, vel=0.5)
    # block two (79): everything else, and the women
    ch_w.at(79).play('@ff' + ANTHEM)
    vn = b.part('an_vn', 'violins', layer='full', role='lead2', art='sus', gain=2)
    vn.at(79).play('@f' + ANTHEM, transpose=12)
    hn_ch = b.part('an_hn', 'horns', layer='full', role='pad')
    tpt = b.part('an_tpt', 'trumpets', layer='full', role='lead2')
    # the horns hold only block two's first chord of each line, then leave the
    # middle to the voices
    for bar in (79, 83, 87):
        pad(hn_ch, bar, CH_ANTHEM[:1], n=3, lo=53, hi=69, vel=0.6)
    tpt.at(79).play('@f' + ANTHEM)
    stagger(stg, 79, CH_ANTHEM, lo=67, hi=88, vel=0.54, pattern='0 1 2 3')
    stagger(stg, 87, CH_ANTHEM[:4], lo=67, hi=88, vel=0.54, pattern='0 1 2 3')
    # (no viola pad in blocks two and three: the choir holds the middle)
    low_tbn.expr((5, 1.0), (78.95, 1.0), (79, 0.8), (90.9, 0.8), (94.9, 0.5))
    # block three (87): the high winds; the peak is its first four bars
    fl = b.part('an_fl', 'flute', layer='full', role='lead2')
    ob = b.part('an_ob', 'oboe', layer='full', role='lead2')
    picc = b.part('an_picc', 'piccolo', layer='full', role='accent', gain=-4)
    # the loudest music is not the last: from bar 91 the voices leave one by
    # one (winds and trumpets, then the violins, then the women and horns),
    # until the men and the low strings hold B minor alone, and the tune's
    # drone takes it over
    fl.at(87).play('@f ' + anthem_upto(4), transpose=12)
    ob.at(87).play('@f ' + anthem_upto(4))
    picc.at(87).play('@mf ' + anthem_upto(4), transpose=12)
    tpt.at(87).play('@ff ' + anthem_upto(4))
    vn.at(87).play('@ff ' + anthem_upto(6), transpose=12)
    ch_w.at(87).play('@ff ' + anthem_upto(7))
    fall = [(5, 1.0), (86.95, 1.0), (90.9, 1.0), (94.9, 0.6)]
    for p in (pv, tuba, o_vc, o_cb):
        p.expr(*fall)
    # the men step back a little once the women carry the tune
    ch_m.expr((5, 1.0), (78.95, 1.0), (79, 0.85), (90.9, 0.85), (94.9, 0.6))
    # and each voice that leaves fades on its last notes
    for p, last in ((fl, 90), (ob, 90), (picc, 90), (tpt, 90), (stg, 90), (vn, 92), (ch_w, 93)):
        p.expr((5, 1.0), (last - 0.05, 1.0), (last + 0.95, 0.3), (last + 0.99, 1.0))
    # the held notes of each choir line get their own tuning: the samples drift
    # inside a note, so a quarter and a whole note on one key need different
    # corrections (same sound, same lane, two parts)
    for short, long_name in ((ch_w, 'choir_w_long'), (ch_m, 'choir_m_long')):
        lp = b.part(long_name, 'choir', layer='full', role=short.opts['role'],
                    pan=short.opts['pan'], humanize_ms=18, eq=vox_eq, key_cents=CHOIR_FIX_LONG,
                    **({'hpf': short.opts['hpf']} if 'hpf' in short.opts else {}))
        keep = []
        for n in short.notes:
            held = s.seconds(n.start + n.dur) - s.seconds(n.start) >= 0.6
            (lp.notes if held else keep).append(n)
        short.notes[:] = keep
        lp.expr_points = list(short.expr_points)

    # ================================================================ drums
    b.kit = Kit(s, 'kit', gains={'kick': 0.5, 'snare': 1.0})
    # the snare speaks three times a bar at 176: its crack, not its body
    s.parts['kit_snare'].opts['eq'] = [('peak', 220, 1.0, -3.0), ('peak', 900, 1.0, -2.0),
                                       ('peak', 5000, 0.8, 3.0)]
    b.full_only.update(b.kit.names())
    # the toms gather with the ostinato (13-20), rising with it; T1's first
    # phrase (5-12) stays the clarinet's alone
    for bar in range(13, 21):
        b.kit.play(bar, GATHER, vel=0.45 + 0.036 * (bar - 13))
    b.kit.play(20, {'snare': '......xxxXXX'}, vel=0.7, ramp=0.5)
    for start, n in ((21, 16), (37, 17), (54, 13)):
        for i in range(n):
            grid = CITY_RIDE if start == 54 else CITY
            b.kit.play(start + i, CITY_FILL if i % 8 == 7 else grid, vel=0.74)
        b.kit.play(start, {'crash': 'X'})
    # T3's climb: the kit falls back (67-68), then falls into step with the
    # low strings (69-70): plain quarters, which the 4/4 simply regroups
    for bar in (67, 68):
        b.kit.play(bar, {'kick': 'x.......x...', 'hat': 'x...x...x...'}, vel=0.58)
    b.kit.play(69, {'kick': 'x...x...x...', 'hat': 'x.x.x.x.x.x.', 'snare': '........x...'},
               vel=0.64, ramp=0.3)
    b.kit.play(70, {'kick': 'x...x...x...', 'snare': 'x...x...xxxx', 'hat': 'x.x.x.x.....'},
               vel=0.78, ramp=0.4)
    # the low strings and the bass guitar drop the chant's rhythm for the
    # anthem's (69-70)
    for part, p_, art in ((o_vc, ('B2', 'B3'), 'spic'), (o_cb, ('B1',), 'spic'),
                          (eb, ('B1',), None)):
        part.notes[:] = [n for n in part.notes
                         if not (s.bar(69) - 1e-6 <= n.start < s.bar(71) - 1e-6)]
        for k in range(6):
            for q in p_:
                part.note(s.bar(69) + k, P(q), 0.5, vel=0.66 + 0.02 * k, art=art)
    for bar in range(71, 79):
        b.kit.play(bar, BLOCK1, vel=0.62)
    for bar in range(79, 87):
        b.kit.play(bar, BLOCK2_ROLL if bar % 4 == 2 else BLOCK2, vel=0.76)
    for bar in range(87, 91):
        b.kit.play(bar, BLOCK3, vel=0.8)
    # the fall: the kit thins bar by bar
    b.kit.play(91, BLOCK2, vel=0.66)
    b.kit.play(92, BLOCK1, vel=0.56)
    b.kit.play(93, {'kick': 'x.......x.......'}, vel=0.46)
    b.kit.play(94, {'kick': 'x...............'}, vel=0.4)
    for bar in (71, 79, 87):
        b.kit.play(bar, {'crash': 'X'})
    b.kit.play(83, {'crash2': 'x'})
    for sec in ('chant', 'T2', 'T3', 'A1', 'A2', 'A3'):
        b.sub(sec)
    # T3's climb (67-70): the city falls back under the horns, so the anthem's
    # low block arrives as an arrival
    dip = [(66.95, 1.0), (67.6, 0.62), (68.95, 0.62), (70.95, 1.0), (71, 1.0)]
    for name in ('ost_vc', 'ost_cb', 'ebass', 'pad_va', 't3_vn', 'sub', 'kit_kick', 'kit_cym'):
        s.parts[name].expr(*dip)

    # timpani and hits
    timp.at(21).play('@f B2q rh | rq. B2e F#2q |')
    timp.at(37).play('@f D3q rq D3e D3e |')
    timp.at(54).play('@f E2q rq E2e E2e |')
    timp.at(69).play('%roll @p B2h.~ | B2h. |')
    timp.expr((68.97, 1.0), (69, 0.3), (70.97, 1.0))
    # the held B major swells in the low brass and turns minor on the downbeat
    swell = b.part('swell', 'trombones', layer='full', role='pad')
    swell.at(69).play('@f [B2 F#3 D#4]h.~ | [B2 F#3 D#4]h. |')
    # ...and resolves in the same players: D-sharp falls to D on the downbeat
    swell.at(71).play('@ff [B2 F#3 D4]h rh |')
    swell.expr((68.97, 1.0), (69, 0.3), (70.97, 1.0), (71, 1.0), (71.6, 0.8))
    boom = b.part('boom', 'boom', layer='full', role='accent', gain=2)
    boom.note(s.bar(71), P('B1'), 4.0, vel=0.85)
    # a suspended-cymbal swell whose peak (3.56 s after it starts) is the downbeat
    cym = b.part('cym_swell', 'orch_perc', layer='full', role='accent', gain=1)
    drums(cym, 67, {'swell_m': '......x.....'}, vel=0.8)
    for bar, p in ((71, 'B2'), (75, 'E2'), (79, 'B2'), (83, 'E2'), (87, 'B2'), (91, 'E2')):
        timp.at(bar).play(f'@f {p}q rq rh |')
    timp.at(77).play('%roll @mf G#2h A2q A#2q | %default @f B2q rq rh |')
    timp.at(85).play('%roll @f G#2h A2q A#2q | %default @ff B2q rq rh |')
    b.hit(21, pieces=('crash', 'bd'))
    b.hit(71, pieces=('crash', 'bd'))
    b.hit(79, pieces=('crash', 'bd', 'gong'), vel=0.9)
    b.hit(87, pieces=('crash', 'bd'))
    b.riser(69, beats=6)

    # the bass guitar (Growlybass) has no samples below A1: its lower notes
    # would be silent, so they sound an octave up (the contrabasses keep the
    # low octave)
    for n in s.parts['ebass'].notes:
        if n.pitch < 33:
            n.pitch += 12

    # ================================================================ calm
    # the ostinato plucked: celli and basses on the beat, the harp off it
    c_vc = b.part('c_ost_vc', 'celli', layer='calm', role='bass', art='pizz', gain=-4)
    c_cb = b.part('c_ost_cb', 'basses', layer='calm', role='low', art='pizz', gain=-3)
    c_hp = b.part('c_harp', 'harp', layer='calm', role='keys')
    for bar, ch in spans:
        ostinato3(c_vc, bar, ch, lo=38, vel=0.62, art='pizz', on_only=True)
        ostinato3(c_cb, bar, ch, lo=28, vel=0.62, art='pizz', on_only=True)
        # (above the pizzicato, D4-G5: lower, its chords were most of the calm mix's mud)
        offbeats(c_hp, bar, ch, lo=62, hi=79, vel=0.52)
    for sec in ('A1', 'A2', 'A3'):
        anthem_bass(c_cb, b.bar(sec), vel=0.6, art='pizz', lo='B1')
    for part in (c_vc, c_cb, c_hp):
        part.expr((12.9, 0.5), (13, 0.5), (20.9, 1.0), (21, 1.0), *fall)
    # (under the tune, not level with it; and not in the horns' register in T3)
    c_pad = b.part('c_pad', 'violas', layer='calm', role='pad', art='soft', gain=-3)
    for bar, ch in ((21, ch3(CH_CHANT)), (38, CH_T2), (71, CH_ANTHEM),
                    (79, CH_ANTHEM), (87, CH_ANTHEM)):
        pad(c_pad, bar, ch, n=2, lo=52, hi=65, vel=0.44, art='soft')
    # the chant and the anthem, hummed far off
    c_oohs = b.part('c_oohs', 'oohs', layer='calm', role='choir', gain=1, humanize_ms=18)
    c_oohs.at(21).play('@mp' + CHANT)
    c_oohs.at(71).play('@mp' + ANTHEM, transpose=-12)
    c_oohs.at(79).play('@mf' + ANTHEM)
    c_oohs.at(87).play('@mf ' + anthem_upto(7))
    c_oohs.at(94).play('@mp B3w |')
    for n in c_oohs.notes:
        n.rearticulate = True
    c_oohs.expr(*fall)
    c_fl = b.part('c_fl', 'flute', layer='calm', role='lead2')
    c_fl.at(87).play('@mp ' + anthem_upto(4), transpose=12)
    c_fl.expr(*fall)
    return b.finish()
