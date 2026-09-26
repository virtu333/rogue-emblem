"""Tundra battles — "Rime" (Act IV, the frozen frontier at night).

Breath, glass, distance. The tune is a line that knows when to stop moving:
a quick reach up (E5 G5, then F#5 A5) to one note, B, which is then held for
thirteen beats while the harmony changes under it, and a small descent at
the end (A G, then A F#). The held B is the piece: it is the ninth of A
minor, the raised eleventh of F, the sixth of D minor and the fifth of the
open E; in the second phrase the major seventh of C, the ninth, the raised
eleventh, the fifth. The same note keeps changing what it means, and the
line never resolves — the second phrase ends on F-sharp over the open fifth.
E is the tonic, never sounded with a third: no warmth arrives in this piece.

The note also changes colour exactly when it changes meaning (`relay`): the
violins reach it and hold it as the ninth of A minor, then hand it on at
each chord change, a muted trumpet taking the raised eleventh of F (a muted
horn in the octave below), the clarinet the sixth of D minor, the violas the
bare fifth of E; where it is the major seventh of C, the celesta re-strikes
it. Each holder lets go half a beat after the next has entered, so the B is
passed, never dropped, and in the full mix no one instrument holds it for
more than three and a half seconds (the violins once held it for
seventeen, long enough to hear the sample loop). The violins keep the
reach and the descent.

Celesta and glockenspiel (the glass), harp in its harmonics register, high
divisi violins, tremolo violas, low trombones and muted horns for the cold;
under everything a low pulse that never warms: pizzicato basses on every
beat, the sub, and a soft kick that only breathes, on one and three.

Form (4/4, 112): intro 1-4 (the pulse, the held note alone) | A 5-12 |
A2 13-20 (glock, tremolo, kit) | B 21-28 (distance: the harmony hurries at
twice the rate while the B is held for thirty-two beats, changing hands at
every chord, every two beats; the reach is echoed low in the celli and high
in the glock) | A3 29-36 (full weight; the held B doubled in octaves by its
holders) | turn 37-40. No leitmotif. Calm: flute, oboe, clarinet and solo
violin on the tune over the celesta, harp, soft low strings and the pulse;
in B and the turn they pass the held B among themselves by the same rule.
"""

from engine.patterns import Kit, arp, bass, chart
from engine.score import Score

from scores._battle import Battle

KEY = 'music_battle_tundra'

# the tune: reach, the held note, a small descent
MEL = """
rq E5e G5e B5h~ | B5w~ | B5w~ | B5h. A5e G5e |
rq F#5e A5e B5h~ | B5w~ | B5w~ | B5h A5q F#5q |
"""
# the same line with a breath at the end of each phrase, for the winds
MEL_BR = """
rq E5e G5e B5h~ | B5w~ | B5h. rq | rq B5h A5e G5e |
rq F#5e A5e B5h~ | B5w~ | B5h. rq | rq B5q A5q F#5q |
"""
# B: the held note alone, the whole strain
HELD = 'B5w~ | ' * 7 + 'B5w |'
# the reach, low (celli) and high (glock), as an echo in the B strain
REACH_LO = 'rq E3e G3e B3h~ | B3h A3e G3e rq | rq F#3e A3e B3h~ | B3h A3q F#3q |'
REACH_HI = 'rw | rq E6e G6e B6h | rw | rq F#6e A6e B6h |'
TURN = 'rq E5e G5e B5h~ | B5w~ | B5w~ | B5h. rq |'

# B is the ninth of A minor, the sharp eleventh of F, the sixth of D minor,
# the fifth of the open E; then the seventh of C, and again
CH_A = chart('Amadd9 F Dm6 E5 Cmaj7 Amadd9 F E5')
CH_B = chart('Amadd9:2 F:2 Dm6:2 E5:2 Amadd9:2 F:2 Dm6:2 E5:2 '
             'Cmaj7:2 Amadd9:2 F:2 E5:2 Cmaj7:2 Amadd9:2 F:2 E5:2')
