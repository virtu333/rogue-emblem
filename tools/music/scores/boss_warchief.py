"""Act I boss (the Warchief) — "Breaker of Treaties".

The border clans buried the old kingdom's treaties with the old kingdom, and
answer the empire's new terms with none of their own. Their Warchief laughs
("HAH!"), wants his deeds sung loud, and has been paid by the empire to close
the roads while its rite proceeds. He is the first boss most runs meet: a big,
boisterous man having a wonderful time trying to kill you.

Mechanism: THE TREATY IN FOUR, BROKEN INTO SEVEN. The treaty is a brass
chorale in C major, square 4/4 in half notes, the only music in the piece with
a leading tone (B natural) and V-I cadences. The clans are the same C with
the seventh flattened (Mixolydian, with Dorian's E-flat in their darker
strain): they never sound a B natural, and their cadence is B-flat to C. They
take the treaty's bar and knock an eighth off it: 7/8, counted 2+2+3 and
stamped on every group head (taiko, bass drum, low strings), never 3+3+2.

  * the war song: a tune a crowd can sing (G C D E, the flat seventh on the
    way down, a fall from B-flat through F and D to C), one note or a short
    run a group; the first strain gives it to the fiddle (solo violin, its own
    telling with a turn), the second to the clan (low choir on "ah", men in
    octaves, with the horns) over horns stamping open fifths, the fiddle
    laughing above (falling thirds, seven eighths a bar: ha-ha ha-ha ha-ha-HA);
  * the HAH: in the last group of a phrase's last bar the band stops dead and
    brass, the clan and the drums shout the chord's open fifth (bass drum,
    taiko, a boom, a crash), alone for a beat and a half;
  * the axe (B): C Dorian, a chop-chop-CHOP-heave rhythm (e e q q.) in horns
    and trombones, the clan chanting root and fifth on the group heads, an
    anvil on every third group;
  * the treaty's return (C): the chorale comes back in 4/4 alone, and after
    two bars the seven comes in under it while the brass go on in four, half
    notes against a 2+2+3 stamp, eight eighths against seven, so the two
    realign only every eight bars (28 beats). The timpani are the treaty's
    drum, striking its half notes in four, while the taiko keep the seven; the
    clans hold a C drone under every treaty chord (its V is a G over C), and
    the band thickens only once the two have realigned. At the end the
    treaty's leading tone is held over the drone, waiting for its C, and the
    clans' B-flat answers it (the fiddle laughing on it, the second violins
    holding it a semitone under the trumpet): the B falls a semitone, the
    brass are pulled into the seven, stamping B-flat with the drums, and
    B-flat goes to C the clans' way. The war song comes back with the treaty's
    trumpets playing it, in unison with the fiddle.

Form (bars; 7/8 unless marked): intro 1-3 in 4/4, the treaty's first phrase,
and bar 4 in 7/8, its half cadence clipped an eighth short while the taiko
count the clans in | A1 5-12 the war song on the fiddle, oom-pah strings
(a stamp, then chords on the off-eighths), a stamping kit | A2 13-20 the clan
sings it, the fiddle laughs, the band | B 21-28 the axe, HAH into silence |
C 29-46 the treaty: 29-30 in 4/4, brass alone; 31-38 the chorale in four over
the seven's drums and drone; 39-44 with the band; 45-46 the treaty gives up
(B to B-flat, the brass stamp B-flat in seven) | D 47-54 the war song with
everyone, HAH. Loop 5-54 (50 bars).

Enrage ("the whole clan joins"): every group head of the seven is stamped by
the whole war band (taiko and bass drum), the horns roar the chord's open
fifth on the strong heads, and the stamp never stops: it counts 2+2+3
straight across the treaty's two 4/4 bars (2+2+3+2+2+3+2), so the clans no
longer let the treaty have its four. The clan also sings the war song with
the fiddle from the first strain, and an octave under the band in the last.
(The choir is not used in Act I's other music; here it is the clan's own
voices, low and human-sized, as on his encounter card.)
"""

from engine.patterns import Kit, drums
from engine.score import Score
from engine.theory import Chord, voice_lead
from engine.theory import pitch as P

from scores._battle import Battle

KEY = 'music_boss_warchief'

