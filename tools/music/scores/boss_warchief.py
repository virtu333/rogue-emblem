"""Act I boss (the Warchief) — "Breaker of Treaties".

The border clans buried the old kingdom's treaties with the old kingdom, and
answer the empire's new terms with none of their own. Their Warchief laughs
("HAH!"), wants his deeds sung loud, and has been paid by the empire to close
the roads while its rite proceeds. He is the first boss most runs meet: a big
man having a wonderful time, whose axe "grows thirsty", and who means to
crack your bones "like old treaties".

Mechanism: THE TREATY IN FOUR, BROKEN INTO SEVEN, AND BLED TO MINOR. Two
ways home to D. The treaty comes up from below: a brass chorale in D major,
square 4/4 half notes, the only music in the piece with a major key and a
leading tone (C-sharp rising to D). The clans come down from above: their
D is Phrygian minor, they never sound a C-sharp, and every one of their
cadences is the semitone fall E-flat to D (bII to i). They take the
treaty's bar and knock an eighth off it: 7/8, counted 2+2+3 and stamped on
every group head (taiko, bass drum), never 3+3+2, while the low strings saw
the same fall in eighths under everything (D D | E-flat D | D D E-flat).

  * the war song: a tune a crowd can sing (A D, D E-flat F: the snarl is in
    the hook), over i, iv and a bare A ground against its flat ninth (never
    a major V), each phrase closing on a held E-flat (bII) or on a tritone
    leap from A up to E-flat that falls to D; the first strain gives it to
    the horns with the trombones growling an octave under; the second to the
    clan (low choir on "ah", men in octaves) with the trombones, while the
    fiddle laughs above in falling minor thirds (seven eighths a bar:
    ha-ha ha-ha ha-ha-HA);
  * the HAH: in the last group of a phrase's last bar the band stops dead and
    brass, the clan and the drums shout the chord's open fifth, the trumpets
    snarling a semitone over its root (bass drum, taiko, a boom, a crash),
    alone for a beat and a half;
  * the axe (B): a chop-chop-CHOP-heave rhythm (e e q q.) in horns and
    trombones over slow dark harmony (i, bVI, bII, then a bare A with its
    flat ninth ground against it), the clan chanting low root and fifth on
    the group heads, an anvil on every third group, high violins trembling
    on a semitone; its last HAH, on E-flat, drops into near-silence;
  * the treaty (C): out of that silence (a gong, the clan's hum) the chorale
    comes alone in 4/4, muted and far off, in D major: the only major music
    in the loop, a phrase long. Then the
    seven comes in under it and the brass go on in four over it (half notes
    against a 2+2+3 stamp, eight eighths against seven: they realign every
    28 beats), and the clans bleed it. The timpani are the treaty's drum,
    striking its half notes in four while the taiko keep the seven; under
    them the low strings saw D and E-flat and the clan hums the open fifth.
    The treaty's second phrase is already minor (its F-sharp gone to F, an
    E-flat chord in its cadence), the muted brass open up, and from there
    the clan chants low on the seven's heads while trombones stamp the
    clans' cluster (D, E-flat, A) across the chorale's half notes every
    other bar; its third phrase climbs over the band (high violins trembling
    on D and E-flat) and reaches
    a half close with its C-sharp, and its last terms hold that leading tone,
    waiting for D, while the fiddle laughs on E-flat and the second violins
    grind E-flat a tone over it (C-sharp, D, E-flat at once). The clans take
    the D from above: the brass stamp E-flat in seven, the band drops out for
    a beat and a half under a timpani roll, and the war song crashes back in
    on D.

Form (bars; 7/8 unless marked): intro 1-4, the saw and the taiko alone, then
brass clusters stamping D and E-flat | A1 5-12 the war song on the horns |
A2 13-20 the clan sings it, the fiddle laughs, the band | B 21-28 the axe,
HAH into silence | C 29-46 the treaty: 29-30 in 4/4, brass alone in D major;
31-38 the chorale in four over the seven (its second phrase bled to minor,
the clan's chant and cluster stamps from 34);
39-44 with the band, the held leading tone; 45-46 the brass stamp E-flat,
a beat and a half of near-silence | D 47-54 the war song with everyone,
HAH. Loop 5-54 (50 bars).

Enrage ("the whole clan joins"): every group head of the seven is stamped by
the whole war band (taiko and bass drum), the trombones and horns roar the
chord's open fifth on the strong heads with the clans' semitone ground in
under it, and the stamp never stops: it counts 2+2+3 straight across the
treaty's two 4/4 bars (2+2+3+2+2+3+2), so the treaty no longer gets its
moment of major. The clan also sings the war song with the horns from the
first strain, and an octave under the band in the last.
(The choir is not used in Act I's other music; here it is the clan's own
voices, low and human-sized, as on his encounter card.)
"""

