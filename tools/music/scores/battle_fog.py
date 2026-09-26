"""Fog-of-war battles — "What the Fog Keeps".

The soundtrack's quiet, tense theme. G Dorian at 100, and no rock kit in
either mix: timpani, soft toms (taiko), a bass drum, a bowed cymbal.

The tune is a question and its answer. The question is three notes: G,
B-flat, then E held (up a minor third, up a tritone, onto the Dorian sixth).
It is asked three times a strain, reaching further each time (G B-flat F,
then A C G). The answers circle below it (D. C D A; E. D E; F. E F D), and
the last one darkens to E-flat and comes down onto B-flat, the key's third.

Revelation by layer. The game opens a battle in the calm mix and crossfades
to the full one when blows are exchanged, which is when the fog reveals the
enemy, so here the crossfade is the reveal. The full mix plays the tune
whole. The calm mix plays the same notes on the same timeline, but only
some of them: each question is hocketed note by note across distant voices
(a harp, a pizzicato viola, then a low flute, a clarinet or a muted horn far
back), and the answers are mostly kept by the fog, as is every cadence's
last note. The calm hears "G, B-flat, E..." and then the harp dripping where
the answer should be. When the full mix comes in, it fills in what was
missing, and the fragments stay in it as colours on the whole line.

The distance device. A phrase's last notes return a dotted quarter later,
quieter, from the same kind of instrument on the other side of the field and
deeper in the hall, so source and echo can't be told apart. The calm mix
echoes only what it heard.

Harmony without a third. One sonority a bar, in fourths and fifths (A D G,
G C F, E A D) planed by step over a slow bass, never a triad. At the
cadences (bars 4 and 8 of each A strain) the full mix adds the third, C over
A and B-flat over G, with the horns swelling into it: the fog lifting. The
calm keeps the suspended note instead.

Form (bars): intro 1-4 (the question once, far off) | A 5-12 (the tune low,
violas and celli; under it the stalk, a two-bar gait in the low strings and
toms that never settles on a backbeat) | A2 13-20 (an octave up, second
violins and violas; cello eighths) | B 21-28 (the answer's circling figure
walked down by step, C, B-flat, A, each answered by a rising sus shape, the
celli striking every note an octave below; high sixteenths in the second
violins; then the question in stretto, every two beats an octave higher, the
last landing on A3's downbeat) | A3 29-36 (violins, horns an octave below, a
flute an octave above; trombones, tuba and timpani strike the stalk) | turn
37-40 (the question twice, further off each time, and no answer). Loop 5-40,
86.4 s.

calm: the fragments over the fog. A breathing chord in fourths (above the
tune when it is low, below it when it climbs, gone for the first half of B);
harp drops falling by fourths into the gaps where the answers were;
pizzicato footsteps whose gait changes strain by strain and closes in
through B; a low cello tremolo; the bowed cymbal at the phrase ends.

No leitmotif: a fog map can come in any act, so there is no choir, and the
question is its own. No reference track is used. Against the other quiet
themes: Rime is one held note changing meaning, with glass (celesta, glock,
harp harmonics), and has none here; Totality drags in 6/8, and this walks in
4/4. Lint is clean in both mixes.
"""

from engine.patterns import drums
from engine.score import Part, Score

from scores._battle import Battle

KEY = 'music_battle_fog'

INTRO, A, A2, B, A3, T = 1, 5, 13, 21, 29, 37
END = 41

