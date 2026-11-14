"""Eclipsed battles, a second theme — "The Other Half of the Sky".

The second theme for nodes the Eclipse has taken (Totality,
scores/battle_eclipsed.py, is the first; the two share the `eclipsed` pool).

Totality is the light going out: slow, and the bell's call (D, then A) is
never answered. This is the other thing an eclipse is: two bodies lining
up. Here the call IS answered, from below, upside down (D, then the G under
it), and it does not help.

Mechanism: THE MIRROR. The tune is in D dorian, the one church mode that is
its own reflection: turned upside down around D it lands on the same seven
notes. So the tune (the light: violins, D up to D) has a shadow that is its
exact mirror (celli, trombones and the bass, D down to D), note for note
and beat for beat. When the tune climbs the shadow sinks. They are never
the same note, except on D. Nothing else is the bass: the shadow is. There
is no chord chart; the harmony is whatever the two lines make (thirds and
sixths on E and C, a bare ninth on the call's A, tritones on F and B).

Form (bars, 4/4 at 126): intro 1-4 (the Eclipse cue's boom and bell, D A;
then the answer, D G, low) | A 5-12 (tune and shadow, the shadow quiet) |
A2 13-20 (horns join the tune; the shadow in the trombones, as loud as the
light) | B 21-28 (the dark above: the tune sinks to the low brass and its
mirror is over it in the violins, the same two lines with the sky turned
over; they cross on one D) | C 29-36 (alignment: four wedges, light and
shadow walking toward each other from farther out each time, in shorter
notes each time, and meeting on D; on each meeting the bell sounds its call
and its answer at once) | A3 37-44 (everyone; the tune ends a step above D
and the shadow a step below it, and the loop begins on the D between them).
Loop 5-44, 40 bars, 76 s.

Both layers (see scores/_battle.py): the full mix has the kit, the bass
guitar on the shadow, brass and men's voices; the calm mix is one wind on
the tune and one cello line on the shadow over harp and the bell. (The calm
layer uses harp, not the grand piano the other calm beds have.)
"""

from engine.patterns import drums
from engine.score import Score
from engine.theory import pitch

from scores._battle import Battle

KEY = 'music_battle_eclipsed_2'

# the tune, D dorian: the call (D, A) and where it goes. It ends on E.
TUNE = """
D5q. A5e~ A5q G5e F5e | E5q. G5e~ G5h | re A5e B5e C6e D6q. C6e | B5q A5e G5e~ G5q A5q |
D5q. A5e~ A5q C6e B5e | A5q. G5e~ G5q E5q | F5e G5e A5q~ A5e G5e F5e E5e | E5h. rq |
"""
# C: the wedges (the upper line; the lower is its mirror). Each lands on D.
WEDGES = (
    'A5q G5q F5q E5q | D5h. rq |',
    'C6e B5e A5e G5e F5q E5q | D5h. rq |',
    'D6e C6e B5e A5e G5e F5e E5q | D5h. rq |',
    'D6e C6e B5e A5e G5e F5e E5e E5e | D5w |',
)

INTRO, A, A2, B, C, A3, END = 1, 5, 13, 21, 29, 37, 45
AXIS = pitch('D4')

HALF = {'kick': 'x.....x...x.....', 'snare': '........X.......', 'hat': 'x.x.x.x.x.x.x.x.'}
DRIVE = {'kick': 'x..x..x.x..x..x.', 'snare': '....X.......X...', 'ride': 'x.x.x.x.x.x.x.x.'}
UNDER = {'kick': 'x.....x.x.....x.', 'tom_floor': '..x...x...x...x.', 'tom_lo': '....x.......x...',
         'snare': '............X...'}
FILL = {'kick': 'x.....x.x.......', 'snare': '........x.xxXXXX', 'tom_hi': '....xx..'}
FULL = {'kick': 'x..x..x.x..x..x.', 'snare': '....X.......X..x', 'crash2': 'x...............',
        'hat': 'x.x.x.x.x.x.x.x.'}