from engine.patterns import Kit, drums
from engine.score import Score
from engine.theory import Chord, voice_lead
from engine.theory import pitch as P

from scores._battle import Battle

KEY = 'music_boss_warchief'

# the clans' scale: D Phrygian (no C-sharp)
PHRYGIAN = {2, 3, 5, 7, 9, 10, 0}

INTRO, A1, A2, B, C0, C, D, END = 1, 5, 13, 21, 29, 31, 47, 55

# ------------------------------------------------------------------ the clans' war song
# one bar = 2+2+3 eighths, D Phrygian minor: no C-sharp, the cadence E-flat to D
TUNE = """
A3q> D4q> D4e> Eb4e F4e | Bb4q> A4q F4q.> | D4q> Bb3q A3e> Bb3q | Eb4h>~ Eb4q. |
A3q> D4q> D4e> Eb4e F4e | A4q> D5q Bb4q.> | Bb4q> A4q Eb5q.> | D5h> rq. |
"""
CH_TUNE = ('Dm:3.5 Dm:3.5 Gm:2 A5:1.5 Eb:3.5 '
           'Dm:3.5 Dm:2 Gm:1.5 Gm:2 A5:1.5 Dm:3.5')

# B: the axe. Chop-chop-CHOP-heave over i, bVI, bII and a bare A with its flat ninth
AXE = """
A4e A4e A4q F4q. | G4e F4e Eb4q D4q. | Bb4e Bb4e Bb4q F4q. | A4e G4e F4q D4q. |
Bb4e Bb4e Bb4q G4q. | Ab4e G4e F4q Eb4q. | Bb4e A4e Bb4q A4q. | Bb4h rq. |
"""
CH_AXE = 'Dm:3.5 Dm:3.5 Bb:3.5 Bb:3.5 Eb:3.5 Eb:3.5 A5:3.5 Eb:3.5'

# ------------------------------------------------------------------ the treaty
# a four-voice brass chorale, half notes in 4/4: the only major key and leading tone.
# T1 is D major; T2 is the same treaty bled to minor (an E-flat chord in its cadence);
# T3 climbs to a half close on A with its C-sharp
T1 = dict(S='F#4h A4h | B4h A4h | G4h F#4h | E4w |',
          A='D4h E4h | D4h D4h | E4h D4h | B3h C#4h |',
          T='A3h A3h | G3h A3h | B3h A3h | G3h A3h |',
          B='D3h C#3h | B2h F#2h | E2h D2h | G2h A2h |')
T2 = dict(S='A4h F4h | G4h Bb4h | A4h G4h | F4w |',
          A='F4h D4h | D4h D4h | F4h Eb4h | D4w |',
          T='D4h A3h | Bb3h G3h | C4h Bb3h | A3w |',
          B='D3h F2h | G2h Bb2h | F2h Eb2h | D2w |')
T3 = dict(S='D5h C5h | Bb4h A4h | G4h Bb4h | A4w |',
          A='F4h E4h | D4h F4h | Eb4h Eb4h | C#4w |',
          T='Bb3h C4h | D4h D4h | Bb3h Bb3h | A3w |',
          B='Bb2h A2h | G2h F2h | Eb2h G2h | A2w |')
# the last terms: the leading tone is held, waiting for its D (taken by the clans)
T4 = dict(S='F5h E5h | D5h C#5:3', A='A4h A4h | F4h E4:3', T='D4h C#4h | Bb3h A3:3')

