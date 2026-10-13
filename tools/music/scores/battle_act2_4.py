"""Act II battle IV — "Every Other Word".

The occupied provinces speak in halves. A message crosses the Empire's roads
only in pieces, a word from one house and the next word from another, and no
one holds all of it. So does the tune: it is played in **hocket**, split note
by note between two bands that stand apart, the strings on the left and the
winds and trumpets on the right. Neither band ever plays it whole. Heard
together they finish each other's sentences.

The mechanism is the size of the share. It grows strain by strain, from a
single note to the whole tune:

  A   one note each: every other note changes bands (the strict hocket)
  A2  two notes each
  B   a bar each: the second tune, broad, called and answered across the field
  B2  two bars each
  A3  the whole tune, both bands at once, in unison: the message spoken whole

Then the loop cuts back to the single notes. Each band keeps its own octave
pair (violins with violas an octave under on the left; flute and oboe with
trumpets an octave under on the right), so a share never changes register, only
side and colour.

The tunes are this piece's own, in B minor at 150. The A tune runs in eighths
(B D F# up to a dotted B, a scale back down, a fall to F# over the minor
dominant, a climb to D6, and a cadence that leans on the leading tone over
F-sharp major); the B tune is its broad answer in the relative major's chords
(G A D Bm), each bar a dotted-quarter step and a held note, the second bar of
each pair a step higher than the first.

  calm  the hocket between two solo voices (solo violin left, clarinet right)
        over the calm bed; in A3 they play the tune together
  full  strings left, winds and trumpets right; kit, bass guitar, celli in
        eighths; horns hold the harmony in B; a far choir (oohs) under A3 only,
        as Act II allows
"""

from dataclasses import replace

from engine.patterns import Kit, arp, bass, chart, ostinato, pad
from engine.score import Part, Score

from scores._battle import Battle

KEY = 'music_battle_act2_4'

# ------------------------------------------------------------------ material
TUNE_A = """
B4e D5e F#5e B5q. A5e F#5e | G5e F#5e E5e D5e E5q F#5q | D5e C#5e B4e C#5e D5q. E5e | C#5q A4q F#4h |
B4e D5e F#5e B5q. C#6e D6e | E6q. D6e C#6e B5e A5e G5e | F#5e G5e A5e F#5e E5q. D5e | C#5q. D5e C#5e B4e A#4q |
"""
CH_A = 'Bm G:3 D/F#:1 D F#m Bm Em D F#'
TUNE_B = """
D5q. E5e F#5h | E5q. F#5e G5h | F#5h. A5q | B5w |
G5q. A5e B5h | A5q. B5e C#6h | D6h. C#6q | A#5w |
"""
CH_B = 'Gmaj7 A7 D Bm G A Bm/F# F#'

INTRO, A0, A2, B0, B2, A3 = 1, 3, 11, 19, 27, 35

# 16-step grooves
DRIVE = {'kick': 'x.....x.x.......', 'snare': '....x.......x...', 'hat': 'x.x.x.x.x.x.x.x.'}
DRIVE_FILL = {'kick': 'x.....x.x.......', 'snare': '....x.....x.xxXX', 'hat': 'x.x.x.x.x.x.....'}
HALF = {'kick': 'x.......x.x.....', 'snare': '........x.......', 'ride': 'x.x.x.x.x.x.x.x.'}
HALF_FILL = {'kick': 'x.......x.x.....', 'snare': '........x...xxXX', 'ride': 'x.x.x.x.x.......'}
FULL = {'kick': 'x.....x.x.....x.', 'snare': '....x.......x...', 'hat': 'xxx.xxx.xxx.xxx.'}
FULL_FILL = {'kick': 'x.....x.x.......', 'snare': '....x...x.xxXXXX', 'tom_lo': '........x.x.....'}


def scratch(s, bar, text):
    """The notes a text plays from `bar`, without a part of their own."""
    p = Part(score=s, name='_scratch', inst='violins')
    p.at(bar).play(text)
    return p.notes


