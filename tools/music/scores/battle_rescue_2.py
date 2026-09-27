"""Recruit battles, the second theme — "Quick, Quick, Quick, Slow".

A stranger on the map, and the army coming to fetch them. The stranger
counts a bar of nine the way the hill people and the drowned villages do,
2+2+2+3: quick, quick, quick, slow. The army counts the same bar 3+3+3, in
three big steps. Same bar, same length, two ways to stand in it. Over the
loop the army learns the stranger's step, one section at a time: the bass
first, then the kit, then the brass, and last the strings. In the last strain
everyone plays the stranger's tune in the stranger's count.

The stranger is a plucked zither (the VCSL dan tranh, its plain plucks) and a
darbuka, both seated right of centre. Nothing else in the soundtrack sounds
like either. The tune, in D Dorian, gives one note to each of the stranger's
groups: the tonic twice (the pickup pair), a leap of a fifth, a step down,
and the long note on the slow group, the Dorian B, with G major under it:
D D A G B. It comes back three times in its eight bars; the answer walks down
(A G F E), reaches C, and comes home on D. The zither leans on its group
heads, flicks into its leaps from the note above, and plays the second note
of each pair a hair late. The darbuka plays doum-tek-doum-tek-tek on the
heads (its ghost strokes and rolls in the full mix only).

How each side counts is the texture. The army's kit plays kick, snare, kick
on its three steps; its bass, timpani and string chords strike the three
steps too (the trombones the second and third). The army has no running
figure of its own, only a cymbal ticking the eighths: the running figures are
the stranger's. The two counts agree on the downbeat and on the bar's last
group and disagree in between, every bar.

  intro 1-4   the darbuka alone; the stranger's call once (the hook); the
              army arrives in threes under the zither's figure
  A 5-12      the stranger's tune on the zither over the army in threes (no
              brass yet: the stranger is heard first)
  B 13-20     the army sings the same tune in its own step, the notes kept
              but re-cut long-short (DUM-da DUM-da DUMMM): horns, then the
              violins, the horns holding a counter-line; the zither spells its
              count under them
  C 21-28     THE BASS CHANGES. For two bars the army drops to its bass, now
              in the stranger's count, and hats still in threes; then the
              army's own tune over it, a march in threes (a held note, two
              quick repeated notes, a leap up), climbing bar by bar, on
              trumpets and celli an octave apart, dark (Bb, F, C, Dm, Gm) and
              turning to G
  D 29-36     THE KIT CHANGES: kick for doum, snare for tek, a step down in
              C Dorian. The zither's first phrase, then the army answers with
              the second in its own step (violins) while the zither rests; the
              darbuka hands its doum to the kick and keeps only its tek
  E 37-43     THE BRASS CHANGE: the horns and trumpets take the hook in the
              stranger's count, a step higher every two bars (G, A, B-flat, C,
              over open fifths), the zither answering each; the strings still
              stamp threes
  44          the army holds its breath: the zither plays the hook alone with
              its drum, over a timpani roll, a cymbal swell and tremolo
  F 45-52     EVERYONE: the strings change last, and the whole band lands on
              the stranger's four heads together (the second violins play the
              zither's own figure). The tune in zither, violins, violas, horns
              and trumpets; in its second half the violins leave it for a
              descant (the brightest register, only here), and the answer
              does not go home: it stays on the stranger's B, over G major
  link 53-56  the army lets its breath go on D minor; the darbuka alone, the
              stranger's call, and the army in threes again: someone else is
              still out there. Loop 5-56, 52 bars, 82.6 s.

The wow is bar 45 (69.9 s into the file): after a bar in which only the
stranger plays, the whole band strikes the stranger's quick, quick, quick,
slow at once.

calm: the stranger's zither (plucked softer: its mf samples, rounder) and the
darbuka's heads, against the army in pizzicato: celli and basses on the
steps, violas' chords on the steps; soft strings holding the harmony under
them with no pulse of their own. The army's tunes go to one horn line. Under
the army's tunes the calm hears no zither figure: the drum alone keeps the
stranger's count. The calm follows the same adoption (the pizzicato bass
changes in C, the violas' chords in F; timpani join on the heads in F).
full: kit, bass guitar, contrabasses (C, E, F), tuba and a sub (from D and
E), trombone and string chords, timpani, violins, horns and trumpets, as
above; the zither's figure under the army's tunes in B and C.

Why D, 170 and 9/8: no Act II or Act IV battle theme sits on D (this piece is
aimed at both), and D Dorian's raised sixth keeps it apart from Ember Dusk's D
minor; nothing else runs at 170; Bleached Rite owns 7/8. Against Someone Is
Still Out There (F minor at 148, an oboe, the Thread's rhythm with a cry up a
seventh, the bass walking into F major): no seventh, no F, no walk into a
major tonic (the loop ends on IV and goes home through the link).

The stranger's 2+2+2 against the army's 3+3 is a hemiola inside each bar, but
never a steady 3:2 against the beat (the sacred ground's): the counts share
every downbeat and every last group, and the piece's argument is the count
changing hands. No leitmotif: the stranger's tune is theirs, the army's march
is new, and the Thread stays out (the first rescue theme owns the Thread
meeting a stranger's line). No choir.

Palette (this score only): the zither is the accordion slot's
dan_tranh_plain (VCSL's plain plucks, 16 samples retuned: the vibrato set
bends 20-90 cents off), the darbuka the taiko slot's vcsl_darbuka (raised 335
cents: its body rang 35 cents under D and its tek 28 under F-sharp; now they
ring F and A, D minor's third and fifth). In D, and where the hook holds
F-sharp (bars 39-40), the drum plays only its tek. Lint is clean in both
mixes.
"""