CH_TURN = chart('Amadd9 F Dm6 E5')
CH_INTRO = chart('E5:4 E5:4 Amadd9:4 E5:4')

# hand voicings per chord (see `voiced`): high divisi, violas, low strings /
# trombones, muted horns; the B-strain violas leave the C out of F entirely
HI = {'Amadd9': 'E5 A5', 'F': 'F5 A5', 'Dm6': 'F5 A5', 'E5': 'E4 B4', 'Cmaj7': 'E5 G5'}
VA = {'Amadd9': 'A3 E4', 'F': 'A3 C4', 'Dm6': 'F3 D4', 'E5': 'E3 B3', 'Cmaj7': 'G3 E4'}
VA_B = {'Amadd9': 'A3 E4', 'F': 'F3 A3', 'Dm6': 'F3 D4', 'E5': 'E3 B3', 'Cmaj7': 'G3 E4'}
LOW = {'Amadd9': 'A2 E3', 'F': 'F2 C3', 'Dm6': 'D3 A3', 'E5': 'E2 B2', 'Cmaj7': 'C3 G3'}
HN = {'Amadd9': 'A3 E4', 'F': 'F3 A3', 'Dm6': 'A3 D4', 'E5': 'E3 B3', 'Cmaj7': 'G3 E4'}


def voiced(part, bar, ch, table, vel):
    """Sustained chords from a chart with fixed voicings per chord symbol."""
    t = part.score.bar(bar)
    for c, beats in ch:
        for p in table[c.symbol].split():
            part.note(t, p, beats, vel=vel, rearticulate=True)
        t += beats


# Who holds the B is decided by what it means in the chord under it, so the
# note changes colour exactly when it changes meaning: the ninth of A minor
# is the violins' (the line reaches it there), the raised eleventh of F a
# muted brass glow (trumpet at B5, horn at B4), the sixth of D minor the
# clarinet, the bare fifth of E the violas, and the major seventh of C a
# celesta re-strike, glass ringing over the previous holder's release.
HOLDER = {'Amadd9': 'vn', 'F': 'brass', 'Dm6': 'cl', 'E5': 'va', 'Cmaj7': 'cel'}
# mix trims (dB, per strain, relative within each holder), measured against the
# level the violins alone gave the held B before it was passed on
HELD_TRIM = {
    'tpt': {'A': -1.3, 'A2': -0.8, 'A3': -0.5, 'turn': -3.6},
    'hn': {'B': 0.3, 'A3': -0.5},
    'cl': {'A': 2.1, 'A2': 3.7, 'B': 1.8, 'A3': 1.6, 'turn': 3.2},
    'va': {'intro': 2.1, 'A': 2.3, 'A2': 2.5, 'B': 4.0, 'A3': -3.0, 'turn': -0.2},
}
C_HELD_GAIN = {'cl': 0.0, 'fl': 0.0, 'ob': -1.5, 'sv': 0.0}   # calm holders (dB)


