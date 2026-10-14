"""Iron Wall — "The Order That Never Came".

The Act III boss, the Holder of the Breach. He held the breach at the old
capital until the order to fall back rotted unread in a courier's bag, and
the Empire made his stand its doctrine. "None have breached these walls.
None ever will." 104 bpm, 4/4, D-flat, a half-time weight that still moves.

Mechanism: THE PEDAL THAT WILL NOT MOVE. One low D-flat holds under the whole
loop (contrabasses, celli, the organ's pedal, the sub; the tuba in the last
strain), re-bowed but never left: every harmony above it has to be built on
it, and the strains ask more of it each time. A is diatonic and stands on it
easily (D-flat, G-flat, E-flat minor, B-flat minor, the minor iv, A-flat). B
borrows from the minor and darkens it (D-flat minor, then the chromatic
mediants A, F-flat and C-flat, G-flat minor). C climbs the **whole-tone
ladder** of major triads, D-flat E-flat F G A B, the tune's head stamped one
step higher each bar while the floor stays: F and G grind a minor ninth
against the pedal (C and D natural over D-flat), A eases (it holds the
D-flat), B is the last rung, and the next whole tone would be D-flat itself.
The horn tune is grim and noble, all fourths, fifths, octaves and one falling
tritone (E-flat to B-double-flat over G-flat minor); its head, 5-1-5 in a
dotted rhythm, is the wall's motto.

The order: at the end of every strain a distant trumpet (far right, all hall)
sounds the order to fall back, a falling bugle call on A-flat major, E-flat
down to A-flat: the key a fifth below, the bass told to move. Each time the
wall comes down on it (a downbeat of low brass, organ, timpani, gong and a
bell, all on D-flat) and the note it was about to sound is swallowed under
the hit. It is cut sooner every strain: five notes heard, then four, then
three, then two; its last notes, the low C and A-flat that would take the
bass down, are never heard at all.

Form (bars): intro 1-4 (the card: [D-flat A-flat] in the trombones, the
lower neighbour C leans and fails over the pedal; the horns' motto; the first
wall) | A 5-12 (the wall: the horn tune, half-time kit, organ; the call at
11, the wall at 12) | B 13-20 (the pressure: the minor and its mediants,
violins with the horns below them, a backbeat, sixteenths; call at 19, wall
at 20) | C 21-28 (the ladder: trumpets, violins and horns stamp the motto on
each rung, choir, four on the floor; call at 27, wall at 28) | D 29-32 (the
wall alone: the pedal, a timpani heartbeat, one horn sings the motto in the
minor over low voices; a roll into) | A2 33-40 (the tune with everyone,
trombones below it, violins above it, choir; the call barely begun at 39,
the wall at 40, into A). Loop 5-40, 36 bars.

Enrage ("then I am the wall"): the pedal itself is struck. Trombones,
contrabasses, timpani and the bass guitar hammer the D-flat in eighths
through the whole loop (the tuba on the beats), hardest on one and three,
the last pair of every second bar driven in, through the quiet strain and
under every call; the harmonies above go on straining and the note still
never moves.
"""

from engine.patterns import Kit, arp, bass, chart, drums, ostinato, pad
from engine.score import Score

from scores._battle import Battle

KEY = 'music_boss_iron_wall'

# ------------------------------------------------------------------ material
# A: the horn tune (bars 5-11; bar 12 is the wall). The head, 5-1-5 dotted,
# is the motto; the tune falls a tritone in bar 10 and rests on the fifth.
TUNE_A = """
Ab3q. Db4e Ab4h | Gb4q. F4e Db4h | Eb4q. Bb4e Eb5h | Db5h. C5q |
Bb4q. F4e Bb4q Db5q | Eb5h Bbb4h |
"""
# B: the pressure (bars 13-18): a line that falls and leaps through the
# minor's mediants and reaches D-flat (C-sharp) at the top
TUNE_B = """
Fb5q. Eb5e Db5q Ab4q | A4q. E5e A5h | G#5q. F#5e E5q B4q | D#5h. F#5q |
F#5q. A5e C#6h | C#6q. B5e A5q E5q |
"""
# C: the ladder (bars 21-26): the motto 1-5-1 on each rung of D-flat E-flat F G A B
LADDER_LOW = ('Db4', 'Eb4', 'F4', 'G4', 'A4', 'B4')
LADDER_FIFTH = ('Ab4', 'Bb4', 'C5', 'D5', 'E5', 'F#5')
# D: one horn, the motto in the minor
TUNE_D = 'Ab3q. Db4e Ab4h | A3q. E4e A4h | Fb4h. Db4q | Eb4w |'