# ------------------------------------------------------------------ the tune
# G Dorian. The question (G, B-flat, E: up a minor third, up a tritone, the
# Dorian sixth held) and its answer circling below it; asked again reaching
# higher; the last phrase darkens to E-flat and comes down onto B-flat.
TUNE = """
rq G3e Bb3e E4h | D4q. C4e D4q A3q | rq G3e Bb3e F4h | E4q. D4e E4h |
rq A3e C4e G4h | F4q. E4e F4q D4q | Eb4q. D4e C4q A3q | Bb3h. rq |
"""
# B (played an octave up): the answer's circling figure walked down by step
# (C, B-flat, A), each answered by a rising sus shape; then (bars 27-28) the
# question in stretto
B_LINE = """
C4q. Bb3e C4q G3q | F3h G3q C4q | Bb3q. A3e Bb3q F3q | Eb3h F3q G3q |
A3q. G3e A3q E3q | D3h E3q A3q |
"""
CELL = 'rq G3e Bb3e E4h |'
# the turn: the question twice, further off each time, and no answer
TURN = 'rq G4e Bb4e E5h | rw | rq G3e Bb3e E4h | rw |'
INTRO_CELL = 'rw | rw | rq G3e Bb3e E4h | rw |'

# What each calm voice keeps of the whole: (bar of the strain, beat offset).
# The questions are heard, hocketed note by note across distant voices; the
# answers are mostly kept by the fog, and so is every cadence's last note.
MASK_A = {
    'hp': [(1, 1.0), (3, 1.5), (5, 1.0)],
    'pz': [(1, 1.5), (3, 1.0), (5, 1.5)],
    'fl': [(1, 2.0)],
    'cl': [(4, 2.0)],
    'hn': [(7, 3.0)],
}
MASK_A2 = {
    'pz': [(1, 1.0), (3, 1.5), (5, 1.0)],
    'hp': [(1, 1.5), (3, 1.0), (5, 1.5)],
    'cl': [(1, 2.0), (5, 2.0)],
    'hn': [(2, 0.0)],
    'fl': [(4, 2.0), (7, 2.0), (7, 3.0)],
}
MASK_A3 = {
    'hp': [(1, 1.0), (3, 1.5), (5, 1.0)],
    'pz': [(1, 1.5), (3, 1.0), (5, 1.5)],
    'fl': [(1, 2.0), (4, 0.0), (4, 1.5), (4, 2.0), (5, 2.0)],
    'hn': [(3, 2.0)],
    'cl': [(6, 0.0)],
    'va': [(7, 3.0)],
}
MASK_B = {
    'cl': [(1, 0.0), (3, 0.0), (5, 0.0)],
    'hn': [(2, 0.0), (6, 0.0)],
    'hp': [(4, 3.0), (6, 3.0)],
}
MASK_TURN = {
    'hp': [(1, 1.0)],
    'pz': [(1, 1.5)],
    'fl': [(1, 2.0)],
    'hn': [(3, 2.0)],
}
MASK_INTRO = {
    'hp': [(3, 1.0)],
    'pz': [(3, 1.5)],
    'hn': [(3, 2.0)],
}

# ------------------------------------------------------------------ harmony
# One sonority a bar, hand-voiced in fourths and fifths: no thirds. At the
# cadences (bars 4 and 8 of each A strain) the full mix adds the third (C
# over A, B-flat over G): the fog lifting. The calm mix keeps the sus note.
#          bass   shared    calm  full (the third)
HARM_A = [('G', 'A D G', '', ''), ('G', 'G C F', '', ''), ('G', 'A D G', '', ''),
          ('A', 'A E', 'D', 'C'), ('G', 'A D G', '', ''), ('G', 'G C F', '', ''),
          ('C', 'G C F', '', ''), ('G', 'G D', 'A', 'Bb')]
HARM_B = [('C', 'G C F', '', ''), ('C', 'A D G', '', ''), ('Bb', 'F Bb Eb', '', ''),
          ('Bb', 'G C F', '', ''), ('A', 'E A D', '', ''), ('A', 'E A D', '', ''),
          ('D', 'A D G', '', ''), ('D', 'A D E', '', '')]
HARM_TURN = [('G', 'A D G', '', ''), ('G', 'A D G', '', ''), ('G', 'A D G', '', ''),
             ('G', 'G C D', '', '')]
HARM_INTRO = [('G', 'G D', '', ''), ('G', 'A D G', '', ''), ('G', 'A D G', '', ''),
              ('G', 'G C D', '', '')]
