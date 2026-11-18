"""Dark Link: "No Reflection".

The room in the water temple with no walls: ankle-deep water to the horizon, one
dead tree, and a floor that shows you everything but yourself. 6/8, D.

Mechanism: A STRICT MIRROR. Every note the shadow plays is the hero's note turned
upside down around D (`kit.mirror`), and the piece is the mirror's delay closing:
a bar behind, half a bar behind, then no delay at all. There are no free notes in
the shadow's part anywhere; it is computed from the hero's.

The mirror has consequences, and the form is made of them:

  * Dorian is its own reflection (turned over around its tonic it lands on
    itself), so at first the reflection is consonant: the hero's chord, D minor
    with its sixth, comes back as G seventh, the same tritone with the fifth
    folded into a fourth. The two rock like water (the harp's wave runs up the
    one and down the other).
  * The brighter the hero plays, the darker the mirror answers. Mixolydian comes
    back Aeolian, major comes back Phrygian (D major's reflection is G minor),
    Lydian comes back Locrian. The hero climbs that ladder to win and the shadow
    descends it, by the same notes.
  * The mirror has exactly two fixed points, D and the tritone A-flat/G-sharp:
    the only two notes on which they can ever agree.

Form (6/8 bars; dotted quarter 60, then 80):
  intro 1-8    the room: the harp's wave runs up and comes back down, twice; then
               it runs up and nothing comes back.
  A 9-24       the Hero's Call and its tune on an ocarina, alone. Only the rising
               half of each wave: half the music is missing.
  B 25-40      the reflection: a second, darker ocarina, far off, a bar late and
               upside down. The falling waves return with it.
  C 41-52      half a bar late. The tune breaks into pieces; accelerando.
  D 53-68      blades. No delay: two lines in contrary motion from D, wedging
               open and shut (Mixolydian over Aeolian), every chord its own
               reflection (Dsus4, G7, D augmented). They lock on D; the lock
               bends to D augmented.
  E 69-84      the Call in D major, brass; four bars later the low brass and the
               men answer with its reflection in G minor. Then two bars apart.
  F 85-100     no delay again: the Call as a hymn, major above its own Phrygian
               mirror, one note a bar; then Lydian rising against Locrian
               falling through the whole-tone scale they make together, meeting
               on G-sharp/A-flat (the far fixed point), on through a French sixth
               (its own mirror too) to a bare unison D.
  G 101-104    still water. The loop returns to the ocarina, alone again.
Loop 9-104 (96 bars).
"""

from __future__ import annotations

import kit
from kit import cresc, mirror, swell

from engine.patterns import arp, chart, drums, pad   # noqa: E402
from engine.score import Score                         # noqa: E402

TITLE = 'No Reflection (Dark Link)'
OUTRO_BARS = 10
FADE_BARS = 5

INTRO, A, B, C, D, E, F1, F2, G, END = 1, 9, 25, 41, 53, 69, 85, 93, 101, 105

# ------------------------------------------------------------------ material
# The hero's tune (16 bars). Bars 1-3 are the Call. Each phrase leaves its fourth
# bar empty: the bar the reflection will fill.
THEME = """
D5q. A5q B5e | A5q F5e A5q. | D6h. | rh. |
C6q. A5q C6e | B5q G5e E5q. | A5h. | rh. |
D6q. F6q E6e | D6q B5e G5q. | F5q A5e D6q. | rh. |
E6q. C6q A5e | G5q E5e G5q. | A5q. B5q. | D6h. |
"""
# C: the tune in pieces (3 bars, 3 bars, 2, 2, 2)
HERO_C = """
D5q. A5q B5e | A5q F5e A5q. | D6h. |
D6q. F6q E6e | D6q B5e G5q. | F5q A5e D6q. |
D6q. F6q E6e | D6q B5e A5q. |
D6q. F6q E6e | D6q B5e A5q. |
D6q. F6q. | A6h. |
"""
# D: blades (Mixolydian; the mirror is Aeolian). Strikes, a wedge run, a held D.
HERO_D = """
D5e' D5e' F#5e A5q.> | B5q A5e F#5q. | E5e F#5e G5e A5e B5e C6e | D6h.^ |
D6e' D6e' B5e A5q.> | F#5q A5e B5q. | C6e B5e A5e G5e F#5e E5e | D5h.^ |
A5q.^ F#5e E5e D5e | A5q.^ B5e C6e D6e | F#5e B5e F#5e B5e F#5e B5e | A5q.^ A5q.^ |
D5h.~ | D5h. | F#5h.~ | F#5h. |
"""
# E: the Call in D major and where it goes (4 bars), then two 2-bar strains
HERO_E1 = 'D5q. A5q B5e | A5q F#5e A5q. | D6q. C#6q B5e | A5h. |'
HERO_E2 = 'F#5q A5e D6q. | E6q. C#6q A5e |'
HERO_E3 = 'B5q D6e F#6q. | E6q. D6q C#6e |'
# the harmony under E: each hero chord, then its mirror (D-Gm, Bm-Bb, G-Dm, A-Cm)
CH_E = chart('D:3 Bm:3 G:3/2 A:3/2 A:3  Gm:3 Bb:3 Dm:3/2 Cm:3/2 Cm:3 '
             'D:3 A:3  Gm:3 Cm:3  Bm:3 A:3  Bb:3 Cm:3')
