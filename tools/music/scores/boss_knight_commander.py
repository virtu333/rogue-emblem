"""The Knight Commander — "The Doctrine and Its Ledger".

Act II's cavalry boss, the First Lance of the Second Push: the officer who
wrote the cavalry doctrine the war colleges still teach, and has read the
casualty tables it cost. He believes ("my faith holds"); his last page says
"Remounts sent to the sacred ground, forty. Returned, none. Fodder, not
required." 6/8 at dotted quarter = 112 (the score counts quarters, 168),
B-flat.

Mechanism: A CHORALE AND ITS LEDGER. The doctrine is a brass chorale in
B-flat major (trumpets on the tune, horns and trombones under it, the
tuba's bass), broad, every note half a bar or a whole bar, over a gallop: the
long-short-short of the encounter card (a quarter and two sixteenths to each
dotted quarter) in basses, celli, violas and second violins, a bass guitar,
the timpani on the root, a field drum, and a kit in 6/8. His faith is the
Lydian E-natural: the tune climbs to it over a bright C major (I to II) and a
tubular bell rings it each time it sounds. Then the casualty table: the same
chorale, note for note and at the same loudness, in B-flat minor (the bell
silent, its E lowered to E-flat), while the gallop keeps its speed and loses
one voice every two bars (the second violins, the kit, the bass guitar, the
violas, the timpani, the basses, the celli) until only the field drum is
left under the brass. The tune does not change its mind; the charge thins
under it. Where the doctrine's bass rose E to F under the faith note, the
ledger's falls G-flat to F.

The second push (C) remounts everyone: a line that climbs by step, a held
note and a turn each two bars (G A B-flat C D E F-sharp G, an octave), in
tenths over a bass climbing Eb F G Ab Bb C D Eb, each turn rising into the
next held note (over E-flat, A-flat, B-flat and C it passes the chord's sharp
fourth, the faith note's colour); under it the horns sound the doctrine's head
(root, third, fifth) on every chord, a step higher each time. The tutti
return (A2) brings the violins on the tune (at pitch, then an octave up for
the climb to the cadence), a far choir, everything, and its last cadence is
deceptive: the tune lands on its B-flat as it always has, but the chord
under it is G-flat major (bVI), with a tam-tam stroke. The cost. The loop
goes straight back to the doctrine, the same B-flat now over B-flat major:
he starts again as if nothing had been counted.

Form (6/8 bars): intro 1-4 (the gallop alone, then a trumpet call up the
C major chord onto A, the card's leading tone) | A 5-20 (the doctrine) |
L 21-36 (the ledger; the last voice of the gallop drops at bar 35) | C 37-52
(the second push) | A2 53-68 (the tutti doctrine; bar 68 is the deceptive
G-flat). Loop 5-68, 64 bars.

Enrage ("Lances level!"): the charge is sounded. The celli's gallop breaks
from long-short-short into unbroken sixteenths (the basses keep the gallop),
the horns sound the doctrine's head as a call ("Cavalry, to me!": root,
third, fifth, the octave held) under the tune at each four-bar phrase of the
chorale, and a snare roll swells through the bar before each phrase. The run goes on through the
ledger: enraged, he stops counting what the charge costs, and the run never
thins.
"""

from engine.patterns import Kit, bass, chart, drums, ostinato, pad, pad_under
from engine.score import Score

from scores._battle import Battle

KEY = 'music_boss_knight_commander'

# ------------------------------------------------------------------ material
# The doctrine: Bb major, the faith note E-natural in bars 4, 12 (the bass) and 14.
DOCTRINE = """
Bb4q. D5q. | F5h. | G5q. F5q. | E5h. |
F5q. G5q. | A5q. C6q. | Bb5q. G5q. | F5h. |
Bb4q. D5q. | F5h. | Bb5q. A5q. | G5h. |
A5q. G5q. | F5q. E5q. | D5q. C5q. | Bb4h. |
"""
CH_DOC = ('Bb:3 Bb/D:3 Eb:3/2 Bb/D:3/2 C:3 '
          'F:3/2 Eb:3/2 F:3 Gm:3/2 Cm7:3/2 F:3 '
          'Bb:3 Dm7:3 Eb:3/2 F:3/2 C/E:3 '
          'F:3/2 Eb:3/2 Dm:3/2 C:3/2 Bb/F:3/2 F7:3/2 ')
