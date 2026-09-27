"""Castle battles, the second theme — "Every Voice at Its Post".

The Empire's own stone: the blockhouses ringing the closed Heartland, the
Lieutenant's Keep on the causeway, and in Act IV the palace-fortress, whose
walls were raised to keep something in. The War College teaches doctrine; this
is doctrine in stone: a real fugue, four voices each at its post, at battle
tempo with a band. D minor at 140. D is the drill's own pitch (D, E-flat, D,
C, falling to B-flat: the Sleeper's hum set to marching), and no field theme
of Acts III or IV is in D; 140 is used by no other battle theme, fast enough
for a fight and slow enough that four voices moving in eighths stay apart in a
stone hall. Stone That Remembers owns C minor at 132, the ground bass and
Edric's oath; none of them is here.

The subject is the drill. Its head is the drill exactly (D, a quick E-flat, D,
C: long-short-long-long); its tail turns the drill's fall to B-flat into a
march (B-flat, A, B-flat, C: the head's upper neighbour mirrored below it) and
leaps to F, which sighs down a half step to E, the dominant's fifth:

    D q.  Eb e  D q  C q | Bb e  A e  Bb e  C e  F q  E q

The answer is real, at the fifth (A, B-flat, A, G | F, E, F, G, C, B): the
subject never leans on its fifth, so nothing needs mutating; it closes on the
dominant's dominant, and a one-bar codetta over A brings the key home before
the third entry. The countersubject stays with the subject every time and is
invertible at the octave and the fifteenth: it answers the subject's upper
neighbour with a lower one (D, C-sharp, D against D, E-flat, D: the two
neighbours meet on D, an augmented sixth closing onto the octave), climbs to A
and falls in syncopation over the bar line. In the exposition it lies under
the answer (tenor), under the subject (alto) and over the answer (soprano).

Episodes are the subject's fragments in sequence: the head in imitation at the
half bar down the circle of fifths into F, over a walking bass (12-15); the
countersubject's first bar rising a step a bar, F, G minor, A minor,
B-flat (18-21); the tail's turn and leap answered a fifth down, then the
dominant, the bass climbing A, B-flat, B, C-sharp into the stretto (24-27).
Middle entries: in F major on the horns, the neighbour a whole step (the drill
mutated to the key, 16-17); in G minor in the bass on the trombones (22-23).

The stretto (28-33) is the walls closing in: five entries a bar apart,
climbing, each on its own colour: the bass on D (trombones, tuba), the tenor
on A (horns), the alto on D (the choir, the only place it sings), the soprano
on A (trumpets and violins, up to C6, the loop's highest note, bar 32), and
the bass again. Every entry lands alone: the voice finishing the subject
leaves out the note that would sound against the new entry's first one, and
the tails step back so the newest head is on top. The snare plays the tail's
rhythm with the head's accents; with the last entry the whole kit strikes the
drill in unison.

The pedal point (34-37): A held by the organ, the basses, the tuba and the
timpani, the bass guitar driving it in eighths. Over it the subject in
augmentation on the trumpets, harmonised i6/4, the Neapolitan (E-flat over the
pedal: the Empire's semitone above its own dominant), i6/4, III6, iv, i6/4,
V; the horns hold the inner voices. Then two bars in which a horn echoes the
head twice, sinking, while the drill goes on; the pedal lets go on the last
beat and the loop's first downbeat is struck by the band on D minor, the
dominant resolving as the subject starts again alone, as the band's riff
(violas, celli and trombones in octaves, the bass guitar two octaves down).

The four voices are the strings in both mixes, each voice's entries a little
forward of its other lines, the eighths detached (in a hall a slurred run at
140 smears) and a sigh from a long note to a step below kept under one bow.
The calm mix is the fugue as a chapel would hear it: the organ's quiet stops
play every entry of the subject; the upper voices' other lines are bowed
softly (the countersubject a little forward of the free voices); the bass
voice is plucked, a continuo, with soft basses under its long notes and the
pedal; a side drum, far off, plays the drill at the loop's turn and over the
pedal. No kit, no brass, no motor: the counterpoint is the movement. The full mix adds
the organ's full stops on the exposition's entries, the brass on the later
ones, the choir for one, a rock kit whose kick doubles the rhythm of the entry
it plays under (a backbeat over it; the episodes keep the backbeat and let the
kick follow the head's imitations), the bass guitar and the timpani. Both
mixes play the same notes on the same timeline, so a switch mid-phrase moves
the line from one band to the other.

Form (bars, 4/4 at 140): intro 1-2 (the pedal's last breath, the drill) |
exposition 3-11 (tenor 3, alto answering 5, codetta 7, soprano 8, bass
answering 10) | episode 12-15 | F major 16-17 | episode 18-21 | G minor 22-23
| episode 24-27 | stretto 28-33 | pedal 34-37 | drain 38-39. Loop 3-39,
37 bars, 63.4 s.

Leitmotif: the Empire's drill, as the subject's head, at its own pitch; in F
major it is mutated, over the pedal it is doubled in length. No Thread: this
fortress is the Empire's.

Lint: the sustained semitones left are intended: the soprano's A over
B-flat in bar 24 (the tail's leap landing as a major seventh over VI and
falling to the sixth) and B-flat over the held A in the pedal (the tenor's
Neapolitan, bar 34; the augmented subject's B-flat, bar 36). In the stretto
an entry's head meets the tail before it on a ninth or a seventh (bars 30 and
32), each left by step: the walls grinding.
"""