# the footsteps' two-bar gaits: (beat offset, a fourth lower, velocity)
WALK = [[(0.0, False, 0.5), (2.5, True, 0.36)], [(1.5, False, 0.42)]]
STEPS = {
    INTRO: WALK, A: WALK, A3: WALK,
    A2: [[(0.0, False, 0.5), (3.0, True, 0.38)], [(0.5, True, 0.36), (2.0, False, 0.44)]],
    B: [[(0.0, False, 0.52), (1.0, True, 0.38), (2.5, False, 0.44)],
        [(0.5, True, 0.4), (2.0, False, 0.46), (3.5, True, 0.4)]],
    T: [[(0.0, False, 0.44)], []],
}
STRAINS = [(INTRO, HARM_INTRO), (A, HARM_A), (A2, HARM_A), (B, HARM_B), (A3, HARM_A),
           (T, HARM_TURN)]

PC = {'C': 0, 'Db': 1, 'D': 2, 'Eb': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'Ab': 8,
      'A': 9, 'Bb': 10, 'B': 11}


def pcs(text):
    return [PC[t] for t in text.split()]


def at_or_above(pc, lo):
    return lo + (pc - lo) % 12


def stack(names, lo):
    """Pitch classes stacked upward from `lo`, each above the last."""
    out, cur = [], lo - 1
    for pc in pcs(names):
        cur = at_or_above(pc, cur + 1)
        out.append(cur)
    return out


def falling(names, top, n=4):
    """n of the chord's notes falling from `top` by fourths and fifths."""
    ring = sorted({p for pc in pcs(names) for p in range(36, top + 1) if p % 12 == pc},
                  reverse=True)
    out = [ring[0]]
    for p in ring[1:]:
        if len(out) < n and out[-1] - p >= 5:
            out.append(p)
    return out


def fog_pcs(bar):
    """Pitch classes of everything the harmony holds in a bar."""
    for bar0, harm in STRAINS:
        if bar0 <= bar < bar0 + len(harm):
            bs, shared, calm, full = harm[bar - bar0]
            return {PC[bs]} | set(pcs(' '.join((shared, calm, full))))
    return set()


def bass_of(bar):
    for bar0, harm in STRAINS:
        if bar0 <= bar < bar0 + len(harm):
            return harm[bar - bar0][0]
    raise KeyError(bar)


def notes_of(s, text, bar, transpose=0):
    tmp = Part(score=s, name='_tmp', inst='violins')
    tmp.at(bar).play(text, transpose=transpose)
    return tmp.notes


def copy_note(part, n, shift=0.0, vel=None):
    return part.note(n.start + shift, n.pitch, n.dur, vel=n.vel if vel is None else vel,
                     rearticulate=True)