from __future__ import annotations

import zlib

from engine.patterns import Kit
from engine.score import Part, Score
from engine.theory import Chord, name

from scores._battle import Battle

KEY = 'music_battle_rescue_2'

INTRO, A, B, C, D, E, F, L = 1, 5, 13, 21, 29, 37, 45, 53
END = 57
BREATH = E + 7          # bar 44: the army holds its breath, the stranger plays alone

EIGHTH = 0.5
# the two ways of counting one 9/8 bar: (first eighth, length in eighths)
ARMY = ((0, 3), (3, 3), (6, 3))                 # 3+3+3: three big steps
STRANGER = ((0, 2), (2, 2), (4, 2), (6, 3))     # 2+2+2+3: quick, quick, quick, slow
S_HEADS = (0, 2, 4, 6)

# ------------------------------------------------------------------ the stranger's tune
# D Dorian, one note to each of the stranger's groups: the tonic twice, a
# leap of a fifth, a step down, and the long note on the Dorian B (IV under it)
S = [
    'D5e D5e A5q G5q B5q.',
    'A5q G5q F5q E5q.',
    'D5e D5e A5q G5q C6q.',
    'B5q A5q G5q A5q.',
    'D5e D5e A5q G5q B5q.',
    'C6q A5q F5q G5q.',
    'E5q G5q C6q A5q.',
    'B5e A5e G5q E5q D5q.',
]
# F's second half: the same head, but the answer stays on the stranger's B, over IV
S_LAST = 'B5e A5e G5q A5q B5q.'
# the violins' descant over it (F only: the brightest register, once a loop)
DESCANT = ['D6:2 E6q F6q.', 'A6:2 G6q E6q.', 'G6:2 A6q F6q.', 'G6:2 A6q B6q.']
# the army's version: the same tune in its own step (3+3+3)
S_ARMY = [
    'D5q D5e A5q G5e B5q.',
    'A5q G5e F5q. E5q.',
    'D5q D5e A5q G5e C6q.',
    'B5q A5e G5q. A5q.',
    'D5q D5e A5q G5e B5q.',
    'C6q A5e F5q. G5q.',
    'E5q G5e C6q. A5q.',
    'B5q A5e G5q E5e D5q.',
]
# B's second phrase: the horns hold a counter-line under the violins
HN_COUNTER = 'A4:3 B4q. | A4:3 G4q. | G4:3 A4q. | B4:3 A4q. |'
# the army's own tune (C), Aeolian, in threes, on the celli
T = [
    'D4q. Bb3q Bb3e F4q.',
    'C4q. A3q A3e F4q.',
    'E4q. C4q C4e G4q.',
    'F4q. D4q D4e A4q.',
    'Bb4q. A4q G4e D4q.',
    'D4q.~ D4q. B3q.',
]
HOOK = [0, 0, 7, 5, 9]            # the hook's intervals above its root
HOOK_RHY = 'e e q q q.'

