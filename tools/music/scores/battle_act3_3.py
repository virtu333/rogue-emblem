"""Act III battle III — "Petals on the Fen".

Sacred ground that grieves: the tragic field battle of Act III, in B minor,
6/8 at a slow lilt. Its instability is contraction, not cross-rhythm (the
3:2 belongs to the other Act III themes): when the tune returns, its bars
come back shorter — 5/8 and 4/8 bars inside the 6/8 — with every note attack
kept and only the breath between them taken away, the shortest bar always
the one before a downbeat that matters.

The tune (violins; calm: oboe, then solo violin) sits on F-sharp:

  F#5 D5 E5 F#5 | B5 A5 F#5~ | F#5 G5 E5 | D5 B4 |
  G5 F#5 E5 F#5 | C6 B5 G5 F#5~ | F#5 (held) | D5 C#5 |

and its harmony moves as little as it can while the bass stays on B:
bars 1-2 are B minor and bars 3-4 G major over the same B — one voice
(second violins, F#4 to G4) is the whole change, and the melody makes the
same step (F#5 to G5) in bar 3. Bars 5-6 leave for the lowered-second
region, C with a raised eleventh, and come home in bar 7 through the F-sharp
the melody has been holding: sharp eleventh over C, fifth over B. In the
last return the flat second comes early (bar 3 of the phrase, not bar 5),
under the same notes. A fast sixteenth cell (piano, later second violins
and harp) runs under the later strains: a plunge of a tenth from the chord's
top, then a scale climbing back — F#6 D5 E5 F#5 G5 A5 — and in a contracted
bar the climb is cut short.

Form (6/8 bars): intro 1-4 (harp: B minor, then G over B) | A1 5-12 |
A2 13-20 | B 21-28 (petals: falling thirds over a descending bass, choir) |
B2 29-36 (the lament, below) | A' 37-43 (the tune contracted:
5+6+4+6+5+6+6+4 eighths, seven bars) | A'' 44-49 (5+5+4+5+4+5+4+4, six bars,
the flat second re-timed) | turn 50-53, which closes on the tonic with its own
flat second jammed inside it (C natural in the violas) and five stabs in the
time of four eighths, never through the dominant.

B2 is a lament over a four-bar ground heard twice, one chord per dotted
quarter. The bass falls B-A-G-F#, leaps a tritone up to C (the A strain's
flat second, with the same sharp eleventh in the second violins) and falls a
semitone home to B. Then comes a whole bar of E major, and the next B arrives
plagally. The tune climbs against the falling ground. The first time it
reaches E6 over C and holds it into B minor as a fourth that sighs to the
third. The second time it reaches F#6, held from C (sharp eleventh) into
B minor (fifth), the A strain's common tone at the top of the piece. On the
last IV the second violins' one voice moves G# to G, as it moved F# to G in
the A strain, so the major IV turns minor and the plagal step is the return
of the tune itself (its F#, over B). There is no dominant anywhere.

After A Funeral of Flowers, and where it isn't. Taken from its score: the
lament bass (a falling minor tetrachord, a tritone leap up to the flat second,
a semitone fall to the tonic), plagal arrivals with the dominant left out, and
(as the study read it) a fast figuration cell: a high note, a plunge, a climb
back. The lament's pacing and harmony, the tune over it and the E-major IV
are this piece's own. So are three devices sometimes credited to Funeral.
First, Bm to G/B over a kept B: Funeral's bass moves, down its lament.
Second, the returning tune contracted bar by bar: Funeral's odd bars sit at
its hinge and in its closing field, and they lengthen (6/4, 7/8) as often as
they shorten (2/4). Third, the five stabs in the time of four: Funeral's
closing stabs slow down (a triplet, then two plain eighths).
An earlier version of B2 held the petals over a B pedal for eight bars,
modelled on a "thirteen-bar B pedal" that Funeral does not have.

No leitmotif is quoted: this ground has its own dead. Choir is spent here
(Act III). Calm: one voice on the tune over the low strings, a piano in
quarters for A1 and B, and from A2 on the cell itself on the harp, wherever
the full mix has it, in place of the piano.
"""