# ------------------------------------------------------------------ the reveal
class Reveal:
    """The tune whole (full mix only) and in fragments (both mixes), with the
    distance device: a phrase's last notes return a dotted quarter later,
    quieter and further back, from the same kind of instrument on the other
    side of the field."""

    ECHO = 1.5

    def __init__(self, b):
        self.b = b
        self.s = b.s
        voices = {
            'fl': ('flute', dict(art='nv', pan=-0.45, depth=0.7)),
            'cl': ('clarinet', dict(pan=0.35, depth=0.6)),
            'hn': ('horns', dict(art='mute', pan=-0.2, depth=0.95)),
            'hp': ('harp', dict(pan=0.45, depth=0.5)),
            'pz': ('violas', dict(art='pizz', pan=0.15, depth=0.55)),
            'va': ('violas', dict(art='soft', pan=0.5, depth=0.75)),
        }
        self.frag, self.echo = {}, {}
        for k, (inst, o) in voices.items():
            # the fragments double the whole in the full mix, a little under it;
            # a pluck is levelled like a held note, so it sits lower
            g = {'hp': -8, 'pz': -8, 'fl': -2, 'hn': -5}.get(k, -4)
            self.frag[k] = b.part(f'frag_{k}', inst, role='lead', calm_db=3, gain=g, **o)
            self.echo[k] = b.part(f'echo_{k}', inst, role='counter', art=o.get('art'),
                                  pan=-o['pan'], depth=1.0, reverb=0.9, calm_db=3,
                                  gain=g - 2)
        self.echo_whole = b.part('echo_whole', 'violas', role='counter', art='soft', pan=0.55,
                                 depth=1.0, reverb=0.9, layer='full', gain=-6)

    def state(self, bar, text, whole, mask, ends, transpose=0, dyn='mf', k=2):
        """`whole`: [(part, transpose)] playing every note (full only).
        `ends`: bars of the strain (1-based) whose phrase end echoes."""
        s = self.s
        src = notes_of(s, f'@{dyn} ' + text, bar, transpose)
        for part, tr in whole:
            for n in src:
                # the whole is played out: the pickups tongued, the landings leant on
                acc = 0.06 if n.dur <= 0.5 or n.dur >= 2 else 0.0
                part.note(n.start, n.pitch + tr, n.dur, vel=min(1.0, n.vel + acc),
                          rearticulate=n.dur <= 0.5)
        owner = {}
        for voice, keys in mask.items():
            for bb, off in keys:
                t = s.bar(bar + bb - 1) + off
                hit = [n for n in src if abs(n.start - t) < 1e-6]
                if not hit:
                    raise ValueError(f'{s.name}: no note at strain bar {bb} + {off} (bar {bar})')
                copy_note(self.frag[voice], hit[0])
                owner[id(hit[0])] = voice
        for e in ends:
            t_end = s.bar(bar + e)
            last = [n for n in src if n.start < t_end - 1e-6]
            # at a cadence (a phrase ending on a long note) only the note itself
            # returns: its approach would rub against it
            kk = 1 if last[-1].dur >= 3 else k
            for n in last[-kk:]:
                voice = owner.get(id(n))
                dst = self.echo[voice] if voice else self.echo_whole
                e = copy_note(dst, n, shift=self.ECHO, vel=n.vel * 0.85)
                # an echo held into a bar whose fog doesn't have its note stops
                # at the bar line
                nxt = s.bar(s.bar_at(e.start) + 2)
                if e.end > nxt + 1e-6 and e.pitch % 12 not in fog_pcs(s.bar_at(nxt) + 1):
                    e.dur = max(0.5, nxt - e.start)
        return src


# ------------------------------------------------------------------ build
def build():
    s = Score('battle_fog', tonic='G', bpm=100, intro_bars=4, loop_bars=36,
              title='What the Fog Keeps', seed=307)
    s.reverb = dict(rt60=2.6, predelay_ms=30, wet_db=-0.5, damp=0.6, bright=0.9)
    # the ensemble lives in the low mids (no cymbals, the tune in the tenor):
    # the master takes some of that out and gives the attacks their edge
    s.master = dict(lufs=-14.0, glue_ratio=1.4,
                    eq=[('peak', 330, 0.8, -3.0), ('peak', 2600, 0.8, 1.5),
                        ('highshelf', 7000, 0.7, 2.0)])
    b = Battle(s, calm_lufs=-17.0, full_lufs=-14.0)

    tune(b, s)
    fog(b, s)
    full_layers(b, s)
    return b.finish()


