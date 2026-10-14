"""The Knight Commander — "The Doctrine and Its Ledger".

Act II's cavalry boss, the First Lance of the Second Push: the officer who
wrote the cavalry doctrine the war colleges still teach, and has read the
casualty tables it cost. He believes ("my faith holds"); his last page says
"Remounts sent to the sacred ground, forty. Returned, none. Fodder, not
required." 6/8 at dotted quarter = 101 (the score counts quarters, 152),
B-flat minor.

Mechanism: A DOCTRINE AND ITS LEDGER. The doctrine is a slow brass tune in
B-flat minor, the horns with the trombones an octave under them (the
middle-low brass, never the trumpets' top). Its head is three gestures: the
tonic held, the flat second's sigh (C-flat back to B-flat, over a C-flat
chord on the tonic pedal: the Neapolitan pressed onto the home note), and a
leap up to his faith, the E-natural. In the old reading that E was the
bright Lydian note; here it is the tritone over the B-flat pedal (an E
diminished seventh), only the dominant's F answers it, and a tubular bell
rings it each time. The tune sinks (G-flat, F, D-flat, E-flat, C), says its
head again, then climbs to the C-flat a ninth above and crosses the bar in a
hemiola (three quarters across the 6/8 bar, the chords changing with them:
G-flat, C-flat, G-flat; F, E-flat minor, B-flat minor) before falling to the
leading tone. Every dominant carries its flat ninth; no major tonic sounds
anywhere. Under it the low strings saw in unbroken eighths (the celli up to
the flat second on every third), with the basses and a bass guitar, the
tuba on the roots, the upper strings in tremolo on the chords, low oohs, one
taiko, timpani and kick stroke a bar; held notes are answered by sustained
trumpet clusters, each with a minor second or a tritone in it. The card's
long-short-short (a quarter and two sixteenths to each dotted quarter) is the
riders' hooves, in the timpani and a field drum: heard in the intro, the
ledger and the push, silent under the doctrine.

The ledger (L) opens on a cut: a tam-tam, a bass drum and one brass stroke
(B-flat, C-flat, E). Then the choir reads the doctrine out, note for note in
its low octave (oohs an octave above, softly), the brass only hold bare
octaves of the roots, the upper strings take up the gallop, and the
accompaniment loses one voice every two bars (the second violins, the kit,
the bass guitar, the violas, the timpani, the basses and tuba, the celli and
low brass), the bell tolling the faith note's tritone once for each, until
only the field drum and the choir are left, near silence, the violins'
tremolo shivering on B-flat and C-flat (A over the dominant) and swelling
through the last two bars with a snare roll.

The second push (C) bursts back with everything: the low brass line holds a
note and turns up into the next, a step higher every two bars (F3 to G-flat
4), over a bass that climbs by semitones from B-flat to F, every chord minor,
bare or diminished (B-flat minor, a bare C-flat fifth, C minor, D-flat minor,
E-flat minor, the E diminished seventh, F minor seventh, F seventh flat
nine): the push gains ground and the dark only thickens. Above it the
violins' tremolo holds B-flat, the trumpets stab each chord with a cluster
holding a minor second, the choir sings the chords, the trombones strike
each stride's fifth (on E, its tritone), taiko on every beat. The tutti
return (A2) sings the doctrine with everyone (horns, trombones, trumpets,
the choir in octaves, the violins an octave up), and its cadence is
deceptive: the tune reaches G-flat over G-flat (bVI) with a tam-tam and a
timpani roll, then the leading tone over the flat-ninth dominant drives
straight back into the doctrine. Nothing resolves: every strain ends on the
dominant.

Form (6/8 bars): intro 1-4 (the saw and the hooves alone, then the card's
call, B-flat minor up the arpeggio to its leading tone, A) | A 5-20 (the
doctrine) | L 21-36 (the ledger; the last voices drop at bar 35) | C 37-52
(the second push) | A2 53-68 (the tutti doctrine; bar 68 is the deceptive
G-flat). Loop 5-68, 64 bars.

Enrage ("Lances level!"): the charge is sounded. The riders' hooves become
a stampede: the card's long-short-short in a taiko and a bass drum on every
stride of every strain, under the doctrine too (where the plain mix keeps
them silent); the horns and trombones in octaves sound the doctrine's head
as a call ("Cavalry, to me!": root, third, fifth, the octave held) under the
tune at each four-bar phrase; and a snare roll swells through the bar before
each phrase. The stampede goes on through the ledger: enraged, he stops counting
what the charge costs, and it never thins.
"""