from engine.patterns import Kit, drums
from engine.score import Score

from scores._battle import Battle

KEY = 'music_battle_castle_2'

OFF = 2          # intro bars: fugue bar b sounds at score bar b + OFF
LOOP = 37        # fugue bars 1-37

# ------------------------------------------------------------------ the subject
# the Empire's drill (D, E-flat, D, C, falling to B-flat) as a fugue subject:
# the drill's head, then its fall turned into a march tail (B-flat, A, B-flat,
# C) and a leap to F that sighs down a half step to E, the dominant's fifth
SUBJ = 'D4q. Eb4e D4q C4q | Bb3e A3e Bb3e C4e F4q E4q |'
# the countersubject: a lower neighbour against the subject's upper one
# (D, C-sharp, D against D, E-flat, D: the two meet on D), a climb to A and a
# syncopated fall; invertible at the octave and the fifteenth
CS = 're D5q C#5e D5e F5e A5e G5e~ | G5q E5q D5e C#5e D5e E5e |'
# the relative major's form (middle entry 1): the neighbour a whole step
SUBJ_F = 'F3q. G3e F3q E3q | D3e C3e D3e E3e A3q G3q |'
CS_F = 're F4q E4e F4e A4e C5e Bb4e~ | Bb4q G4q F4e E4e F4e E4e |'

# (voice, fugue bar, text, transpose, tag, dynamic)
# tag: 'subj' an entry of the subject or answer (the argument), 'cs' the
# countersubject, 'free' free counterpoint
F = []


def E(v, bar, text, tr=0, tag='free', dyn='mf'):
    F.append((v, bar, text, tr, tag, dyn))


# ================================================================ exposition (1-9)
E('T', 1, SUBJ, 0, 'subj', 'f')
E('A', 3, SUBJ, 7, 'subj', 'f')
E('T', 3, CS, -17, 'cs', 'mp')
E('A', 5, 'E5q. F5e E5q C#5q |', 0, 'free', 'mp')           # codetta over A
E('T', 5, 'C#4q B3q A3q G3q |', 0, 'free', 'mp')
E('S', 6, SUBJ, 12, 'subj', 'f')
E('A', 6, CS, -12, 'cs', 'mp')
E('T', 6, 'F3h. C3q | G3h F3q A3q |', 0, 'free', 'mp')
E('B', 8, SUBJ, -17, 'subj', 'f')
E('S', 8, CS, -5, 'cs', 'mf')
E('A', 8, 'E4h. G4q | A4q F4q E4q D#4q |', 0, 'free', 'mp')
E('T', 8, 'C4h. B3q | A3q D4q A3q B3q |', 0, 'free', 'mp')

# ================================================================ episode 1 (10-13)
# the head in imitation at the half bar down the circle of fifths, over a
# walking bass, into F major
E('S', 10, 'B4q. C5e B4q A4q | A4q. Bb4e A4q G4q | G4q. Ab4e G4q F4q |'
           ' F4e E4e F4e G4e A4e Bb4e C5e E5e |', 0, 'free', 'mf')
E('A', 10, 'rh E4q. F4e | E4q D4q D4q. Eb4e | D4q C4q C4q. Db4e | C4q Bb3h. |', 0, 'free', 'mf')
E('B', 10, 'E2q B2q G#2q A2q | C#3q D3q C3q B2q | G2q C3q Bb2q A2q | F2q G2q C3h |', 0,
  'free', 'mf')