# F1: the Call as a hymn, a note a bar (the last held two)
HYMN = 'D5h. | A5h. | B5h. | A5h. | F#5h. | A5h. | D6h.~ | D6h. |'
# F2: Lydian up (its mirror: Locrian down). The fourth step, G-sharp over A-flat,
# is the mirror's far fixed point and is held two bars.
WEDGE = 'E5h. | F#5h. | G#5h.~ | G#5h. | A5h. | B5h. | C#6h. | D6q. rq. |'

# the harp's wave: up the hero's chord; its mirror runs down the reflection's
UP = {
    'Dm': 'D2e A2e D3e F3e A3e B3e',
    'F': 'F2e C3e F3e A3e C4e D4e',
    'Am': 'A2e E3e A3e C4e E4e G4e',
    'Ds': 'D2e A2e D3e G3e A3e C4e',
}
PHRASE = ['Dm'] * 4 + ['F'] * 4 + ['Dm'] * 4 + ['Am', 'Am', 'Ds', 'Ds']
# the sixteenth-note waves of the second half: (up, by the second violins); the
# violas answer with the mirror, down
RUN = {
    'mix': 'D4s F#4s A4s B4s D5s F#5s',       # D major sixth -> G minor seventh
    'maj': 'D4s A4s D5s F#5s A5s D6s',        # D major -> G minor
    'sus': 'D4s G4s A4s D5s G5s A5s',         # Dsus4 (its own mirror)
    'dim': 'D4s F4s B4s D5s F5s B5s',         # B diminished (its own mirror)
    'aug': 'D4s F#4s Bb4s D5s F#5s Bb5s',     # D augmented (its own mirror)
    'am7': 'E4s G4s A4s C5s E5s G5s',         # A minor seventh (its own mirror)
    'wt': 'D4s E4s F#4s G#4s Bb4s C5s',       # the whole-tone scale (its own mirror)
    'fr6': 'C#4s Eb4s G4s A4s C#5s Eb5s',     # the French sixth (its own mirror)
}


def down(text, lo='D2', hi='D4'):
    return mirror(text, lo, hi)


def wave(part, bar, text, vel=0.5, falling=False, half=False):
    """One harp wave, played rather than typed: it leans into its top (or away
    from it, falling) and its notes are not quite even."""
    ps = kit.pitches(text)
    n = len(ps)
    t0 = part.score.bar(bar)
    for i, p in enumerate(ps):
        x = i / max(1, n - 1)
        late = 0.035 * (4 * x * (1 - x))                      # the middle of the run drags a hair
        v = vel * ((1.12 - 0.3 * x) if falling else (0.84 + 0.3 * x))
        if i == 0:
            v = vel * (1.08 if not falling else 1.15)
        part.note(t0 + 0.5 * i + late, p, 0.5, vel=min(1.0, v))


def clip(part, limit, upto=None):
    """Cut a part off at beat `limit`: notes sounding there are shortened, notes
    starting in [limit, upto) removed (upto None: every later note)."""
    hi = float('inf') if upto is None else upto
    part.notes = [n for n in part.notes if not (limit - 1e-9 <= n.start < hi - 1e-9)]
    for n in part.notes:
        if n.start < limit < n.end:
            n.dur = limit - n.start


def copy_from(dst, src, start_beat, transpose=0, vel_scale=1.0):
    """Double a line: src's notes from start_beat on."""
    for n in src.notes:
        if n.start >= start_beat - 1e-9:
            dst.notes.append(type(n)(**{**n.__dict__, 'pitch': n.pitch + transpose,
                                        'vel': min(1.0, n.vel * vel_scale)}))