from engine.patterns import Kit, chart, drums, ostinato, pad, pad_under
from engine.score import Score
from engine.theory import pitch

from scores._battle import Battle

KEY = 'music_boss_knight_commander'

# ------------------------------------------------------------------ material
# The doctrine: B-flat minor. Its head is the tonic, the flat second's sigh
# (C-flat back to B-flat) and the leap to the faith note, E-natural, the
# tritone, that only the dominant's F resolves; its climb is a hemiola
# (three quarters across the 6/8 bar, bars 14-15)
DOC_BODY = """
Bb3h. | Cb4q. Bb3q. | E4h.> | F4h. |
Gb4q. F4q. | Db4h. | Eb4q. Db4q. | C4h. |
Bb3h. | Cb4q. Bb3q. | E4h.> | F4q. Gb4q. |
A4h. | Bb4q Cb5q Bb4q | A4q Gb4q F4q |
"""
DOC_A = DOC_BODY + 'E4q. A3q. |'          # A and the ledger: the faith note, the leading tone
DOC_A2 = DOC_BODY + 'Gb4q. A3q. |'        # the return: G-flat over G-flat, the tam-tam
CH_DOC = ('Bbm:3 Cb:3/2 Bbm:3/2 Edim7:3 F7b9:3 '
          'Ebm:3/2 Bbm/F:3/2 Bbm/Db:3 Ebm:3 F7b9:3 '
          'Bbm:3 Cb:3/2 Bbm:3/2 Edim7:3 Bbm/F:3/2 F7b9:3/2 '
          'F7b9:3 Gb:1 Cb:1 Gb:1 F7b9:1 Ebm:1 Bbm/F:1 ')
CH_A = chart(CH_DOC + 'Edim7:3/2 F7b9:3/2')
CH_A2 = chart(CH_DOC + 'Gb:3/2 F7b9:3/2')    # the deceptive cadence: bVI
# the low strings' roots (their own line: a pedal where the harmony moves above it)
GAL_DOC = ('Bb1:9 F1:3 Eb1:3/2 F1:3/2 Db2:3 Eb1:3 F1:3 Bb1:9 F1:3 '
           'F1:3 Gb1:1 Cb2:1 Gb1:1 F1:1 Eb1:1 F1:1 ')
GAL_A = GAL_DOC + 'E1:3/2 F1:3/2'
GAL_A2 = GAL_DOC + 'Gb1:3/2 F1:3/2'
# the second push: a held note and a turn, a step higher every two bars
CHARGE = """
F4h. | F4q. Eb4e F4e Gb4e | Gb4h. | Gb4q. F4e Gb4e G4e |
G4h. | G4q. F4e G4e Ab4e | Ab4h. | Ab4q. G4e Ab4e Bb4e |
Bb4h. | Bb4q. Ab4e Bb4e C5e | Db5h. | Db5q. Bb4e C5e Db5e |
Eb5h. | Eb5q. Db5e Eb5e F5e | Gb5h. | F5q. Db5e C5e A4e |
"""
CH_C = chart('Bbm:6 Cb5:6 Cm:6 Dbm:6 Ebm:6 Edim7:6 Fm7:6 F7b9:6')
GAL_C = 'Bb1:6 Cb2:6 C2:6 Db2:6 Eb2:6 E2:6 F2:12'
# the trumpets' stabs in the push: each chord with a minor second in it
CSTABS = ('[Bb4 Cb5 F5]', '[Bb4 Cb5 Gb5]', '[C5 Db5 G5]', '[C5 Db5 Ab5]',
          '[Eb5 Fb5 Bb5]', '[Db5 E5 Bb5]', '[F5 Gb5 C6]', '[Eb5 Gb5 A5]')