def mirror(src, dst, a, z, shift=0, vel_scale=1.0, art=None, floor=0):
    """Lay the notes `src` plays in beats [a, z) into `dst`, turned upside down
    around the D above middle C (and moved by `shift` semitones)."""
    for n in list(src.notes):
        if a - 1e-9 <= n.start < z - 1e-9:
            p = 2 * AXIS - n.pitch + shift
            dst.note(n.start, p + 12 if p < floor else p, n.dur, vel=min(1.0, n.vel * vel_scale),
                     art=art, tie=n.tie)


def pulse(src, dst, a, z, shift=0, vel=0.7):
    """The same line beaten out in eighths (the bass guitar under the shadow)."""
    for n in list(src.notes):
        if a - 1e-9 <= n.start < z - 1e-9:
            k = 0
            while k * 0.5 < n.dur - 1e-9:
                p = n.pitch + shift
                dst.note(n.start + k * 0.5, p + 12 if p < 28 else p, min(0.5, n.dur - k * 0.5),
                         vel=vel + (0.1 if k == 0 else 0.0))
                k += 1


def build():
    s = Score('battle_eclipsed_2', tonic='D', bpm=126, intro_bars=4, loop_bars=40,
              title='The Other Half of the Sky', seed=4409)
    s.reverb = dict(rt60=2.8, predelay_ms=28, wet_db=-0.5)
    b = Battle(s, calm_lufs=-17.0, full_lufs=-14.0)

    def span(bar, n=8):
        return s.bar(bar), s.bar(bar + n)

    # ================================================================ the light (the tune)
    vn = b.part('light_vn', 'violins', role='lead', art='sus', calm_db=-6)
    hn = b.part('light_hn', 'horns', layer='full', role='lead2')
    tpt = b.part('light_tpt', 'trumpets', layer='full', role='lead2')
    low_tune = b.part('light_low', 'trombones', layer='full', role='lead')
    low_tune_tuba = b.part('light_low_tuba', 'tuba', layer='full', role='low')
    vn.at(A).play('@f %sus ' + TUNE)
    vn.at(A2).play('@ff %sus ' + TUNE)
    hn.at(A2).play('@f ' + TUNE, transpose=-12)
    # B: the tune sinks two octaves, into the low brass
    low_tune.at(B).play('@ff ' + TUNE, transpose=-24)
    low_tune_tuba.at(B).play('@f ' + TUNE, transpose=-36)
    vn.at(A3).play('@ff %sus ' + TUNE)
    tpt.at(A3).play('@ff ' + TUNE, transpose=-12)
    hn.at(A3).play('@ff ' + TUNE, transpose=-12)

    # ================================================================ the shadow (its mirror)
    vc = b.part('shadow_vc', 'celli', role='lead2', art='sus', calm_db=-3)
    cb = b.part('shadow_cb', 'basses', role='low', art='sus', calm_db=-4)
    tbn = b.part('shadow_tbn', 'trombones', layer='full', role='lead2')
    tuba = b.part('shadow_tuba', 'tuba', layer='full', role='low')
    eb = b.part('ebass', 'rbass', layer='full', role='bass', duck='kit_kick')
    sub = b.part('sub', 'sub', layer='full', role='sub')
    for bar, cello, brass in ((A, 0.8, None), (A2, 0.95, 0.9), (A3, 1.0, 1.0)):
        a, z = span(bar)
        mirror(vn, vc, a, z, vel_scale=cello, art='sus')
        mirror(vn, cb, a, z, shift=-12, vel_scale=cello * 0.9, art='sus')
        if brass:
            mirror(vn, tbn, a, z, vel_scale=brass)
            mirror(vn, tuba, a, z, shift=-12, vel_scale=brass * 0.9, floor=28)
        pulse(vc, eb, a, z, shift=-12, vel=0.68 if bar == A else 0.74)
    # B: the mirror of the sunken tune is above it: violins in octaves
    top = b.part('shadow_top', 'violins2', role='lead', art='sus', calm_db=-6)
    a, z = span(B)
    mirror(low_tune, top, a, z, art='sus')                   # D5 down to D4
    mirror(low_tune, vn, a, z, shift=12, art='sus')          # and the octave above
    for n in list(low_tune.notes):
        if a - 1e-9 <= n.start < z - 1e-9:
            vc.note(n.start, n.pitch, n.dur, vel=n.vel * 0.9, art='sus', tie=n.tie)
            cb.note(n.start, n.pitch - 12 if n.pitch - 12 >= 26 else n.pitch, n.dur,
                    vel=n.vel * 0.8, art='sus', tie=n.tie)
    pulse(low_tune, eb, a, z, shift=-12 + 0, vel=0.72)

    # ================================================================ C: alignment
    w_up = b.part('wedge_up', 'violins', role='lead', art='sus', calm_db=-6)
    w_tpt = b.part('wedge_tpt', 'trumpets', layer='full', role='lead2')
    w_dn = b.part('wedge_dn', 'celli', role='lead2', art='sus', calm_db=-3)
    w_tbn = b.part('wedge_tbn', 'trombones', layer='full', role='lead2')
    bells = b.part('bells', 'bells', role='accent', calm_db=-3, gain=3.0)
    boom = b.part('boom', 'boom', role='accent', calm_db=-6)
    hits = b.part('hits', 'orch_perc', layer='full', role='accent')
    roll = b.part('roll', 'timpani', role='timp', calm_db=-8)
    for u, text in enumerate(WEDGES):
        bar = C + 2 * u
        dyn = ('mf', 'f', 'ff', 'ff')[u]
        w_up.at(bar).play(f'@{dyn} %sus ' + text)
        if u >= 2:
            w_tpt.at(bar).play(f'@{dyn} ' + text, transpose=-12)
        a, z = span(bar, 2)
        mirror(w_up, w_dn, a, z, art='sus')
        mirror(w_up, w_tbn, a, z, vel_scale=0.95)
        pulse(w_dn, eb, a, z, shift=-12, vel=0.7 + 0.03 * u)
        # the meeting: the call and its answer at once
        t = s.bar(bar + 1)
        v = 0.6 + 0.08 * u
        for p in ('G3', 'D4', 'A4'):
            bells.note(t, p, 3.0, vel=v)
        boom.note(t, 'D2', 2.0, vel=v)
        drums(hits, bar + 1, {'bd': 'X', 'crash': 'x'} if u < 3 else
              {'bd': 'X', 'crash': 'X', 'gong': 'x'}, step=4.0, vel=0.7 + 0.05 * u)
        sub.note(t, 'D1', 3.0, vel=0.6)
        roll.at(bar).play('%roll @mp D2w |')
        roll.expr((bar, 0.25), (bar + 0.97, 0.7 + 0.1 * u), (bar + 1, 1.0))

    # ================================================================ the bell and the ground
    # intro: the Eclipse cue (boom, D, A), and the answer from below
    boom.at(1).play('@mf D2q rq rh |')
    bells.at(1).play('@mf D4q A4q rh | rw | D4q G3q rh | rw |')
    boom.at(3).play('@mp D2q rq rh |')
    drone = b.part('drone', 'basses', role='low', art='soft', calm_db=-2)
    drone.at(1).play('@p %soft D1w~ | D1w~ | D1w~ | D1w |')
    for bar in (A, A2, A3):                     # the call opens each strain; the answer its second half
        bells.at(bar).play('@mf D4q. A4e~ A4h |')
        bells.at(bar + 4).play('@mp D4q. G3e~ G3h |')
    bells.at(B).play('@mf D4q. G3e~ G3h |')     # B: the answer first
    bells.at(B + 4).play('@mp D4q. A4e~ A4h |')

    # the ostinato spells both: D A D G, the axis, the call, the axis, the answer
    ost = b.part('ost_va', 'violas', role='ostinato', art='spic', calm_db=-5)
    ost2 = b.part('ost_vn2', 'violins2', layer='full', role='ostinato', art='spic')
    for bar in list(range(3, B)) + list(range(A3, END)):
        v = 0.5 if bar < A else 0.58
        ost.at(bar).play(f'@{v} %spic D4e> A4e D4e G3e D4e> A4e D4e G3e |')
        if bar >= A2:
            ost2.at(bar).play('@0.5 %spic D5s D5s A5s A5s D5s D5s G4s G4s D5s D5s A5s A5s D5s D5s G4s G4s |')
    # B: turned over, G first
    for bar in range(B, C):
        ost.at(bar).play('@0.58 %spic D4e> G3e D4e A4e D4e> G3e D4e A4e |')
    # C: the ostinato stands on the axis and waits
    for bar in range(C, A3):
        ost.at(bar).play('@0.5 %spic D4e> D4e D4e D4e D4e> D4e D4e D4e |')

    # men's voices on the axis and its two fifths (never a third)
    men = b.part('men', 'oohs', layer='full', role='choir')
    for bar in range(A2, B):
        men.at(bar).play('@mf [D3 A3]h [G2 D3]h |' if (bar - A2) % 2 == 0 else '@mf [D3 A3]w |')
    for bar in range(A3, END):
        men.at(bar).play('@f [D3 A3 D4]h [G2 D3 G3]h |' if (bar - A3) % 2 == 0 else
                         '@f [D3 A3 D4]w |')
    choir = b.part('choir', 'choir', layer='full', role='choir')
    for u in range(4):
        choir.at(C + 2 * u + 1).play('@f [D3 A3 D4]h. rq |' if u < 3 else '@ff [D3 A3 D4 A4]w |')

    # ================================================================ drums
    kit_plan = ((A, HALF, 0.68), (A2, DRIVE, 0.74), (B, UNDER, 0.74), (A3, FULL, 0.78))
    from engine.patterns import Kit
    kit = Kit(s, 'kit')
    b.kit = kit
    b.full_only.update(kit.names())
    for bar, beat, vel in kit_plan:
        for k in range(8):
            kit.play(bar + k, FILL if k == 7 else beat, vel=vel)
        kit.play(bar, {'crash': 'X'}, vel=vel)
    kit.play(4, {'kick': 'x.......x.......', 'snare': '........x.xxXXXX'}, vel=0.66)
    for u in range(4):
        bar = C + 2 * u
        # toms walking in with the wedge, then the meeting
        kit.play(bar, ({'tom_floor': 'x...x...x...x...'},
                       {'tom_floor': 'x...x...x.x.x.x.', 'kick': 'x.......x.......'},
                       {'tom_floor': 'x.x.x.x.x.x.x.x.', 'kick': 'x...x...x...x...'},
                       {'tom_floor': 'x.x.x.x.xxxxxxxx', 'kick': 'x...x...x.x.x.x.',
                        'snare': '........x.x.xxXX'})[u], vel=0.7 + 0.03 * u)
        kit.play(bar + 1, {'kick': 'X.......', 'crash': 'X.......'} if u < 3 else
                 {'kick': 'X.....x.x.......', 'crash': 'X.......', 'snare': '........xxxxXXXX'},
                 vel=0.8)
    timp = b.part('timp', 'timpani', role='timp', calm_db=-8)
    for bar in (A, A2, B, A3):
        timp.at(bar).play('%default @f D2q rq rh |')
        timp.at(bar + 4).play('%default @f D2q rq G2q rq |')

    # ================================================================ calm
    wind_a = b.part('c_oboe', 'oboe', layer='calm', role='lead')
    wind_b = b.part('c_clar', 'clarinet', layer='calm', role='lead')
    flute = b.part('c_flute', 'flute', layer='calm', role='lead')
    wind_a.at(A).play('@mf ' + TUNE)
    flute.at(A2).play('@mf ' + TUNE)
    wind_b.at(B).play('@mf ' + TUNE, transpose=-12)       # the tune low, the mirror over it
    wind_a.at(A3).play('@mf ' + TUNE)
    flute.at(A3).play('@mp ' + TUNE)
    c_fl_top = b.part('c_flute_top', 'flute', layer='calm', role='lead2')
    a, z = span(B)
    mirror(low_tune, c_fl_top, a, z, shift=12, vel_scale=0.6)
    harp = b.part('c_harp', 'harp', layer='calm', role='keys')
    for bar in range(3, END):
        if C <= bar < A3:
            harp.at(bar).play('@mp D3q D4q D3q D4q |')
        elif B <= bar < C:
            harp.at(bar).play('@mp D3e G3e D4e G4e D3e A2e D3e A3e |')
        else:
            harp.at(bar).play('@mp D3e A3e D4e A4e D3e G2e D3e G3e |')
    from engine.patterns import Kit as _Kit
    ck = _Kit(s, 'ckit', gains={'kick': -4})
    b.calm_only.update(ck.names())
    for bar in range(A, END):
        ck.play(bar, {'kick': 'x.......x.......'}, vel=0.42)
    return b.finish()