CH_INTRO = chart('Db Db Db Db')
# (in A the order's chord is a bare fifth: the C of A-flat, a minor ninth over
# the pedal, is first held from B on)
CH_A = chart('Db Gb Ebm7 Db Bbm Ebm:2 Gbm:2 Ab5 Db')
CH_A2 = chart('Db Gb Ebm7 Db Bbm Ebm:2 Gbm:2 Ab Db')
CH_B = chart('Dbm A Fb Cb Gbm A Ab Db')
CH_C = chart('Db Eb F G A B Ab Db')
CH_D = chart('Dbm A Dbm Ab')

INTRO, A1, B1, C1, D1, A2 = 1, 5, 13, 21, 29, 33
END = 41                                          # first bar after the loop
WALLS = (4, 12, 20, 28, 40)                       # the wall comes down on beat 1
# the order to fall back, (onset, pitch, beats): E-flat down to A-flat
CALL = ((0.0, 'Eb5', 0.75), (0.75, 'Eb5', 0.25), (1.0, 'Eb5', 1.0), (2.0, 'C5', 1.0),
        (3.0, 'Ab4', 1.0), (4.0, 'Eb4', 1.5), (5.5, 'C4', 0.5), (6.0, 'Ab3', 2.0))
# (wall bar, notes heard before it lands)
CALLS = ((12, 5), (20, 4), (28, 3), (40, 2))

# drum grids, 16 steps a bar
HALF = {'kick': 'x.....x...x.....', 'snare': '........X.......', 'ride': 'x...x...x...x...'}
HALF2 = {'kick': 'x.....x...x...x.', 'snare': '........X.......', 'ride': 'X...x...X...x...',
         'tom_floor': '..............x.'}
BACK = {'kick': 'x.......xx......', 'snare': '....X.......X...', 'hat': 'x.x.x.x.x.x.x.x.'}
BACK_FILL = {'kick': 'x.......xx......', 'snare': '....X.......XxXX', 'hat': 'x.x.x.x.x.x.....'}
PUSH = {'kick': 'x...x...x...x...', 'snare': '....X.......X...', 'ride': 'x...x...x...x...'}
PUSH_FILL = {'kick': 'x...x...x...x...', 'snare': '....X.......X.xx', 'ride': 'x...x...x.......',
             'tom_mid': '..............x.'}
# the wall's bar: the hit, its ring, a fill down the toms into the next strain
CALL_BAR = {'kick': 'x...............', 'hat_pedal': '..x...x...x...x.'}
WALL_BAR = {'kick': 'x...............', 'crash': 'X...............',
            'tom_hi': '............x...', 'tom_mid': '.............x..',
            'tom_floor': '..............xx'}


def _up(p):
    """The same pitch an octave up ('Db4' -> 'Db5')."""
    return p[:-1] + str(int(p[-1]) + 1)


def _steps(part, points):
    """Terraced expression: each (bar, value) holds until the next (circular over the loop)."""
    pts = list(points)
    for i, (bar, val) in enumerate(pts):
        nxt = pts[i + 1][0] if i + 1 < len(pts) else END
        part.expr((bar, val), (nxt - 0.02, val))


def call(part, hit_bar, heard, s):
    """The order: `heard` notes, then the one the wall swallows (under the hit)."""
    hit = s.bar(hit_bar)
    start = hit - CALL[heard][0]
    for onset, p, dur in CALL[:heard]:
        part.note(start + onset, p, dur, vel=0.6 if onset else 0.66, rearticulate=True)
    onset, p, _ = CALL[heard]
    part.note(start + onset, p, 0.35, vel=0.3, rearticulate=True)