# the treaty's drum: the root under each of its half notes, chorale bars 3-14
# (bar 14's second half is the held leading tone's A: a roll, written apart)
TREATY_TIMP = (('E2', 'D2'), ('G2', 'A2'), ('D2', 'F2'), ('G2', 'Bb2'), ('F2', 'Eb2'),
               ('D2', None), ('Bb2', 'A2'), ('G2', 'F2'), ('Eb2', 'G2'), ('A2', None),
               ('D2', 'A2'), ('Bb2', None))

# drum grids, 14 sixteenths to the 7/8 bar; the group heads are steps 0, 4, 8
STOMP = {'kick': 'x...x...x.....', 'tom_floor': '..o...o...o.o.', 'rim': '........x.....'}
# the clan's drums: no hi-hat, toms and snare off the heads (2 and 6 of the seven)
DRIVE = {'kick': 'x...x...x.....', 'snare': '..X.......X...', 'tom_floor': 'o.....o.o...o.',
         'tom_mid': '....x.......x.'}
DRIVE_FILL = {'kick': 'x...x...x.....', 'snare': '..X.....x.xxXX', 'tom_floor': 'o.....o.......',
              'tom_mid': '....x.....x.x.'}
AXE_BEAT = {'kick': 'x...x...x.x...', 'snare': '........X.....', 'tom_lo': '..o...o.....o.',
            'ride': 'x.x.x.x.x.x.x.'}
AXE_FILL = {'kick': 'x...x...x.....', 'snare': '........X.....', 'tom_lo': '..o...o.x.x.x.',
            'tom_mid': '...........x.x'}
GRIND = {'kick': 'x.......x.x...', 'snare': '....X.......X.', 'ride': 'X.x.x.x.X.x.x.',
         'tom_floor': '..o.....o.....'}
# the HAH bars (phrase ends) and the chord each shout is built on
HAHS = ((A1 + 7, 'D'), (A2 + 7, 'D'), (B + 7, 'Eb'), (D + 3, 'Eb'), (D + 7, 'D'))
LIGHT7 = {'kick': 'x...x...x.....', 'rim': '........X.....', 'tom_floor': '..o...o.......'}
SONG = {'kick': 'x...x...x.....', 'snare': '..X.......X...', 'ride': 'x...x...x.....',
        'tom_floor': 'o.....o.o...o.', 'tom_mid': '....x.......x.'}


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
    N/n the root's upper neighbour in D Phrygian (over D, the clans' E-flat), '.' holds the previous
    note, '-' a rest. `fixed` plays one pitch for all.
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
            elif chr_ in 'Nn':
                r = c.root_note(floor)
                p = r + next(i for i in (1, 2) if (r + i) % 12 in PHRYGIAN)
            else:
                p = c.root_note(floor) + 12
            v = min(1.0, vel + (0.14 if chr_.isupper() else 0.0))
            part.note(tt, p, 0.5 * n * gate, vel=v, art=art or part.opts.get('art', 'default'))
        t = b0 + 3.5
    return part


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


def clear(s, t0, t1, keep):
    """Every part not in `keep` stops dead over [t0, t1) (held notes are cut)."""
    for name, part in s.parts.items():
        if name in keep:
            continue
        out = []
        for n in part.notes:
            if t0 - 1e-6 <= n.start < t1 - 1e-6:
                continue
            if n.start < t0 - 1e-6 < n.end - 1e-6:
                n.dur = t0 - n.start
                if n.dur < 0.25:
                    continue
            out.append(n)
        part.notes = out