from engine.patterns import Kit, arp, bass, chart, drums, ostinato, pad
from engine.score import Score, _CHORD_RE, _NOTE_RE, _REST_RE, _TOKEN_RE, parse_duration
from engine.theory import Chord

from scores._battle import Battle

KEY = 'music_battle_act3_3'

E8 = 0.5           # one eighth note, in beats
BAR = 6            # eighths in a 6/8 bar

# ------------------------------------------------------------------ the A strain
# One entry per bar of the tune, in three lengths: the note that yields when
# the bar is contracted is always a long one, never an attack.
A_MEL = {
    6: ['F#5q. D5e E5e F#5e', 'B5q. A5e F#5q~', 'F#5e G5q E5q.', 'D5q. B4q.',
        'G5q. F#5e E5e F#5e', 'C6q. B5e G5e F#5e~', 'F#5h.', 'D5q. C#5q.'],
    5: ['F#5q D5e E5e F#5e', 'B5q A5e F#5q~', 'F#5e G5q E5q', 'D5q. B4q',
        'G5q F#5e E5e F#5e', 'C6q B5e G5e F#5e~', 'F#5h+e', 'D5q. C#5q'],
    4: ['F#5e D5e E5e F#5e', 'B5q A5e F#5e~', 'F#5e G5q E5e', 'D5q B4q',
        'G5e F#5e E5e F#5e', 'C6e B5e G5e F#5e~', 'F#5h', 'D5q C#5q'],
}
# harmony per bar: the bass stays on B for four bars; the pad keeps B and D
# under both chords, and the second violins' single voice makes the change
A_CH = ['Bm', 'Bm', 'G/B', 'G/B', 'C', 'C', 'Bm', 'D/F#']
A_PAD = ['[B3 D4]', '[B3 D4]', '[B3 D4]', '[B3 D4]', '[C4 E4 G4]', '[C4 E4 G4]', '[B3 D4]', '[A3 D4]']
A_VOICE = ['F#4', 'F#4', 'G4', 'G4', 'F#4', 'F#4', 'F#4', 'F#4']
# the sixteenth cell per bar: a plunge from the top note, then the climb back
A_CELL = [('F#6', 'D5 E5 F#5 G5 A5'), ('F#6', 'D5 E5 F#5 G5 A5'),
          ('G6', 'D5 E5 F#5 G5 A5'), ('G6', 'D5 E5 F#5 G5 A5'),
          ('G6', 'E5 F#5 G5 A5 B5'), ('G6', 'E5 F#5 G5 A5 B5'),
          ('F#6', 'D5 E5 F#5 G5 A5'), ('F#6', 'D5 E5 F#5 G5 A5')]

FULL = [6] * 8
CONTRACT_1 = [5, 6, 4, 6, 5, 6, 6, 4]     # 42 eighths: seven bars of 6/8
CONTRACT_2 = [5, 5, 4, 5, 4, 5, 4, 4]     # 36 eighths: six bars
EARLY_BII = [0, 1, 4, 5, 2, 3, 6, 7]      # the harmony of A'' : C in bars 3-4, G/B in 5-6
assert sum(CONTRACT_1) == 7 * BAR and sum(CONTRACT_2) == 6 * BAR

# ------------------------------------------------------------------ the B strain (petals)
PETALS = """
D6q. B5q. | C6q. A5q. | B5q. G5q. | A5h. | G5q. E5q. | F#5q. D5q. | E5q. G5e F#5e E5e | C#6q. A5q. |
"""
PETALS_LOW = """
B4q. G4q. | A4q. F#4q. | G4q. E4q. | F#4h. | E4q. C4q. | D4q. B3q. | B3h. | A3q. C#4q. |
"""
CH_B = chart('G:3 D/F#:3 Em:3 Bm/D:3 C:3 Bm:3 Em:3 F#m:3')

# ------------------------------------------------------------------ the B2 strain (the lament)
# A four-bar ground, twice, one chord per dotted quarter: the bass falls B A G F#, leaps
# a tritone up to C (the flat second, the A strain's own C with its sharp eleventh) and
# falls a semitone home to B; then a whole bar on E, the major IV, and the next B comes
# plagally. The second time the IV turns minor inside its bar (the violins' one voice
# moving G# to G, as it moved F# to G in the A strain) and the plagal step is the return
# of the tune itself. No dominant anywhere.
B2_CH = ['Bm', 'Bm/A', 'G', 'D/F#', 'C', 'Bm', 'E', None,     # None: the chord holds on
         'Bm', 'Bm/A', 'Em/G', 'D/F#', 'C', 'Bm', 'E', 'Em']