CH_INTRO = chart('Bbm:6 Bbm:3 F7b9:3')
GAL_INTRO = 'Bb1:9 F1:3'
# the trumpets' stabs: a cluster on the two eighths after each held note
STABS = {3: '[A4 Eb5 Gb5]', 5: '[Db5 F5 Gb5]', 7: '[A4 Eb5 Gb5]', 10: '[G4 Bb4 Db5]',
         12: '[C5 Eb5 Gb5]'}

INTRO, A, L, C, A2 = 1, 5, 21, 37, 53
END = 69

# ------------------------------------------------------------------ the kit (12 sixteenths a bar)
DOC6 = {'kick': 'x...........'}
DOC6_FILL = {'kick': 'x.....x.....', 'snare': '......x.xxXX', 'tom_lo': '..x.x.......'}
CHARGE6 = {'kick': 'x...x.x...x.', 'snare': '......X.....', 'hat': 'x.x.x.x.x.x.',
           'tom_lo': '...x.....x..'}
CHARGE6_FILL = {'kick': 'x...x.x.....', 'snare': '......xxxxXX', 'tom_mid': '..x.x.......'}
# the gallop on the field drum: long-short-short, the long one accented
GALLOP_SN = 'x...oox...oo'
TAIKO_BB = 48           # the GeneralUser taiko key that rings on B-flat


def roots(text):
    """'Bb1:12 Gb1:3/2 ...' -> [(midi, beats), ...]: the gallop's own bass line."""
    out = []
    for tok in text.split():
        p, beats = tok.split(':')
        out.append((pitch(p), float(eval(beats))))
    return out


def gallop(part, bar, line, octave=0, vel=0.66, saw=False, art='spic', lo=0, run=False):
    """Long-short-short to each dotted quarter on the line's roots (an octave
    up for `octave=1`, any root under `lo` an octave up). `saw`: the first
    sixteenth of every other stride goes up to the flat second. `run`: six
    unbroken sixteenths (root, root, flat second) instead of the gallop."""
    t = part.score.bar(bar)
    k = 0
    for p, beats in line:
        p += 12 * octave
        if p < lo:
            p += 12
        if abs(beats / 1.5 - round(beats / 1.5)) > 1e-6:
            # a hemiola's quarter: the run keeps its sixteenths, the gallop
            # strikes once (the riders cross the bar with the tune)
            if run:
                for j in range(int(round(beats / 0.25))):
                    q = p + 1 if j % 3 == 2 else p
                    part.note(t + 0.25 * j, q, 0.25, vel=vel + (0.12 if j == 0 else 0.0),
                              art=art)
            else:
                part.note(t, p, beats, vel=vel + 0.08, art=art)
            t += beats
            continue
        n = int(round(beats / 1.5))
        for i in range(n):
            t0 = t + 1.5 * i
            if run:
                for j in range(6):
                    q = p + 1 if j % 3 == 2 else p
                    part.note(t0 + 0.25 * j, q, 0.25, vel=vel + (0.12 if j == 0 else 0.0),
                              art=art)
            else:
                second = p + 1 if saw and k % 2 == 1 else p
                part.note(t0, p, 1.0, vel=vel + 0.1, art=art)
                part.note(t0 + 1.0, second, 0.25, vel=vel - 0.08, art=art)
                part.note(t0 + 1.25, p, 0.25, vel=vel - 0.1, art=art)
            k += 1
        t += beats
    return t


def saw(part, bar, line, octave=0, vel=0.62, art='spic', lo=0, neighbour=True):
    """Unbroken eighths on the line's roots, the first of each three accented;
    with `neighbour` the third of each three goes up to the flat second (the
    low strings sawing: B-flat, B-flat, C-flat)."""
    t = part.score.bar(bar)
    for p, beats in line:
        p += 12 * octave
        if p < lo:
            p += 12
        for i in range(int(round(beats / 0.5))):
            q = p + 1 if neighbour and i % 3 == 2 else p
            v = vel + (0.07 if i % 6 == 0 else 0.0) + (0.04 if i % 3 == 2 else 0.0)
            part.note(t + 0.5 * i, q, 0.5, vel=v, art=art)
        t += beats
    return t


