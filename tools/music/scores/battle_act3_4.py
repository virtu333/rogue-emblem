"""Act III battle IV — "Dawn by Degrees".

Day breaks one note at a time. The tonic (B-flat) and the tune never change;
the mode under them brightens by one scale degree a strain, in the order the
circle of fifths gives, from the darkest mode with a minor third to the
brightest that keeps a perfect fourth:

  A   Phrygian    Bb Cb Db Eb F Gb Ab
  B   Aeolian     the second rises:  Cb -> C
  C   Dorian      the sixth rises:   Gb -> G   (the IV turns major)
  D   Mixolydian  the third rises:   Db -> D   (the first major tonic)
  E   Ionian      the seventh rises: Ab -> A   (a leading tone)

The four notes that rise are C, G, D, A, a stack of fifths, and each is struck
on a glockenspiel (with a tubular bell under it) on the first downbeat of the
strain that lights it, so the lights come on one at a time. The next fifth,
E natural (Lydian), never comes. This is Totality turned round: that cue loses
its light from the top down, this one gains it from the bottom up.

The tune is written once, in scale degrees, and sounded in each strain's mode
(`in_mode`). It holds each rising degree somewhere it can be heard: the second
on the first bar's last beat, the sixth across bar 3, the third through bar 4,
and the seventh as the whole of bar 8, where every strain climbs to it. In
four strains that note is a flat seventh, a resting place, and the next strain
starts on its tonic from below (bVII-i, never V-i). In the Ionian strain the
same climb arrives on A, the leading tone, over the dominant, and it is not
allowed to rise: in the strain's last bar the band stops on beat three, a
reversed swell rises under the held A, the four bells fall back in the order
they lit (A D G C), and the loop drops back into Phrygian, every light out at
once. Sera keeps seeing the dawn and the loop keeps taking it back. (The Hollow
Sun's resolution stays reserved for promotion and The Last Light.)

After *Chasing Daybreak* (Takeru Kanazaki), and where it isn't. Taken from its
score as techniques, not notes: the rudimental side-drum motor that opens it
alone, the ticking staccato upper strings (a dyad struck twice and a short
note below) over low strings pumping eighths on one pitch, the broad tune in
long notes on horns over that motor, the violins' running sixteenths over a
brass line, the glockenspiel climbing into a new section, the texture dropped
to a bass drum, bells, a choir's held chords and a flute, and the choir
singing the tune at the top. Its other signatures stay with it: the key
changes (this piece never leaves B-flat), the switch into three (Old Kingdom
Roads took that, and its walking bass) and its 3+3+2 accents (Doctrine of
Lances, The Pit Answers). The mode-by-mode brightening is this piece's own.

Form (4/4 at 136): intro 1-2 (the side drum alone, then the ticking strings) |
A 3-10 | B 11-18 | C 19-26 | D 27-34 | E 35-42 (the rewind is bar 42).

  A  Phrygian: an orchestral march. The ticking strings and the piano over a
     B-flat pedal in pumping eighths; horns carry the tune; side drum and bass
     drum; no kit.
  B  Aeolian: the violins take the tune, the second violins run sixteenths,
     the kit and bass guitar come in under the side drum.
  C  Dorian: half time, the same tempo felt broad. Backbeat on three, the low
     strings in long notes, a far choir (oohs), the harp running sixteenths.
  D  Mixolydian: the light-texture strain. Side drum and kit out; a bass drum
     alone, the tune on glockenspiel and flute, high violins and the choir
     holding chords.
  E  Ionian: tutti. The choir sings the tune, violins and trumpets on it with
     them, the ticking strings back, the side drum and the kit together.

  calm  one solo voice per strain on the tune (oboe, solo violin, clarinet,
        flute, solo violin) over the calm bed; the bells are in both mixes, so
        the modes change in both.
"""

import re

from engine.patterns import Kit, arp, bass, chart, drums, ostinato, pad
from engine.score import Score
from engine.theory import name as midi_name

from scores._battle import Battle

KEY = 'music_battle_act3_4'

# ------------------------------------------------------------------ the modes
# semitones above the tonic for scale degrees 1-7
MODES = {
    'phrygian': [0, 1, 3, 5, 7, 8, 10],
    'aeolian': [0, 2, 3, 5, 7, 8, 10],
    'dorian': [0, 2, 3, 5, 7, 9, 10],
    'mixolydian': [0, 2, 4, 5, 7, 9, 10],
    'ionian': [0, 2, 4, 5, 7, 9, 11],
}
TONIC = 70   # B-flat 4 is degree 1
_DEG = re.compile(r"^([+-]*)([1-7])((?:[whqesx]\.{0,2}3?)(?:\+[whqesx]\.{0,2}3?)*)?([~'>^_!]*)$")