# ================================================================ middle entry 1 (14-15)
E('T', 14, SUBJ_F, 0, 'subj', 'f')
E('A', 14, CS_F, 0, 'cs', 'mp')
E('B', 14, 'F2h. C3q | Bb2h A2q C3q |', 0, 'free', 'mf')
E('S', 14, 'F5h rh | rw |', 0, 'free', 'mf')

# ================================================================ episode 2 (16-19)
# the countersubject's first bar carries the argument, rising a step a bar
E('S', 16, 're F4q E4e F4e A4e C5e Bb4e~ | Bb4e G4q F#4e G4e Bb4e D5e C5e~ |'
           ' C5e A4q G#4e A4e C5e E5e D5e~ | D5e Bb4q A4e Bb4e D5e F5e Eb5e~ |', 0, 'free', 'mf')
E('A', 16, 'C4h D4h~ | D4h Eb4h | E4h F4h~ | F4h G4h |', 0, 'free', 'mp')
E('B', 16, 'F2w | G2w | A2w | Bb2w |', 0, 'free', 'mf')

# ================================================================ middle entry 2 (20-21)
E('B', 20, SUBJ, -19, 'subj', 'f')
E('T', 20, CS, -19, 'cs', 'mp')
E('S', 20, 'Eb5e D5q. rh | rw |', 0, 'free', 'mf')
E('A', 20, 'Bb4h. A4q | G4q A4q Bb4q G4q |', 0, 'free', 'mp')

# ================================================================ episode 3 (22-25)
# the tail's turn and leap, answered a fifth down; then the dominant, the bass
# climbing A, B-flat, B, C-sharp into the stretto's first entry
E('S', 22, 'D5e C#5e D5e E5e A5q G5q | rw | E5h G5h | G#5h A5h |', 0, 'free', 'f')
E('A', 22, 'F4h D4h | G4e F#4e G4e A4e D5q C#5q~ | C#5h D5h~ | D5h C#5h |', 0, 'free', 'mf')
E('T', 22, 'A3h Bb3h~ | Bb3h A3h | E4w~ | E4w |', 0, 'free', 'mf')
E('B', 22, 'D3h Bb2h | G2h A2h | A2h Bb2h | B2h C#3h |', 0, 'free', 'f')

# ================================================================ stretto (26-31)
# (a voice whose tail meets the next entry's first note leaves that note out:
# the new entry lands alone on its downbeat)
SUBJ_ST = 'D4q. Eb4e D4q C4q | re A3e Bb3e C4e F4q E4q |'
E('B', 26, SUBJ_ST, -12, 'subj', 'ff')
E('T', 27, 'A3q. Bb3e A3q G3q | F3e E3e F3e G3e C4q A3q |', 0, 'subj', 'ff')
E('A', 28, SUBJ_ST, 12, 'subj', 'ff')
E('S', 29, 'A5q. Bb5e A5q G5q | F5e E5e F5e G5e C6q A5q |', 0, 'subj', 'ff')
E('B', 30, SUBJ, -12, 'subj', 'ff')
E('S', 26, 'A5h F5h | F5h. C5q | F5h rh |', 0, 'free', 'mp')
E('A', 26, 'A4h C5h | D5h rh |', 0, 'free', 'mp')
E('T', 26, 'F4h rh |', 0, 'free', 'mp')
E('B', 28, 'Bb2h F2h | G2h A2h |', 0, 'free', 'mp')
E('T', 29, 'D4h C#4h |', 0, 'free', 'mp')
E('A', 30, 'C5h A4h |', 0, 'free', 'mp')
E('T', 30, 'rh A3q C4q |', 0, 'free', 'mp')
E('S', 31, 'G5h F5q G5q |', 0, 'free', 'ff')
E('A', 31, 'D5h A4q Bb4q |', 0, 'free', 'ff')
E('T', 31, 'D4h D4q C#4q |', 0, 'free', 'ff')

# ================================================================ the pedal (32-37)
E('B', 32, 'A2w~ | A2w~ | A2w~ | A2w~ | A2w~ | A2h. rq |', 0, 'free', 'mf')
E('S', 32, 'D5h. Eb5q | D5h C5h | Bb4q A4q Bb4q C5q | F5h E5h |', 0, 'subj', 'ff')
E('S', 36, 'C#5w |', 0, 'free', 'f')
E('A', 32, 'F4h. G4q | F4h F4h | G4q F4q G4q A4q | A4h C#5h | G4w |', 0, 'free', 'mf')
E('T', 32, 'A3h. Bb3q | A3h A3h | D4q D4q E4q F4q | D4h E4h |', 0, 'free', 'mf')
# the drain: the drill's head twice more over the pedal, sinking (A, then F
# onto E); the pedal lets go two beats before the lone subject returns
E('T', 36, 'A3q. Bb3e A3q G3q | F3q. G3e F3q E3q |', 0, 'free', 'mf')