B2_SPANS = []                                                    # (chord name, beats)
for _c in B2_CH:
    if _c is None:
        B2_SPANS[-1] = (B2_SPANS[-1][0], B2_SPANS[-1][1] + 1.5)
    else:
        B2_SPANS.append((_c, 1.5))
CH_B2 = [(Chord(c), d) for c, d in B2_SPANS]
# the tune climbs against the falling ground: to E6 over C, held into B minor as a fourth
# that sighs to the third; to F#6 the second time, held from C (sharp eleventh) into B
# minor (fifth), the A strain's common tone at the top of the piece's range
LAMENT = """
F#5q. F#5e G5e A5e | B5q. A5e B5e D6e | E6q.~ E6e D6q | B5q. G#5q. |
F#5q. B5e C#6e D6e | E6q. D6q. | F#6h. | B5h. |
"""
# the violas under it, and the one voice (second violins) that moves: F#4, G4 under G
# (and Em/G), F#4 again as the sharp eleventh over C, G#4 on the IV, G4 when it turns
B2_PAD = {'Bm': '[B3 D4]', 'Bm/A': '[B3 D4]', 'G': '[B3 D4]', 'D/F#': '[A3 D4]',
          'C': '[C4 E4 G4]', 'E': '[B3 E4]', 'Em': '[B3 E4]', 'Em/G': '[B3 E4]'}
B2_VOICE = {'Bm': 'F#4', 'Bm/A': 'F#4', 'G': 'G4', 'D/F#': 'F#4', 'C': 'F#4', 'E': 'G#4',
            'Em': 'G4', 'Em/G': 'G4'}
# the sixteenth cell, one per dotted quarter (over C its top is E6, under the held F#6)
B2_CELL = {'Bm': ('F#6', 'B4 C#5 D5 E5 F#5'), 'Bm/A': ('F#6', 'A4 B4 D5 E5 F#5'),
           'G': ('G6', 'B4 D5 E5 F#5 G5'), 'D/F#': ('F#6', 'A4 B4 D5 E5 F#5'),
           'C': ('E6', 'C5 D5 E5 F#5 G5'), 'E': ('G#6', 'B4 C#5 E5 F#5 G#5'),
           'Em': ('G6', 'B4 C#5 E5 F#5 G5'), 'Em/G': ('G6', 'B4 D5 E5 F#5 G5')}
TURN = 'B4q. D5q. | E5q. G5q. | F#5h. | F#5h. |'
CH_TURN = chart('G/B:3 C:3 Bm:3 Bm:3')
TURN_CELL = [('G6', 'D5 E5 F#5 G5 A5'), ('G6', 'E5 F#5 G5 A5 B5'), ('F#6', 'D5 E5 F#5 G5 A5'),
             ('F#6', 'B4 C5 D5 E5 F#5')]
# the closing stabs: a quarter rest, then five in the time of four eighths
STAB = ':0.4 ' * 5

# 6/8 grooves by sub-bar length, eighth-note cells
GROOVE = {
    6: {'kick': 'x..x..', 'rim': '...x..', 'ride': 'x.xx.x'},
    5: {'kick': 'x..x.', 'rim': '...x.', 'ride': 'x.xx.'},
    4: {'kick': 'x.x.', 'rim': '..x.', 'ride': 'x.x.'},
}
GROOVE_HARD = {
    6: {'kick': 'x..x..', 'snare': '...x..', 'hat': 'xxxxxx'},
    5: {'kick': 'x..x.', 'snare': '...x.', 'hat': 'xxxxx'},
    4: {'kick': 'x.x.', 'snare': '..x.', 'hat': 'xxxx'},
}
HALF = {'kick': 'x.....', 'rim': '...x..', 'ride': 'x..x..'}
FILL6 = {'kick': 'x..x..', 'snare': '...xxx', 'tom_lo': 'x.....'}