def tune(b, s):
    rv = Reveal(b)
    whole = dict(role='lead', layer='full')
    va = b.part('tune_va', 'violas', art='sus', **whole)
    fl8 = b.part('tune_fl8', 'flute', gain=-4, **{**whole, 'role': 'lead2'})
    vn2 = b.part('tune_vn2', 'violins2', art='sus', **whole)
    vc = b.part('tune_vc', 'celli', art='sus', **{**whole, 'role': 'lead2'})
    vn = b.part('tune_vn', 'violins', art='sus', **whole)
    hn = b.part('tune_hn', 'horns', **{**whole, 'role': 'lead2'})

    rv.state(INTRO, INTRO_CELL, [], MASK_INTRO, ends=(3,), dyn='mp')
    rv.state(A, TUNE, [(va, 0), (vc, 0)], MASK_A, ends=(4, 8), dyn='mf')
    # (A2's second violins are doubled by the violas, not the oboe: the oboe's
    # octave partial made the unison F5 sour)
    rv.state(A2, TUNE, [(vn2, 0), (va, 0)], MASK_A2, ends=(4, 8), transpose=12, dyn='mf')
    # B's line bites: the violas' spiccato strikes each of its notes
    bite = b.part('b_bite', 'celli', role='lead2', art='spic', layer='full', gain=-3)
    rv.state(B, B_LINE, [(va, 0), (vn2, 0), (bite, -12)], MASK_B, ends=(2, 4, 6),
             transpose=12, dyn='mf')
    # A3: the flute an octave above the violins, for air at the top
    rv.state(A3, TUNE, [(vn, 0), (hn, -12), (fl8, 12)], MASK_A3, ends=(4, 8), transpose=12,
             dyn='ff')
    rv.state(T, TURN, [(va, 0)], MASK_TURN, ends=(1, 3), dyn='mp')

    # the whole breathes with its phrases: in on the question's landing, out
    # at the end of the answer
    for part in (va, vn2, vc, vn, hn, fl8):
        part.expr(*[(bar + d, v) for bar in range(A, T, 2) for d, v in
                    ((0, 0.86), (0.5, 0.92), (0.7, 1.0), (1.9, 0.84))])

    # the stretto (bars 27-28): the question every two beats, an octave higher
    # each time; the last lands on A3's downbeat. The calm hears only where
    # each one lands.
    st = [(27, -12, vc, 'cl'), (27.5, 0, va, 'hn'), (28, 12, vn2, 'fl'), (28.5, 24, vn, None)]
    for bar, tr, part, voice in st:
        # each entry struck, not slurred, so the four are heard one by one
        ns = notes_of(s, "@mf rq G3e' Bb3e' E4h> |", bar, tr)
        for n in ns:
            part.note(n.start, n.pitch, n.dur, vel=n.vel, staccato=n.staccato,
                      rearticulate=True)
        if voice:
            copy_note(rv.frag[voice], ns[-1])
    rv.frag['hp'].note(s.bar(28) + 3.0, 'G5', 0.5, vel=0.6)
    rv.frag['pz'].note(s.bar(28) + 3.5, 'Bb5', 0.5, vel=0.6)