VOICES = ('S', 'A', 'T', 'B')


def _notes(text, bar, tr):
    tmp = Score('tmp', bpm=140, loop_bars=200)
    p = tmp.part('x', 'violins')
    p.at(bar).play(text, transpose=tr)
    return p.notes


def fugue(dyn_scale=1.0):
    """{voice: [(note, tag)]} in score time."""
    from engine.score import DYNAMICS
    out = {v: [] for v in VOICES}
    for v, bar, text, tr, tag, dyn in F:
        ns = _notes(text, bar + OFF, tr)
        head_end = ns[0].start + 4 if ns else 0
        for k, n in enumerate(ns):
            n.vel = DYNAMICS[dyn] * dyn_scale
            if tag == 'subj':
                if k == 0:
                    n.accent = 1                       # every entry is announced
                if n.start < head_end - 1e-9:
                    n.vel *= 1.06                      # the drill's head, forward
                elif 26 <= bar <= 30:
                    n.vel *= 0.85                      # a stretto tail yields to the next head
            out[v].append((n, tag))
    for v in out:
        out[v].sort(key=lambda x: x[0].start)
    return out


def copy(part, notes, transpose=0, art=None, vel=None, vel_scale=1.0, detach=False):
    """Copy notes into a part. detach: every note a new bow, eighths shortened
    (the strings' detache: at 140 a slurred run smears in the hall)."""
    prev = None
    for n in notes:
        m = part.note(n.start, n.pitch + transpose, n.dur,
                      vel=min(1.0, vel if vel is not None else n.vel * vel_scale),
                      art=art or part.opts.get('art') or 'default')
        if detach:
            # a sigh (a long note falling a step onto another) stays under one bow
            sigh = (prev is not None and abs(prev.start + prev.dur - n.start) < 1e-6
                    and prev.dur >= 1 and n.dur >= 1 and 0 < prev.pitch - n.pitch <= 2)
            m.rearticulate = not sigh
            if n.dur <= 0.5 + 1e-9:
                m.gate = 0.72
        prev = n


# who carries each entry in the full mix, besides its own strings: the lone
# subject at the top of the loop is the band's riff (trombones an octave down);
# the answer and the soprano's entry are the organ and the strings alone; the
# trombones come back with the bass; each middle entry has its own colour
# (horns in F, trombones in G minor); the stretto spends everything, one colour
# an entry; the trumpets are kept for the stretto's top and the augmentation.
# (voice, fugue bar) -> [(part, instrument, transpose, velocity scale)]
ENTRY_BRASS = {
    ('T', 1): [('tbn_e', 'trombones', -12, 0.95)],
    ('B', 8): [('tbn_e', 'trombones', 12, 1.0)],
    ('T', 14): [('hn_e', 'horns', 0, 1.0)],
    ('B', 20): [('tbn_e', 'trombones', 12, 1.0)],
    ('B', 26): [('tbn_e', 'trombones', 0, 1.0), ('tuba_e', 'tuba', -12, 0.95)],
    ('T', 27): [('hn_e', 'horns', 0, 1.0)],
    ('S', 29): [('tpt_e', 'trumpets', 0, 1.0)],
    ('B', 30): [('tbn_e', 'trombones', 0, 1.0), ('tuba_e', 'tuba', -12, 0.95)],
    ('S', 32): [('tpt_e', 'trumpets', 0, 1.0)],
}
# the organ doubles the exposition's entries in the full mix (the doctrine,
# stated plainly); after that the brass and the choir carry the entries and
# the organ keeps only the pedal
ORGAN_FULL = {('T', 1), ('A', 3), ('S', 6)}
BRASS_SEAT = {'hn_e': dict(pan=-0.45, eq=[('peak', 350, 1.0, -2.0), ('peak', 1800, 1.0, 3.0)]),
              'tbn_e': dict(pan=0.45, eq=[('peak', 300, 1.0, -3.0), ('peak', 1500, 1.0, 2.0)]),
              'tuba_e': dict(pan=0.5), 'tpt_e': dict(pan=0.15, eq=[('peak', 3500, 1.0, -3.0)])}