# ------------------------------------------------------------------ harmony (eighths)
P = 'Dm:6 G:3 | F:6 C:3 | Dm:6 Am:3 | G:6 Am:3 | Dm:6 G:3 | F:6 C:3 | C:6 F:3 | G:6 Dm:3'
P_F = 'Dm:6 G:3 | F:6 C:3 | Dm:6 Am:3 | G:6 Am:3 | Dm:6 G:3 | F:6 C:3 | C:6 F:3 | G'
# D: the tune a step down, in C Dorian (the zither keeps its bright octave; the
# darbuka's F and A are C Dorian's fourth and sixth)
P_C = 'Cm:6 F:3 | Eb:6 Bb:3 | Cm:6 Gm:3 | F:6 Gm:3 | Cm:6 F:3 | Eb:6 Bb:3 | Bb:6 Eb:3 | F:6 Cm:3'
CH_T = 'Dm | Dm | Bb | F | C | Dm | Gm:3 F:3 Dm:3 | G'
CH_E = 'G5 | G5 | A5 | A5 | Bb5 | Bb5 | C5 | Dm'
CH_INTRO = 'Dm | Dm | Dm | Dm:6 C:3'
SECTIONS = [(INTRO, CH_INTRO), (A, P), (B, P), (C, CH_T), (D, P_C), (E, CH_E), (F, P_F),
            (L, CH_INTRO)]
DORIAN = [0, 2, 3, 5, 7, 9, 10]

# how hard the army plays, bar by bar (an expression lane on its accompaniment)
SHAPE = [(1, 0.7), (4.9, 0.72), (A, 0.8), (B - 0.05, 0.8), (B, 0.92), (C - 0.05, 0.92),
         (C, 0.7), (C + 2 - 0.05, 0.7), (C + 2, 0.86), (D - 0.05, 0.86), (D, 0.84),
         (E - 0.05, 0.84), (E, 0.72), (BREATH - 0.05, 1.0), (F, 1.0), (L - 0.05, 1.0),
         (L, 0.72), (END, 0.72)]

# which way each section of the army counts, strain by strain
#            bass      kit       brass     strings
GROUPING = {
    INTRO: (ARMY, ARMY, ARMY, ARMY),
    A: (ARMY, ARMY, ARMY, ARMY),
    B: (ARMY, ARMY, ARMY, ARMY),
    C: (STRANGER, ARMY, ARMY, ARMY),
    D: (STRANGER, STRANGER, ARMY, ARMY),
    E: (STRANGER, STRANGER, STRANGER, ARMY),
    F: (STRANGER, STRANGER, STRANGER, STRANGER),
    L: (ARMY, ARMY, ARMY, ARMY),
}


def _parse_chart(text):
    out = []
    for bar in text.split('|'):
        chords, e = [], 0
        for tok in bar.split():
            sym, _, n = tok.partition(':')
            n = int(n) if n else 9 - e
            chords.append((Chord(sym), e, n))
            e += n
        assert e == 9, text
        out.append(chords)
    return out


CHARTS = {}
for _bar0, _text in SECTIONS:
    for _i, _chords in enumerate(_parse_chart(_text)):
        CHARTS[_bar0 + _i] = _chords


def section_of(bar):
    return max(b for b, _ in SECTIONS if b <= bar)


def grouping(bar, who):
    return GROUPING[section_of(bar)][('bass', 'kit', 'brass', 'strings').index(who)]


def chord_at(bar, e=0):
    for c, e0, n in CHARTS[bar]:
        if e0 <= e < e0 + n:
            return c
    raise KeyError((bar, e))


def at_or_above(pc, lo):
    return lo + (pc - lo) % 12


def t(s, bar, e=0.0):
    return s.bar(bar) + e * EIGHTH


def jit(*key):
    """A small repeatable wobble in [-0.5, 0.5)."""
    return (zlib.crc32(repr(key).encode()) % 1000) / 1000.0 - 0.5


def hook_text(root, rhythm=HOOK_RHY):
    return ' '.join(f'{name(root + i)}{d}' for i, d in zip(HOOK, rhythm.split()))


def notes_of(s, text, bar, transpose=0):
    tmp = Part(score=s, name='_tmp', inst='violins')
    tmp.at(bar).play(text, transpose=transpose)
    return tmp.notes


def lines(part, bar, texts, dyn='f', transpose=0):
    for i, line in enumerate(texts):
        part.at(bar + i).play(f'@{dyn} ' + line + ' |', transpose=transpose)


# ------------------------------------------------------------------ build
def build():
    s = Score('battle_rescue_2', tonic='D', bpm=170, meter=(9, 8), intro_bars=4, loop_bars=52,
              title='Quick, Quick, Quick, Slow', seed=929)
    s.palette = {'accordion': 'dan_tranh_plain', 'taiko': 'vcsl_darbuka'}
    s.reverb = dict(rt60=2.1, predelay_ms=22, wet_db=-1.2)
    s.master = dict(lufs=-14.0, glue_ratio=1.5)
    b = Battle(s, calm_lufs=-17.0, full_lufs=-14.0)
    stranger(b, s)
    army_tunes(b, s)
    army_step(b, s)
    return b.finish()