def fog(b, s):
    """The bed both mixes share: the fog (fourths and fifths, breathing), the
    ground (a low tremolo), the harp's drops, the metal."""
    hi = b.part('fog_hi', 'violins2', role='pad', art='soft', gain=-5)
    lo = b.part('fog_lo', 'violas', role='pad', art='soft', gain=-7, calm_db=4, hpf=160)
    add_c = b.part('fog_calm', 'violins2', role='pad', art='soft', layer='calm', gain=-1)
    horns3 = b.part('fog_third', 'horns', role='pad', layer='full')
    str3 = b.part('fog_third_str', 'violins2', role='pad', art='soft', layer='full', gain=-1)
    drops = b.part('drops', 'harp', role='keys', gain=-4, calm_db=2, pan=-0.5)
    # (celli, not basses: the contrabass tremolo samples below D2 are out of
    # tune, a quarter-tone sharp on A1)
    ground = b.part('ground', 'celli', role='low', art='trem', gain=-6, calm_db=3,
                    eq=[('peak', 280, 1.0, -3.0)])
    steps = b.part('steps', 'celli', role='bass', art='pizz', layer='calm', gain=-4)

    for bar0, harm in STRAINS:
        # the fog sits above the tune when it is low, below it when it climbs
        high = bar0 in (INTRO, A, B, T)
        for i, (bs, shared, calm, full) in enumerate(harm):
            bar = bar0 + i
            t = s.bar(bar)
            chord = stack(shared, 64 if high else 55)
            # (B's first half has no fog at all: the ground, the drops, the steps)
            for p in chord if not B <= bar < B + 4 else ():
                (hi if high else lo).note(t, p, 4.0, vel=0.44, rearticulate=True)
            if calm:
                for p in stack(calm, chord[0] + 1)[:1]:
                    add_c.note(t, p, 4.0, vel=0.44, rearticulate=True)
            if full:
                names = shared.split()
                for p in stack(' '.join([names[0], full] + names[1:]), 52):
                    horns3.note(t, p, 4.0, vel=0.46, rearticulate=True)
                str3.note(t, stack(full, chord[0] + 1)[0], 4.0, vel=0.44, rearticulate=True)
            # the drops answer the question: two falling while its long note
            # holds, two more across the bar line, where the answer would be
            fall = falling(shared, 84 if high else 67)
            if i % 2 == 0:
                for off, p, v in ((3.0, fall[0], 0.5), (3.5, fall[1], 0.42)):
                    drops.note(t + off, p, 1.5, vel=v)
            else:
                for off, p, v in ((0.5, fall[2], 0.44), (1.0, fall[3 % len(fall)], 0.38)):
                    drops.note(t + off, p, 1.5, vel=v)
            ground.note(t, at_or_above(PC[bs], 43), 4.0, vel=0.42, rearticulate=True)
            # footsteps in the fog (calm): never on the same beats two bars
            # running; they change their gait strain by strain, closing in
            # through B, and all but stop in the turn
            root = at_or_above(PC[bs], 43)
            for off, low, v in STEPS[bar0][i % 2]:
                steps.note(t + off, root - (5 if low else 0), 1.0, vel=v)
    # where the fog lifts, the horns swell into the third and let it go
    horns3.expr(*[(bar + d, v) for bar0 in (A, A2, A3) for bar in (bar0 + 3, bar0 + 7)
                  for d, v in ((0, 0.55), (0.5, 1.0), (0.95, 0.6))])
    # the fog breathes: in over two bars, out over two
    for p in (hi, lo):
        p.expr(*[(bar + d, v) for bar in range(1, END, 2) for d, v in
                 ((0, 0.62), (0.6, 0.88), (1.1, 1.0), (1.6, 0.84))])
    ground.expr(*[(bar + d, v) for bar in range(1, END, 2) for d, v in ((0, 0.6), (1.5, 1.0),
                                                                      (1.95, 0.65))])

    # bowed metal at the phrase ends, and the bass drum's rub under each strain
    # (the last one early enough that its ring has died before the loop point)
    metal = b.part('metal', 'orch_perc', role='accent', gain=-2)
    for n, beat in enumerate([s.bar(3) + 2.0] + [s.bar(bar) + 1.0 for bar in range(8, 40, 4)]
                             + [s.bar(39) + 3.0]):
        metal.note(beat, 102, 3.0, vel=0.5)
    # (the rub samples are pitched: key 35 rumbles on G, key 33 on C)
    rub = b.part('rub', 'orch_perc', role='accent', gain=-4, eq=[('lowpass', 160, 0.7, 0)])
    for bar in (1, A, A2, B, A3, T):
        # (the C rub is the loudest sample: played softer)
        rub.note(s.bar(bar), 33 if bar == B else 35, 4.0, vel=0.4 if bar == B else 0.55)
    # timpani: a soft roll at each strain head (both mixes; softer in calm)
    tp = b.part('timp', 'timpani', role='timp', calm_db=-5)
    tp.at(1).play('%roll @pp G2w~ | G2w | rw | rw |')
    for bar, p in ((A, 'G2'), (A2, 'G2'), (B, 'C3'), (T, 'G2')):
        tp.at(bar).play(f'%roll @pp {p}w |')


# drum grids (16 steps a bar): the stalk, two bars that never settle on a
# backbeat; soft toms (taiko) high and low
STALK = [{'hi': 'x.....x.x.......', 'lo': '..........x.....'},
         {'hi': 'x.........x...x.', 'lo': '....x...........'}]