def in_mode(text, mode):
    """Degree notation -> note string. '3h.' is the third (Db5 in Phrygian,
    D5 in Mixolydian); '+' / '-' prefixes move it up / down an octave. Rests,
    bar checks, dynamics and articulation switches pass through."""
    out = []
    for tok in text.replace('|', ' | ').split():
        m = _DEG.match(tok)
        if not m:
            out.append(tok)
            continue
        octv, d, dur, mods = m.groups()
        midi = TONIC + MODES[mode][int(d) - 1] + 12 * (octv.count('+') - octv.count('-'))
        out.append(f'{midi_name(midi)}{dur or ""}{mods}')
    return ' '.join(out)


# The tune: eight bars, the same in every strain. It climbs to the seventh at
# the end of every strain; only the Ionian makes that a leading tone.
TUNE = """
3h. 2q | 1q. 2e 3q 5q | 6h~ 6e 5e 4e 5e | 3w |
4h. 3q | 2q. 3e 4q 6q | 5q. 4e 5q 6q | 7w |
"""
STRAIN_MODES = [('A', 'phrygian'), ('B', 'aeolian'), ('C', 'dorian'), ('D', 'mixolydian'),
                ('E', 'ionian')]
# The harmony is written per strain (a degree chart would give the Dorian a
# diminished sixth chord); each one puts its new note in a chord where the tune
# holds it. A keeps a B-flat pedal under everything.
CHARTS = {
    'A': 'Bbm Bbm Ebm/Bb Bbm Cb/Bb Cb/Bb Gb/Bb Abm/Bb',
    'B': 'Bbm Bbm Ebm Db Gb Ab7 Fm7 Ab',
    'C': 'Bbm Bbm Eb Db Eb7 Cm7 Fm7 Ab',
    'D': 'Bb Bb Eb Bb/D Eb Cm7 Fm7 Ab',
    'E': 'Bb Bb Eb Gm Eb Cm7 F7sus4 F',
}
INTRO, A0, B0, C0, D0, E0 = 1, 3, 11, 19, 27, 35
STARTS = {'A': A0, 'B': B0, 'C': C0, 'D': D0, 'E': E0}
REWIND = E0 + 7          # the last bar of the loop

# the bells: each strain's new note, on the glockenspiel and a tubular bell,
# struck where the tune first sounds it (bar, beat within the strain): the
# second on the first bar's last beat, the sixth on bar 3, the third on the
# first downbeat, and the leading tone on the last bar, the bar of the rewind
LIGHTS = [('B', 0.75, 'C6', 'C5'), ('C', 2, 'G6', 'G4'), ('D', 0, 'D7', 'D5'),
          ('E', 7, 'A7', 'A4')]

# ------------------------------------------------------------------ the drums
# the side drum (orchestral snare): straight eighths, accents on one and three,
# a four-stroke run into each half bar's end; the phrase's last bar rolls
SIDE = {'sn': 'X.x.x.x.X.x.xxxx'}
SIDE_FILL = {'sn': 'X.x.x.x.xxxxXXXX'}
SIDE_LITE = {'sn': 'x.o.o.o.x.o.o.o.'}
BD = {'bd': 'x.......x.......'}
# the kit under the side drum in B and E: kick and hat, no backbeat of its own
DRIVE = {'kick': 'x.......x.x.....', 'hat': 'x.x.x.x.x.x.x.x.'}
DRIVE_FILL = {'kick': 'x.......x.x.....', 'hat': 'x.x.x.x.x.......', 'tom_lo': '............xxxx'}
DRIVE_E = {'kick': 'x...x...x...x...', 'snare': '....x.......x...', 'hat': 'x.x.x.x.x.x.x.x.'}
DRIVE_E_FILL = {'kick': 'x...x...x...x...', 'snare': '....x.......xxXX', 'hat': 'x.x.x.x.x.x.....'}
# C: half time, the backbeat on three
HALF = {'kick': 'x.........x.....', 'snare': '........X.......', 'ride': 'x...x...x...x...'}
HALF_FILL = {'kick': 'x.........x.....', 'snare': '........X...xxXX', 'ride': 'x...x...x.......'}
# D: a bass drum alone, struck in pairs
PAIRS = {'bd': 'x.x.....x.x.....'}