# ------------------------------------------------------------------ the stranger
def zither_line(parts, s, bar, text, transpose=0, vel=0.7, tonic=2):
    """The zither plays a line as its player would: the group heads leant on,
    and a flick from the scale note above into a leap. `parts`: [(part,
    velocity offset)]: the calm mix's zither plucks more softly (its mf
    samples, rounder than the f and ff)."""
    src = notes_of(s, f'@{vel} ' + text, bar, transpose)
    scale = {(tonic + transpose + d) % 12 for d in DORIAN}
    prev = None
    for n in src:
        e = round((n.start - s.bar(s.bar_at(n.start) + 1)) / EIGHTH, 3)
        v = min(1.0, n.vel + (0.1 if e in S_HEADS else -0.04) + 0.03 * jit('zv', n.start))
        # the player's lilt: the second note of a pair sits a hair late
        lilt = 0.025 if e in (1, 3, 5, 7) else 0.0
        for part, dv in parts:
            if prev is not None and n.pitch - prev >= 5 and n.pitch < 84:
                up = next(p for p in range(n.pitch + 1, n.pitch + 3) if p % 12 in scale)
                part.note(n.start - 0.09, up, 0.09, vel=(v + dv) * 0.55, rearticulate=True)
            part.note(n.start + lilt + 0.012 * jit('zt', n.start), n.pitch, n.dur, vel=v + dv,
                      rearticulate=True)
        prev = n.pitch


def vamp(heads, offs, s, bar):
    """The stranger's count spelled on the chord: pairs, high then low, three
    times, and a falling three. The calm mix hears only the group heads."""
    for c, e0, n in CHARTS[bar]:
        lo, mid, hi = c.tones_in_range(64, 81)[:3]
        figure = [hi, lo, mid, lo, hi, lo, hi, mid, lo]
        for e in range(e0, e0 + n):
            head = e in S_HEADS
            lilt = 0.025 if e in (1, 3, 5, 7) else 0.0
            (heads if head else offs).note(t(s, bar, e) + lilt + 0.01 * jit('vt', bar, e),
                                           figure[e], 0.5,
                                           vel=(0.6 if head else 0.44) + 0.04 * jit('vv', bar, e))


def stranger(b, s):
    # (a fast compressor takes the steel pluck's first spike down: it was all the
    # limiter heard)
    zeq = [('peak', 250, 1.0, 2.0), ('peak', 3500, 1.0, -2.5), ('highshelf', 5000, 0.7, -3.5)]
    zcomp = dict(thresh_db=-26, ratio=4.0, attack_ms=0.3, release_ms=80, knee_db=6)
    zf = b.part('zither', 'accordion', role='lead', layer='full', gain=1.0, pan=0.3,
                eq=zeq, comp=zcomp)
    # (the calm zither: 86% of that mix's 2-6 kHz energy and nearly all its spikes,
    # over a dark bed of pizzicato and soft strings; its crack is taken further down)
    zs = b.part('zither_c', 'accordion', role='lead', layer='calm', gain=-1.0, pan=0.3,
                eq=[('peak', 250, 1.0, 2.0), ('peak', 3000, 0.9, -4.0),
                    ('highshelf', 5000, 0.7, -4.0)],
                comp=dict(thresh_db=-30, ratio=5.0, attack_ms=0.2, release_ms=70, knee_db=6))
    zi = [(zf, 0.0), (zs, -0.2)]
    # the vamp: in the calm mix only the stranger's call in the intro; under the
    # army's tunes the calm hears the darbuka alone keep the stranger's count
    zc = b.part('zither_call', 'accordion', role='keys', calm_db=-1, gain=2.0, pan=0.3,
                eq=[('peak', 3500, 1.0, -1.5)])
    zv = b.part('zither_v', 'accordion', role='keys', layer='full', gain=-3.0, pan=0.3,
                eq=[('peak', 3500, 1.0, -1.5)])
    zo = b.part('zither_vo', 'accordion', role='keys', layer='full', gain=-5.0, pan=0.3)
    for i, line in enumerate(S):
        zither_line(zi, s, A + i, line + ' |', vel=0.64)
    for i, line in enumerate(S[:4]):
        zither_line(zi, s, D + i, line + ' |', transpose=-2)
    for i, line in enumerate(S[:7] + [S_LAST]):
        zither_line(zi, s, F + i, line + ' |', vel=0.72)
    # the intro and the link: the stranger's call, once, alone with its drum;
    # then its count, spelled on the chord, as the army arrives in threes
    for bar in (2, L + 1):
        zither_line(zi, s, bar, S[0] + ' |', vel=0.62)
    for bar in [3, 4, L + 2, L + 3]:
        vamp(zc, zo, s, bar)
    for bar in range(B, D):
        vamp(zv, zo, s, bar)
    # E: the stranger answers each brass hook; then plays alone
    for bar in (E + 1, E + 3, E + 5):
        root = at_or_above(chord_at(bar).root, 67)
        zither_line(zi, s, bar, hook_text(root) + ' |', vel=0.74)
    zither_line(zi, s, BREATH, S[0] + ' |', vel=0.82)

    # the darbuka: doum and tek on the stranger's heads in both mixes; its
    # ghost strokes (ka) and rolls only in the full mix
    # (its tek's first crack is taken down: in the calm mix it stuck out of the
    # plucked texture as a spike in the 2-6 kHz band)
    dr = b.part('darbuka', 'taiko', role='accent', calm_db=1, gain=4.0, pan=0.25,
                eq=[('lowshelf', 150, 0.7, -2.0), ('peak', 3000, 1.0, -2.0)],
                comp=dict(thresh_db=-24, ratio=3.0, attack_ms=0.5, release_ms=60, knee_db=6))
    dg = b.part('darbuka_gh', 'taiko', role='accent', layer='full', gain=0.0, pan=0.25,
                eq=[('lowshelf', 160, 0.7, -6.0)])
    for bar in range(1, END):
        k = (bar - section_of(bar)) if bar >= A else bar - 1
        kind = 'fill' if k == 7 or bar in (4, L + 3) else ('var' if k % 2 else 'basic')
        darbuka_bar(dr, dg, s, bar, kind=kind, vel=0.6 if bar in (1, L) else 0.72,
                    rim=D <= bar < E or bar in (E + 2, E + 3))