HUNT = [{'hi': 'x.....x.x...x...', 'lo': '..x.......x...x.'},
        {'hi': 'x.....x...x.x...', 'lo': '..x.x.......x.x.'}]


# The GeneralUser taiko is tuned half a semitone per key, so its written
# key is not what sounds: key 55 rings on D, key 41 on G.
TOM_HI, TOM_LO = 55, 41


def toms(part, bar, grid, vel):
    for key, pat in grid.items():
        pitch = TOM_HI if key == 'hi' else TOM_LO
        for i, c in enumerate(pat):
            if c != '.':
                part.note(part.score.bar(bar) + i * 0.25, pitch, 0.5,
                          vel=vel + (0.12 if i == 0 else 0.0))


def stalk(bar):
    """The stalk's hits in a bar: (beat offset, accented)."""
    return [(0.0, True), (1.5, False), (2.0, True)] if bar % 2 else \
        [(0.0, True), (2.5, False), (3.5, False)]


def full_layers(b, s):
    # A: the stalk, in the low strings and the toms: the enemy's gait
    stalk_vc = b.part('stalk_vc', 'celli', role='ostinato', art='spic', layer='full', gain=-2)
    stalk_cb = b.part('stalk_cb', 'basses', role='low', art='spic', layer='full', gain=-3)
    for bar in range(A, A2):
        root = at_or_above(PC[bass_of(bar)], 43)
        for off, acc in stalk(bar):
            v = 0.62 if acc else 0.5
            stalk_vc.note(s.bar(bar) + off, root, 0.5, vel=v)
            stalk_cb.note(s.bar(bar) + off, root - 12, 0.5, vel=v)

    # the motor: celli spiccato eighths from A2 on; basses on the beats from B
    motor = b.part('motor_vc', 'celli', role='ostinato', art='spic', layer='full',
                   eq=[('peak', 320, 1.0, -3.0)])
    motor_cb = b.part('motor_cb', 'basses', role='low', art='spic', layer='full', gain=-5)
    shape = [0, 0, 7, 0, 12, 0, 7, 0]
    for bar in range(A2, T + 2):
        root = at_or_above(PC[bass_of(bar)], 43)
        late = B <= bar < T
        for k, d in enumerate(shape):
            v = 0.48 + (0.14 if k in (0, 4) else 0.0) + (0.06 if late else 0.0)
            motor.note(s.bar(bar) + k * 0.5, root + d, 0.5, vel=v)
            if late and k in (0, 4):
                motor_cb.note(s.bar(bar) + k * 0.5, root - 12, 0.5, vel=v)

    # B: the second violins' spiccato sixteenths on the fog's notes: the hunt
    sh = b.part('shimmer', 'violins2', role='ostinato', art='spic', layer='full', gain=-2)
    for bar in range(B, A3):
        chord = stack(HARM_B[bar - B][1], 76)
        grow = 0.025 * (bar - B)
        for k in range(16):
            sh.note(s.bar(bar) + k * 0.25, chord[[0, 1, 2, 1][k % 4]], 0.25,
                    vel=0.4 + (0.1 if k % 4 == 0 else 0) + grow)
    # B closes in: everything that drives it grows from its first bar to the stretto
    for part in (sh, motor, motor_cb):
        part.expr((A, 1.0), (B - 0.05, 1.0), (B, 0.72), (A3 - 0.05, 1.0), (A3, 1.0))

    # soft toms (taiko) and the bass drum
    tk = b.part('toms', 'taiko', role='accent', layer='full', gain=-1,
                eq=[('peak', 300, 1.0, -4.0), ('peak', 3500, 1.0, 2.0)])
    for bar in range(A, A2):
        for off, acc in stalk(bar):
            tk.note(s.bar(bar) + off, TOM_HI if acc else TOM_LO, 0.5,
                    vel=0.55 if acc else 0.42)
    for bar in range(A2, B):
        toms(tk, bar, STALK[(bar - A2) % 2], 0.5)
    for bar in range(B, A3):
        toms(tk, bar, HUNT[(bar - B) % 2], 0.56)
    for bar in range(A3, T):
        toms(tk, bar, STALK[(bar - A3) % 2], 0.6)
    toms(tk, T, STALK[0], 0.5)
    toms(tk, T + 2, {'hi': 'x...............'}, 0.4)
    bd = b.part('bd', 'orch_perc', role='accent', layer='full', gain=-2)
    # a suspended cymbal swells through the stretto and peaks on A3's downbeat
    swell = b.part('swell', 'orch_perc', role='accent', layer='full', gain=-3)
    swell.note(s.bar(27) + 2.08, 48, 6.0, vel=0.6)
    for bar in list(range(A, B, 4)) + list(range(B, A3, 2)) + list(range(A3, T, 2)) + [T]:
        drums(bd, bar, {'bd': 'x'}, vel=0.7)
    # the stretto's landings struck
    for beat in (s.bar(27) + 2, s.bar(28), s.bar(28) + 2):
        tk.note(beat, TOM_HI, 0.5, vel=0.7)
        bd.note(beat, 36, 0.5, vel=0.62)

    # timpani strokes (full): A3's arrival and its stalk, the stretto counted
    # in, the swell into B, the turn
    tp = b.part('timp_f', 'timpani', role='timp', layer='full')
    tp.at(4).play('%roll @pp D2w |')
    tp.at(20).play('%roll @p C3h @mf C3h |')
    tp.at(26).play('%roll @pp A2h @mp A2h |')
    tp.at(27).play('%default @mf D2e D2e rq D2e D2e rq | D2e D2e D2e D2e %roll @f D2h |')
    for bar in range(A3, T):
        root = at_or_above(PC[bass_of(bar)], 38)
        for off, acc in stalk(bar):
            tp.note(s.bar(bar) + off, root, 0.5, vel=0.88 if acc else 0.66, art='default')
    tp.at(40).play('%roll @pp D2h @mp D2h |')

    # brass: trombones on the fog's fourths through B (swelling in from bar
    # 20); in A3 the fourths are struck on the stalk, trombones and tuba
    # B's fourths go to the horns, above the circling line, and the
    # trombones join for the stretto (a low pad under the line was mud)
    bhn = b.part('b_hn', 'horns', role='pad', layer='full', gain=-2)
    for p in stack('G C F', 50):
        bhn.note(s.bar(20) + 2, p, 2.0, vel=0.4, rearticulate=True)
    for bar in range(B, 27):
        for p in stack(HARM_B[bar - B][1], 50):
            bhn.note(s.bar(bar), p, 4.0, vel=0.46, rearticulate=True)
    bhn.expr((20, 0.4), (21, 0.8), (24.9, 0.8), (26.9, 1.0))
    tbn = b.part('tbn', 'trombones', role='pad', layer='full', gain=-2)
    for bar in (27, 28):
        for p in stack(HARM_B[bar - B][1], 52):
            tbn.note(s.bar(bar), p, 4.0, vel=0.5, rearticulate=True)
    tbn.expr((27, 0.5), (28.9, 1.0))
    stab = b.part('stab_tbn', 'trombones', role='section', art='stac', layer='full', gain=-2,
                  eq=[('peak', 300, 1.0, -2.0)])
    stab_tu = b.part('stab_tuba', 'tuba', role='low', art='stac', layer='full', gain=-3)
    for bar in range(A3, T):
        chord = stack(HARM_A[bar - A3][1], 50)
        for off, acc in stalk(bar):
            for p in chord:
                stab.note(s.bar(bar) + off, p, 0.5, vel=0.8 if acc else 0.64)
            # (the tuba sits out the C bar: its staccato C2 sample is 60 cents flat)
            if bass_of(bar) != 'C':
                stab_tu.note(s.bar(bar) + off, at_or_above(PC[bass_of(bar)], 31), 0.5,
                             vel=0.72 if acc else 0.58)