def eighths(text):
    """Eighth notes a note string spans: the bar check for sub-bars that have
    no barline of their own."""
    total, last = 0.0, 1.0
    for tok in _TOKEN_RE.findall(text):
        if tok.startswith(('@', '%', '<')) or tok == '|':
            continue
        m = _REST_RE.match(tok) or _NOTE_RE.match(tok) or _CHORD_RE.match(tok)
        if not m:
            raise ValueError(tok)
        d = parse_duration(m.group('d')) if m.group('d') else last
        last = d
        total += d
    return total / E8


def lay(part, bar, lengths, texts, dyn=None, art=None, transpose=0):
    """Play one text per sub-bar from `bar` as a single phrase (so ties hold
    across sub-bars), checking that each text is exactly its sub-bar long."""
    for n, t in zip(lengths, texts):
        if abs(eighths(t) - n) > 1e-6:
            raise ValueError(f'{t!r} spans {eighths(t)} eighths, sub-bar is {n}')
    prefix = (f'@{dyn} ' if dyn else '') + (f'%{art} ' if art else '')
    part.at(bar).play(prefix + ' '.join(texts), transpose=transpose)


def cell_text(cells, k):
    top, climb = cells
    cell = [top] + climb.split()
    return ' '.join(f'{cell[j % 6]}s' for j in range(2 * k))   # cut where the bar ends


# B2 by dotted quarter (a held chord repeats its name), and its cell by bar
B2_SLOTS = []
for _c in B2_CH:
    B2_SLOTS.append(_c or B2_SLOTS[-1])
B2_CELLS = [cell_text(B2_CELL[B2_SLOTS[2 * i]], 3) + ' ' + cell_text(B2_CELL[B2_SLOTS[2 * i + 1]], 3)
            for i in range(8)]


def held(tokens, beats=1.5):
    """One pitch or chord per dotted quarter, repeats merged into one held note."""
    out = []
    for tok in tokens:
        if out and out[-1][0] == tok:
            out[-1][1] += beats
        else:
            out.append([tok, beats])
    return ' '.join(f'{tok}:{d:g}' for tok, d in out)


def strain(lengths, order=None):
    """The A material laid into sub-bars of the given lengths; `order` maps
    each bar to the harmony it carries (the tune itself never changes)."""
    n = len(lengths)
    order = order or list(range(n))
    mel = [A_MEL[k][i] for i, k in enumerate(lengths)]
    pad_t = [f'{A_PAD[order[i]]}:{k * E8}' for i, k in enumerate(lengths)]
    voice = []
    for i, k in enumerate(lengths):
        tie = '~' if i + 1 < n and A_VOICE[order[i + 1]] == A_VOICE[order[i]] else ''
        voice.append(f'{A_VOICE[order[i]]}:{k * E8}{tie}')
    cells = [cell_text(A_CELL[order[i]], k) for i, k in enumerate(lengths)]
    ch = [(Chord(A_CH[order[i]]), k * E8) for i, k in enumerate(lengths)]
    return dict(mel=mel, pad=pad_t, voice=voice, cell=cells, chart=ch)