def held(part, bar, line, octave=0, vel=0.6, dur=None, art=None):
    """The line's roots held (the tuba, the sub)."""
    t = part.score.bar(bar)
    for p, beats in line:
        part.note(t, p + 12 * octave, dur or beats, vel=vel, art=art or 'default')
        t += beats


def cut(part, from_bar, to_bar):
    """Take away a part's notes that start in [from_bar, to_bar): a rider lost."""
    s = part.score
    a, z = s.bar(from_bar), s.bar(to_bar)
    part.notes = [n for n in part.notes if not (a - 1e-9 <= n.start < z - 1e-9)]


def build():
    s = Score('boss_knight_commander', tonic='Bb', bpm=152, meter=(6, 8), intro_bars=4,
              loop_bars=64, title='The Doctrine and Its Ledger', seed=811)
    s.reverb = dict(rt60=2.6, predelay_ms=26, wet_db=-0.5)
    s.master = dict(lufs=-13.5, glue_ratio=1.6)
    b = Battle(s, full_lufs=-13.5, adaptive=False)
    b.section('intro', INTRO, CH_INTRO).section('A', A, CH_A).section('L', L, CH_A)
    b.section('C', C, CH_C).section('A2', A2, CH_A2)
    gal = {'intro': roots(GAL_INTRO), 'A': roots(GAL_A), 'L': roots(GAL_A),
           'C': roots(GAL_C), 'A2': roots(GAL_A2)}
    loop_secs = ('A', 'L', 'C', 'A2')

    # ================================================================ the doctrine
    # horns on the tune, the trombones an octave under them
    hn = b.part('hn_tune', 'horns', role='lead', gain=0.5, eq=[('peak', 2400, 1.0, 1.5)])
    tbn = b.part('tbn_tune', 'trombones', role='section', gain=-1.0,
                 eq=[('peak', 220, 1.0, -2.0)])
    for bar in (A, A2):
        tune = DOC_A if bar == A else DOC_A2
        hn.at(bar).play('@f ' + tune)
        tbn.at(bar).play('@f ' + tune, transpose=-12)
    # each four-bar phrase leans into its middle and eases at its end
    for base in (A, A2):
        for ph in range(4):
            b0 = base + 4 * ph
            for p in (hn, tbn):
                p.expr((b0, 0.86), (b0 + 2, 1.0), (b0 + 3.6, 0.92), (b0 + 3.99, 0.86))
    # the tutti return: trumpets on the tune with the horns, the violins an octave up
    tpt = b.part('tpt', 'trumpets', role='lead2', gain=-2.0,
                 eq=[('peak', 3000, 1.0, -2.0), ('highshelf', 6000, 0.7, -3.0)])
    tpt.at(A2).play('@f ' + DOC_A2)
    vn = b.part('vn', 'violins', role='lead2', art='sus',
                eq=[('highshelf', 6000, 0.7, -3.0)])
    vn.at(A2).play('@f ' + DOC_A2, transpose=12)
    # the tuba holds the gallop's roots
    tuba = b.part('tuba', 'tuba', role='low')
    for sec in loop_secs:
        if sec != 'C':
            held(tuba, b.bar(sec), gal[sec], octave=1, vel=0.62 if sec == 'L' else 0.7)
    # a low choir (oohs) under the doctrine
    oohs = b.part('oohs', 'oohs', role='choir', gain=-1.0, eq=[('peak', 320, 1.0, -2.0)])
    pad_under(oohs, A, CH_A, hn, n=3, lo=46, gap=2, vel=0.55)
    pad_under(oohs, A2, CH_A2, hn, n=3, lo=46, gap=2, vel=0.6)
    # the faith note: a tubular bell rings each E-natural of the doctrine, a
    # tritone over the B-flat
    bell = b.part('bell', 'bells', role='accent', gain=0.5)
    for base in (A, A2):
        for bar, off, dur in ((2, 0.0, 2.8), (10, 0.0, 2.8), (15, 0.0, 1.4)):
            if base == A2 and bar == 15:
                continue
            bell.note(s.bar(base + bar) + off, 'E5', dur, vel=0.64, art='damp')
    # the trumpets' stabs: a cluster on the two eighths after each held note
    stab = b.part('stab', 'trumpets', role='accent', pan=0.3, gain=-2.0,
                  eq=[('highshelf', 6000, 0.7, -3.0)])
    for k, ch in STABS.items():
        stab.at(A + k).play(f'@f rq. {ch}q.> |')
        stab.expr((A + k + 0.5, 1.0), (A + k + 0.99, 0.6))

    # ================================================================ the ledger
    # the choir reads the doctrine out, in octaves; the brass only hold the chords
    chorus = b.part('choir', 'choir', role='lead', gain=1.0, humanize_ms=10,
                    eq=[('peak', 300, 1.0, -1.5)])
    chorus.at(L).play('@f ' + DOC_A, transpose=-12)
    oohs.at(L).play('@mp ' + DOC_A)
    chorus.at(A2).play('@f ' + DOC_A2)
    chorus.at(A2).play('@f ' + DOC_A2, transpose=-12)
    for base in (L,):
        for ph in range(4):
            b0 = base + 4 * ph
            chorus.expr((b0, 0.84), (b0 + 2, 1.0), (b0 + 3.6, 0.9), (b0 + 3.99, 0.84))
    lpad = b.part('tbn_pad', 'trombones', role='pad', gain=-4.0, pan=0.3,
                  eq=[('peak', 220, 1.0, -2.0)])
    held(lpad, L, gal['L'], octave=1, vel=0.5)     # bare octaves: no hymn under the choir
    held(lpad, L, gal['L'], octave=2, vel=0.46)
    # the violins' tremolo: a shiver between B-flat and C-flat, high and soft,
    # swelling through the last two bars into the push
    trem = b.part('vn_trem', 'violins', role='pad', art='trem', gain=-3.0,
                  eq=[('highshelf', 7000, 0.7, -3.0)])
    trem.at(L).play('@p Bb5h. | Bb5h. | Cb6h. | Bb5h. | Bb5h. | A5h. | Bb5h. | A5h. | '
                    'Bb5h. | Cb6h. | Bb5q. A5q. | Cb6h. | A5h. | Bb5h. | Bb5q. A5q. | '
                    'Bb5q. A5q. |')
    trem.expr((L, 0.55), (C - 2, 0.6), (C - 0.05, 1.0))
    # the bell tolls the faith note's tritone once for each voice lost
    for k in range(2, 16, 2):
        bell.note(s.bar(L + k), 'E4', 2.9, vel=0.5, art='damp')

    # ================================================================ the second push
    # the line in the low brass: horns, the trombones an octave under them
    lead = b.part('c_hn', 'horns', role='lead', gain=0.5, eq=[('peak', 2400, 1.0, 1.5)])
    lead.at(C).play('@ff ' + CHARGE, transpose=-12)
    leadb = b.part('c_tbn', 'trombones', role='section', gain=-0.5,
                   eq=[('peak', 220, 1.0, -2.0)])
    leadb.at(C).play('@ff ' + CHARGE, transpose=-24)
    # above it the violins' tremolo shivers on B-flat, then C-flat and A
    trem.at(C).play('@f ' + 'Bb5h. | ' * 12 + 'Cb6h. | Cb6h. | A5h. | A5h. |')
    # and the trumpets stab each chord with a minor second
    for k, ch in enumerate(CSTABS):
        stab.at(C + 2 * k).play(f'@f rq. {ch}q.> |')
        stab.expr((C + 2 * k + 0.5, 1.0), (C + 2 * k + 0.99, 0.6))
    # the trombones' fifths on every stride, the tuba on the roots
    cfifth = b.part('tbn_c', 'trombones', role='section', art='stac', pan=0.35, gain=-4.0)
    t = s.bar(C)
    for p, beats in gal['C']:
        for i in range(int(round(beats / 1.5))):
            fifth = 6 if p % 12 == 4 else 7       # the E diminished: its tritone
            for q in (p + 12, p + 12 + fifth):
                cfifth.note(t + 1.5 * i, q, 1.0, vel=0.78 if i % 2 == 0 else 0.68, art='stac')
        t += beats
    held(tuba, C, gal['C'], octave=1, vel=0.72, dur=None)
    b.choir('C', 'choir', n=4, lo=46, hi=62, vel=0.66)

    # ================================================================ the gallop
    g_cb = b.part('g_cb', 'basses', role='low', art='spic')
    g_vc = b.part('g_vc', 'celli', role='section', art='spic')
    g_va = b.part('g_va', 'violas', role='ostinato', art='spic', pan=0.2, gain=1.0)
    g_vn2 = b.part('g_vn2', 'violins2', role='ostinato', art='spic', pan=-0.35, gain=0.5)
    g_timp = b.part('timp', 'timpani', role='timp')
    g_sn = b.part('g_sn', 'orch_perc', role='accent', pan=0.1, gain=-3, depth=0.85,
                  humanize_ms=7, vel_jitter=0.1)
    ebs = b.part('ebass', 'rbass', layer='full', role='bass', duck='kit_kick', gain=-2,
                 eq=[('peak', 260, 1.0, -3.0)])
    sub = b.part('sub', 'sub', layer='full', role='sub')
    for sec in ('intro',) + loop_secs:
        bar, ch = b.sections[sec]
        line = gal[sec]
        saw(g_cb, bar, line, vel=0.6, neighbour=False)
        saw(g_vc, bar, line, octave=1, vel=0.58)
        n_bars = int(round(sum(x for _, x in ch) / s.bar_beats))
        if sec in ('A', 'A2'):
            # under the doctrine the hooves are silent: one timpani stroke a bar
            t = s.bar(bar)
            for p, beats in line:
                for i in range(int(round(beats / 1.5))):
                    if abs((t + 1.5 * i - s.bar(bar)) % 3.0) < 1e-6:
                        q = p + 12 if p + 12 >= 38 else p + 24
                        g_timp.note(t + 1.5 * i, q, 1.5, vel=0.74, art='default')
                t += beats
        else:
            gallop(g_timp, bar, line, octave=1, vel=0.58, art='default', lo=38)
            for k in range(n_bars):
                drums(g_sn, bar + k, {'sn': GALLOP_SN}, step=0.25,
                      vel=0.5 if sec == 'L' else 0.42)
        if sec == 'intro':
            continue
        if sec == 'L':
            ostinato(g_va, bar, ch, 'q s s', '1 0 0', lo=53, hi=67, vel=0.56, accents='> - -')
            ostinato(g_vn2, bar, ch, 'q s s', '2 1 1', lo=60, hi=74, vel=0.52, accents='> - -')
        elif sec == 'C':
            ostinato(g_va, bar, ch, 'e e e', '0 1 2', lo=53, hi=67, vel=0.54, accents='> - -')
            ostinato(g_vn2, bar, ch, 'e e e', '2 1 0', lo=60, hi=74, vel=0.5, accents='> - -')
        else:
            # under the doctrine the upper strings shiver on the chords instead
            pad(g_va, bar, ch, n=2, lo=53, hi=65, vel=0.5, art='trem')
            pad(g_vn2, bar, ch, n=2, lo=62, hi=74, vel=0.46, art='trem')
        saw(ebs, bar, line, vel=0.64, art='default', lo=28, neighbour=False)
        held(sub, bar, line, vel=0.55)
    # strong-weak-weak: the two sixteenths of each gallop sit under the long note
    for p in (g_va, g_vn2):
        for n in p.notes:
            off_beat = abs((n.start / 1.5) - round(n.start / 1.5)) > 1e-6
            if n.art == 'spic' and n.dur < 0.3 and off_beat:
                n.vel = max(0.2, n.vel - 0.1)
    # the last horse left gathers itself into the second push
    cut(g_sn, C - 1, C)
    drums(g_sn, C - 1, {'sn': 'x...oox.xxxx'}, step=0.25, vel=0.56, ramp=0.45)
    # the intro: the low gallop alone, gathering
    for p in (g_cb, g_vc, g_timp, g_sn):
        p.expr((INTRO, 0.45), (INTRO + 2, 0.8), (A - 0.05, 1.0))

    # ================================================================ drums
    kit = b.kit = Kit(s, 'kit')
    b.full_only.update(kit.names())
    kit.play(INTRO + 2, {'kick': 'x.....x.....'}, vel=0.6)
    kit.play(INTRO + 3, {'kick': 'x.....x.....', 'snare': '......xxxxXX'}, vel=0.62, ramp=0.3)
    for sec, beat, fill, vel in (('A', DOC6, DOC6_FILL, 0.72), ('L', DOC6, DOC6_FILL, 0.68),
                                 ('C', CHARGE6, CHARGE6_FILL, 0.78),
                                 ('A2', DOC6, DOC6_FILL, 0.76)):
        bar = b.bar(sec)
        for i in range(16):
            kit.play(bar + i, fill if i % 4 == 3 else beat, vel=vel)
        kit.play(bar, {'crash': 'x'}, vel=0.66)
    for k in range(2, 16, 2):                 # the push: a crash on every step up
        kit.play(C + k, {'crash': 'x'}, vel=0.5)
    # taiko: each bar's downbeat under the doctrine, every stride in the push
    # and the return
    taiko = b.part('taiko', 'taiko', layer='full', role='accent', gain=-1.0)
    for sec in ('A', 'C', 'A2'):
        bar = b.bar(sec)
        for k in range(16):
            t0 = s.bar(bar + k)
            if sec == 'A':
                taiko.note(t0, TAIKO_BB, 0.5, vel=0.7 if k % 4 == 0 else 0.56)
            else:
                taiko.note(t0, TAIKO_BB, 0.5, vel=0.74 if k % 2 == 0 else 0.64)
                taiko.note(t0 + 1.5, TAIKO_BB, 0.5, vel=0.56)
    for k in range(4):                        # the ledger's first bars, before the kit falls
        taiko.note(s.bar(L + k), TAIKO_BB, 0.5, vel=0.58)

    # ================================================================ the ledger: the riders lost
    # one voice of the gallop every two bars, the choir unchanged above it;
    # the field drum is the last left
    lost = (('g_vn2', 2), ('kit_*', 4), ('ebass', 6), ('sub', 6), ('g_va', 8), ('timp', 10),
            ('g_cb', 12), ('tuba', 12), ('g_vc', 14), ('tbn_pad', 14))
    for name, k in lost:
        names = kit.names() if name == 'kit_*' else [name]
        for n in names:
            cut(s.parts[n], L + k, C)

    # ================================================================ intro and accents
    # the call: the card's gesture, up the B-flat minor arpeggio onto its leading tone, A
    call = b.part('hn_call', 'horns', role='lead')
    call.at(INTRO + 2).play('@f Bb3e Db4e F4e Bb4q. | A4h. |')
    callb = b.part('tbn_call', 'trombones', role='section', pan=0.35)
    callb.at(INTRO + 2).play('@f Bb2e Db3e F3e Bb3q. | [F2 C3]h. |')
    swell = b.part('hn_swell', 'horns', role='pad', pan=-0.3)
    swell.at(INTRO + 3).play('@mf [Eb4 Gb4]h. |')
    swell.expr((INTRO + 3, 0.5), (INTRO + 3.9, 1.0))

    perc = b.part('perc', 'orch_perc', role='accent')
    for bar in (A, C, A2):
        drums(perc, bar, {'bd': 'x'}, vel=0.8)
    # the ledger opens on a cut: one dissonant stroke (B-flat, C-flat, E), then the count
    drums(perc, L, {'bd': 'x', 'gong': 'x'}, vel=0.8)
    cutb = b.part('cut_brass', 'trombones', role='accent', art='stac', pan=0.2)
    cutb.at(L).play('@ff [Bb2 Cb3 E3 Bb3]q> rq rq |')
    cuth = b.part('cut_horns', 'horns', role='accent', art='stac', pan=-0.2)
    cuth.at(L).play('@ff [E4 Bb4 Cb5]q> rq rq |')
    drums(perc, C, {'gong': 'x'}, vel=0.7)
    # the push: a snare roll swells through the ledger's last bar
    drums(perc, C - 1, {'sn_roll': 'x' * 24}, step=0.125, vel=0.5, ramp=0.8)
    # the cost: a tam-tam under the deceptive G-flat, and the timpani rolls it
    drums(perc, A2 + 15, {'gong': 'x', 'bd': 'x'}, vel=0.82)
    troll = b.part('timp_roll', 'timpani', role='timp')
    troll.at(A2 + 15).play('%roll @f Gb2q. F2q. |')
    troll.expr((A2 + 15, 1.0), (A2 + 15.9, 0.8))
    troll.at(C - 1).play('%roll @mf E2q. F2q. |')
    troll.expr((C - 1, 0.4), (C - 0.05, 1.0))
    troll.at(INTRO + 3).play('%roll @mf F2h. |')
    b.riser(C - 2, beats=6, vel=0.5)
    b.riser(A2 - 2, beats=6, vel=0.55)

    knight_commander_enrage(b, [(k, b.sections[k]) for k in loop_secs], gal)
    return b.finish()