def entries(fg):
    """[(voice, fugue bar, notes)] for every entry of the subject."""
    out = []
    for v, bar, text, tr, tag, dyn in F:
        if tag != 'subj':
            continue
        lo, hi = bar + OFF, bar + OFF + (4 if bar == 32 else 2)
        ns = [n for n, t in fg[v] if t == 'subj' and (lo - 1) * 4 - 1e-9 <= n.start < (hi - 1) * 4 - 1e-9]
        out.append((v, bar, ns))
    return out


# ---------------------------------------------------------------- drums (16 steps a bar)
# under an entry the kick doubles the subject's rhythm (the head's long-short-
# long-long, the tail's four quick and two long) under a backbeat: the band
# plays the drill with the voice that carries it
E_HEAD = {'kick': 'x.....x.x...x...', 'snare': '....X.......X..o', 'hat': 'x.x.x.x.x.x.x.x.'}
E_TAIL = {'kick': 'x.x.x.x.x...x...', 'snare': '....X.......X...', 'hat': 'x.x.x.x.x.x.x.x.'}
E_HEAD_R = {'kick': 'x.....x.x...x...', 'snare': '....X.......X..o', 'ride': 'x...x...x...x...'}
E_TAIL_R = {'kick': 'x.x.x.x.x...x...', 'snare': '....X.......X...', 'ride': 'x...x...x...x...'}
LINK = {'kick': 'x.......x.......', 'snare': '....X.......xoxx', 'hat': 'x.x.x.x.x.x.....'}
# the episodes keep the drive without the drill: a backbeat, the hat pedal,
# toms leading into each bar
EPI = {'kick': 'x.....x.x.....x.', 'snare': '....X.......X...', 'hat_pedal': '..x...x...x...x.',
       'tom_lo': '......x.......x.'}
EPI_F = {'kick': 'x.......x.......', 'snare': '....X.......', 'tom_lo': '........x.x.xxXX',
         'hat_pedal': '..x...x.'}
# the stretto: every bar has a head and a tail, so the snare plays the tail's
# rhythm with the head's accents, over a kick that drives the eighths
STRETTO = {'kick': 'x...x.x.x...x.x.', 'snare': 'X.x.x.X.X...X...', 'ride': 'X...x...X...x...'}
STRETTO_F = {'kick': 'x.x.x.x.x.x.x.x.', 'snare': 'X.x.x.X.X.xxXXXX'}
# the last entry: the whole kit strikes the drill with it
UNISON = {'kick': 'X.....x.X...X...', 'snare': 'X.....x.X...X...', 'tom_lo': '..x.x.....x...x.'}
# the pedal: the drill hammered, toms answering
HAMMER = {'kick': 'x...x...x...x...', 'snare': 'X.....x.X...X...', 'tom_lo': '..x.......x.....'}
DRILL = {'snare': 'x.....x.x...x...'}


def pump(notes, octave=12):
    """A walking line as the band plays it: each note in eighths, the octave
    above on the off-beats."""
    out = []
    for n in notes:
        k = 0
        while k < n.dur - 1e-9:
            out.append((n.start + k, n.pitch + (octave if (k * 2) % 2 else 0), 0.5, n.vel))
            k += 0.5
    return out