def build():
    s = Score('boss_iron_wall', tonic='Db', bpm=104, intro_bars=4, loop_bars=36,
              title='The Order That Never Came', seed=619)
    # a fortress hall; the low mids crowd (organ, low brass, the pedal): carve them
    s.reverb = dict(rt60=3.0, predelay_ms=34, wet_db=-0.5, damp=0.5)
    s.master = dict(lufs=-13.5, glue_ratio=1.6, eq=[('peak', 260, 0.8, -2.5),
                                                    ('peak', 3000, 1.0, 2.0),
                                                    ('highshelf', 8000, 0.7, 1.5)])
    b = Battle(s, full_lufs=-13.5, adaptive=False)
    b.section('intro', INTRO, CH_INTRO).section('A1', A1, CH_A).section('B1', B1, CH_B)
    b.section('C1', C1, CH_C).section('D1', D1, CH_D).section('A2', A2, CH_A2)
    loop_secs = ('A1', 'B1', 'C1', 'D1', 'A2')

    # ================================================================ the pedal
    # one D-flat, under everything, re-bowed each bar and never left
    cb = b.part('ped_cb', 'basses', role='low', art='sus', gain=1)
    vc = b.part('ped_vc', 'celli', role='low', art='sus', gain=-4)
    org_ped = b.part('ped_org', 'organ', role='low', gain=-5, hpf=30)
    sub = b.part('ped_sub', 'sub', role='sub', gain=-3)
    loud = set(range(C1, D1)) | set(range(A2, END))
    for bar in range(INTRO, END):
        t = s.bar(bar)
        quiet = D1 <= bar < A2 or bar < 3
        v = 0.5 if quiet else (0.74 if bar in loud else 0.64)
        cb.note(t, 'Db1', 4.0, vel=v, art='sus', rearticulate=True)
        vc.note(t, 'Db2', 4.0, vel=v - 0.04, art='sus', rearticulate=True)
        if bar in loud:
            vc.note(t, 'Db3', 4.0, vel=v - 0.08, art='sus', rearticulate=True)
        org_ped.note(t, 'Db2', 4.0, vel=0.6, art='loud' if bar in loud else 'default',
                     rearticulate=True)
        if not quiet:
            sub.note(t, 'Db1', 4.0, vel=0.6)
    cb.expr((INTRO, 0.35), (INTRO + 1.9, 1.0), (A1, 1.0))
    vc.expr((INTRO, 0.35), (INTRO + 1.9, 1.0), (A1, 1.0))
    tuba = b.part('ped_tuba', 'tuba', role='low', gain=-1)
    for bar in range(A2, END):
        if bar not in WALLS:
            tuba.note(s.bar(bar), 'Db2', 4.0, vel=0.66, rearticulate=True)

    # ================================================================ the intro: the card
    tbn_i = b.part('card_tbn', 'trombones', role='section', gain=1)
    tbn_i.at(INTRO).play('@f [Db3 Ab3]w | [C3 Ab3]h [Db3 Ab3]h |')
    tbn_i.expr((INTRO, 0.6), (INTRO + 0.9, 1.0))
    hn_card = b.part('card_hn', 'horns', role='section')
    hn_card.at(INTRO).play('@mf Ab3w | Ab3w |')

    # ================================================================ the tune
    hn = b.part('lead_hn', 'horns', role='lead', gain=2, depth=0.4,
                eq=[('peak', 320, 1.0, -2.0), ('peak', 1600, 1.0, 3.0)])
    hn.at(3).play('@f Ab3q. Db4e Ab4h | Ab4h rh |')                      # the motto
    hn.at(A1).play('@f ' + TUNE_A + ' Ab4q rq rh |')
    hn.at(B1).play('@f ' + TUNE_B, transpose=-12)                        # under the violins
    hn.at(D1).play('@mf ' + TUNE_D)
    vcs = b.part('d_vc', 'celli', role='lead2', art='sus', gain=-1)
    vcs.at(D1).play('%sus @mf ' + TUNE_D)            # the celli sing it with the horn
    hn.at(A2).play('@ff ' + TUNE_A + ' Ab4h rh |')
    # C: the motto on each rung, horns an octave under the trumpets
    for k, (lo, fi) in enumerate(zip(LADDER_LOW, LADDER_FIFTH)):
        hn.at(C1 + k).play(f'@ff {lo}q. {fi}e {_up(lo)}h', transpose=-12)
    hn.at(C1 + 6).play('@ff Ab3q rq rh |')

    tpt = b.part('lead_tpt', 'trumpets', role='lead', gain=-1)
    for k, (lo, fi) in enumerate(zip(LADDER_LOW, LADDER_FIFTH)):
        tpt.at(C1 + k).play(f'@f {lo}q. {fi}e {_up(lo)}h')
    tpt.at(C1 + 6).play('@ff Ab4q rq rh |')
    tpt.at(A2).play('@f ' + TUNE_A + ' Ab4h rh |')

    vn = b.part('lead_vn', 'violins', role='lead', art='sus', gain=1)
    vn.at(B1).play('%sus @f ' + TUNE_B)
    for k, (lo, fi) in enumerate(zip(LADDER_LOW, LADDER_FIFTH)):
        vn.at(C1 + k).play(f'%sus @ff {lo}q. {fi}e {_up(lo)}h', transpose=12)
    vn.at(C1 + 6).play('%sus @ff Ab5q rq rh |')
    vn.at(A2).play('%sus @ff ' + TUNE_A + ' Ab4h rh |', transpose=12)
    _steps(vn, ((B1, 1.0), (C1, 0.8), (A2, 1.0)))          # (the ladder's top is high)

    tbn_t = b.part('tune_tbn', 'trombones', role='lead2', gain=-2)
    tbn_t.at(A2).play('@ff ' + TUNE_A + ' Ab4h rh |', transpose=-12)

    # ================================================================ the order
    # off stage: far right, nearly all hall, its top and bottom rolled away
    order = b.part('order', 'trumpets', role='counter', pan=0.6, depth=1.0, reverb=1.4,
                   gain=0, hpf=260, eq=[('highshelf', 3500, 0.7, -9.0),
                                        ('lowpass', 6500, 0.7, 0), ('peak', 1100, 1.0, 2.0)])
    for hit_bar, heard in CALLS:
        call(order, hit_bar, heard, s)

    # ================================================================ the wall
    w_tbn = b.part('wall_tbn', 'trombones', role='section', gain=3)
    w_tuba = b.part('wall_tuba', 'tuba', role='low', gain=2)
    w_hn = b.part('wall_hn', 'horns', role='section', gain=1)
    w_tpt = b.part('wall_tpt', 'trumpets', role='section', gain=-1)
    w_timp = b.part('wall_timp', 'timpani', role='timp', gain=2)
    w_bell = b.part('wall_bell', 'bells', role='accent', gain=1)
    w_perc = b.part('wall_perc', 'orch_perc', role='accent', gain=3)
    for bar in WALLS:
        dyn = '@f' if bar == 4 else '@ff'
        w_tbn.at(bar).play(dyn + ' [Db3 F3 Ab3]h.> rq |')
        w_tuba.at(bar).play(dyn + ' Db2h.> rq |')
        w_hn.at(bar).play(dyn + ' [Ab3 Db4 F4]h.> rq |')
        if bar != 4:
            w_tpt.at(bar).play(dyn + ' [Ab4 Db5]q> rq rh |')
        w_timp.at(bar).play(dyn + ' Db2q> rq rq Db2e Db2e |')
        w_bell.at(bar).play('@f [Db4 Db5]w |')
        drums(w_perc, bar, {'bd': 'X', 'gong': 'x', 'crash': 'x'}, step=4.0, vel=0.82)

    # ================================================================ harmony over the floor
    # the organ's manuals voice each chord over the pedal (quiet stops, then full)
    org = b.part('organ', 'organ', role='pad', gain=-3, hpf=120, eq=[('peak', 250, 1.0, -3.0)])
    pad(org, 3, chart('Db Db'), n=4, lo=53, hi=72, vel=0.5)
    for sec in loop_secs:
        pad(org, b.bar(sec), b.chart(sec), n=4, lo=53, hi=72, vel=0.5,
            art='loud' if sec in ('C1', 'A2') else None)
    org.expr((3, 0.7))
    _steps(org, ((A1, 0.85), (B1, 0.9), (C1, 1.0), (D1, 0.6), (A2, 1.0)))

    # low brass voice B's chords, and the roots under A2's tune, above the pedal
    tbn = b.part('tbn', 'trombones', role='section', gain=-2, eq=[('peak', 300, 1.0, -2.5)])
    pad(tbn, B1, CH_B[:6], n=3, lo=48, hi=62, vel=0.52)
    bass(tbn, A2, CH_A2[:7], 'w', 'r', floor=44, vel=0.6)   # roots, under the tune

    # strings: an eighth-note motor above the floor, sixteenths when it pushes
    va = b.part('va8', 'violas', role='ostinato', art='spic', gain=0)
    vn2 = b.part('vn2_16', 'violins2', role='ostinato', art='spic', gain=-1)
    trem = b.part('trem', 'violins2', role='pad', art='trem', gain=-3)
    for sec in ('A1', 'B1', 'C1', 'A2'):
        bar, ch = b.sections[sec]
        body = ch[:-2]                    # the call's bar holds its breath; the wall rings
        ostinato(va, bar, body, 'e e e e e e e e', '0 2 1 2 0 2 1 2', lo=53, hi=70,
                 vel=0.56 if sec == 'A1' else 0.66, accents='> - - - > - - -')
    for sec in ('B1', 'C1', 'A2'):
        bar, ch = b.sections[sec]
        arp(vn2, bar, ch[:-2], '0 1 2 1', step=0.25, lo=62, hi=81,
            vel=0.62 if sec == 'A2' else 0.57, accent_every=1)
    pad(trem, A1, CH_A[:-2], n=2, lo=72, hi=86, vel=0.5, art='trem')
    pad(trem, D1, CH_D, n=2, lo=62, hi=76, vel=0.42, art='trem')
    trem.expr((A1, 0.8), (B1, 0.8), (D1, 0.55), (D1 + 3, 0.95), (D1 + 4, 0.8))
    # the wall's ring in the strings: tremolo D-flat octaves
    ring = b.part('ring', 'violas', role='pad', art='trem', gain=-2)
    for bar in WALLS:
        ring.at(bar).play('@f [Db4 Ab4 Db5]h. rq |')

    # the choir sings the ladder and the tune's harmony; low voices in the stillness
    ch = b.part('choir', 'choir', role='choir', gain=-1)
    pad(ch, C1, CH_C[:7], n=3, lo=62, hi=79, vel=0.66)
    pad(ch, A2, CH_A2[:7], n=3, lo=55, hi=74, vel=0.62)
    oohs = b.part('oohs', 'oohs', role='choir', gain=-5)
    pad(oohs, D1, CH_D, n=3, lo=48, hi=65, vel=0.55)

    # ================================================================ drums
    kit = Kit(s, 'kit', gains={'cym': -3})
    b.kit = kit
    b.full_only.update(kit.names())
    kit.play(3, HALF, vel=0.68)
    for bar in range(A1, A1 + 6):
        kit.play(bar, HALF, vel=0.72)
    for i, bar in enumerate(range(B1, B1 + 6)):
        kit.play(bar, BACK_FILL if i == 3 else BACK, vel=0.74)
    for i, bar in enumerate(range(C1, C1 + 6)):
        kit.play(bar, PUSH_FILL if i == 3 else PUSH, vel=0.76 + 0.01 * i)
    for bar in range(A2, A2 + 6):
        kit.play(bar, HALF2, vel=0.78)
    # the call's bar: the band holds its breath, only a pulse is left
    for bar, _ in CALLS:
        kit.play(bar - 1, CALL_BAR, vel=0.6)
    for bar in WALLS:
        kit.play(bar, WALL_BAR, vel=0.8)
    for bar in (A1, B1, C1, A2):
        kit.play(bar, {'crash': 'X'}, vel=0.78)

    timp = b.part('timp', 'timpani', role='timp')
    timp.at(INTRO + 1).play('%default @f Db2q rq Db2q rq |')
    timp.at(3).play('%default @f Db2q rq Db2q rq |')
    for bar in range(A1, A1 + 6):
        timp.at(bar).play('%default @f Db2q rq Db2q rq |')
    for bar, _ in CALLS:
        if bar != C1 + 7:
            timp.at(bar - 1).play('%default @mf Db2q rq rh |')
    for bar in range(B1, B1 + 6):
        timp.at(bar).play('%default @f Db2q rq rq Db2e Db2e |')
    for bar in range(C1, C1 + 6):
        timp.at(bar).play('%default @ff Db2q rq Db2q Db2q |')
    roll = b.part('timp_roll', 'timpani', role='timp', gain=-1)
    roll.at(INTRO).play('%roll @mf Db2w |')
    roll.at(C1 + 6).play('%roll @f rh Db2h |')
    for bar in range(D1, D1 + 3):
        timp.at(bar).play('%default @mp Db2q Db2e. rs rh |')          # the heartbeat
    roll.at(D1 + 3).play('%roll @mf Db2w |')
    for bar in range(A2, A2 + 6):
        timp.at(bar).play('%default @ff Db2q rq Db2q rq |')
    roll.expr((INTRO, 0.4), (INTRO + 0.95, 1.0),
              (C1 + 6.5, 0.2), (C1 + 6.97, 1.0), (D1 + 3, 0.35), (D1 + 3.97, 1.0))

    perc = b.part('perc', 'orch_perc', role='accent', gain=-2)
    for bar in range(D1, D1 + 3):
        drums(perc, bar, {'bd': 'x.......x.......'}, vel=0.6)
    drums(perc, D1 + 3, {'swell_m': 'x'}, vel=0.65)
    snr = b.part('snare_roll', 'orch_perc', role='accent', gain=-3)
    drums(snr, D1 + 3, {'sn': 'oooooooxxxxxXXXX'}, vel=0.6, ramp=0.5)

    # ================================================================ enrage: then I am the wall
    _enrage(b, s)
    return b.finish()