def knight_commander_enrage(b, sections, gal, calls=('A', 'L', 'A2')):
    """Lances level: the charge is sounded. The riders' hooves (the card's
    long-short-short) become a stampede in the low drums, a taiko and a bass
    drum on every stride of every strain, under the doctrine too and never
    thinning in the ledger; the horns and trombones in octaves sound the
    doctrine's head as a call at each four-bar phrase of the doctrine; and a
    snare roll swells through the bar before each phrase. In the second push
    the brass already carry the line, so there the stampede and the rolls
    carry it."""
    v = 'enrage_knight_commander'
    s = b.s
    b.extra_variant(v)
    hooves = b.extra(v, 'kc_hooves', 'taiko', role='accent', gain=1.0)
    hooves_bd = b.extra(v, 'kc_hooves_bd', 'orch_perc', role='accent', depth=0.75, gain=-2.0)
    call = b.extra(v, 'kc_call', 'horns', role='counter', pan=-0.45)
    callb = b.extra(v, 'kc_call_tbn', 'trombones', role='counter', pan=0.45, gain=-1.5)
    roll = b.extra(v, 'kc_roll', 'orch_perc', role='accent', depth=0.8)
    for name, (bar, ch) in sections:
        n_bars = int(round(sum(x for _, x in ch) / s.bar_beats))
        for k in range(2 * n_bars):
            t0 = s.bar(bar) + 1.5 * k
            hooves.note(t0, TAIKO_BB, 0.5, vel=0.86 if k % 2 == 0 else 0.76)
            hooves.note(t0 + 1.0, TAIKO_BB, 0.25, vel=0.5)
            hooves.note(t0 + 1.25, TAIKO_BB, 0.25, vel=0.56)
            hooves_bd.note(t0, 36, 0.5, vel=0.72 if k % 2 == 0 else 0.6)
        # the snare roll swells through each phrase's last bar, into the next
        for k in range(3, n_bars, 4):
            drums(roll, bar + k, {'sn': 'x' * 22 + '..'}, step=0.125, vel=0.5, ramp=0.75)
        if name not in calls:
            continue
        t = s.bar(bar)
        spans = []
        for c, beats in ch:
            spans.append((t, t + beats, c))
            t += beats

        def chord_at(beat):
            for a, z, c in spans:
                if a - 1e-9 <= beat < z - 1e-9:
                    return c
            return spans[-1][2]

        for k in range(0, n_bars, 4):
            t0 = s.bar(bar + k)
            # the call ("Cavalry, to me!"), under the tune: root, third, fifth in
            # eighths while the tune holds its first note, then the octave held
            c1 = chord_at(t0)
            root = c1.root_note(55)
            seq = [x for x in c1.tones_in_range(root, root + 12)][:3]
            for i, p in enumerate(seq):
                call.note(t0 + 0.5 * i, p, 0.5, vel=0.8)
                callb.note(t0 + 0.5 * i, p - 12, 0.5, vel=0.78)
            c2 = chord_at(t0 + 1.5)
            top = min(c2.tones_in_range(seq[-1] - 4, 76),
                      key=lambda p: (abs(p - (root + 12)), -p))
            call.note(t0 + 1.5, top, 1.4, vel=0.86)
            callb.note(t0 + 1.5, top - 12, 1.4, vel=0.82)