def build():
    s = Score('battle_castle_2', tonic='D', bpm=140, intro_bars=OFF, loop_bars=LOOP,
              title='Every Voice at Its Post', seed=229)
    s.reverb = dict(rt60=2.3, predelay_ms=30, wet_db=-3.5, damp=0.5)
    s.master = dict(lufs=-14.0, glue_ratio=1.5, eq=[('peak', 270, 0.8, -2.5),
                    ('peak', 3200, 1.0, 1.0), ('highshelf', 9000, 0.7, 0.5)])
    b = Battle(s, calm_lufs=-17.0, full_lufs=-14.0)
    fg = fugue()
    ents = entries(fg)
    SB = lambda fb: s.bar(fb + OFF)         # noqa: E731  (fugue bar -> beat)
    END = LOOP + 1                          # the fugue bar the loop returns from

    # ================================================================ full: the four voices
    # each voice's strings in two parts: its entries of the subject (brought
    # forward) and everything else (the accompaniment dips under the entries)
    inst = {'S': 'violins', 'A': 'violins2', 'T': 'violas', 'B': 'celli'}
    # (the high violins' edge taken off: at f on D5-F5 they turn shrill)
    soft_top = {'S': [('peak', 3000, 1.0, -2.0), ('highshelf', 6000, 0.7, -3.0)]}
    for v in VOICES:
        p = b.part(f'str_{v}', inst[v], layer='full', role='section', art='sus', gain=-2,
                   eq=[('peak', 300, 1.0, -2.0)] + soft_top.get(v, []))
        copy(p, [n for n, t in fg[v] if t != 'subj'], detach=True)
        e = b.part(f'str_{v}_e', inst[v], layer='full', role='lead2', art='sus',
                   gain=2.5 if v == 'S' else 1.5,
                   eq=soft_top.get(v, []))
        copy(e, [n for n, t in fg[v] if t == 'subj'], detach=True)
    cb = b.part('str_Bb', 'basses', layer='full', role='low', art='sus')
    copy(cb, [n for n, t in fg['B'] if n.start >= SB(26) - 1e-9 and (t == 'subj' or n.start >= SB(32) - 1e-9)],
         transpose=-12, detach=True)
    # the lone subject at the top of the loop is the band's riff: the celli take
    # it an octave down with the violas (and the bass guitar two octaves down)
    riff = b.part('riff_vc', 'celli', layer='full', role='section', art='sus')
    copy(riff, [n for n, _ in fg['T'] if n.start < SB(3) - 1e-9], transpose=-12, detach=True)

    arc = [(1 + OFF, 0.86), (3 + OFF, 0.82), (8 + OFF, 0.95), (10 + OFF, 0.88), (14 + OFF, 0.92),
           (16 + OFF, 0.86), (20 + OFF, 0.94), (22 + OFF, 0.88), (25.9 + OFF, 1.0),
           (36 + OFF, 1.0), (END - 0.05 + OFF, 0.78)]
    for v in VOICES:
        s.parts[f'str_{v}'].expr(*arc)

    # the organ has the subject in both mixes (loud in full, quiet in calm)
    org = b.part('org_e', 'organ', layer='full', role='lead2', art='loud', gain=-4,
                 eq=[('peak', 300, 0.8, -4.0)])
    corg = b.part('c_org', 'organ', layer='calm', role='lead', art='default', gain=1.5,
                  eq=[('peak', 2800, 1.0, -3.0), ('highshelf', 5000, 0.7, -3.0)])
    for v, bar, ns in ents:
        tr = -12 if v == 'S' and bar == 29 else 0
        if (v, bar) in ORGAN_FULL:
            copy(org, ns, transpose=tr)
        copy(corg, ns, transpose=tr)
        if v == 'B':
            copy(corg, ns, transpose=12)      # the calm organ's 8' and 4' on a bass entry
    for n in org.notes + corg.notes:
        n.gate = 0.8 if n.dur <= 0.5 else 0.9
    # the organ pedal: full organ for the pedal's climax, the quiet stops once
    # the walls stand; it lets go two beats before the lone subject (a breath,
    # only the drill). The intro is the same breath.
    ped = b.part('org_ped', 'organ', role='low', art='loud', calm_db=-3)
    ped.at(32 + OFF).play('A2w~ | A2w~ | A2w~ | A2w | A2w~ | A2h. rq |')
    ped.at(1).play('%default A2w~ | A2h rh |')

    # brass on the entries (one part an entry, so each is levelled as a lead)
    for v, bar, ns in ents:
        for name, ins, tr, vs in ENTRY_BRASS.get((v, bar), ()):
            p = b.part(f'{name}{bar}', ins, layer='full', role='lead', art='default',
                       gain=3 if bar == 32 else 1, **BRASS_SEAT.get(name, {}))
            copy(p, ns, transpose=tr, vel_scale=vs, detach=True)
            for n in p.notes:
                if n.dur >= 1:
                    n.rearticulate = False
    # the gate: the loop's first downbeat is struck by the whole band (D minor,
    # a short stab), resolving the pedal; then the riff goes on alone
    gate = {'trombones': ('gate_tbn', 'A2 D3 F3 A3', 0.4), 'horns': ('gate_hn', 'A3 D4 F4 A4', -0.4),
            'trumpets': ('gate_tpt', 'D4 F4 A4 D5', 0.15), 'tuba': ('gate_tuba', 'D2', 0.5)}
    for ins, (name, chord, pan) in gate.items():
        g = b.part(name, ins, layer='full', role='accent', art='stac', pan=pan, gain=2)
        for p_ in chord.split():
            g.note(SB(1), p_, 0.5, vel=0.9, art='stac')
    # over the pedal the horns hold the harmony (the alto and tenor), not a
    # second octave of the augmented subject
    hp = b.part('hn_ped', 'horns', layer='full', role='section', pan=-0.4, gain=-4)
    for v in ('A', 'T'):
        copy(hp, [n for n, _ in fg[v] if SB(32) - 1e-9 <= n.start < SB(36) - 1e-9], vel_scale=0.85)
    # the drain's two echoes of the head on a horn, far back
    hd = b.part('hn_drain', 'horns', layer='full', role='lead2', pan=-0.35, depth=0.8)
    copy(hd, [n for n, _ in fg['T'] if SB(36) - 1e-9 <= n.start < SB(END) - 1e-9], vel_scale=0.9,
         detach=True)
    # the choir takes the alto's entry in the stretto (the only place it sings)
    ch = b.part('choir', 'choir', layer='full', role='lead', gain=0,
                eq=[('peak', 300, 1.0, -3.0), ('peak', 2500, 1.0, 2.0)])
    for v, bar, ns in ents:
        if (v, bar) == ('A', 28):
            copy(ch, ns)

    # the bass guitar: the lone subject two octaves down; the tenor's free
    # line while it is the lowest voice (6-7); then the bass voice, walked in
    # octave eighths through the episodes and the middle entries' free bars
    eb = b.part('ebass', 'rbass', layer='full', role='bass', duck='kit_kick', gain=-5)
    copy(eb, [n for n, _ in fg['T'] if n.start < SB(3) - 1e-9], transpose=-24)
    copy(eb, [n for n, _ in fg['T'] if SB(6) - 1e-9 <= n.start < SB(8) - 1e-9], transpose=-12)
    for n, t in fg['B']:
        if n.start >= SB(32) - 1e-9:
            continue
        free_run = t == 'free' and SB(14) - 1e-9 <= n.start < SB(26) - 1e-9
        if free_run:
            base = n.pitch - (12 if n.pitch >= 48 else 0)
            for st, p, d, vel in pump([n]):
                eb.note(st, base + (p - n.pitch), d, vel=vel)
        else:
            eb.note(n.start, n.pitch, n.dur, vel=n.vel)
    eb.at(32 + OFF).play('@f ' + ' '.join(['A1e'] * 32) + ' | @mf ' + ' '.join(['A1e'] * 14) + ' re re |')
    tp = b.part('tuba_ped', 'tuba', layer='full', role='low')
    tp.at(32 + OFF).play('@f A1w~ | A1w~ | A1w~ | A1w |')

    # ================================================================ calm: the chapel
    # the organ has the subject; the upper voices' other lines are bowed softly
    # (the countersubject a little forward of the free voices); the bass
    # voice is plucked, a continuo under them
    pz = {'S': 'violins', 'A': 'violins2', 'T': 'violas', 'B': 'celli'}
    warm = [('highshelf', 3500, 0.7, -2.5), ('peak', 260, 1.0, 1.0)]
    for v in ('S', 'A', 'T'):
        q = b.part(f'c_sus_{v}', pz[v], layer='calm', role='section', art='soft', gain=-3,
                   eq=[('highshelf', 5000, 0.7, -2.0)])
        copy(q, [n for n, t in fg[v] if t == 'cs'], detach=True)
        copy(q, [n for n, t in fg[v] if t == 'free'], vel_scale=0.85, detach=True)
    p = b.part('c_pz_B', 'celli', layer='calm', role='section', art='pizz', gain=-3, eq=warm)
    copy(p, [n for n, t in fg['B'] if t != 'subj' and n.dur < 2])
    q = b.part('c_sus_B', 'celli', layer='calm', role='pad', art='soft', gain=0)
    copy(q, [n for n, t in fg['B'] if t != 'subj' and n.dur >= 2])
    cbz = b.part('c_pz_Bb', 'basses', layer='calm', role='low', art='pizz', gain=-2, eq=warm)
    copy(cbz, [n for n, t in fg['B'] if n.dur < 2], transpose=-12)
    # the floor: the basses bowed softly under the long bass notes and the pedal
    clo = b.part('c_low', 'basses', layer='calm', role='low', art='soft', gain=1)
    copy(clo, [n for n, t in fg['B'] if n.dur >= 2], transpose=-12)

    # ================================================================ drums
    kit = Kit(s, 'kit', gains={'kick': -5.0, 'snare': -7.0, 'cym': -10.0, 'toms': -4.0})
    b.kit = kit
    b.full_only.update(kit.names())

    def at(fb, grid, vel=0.74, ramp=0.0):
        kit.play(fb + OFF, grid, vel=vel, ramp=ramp)

    kit.play(1, DRILL, vel=0.5)
    kit.play(2, DRILL, vel=0.44)
    for fb, grid, vel in ((1, E_HEAD, 0.74), (2, E_TAIL, 0.74), (3, E_HEAD, 0.68), (4, E_TAIL, 0.68),
                          (5, LINK, 0.66), (6, E_HEAD, 0.72), (7, E_TAIL, 0.72),
                          (8, E_HEAD_R, 0.8), (9, E_TAIL_R, 0.8),
                          (10, EPI, 0.72), (11, EPI, 0.72), (12, EPI, 0.72), (13, EPI_F, 0.74),
                          (14, E_HEAD_R, 0.76), (15, E_TAIL_R, 0.76),
                          (16, EPI, 0.7), (17, EPI, 0.72), (18, EPI, 0.74), (19, EPI_F, 0.76),
                          (20, E_HEAD_R, 0.8), (21, E_TAIL_R, 0.8),
                          (22, EPI, 0.74), (23, EPI, 0.76)):
        at(fb, grid, vel)
    # the roll into the stretto: accents on the beats, growing
    at(24, {'kick': 'x.......x.......', 'snare': 'x.o.o.o.x.o.o.o.'}, 0.68, ramp=0.25)
    at(25, {'kick': 'x...x...x...x...', 'snare': 'Xoxox.xoXoxoXxXX'}, 0.8, ramp=0.45)
    for fb in range(26, 30):
        at(fb, STRETTO, 0.82)
    at(30, UNISON, 0.86)
    at(31, STRETTO_F, 0.84)
    for fb in range(32, 36):
        at(fb, HAMMER, 0.86)
    # the drain keeps the drill going under the echoes and turns into the riff
    at(36, {'kick': 'x.......x.......', 'snare': 'X.....x.X...X...', 'tom_lo': '..x.......x.....'}, 0.74)
    at(37, {'kick': 'x.......x.......', 'snare': 'X.....x.X...xxXX', 'tom_lo': '..x.......x.....'}, 0.74)
    for fb in (1, 8, 14, 20, 26, 30, 32):
        at(fb, {'crash': 'X'})

    timp = b.part('timp', 'timpani', role='timp', calm_db=-6)
    timp.at(1).play('%roll @mp A2w~ | A2h. rq |')
    timp.expr((1, 0.55), (2.95, 0.3), (3, 1.0))
    for fb, p in ((1, 'D2'), (3, 'A2'), (6, 'D2'), (8, 'A2'), (14, 'F2'), (20, 'G2'),
                  (26, 'D2'), (27, 'A2'), (28, 'D2'), (29, 'A2'), (30, 'D2')):
        timp.at(fb + OFF).play(f'%default @f {p}q rq rh |')
    timp.at(32 + OFF).play('%roll @ff A2w~ | A2w~ | A2w~ | A2w | @f A2w~ | A2h. rq |')
    timp.expr((32 + OFF, 1.0), (36 + OFF, 0.8), (END - 0.3 + OFF, 1.0))
    perc = b.part('perc', 'orch_perc', role='accent', calm_db=-8)
    for fb in (8, 26):
        drums(perc, fb + OFF, {'crash': 'x', 'bd': 'x'}, vel=0.8)
    drums(perc, 32 + OFF, {'crash': 'x', 'bd': 'x', 'gong': 'x'}, vel=0.9)

    # calm: the drill far off, on a side drum
    cdr = b.part('c_drum', 'orch_perc', layer='calm', role='accent', gain=-4, depth=0.9)
    for bar in (1, 2, 36 + OFF, 37 + OFF):
        drums(cdr, bar, {'sn': 'x.....x.x...x...'}, vel=0.45)
    for bar in range(32 + OFF, 36 + OFF):
        drums(cdr, bar, {'sn': 'x.....x.x...x...', 'bd': 'x.......'}, vel=0.5)

    sub = b.part('sub', 'sub', layer='full', role='sub')
    copy(sub, [n for n, _ in fg['B'] if n.start >= SB(32) - 1e-9], transpose=-12, vel=0.6)

    return b.finish()