def shares(notes, s, unit, by='note', first=0):
    """Split a tune's notes into alternating shares: `unit` notes at a time
    (by='note') or `unit` bars at a time (by='bar'). Returns, per note, the
    band (0 left, 1 right) that plays it."""
    out = []
    for i, n in enumerate(notes):
        k = i // unit if by == 'note' else s.bar_at(n.start) // unit
        out.append((k + first) % 2)
    return out


def deal(notes, bands, targets, short_art, long_art, overlap=False):
    """Copy each note to its band's parts ((part, transpose) pairs). Notes a
    beat or longer sound legato, shorter ones short. With overlap, the last
    note of each share is held until the band's next entry would start or
    for two beats more, whichever is first."""
    for i, (n, band) in enumerate(zip(notes, bands)):
        dur = n.dur
        if overlap and (i + 1 == len(notes) or bands[i + 1] != band):
            nxt = next((m.start for m, b in zip(notes[i + 1:], bands[i + 1:]) if b == band), None)
            dur = n.dur + 2.0 if nxt is None else min(n.dur + 2.0, nxt - n.start)
        for part, tr in targets[band]:
            art = long_art if dur >= 1.0 - 1e-6 else short_art
            part.notes.append(replace(n, pitch=n.pitch + tr, dur=dur, art=art))