def build():
    s = Score('dark_link', tonic='D', bpm=90, meter=(6, 8), intro_bars=8, loop_bars=96,
              title=TITLE, seed=1998)
    for base in (A, B):
        for ph in range(4):
            s.tempo(base + 4 * ph, 93)
            s.tempo(base + 4 * ph + 2, 91, ramp_to=84)
    s.tempo(C, 90, ramp_to=120)
    s.tempo(D, 120)
    s.tempo(F2 + 6, 120, ramp_to=84)
    s.tempo(G, 90)
    # a flooded hall with no walls: long, dark, a slow first reflection
    s.reverb = dict(rt60=3.2, predelay_ms=34, wet_db=-2.5, damp=0.55)
    s.master = dict(lufs=-15.5, glue_ratio=1.3, lead_duck=4.0,
                    eq=[('peak', 300, 0.8, -3.0), ('peak', 3600, 1.0, -1.5),
                        ('highshelf', 9000, 0.7, 1.0)])
    P = s.part

    # ================================================================ the water (intro, A, B, C, G)
    harp = P('harp', 'harp', role='keys', gain=-1.0, reverb=0.6)
    # intro: the wave and its reflection, twice; then the wave alone
    for k, bar in enumerate(range(INTRO, INTRO + 8)):
        if k % 2 == 0:
            wave(harp, bar, UP['Dm'], vel=0.5)
        elif k < 4:
            wave(harp, bar, down(UP['Dm']), vel=0.42, falling=True)
    for k in range(16):
        up = UP[PHRASE[k]]
        if k % 2 == 0:
            wave(harp, A + k, up, vel=0.48)                     # A: no wave comes back
            wave(harp, B + k, up, vel=0.5)
        else:
            wave(harp, B + k, down(up), vel=0.44, falling=True)
    # C: the wave and its reflection inside one bar, rising
    for k in range(12):
        harp.at(C + k).play('D2e A2e F3e ' + down('D2e A2e F3e'), vel=0.4 + 0.012 * k)

    drone = P('drone', 'basses', role='low', art='soft', gain=0.0)
    for bar in list(range(INTRO, C, 2)) + [G, G + 2]:
        drone.at(bar).play('@p [D1 D2]:6')
    for bar in range(C, D, 2):
        drone.at(bar).play('%sus @mp [D1 D2]:6')
    drone.expr((INTRO, 0.4), (INTRO + 3, 1.0), (C, 0.75), (D - 0.05, 0.75), (G, 0.8), (END - 0.05, 0.9))

    mist = P('mist', 'violins', role='pad', art='trem', gain=-10.0,
             eq=[('highshelf', 5000, 0.7, -5.0), ('peak', 3000, 1.0, -3.0)])
    # (only where nobody sings: it lies in the tune's own octave)
    for bar in (INTRO + 2, INTRO + 4, INTRO + 6, G, G + 2):
        mist.at(bar).play('@pp [A5 D6]:6')
    mist.expr((INTRO + 2, 0.3), (INTRO + 5, 1.0), (A - 0.05, 0.35), (G, 0.4), (G + 2, 0.9),
              (END - 0.05, 0.35))

    # droplets: a rising figure in each bar the tune leaves empty. From B on, a
    # second voice answers it upside down
    cel = P('drops', 'celesta', role='accent', gain=1.5)
    glock = P('drops2', 'glock', role='accent', gain=-5.0)
    drop = 're A6e B6e D7e rq |'
    drop2 = 're A6e D7q rq |'               # after the F / E minor phrase: no B
    for bar in (INTRO + 5, INTRO + 7, G + 1, G + 3):
        cel.at(bar).play('@p ' + drop)
    for base in (A, B):
        for k, d in ((3, drop), (7, drop2), (11, drop)):
            cel.at(base + k).play('@p ' + d)
    # (the answer falls in the same empty bar, after the droplet, never on the tune)
    for k, d in ((3, 'rq. G6e F6e D6e |'), (7, 'rq. rq G6e |'), (11, 'rq. G6e F6e D6e |')):
        glock.at(B + k).play('@pp ' + d)
    rub = P('rub', 'orch_perc', role='accent', gain=-6.0)
    drums(rub, INTRO + 5, {'bd_rub': 'x'}, step=3.0, vel=0.5)
    drums(rub, G, {'bd_rub': 'x'}, step=3.0, vel=0.45)

    # ================================================================ the hero (A, B, C)
    hero = P('hero', 'ocarina', role='lead', gain=-4.0, reverb=0.6)
    hero.at(A).play('@mp ' + THEME)
    hero.at(B).play('@mf ' + THEME)
    hero.at(C).play('@mf ' + HERO_C)
    for base in (A, B):
        for ph in range(4):
            swell(hero, base + 4 * ph, 3 if ph < 3 else 4, lo=0.8, hi=1.0, peak=0.5)
    cresc(hero, C, 12, lo=0.85, hi=0.92)

    # ================================================================ the reflection (B, C)
    # the same instrument, far across the water and dark: every note the hero's,
    # turned over around D5. B: a bar behind. C: half a bar.
    shade = P('shade', 'ocarina', role='counter', gain=-2.0, pan=0.42, depth=1.0, reverb=1.4,
              eq=[('lowpass', 2600, 0.7, 0), ('peak', 500, 1.0, 2.0)])
    shade.at(B + 1).play('@mp ' + mirror(THEME, 'D5', 'D5'))
    clip(shade, s.bar(C) + 1.5)
    c_from = len(shade.notes)
    shade.at_beat(s.bar(C) + 1.5).play('@mf ' + mirror(HERO_C, 'D5', 'D5'))
    clip(shade, s.bar(D))
    for ph in range(4):
        swell(shade, B + 1 + 4 * ph, 3, lo=0.75, hi=1.0, peak=0.5)
    cresc(shade, C, 12, lo=0.85, hi=0.95)

    # C: the tune gathers players as it breaks up: a solo violin, then the section
    solo = P('hero_solo', 'solo_violin', role='lead2', gain=-7.0)
    copy_from(solo, hero, s.bar(C + 3))
    cresc(solo, C + 3, 9, lo=0.7, hi=1.05)
    # ... and so does the reflection: violas, then horns
    sh_va = P('shade_va', 'violas', role='counter', art='sus', gain=-8.0)
    sh_hn = P('shade_hn1', 'horns', role='counter', gain=-9.0)
    for n in shade.notes[c_from:]:
        if n.start >= s.bar(C + 3) + 1.5 - 1e-9:
            sh_va.notes.append(type(n)(**n.__dict__))
        if n.start >= s.bar(C + 6) + 1.5 - 1e-9:
            sh_hn.notes.append(type(n)(**n.__dict__))
    cresc(sh_va, C + 3, 9, lo=0.6, hi=1.1)
    cresc(sh_hn, C + 6, 6, lo=0.5, hi=1.0)

    # the bed under B and C: the tritone F-B never moves (it is its own mirror);
    # the celli rock between the hero's A and the reflection's G
    pva = P('pad_va', 'violas', role='pad', art='soft', gain=-2.0)
    pvc = P('pad_vc', 'celli', role='pad', art='soft', gain=-1.0)
    # (each bar's chord is the last bar's turned over: D minor, G; F, E minor; A minor, C)
    pva.at(B).play('@p [D4 F4]h. | [B3 D4]h. | [D4 F4]h. | [B3 D4]h. | '
                   '[A3 C4]h. | [G3 B3]h. | [A3 C4]h. | [G3 B3]h. | '
                   '[D4 F4]h. | [B3 D4]h. | [D4 F4]h. | [B3 D4]h. | '
                   '[C4 E4]:6 | [D4 G4]h. | [A3 D4]h. |')
    pvc.at(B).play('@p A3h. | G3h. | A3h. | G3h. | F3h. | E3h. | F3h. | E3h. | '
                   'A3h. | G3h. | A3h. | G3h. | A3h. | G3h. | A3h. | D3h. |')
    for k in range(0, 12, 2):
        pva.at(C + k).play('%trem @mp [F4 B4]:6')
    pvc.at(C).play('%sus @mp ' + 'A3q. G3q. | ' * 12)
    for p in (pva, pvc):
        p.expr((B, 0.7), (B + 10, 1.0), (C, 0.95), (D - 0.05, 1.0))

    # ================================================================ phase two: the voices
    LOWMID = [('peak', 280, 1.0, -3.0)]
    vn = P('hero_vn', 'violins', role='lead', gain=0.0,
           eq=[('peak', 3800, 1.0, -3.0), ('highshelf', 6000, 0.7, -2.5)])
    va = P('hero_va', 'violas', role='lead2', art='sus', gain=-2.0)
    fl = P('hero_fl', 'flute', role='lead2', gain=-5.0)
    tpt = P('tpt', 'trumpets', role='lead', gain=0.0, reverb=0.35,
            eq=[('peak', 3800, 1.0, -2.0), ('highshelf', 6000, 0.7, -2.0)])
    hn = P('shade_hn', 'horns', role='counter', gain=1.5, reverb=0.38,
           eq=LOWMID + [('peak', 2400, 1.0, 2.0)])
    vc = P('shade_vc', 'celli', role='lead2', art='sus', gain=-2.0, eq=LOWMID)
    tbn = P('tbn', 'trombones', role='lead2', gain=1.0, reverb=0.38,
            eq=LOWMID + [('peak', 2600, 1.0, 2.5)])
    tuba = P('tuba', 'tuba', role='low', gain=5.0, reverb=0.3)
    men = P('men', 'choir', role='lead', gain=0.5, reverb=0.42, eq=[('peak', 300, 1.0, -2.0)])
    wom = P('women', 'choir', role='lead2', gain=2.0, reverb=0.42)
    cb = P('cb', 'basses', role='low', gain=5.0)
    sub_ = P('sub', 'sub', role='sub', gain=2.0)
    timp = P('timp', 'timpani', role='timp', gain=2.0)
    troll = P('timp_roll', 'timpani', role='timp', art='roll', gain=0.0)
    perc = P('perc', 'orch_perc', role='accent', gain=4.0)
    cym = P('cym', 'orch_perc', role='accent', gain=-2.0)
    boom = P('boom', 'boom', role='accent', gain=4.0)
    bell = P('bell', 'bells', role='accent', gain=1.0)
    run = P('run', 'violins2', role='ostinato', art='spic', gain=-4.0)
    hold = P('hold', 'violas', role='pad', art='sus', gain=-4.5, eq=[('peak', 280, 1.0, -5.0)])

    def down_run(text):
        """The run's mirror around D, in the octave that keeps it on the instrument."""
        for hi in ('D5', 'D6'):
            d = mirror(text, 'D4', hi)
            if min(kit.pitches(d)) >= 55:
                return d
        raise ValueError(text)

    def runs(bar, kind, vel=0.6):
        run.at(bar).play(RUN[kind] + ' ' + down_run(RUN[kind]), vel=vel)

    def impact(bar, vel=0.9, gong=True):
        """A blow with a floor under it."""
        boom.note(s.bar(bar), 'D1', 2.0, vel=vel)
        drums(perc, bar, {'bd': 'x', 'gong': 'x'} if gong else {'bd': 'x'}, step=3.0, vel=vel)
        drums(cym, bar, {'crash': 'x'}, step=3.0, vel=vel - 0.12)

    # the section violins join the tune's last pieces in C
    copy_from(vn, hero, s.bar(C + 6))
    cresc(vn, C + 6, 6, lo=0.4, hi=0.75)

    # ---------------------------------------------------------------- C: the gathering
    troll.at(C + 8).play('@mf D2:12')
    cresc(troll, C + 8, 4, lo=0.15, hi=0.7)
    tbn.at(C + 8).play('@mp [D2 D3]:6 [D2 A2 D3]:6')
    cresc(tbn, C + 8, 4, lo=0.25, hi=0.6)
    drums(cym, C + 10, {'swell_l': 'x'}, step=3.0, vel=0.55)
    # one breath of air before the blades
    for p in (hero, shade, solo, sh_va, sh_hn, pva, pvc, drone, vn, troll, tbn):
        clip(p, s.bar(D) - 0.4, upto=s.bar(D))

    # ---------------------------------------------------------------- D: blades
    shadow_d = mirror(HERO_D, 'D4', 'D5')
    vn.at(D).play('@ff ' + HERO_D)
    fl.at(D).play('@f ' + HERO_D)
    va.at(D).play('@ff ' + HERO_D, transpose=-12)
    # trumpets on the hero's line (its two top D's an octave down: out of their range)
    tpt.at(D).play('@ff ' + HERO_D.replace('D6h.^', 'D5h.^').replace("D6e' D6e'", "D5e' D5e'")
                   .replace('C6e D6e |', 'C6e D5e |'))
    for p in (hn, tbn):
        p.at(D).play('@ff ' + shadow_d)
    # the floor: tuba and a second desk of trombones hold the open fifth, the celli
    # and basses drive D in eighths
    floor = P('floor', 'trombones', role='low', gain=1.0, pan=0.5, eq=LOWMID)
    tuba.at(D).play('@ff ' + 'D2h. | ' * 12 + '@mp D2h.~ | D2h. | @mf D2h.~ | D2h. |')
    floor.at(D).play('@ff ' + '[D2 A2]h. | ' * 12)
    for k in range(12):
        cb.at(D + k).play("%spic @ff D2e> D2e D2e D2e> D2e D2e |")
        vc.at(D + k).play("%spic @ff D3e> D3e A2e D3e> D3e A2e |")
        runs(D + k, 'mix', vel=0.6)
    vc.at(D + 12).play('%sus @mp ' + mirror('D5h.~ | D5h. | F#5h.~ | F#5h. |', 'D4', 'D5'))
    cb.at(D + 12).play('%trem @mp [D1 D2]:6 @mf [D1 D2]:6')
    # they lock: every string trembles on D, and the lock bends to D augmented
    run.at(D + 12).play('%trem @mp [D4 D5]:6 @mf [F#4 D5]:6')
    hold.at(D + 12).play('%trem @mp [D3 D4]:6 @mf [Bb3 D4]:6')
    for p in (run, hold, cb, tbn, tuba, tpt, hn, vc, vn, va, fl):
        p.expr((D + 12, 0.5), (D + 14, 0.75), (E - 0.05, 1.2), (E, 1.0))
    wom.at(D + 12).play('@mp D5h.~ | D5h. | @mf F#5h.~ | F#5h. |')
    men.at(D + 12).play('@mp D3h.~ | D3h. | @mf Bb3h.~ | Bb3h. |')
    for p in (wom, men):
        p.expr((D + 12, 0.3), (D + 14, 0.6), (E - 0.05, 1.25), (E, 1.0))
    for k in (0, 4, 8, 9):
        timp.at(D + k).play('@ff D2q.> D2e D2e D2e |')
    for k in (1, 2, 5, 6, 10):
        timp.at(D + k).play('@f D2q. rq. |')
    for k in (3, 7):
        timp.at(D + k).play('@ff D2q.> A2e D2e A2e |')
    timp.at(D + 11).play('@ff D2q.> D2q.> |')
    troll.at(D + 12).play('@mf D2:12')
    troll.expr((D + 12, 0.2), (D + 14, 0.45), (E - 0.05, 1.0))
    impact(D, vel=0.95)
    for k in (3, 4, 7, 8, 9):
        drums(perc, D + k, {'bd': 'x'}, step=3.0, vel=0.8)
    drums(perc, D + 11, {'bd': 'x.....x.....'}, vel=0.82)
    for k in (3, 7):
        drums(cym, D + k, {'crash': 'x'}, step=3.0, vel=0.7)
    drums(cym, D + 14, {'swell_l': 'x'}, step=3.0, vel=0.72)

    # ---------------------------------------------------------------- E: major, and its mirror
    hero_e = [(E, HERO_E1), (E + 8, HERO_E2), (E + 12, HERO_E3)]
    for bar, text in hero_e:
        answer = mirror(text, 'D4', 'D5')
        n_bars = int(round(kit.beats(text) / 3))
        # the tune: violins and flute on top; trumpets, horns and the women an octave
        # under them (it tops out above the trumpets); trombones an octave under those
        vn.at(bar).play('@ff ' + text)
        fl.at(bar).play('@f ' + text)
        for p in (tpt, wom):
            p.at(bar).play('@ff ' + text, transpose=-12)
        # (the last strain climbs past the horns' top: they go with the trombones)
        hn.at(bar).play('@ff ' + text, transpose=-24 if text is HERO_E3 else -12)
        tbn.at(bar).play('@ff ' + text, transpose=-24)
        # the answer: the men, trombones and celli; the tuba an octave under
        for p in (men, tbn, vc):
            p.at(bar + n_bars).play('@ff ' + answer)
        tuba.at(bar + n_bars).play('@f ' + answer, transpose=-12)
    hero_bars = [E, E + 1, E + 2, E + 3, E + 8, E + 9, E + 12, E + 13]
    dark_bars = [b for b in range(E, F1) if b not in hero_bars]
    # the harmony: violas throughout, the horns' chords under the answer
    pad(hold, E, CH_E, n=3, lo=53, hi=69, vel=0.6)
    hn_pad = P('hn_pad', 'horns', role='pad', gain=-3.0, eq=LOWMID)
    hn_pad.at(E + 4).play('@mf [D4 G4 Bb4]h. | [D4 F4 Bb4]h. | [D4 F4 A4]q. [Eb4 G4 C5]q. | '
                          '[Eb4 G4 C5]h. |')
    hn_pad.at(E + 10).play('@mf [D4 G4 Bb4]h. | [Eb4 G4 C5]h. |')
    hn_pad.at(E + 14).play('@mf [D4 F4 Bb4]h. | [Eb4 G4 C5]h. |')
    arp(run, E, CH_E, pattern='0 1 2 3 4 5 6 5 4 3 2 1', step=0.25, lo=57, hi=86,
        vel=0.58, accent_every=1.5, art='spic')
    # the bass: marching under the hero, held under the answer
    roots = {E: 'D2', E + 1: 'B1', E + 3: 'A1', E + 8: 'D2', E + 9: 'A1', E + 12: 'B1',
             E + 13: 'A1', E + 4: 'G1', E + 5: 'Bb1', E + 7: 'C2', E + 10: 'G1', E + 11: 'C2',
             E + 14: 'Bb1', E + 15: 'C2'}
    for bar, r in roots.items():
        if bar in hero_bars:
            cb.at(bar).play(f'%spic @f {r}e> {r}e {r}e {r}e> {r}e {r}e |')
            tuba.at(bar).play(f'@f {r}q.^ {r}q.^ |', transpose=12 if r in ('A1', 'B1') else 0)
        else:
            cb.at(bar).play(f'%sus @f {r}h. |')
    cb.at(E + 2).play('%spic @f G1e> G1e G1e A1e> A1e A1e |')
    tuba.at(E + 2).play('@f G2q.^ A2q.^ |')
    cb.at(E + 6).play('%sus @f D2q. C2q. |')
    t_roots = {E: 'D2', E + 1: 'B2', E + 3: 'A2', E + 8: 'D2', E + 9: 'A2', E + 12: 'B2',
               E + 13: 'A2'}
    for bar, r in t_roots.items():
        timp.at(bar).play(f'@f {r}q.> {r}e {r}e {r}e |')
    timp.at(E + 2).play('@f G2q.> A2e A2e A2e |')
    for bar, text in ((E + 4, 'G2q.> rq.'), (E + 5, 'Bb2q.> rq.'), (E + 6, 'D2q.> C2q.'),
                      (E + 7, 'C2q.> rq.'), (E + 10, 'G2q.> rq.'), (E + 11, 'C2q.> rq.'),
                      (E + 14, 'Bb2q.> rq.'), (E + 15, 'C2q.> rq.')):
        timp.at(bar).play(f'@f {text} |')
    snare = P('snare', 'orch_perc', role='accent', gain=-3.0, depth=0.8)
    for bar in hero_bars:
        drums(snare, bar, {'sn': 'X.x.x.X.x.xx'}, vel=0.6)
    for bar in (E, E + 8, E + 12):
        drums(cym, bar, {'crash': 'x'}, step=3.0, vel=0.72)
        drums(perc, bar, {'bd': 'x'}, step=3.0, vel=0.8)
    for bar in (E + 4, E + 10, E + 14):
        drums(perc, bar, {'bd': 'x', 'gong': 'x'} if bar == E + 4 else {'bd': 'x'}, step=3.0,
              vel=0.8)
    for bar in dark_bars:
        if bar not in (E + 4, E + 10, E + 14):
            drums(perc, bar, {'bd': 'x'}, step=3.0, vel=0.66)

    # ---------------------------------------------------------------- F1: the hymn
    shadow_h = mirror(HYMN, 'D4', 'D5')
    vn.at(F1).play('@fff ' + HYMN)
    fl.at(F1).play('@ff ' + HYMN)
    va.at(F1).play('@ff ' + HYMN, transpose=-12)
    wom.at(F1).play('@fff D5h. | A5h. | B5h. | A5h. | F#5h. | A5h. | D5h.~ | D5h. |')
    tpt.at(F1).play('@fff D5h. | A5h. | B5h. | A5h. | F#5h. | A5h. | [D5 A5]h.~ | [D5 A5]h. |')
    for p in (men, tbn, hn, vc):
        p.at(F1).play('@fff ' + shadow_h)
    tuba.at(F1).play('@ff ' + shadow_h, transpose=-12)
    cb.at(F1).play('%sus @ff ' + shadow_h, transpose=-24)
    for k, kind in enumerate(('maj', 'sus', 'dim', 'sus', 'aug', 'sus', 'maj', 'maj')):
        runs(F1 + k, kind, vel=0.64)
    for k, r in enumerate(('D2', 'G2', 'F2', 'G2', 'Bb2', 'G2', 'D2')):
        timp.at(F1 + k).play(f'@ff {r}q.> {r}e {r}e {r}e |')
        if k:
            drums(perc, F1 + k, {'bd': 'x'}, step=3.0, vel=0.8)
    troll.at(F1 + 7).play('@f D2h.')
    cresc(troll, F1 + 7, 1, lo=0.5, hi=1.0)
    for k, p in enumerate(('D5', 'A5', 'B5', 'A5', 'F#5', 'A5', 'D5')):
        bell.at(F1 + k).play(f'@f {p}h.')
    impact(F1, vel=0.9, gong=False)
    drums(perc, F1 + 4, {'gong': 'x'}, step=3.0, vel=0.7)

    # ---------------------------------------------------------------- F2: Lydian up, Locrian down
    shadow_w = mirror(WEDGE, 'D4', 'D5')
    vn.at(F2).play('@fff ' + WEDGE)
    vn8 = P('hero_vn8', 'violins', role='lead2', gain=-5.0, eq=[('highshelf', 5000, 0.7, -4.0)])
    vn8.at(F2).play('@ff ' + WEDGE, transpose=12)
    fl.at(F2).play('@ff ' + WEDGE)
    for p in (wom, tpt, va):
        p.at(F2).play('@fff ' + WEDGE, transpose=-12)
    for p in (men, tbn, hn, vc):
        p.at(F2).play('@fff ' + shadow_w)
    tuba.at(F2).play('@ff ' + shadow_w, transpose=-12)
    cb.at(F2).play('%sus @ff ' + shadow_w, transpose=-12)
    for k, kind in enumerate(('am7', 'aug', 'wt', 'wt', 'sus', 'dim', 'fr6')):
        runs(F2 + k, kind, vel=0.68)
    run.at(F2 + 7).play('%stac @fff [D4 D5]q.^ rq. |')
    # (the last bar before the unison rolls on A: the French sixth's bass is E-flat)
    troll.at(F2).play('@f D2:18 A2h.')
    troll.expr((F2, 0.5), (F2 + 2, 0.85), (F2 + 4, 0.7), (F2 + 6.95, 1.0))
    timp.at(F2 + 7).play('@fff D2q.^ rq. |')
    for k in range(7):
        if k < 6:                      # (not against the French sixth's two leading tones)
            bell.at(F2 + k).play('@f D5h.')
        if k:
            drums(perc, F2 + k, {'bd': 'x'}, step=3.0, vel=0.76 + 0.02 * k)
    drums(perc, F2, {'bd': 'x'}, step=3.0, vel=0.8)
    drums(cym, F2, {'crash': 'x'}, step=3.0, vel=0.74)
    drums(perc, F2 + 2, {'gong': 'x'}, step=3.0, vel=0.8)
    drums(cym, F2 + 5, {'swell_l': 'x'}, step=3.0, vel=0.8)
    impact(F2 + 7, vel=1.0)
    # weight: a sine under the basses wherever they play in phase two
    for n in cb.notes:
        if n.start >= s.bar(D) - 1e-9 and n.dur >= 1.4:
            sub_.note(n.start, n.pitch if n.pitch >= 33 else n.pitch + 12, n.dur, vel=0.6)
    for k in range(12):
        sub_.note(s.bar(D + k), 'D2', 3.0, vel=0.6)
    for bar in hero_bars:
        for n in cb.notes:
            if abs(n.start - s.bar(bar)) < 1e-6:
                sub_.note(n.start, n.pitch + (12 if n.pitch < 33 else 0), 3.0, vel=0.55)
    # riding the faders: the duel's short strokes carry less than the hymn's held
    # notes, so the blades sit 3 dB up and the major strain 1 (the sampled sections
    # are already at the top of their dynamic there: a velocity cannot do it)
    def ride(d, e):
        return [(C, 0.0), (D - 0.02, 0.0), (D, d), (D + 12 - 0.02, d), (D + 12, 0.0),
                (E - 0.02, 0.0), (E, e), (F1 - 0.02, e), (F1, 0.0), (END - 0.02, 0.0)]

    for p, d, e in ((vn, 3, 1), (va, 3, 1), (fl, 3, 1), (tpt, 6, 2.5), (hn, 6, 1.5),
                    (tbn, 6, -1), (vc, 3, 1), (cb, 2, 1), (timp, 2, 1), (run, 2, 0),
                    (floor, 1, 0), (tuba, 4, 1), (perc, 2, 1), (boom, 3, 0)):
        p.opts['fader'] = ride(d, e)
    # the whole band leans into the far fixed point, and again into the last bar
    for p in (vn, vn8, va, fl, wom, tpt, men, tbn, hn, vc, tuba, cb):
        p.expr((F1, 0.9), (F2, 0.95), (F2 + 2, 1.1), (F2 + 4, 0.95), (F2 + 6.9, 1.2),
               (F2 + 7, 1.2), (G - 0.05, 1.2))

    s.notes_text = __doc__
    return s


if __name__ == '__main__':
    sc = build()
    print(sc.title, len(sc.parts), 'parts')