INTRO, A1, A2, B, C0, C, D, END = 1, 5, 13, 21, 29, 31, 47, 55

# ------------------------------------------------------------------ the clans' war song
# one bar = 2+2+3 eighths. Written where the clan sings it (men, ah).
TUNE = """
G3q C4q C4e D4e E4e | G4q E4q D4q. | C4q Bb3q C4e D4q | G3h~ G3q. |
G3q C4q C4e D4e E4e | G4q A4q C5q. | Bb4q F4q D4q. | C4h rq. |
"""
# the fiddle's own telling (an octave up): a turn in the second bar, and the held
# G of the half close danced down onto the next phrase's G
FIDDLE = """
G4q> C5q C5e> D5e E5e | G5q> E5e F5e D5q.> | C5q> Bb4q C5e> D5q | G4h> A4e G4e F4e |
G4q> C5q C5e> D5e E5e | G5q> A5q C6q.> | Bb5q> F5q D5q.> | C5h> rq. |
"""
CH_TUNE = 'C:3.5 C:2 Gm:1.5 C:1 Bb:2.5 Gm:3.5 C:3.5 F:3.5 Bb:3.5 C:3.5'

# B: the axe. C Dorian; chop-chop-CHOP-heave
AXE = """
G4e G4e G4q Eb4q. | F4e Eb4e D4q C4q. | A4e A4e A4q F4q. | G4e F4e Eb4q D4q. |
Bb4e Bb4e Bb4q G4q. | F4e G4e Bb4q D5q. | C5e D5e Eb5q C5q. | D5h rq. |
"""
CH_AXE = 'Cm:3.5 Cm:3.5 F:3.5 F:3.5 Eb:3.5 Bb:3.5 F:3.5 Bb:3.5'

# ------------------------------------------------------------------ the treaty
# a four-voice brass chorale in C major, half notes in 4/4: the only leading tones
T1 = dict(S='E4h G4h | A4h G4h | F4h E4h | D4w |',
          A='C4h D4h | C4h C4h | D4h C4h | A3h B3h |',
          T='G3h G3h | F3h G3h | A3h G3h | F3h G3h |',
          B='C3h B2h | A2h E2h | D2h C2h | F2h G2h |')
T2 = dict(S='G4h E4h | F4h A4h | G4h F4h | E4w |',
          A='C4h C4h | C4h D4h | C4h B3h | C4w |',
          T='G3h A3h | A3h F3h | E3h D3h | C3w |',
          B='E2h A2h | F2h D2h | G2h G2h | C2w |')
T3 = dict(S='C5h D5h | E5h C5h | D5h B4h | C5w |',
          A='E4h G4h | G4h A4h | G4h F4h | E4w |',
          T='A3h D4h | C4h C4h | B3h D4h | C4w |',
          B='A2h B2h | C3h F2h | G2h G2h | C3w |')
# the last terms: the leading tone is held, waiting for its C (cut by the clans)
T4 = dict(S='E5h D5h | C5h B4:3', A='G4h G4h | A4h G4:3', T='C4h D4h | E4h D4:3')

# the treaty's drum in C: the root under each of its half notes, chorale bars 3-14
# (bar 14's second half is the held leading tone's G: a roll, written apart)
TREATY_TIMP = (('D2', 'C2'), ('D2', 'G2'), ('C2', 'A2'), ('F2', 'D2'), ('G2', 'G2'),
               ('C2', None), ('A2', 'G2'), ('C2', 'F2'), ('G2', 'G2'), ('C2', None),
               ('C2', 'G2'), ('A2', None))

# drum grids, 14 sixteenths to the 7/8 bar; the group heads are steps 0, 4, 8
STOMP = {'kick': 'x...x...x.....', 'tom_floor': '..o...o...o.o.'}
DRIVE = {'kick': 'x.......x.x...', 'snare': '....X.......X.', 'hat': 'x.x.x.x.x.x.x.',
         'tom_floor': '........o.....'}
DRIVE_FILL = {'kick': 'x.......x.....', 'snare': '....X...x.xxXX', 'hat': 'x.x.x.x.......',
              'tom_floor': '..........x.x.'}
AXE_BEAT = {'kick': 'x...x...x.x...', 'snare': '........X.....', 'tom_lo': '..o...o.....o.',
            'ride': 'x.x.x.x.x.x.x.'}