def _enrage(b, s):
    """The pedal is struck: the floor hammered in eighths, and still never moved."""
    v = 'enrage_iron_wall'
    tbn = b.extra(v, 'iw_tbn', 'trombones', role='section', art='stac', gain=-1,
                  eq=[('peak', 250, 1.0, -3.0)])
    tuba = b.extra(v, 'iw_tuba', 'tuba', role='low', art='stac')
    timp = b.extra(v, 'iw_timp', 'timpani', role='timp', gain=1)
    cbs = b.extra(v, 'iw_cb', 'basses', role='low', art='spic')
    ebs = b.extra(v, 'iw_ebass', 'rbass', role='bass', duck='kit_kick', gain=-4,
                  eq=[('peak', 220, 1.0, -3.0)])
    # struck like a hammer, not a sequencer: one and three hardest, the
    # off-beats light, and the last pair of every second bar driven in
    for bar in range(A1, END):
        t0 = s.bar(bar)
        for k in range(8):
            t = t0 + 0.5 * k
            if k in (0, 4):
                vv = 0.9
            elif k % 2 == 0:
                vv = 0.72
            else:
                vv = 0.5 + (0.2 if (bar - A1) % 2 == 1 and k == 7 else 0.0)
            tbn.note(t, 'Db3', 0.5, vel=vv, art='stac')
            cbs.note(t, 'Db1', 0.5, vel=vv - 0.04, art='spic')
            ebs.note(t, 'Db2', 0.5, vel=vv - 0.02)
            timp.note(t, 'Db2', 0.5, vel=vv if k % 2 == 0 else vv * 0.8)
            if k % 2 == 0:
                tuba.note(t, 'Db2', 0.5, vel=vv, art='stac')