def relay(s, bar, ch, text, holders, transpose=0, overlap=0.5):
    """Play the tune `text` at `bar` over chart `ch`. Every note goes to
    holders['vn'] except a held B (two beats or more), which is cut at each
    chord change and handed on (see HOLDER). The first piece stays with the
    line that reached it; each holder lets go `overlap` beats after the
    change, so the note is passed, never dropped. holders['brass'] maps a
    pitch to its part; a holder that is None skips its pieces."""
    from engine.score import Part

    vn = holders['vn']
    tmp = Part(score=s, name='_relay', inst=vn.inst)
    tmp.at(bar).play(text, transpose=transpose)
    edges, t = [], s.bar(bar)
    for c, beats in ch:
        edges.append((t, t + beats, c.symbol))
        t += beats
    for n in tmp.notes:
        if n.pitch % 12 != 11 or n.dur < 2:
            vn.notes.append(n)
            continue
        pieces = [(max(a, n.start), min(b, n.end), sym) for a, b, sym in edges
                  if a < n.end - 1e-9 and b > n.start + 1e-9]
        prev = None
        for i, (a, b, sym) in enumerate(pieces):
            who = 'vn' if i == 0 else HOLDER[sym]
            end = b + (overlap if i < len(pieces) - 1 else 0.0)
            if HOLDER[sym] == 'cel' and holders.get('cel') is not None:
                # the glass strikes the B (and its octave) where it means a seventh,
                # also on a landing the violins keep holding
                for p in (n.pitch, n.pitch + 12):
                    holders['cel'].note(a, p, 2.0, vel=min(0.75, n.vel + 0.1))
            if who == 'cel':
                prev = None
                continue
            part = holders[who]
            if isinstance(part, dict):
                part = part.get(n.pitch)
            if part is None:
                prev = None
                continue
            if who == 'vn' and prev is not None and prev[0] is part:
                prev[1].dur = end - prev[1].start       # the violins keep holding
                continue
            vel = n.vel
            if part.opts.get('vel_range'):
                # the tune's pp..f mapped inside one of the holder's sample layers,
                # so a held note never lands in a crossfade between two recordings
                lo, hi = part.opts['vel_range']
                vel = lo + (hi - lo) * min(1.0, max(0.0, (n.vel - 0.26) / 0.5))
            note = part.note(a, n.pitch, end - a, vel=vel,
                             art=n.art if part is vn else None, rearticulate=True)
            prev = (part, note)


# the kick breathes on one and three; the pizzicato keeps the quarters
PULSE = {'kick': 'x.......x.......', 'rim': '....x.......x...', 'hat': 'x.x.x.x.x.x.x.x.'}
PULSE_FILL = {'kick': 'x.......x.......', 'rim': '....x.......x.x.', 'hat': 'x.x.x.x.x.x.x...',
              'tom_hi': '..............x.'}
DRIVE = {'kick': 'x.......x.......', 'rim': '....x.......x...', 'hat': 'xxxxxxxxxxxxxxxx'}
DRIVE_FILL = {'kick': 'x.......x.......', 'rim': '....x.......xxxx', 'hat': 'xxxxxxxxxxxx....'}
HEAVY = {'kick': 'x.......x.......', 'snare': '....x.......x...', 'ride': 'x.x.x.x.x.x.x.x.'}
HEAVY_FILL = {'kick': 'x.......x.......', 'snare': '....x.....xxxxXX', 'ride': 'x.x.x.x.x.......'}