# the ledger: the same tune in Bb minor (the E lowered, the faith note gone)
LEDGER = """
Bb4q. Db5q. | F5h. | Gb5q. F5q. | Eb5h. |
F5q. Gb5q. | Ab5q. C6q. | Bb5q. Gb5q. | F5h. |
Bb4q. Db5q. | F5h. | Bb5q. Ab5q. | Gb5h. |
Ab5q. Gb5q. | F5q. Eb5q. | Db5q. C5q. | Bb4h. |
"""
CH_LEDGER = chart('Bbm:3 Bbm/Db:3 Gb:3/2 Bbm/Db:3/2 Ebm:3 '
                  'Fm:3/2 Gb:3/2 Fm:3 Gb:3/2 Ebm:3/2 F:3 '
                  'Bbm:3 Db:3 Gb:3/2 Fm:3/2 Ebm/Gb:3 '
                  'Fm:3/2 Ebm:3/2 Db:3/2 Cm7b5:3/2 Bbm/F:3/2 F7:3/2 Bbm:3')
# the second push: a held note and a turn, a step higher every two bars
CHARGE = """
G4h. | G4q. F4e G4e A4e | A4h. | A4q. G4e A4e Bb4e |
Bb4h. | Bb4q. A4e Bb4e C5e | C5h. | C5q. Bb4e C5e D5e |
D5h. | D5q. C5e D5e E5e | E5h. | E5q. D5e E5e F#5e |
F#5h. | F#5q. E5e F#5e G5e | G5h. | A5q. F5e Eb5e C5e |
"""
CH_CHARGE = chart('Eb:6 F:6 Gm:6 Ab:6 Bb:6 C:6 D:6 Eb:3 F7:3')
# the horns: the doctrine's head (root, third, fifth) on each chord of the push
HEADS = """
Eb3q. G3q. | Bb3h. | F3q. A3q. | C4h. |
G3q. Bb3q. | D4h. | Ab3q. C4q. | Eb4h. |
Bb3q. D4q. | F4h. | C4q. E4q. | G4h. |
D4q. F#4q. | A4h. | Eb4q. G4q. | A3q. C4q. |
"""
CH_INTRO = chart('Bb:3 Bb:3 C/Bb:3 F7:3')

INTRO, A, L, C, A2 = 1, 5, 21, 37, 53
END = 69

# ------------------------------------------------------------------ the kit (12 sixteenths a bar)
RIDE6 = {'kick': 'x.....x.....', 'snare': '......X.....', 'hat': 'x.x.x.x.x.x.'}
RIDE6_FILL = {'kick': 'x.....x.....', 'snare': '......x.xxXX', 'tom_lo': '..x.x.......'}
CHARGE6 = {'kick': 'x...x.x...x.', 'snare': '......X.....', 'ride': 'x.x.x.x.x.x.',
           'tom_lo': '...x.....x..'}
CHARGE6_FILL = {'kick': 'x...x.x.....', 'snare': '......xxxxXX', 'tom_mid': '..x.x.......'}
# the gallop on the field drum: long-short-short, the long one accented
GALLOP_SN = 'x...oox...oo'


def cut(part, from_bar, to_bar):
    """Take away a part's notes that start in [from_bar, to_bar): a rider lost."""
    s = part.score
    a, z = s.bar(from_bar), s.bar(to_bar)
    part.notes = [n for n in part.notes if not (a - 1e-9 <= n.start < z - 1e-9)]