def build():
    s = Score('boss_warchief', tonic='D', bpm=152, intro_bars=4, loop_bars=50,
              title='Breaker of Treaties', seed=4177)
    s.meter_change(1, (7, 8))
    s.meter_change(C0, (4, 4))
    s.meter_change(C, (7, 8))
    s.reverb = dict(rt60=2.3, predelay_ms=24, wet_db=-0.5)
    s.master = dict(lufs=-13.5, glue_ratio=1.6)
    b = Battle(s, full_lufs=-13.5, adaptive=False)

    ch_intro = chart_of('Dm:3.5 Dm:3.5 Dm:3.5 Eb:3.5')
    ch_tune = chart_of(CH_TUNE)
    ch_axe = chart_of(CH_AXE)
    ch_drone = chart_of('Dm:3.5 ' * 14 + 'Eb:3.5 Eb:3.5')
    b.section('A1', A1, ch_tune).section('A2', A2, ch_tune).section('B', B, ch_axe)
    b.section('C', C, ch_drone).section('D', D, ch_tune)

    # ================================================================ intro: the clans
    # brass clusters stamp the group heads: trombones on D (then E-flat), the
    # horns grinding D against E-flat over them
    ib_t = b.part('intro_tbn', 'trombones', role='section', gain=-1)
    ib_h = b.part('intro_hn', 'horns', role='section', gain=-3)
    ib_t.at(3).play('@f [D3 A3]q^ [D3 A3]q^ [D3 A3]q.^ | '
                    '[Eb3 Bb3]q^ [Eb3 Bb3]q^ [Eb3 Bb3]e^ [Eb3 Bb3]e^ [Eb3 Bb3]e^ |')
    ib_h.at(3).play('@f [D4 Eb4]q^ [D4 Eb4]q^ [D4 Eb4]q.^ | '
                    '[D4 Eb4]q^ [D4 Eb4]q^ [D4 Eb4]e^ [D4 Eb4]e^ [D4 Eb4]e^ |')
    ib_t.expr((3, 0.8), (4.6, 0.9), (4.99, 1.0))
    ib_h.expr((3, 0.8), (4.6, 0.9), (4.99, 1.0))

    # ================================================================ the treaty (C)
    ts = b.part('tr_s', 'trumpets', role='lead', gain=-2, eq=[('peak', 3000, 1.0, -2.0)])
    ta = b.part('tr_a', 'horns', role='lead2')
    tt = b.part('tr_t', 'trombones', role='section')
    tb = b.part('tr_b', 'trombones', role='section', pan=0.5, gain=-2)
    tu = b.part('tr_tuba', 'tuba', role='low')
    tc = s.bar(C0)
    # the first phrase, the only major music in the loop, comes muted and far off;
    # the brass open up only once it has been bled to minor
    for part, v in ((ts, 'S'), (ta, 'A'), (tt, 'T')):
        mute = '%mute ' if v != 'T' else ''
        txt = (mute + chorale_text(T1, voice=v) + ' %default ' + chorale_text(T2, T3, voice=v)
               + ' @ff ' + T4[v].replace('|', ' '))
        part.at_beat(tc).play('@mf ' + txt)
    tb.at(C0).play('@p D3h C#3h | B2h F#2h |')
    tu.at(C0).play('@mp D2h C#2h | B1h F#2h |')
    for p in (tb, tu):
        p.expr((C0, 0.5), (C0 + 1.9, 0.7))
    # soft and far off at first; louder as it climbs; its held leading tone swells
    for p in (ts, ta, tt):
        p.expr((C0, 0.42), (C0 + 1.9, 0.56), (C + 2.2, 0.6), (C + 2.3, 0.7), (C + 8, 0.76), (C + 11, 0.88),
               (C + 13.1, 0.86), (C + 13.95, 1.0))
    # the clans take the D from above: the brass stamp E-flat in seven, then stop
    gs = b.part('give_s', 'trumpets', role='lead2', gain=-1)
    ga = b.part('give_a', 'horns', role='section')
    gt = b.part('give_t', 'trombones', role='section')
    gs.at(45).play('@ff Eb5q^ Eb5q^ Eb5q.^ | Eb5q^ Eb5q^ rq. |')
    ga.at(45).play('@ff [G4 Bb4]q^ [G4 Bb4]q^ [G4 Bb4]q.^ | [G4 Bb4]q^ [G4 Bb4]q^ rq. |')
    gt.at(45).play('@ff [Eb3 Bb3]q^ [Eb3 Bb3]q^ [Eb3 Bb3]q.^ | [Eb3 Bb3]q^ [Eb3 Bb3]q^ rq. |')

    # ================================================================ the war song
    # A1: the horns, the trombones an octave under
    th = b.part('tune_hn', 'horns', role='lead', gain=1)
    tl = b.part('tune_tbn', 'trombones', role='lead2', gain=-2)
    th.at(A1).play('@f ' + TUNE)
    tl.at(A1).play('@mf ' + TUNE, transpose=-12)
    # A2: the clan sings it; the fiddle laughs above
    hi = b.part('clan_hi', 'choir', role='lead', humanize_ms=12, vel_jitter=0.05, depth=0.4,
                gain=2, eq=[('peak', 300, 1.0, -1.5), ('peak', 2400, 1.0, 3.0)])
    lo = b.part('clan_lo', 'choir', role='lead2', humanize_ms=14, vel_jitter=0.05, gain=-2,
                eq=[('highpass', 80, 0.7, 0.0), ('peak', 250, 1.0, -2.0)])
    hi.at(A2).play('@f ' + TUNE)
    lo.at(A2).play('@f ' + TUNE, transpose=-12)
    tl.at(A2).play('@mf ' + TUNE, transpose=-12)
    th.at(A2).play('@mp ' + TUNE)
    lau = b.part('laugh', 'solo_violin', role='counter', gain=-6, pan=-0.35,
                 eq=[('peak', 3000, 1.0, -2.0)])
    laugh(lau, A2, ch_tune, lo=67, hi=81, vel=0.52)
    # D: everyone; the treaty's own trumpets sing the clans' song with the horns,
    # the clan an octave under, the fiddle an octave over
    tp = b.part('song_tpt', 'trumpets', role='lead2', gain=-3, eq=[('peak', 3000, 1.0, -2.0)])
    tp.at(D).play('@ff ' + TUNE)
    th.at(D).play('@ff ' + TUNE)
    tl.at(D).play('@mf ' + TUNE, transpose=-12)
    hi.at(D).play('@ff ' + TUNE)
    lo.at(D).play('@ff ' + TUNE, transpose=-12)
    fid = b.part('fiddle', 'solo_violin', role='lead', gain=-3, pan=-0.25)
    fid.at(D).play('@f ' + TUNE, transpose=12)

    # ================================================================ the axe
    ax_h = b.part('axe_hn', 'horns', role='lead')
    ax_t = b.part('axe_tbn', 'trombones', role='lead2', gain=-3)
    ax_c = b.part('axe_vc', 'celli', role='lead2', art='sus', gain=-5)
    ax_h.at(B).play('@ff ' + AXE)
    ax_t.at(B).play('@ff ' + AXE, transpose=-12)
    ax_c.at(B).play('@f ' + AXE, transpose=-12)
    # the clan chants the root and fifth on each group head, low
    chant = b.part('chant', 'choir', role='choir', humanize_ms=14, gain=5,
                   eq=[('highpass', 90, 0.7, 0.0), ('peak', 300, 1.0, -1.5),
                       ('peak', 2400, 1.0, 2.0)])
    slots(chant, B, ch_axe, 'R.r.R..', floor=45, vel=0.62, gate=0.8)
    slots(chant, B, ch_axe, 'F.f.F..', floor=45, vel=0.58, gate=0.8)
    # high violins tremble on the chord's root and its upper neighbour in the clans'
    # scale: a semitone over D and A, a tone over B-flat and E-flat
    trem = b.part('axe_trem', 'violins', role='pad', art='trem', gain=-4)
    for a, z, c in spans(s, B, ch_axe):
        r = c.root_note(70)
        for p in (r, r + next(i for i in (1, 2) if (r + i) % 12 in PHRYGIAN)):
            trem.note(a, p, z - a, vel=0.5, art='trem')

    # ================================================================ the clans' drone (C)
    hum = b.part('drone_hum', 'oohs', role='choir', gain=-1)
    # the clan hums its open fifth under the treaty from its first chord
    hum.at(C0).play('@pp [D3 A3]:4 | [D3 A3]:4 |')
    slots(hum, C, ch_drone, 'R......', floor=45, vel=0.52)
    slots(hum, C, ch_drone, 'F......', floor=45, vel=0.48)
    hum.at(2).play('@mp [D3 A3]:3.5 | [D3 A3]:3.5 | [Eb3 Bb3]:3.5 |')
    # once the treaty has turned minor the clan chants on the seven's heads, low,
    # and the brass stamp the clans' cluster (D and E-flat) on the last group of
    # every other bar, cutting across the chorale's half notes
    slots(chant, C + 3, ch_drone[3:14], 'R...R..', floor=45, vel=0.56, gate=0.8)
    slots(chant, C + 3, ch_drone[3:14], 'F...F..', floor=45, vel=0.52, gate=0.8)
    cl = b.part('clan_stab', 'trombones', role='section', gain=-4)
    for bar in range(C + 3, C + 14, 2):
        t0 = s.bar(bar) + 2.0
        for p in ('D3', 'Eb3', 'A3'):
            cl.note(t0, P(p), 0.5, vel=0.8 if bar < C + 8 else 0.9, art='default',
                    rearticulate=True, gate=0.8)
    # high violins tremble on D and E-flat once the band is in
    trem.at(C + 8).play('%trem @mp [D5 Eb5]:21 |')
    # the clans' E-flat grinds over the held leading tone (bars 44-46)
    flat = b.part('flat2', 'violins2', role='counter', art='sus', gain=-3)
    flat.at(44).play('@mf Eb5q. D5q Eb5q |')
    flat.at(45).play('@f Eb5q^ Eb5q^ Eb5q.^ | Eb5q^ Eb5q^ rq. |')
    lau.at(43).play('%spic @f Eb5e Bb4e Eb5e Bb4e Eb5e Bb4e G4e |'
                    ' Eb5e Bb4e Eb5e Bb4e F5e Eb5e Bb4e |')

    # ================================================================ low strings, bass
    # the saw: celli in eighths, D D | E-flat D | D D E-flat, under everything;
    # the basses stamp the roots on the group heads
    vc = b.part('saw_vc', 'celli', role='ostinato', art='spic', gain=-1)
    cb = b.part('stamp_cb', 'basses', role='low', art='spic', gain=-2)
    for bar, ch in ((INTRO, ch_intro), (A1, ch_tune), (A2, ch_tune), (B, ch_axe),
                    (C, ch_drone), (D, ch_tune)):
        slots(vc, bar, ch, 'RrNrRrn', floor=43, vel=0.6)
        slots(cb, bar, ch, 'R.r.R..', floor=26, vel=0.66)
    vc.expr((INTRO, 0.55), (INTRO + 1.9, 0.85), (A1, 0.9))
    cb.expr((INTRO, 0.6), (INTRO + 1.9, 0.9), (A1, 0.95))
    # a dark tremolo under the horns' first strain (violas and second violins, low)
    tpad = b.part('trem_pad', 'violas', role='pad', art='trem', gain=-6)
    pv = None
    for a, z, c in spans(s, A1, ch_tune):
        # under the tune's E-flat the bare A grinds against its flat ninth
        pv = [57, 58] if c.symbol == 'A5' else voice_lead(pv, c, 2, 50, 62)
        for p in pv:
            tpad.note(a, p, z - a, vel=0.48, art='trem')
    sus = b.part('cb_sus', 'basses', role='low', art='sus', gain=-4)
    slots(sus, C, ch_drone, 'R......', floor=26, vel=0.6)

    eb = b.part('ebass', 'rbass', role='bass', duck='kit_kick')
    for bar, ch in ((A2, ch_tune), (B, ch_axe), (C + 8, ch_drone[8:]), (D, ch_tune)):
        slots(eb, bar, ch, 'Rr.rRrN', floor=28, vel=0.7)
    sub = b.part('sub', 'sub', role='sub', gain=-4)
    for bar, ch in ((A1, ch_tune), (A2, ch_tune), (B, ch_axe), (C, ch_drone), (D, ch_tune)):
        slots(sub, bar, ch, 'r......', floor=26, vel=0.6)

    # ================================================================ drums
    tk = b.part('taiko', 'taiko', role='drums', gain=-1)
    for bar in sevens(s, INTRO, C0):
        slots(tk, bar, chart_of('C:3.5'), 'R.r.R..', fixed='C2', vel=0.66)
    for bar in sevens(s, C, END):
        slots(tk, bar, chart_of('C:3.5'), 'R.r.R..' if bar < C + 8 else 'R.r.Rrr', fixed='C2',
              vel=0.66)
    tk.expr((INTRO, 0.6), (INTRO + 1.9, 0.85), (A1, 1.0))
    kit = Kit(s, 'kit', gains={'kick': -1.0, 'snare': 1.5})
    b.kit = kit
    kit.play(4, {'kick': 'x...x...x.....', 'snare': '........xxxxXX'}, vel=0.7)
    for bar in range(A1, A2):
        kit.play(bar, STOMP, vel=0.66)
    for i, bar in enumerate(range(A2, B)):
        kit.play(bar, DRIVE_FILL if i in (3, 7) else DRIVE, vel=0.72)
    for i, bar in enumerate(range(B, C0)):
        kit.play(bar, AXE_FILL if i == 7 else AXE_BEAT, vel=0.74)
    for i, bar in enumerate(range(C, D)):
        if i < 8:
            kit.play(bar, LIGHT7, vel=0.72)
        elif i < 14:
            kit.play(bar, GRIND, vel=0.8)
        else:
            kit.play(bar, {'kick': 'x...x...x.....', 'snare': 'X...X...X.....'}, vel=0.84)
    for i, bar in enumerate(range(D, END)):
        kit.play(bar, DRIVE_FILL if i == 3 else SONG, vel=0.76)
    for bar in (A1, A2, B, C, 45, D):
        kit.play(bar, {'crash': 'X'})

    perc = b.part('perc', 'orch_perc', role='accent', gain=4)
    # the axe: an anvil on every third group of the B strain
    for bar in range(B, C0 - 1):
        drums(perc, bar, {'anvil': '........x.....'}, vel=0.62)
    # a gong under the treaty's first chord, out of the axe's silence
    drums(perc, C0, {'gong': 'x'}, vel=0.5)
    # a cymbal swell into the seven's return under the treaty
    drums(perc, C0 + 1, {'sus': '......x.'}, step=0.5, vel=0.5)
    # the war band's bass drum on the first and last group heads, every 7/8 bar
    bdr = b.part('stamp_bd', 'orch_perc', role='drums', gain=-4)
    for bar in sevens(s, A1, END):
        drums(bdr, bar, {'bd': 'X.......x.....'}, vel=0.72)
    drums(perc, A1, {'crash': 'X', 'bd': 'X'}, vel=0.8)
    drums(perc, D, {'crash': 'X', 'bd': 'X'}, vel=0.84)
    timp = b.part('timp', 'timpani', role='timp', gain=2)
    # the intro: a roll on D swelling under the saw, then strokes with the clusters
    timp.note(s.bar(1), P('D2'), 7.0, vel=0.55, art='roll')
    slots(timp, 3, chart_of('Dm:3.5 Eb:3.5'), 'R.r.R.r', floor=38, vel=0.7, art='default')
    # A1 and D: the timpani doubles the stamp's first and last heads
    slots(timp, A1, ch_tune, 'R...R..', floor=38, vel=0.62, art='default')
    slots(timp, D, ch_tune, 'R......', floor=38, vel=0.58, art='default')
    timp.at(C0).play('%roll @p D2h A2h | B2h F#2h |')
    timp.expr((C0, 0.5), (C0 + 1.9, 0.8), (C, 0.9))
    # in C the timpani are the treaty's drum: they keep its four (a stroke on each of
    # the chorale's half notes, on its chord's root) while the taiko keep the seven;
    # the last, the A under the held leading tone, is a roll that never resolves
    for k, (r1, r3) in enumerate(TREATY_TIMP):
        t = tc + 4 * (k + 2)
        timp.note(t, P(r1), 1.0, vel=0.74, art='default')
        if r3:
            timp.note(t + 2, P(r3), 1.0, vel=0.6, art='default')
    timp.note(tc + 54, P('A2'), 3.0, vel=0.62, art='roll')
    slots(timp, 45, chart_of('Eb:3.5'), 'R.r.R.r', floor=38, vel=0.74, art='default')
    slots(timp, 46, chart_of('Eb:3.5'), 'R.r....', floor=38, vel=0.74, art='default')
    slots(timp, B, ch_axe, 'R.r.Rrr', floor=38, vel=0.66, art='default')

    # ================================================================ near-silence
    # the last group of bar 46: the band drops out under a timpani roll on D and
    # the taiko, and the war song crashes back in on the next downbeat
    t46 = s.bar(46) + 2.0
    clear(s, t46, t46 + 1.5, keep={'taiko'})
    timp.note(t46, P('D2'), 1.5, vel=0.7, art='roll')
    drums(perc, 46, {'sus': '........x.....'}, vel=0.55)

    # ================================================================ HAH!
    # the shout: in the last group of a phrase's last bar the band stops dead (the
    # tunes are resting or holding) and brass, the clan and the drums shout the
    # chord's open fifth, the trumpets a semitone over its root
    tunes = {'tune_hn', 'tune_tbn', 'clan_hi', 'clan_lo', 'laugh', 'song_tpt', 'fiddle',
             'axe_hn', 'axe_tbn', 'axe_vc'}
    for bar, _ in HAHS:
        t = s.bar(bar) + 2.0
        clear(s, t, t + 1.5, keep=tunes)
    hah_b = b.part('hah_brass', 'trombones', role='section', gain=3)
    hah_h = b.part('hah_horns', 'horns', role='section', gain=3)
    hah_t = b.part('hah_tpt', 'trumpets', role='section', gain=-5)
    hah_c = b.part('hah_clan', 'choir', role='choir', gain=9, humanize_ms=10,
                   eq=[('highpass', 90, 0.7, 0.0), ('peak', 2400, 1.0, 2.0)])
    hah_p = b.part('hah_perc', 'orch_perc', role='accent', gain=3)
    boom = b.part('hah_boom', 'boom', role='accent', gain=0)
    for bar, root in HAHS:
        t = s.bar(bar) + 2.0
        r = Chord(root).root_note(38)                 # D2..C#3
        for p in (r, r + 7):
            hah_b.note(t, p + 12, 0.75, vel=0.92, art='default', rearticulate=True, gate=0.9)
            hah_h.note(t, p + 12, 0.75, vel=0.92, art='default', rearticulate=True, gate=0.9)
            hah_c.note(t, p + 12, 0.6, vel=0.9, rearticulate=True)
        hah_t.note(t, r + 25, 0.75, vel=0.88, art='default', rearticulate=True, gate=0.9)
        drums(hah_p, bar, {'bd': '........X.....', 'crash': '........X.....'}, vel=0.8)
        boom.note(t, r - 12 if r - 12 >= 20 else r, 1.5, vel=0.8)
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
    (taiko and bass drum), the trombones and horns roaring the chord's open fifth on
    the strong heads with the semitone above its root ground in, and the stamp never
    stops: it counts 2+2+3 straight across the treaty's two 4/4 bars. The clan sings
    the war song with the horns from the first strain, and an octave under the band
    in the last."""
    v = 'enrage_warchief'
    tk = b.extra(v, 'wc_taiko', 'taiko', role='drums', gain=-2)
    bd = b.extra(v, 'wc_bd', 'orch_perc', role='drums', gain=-4)
    roar = b.extra(v, 'wc_roar', 'trombones', role='section', gain=-3)
    roar_h = b.extra(v, 'wc_roar_hn', 'horns', role='section', gain=-6)
    low = b.extra(v, 'wc_low', 'choir', role='lead2', humanize_ms=16,
                  eq=[('highpass', 80, 0.7, 0.0), ('peak', 300, 1.0, -2.0)])
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
    quiet = (s.bar(46) + 2.0, s.bar(D))
    for t, acc in heads:
        if quiet[0] - 1e-6 <= t < quiet[1] - 1e-6:
            continue
        tk.note(t, P('C2'), 0.5, vel=0.86 if acc else 0.74)
        bd.note(t, 36, 0.5, vel=0.8 if acc else 0.66)
        if not acc:
            continue
        if s.bar(C0) - 1e-6 <= t < s.bar(C) - 1e-6:
            c = Chord('D')
        else:
            c = chord_at(allsp, t)
        r = c.root_note(38)                           # D2..C#3
        for p in (r, r + 7):
            roar.note(t, p + 12, 0.75, vel=0.86, art='default', rearticulate=True, gate=0.6)
        for p in (r + 12, r + 13):
            roar_h.note(t, p + 12, 0.75, vel=0.8, art='default', rearticulate=True, gate=0.6)
    # the clan no longer waits for its strain: it sings the war song with the
    # horns from the first bar, and an octave under the band in the last
    low.at(A1).play('@f ' + TUNE)
    low.at(D).play('@ff ' + TUNE, transpose=-12)