def build():
    s = Score('battle_tundra', tonic='E', bpm=112, intro_bars=4, loop_bars=36, title='Rime',
              seed=151)
    s.reverb = dict(rt60=3.4, predelay_ms=36, wet_db=1.0, damp=0.35, bright=1.15)
    s.master = dict(lufs=-14.0, glue_ratio=1.4)
    b = Battle(s, calm_lufs=-17.0, full_lufs=-14.0)
    b.section('intro', 1, CH_INTRO).section('A', 5, CH_A).section('A2', 13, CH_A)
    b.section('B', 21, CH_B).section('A3', 29, CH_A).section('turn', 37, CH_TURN)

    # ---------------------------------------------------------------- the pulse (both mixes)
    pz = b.part('pulse', 'basses', role='low', art='pizz', calm_db=-2)
    for sec in ('intro', 'A', 'A2', 'B', 'A3', 'turn'):
        bass(pz, b.bar(sec), b.chart(sec), 'q q q q', 'r r r r', floor=28, vel=0.6, art='pizz')
    for sec in ('A', 'A2', 'B', 'A3', 'turn'):
        b.sub(sec, vel=0.5)
    b.full_only.discard('sub')
    b.calm_gain['sub'] = -4

    # ---------------------------------------------------------------- the tune
    # (a held note at full lead level pierces: the line and every holder of
    # its B sit under it with their presence band shelved, and in the B
    # strain the B drops an octave). The violins keep the reach and the
    # descent; the held B is passed on at each chord change (see `relay`,
    # below, once the celesta exists). Without the long B the violins' part
    # is levelled on its louder notes, hence 8 dB down, not 5: the reach and
    # the descent sit where they did.
    held_eq = [('peak', 3200, 0.9, -3.5), ('highshelf', 7000, 0.7, -2.0)]
    vn = b.part('mel_vn', 'violins', role='lead', art='soft', gain=-8, eq=held_eq)
    vn.expr((3, 0.3), (4.9, 0.7), (5, 0.7), (12.9, 0.85), (13, 0.85), (20.9, 0.95),
            (21, 0.5), (24, 0.65), (28.9, 0.85), (29, 1.0), (36.9, 1.0), (37, 0.8), (38.9, 0.8),
            (39, 0.6), (40.9, 0.45))
    b.full_only.add('mel_vn')
    # (each holder plays inside its softest sample layer, so no held note lands
    # in a crossfade between two recordings; its gain and trims below bring it
    # to the level the violins' held B had at the same place)
    held = dict(role='lead', layer='full', eq=held_eq, vel_jitter=0.02)
    held_tpt = b.part('held_tpt', 'trumpets', art='mute', gain=-6, vel_range=(0.22, 0.32),
                      **held)
    held_hn = b.part('held_hn', 'horns', art='mute', gain=-5, vel_range=(0.08, 0.16), **held)
    held_cl = b.part('held_cl', 'clarinet', gain=-3, vel_range=(0.08, 0.16), **held)
    held_va = b.part('held_va', 'violas', art='soft', gain=-5, **held)
    # each holder follows the violins' expression, trimmed strain by strain
    # (dB) so the B stays at the level the violins held it at, whoever has it
    heads = [(s.bar(b.bar(sec)), sec) for sec in ('intro', 'A', 'A2', 'B', 'A3', 'turn')]
    for p, trim in ((held_tpt, HELD_TRIM['tpt']), (held_hn, HELD_TRIM['hn']),
                    (held_cl, HELD_TRIM['cl']), (held_va, HELD_TRIM['va'])):
        p.expr_points = [(t, v * 10 ** (trim.get([sec for h, sec in heads if h <= t][-1], 0.0)
                                        / 26)) for t, v in vn.expr_points]
    vn8 = b.part('mel_vn8', 'violins2', role='lead2', layer='full', art='soft', gain=-2)
    vn8.at(21).play('@mp' + REACH_LO, transpose=24)
    vc_reach = b.part('reach_vc', 'celli', role='counter', art='sus', calm_db=-3)
    vc_reach.at(21).play('@mf' + REACH_LO)
    vc_reach.at(25).play('@mf' + REACH_LO)

    # the glass: celesta in eighths, harp in its high register, glock on the reach
    cel = b.part('celesta', 'celesta', role='keys', calm_db=-3)
    for sec in ('A', 'A2', 'A3', 'turn'):
        arp(cel, b.bar(sec), b.chart(sec), '0 4 2 4 1 4 2 4', step=0.5, lo=72, hi=96, vel=0.5,
            accent_every=2, accent=0.08)
    arp(cel, b.bar('B'), b.chart('B'), '0 2 4 2 1 2 4 2', step=0.25, lo=72, hi=96, vel=0.48,
        accent_every=1, accent=0.08)
    cel.at(1).play('@mp rh B6h | rh B6h | rh B6h | rh B6h |')
    hp = b.part('harp', 'harp', role='keys', calm_db=1)
    for sec in ('intro', 'A', 'A2', 'A3', 'turn'):
        arp(hp, b.bar(sec), b.chart(sec), '0 1 2 3 4 3 2 1', step=0.5, lo=79, hi=100, vel=0.42)
    glock = b.part('glock', 'glock', role='accent', calm_db=-4)
    glock.at(13).play('@mp rq E6e G6e B6q rq | rw | rw | rq rq A6e G6e rq | rq F#6e A6e B6q rq |'
                      ' rw | rw | rh A6q F#6q |')
    glock.at(21).play('@mp' + REACH_HI).play(REACH_HI)
    glock.at(29).play('@mf rq E6e G6e B6q rq | rw | rw | rq rq A6e G6e rq | rq F#6e A6e B6q rq |'
                      ' rw | rw | rh A6q F#6q |')
    glock.at(37).play('@mp rq E6e G6e B6q rq | rw | rw | rw |')

    # the held B, passed from colour to colour (A3 doubles it an octave down,
    # where the muted horn takes the raised eleventh)
    hi_holders = {'vn': vn, 'brass': {83: held_tpt, 71: held_hn}, 'cl': held_cl, 'va': held_va,
                  'cel': cel}
    lo_holders = {'vn': vn8, 'brass': {71: held_hn}, 'cl': held_cl, 'va': held_va, 'cel': None}
    relay(s, 1, CH_INTRO, '@pp rw | rw | B5w~ | B5w |', hi_holders)
    relay(s, 5, CH_A, '@mp' + MEL, hi_holders)
    relay(s, 13, CH_A, '@mf' + MEL, hi_holders)
    relay(s, 21, CH_B, '@mp' + HELD, hi_holders, transpose=-12)
    relay(s, 29, CH_A, '%sus @f' + MEL, hi_holders)
    relay(s, 29, CH_A, '%sus @f' + MEL, lo_holders, transpose=-12)
    relay(s, 37, CH_TURN, '@mf' + TURN, hi_holders)

    # ---------------------------------------------------------------- the cold: strings, brass
    # Pads are voiced by hand so the held B always meets its C (the minor
    # third of A minor, the root of C) as a major seventh, never as an
    # adjacent semitone; the high pad never carries a C at all.
    hi = b.part('hi_pad', 'violins2', role='pad', art='soft', calm_db=-2)
    for sec in ('A', 'A2', 'A3', 'turn'):
        voiced(hi, b.bar(sec), b.chart(sec), HI, vel=0.4 if sec == 'A' else 0.46)
    voiced(hi, b.bar('B'), b.chart('B'), HI, vel=0.42)
    # the turn: two bars at weight, then everything but the pulse, the glass
    # and the high pad dissolves, so the loop comes round to the reach alone
    trem = b.part('trem_va', 'violas', role='pad', art='trem', calm_db=-6)
    for sec in ('A2', 'A3'):
        voiced(trem, b.bar(sec), b.chart(sec), VA, vel=0.5 if sec == 'A2' else 0.56)
    voiced(trem, b.bar('turn'), b.chart('turn')[:2], VA, vel=0.56)
    b_va = b.part('b_va', 'violas', role='pad', art='sus', layer='full')
    voiced(b_va, b.bar('B'), b.chart('B'), VA_B, vel=0.5)
    vc_pad = b.part('vc_pad', 'celli', role='pad', art='sus', layer='full')
    voiced(vc_pad, b.bar('A2'), b.chart('A2'), LOW, vel=0.46)
    vc_trem = b.part('vc_trem', 'celli', role='pad', art='trem', layer='full')
    voiced(vc_trem, b.bar('A3'), b.chart('A3'), LOW, vel=0.5)
    b.spic8('A3', 'violins2', degrees='0 1 2 1 0 1 2 1', lo=62, hi=79, vel=0.5, accents=None,
            name='ost_vn2', layer='full')
    hn = b.part('hn_mute', 'horns', layer='full', role='pad', art='mute')
    voiced(hn, b.bar('B'), b.chart('B'), HN, vel=0.5)
    tbn = b.part('bpad_tbn', 'trombones', layer='full', role='pad')
    voiced(tbn, b.bar('A3'), b.chart('A3'), LOW, vel=0.5)
    voiced(tbn, b.bar('turn'), b.chart('turn')[:2], LOW, vel=0.55)

    # ---------------------------------------------------------------- drums
    # (no bass guitar: the pizzicato basses and the sub are the pulse)
    b.groove('intro', {'kick': 'x.......x.......'}, crash=False, vel=0.55)
    b.groove('A', PULSE, PULSE_FILL, every=8, vel=0.6, crash=False)
    b.groove('A2', PULSE, PULSE_FILL, every=4, vel=0.66, crash=False)
    b.groove('B', DRIVE, DRIVE_FILL, every=4, vel=0.68, crash=False)
    b.groove('A3', HEAVY, HEAVY_FILL, every=4, vel=0.72)
    b.groove('turn', HEAVY, None, crash=False, vel=0.7, n_bars=2)
    b.kit.play(39, {'kick': 'x.......x.......', 'ride': 'x.x.x.x.x.x.x.x.'}, vel=0.55)
    b.kit.play(40, {'kick': 'x.......x.......'}, vel=0.5)
    tk = b.part('taiko', 'taiko', role='low', gain=-5, calm_db=-6)
    for bar in range(1, 41):
        tk.at(bar).play('@p E2q rq E2q rq |')
    b.timp('A2', 'rw | rw | rw | %roll @p E2w | rw | rw | rw | %roll @mp E2w |')
    b.timp('A3', '%default @f E2q rq rh | rw | rw | %roll @mp E2w | %default @f E2q rq rh | rw | rw |'
                 ' %roll @mf E2w |')
    b.timp('turn', '%roll @mp A2w | F2w | @p D2w | E2w |')
    s.parts['timp'].expr((37, 1.0), (38.9, 1.0), (39, 0.7), (40.9, 0.25))
    b.hit(29, pieces=('sus',), vel=0.6)
    b.riser(35, beats=8, vel=0.5)

    # ---------------------------------------------------------------- calm voices
    b.lead('A', MEL_BR, inst='flute', dyn='mp', layer='calm')
    b.lead('A2', MEL_BR, inst='oboe', dyn='mf', layer='calm')
    b.lead('A3', MEL, inst='solo_violin', dyn='mf', layer='calm')
    # B and the turn: the calm voices pass the held B between them by the same
    # rule (in B the clarinet, the low flute, the oboe, the solo violin; in the
    # turn the flute, the oboe, the clarinet, the solo violin; the celesta's
    # strikes are shared with the full mix). Each holder is its own part, in
    # one sample layer, trimmed to the level the calm clarinet (B) and flute
    # (turn) held the B at.
    c_held = dict(role='lead', layer='calm', vel_jitter=0.02)
    c_cl = b.part('c_held_cl', 'clarinet', gain=C_HELD_GAIN['cl'], vel_range=(0.08, 0.16),
                  **c_held)
    c_fl = b.part('c_held_fl', 'flute', gain=C_HELD_GAIN['fl'], vel_range=(0.22, 0.32),
                  **c_held)
    c_ob = b.part('c_held_ob', 'oboe', gain=C_HELD_GAIN['ob'], vel_range=(0.22, 0.32),
                  **c_held)
    c_sv = b.part('c_held_sv', 'solo_violin', art='soft', gain=C_HELD_GAIN['sv'], **c_held)
    relay(s, 21, CH_B, '@mp' + HELD, {'vn': c_cl, 'brass': {71: c_fl}, 'cl': c_ob, 'va': c_sv,
                                      'cel': None}, transpose=-12)
    relay(s, 37, CH_TURN, '@mp' + TURN, {'vn': s.parts['lead_flute'], 'brass': {83: c_ob},
                                         'cl': c_cl, 'va': c_sv, 'cel': None})
    for sec in ('A', 'A2', 'B', 'A3', 'turn'):
        lp = b.part('c_low', 'celli', layer='calm', role='bass', art='soft')
        bass(lp, b.bar(sec), b.chart(sec), 'h h', 'r 5', floor=38, vel=0.46, art='soft')
    ck = Kit(s, 'ckit', gains={'kick': -4})
    b.calm_only.update(ck.names())
    for bar in range(1, 41):
        ck.play(bar, {'kick': 'x.......x.......'}, vel=0.4)
    return b.finish()