AXE_FILL = {'kick': 'x...x...x.....', 'snare': '........X.....', 'tom_lo': '..o...o.x.x.x.',
            'tom_mid': '...........x.x'}
GRIND = {'kick': 'x.......x.x...', 'snare': '....X.......X.', 'ride': 'X.x.x.x.X.x.x.',
         'tom_floor': '..o.....o.....'}
GRIND_FILL = {'kick': 'x.......x.....', 'snare': '....X...xxxxXX', 'ride': 'X.x.x.x.......'}
# the HAH bars (phrase ends) and the chord each shout is built on
HAHS = ((A1 + 7, 'C'), (A2 + 7, 'C'), (B + 7, 'Bb'), (D + 3, 'G'), (D + 7, 'C'))
LIGHT7 = {'kick': 'x...x...x.....', 'rim': '........X.....', 'tom_floor': '..o...o.......'}
SONG = {'kick': 'x.......x.x...', 'snare': '....X.......X.', 'ride': 'x...x...x.....'}


def sevens(s, a, z):
    """The 7/8 bars in [a, z)."""
    return [b for b in range(a, z) if abs(s.bar_len(b) - 3.5) < 1e-6]


def spans(s, bar, ch):
    t = s.bar(bar)
    out = []
    for c, beats in ch:
        out.append((t, t + beats, c))
        t += beats
    return out


def chord_at(sp, t):
    for a, z, c in sp:
        if a - 1e-6 <= t < z - 1e-6:
            return c
    return sp[-1][2]


def slots(part, bar, ch, pat, floor=36, vel=0.7, art=None, fixed=None, gate=1.0):
    """Lay a 7-slot (eighth) pattern over every 7/8 bar of a chart.

    pat chars per eighth: R/r root (accented/plain), F/f fifth, O/o octave,
    '.' holds the previous note, '-' a rest. `fixed` plays one pitch for all.
    """
    s = part.score
    sp = spans(s, bar, ch)
    end = sp[-1][1]
    t = sp[0][0]
    while t < end - 1e-6:
        b = s.bar_at(t) + 1
        b0 = s.bar(b)
        for k, chr_ in enumerate(pat):
            tt = b0 + 0.5 * k
            if chr_ in '.-':
                continue
            n = 1
            while k + n < len(pat) and pat[k + n] == '.':
                n += 1
            c = chord_at(sp, tt)
            if fixed is not None:
                p = P(fixed) if isinstance(fixed, str) else fixed
            elif chr_ in 'Rr':
                p = c.bass_note(floor)
            elif chr_ in 'Ff':
                p = c.root_note(floor) + 7
            else:
                p = c.root_note(floor) + 12
            v = min(1.0, vel + (0.14 if chr_.isupper() else 0.0))
            part.note(tt, p, 0.5 * n * gate, vel=v, art=art or part.opts.get('art', 'default'))
        t = b0 + 3.5
    return part


def chords7(part, bar, ch, pat, n=3, lo=55, hi=72, vel=0.55, art='spic'):
    """Chord stabs on the slots marked 'x' (voice-led), e.g. the oom-pah's pahs."""
    s = part.score
    sp = spans(s, bar, ch)
    prev = None
    t = sp[0][0]
    while t < sp[-1][1] - 1e-6:
        b0 = s.bar(s.bar_at(t) + 1)
        for k, chr_ in enumerate(pat):
            if chr_ not in 'xX':
                continue
            tt = b0 + 0.5 * k
            v = voice_lead(prev, chord_at(sp, tt), n, lo, hi)
            prev = v
            for p in v:
                part.note(tt, p, 0.5, vel=vel + (0.1 if chr_ == 'X' else 0.0), art=art)
        t = b0 + 3.5


def laugh(part, bar, ch, lo=67, hi=81, vel=0.62):
    """The fiddle laughs: falling thirds, seven eighths a bar (ha-ha ha-ha ha-ha-HA),
    top, the tone under it, top, under, top, under, and a drop to the tone below."""
    s = part.score
    sp = spans(s, bar, ch)
    t = sp[0][0]
    while t < sp[-1][1] - 1e-6:
        b0 = s.bar(s.bar_at(t) + 1)
        for k, idx in enumerate((1, 2, 1, 2, 1, 2, 3)):
            tt = b0 + 0.5 * k
            tones = chord_at(sp, tt).tones_in_range(lo, hi)
            p = tones[-idx]
            acc = 0.14 if k in (0, 2, 4) else -0.1
            part.note(tt, p, 0.5, vel=min(1.0, vel + acc), art='spic')
        t = b0 + 3.5