DOUM, TEK, KA, SLAP, SOFT = 36, 38, 42, 48, 40
DARB = {
    'basic': [(0, DOUM, 1.0), (1, KA, .35), (2, TEK, .85), (3, KA, .35), (4, DOUM, .95),
              (5, KA, .35), (6, TEK, 1.0), (7, KA, .45), (8, SOFT, .55)],
    'var': [(0, DOUM, 1.0), (1, KA, .35), (1.5, KA, .3), (2, TEK, .85), (3, DOUM, .5),
            (4, DOUM, .95), (5, KA, .35), (5.5, KA, .3), (6, TEK, 1.0), (7, KA, .45),
            (7.5, KA, .35), (8, TEK, .6)],
    'fill': [(0, DOUM, 1.0), (1, KA, .35), (2, TEK, .85), (3, KA, .35), (4, DOUM, .95),
             (5, KA, .4), (6, TEK, .9), (6.5, KA, .5), (7, TEK, .7), (7.5, KA, .55),
             (8, TEK, .8), (8.5, SLAP, .95)],
}


def darbuka_bar(heads, ghosts, s, bar, kind='basic', vel=0.72, rim=False):
    """rim: the doums become teks and the ghost strokes rest. In D the army's
    kick has taken the stranger's doum; in bars 39-40 the hook holds F-sharp,
    and the drum's body rings F."""
    for e, key, v in DARB[kind]:
        if rim and key in (DOUM, SOFT):
            key, v = TEK, v * 0.8
        tt = t(s, bar, e) + 0.012 * jit('dt', bar, e)
        part = heads if e in S_HEADS else ghosts
        if rim and part is ghosts:
            continue                      # (D: the kit has the groove; the drum steps back)
        part.note(tt, key, 0.5, vel=min(1.0, vel * v + 0.05 + 0.06 * jit('dv', bar, e)))