def build():
    s = Score('boss_knight_commander', tonic='Bb', bpm=168, meter=(6, 8), intro_bars=4,
              loop_bars=64, title='The Doctrine and Its Ledger', seed=811)
    s.reverb = dict(rt60=2.4, predelay_ms=26, wet_db=-0.5)
    s.master = dict(lufs=-13.5, glue_ratio=1.6)
    b = Battle(s, full_lufs=-13.5, adaptive=False)
    ch_doc = chart(CH_DOC + 'Bb:3')
    ch_doc2 = chart(CH_DOC + 'Gb:3')           # the deceptive cadence: bVI under the B-flat
    b.section('intro', INTRO, CH_INTRO).section('A', A, ch_doc).section('L', L, CH_LEDGER)
    b.section('C', C, CH_CHARGE).section('A2', A2, ch_doc2)
    loop_secs = ('A', 'L', 'C', 'A2')

    # ================================================================ the chorale
    tpt = b.part('tpt', 'trumpets', role='lead', gain=1.5,
                 eq=[('peak', 320, 1.0, -1.5), ('peak', 2600, 1.0, 2.5)])
    tpt.at(A).play('@f ' + DOCTRINE)
    tpt.at(L).play('@f ' + LEDGER)
    tpt.at(A2).play('@f ' + DOCTRINE)
    # horns and trombones voice it under the tune; the tuba walks the chart's bass
    hn = b.part('hn_ch', 'horns', role='section', pan=-0.3, gain=-3,
                eq=[('peak', 280, 1.0, -2.0)])
    tbn = b.part('tbn_ch', 'trombones', role='section', pan=0.35, gain=-3,
                 eq=[('peak', 220, 1.0, -2.5)])
    tuba = b.part('tuba', 'tuba', role='low')
    for sec, dyn in (('A', 0.66), ('L', 0.66), ('A2', 0.74)):
        bar, ch = b.sections[sec]
        pad_under(hn, bar, ch, tpt, n=2, lo=55, gap=3, vel=dyn)
        pad(tbn, bar, ch, n=2, lo=46, hi=60, vel=dyn - 0.04)
        bass(tuba, bar, ch, 'w', 'b', floor=34, vel=dyn)
    # each four-bar phrase leans into its middle and eases at its end
    for base in (A, L, A2):
        for ph in range(4):
            b0 = base + 4 * ph
            tpt.expr((b0, 0.86), (b0 + 2, 1.0), (b0 + 3.6, 0.92), (b0 + 3.99, 0.86))
            for p in (hn, tbn):
                p.expr((b0, 0.85), (b0 + 2, 1.0), (b0 + 3.6, 0.9), (b0 + 3.99, 0.85))
    tpt.expr((C, 1.0), (C + 15.99, 1.0))
    # the tutti return: the violins double the tune, and for its second half
    # (the climb to the cadence) take it an octave up
    vn = b.part('vn', 'violins', role='lead2', art='sus',
                eq=[('highshelf', 6000, 0.7, -3.0)])
    doc_bars = [x.strip() for x in DOCTRINE.strip().replace('\n', ' ').split('|') if x.strip()]
    vn.at(A2).play('@f ' + ' | '.join(doc_bars[:8]) + ' |')
    vn.at(A2 + 8).play('@f ' + ' | '.join(doc_bars[8:]) + ' |', transpose=12)
    # the faith note: a tubular bell rings each E-natural of the doctrine (never the ledger)
    bell = b.part('bell', 'bells', role='accent', gain=1)
    for base in (A, A2):
        for bar, off, dur in ((3, 0.0, 2.8), (11, 0.0, 2.8), (13, 1.5, 1.3)):
            bell.note(s.bar(base + bar) + off, 'E5', dur, vel=0.62, art='damp')
    # a far choir under the return (Act II's budget: a colour, not the tune)
    oohs = b.choir('A2', 'oohs', n=3, lo=55, hi=72, vel=0.5)
    oohs.opts['eq'] = [('peak', 320, 1.0, -3.0)]

    # ================================================================ the second push
    for inst, name, dyn, t in (('violins', 'vn', 'ff', 0), ('trumpets', 'tpt', 'f', 0)):
        p = b.part(name, inst)
        p.at(C).play(f'@{dyn} ' + CHARGE, transpose=t)
    heads = b.part('hn_head', 'horns', role='section', pan=-0.2, gain=-2.5)
    heads.at(C).play('@f ' + HEADS)
    ctb = b.part('tbn_c', 'trombones', role='section', art='stac', pan=0.35, gain=-2)
    ostinato(ctb, C, CH_CHARGE, 'q. q.', 'b b', lo=40, hi=55, vel=0.74)
    bass(tuba, C, CH_CHARGE, 'h. h.', 'b b', floor=34, vel=0.7)

    # ================================================================ the gallop
    # long-short-short to each dotted quarter, everywhere; in the ledger its
    # voices leave one by one (see cut() below)
    g_cb = b.part('g_cb', 'basses', role='low', art='spic')
    g_vc = b.part('g_vc', 'celli', role='section', art='spic')
    g_va = b.part('g_va', 'violas', role='ostinato', art='spic', pan=0.2, gain=1.5)
    g_vn2 = b.part('g_vn2', 'violins2', role='ostinato', art='spic', pan=-0.35, gain=1.5)
    g_timp = b.part('timp', 'timpani', role='timp')
    g_sn = b.part('g_sn', 'orch_perc', role='accent', pan=0.1, gain=-3, depth=0.85,
                  humanize_ms=7, vel_jitter=0.1)
    ebs = b.part('ebass', 'rbass', layer='full', role='bass', duck='kit_kick', gain=-2,
                 eq=[('peak', 260, 1.0, -3.0)])
    sub = b.part('sub', 'sub', layer='full', role='sub')
    for sec in ('intro',) + loop_secs:
        bar, ch = b.sections[sec]
        bass(g_cb, bar, ch, 'q s s', 'b b b', floor=29, vel=0.68, accents='> - -', art='spic')
        bass(g_vc, bar, ch, 'q s s', 'b b b', floor=41, vel=0.62, accents='> - -', art='spic')
        bass(g_timp, bar, ch, 'q s s', 'r r r', floor=38, vel=0.6, accents='> - -')
        n_bars = int(round(sum(x for _, x in ch) / s.bar_beats))
        for k in range(n_bars):
            drums(g_sn, bar + k, {'sn': GALLOP_SN}, step=0.25, vel=0.52)
        if sec == 'intro':
            continue
        ostinato(g_va, bar, ch, 'q s s', '1 0 0', lo=53, hi=67, vel=0.56, accents='> - -')
        ostinato(g_vn2, bar, ch, 'q s s', '2 1 1', lo=62, hi=77, vel=0.52, accents='> - -')
        bass(ebs, bar, ch, 'q s s', 'b b b', floor=28, vel=0.7, accents='> - -')
        bass(sub, bar, ch, 'w', 'b', floor=26, vel=0.55)
    # strong-weak-weak: the two sixteenths of each gallop sit under the long note
    for p in (g_cb, g_vc, g_va, g_vn2, g_timp, ebs):
        for n in p.notes:
            if abs((n.start / 1.5) - round(n.start / 1.5)) > 1e-6:
                n.vel = max(0.2, n.vel - 0.1)
    # the last horse left gathers itself into the second push
    cut(g_sn, C - 1, C)
    drums(g_sn, C - 1, {'sn': 'x...oox.xxxx'}, step=0.25, vel=0.56, ramp=0.45)
    # the intro: the low gallop alone, gathering, then the upper strings
    for p in (g_cb, g_vc, g_timp, g_sn):
        p.expr((INTRO, 0.45), (INTRO + 2, 0.8), (A - 0.05, 1.0))
    ostinato(g_va, INTRO + 2, CH_INTRO[2:], 'q s s', '1 0 0', lo=53, hi=67, vel=0.52)
    ostinato(g_vn2, INTRO + 2, CH_INTRO[2:], 'q s s', '2 1 1', lo=62, hi=77, vel=0.48)

    # ================================================================ the kit
    kit = b.kit = Kit(s, 'kit')
    b.full_only.update(kit.names())
    kit.play(INTRO + 2, {'kick': 'x.....x.....'}, vel=0.6)
    kit.play(INTRO + 3, {'kick': 'x.....x.....', 'snare': '......xxxxXX'}, vel=0.62, ramp=0.3)
    for sec, beat, fill, vel in (('A', RIDE6, RIDE6_FILL, 0.72), ('L', RIDE6, RIDE6_FILL, 0.7),
                                 ('C', CHARGE6, CHARGE6_FILL, 0.76),
                                 ('A2', RIDE6, RIDE6_FILL, 0.76)):
        bar = b.bar(sec)
        for i in range(16):
            kit.play(bar + i, fill if i % 4 == 3 else beat, vel=vel)
        kit.play(bar, {'crash': 'x'}, vel=0.66)
    for k in range(0, 16, 2):                 # the push: a crash on every step up
        kit.play(C + k, {'crash': 'x'}, vel=0.5)
    kit.play(A + 8, {'crash': 'x'}, vel=0.55)
    kit.play(A2 + 8, {'crash': 'x'}, vel=0.55)

    # ================================================================ the ledger: the riders lost
    # one voice of the gallop every two bars, the brass unchanged above it;
    # the field drum is the last left
    lost = (('g_vn2', 2), ('kit_*', 4), ('ebass', 6), ('sub', 6), ('g_va', 8), ('timp', 10),
            ('g_cb', 12), ('g_vc', 14))
    for name, k in lost:
        names = kit.names() if name == 'kit_*' else [name]
        for n in names:
            cut(s.parts[n], L + k, C)

    # ================================================================ intro and accents
    # the call: up the C major chord (the faith chord over the B-flat), then the
    # card's leading tone, A, which the doctrine's first note answers
    call = b.part('tpt_call', 'trumpets', role='lead')
    call.at(INTRO + 2).play('@f G4e C5e E5e G5q. | F5q. A4q. |')
    swell = b.part('hn_swell', 'horns', role='pad', pan=-0.3)
    swell.at(INTRO + 2).play('@mf [C4 E4]h. | [C4 Eb4]h. |')
    swell.expr((INTRO + 2, 0.5), (INTRO + 3.9, 1.0))
    tsw = b.part('tbn_swell', 'trombones', role='pad', pan=0.35)
    tsw.at(INTRO + 2).play('@mf [Bb2 G3]h. | [F2 A3]h. |')
    tsw.expr((INTRO + 2, 0.5), (INTRO + 3.9, 1.0))

    perc = b.part('perc', 'orch_perc', role='accent')
    for bar in (A, L, C, A2):
        drums(perc, bar, {'bd': 'x'}, vel=0.78)
    # the cost: a tam-tam under the deceptive G-flat, and the timpani rolls it
    drums(perc, A2 + 15, {'gong': 'x', 'bd': 'x'}, vel=0.82)
    troll = b.part('timp_roll', 'timpani', role='timp')
    troll.at(A2 + 15).play('%roll @f Gb2h. |')
    troll.expr((A2 + 15, 1.0), (A2 + 15.9, 0.55))
    troll.at(C - 1).play('%roll @mf F2h. |')
    troll.expr((C - 1, 0.4), (C - 0.05, 1.0))
    troll.at(INTRO + 3).play('%roll @mf F2h. |')
    b.riser(C - 2, beats=6, vel=0.5)
    b.riser(A2 - 2, beats=6, vel=0.55)

    knight_commander_enrage(b, [(k, b.sections[k]) for k in loop_secs])
    return b.finish()