def chorale_text(*phrases, voice='S'):
    return ' '.join(ph[voice] for ph in phrases).replace('|', ' ')


def build():
    s = Score('boss_warchief', tonic='C', bpm=152, intro_bars=4, loop_bars=50,
              title='Breaker of Treaties', seed=4177)
    s.meter_change(4, (7, 8))
    s.meter_change(C0, (4, 4))
    s.meter_change(C, (7, 8))
    s.reverb = dict(rt60=2.2, predelay_ms=24, wet_db=-0.5)
    s.master = dict(lufs=-13.5, glue_ratio=1.6)
    b = Battle(s, full_lufs=-13.5, adaptive=False)

    ch_tune = chart_of(CH_TUNE)
    ch_axe = chart_of(CH_AXE)
    ch_drone = chart_of('C:3.5 ' * 14 + 'Bb:3.5 Bb:3.5')
    b.section('A1', A1, ch_tune).section('A2', A2, ch_tune).section('B', B, ch_axe)
    b.section('C', C, ch_drone).section('D', D, ch_tune)

    # ================================================================ the treaty
    # intro: the first phrase, square and stately; its last bar is 7/8: the half
    # cadence held for seven eighths while the taiko counts the clans in
    ts = b.part('tr_s', 'trumpets', role='lead', gain=-1, eq=[('peak', 3000, 1.0, -2.0)])
    ta = b.part('tr_a', 'horns', role='lead2')
    tt = b.part('tr_t', 'trombones', role='section')
    tb = b.part('tr_b', 'trombones', role='section', pan=0.5, gain=-2)
    tu = b.part('tr_tuba', 'tuba', role='low')
    ts.at(INTRO).play('@f E4h G4h | A4h G4h | F4h E4h | D4h~ D4q. |')
    ta.at(INTRO).play('@f C4h D4h | C4h C4h | D4h C4h | A3q B3q~ B3q. |')
    tt.at(INTRO).play('@f G3h G3h | F3h G3h | A3h G3h | F3q G3q~ G3q. |')
    tb.at(INTRO).play('@f C3h B2h | A2h E2h | D2h C2h | F2q G2q~ G2q. |')
    tu.at(INTRO).play('@f C2h B1h | A1h E2h | D2h C2h | F2q G1q~ G1q. |')
    for p in (ts, ta, tt, tb, tu):
        p.expr((INTRO, 0.7), (INTRO + 1.5, 0.95), (INTRO + 2, 0.85), (INTRO + 3, 1.0),
               (INTRO + 3.9, 0.8))

    # C: the treaty's return. Two bars of 4/4 with the full chorale, then the seven
    # comes in under it and the brass go on in four (no bass voice: the clans' drone
    # is the bass now)
    tc = s.bar(C0)
    for part, v in ((ts, 'S'), (ta, 'A'), (tt, 'T')):
        txt = chorale_text(T1, T2, T3, voice=v) + ' @ff ' + T4[v].replace('|', ' ')
        part.at_beat(tc).play('@f ' + txt)
    tb.at(C0).play('@f C3h B2h | A2h E2h |')
    tu.at(C0).play('@mf C2h B1h | A1h E2h |')
    for p in (tb, tu):
        p.expr((C0, 0.55), (C0 + 1.9, 0.8))
    # louder as the treaty climbs; its held leading tone swells against the drone
    for p in (ts, ta, tt):
        p.expr((C0, 0.55), (C0 + 1.9, 0.8), (C, 0.72), (C + 8, 0.78), (C + 11, 0.88),
               (C + 13.1, 0.86), (C + 13.95, 1.0))
    # the treaty gives up: the B falls to B-flat, and the brass stamp B-flat in seven
    gs = b.part('give_s', 'trumpets', role='lead2', gain=-1)
    ga = b.part('give_a', 'horns', role='section')
    gt = b.part('give_t', 'trombones', role='section')
    gs.at(45).play('@ff Bb4q^ Bb4q^ Bb4q.^ | Bb4q^ Bb4q^ Bb4e^ C5e^ D5e^ |')
    ga.at(45).play('@ff [D4 F4]q^ [D4 F4]q^ [D4 F4]q.^ | [D4 F4]q^ [D4 F4]q^ [D4 F4]e^ [E4 G4]e^ [F4 A4]e^ |')
    gt.at(45).play('@ff [Bb2 F3]q^ [Bb2 F3]q^ [Bb2 F3]q.^ | [Bb2 F3]q^ [Bb2 F3]q^ [Bb2 F3]e^ [C3 G3]e^ [D3 A3]e^ |')

    # ================================================================ the war song
    fid = b.part('fiddle', 'solo_violin', role='lead', gain=1, pan=-0.25)
    fid.at(A1).play('@f ' + FIDDLE)
    # A2: the clan sings it; the fiddle laughs above
    hi = b.part('clan_hi', 'choir', role='lead', humanize_ms=12, vel_jitter=0.05, depth=0.35,
                gain=1,
                eq=[('peak', 300, 1.0, -2.0), ('peak', 2400, 1.0, 2.5)])
    lo = b.part('clan_lo', 'choir', role='lead2', humanize_ms=14, vel_jitter=0.05, gain=-4,
                eq=[('highpass', 90, 0.7, 0.0), ('peak', 250, 1.0, -3.0)])
    hi.at(A2).play('@f ' + TUNE)
    hs_a2 = b.part('song_hn', 'horns', role='lead2', gain=-4)
    hs_a2.at(A2).play('@mf ' + TUNE)
    lo.at(A2).play('@f ' + TUNE, transpose=-12)
    hi.at(D).play('@ff ' + TUNE)
    lau = b.part('laugh', 'solo_violin', role='counter', gain=-6, pan=-0.35,
                 eq=[('peak', 3000, 1.0, -2.0)])
    laugh(lau, A2, ch_tune, lo=67, hi=81, vel=0.52)
    # D: everyone; the treaty's own trumpets take the tune on top with the fiddle
    # (the clans' instrument and the treaty's, in unison)
    fid.at(D).play('@ff ' + TUNE, transpose=12)
    tp = b.part('song_tpt', 'trumpets', role='lead2', gain=-1, eq=[('peak', 3000, 1.0, -2.0)])
    tp.at(D).play('@ff ' + TUNE, transpose=12)
    hs_a2.at(D).play('@ff ' + TUNE)

    # horns stamp open fifths on the group heads under the clan's singing
    hf = b.part('fifths_hn', 'horns', role='section', gain=-4)
    for bar in (A2,):
        slots(hf, bar, ch_tune, 'R.r.R..', floor=48, vel=0.62)
        slots(hf, bar, ch_tune, 'F.f.F..', floor=48, vel=0.58)

    # ================================================================ the axe
    ax_h = b.part('axe_hn', 'horns', role='lead')
    ax_t = b.part('axe_tbn', 'trombones', role='lead2', gain=-3)
    ax_c = b.part('axe_vc', 'celli', role='lead2', art='sus', gain=-5)
    ax_h.at(B).play('@ff ' + AXE)
    ax_t.at(B).play('@ff ' + AXE, transpose=-12)
    ax_c.at(B).play('@f ' + AXE, transpose=-12)
    # the clan chants the root and fifth on each group head
    chant = b.part('chant', 'choir', role='choir', humanize_ms=14, gain=5,
                   eq=[('highpass', 120, 0.7, 0.0), ('peak', 300, 1.0, -2.0),
                       ('peak', 2400, 1.0, 3.0)])
    slots(chant, B, ch_axe, 'R.r.R..', floor=50, vel=0.62, gate=0.8)
    slots(chant, B, ch_axe, 'F.f.F..', floor=50, vel=0.58, gate=0.8)
    # a fiddle tremolo high on the chord (the edge of the axe)
    trem = b.part('axe_trem', 'violins', role='pad', art='trem', gain=0)
    pv = None
    for a, z, c in spans(s, B, ch_axe):
        pv = voice_lead(pv, c, 2, 67, 81)
        for p in pv:
            trem.note(a, p, z - a, vel=0.5, art='trem')

    # ================================================================ the clans' drone (C)
    # celli and basses stamp C and G in seven under the treaty; the clan hums it
    hum = b.part('drone_hum', 'oohs', role='choir', gain=-2)
    slots(hum, C, ch_drone, 'R......', floor=48, vel=0.5)
    slots(hum, C, ch_drone, 'F......', floor=48, vel=0.46)
    # (the violas' drone eighths only from the second window, where the lines realign)
    dv = b.part('drone_va', 'violas', role='ostinato', art='spic', gain=-3)
    slots(dv, C + 8, ch_drone[8:14], 'O.f.O.f', floor=48, vel=0.54)
    # the clans' B-flat creeps in under the held leading tone (bars 43-44)
    flat = b.part('flat7', 'violins2', role='counter', art='sus', gain=1)
    flat.at(44).play('@mf Bb4q. C5q Bb4q |')
    flat.at(45).play('@f Bb4q^ Bb4q^ Bb4q.^ | Bb4q^ Bb4q^ Bb4e^ C5e^ D5e^ |')
    lau.at(43).play('%spic @f Bb5e G5e Bb5e G5e Bb5e G5e E5e | Bb5e G5e Bb5e G5e C6e Bb5e G5e |'
                    ' Bb5e F5e Bb5e F5e Bb5e F5e D5e | Bb5e F5e Bb5e F5e C6e D6e E6e |')

    # ================================================================ low strings, bass
    vc = b.part('stamp_vc', 'celli', role='section', art='spic', gain=-2)
    cb = b.part('stamp_cb', 'basses', role='low', art='spic', gain=-2)
    for bar, ch in ((A1, ch_tune), (A2, ch_tune), (B, ch_axe), (C, ch_drone), (D, ch_tune)):
        slots(vc, bar, ch, 'R.r.R.f', floor=36, vel=0.62)
        slots(cb, bar, ch, 'R.r.R..', floor=24, vel=0.66)
    # the oom-pah: chords on the off-eighths (the pahs)
    # (under the fiddle in A1 the pahs sit in the middle; under the clan's singing
    # they drop below the tune, and the second violins take them above it)
    pah = b.part('pah', 'violas', role='ostinato', art='spic', gain=-2)
    chords7(pah, A1, ch_tune, '.x.x.xx', n=3, lo=55, hi=70, vel=0.5)
    for bar in (A2, D):
        chords7(pah, bar, ch_tune, '.x.x.xx', n=2, lo=48, hi=59, vel=0.5)
    pah2 = b.part('pah2', 'violins2', role='ostinato', art='spic', gain=-5)
    for bar in (A2, D):
        chords7(pah2, bar, ch_tune, '.x.x.xx', n=2, lo=74, hi=86, vel=0.46)
    sus = b.part('cb_sus', 'basses', role='low', art='sus', gain=-4)
    for bar in (C,):
        slots(sus, bar, ch_drone, 'R......', floor=24, vel=0.6)

    eb = b.part('ebass', 'rbass', role='bass', duck='kit_kick')
    for bar, ch in ((A2, ch_tune), (B, ch_axe), (C + 8, ch_drone[8:]), (D, ch_tune)):
        slots(eb, bar, ch, 'Rr.rRrO', floor=28, vel=0.7)
    sub = b.part('sub', 'sub', role='sub', gain=-4)
    for bar, ch in ((A2, ch_tune), (B, ch_axe), (C, ch_drone), (D, ch_tune)):
        slots(sub, bar, ch, 'r......', floor=24, vel=0.6)

    # ================================================================ drums
    tk = b.part('taiko', 'taiko', role='drums', gain=-2)
    for bar in sevens(s, A1, C0):
        slots(tk, bar, chart_of('C:3.5'), 'R.r.R..', fixed='C2', vel=0.66)
    for bar in sevens(s, C, END):
        slots(tk, bar, chart_of('C:3.5'), 'R.r.R..' if bar < C + 8 else 'R.r.Rrr', fixed='C2',
              vel=0.66)
    # the intro's clipped bar: the taiko counts the clans in on its last group
    tk.at(4).play('@mf rq rq C2e C2e> C2e> |')
    kit = Kit(s, 'kit', gains={'kick': -1.0, 'snare': 1.5})
    b.kit = kit
    for i, bar in enumerate(range(A1, A2)):
        kit.play(bar, STOMP, vel=0.62)
    for i, bar in enumerate(range(A2, B)):
        kit.play(bar, DRIVE_FILL if i in (3, 7) else DRIVE, vel=0.72)
    for i, bar in enumerate(range(B, C0)):
        kit.play(bar, AXE_FILL if i == 7 else AXE_BEAT, vel=0.74)
    for i, bar in enumerate(range(C, D)):
        if i < 8:
            kit.play(bar, LIGHT7, vel=0.72)
        else:
            kit.play(bar, GRIND_FILL if i == 15 else GRIND, vel=0.8)
    for i, bar in enumerate(range(D, END)):
        kit.play(bar, DRIVE_FILL if i in (3,) else SONG, vel=0.76)
    for bar in (A2, B, C, 45, D):
        kit.play(bar, {'crash': 'X'})

    perc = b.part('perc', 'orch_perc', role='accent', gain=4)
    # the axe: an anvil on every third group of the B strain
    for bar in range(B, C0 - 1):
        drums(perc, bar, {'anvil': '........x.....'}, vel=0.62)
    # a cymbal swell into the seven's return under the treaty
    drums(perc, C0 + 1, {'sus': '......x.'}, step=0.5, vel=0.5)
    # the war band's bass drum on the first and last group heads, every 7/8 bar
    bdr = b.part('stamp_bd', 'orch_perc', role='drums', gain=-5)
    for bar in sevens(s, A1, END):
        if bar < C0 or bar >= C:
            drums(bdr, bar, {'bd': 'X.......x.....'}, vel=0.7)
    drums(perc, A1, {'crash': 'X', 'bd': 'X'}, vel=0.8)
    timp = b.part('timp', 'timpani', role='timp', gain=2)
    timp.at(INTRO).play('@f C2h G2h | A2h E2h | D2h C2h | rq G2q~ G2q. |')
    timp.at(C0).play('%roll @mp C2h G2h | A2h E2h |')
    timp.expr((C0, 0.6), (C0 + 1.9, 1.0), (C, 0.9))
    # in C the timpani are the treaty's drum: they keep its four (a stroke on each of
    # the chorale's half notes, on its chord's root) while the taiko keep the seven;
    # the last, the G under the held leading tone, is a roll that never resolves
    tc = s.bar(C0)
    for k, (r1, r3) in enumerate(TREATY_TIMP):
        t = tc + 4 * (k + 2)
        timp.note(t, P(r1), 1.0, vel=0.74, art='default')
        if r3:
            timp.note(t + 2, P(r3), 1.0, vel=0.6, art='default')
    timp.note(tc + 54, P('G2'), 3.0, vel=0.62, art='roll')
    slots(timp, 45, chart_of('Bb:3.5 Bb:3.5'), 'R.r.R.r', floor=36, vel=0.72, art='default')
    slots(timp, B, ch_axe, 'R.r.Rrr', floor=36, vel=0.66, art='default')

    # ================================================================ HAH!
    # the shout: in the last group of a phrase's last bar the band stops dead (the
    # tunes are resting or holding) and brass, the clan and the drums shout C-G-C
    tunes = {'fiddle', 'laugh', 'clan_hi', 'clan_lo', 'song_tpt', 'song_hn', 'axe_hn',
             'axe_tbn', 'axe_vc'}
    for bar, _ in HAHS:
        t = s.bar(bar) + 2.0
        for name, part in s.parts.items():
            if name in tunes:
                continue
            keep = []
            for n in part.notes:
                if t - 1e-6 <= n.start < t + 1.5 - 1e-6:
                    continue
                if n.start < t - 1e-6 < n.end - 1e-6:
                    n.dur = t - n.start
                    if n.dur < 0.25:
                        continue
                keep.append(n)
            part.notes = keep
    hah_b = b.part('hah_brass', 'trombones', role='section', gain=3)
    hah_h = b.part('hah_horns', 'horns', role='section', gain=3)
    hah_t = b.part('hah_tpt', 'trumpets', role='section', gain=-4)
    hah_c = b.part('hah_clan', 'choir', role='choir', gain=9, humanize_ms=10,
                   eq=[('highpass', 120, 0.7, 0.0), ('peak', 2400, 1.0, 3.0)])
    hah_p = b.part('hah_perc', 'orch_perc', role='accent', gain=3)
    boom = b.part('hah_boom', 'boom', role='accent', gain=0)
    for bar, root in HAHS:
        t = s.bar(bar) + 2.0
        r = Chord(root).root_note(48)                 # C3..B3
        for p in (r, r + 7):
            hah_b.note(t, p, 0.75, vel=0.92, art='default', rearticulate=True, gate=0.9)
            hah_h.note(t, p + 12, 0.75, vel=0.92, art='default', rearticulate=True, gate=0.9)
            hah_c.note(t, p + 12, 0.6, vel=0.9, rearticulate=True)
        hah_t.note(t, r + 19, 0.75, vel=0.9, art='default', rearticulate=True, gate=0.9)
        drums(hah_p, bar, {'bd': '........X.....', 'crash': '........X.....'}, vel=0.8)
        boom.note(t, 29, 1.5, vel=0.8)
        drums(tk, bar, {36: '........X.....'}, vel=0.9)
        kit.play(bar, {'kick': '........X.....', 'snare': '........X.....'}, vel=0.82)

    # ================================================================ enrage: the whole clan joins
    enrage(b, s, ch_tune, ch_axe, ch_drone)
    return b.finish()