# ------------------------------------------------------------------ the army's tunes
def army_tunes(b, s):
    hn = b.part('hn', 'horns', role='lead2', calm_db=-1)
    hn_f = b.part('hn_f', 'horns', role='lead2', layer='full')
    vn = b.part('vn', 'violins', role='lead', layer='full', art='sus',
                eq=[('peak', 3500, 1.0, -2.5), ('highshelf', 7000, 0.7, -2.5)])
    # the calm mix's army sings on one horn line, its low mids taken out
    hc = b.part('hn_c', 'horns', role='lead2', layer='calm', gain=-1,
                eq=[('peak', 300, 1.0, -3.0)])
    # B: the army sings the stranger's tune in its own step: the horns, then
    # the violins, the horns holding a counter-line under them
    lines(hn_f, B, S_ARMY[:4], transpose=-12)
    lines(vn, B + 4, S_ARMY[4:])
    hn_f.at(B + 4).play('@mf ' + HN_COUNTER)
    lines(hc, B, S_ARMY, dyn='mf', transpose=-12)
    # C: the army's own tune, on the trumpets and the celli two octaves apart
    # (the calm: the horn line)
    vc_t = b.part('vc_tune', 'celli', role='lead2', art='sus', layer='full')
    lines(vc_t, C + 2, T)
    tpc = b.part('tpt_c', 'trumpets', role='lead', layer='full',
                 eq=[('highshelf', 5000, 0.7, -3.0), ('peak', 2500, 1.0, -1.5)])
    lines(tpc, C + 2, T, dyn='mf', transpose=12)
    lines(hc, C + 2, T, dyn='mf')
    # D: the stranger leads, in C; the army answers in its own step
    lines(vn, D + 4, S_ARMY[4:], transpose=-2)
    lines(hc, D + 4, S_ARMY[4:], dyn='mf', transpose=-14)
    # E: the brass take the hook in the stranger's count, a step higher each time
    tp = b.part('tpt', 'trumpets', role='lead', layer='full',
                eq=[('highshelf', 5000, 0.7, -3.0), ('peak', 2500, 1.0, -1.5)])
    for bar, who in ((E, 'hn'), (E + 2, 'both'), (E + 4, 'tpt'), (E + 6, 'both')):
        root = at_or_above(chord_at(bar).root, 67)
        if who in ('tpt', 'both'):
            tp.at(bar).play('@f ' + hook_text(root) + ' |')
        if who in ('hn', 'both'):
            hn.at(bar).play('@f ' + hook_text(root - (12 if who == 'both' else 0)) + ' |')
        if who == 'tpt':
            hn.at(bar).play('@f ' + hook_text(root - 12) + ' |')
    # F: everyone plays the stranger's tune in the stranger's count; then the
    # violins leave the tune for a descant and the answer stays on the B
    va = b.part('va_mel', 'violas', role='lead2', layer='full', art='sus')
    lines(vn, F, S[:4], dyn='ff')
    lines(va, F, S[:4], transpose=-12)
    lines(tp, F, S[:4], transpose=-12)
    lines(hn, F, S[:7] + [S_LAST], dyn='ff', transpose=-12)
    lines(vn, F + 4, DESCANT, dyn='f')
    # each two-bar phrase leans in and lets go
    for part in (hn, hn_f, vn, vc_t, tp, tpc, va, hc):
        part.expr(*[(bar + d, v) for bar in range(B, L, 2)
                    for d, v in ((0, 0.86), (0.6, 1.0), (1.5, 0.95), (1.95, 0.84))])