def knight_commander_enrage(b, sections, calls=('A', 'L', 'A2')):
    """Lances level: the celli's gallop breaks into unbroken sixteenths
    (replacing it, and never thinning), the horns sound the doctrine's head as
    a call at each four-bar phrase of the chorale, and a snare roll swells
    through the bar before each phrase. In the second push the horns already
    sound the head on every chord, so there the run and the rolls carry it."""
    v = 'enrage_knight_commander'
    s = b.s
    b.extra_variant(v, mute=('g_vc',))
    vc = b.extra(v, 'kc_run_vc', 'celli', role='section', art='spic',
                 eq=[('peak', 250, 1.0, -2.5), ('peak', 1800, 1.0, 1.5)])
    call = b.extra(v, 'kc_call', 'horns', role='counter', pan=-0.45)
    roll = b.extra(v, 'kc_roll', 'orch_perc', role='accent', depth=0.8)
    run = 's s s s s s'
    for name, (bar, ch) in sections:
        bass(vc, bar, ch, run, 'b b 8 b b 8', floor=41, vel=0.55, accents='> - - > - -',
             art='spic')
        n_bars = int(round(sum(x for _, x in ch) / s.bar_beats))
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
            c2 = chord_at(t0 + 1.5)
            top = min(c2.tones_in_range(seq[-1] - 4, 76),
                      key=lambda p: (abs(p - (root + 12)), -p))
            call.note(t0 + 1.5, top, 1.4, vel=0.86)