def chart_of(text):
    from engine.patterns import chart
    return chart(text)


def enrage(b, s, ch_tune, ch_axe, ch_drone):
    """The whole clan joins: every group head of the seven stamped by the war band
    (taiko and bass drum), the horns roaring the chord's open fifth on the strong
    heads, and the stamp never stops: it counts 2+2+3 straight across the treaty's
    two 4/4 bars. The clan sings with the fiddle from the first strain, and an
    octave under the band in the last."""
    v = 'enrage_warchief'
    tk = b.extra(v, 'wc_taiko', 'taiko', role='drums', gain=-2)
    bd = b.extra(v, 'wc_bd', 'orch_perc', role='drums', gain=-4)
    roar = b.extra(v, 'wc_roar', 'horns', role='section', gain=-1)
    low = b.extra(v, 'wc_low', 'choir', role='lead2', humanize_ms=16,
                  eq=[('highpass', 110, 0.7, 0.0), ('peak', 300, 1.0, -2.5)])
    # the heads of every 2+2+3 from the loop's first bar to its last, counted
    # straight across the treaty's two 4/4 bars (sixteen eighths: 2+2+3+2+2+3+2)
    heads = []
    for bar in sevens(s, A1, C0):
        t0 = s.bar(bar)
        heads += [(t0, 1), (t0 + 1.0, 0), (t0 + 2.0, 1)]
    t0 = s.bar(C0)
    for k, off in enumerate((0, 1, 2, 3.5, 4.5, 5.5, 7.0)):
        heads.append((t0 + off, 1 if k in (0, 2, 3, 5) else 0))
    for bar in sevens(s, C, END):
        t0 = s.bar(bar)
        heads += [(t0, 1), (t0 + 1.0, 0), (t0 + 2.0, 1)]
    sections = [spans(s, A1, ch_tune), spans(s, A2, ch_tune), spans(s, B, ch_axe),
                spans(s, C, ch_drone), spans(s, D, ch_tune)]
    allsp = [x for sp in sections for x in sp]
    for t, acc in heads:
        tk.note(t, P('C2'), 0.5, vel=0.86 if acc else 0.74)
        bd.note(t, 36, 0.5, vel=0.8 if acc else 0.66)
        if not acc:
            continue
        if s.bar(C0) - 1e-6 <= t < s.bar(C) - 1e-6:
            c = Chord('C')
        else:
            c = chord_at(allsp, t)
        r = c.root_note(48)                           # C3..B3
        for p in (r, r + 7):
            roar.note(t, p, 0.75, vel=0.86, art='default', rearticulate=True, gate=0.6)
    # the clan no longer waits for its strain: it sings the war song with the
    # fiddle from the first bar, and an octave under the band in the last
    low.at(A1).play('@f ' + TUNE)
    low.at(D).play('@ff ' + TUNE, transpose=-12)