# ------------------------------------------------------------------ the army's step
def army_step(b, s):
    kit = Kit(s, 'kit', gains={'snare': -3.0, 'cym': -2.0})
    b.kit = kit
    b.full_only.update(kit.names())
    rb = b.part('ebass', 'rbass', layer='full', role='bass', duck='kit_kick',
                eq=[('peak', 160, 1.0, -3.0)])
    cb = b.part('cb', 'basses', layer='full', role='low', art='spic', gain=-2)
    tuba = b.part('tuba', 'tuba', layer='full', role='low', art='stac', gain=-4)
    sub = b.part('sub', 'sub', layer='full', role='sub', gain=-4)
    pz = b.part('pz_low', 'celli', layer='calm', role='bass', art='pizz', gain=-3)
    pzb = b.part('pz_cb', 'basses', layer='calm', role='low', art='pizz', gain=-3)
    tbn = b.part('tbn', 'trombones', layer='full', role='section', art='stac', gain=-4)
    vc = b.part('vc', 'celli', layer='full', role='ostinato', art='spic', gain=-5,
                eq=[('peak', 250, 1.0, -3.0)])
    va = b.part('va', 'violas', layer='full', role='ostinato', art='spic', gain=-3)
    pzv = b.part('pz_va', 'violas', layer='calm', role='keys', art='pizz')
    pad = b.part('pad', 'violas', layer='full', role='pad', art='soft', gain=-4)
    tp = b.part('timp', 'timpani', role='timp', layer='full', gain=-3.0)
    # the calm mix's bed: soft strings holding the harmony under the plucking
    # (no pulse of their own)
    cpad = b.part('c_pad', 'violas', role='pad', layer='calm', art='soft', gain=-9)
    clow = b.part('c_low', 'celli', role='pad', layer='calm', art='soft', gain=-12)
    for bar in range(3, END):
        if bar in (L, L + 1):
            continue
        for c, e0, n in CHARTS[bar]:
            if not E <= bar < BREATH:
                for p in c.tones_in_range(57, 70)[-3:]:
                    cpad.note(t(s, bar, e0), p, n * EIGHTH, vel=0.4, rearticulate=True)
            clow.note(t(s, bar, e0), at_or_above(c.bass, 38), n * EIGHTH, vel=0.42,
                      rearticulate=True)
    cpad.expr((3, 0.8), (F - 1, 0.8), (F, 0.95), (L - 0.05, 0.95), (L, 0.8))
    # the calm mix's timpani come in only for F, on the stranger's heads
    tpc = b.part('timp_c', 'timpani', role='timp', layer='calm', gain=-4)
    for bar in range(F, L):
        timp_bar(tpc, s, bar, STRANGER)
    v2 = b.part('vn2', 'violins2', role='ostinato', layer='full', art='spic', gain=-3)

    for bar in range(1, END):
        sec = section_of(bar)
        k = bar - sec
        intro = sec in (INTRO, L)
        if (intro and k < 2) or bar == BREATH:
            continue                      # the stranger alone
        g_bass, g_kit = grouping(bar, 'bass'), grouping(bar, 'kit')
        g_brass, g_str = grouping(bar, 'brass'), grouping(bar, 'strings')
        last = k == 7 and not intro
        bare = sec == C and k < 2         # C opens on the bass alone, changed
        # ---- bass: the first to change (C)
        bass_bar(rb, s, bar, g_bass, floor=28, vel=0.8 if bare else 0.74)
        bass_bar(pz, s, bar, g_bass, floor=38, vel=0.72 if sec == F else 0.62)
        bass_bar(pzb, s, bar, g_bass, floor=28, vel=0.6, only=(0, 6))
        if sec in (C, E, F) and not bare:
            bass_bar(cb, s, bar, g_bass, floor=28, vel=0.62)
        if sec in (E, F):
            bass_bar(tuba, s, bar, g_bass, floor=28, vel=0.6)
        if sec in (D, E, F):
            for c, e0, n in CHARTS[bar]:
                sub.note(t(s, bar, e0), at_or_above(c.bass, 26), n * EIGHTH, vel=0.55)
        # ---- kit and timpani: the second (D)
        if bare:
            kit.play(bar, {'hat': 'X.x.x.' 'X.x.x.' 'X.x.x.'}, vel=0.6)
        else:
            kit_bar(kit, bar, g_kit, sec, last=last, soft=intro)
            timp_bar(tp, s, bar, g_kit, light=sec in (INTRO, A, D, L))
        # ---- brass: the third (E); none in A, where the stranger is heard first
        # (not in C, where the trumpets carry the army's own tune in its step)
        if sec in (B, D, E, F):
            stomp(tbn, s, bar, g_brass, lo=53, hi=67, n=3 if sec in (E, F) else 2,
                  vel=0.62, skip_first=g_brass is ARMY)
        # ---- strings: the last (F)
        if not bare:
            stomp(va, s, bar, g_str, lo=55, hi=69, n=2, vel=0.5 if sec == C else 0.56)
        if sec in (INTRO, A, B, F, L):
            stomp(vc, s, bar, g_str, lo=45, hi=57, n=1, vel=0.58)
        if not (sec == C and k < 2):
            stomp(pzv, s, bar, g_str, lo=55, hi=72, n=3, vel=0.64 if sec == F else 0.52)
        if sec in (INTRO, A, L) or bare:
            for c, e0, n in CHARTS[bar]:
                for p in c.tones_in_range(57, 69)[-3:]:
                    pad.note(t(s, bar, e0), p, n * EIGHTH, vel=0.45, rearticulate=True)
        if sec == F:
            # the violins' seconds play the stranger's own figure
            vamp(v2, v2, s, bar)

    # bar 44: the army holds its breath while the stranger plays alone
    sw = b.part('swell', 'orch_perc', role='accent', layer='full', gain=-2)
    sw.note(t(s, BREATH), 50, 4.5, vel=0.7)
    tr = b.part('timp_roll', 'timpani', role='timp', calm_db=-6)
    tr.at(BREATH).play('%roll @mp D2:4.5 |')
    tr.expr((BREATH, 0.4), (BREATH + 0.95, 1.0))
    trem = b.part('trem', 'violins2', role='pad', art='trem')
    trem.at(BREATH).play('@mf [D4 A4 D5]:4.5 |')
    trem.expr((BREATH, 0.3), (BREATH + 0.95, 1.0))
    # after the last chord the army lets its breath go, softly, on D minor
    trem.at(L).play('%soft @mp [D4 F4 A4]:4.5 |')
    trem.expr((L, 0.8), (L + 0.95, 0.2))
    # crashes at the strain heads; the payoff in F
    for bar in (A, B, C + 2, D, E, F):
        kit.play(bar, {'crash': 'X'})
    b.hit(F)
    # the loop's shape: A and C's first bars lighter, E climbing, F the one peak
    for part in list(kit.parts.values()) + [rb, cb, tuba, sub, tbn, vc, va, tp, v2,
                                            b.s.parts['darbuka_gh']]:
        part.expr(*SHAPE)