def mode_scale(mode, lo, hi):
    """Every pitch of the mode in [lo, hi]."""
    pcs = {(TONIC + i) % 12 for i in MODES[mode]}
    return [p for p in range(lo, hi + 1) if p % 12 in pcs]


def build():
    s = Score('battle_act3_4', tonic='Bb', bpm=136, intro_bars=2, loop_bars=40,
              title='Dawn by Degrees', seed=341)
    s.reverb = dict(rt60=2.4, predelay_ms=24, wet_db=-0.5)
    s.master = dict(lufs=-14.0, glue_ratio=1.5)
    b = Battle(s, calm_lufs=-17.0, full_lufs=-14.0)
    b.section('intro', INTRO, chart('Bbm:4 Bbm:4'))
    for sec, _ in STRAIN_MODES:
        b.section(sec, STARTS[sec], chart(CHARTS[sec]))
    mode_of = dict(STRAIN_MODES)

    def tune(sec):
        return in_mode(TUNE, mode_of[sec])

    # ================================================================ the tune
    hn = b.part('hn_mel', 'horns', role='lead', layer='full')
    hn.at(A0).play('@f ' + tune('A'), transpose=-12)
    hn.at(E0).play('@f ' + tune('E'), transpose=-12)
    vn = b.part('vn_mel', 'violins', role='lead', layer='full', art='sus')
    for sec in ('B', 'C', 'E'):
        vn.at(STARTS[sec]).play(('@ff ' if sec == 'E' else '@f ') + tune(sec))
    hn2 = b.part('hn_mel2', 'horns', role='lead2', layer='full')
    hn2.at(C0).play('@f ' + tune('C'), transpose=-12)
    # E: the choir sings the tune at the top, trumpets with the violins
    choir = b.part('choir_mel', 'choir', role='lead2', layer='full')
    choir.at(E0).play('@f ' + tune('E'), transpose=-12)
    tpt = b.part('tpt_mel', 'trumpets', role='lead2', layer='full', gain=-5)
    tpt.at(E0).play('@f ' + tune('E'))
    # D: the light strain, on glockenspiel and flute (the flute in both mixes)
    gl_mel = b.part('glock_mel', 'glock', role='lead2', layer='full')
    gl_mel.at(D0).play('@mf ' + tune('D'), transpose=12)
    fl = b.part('fl_mel', 'flute', role='lead', calm_db=0)
    fl.at(D0).play('@mf ' + tune('D'))
    cel = b.part('cel_mel', 'celesta', role='keys', layer='full', gain=-3)
    cel.at(D0).play('@mf ' + tune('D'), transpose=12)

    # calm: one solo voice per strain
    ob = b.part('c_ob', 'oboe', role='lead', layer='calm')
    ob.at(A0).play('@mf ' + tune('A'))
    sv = b.part('c_solo', 'solo_violin', role='lead', layer='calm')
    sv.at(B0).play('@mf ' + tune('B'))
    sv.at(E0).play('@f ' + tune('E'))
    cl = b.part('c_cl', 'clarinet', role='lead', layer='calm')
    cl.at(C0).play('@mf ' + tune('C'), transpose=-12)

    # ================================================================ the ticking strings
    # a dyad struck twice and a short note under it, the top falling through the
    # chord: over the pedal in A (and the intro), back under the choir in E
    tick_hi = b.part('tick_vn', 'violins2', role='ostinato', layer='full', art='stac')
    tick_lo = b.part('tick_va', 'violas', role='ostinato', layer='full', art='stac')
    pno = b.part('tick_pno', 'grand', role='keys', layer='full', gain=-2)
    for sec in ('intro', 'A', 'E'):
        bar, ch = b.sections[sec]
        hi_lo, hi_hi = (70, 86) if sec != 'E' else (62, 79)
        ostinato(tick_hi, bar, ch, 'e e q e e q', '3 3 1 2 2 0', lo=hi_lo, hi=hi_hi,
                 vel=0.6, accents='> - - > - -')
        ostinato(tick_hi, bar, ch, 'e e q e e q', '1 1 - 0 0 -', lo=hi_lo, hi=hi_hi, vel=0.55)
        ostinato(tick_lo, bar, ch, 'e e q e e q', '- - 0 - - 0', lo=53, hi=67, vel=0.55)
        ostinato(pno, bar, ch, 'e e q e e q', '3 3 1 2 2 0', lo=hi_lo, hi=hi_hi, vel=0.5)
        ostinato(pno, bar, ch, 'e e q e e q', '1 1 - 0 0 -', lo=hi_lo, hi=hi_hi, vel=0.46)
    # B: the ticks move down to the violas, under the violins' tune
    bar, ch = b.sections['B']
    ostinato(tick_lo, bar, ch, 'e e q e e q', '2 2 0 1 1 0', lo=55, hi=72, vel=0.55,
             accents='> - - > - -')

    # ================================================================ low strings: the pump
    vc = b.part('vc', 'celli', role='ostinato', layer='full', art='spic')
    cb = b.part('cb', 'basses', role='low', layer='full')
    for sec in ('intro', 'A', 'B', 'E'):
        bar, ch = b.sections[sec]
        ostinato(vc, bar, ch, 'e e e e e e e e', 'b b b b b b b b', lo=38, hi=55, vel=0.6,
                 accents='> - - - > - - -')
        bass(cb, bar, ch, 'e e e e e e e e', 'b b b b b b b b', floor=29, vel=0.6, art='spic',
             accents='> - - - > - - -')
    # C: half time, long notes; D: held roots, soft
    bass(cb, C0, b.chart('C'), 'h h', 'b 5', floor=29, vel=0.62, art='sus')
    bass(vc, C0, b.chart('C'), 'w', 'b', floor=38, vel=0.58, art='sus')
    bass(cb, D0, b.chart('D'), 'w', 'b', floor=29, vel=0.5, art='sus')

    # ================================================================ upper strings, winds
    # B and E: the second violins run sixteenths over the brass; C: the harp does
    b.spic16('B', 'violins2', pattern='0 1 2 3 2 1 2 1', lo=74, hi=93, vel=0.5, layer='full')
    b.spic16('E', 'violins2', pattern='0 1 2 3 2 1 2 1', lo=74, hi=93, vel=0.55, layer='full')
    hp = b.part('harp', 'harp', role='keys', layer='full')
    arp(hp, C0, b.chart('C'), '0 1 2 3 4 3 2 1', step=0.25, lo=62, hi=86, vel=0.5)
    va_pad = b.part('va_pad', 'violas', role='pad', layer='full')
    pad(va_pad, C0, b.chart('C'), n=3, lo=53, hi=69, vel=0.5, art='sus')
    # D: high violins, soft
    b.pads('D', 'violins', n=3, lo=74, hi=89, vel=0.4, art='soft', layer='full', name='vn_hi')

    # ================================================================ brass & choir
    b.brass_pad('A', 'trombones', n=2, lo=46, hi=58, vel=0.45, name='tbn_pad')
    b.brass_pad('B', 'horns', n=3, lo=50, hi=65, vel=0.5, name='hn_pad')
    b.brass_pad('E', 'trombones', n=3, lo=43, hi=60, vel=0.6, name='tbn_pad')
    b.choir('C', 'oohs', n=3, lo=55, hi=70, vel=0.45)
    b.choir('D', 'oohs', n=4, lo=55, hi=72, vel=0.5)
    tuba = b.part('tuba', 'tuba', role='low', layer='full')
    bass(tuba, E0, b.chart('E'), 'w', 'b', floor=34, vel=0.55)

    # ================================================================ the bells
    gl = b.part('glock_lights', 'glock', role='accent', calm_db=-2, gain=6)
    tb = b.part('bells_lights', 'bells', role='accent', calm_db=-4, art='damp', gain=3)
    for sec, at, hi_note, lo_note in LIGHTS:
        gl.at(STARTS[sec] + at).play(f'@ff {hi_note}h')
        tb.at(STARTS[sec] + at).play(f'@f {lo_note}h')
    # in each strain's sixth bar every light lit so far rings once, rising (the
    # leading tone is not lit yet there)
    lit = []
    for sec, _, hi_note, _ in LIGHTS:
        if sec != 'E':
            lit.append(hi_note)
        gl.at(STARTS[sec] + 5).play('@mf ' + ' '.join(f'{p}e' for p in lit))
    # the glockenspiel climbs the strain's scale into the next one (beats 3-4 of
    # its last bar), landing where the new bell strikes
    for (sec, mode), nxt in zip(STRAIN_MODES[:-1], ('B', 'C', 'D', 'E')):
        run = mode_scale(mode, 79, 96)[-8:]
        gl.at(STARTS[sec] + 7.5).play('@mf ' + ' '.join(f'{midi_name(p)}e' for p in run[::2][-4:]))

    # ================================================================ the rewind
    # E's last bar: the band stops on beat three under the held A; a reversed
    # swell rises into the loop point, and the bells fall back the way they lit
    rev = b.part('rewind', 'reverse', role='fx', calm_db=-4)
    rev.note(s.bar(REWIND), 60, 4.0, vel=0.85)
    gl.at(REWIND + 0.75).play('@f A7s D7s G6s C6s')
    for name in list(s.parts):
        if name in ('rewind', 'glock_lights', 'vn_mel', 'choir_mel', 'c_solo', 'tpt_mel',
                    'hn_mel'):
            continue
        p = s.parts[name]
        cut = s.bar(REWIND) + 2.0
        end = s.bar(REWIND + 1)
        keep = []
        for n in p.notes:
            if n.start >= cut - 1e-6 and n.start < end - 1e-6:
                continue
            if n.start < cut and n.end > cut and n.start >= s.bar(REWIND) - 1e-6:
                n.dur = cut - n.start
            keep.append(n)
        p.notes = keep

    # ================================================================ drums
    side = b.part('side', 'orch_perc', role='snare', layer='full')
    drums(side, 1, SIDE_LITE, vel=0.5)
    drums(side, 2, SIDE, vel=0.58, ramp=0.3)
    for sec in ('A', 'B', 'E'):
        start = STARTS[sec]
        for i in range(8):
            if start + i == REWIND:
                drums(side, start + i, {'sn': 'X.x.x.x.'}, vel=0.64)
            else:
                drums(side, start + i, SIDE_FILL if i % 4 == 3 else SIDE, vel=0.6)
    bd = b.part('bd', 'orch_perc', role='accent', layer='full')
    for bar in range(A0, A0 + 8):
        drums(bd, bar, BD, vel=0.66)
    for bar in range(D0, D0 + 8):
        drums(bd, bar, PAIRS, vel=0.6)
    b.kit = Kit(s, 'kit', gains={'cym': -3.0})
    b.full_only.update(b.kit.names())
    b.groove('B', DRIVE, DRIVE_FILL, every=4, vel=0.66)
    b.groove('C', HALF, HALF_FILL, every=4, vel=0.72)
    b.groove('E', DRIVE_E, DRIVE_E_FILL, every=4, vel=0.74)
    k = b.kit
    k.parts['snare'].notes = [n for n in k.parts['snare'].notes
                              if not (s.bar(REWIND) + 2 <= n.start < s.bar(REWIND + 1))]
    k.parts['kick'].notes = [n for n in k.parts['kick'].notes
                             if not (s.bar(REWIND) + 2 <= n.start < s.bar(REWIND + 1))]
    k.parts['cym'].notes = [n for n in k.parts['cym'].notes
                            if not (s.bar(REWIND) + 2 <= n.start < s.bar(REWIND + 1))]

    eb = b.part('ebass', 'rbass', layer='full', role='bass', duck='kit_kick')
    for sec in ('B', 'E'):
        bar, ch = b.sections[sec]
        bass(eb, bar, ch, 'e e e e e e e e', 'r r r r r r 8 r', floor=31, vel=0.72,
             accents='> - - - > - - -')
    bass(eb, C0, b.chart('C'), 'h q q', 'r - 5', floor=31, vel=0.72)
    for sec in ('B', 'C', 'E'):
        b.sub(sec)

    tp = b.part('timp', 'timpani', role='timp', calm_db=-8)
    tp.at(1).play('@mf rw | rh. Bb2e Bb2e |')
    tp.at(A0).play('@f' + ' Bb2q rq rh |' * 8)
    tp.at(B0).play('@f Bb2q rq rh |')
    tp.at(C0).play('@f Bb2q rq rh |')
    tp.at(D0 + 7).play('%roll @mp F2w |')
    tp.expr((D0 + 7, 0.4), (D0 + 7.95, 1.0), (E0, 1.0))
    tp.at(E0).play('%default @ff Bb2q rq rh |')
    for bar in (B0, C0, E0):
        b.hit(bar)
    b.riser(D0 + 6, beats=8)

    # ================================================================ calm bed
    for sec in ('A', 'B', 'C', 'D', 'E'):
        b.calm_bed(sec, piano='0 2 4 2', piano_lo=55, piano_hi=77)
    b.calm_bed('intro', piano='0 2 4 2', piano_lo=55, piano_hi=77, pad_n=0)
    for name in ('c_pno', 'c_low', 'c_lowcb', 'c_pad', 'ckit_kick'):
        p = s.parts[name]
        p.notes = [n for n in p.notes if not (s.bar(REWIND) + 2 <= n.start < s.bar(REWIND + 1))]
        for n in p.notes:
            if s.bar(REWIND) <= n.start < s.bar(REWIND) + 2 and n.end > s.bar(REWIND) + 2:
                n.dur = s.bar(REWIND) + 2 - n.start
    return b.finish()