def build():
    s = Score('battle_act2_4', tonic='B', bpm=150, intro_bars=2, loop_bars=40,
              title='Every Other Word', seed=247)
    s.reverb = dict(rt60=2.1, predelay_ms=24, wet_db=-1.0)
    s.master = dict(lufs=-14.0, glue_ratio=1.5)
    b = Battle(s, calm_lufs=-17.0, full_lufs=-14.0)
    b.section('intro', INTRO, chart('Bm Bm'))
    b.section('A', A0, chart(CH_A)).section('A2', A2, chart(CH_A))
    b.section('B', B0, chart(CH_B)).section('B2', B2, chart(CH_B))
    b.section('A3', A3, chart(CH_A))

    # ================================================================ the two bands
    # left: violins at pitch, violas an octave under; right: flute and oboe at
    # pitch, trumpets an octave under
    vn = b.part('L_vn', 'violins', role='lead', layer='full', pan=-0.8)
    va = b.part('L_va', 'violas', role='lead2', layer='full', pan=-0.7)
    fl = b.part('R_fl', 'flute', role='lead', layer='full', pan=0.8)
    ob = b.part('R_ob', 'oboe', role='lead2', layer='full', pan=0.7, gain=-2)
    tp = b.part('R_tpt', 'trumpets', role='lead2', layer='full', pan=0.6, gain=-4)
    left = [(vn, 0), (va, -12)]
    right = [(fl, 0), (ob, 0), (tp, -12)]
    # calm: two solo voices
    sv = b.part('c_L_solo', 'solo_violin', role='lead', layer='calm', pan=-0.6)
    cl = b.part('c_R_cl', 'clarinet', role='lead', layer='calm', pan=0.6)
    c_left, c_right = [(sv, 0)], [(cl, -12)]

    for bar, text, unit, by, first, overlap in (
            (A0, TUNE_A, 1, 'note', 0, False),
            (A2, TUNE_A, 2, 'note', 1, False),
            (B0, TUNE_B, 1, 'bar', 0, False),
            (B2, TUNE_B, 2, 'bar', 1, False)):
        notes = scratch(s, bar, '@f ' + text)
        bands = shares(notes, s, unit, by, first)
        long_art = 'sus'
        deal(notes, bands, {0: left, 1: right}, 'spic', long_art, overlap)
        calm_notes = scratch(s, bar, '@mf ' + text)
        deal(calm_notes, bands, {0: c_left, 1: c_right}, 'default', 'default', overlap)
    # the right band's winds have no 'spic' or 'sus': their short notes are 'stac'
    for p in (fl, ob, tp):
        for n in p.notes:
            n.art = 'stac' if n.art == 'spic' else 'default'
    for n in cl.notes:
        n.art = 'default'
    for n in sv.notes:
        n.art = 'default'
    # A3: the message whole, both bands at once
    for part, tr in left:
        part.at(A3).play('@ff %sus ' + TUNE_A, transpose=tr)
    for part, tr in right:
        part.at(A3).play('@ff %default ' + TUNE_A, transpose=tr)
    sv.at(A3).play('@f %default ' + TUNE_A)
    cl.at(A3).play('@f %default ' + TUNE_A, transpose=-12)
    hn_mel = b.part('hn_mel', 'horns', role='lead2', layer='full')
    hn_mel.at(A3).play('@f ' + TUNE_A, transpose=-12)

    # ================================================================ harmony
    vc = b.part('vc', 'celli', role='ostinato', layer='full', art='spic')
    for sec in ('intro', 'A', 'A2', 'A3'):
        bar, ch = b.sections[sec]
        ostinato(vc, bar, ch, 'e e e e e e e e', 'b b b b b b b b', lo=38, hi=55, vel=0.6,
                 accents='> - > - > - > -')
    for sec in ('B', 'B2'):
        bar, ch = b.sections[sec]
        bass(vc, bar, ch, 'q. q. q', 'r 5 8', floor=38, vel=0.6, art='sus')
    b.low('A', 'q')
    b.low('A2', 'q')
    b.low('B', 'w')
    b.low('B2', 'w')
    b.low('A3', 'q', vel=0.7)
    b.brass_pad('B', 'horns', n=3, lo=50, hi=65, vel=0.5, name='hn_pad')
    b.brass_pad('B2', 'horns', n=3, lo=50, hi=65, vel=0.58, name='hn_pad')
    b.brass_pad('A3', 'trombones', n=3, lo=43, hi=60, vel=0.55, name='tbn_pad')
    b.choir('A3', 'oohs', n=3, lo=55, hi=70, vel=0.4)
    # a soft harp under the B tune's held notes
    hp = b.part('harp', 'harp', role='keys', layer='full', gain=-3)
    for sec in ('B', 'B2'):
        bar, ch = b.sections[sec]
        arp(hp, bar, ch, '0 1 2 3 2 1 2 1', step=0.5, lo=50, hi=74, vel=0.45)

    # ================================================================ rhythm section
    k = Kit(s, 'kit', gains={'cym': -3.0})
    b.kit = k
    b.full_only.update(k.names())
    k.play(1, {'kick': 'x.......x.......', 'hat': 'x.x.x.x.x.x.x.x.'}, vel=0.6)
    k.play(2, {'kick': 'x.......x.......', 'snare': '........x.x.xxxx'}, vel=0.64, ramp=0.5)
    b.groove('A', DRIVE, DRIVE_FILL, every=4, vel=0.7)
    b.groove('A2', DRIVE, DRIVE_FILL, every=4, vel=0.72)
    b.groove('B', HALF, HALF_FILL, every=4, vel=0.68)
    b.groove('B2', HALF, HALF_FILL, every=4, vel=0.72)
    b.groove('A3', FULL, FULL_FILL, every=4, vel=0.76)
    for sec in ('A', 'A2', 'A3'):
        b.rbass(sec, rhythm='e e e e e e e e', notes='r r 8 r r r 8 r',
                accents='> - - > - - > -')
    for sec in ('B', 'B2'):
        b.rbass(sec, rhythm='q. q. q', notes='r 5 8', accents=None)
    for sec in ('A', 'A2', 'B', 'B2', 'A3'):
        b.sub(sec)

    timp = b.part('timp', 'timpani', role='timp', calm_db=-8)
    timp.at(1).play('@mf rw | rh %roll @mp F#2h |')
    timp.at(A0).play('%default @f B2q rq rh |')
    timp.at(A2).play('@f B2q rq rh |')
    timp.at(B0).play('@f G2q rq rh |')
    timp.at(B2).play('@f G2q rq rh |')
    timp.at(B2 + 7).play('%roll @mf F#2w |')
    timp.at(A3).play('%default @ff B2q rq rh |')
    for bar in (A0, A2, B0, B2, A3):
        b.hit(bar)
    b.riser(B2 + 6, beats=8)

    # ================================================================ calm bed
    for sec in ('A', 'A2', 'B', 'B2', 'A3'):
        b.calm_bed(sec, piano='0 2 4 2', piano_lo=55, piano_hi=74)
    b.calm_bed('intro', piano='0 2 4 2', piano_lo=55, piano_hi=74, pad_n=0)
    return b.finish()