def bass_bar(part, s, bar, g, floor, vel, only=None):
    """ARMY: root, fifth, octave in dotted quarters. STRANGER: root, octave,
    fifth, root."""
    degs = ('r', '5', '8') if g is ARMY else ('r', '8', '5', 'r')
    for (e0, n), dg in zip(g, degs):
        if only and e0 not in only:
            continue
        c = chord_at(bar, e0)
        root = at_or_above(c.bass, floor)
        p = {'r': root, '8': root + 12, '5': at_or_above((c.root + 7) % 12, floor)}[dg]
        part.note(t(s, bar, e0), p, min(n * EIGHTH, 0.8),
                  vel=min(1.0, vel + (0.1 if e0 == 0 else 0)))


def stomp(part, s, bar, g, lo, hi, n, vel, skip_first=False):
    for e0, ln in g:
        if skip_first and e0 == 0:
            continue
        c = chord_at(bar, e0)
        tones = c.tones_in_range(lo, hi)
        pick = tones[-n:] if len(tones) >= n else tones
        acc = 0.1 if e0 in (0, 6) else 0.0
        for p in pick:
            part.note(t(s, bar, e0), p, 0.5, vel=min(1.0, vel + acc))


def timp_bar(part, s, bar, g, light=False):
    """The root on the first and last group, the fifth between. light: two
    strokes only, the downbeat and the army's second step (or the stranger's
    third group: where the darbuka strikes its second doum)."""
    for i, (e0, n) in enumerate(g):
        if light and e0 not in ((0, 3) if g is ARMY else (0, 4)):
            continue
        c = chord_at(bar, e0)
        root = at_or_above(c.root, 38)
        fifth = at_or_above((c.root + 7) % 12, 40)
        p = fifth if 0 < i < len(g) - 1 and e0 != 2 else root
        part.note(t(s, bar, e0), p, n * EIGHTH, vel=0.72 if e0 == 0 else 0.6)


def kit_bar(kit, bar, g, sec, last=False, soft=False):
    if g is ARMY:
        # (A: the hat marks only the army's three steps, so its count is plain
        # under the stranger's quick drum)
        grid = {'kick': 'x.....' '......' 'x.....',
                'snare': '......' 'X.....' '......',
                'hat': 'X.....' 'x.....' 'x.....'}
        if sec in (B, C):
            grid = {'kick': 'x.....' '....x.' 'x.....',
                    'snare': '......' 'X.....' '......',
                    'ride': 'X.x.x.' 'X.x.x.' 'X.x.x.'}
        if last:
            grid = {'kick': 'x.....' '......' 'x.....', 'snare': '......' 'X.....' 'x.xxXX',
                    'tom_lo': '......' '..x.x.' '......'}
    else:
        # D: the kit takes the darbuka's own strokes (kick for doum, snare for
        # tek) and nothing else; E fills in the eighths; F rides them
        grid = {'kick': 'x...' '....' 'x...' '....' '..',
                'snare': '....' 'X...' '....' 'X...' '..',
                'hat': 'X...' 'x...' 'X...' 'x...' '..'}
        if sec == E:
            grid = {'kick': 'x...' '....' 'x...' '....' '..',
                    'snare': '....' 'X...' '....' 'X...' 'o.',
                    'hat': 'X.x.' 'X.x.' 'X.x.' 'X.x.' 'x.'}
        if sec == F:
            grid = {'kick': 'x...' '....' 'x...' '....' 'x.',
                    'snare': '....' 'X...' '....' 'X...' 'o.',
                    'ride': 'X.x.' 'X.x.' 'X.x.' 'X.x.' 'x.'}
        if last:
            grid = {'kick': 'x...' '....' 'x...' '....' '..',
                    'snare': '....' 'X...' '....' 'X.xx' 'XX',
                    'tom_lo': '....' '....' 'x.x.' '....' '..'}
    kit.play(bar, grid, vel=0.62 if soft else 0.74, ramp=0.3 if last else 0.0)