def build():
    s = Score('battle_act3_3', tonic='B', bpm=132, meter=(6, 8), intro_bars=4, loop_bars=49,
              title='Petals on the Fen', seed=113)
    s.reverb = dict(rt60=2.9, predelay_ms=30, wet_db=0.5, damp=0.5)
    s.master = dict(lufs=-14.0, glue_ratio=1.5)
    b = Battle(s, calm_lufs=-17.0, full_lufs=-14.0)

    A1, A2, B1, B2, AP, APP, T = 5, 13, 21, 29, 37, 44, 50
    S_FULL, S_C1, S_C2 = strain(FULL), strain(CONTRACT_1), strain(CONTRACT_2, EARLY_BII)
    b.section('intro', 1, chart('Bm:3 Bm:3 G/B:3 G/B:3'))
    b.section('A1', A1, S_FULL['chart']).section('A2', A2, S_FULL['chart'])
    b.section('B', B1, CH_B).section('B2', B2, CH_B2)
    b.section('AP', AP, S_C1['chart']).section('APP', APP, S_C2['chart'])
    b.section('turn', T, CH_TURN)
    strains = ((A1, FULL, S_FULL), (A2, FULL, S_FULL), (AP, CONTRACT_1, S_C1), (APP, CONTRACT_2, S_C2))

    # ---------------------------------------------------------------- intro
    hp = b.part('harp', 'harp', role='keys', calm_db=2)
    arp(hp, 1, b.chart('intro'), '0 1 2 3 4 5', step=0.5, lo=47, hi=74, vel=0.5)
    cb_soft = b.part('cb_intro', 'basses', role='low', art='soft')
    cb_soft.at(1).play('@p B1h.~ | B1h.~ | B1h.~ | B1h. |')
    cb_soft.expr((1, 0.5), (4.9, 0.9))

    # ---------------------------------------------------------------- the tune
    vn = b.part('mel_vn', 'violins', role='lead', calm_db=None)
    b.full_only.add('mel_vn')
    lay(vn, A1, FULL, S_FULL['mel'], dyn='mf', art='sus')
    lay(vn, A2, FULL, S_FULL['mel'], dyn='f')
    lay(vn, AP, CONTRACT_1, S_C1['mel'], dyn='ff')
    lay(vn, APP, CONTRACT_2, S_C2['mel'], dyn='ff')
    vn.at(B1).play('@mf' + PETALS)
    vn.at(B2).play('@f' + LAMENT)
    vn.at(T).play('@f' + TURN)
    vn.expr((A1, 0.8), (A2 - 0.1, 0.9), (A2, 0.9), (B1 - 0.1, 1.0), (B1, 0.85), (B2, 0.95),
            (AP, 1.0), (T, 0.9), (T + 3.9, 1.0))
    hn = b.part('hn_mel', 'horns', role='lead2', layer='full')
    lay(hn, A2, FULL, S_FULL['mel'], dyn='f', transpose=-12)
    lay(hn, AP, CONTRACT_1, S_C1['mel'], dyn='ff', transpose=-12)
    # (the horns can't take the high F#: under it they sing the lament's C falling to B)
    hn.at(B2).play('@f' + LAMENT.replace('| F#6h. |', '| C6q. B5q. |'), transpose=-12)
    vn2_mel = b.part('mel_vn2', 'violins2', role='lead2', layer='full')
    lay(vn2_mel, APP, CONTRACT_2, S_C2['mel'], dyn='ff', transpose=-12)
    ch_lead = b.part('choir_lead', 'choir', role='lead2', layer='full')
    lay(ch_lead, APP, CONTRACT_2, S_C2['mel'], dyn='f', transpose=-12)
    # the petals: falling thirds, paired in the violas (B only: B2 is the lament)
    va_low = b.part('petals_va', 'violas', role='counter', calm_db=-4)
    va_low.at(B1).play('@mf %sus' + PETALS_LOW)

    # calm voices
    ob = b.part('ob', 'oboe', role='lead', layer='calm')
    lay(ob, A1, FULL, S_FULL['mel'], dyn='mf')
    solo = b.part('solo', 'solo_violin', role='lead', layer='calm')
    lay(solo, A2, FULL, S_FULL['mel'], dyn='mf')
    lay(solo, AP, CONTRACT_1, S_C1['mel'], dyn='f')
    solo.expr((A2, 0.85), (A2 + 7.9, 1.0), (AP, 0.9), (AP + 6.9, 1.0))
    fl = b.part('fl', 'flute', role='lead', layer='calm')
    fl.at(B1).play('@mf' + PETALS)
    lay(fl, APP, CONTRACT_2, S_C2['mel'], dyn='f')
    fl.at(T).play('@mf' + TURN, transpose=12)
    cl = b.part('cl', 'clarinet', role='lead', layer='calm')
    cl.at(B2).play('@mf' + LAMENT)

    # ---------------------------------------------------------------- harmony: one voice moves
    pad_va = b.part('pad_va', 'violas', role='pad', calm_db=-3)
    voice = b.part('voice_vn2', 'violins2', role='pad', calm_db=-2)
    for bar, lengths, st in strains:
        lay(pad_va, bar, lengths, st['pad'], dyn='mp', art='sus')
        # F#4 under B minor, G4 under G/B (the only note that moves), then F#4
        # again: sharp eleventh over C, fifth over B, third over D/F#. The
        # semitone against the pad's G under C is the raised eleventh.
        lay(voice, bar, lengths, st['voice'], dyn='mp', art='sus')
    b.pads('B', 'violas', n=2, lo=53, hi=67, vel=0.5, name='pad_va')
    # B2: the same two strings over the lament, a repeated chord or note held on
    pad_va.at(B2).play('@mp %sus ' + held(B2_PAD[c] for c in B2_SLOTS))
    voice.at(B2).play('@mp %sus ' + held(B2_VOICE[c] for c in B2_SLOTS))
    pad(pad_va, T, CH_TURN[:3], n=2, lo=53, hi=67, vel=0.55, art='sus')
    # the last bar: the tonic with its flat second inside it, struck five
    # times in the time of four eighths, under the violins' held F-sharp
    pad_va.at(T + 3).play('@f %stac rq' + ' [B3 C4 F#4]:0.4' * 5 + ' |')
    stab_hn = b.part('stab_hn', 'horns', role='accent', art='stac', layer='full')
    stab_hn.at(T + 3).play('@f rq' + ' [B3 F#4]:0.4' * 5 + ' |')
    stab_tbn = b.part('stab_tbn', 'trombones', role='accent', art='stac', layer='full')
    stab_tbn.at(T + 3).play('@f rq' + ' [B2 F#3]:0.4' * 5 + ' |')

    # ---------------------------------------------------------------- the cell
    # (the cell sits 3 dB under the keys level so it fills, never competes)
    pno = b.part('cell_pno', 'grand', role='keys', layer='full', gain=-3)
    vn2_cell = b.part('cell_vn2', 'violins2', role='ostinato', art='spic', layer='full')
    hp_cell = b.part('cell_harp', 'harp', role='keys', layer='full')
    for bar, lengths, st in strains[1:]:
        lay(pno, bar, lengths, st['cell'], dyn='mf')
    for bar, lengths, st in strains[2:]:
        lay(vn2_cell, bar, lengths, st['cell'], dyn='mf')
    lay(hp_cell, APP, CONTRACT_2, S_C2['cell'], dyn='mf')
    lay(pno, B2, [6] * 8, B2_CELLS, dyn='mf')
    lay(pno, T, [6] * 4, [cell_text(c, 6) for c in TURN_CELL], dyn='f')
    lay(vn2_cell, T, [6] * 3, [cell_text(c, 6) for c in TURN_CELL[:3]], dyn='f')
    # calm: the harp takes the cell wherever the full mix has it (A2 on; B keeps none),
    # in place of the piano's quarters
    c_cell = b.part('c_cell_harp', 'harp', role='keys', layer='calm', calm_db=-2)
    for bar, lengths, st in strains[1:]:
        lay(c_cell, bar, lengths, st['cell'], dyn='mp')
    lay(c_cell, B2, [6] * 8, B2_CELLS, dyn='mp')
    lay(c_cell, T, [6] * 4, [cell_text(c, 6) for c in TURN_CELL], dyn='mp')

    # ---------------------------------------------------------------- low strings, bass
    vc = b.part('vc', 'celli', role='ostinato', art='spic', layer='full')
    cb = b.part('cb', 'basses', role='low', layer='full')
    for sec in ('A1', 'A2', 'AP', 'APP', 'turn'):
        ostinato(vc, b.bar(sec), b.chart(sec), 'e e e e e e', 'b b b b b b', lo=40, hi=57,
                 vel=0.54, accents='> - - > - -')
        bass(cb, b.bar(sec), b.chart(sec), 'q. q.', 'b b', floor=26, vel=0.64, art='spic')
    for sec in ('B', 'B2'):
        bass(cb, b.bar(sec), b.chart(sec), 'h.', 'b', floor=26, vel=0.6, art='sus')
        bass(vc, b.bar(sec), b.chart(sec), 'q. q.', 'b 5', floor=38, vel=0.56, art='sus')
    for sec in ('A2', 'B2', 'AP', 'APP', 'turn'):
        b.rbass(sec, rhythm='e e e e e e', notes='r r r r r 8', accents='> - - > - -')
        b.sub(sec)
    b.rbass('B', rhythm='q. q.', notes='r 5', accents=None)

    # ---------------------------------------------------------------- choir, brass
    b.choir('B', 'oohs', n=3, lo=55, hi=72, vel=0.5)
    b.choir('B2', 'choir', n=3, lo=55, hi=74, vel=0.6)
    b.choir('AP', 'oohs', n=3, lo=52, hi=69, vel=0.55)
    b.choir('turn', 'choir', n=3, lo=55, hi=74, vel=0.6)
    b.brass_pad('B2', 'trombones', n=2, lo=43, hi=60, vel=0.55)
    b.brass_pad('APP', 'horns', n=3, lo=50, hi=65, vel=0.55)
    tbn_pad = b.part('bpad_trombones', 'trombones', role='pad', layer='full')
    pad(tbn_pad, T, CH_TURN[:3], n=2, lo=43, hi=60, vel=0.6)

    # ---------------------------------------------------------------- drums
    b.groove('A1', GROOVE[6], FILL6, every=8, vel=0.62)
    b.groove('A2', GROOVE[6], FILL6, every=4, vel=0.7)
    b.groove('B', HALF, FILL6, every=8, vel=0.66)
    b.groove('B2', GROOVE_HARD[6], FILL6, every=4, vel=0.72)
    for bar, lengths, grooves, vel in ((AP, CONTRACT_1, GROOVE, 0.74), (APP, CONTRACT_2, GROOVE_HARD, 0.76)):
        pos = s.bar(bar)
        for i, k in enumerate(lengths):
            b.kit.play(1 + pos / s.bar_beats, grooves[k], step=E8, vel=vel)
            pos += k * E8
        b.kit.play(bar, {'crash': 'X'})
    b.kit.play(T, GROOVE_HARD[6], vel=0.74)
    b.kit.play(T + 1, GROOVE_HARD[6], vel=0.74)
    b.kit.play(T + 2, {'kick': 'x..x..', 'snare': 'x..x..', 'tom_lo': '..x..x'}, vel=0.74)
    b.kit.play(T + 3, {'kick': 'x.', 'crash': 'x.'}, step=E8, vel=0.8)
    b.kit.play(T + 3 + 1 / 3, {'kick': 'xxxxx', 'snare': 'xxxxX'}, step=0.4, vel=0.8)
    b.kit.play(T, {'crash': 'X'})

    b.timp('intro', 'rh. | rh. | rh. | %roll @mp B2h. |')
    b.timp('A1', '@f B2q. rq. |')
    b.timp('A2', '@f B2q. rq. |')
    b.timp('B', '@f G2q. rq. |')
    b.timp('B2', '@f B2q. rq. |')
    b.timp('AP', '@ff B2q. rq. |')
    b.timp('APP', '@ff B2q. rq. |')
    b.timp('turn', '@f rh. | rh. | %roll @mf B2h. | %default @ff rq' + ' B2:0.4' * 5 + ' |')
    for bar in (A1, A2, B1, B2, AP, APP):
        b.hit(bar)
    b.riser(B2 + 6, beats=6)
    b.riser(T + 2, beats=6)

    # ---------------------------------------------------------------- calm bed
    for sec in ('A1', 'A2', 'B', 'B2', 'AP', 'APP', 'turn'):
        b.calm_bed(sec, piano='0 2 4', piano_step=1.0, pad_n=0, heartbeat=False)
    # the piano's quarters stay only where the harp has no cell (A1 and B)
    c_pno = s.parts['c_pno']
    c_pno.notes = [n for n in c_pno.notes
                   if n.start < s.bar(A2) or s.bar(B1) <= n.start < s.bar(B2)]
    ck = Kit(s, 'ckit', gains={'kick': -4})
    b.calm_only.update(ck.names())
    for sec in ('A1', 'A2', 'B', 'B2', 'turn'):
        for bar in range(b.bar(sec), b.bar(sec) + b._bars(sec)):
            ck.play(bar, {'kick': 'x.....'}, vel=0.42)
    for bar, lengths in ((AP, CONTRACT_1), (APP, CONTRACT_2)):
        pos = s.bar(bar)
        for k in lengths:
            ck.play(1 + pos / s.bar_beats, {'kick': 'x' + '.' * (k - 1)}, step=E8, vel=0.42)
            pos += k * E8
    return b.finish()
