"""Act V battle — "Through the Floor".

The Vigil: the court circle's four Voices, standing on their sigils round a
summoning circle, chanting a rite that is happening now, under the stones.
Sera's cold open called it "a ring of robed mages, chanting in the dark.
Every word they speak falls through the floor and never lands." The Hollow
Sun (SCORE.md) is the chant: the church hymn's climb, third to leading
tone, in G minor Bb C D Eb F-sharp, and the name that would be G is never
sung. No boss card, no boss music; this plays for the mini-boss.

Mechanism: FOUR VOICES IN PARALLEL. The chant is sung in organum, the line
with a fourth below it, an octave below it and a fourth below that (the
four Voices; the stinger `voice_silenced` takes one away), strictly parallel
and diatonic, so the harmony is nothing but hollow fourths and fifths: only
the climb's last step, the leading tone, brings in a chromatic note (the
C-sharp under the F-sharp). The voices never cadence. Under the chant:

  * a falling ostinato: three-eighth cells that descend the chord (D Bb G,
    never landing on the beat: the cell realigns with the bar only where the
    chord changes), violas and celli, spiccato;
  * ritual percussion in 3+3+3+3+2+2 (log drums, floor tom, bass drum), with
    nothing in 3+3+2, which belongs to Doctrine of Lances and The Pit Answers;
  * a drone under every strain, G, then E-flat, then D, held by the basses.

The pitch of the chant never rises past its first note again in the call
(A): it climbs, falls back and ends on the supertonic over the dominant
pedal, the question the rite does not answer. The climb (B) goes to the
leading tone and stops; the voices cut; a downlifter drops two octaves
through two bars of nothing but a low D (the words falling through the
floor) and the loop turns. In C the circle tightens: the climb is sung in
quarters over a bass that rises a semitone every two bars (G, A-flat, A,
B-flat) and the climb with it, each cell ending on its own leading tone,
never on its tonic; B-flat's A, the last, is the note the next strain
begins a semitone above.

Form (bars): intro 1-4 (one Voice, a drone) | A 5-12 (the call, sparse) |
B 13-20 (the climb, the voices alone with the drums; bars 19-20 are the hole)
| A2 21-28 (the call with the band) | C 29-36 (the circle tightens) | B2
37-44 (the climb with brass; 43-44 the hole). Loop 5-44, 40 bars.

calm: one Voice (oohs) sings the line over cellos, the piano's fifths, a log
drum and a soft heartbeat: the court at its prayer. full: the four Voices,
the ostinato, the rite's drums, then brass, bass guitar and kit.
"""

from engine.patterns import Kit, arp, bass, chart, drums, ostinato, pad
from engine.score import Score
from engine.theory import pitch as parse_pitch

from scores._battle import Battle

KEY = 'music_battle_vigil'

# ------------------------------------------------------------------ material
# A: the call. It climbs a third, falls back and rests on A over the D pedal.
CHANT_A = 'Bb4h C5h | D5h Eb5h | Eb5w | D5h C5h | Bb4w | C5h Bb4h | A4w~ | A4w |'
# B: the Hollow Sun, a step a bar to the leading tone, which is held and left
CHANT_B = 'Bb4w | C5w | D5w | Eb5w | F#5w~ | F#5h rh | rw | rw |'
# C's cell (two bars, in quarters), sung a semitone higher each time round
CELL = 'Bb4q C5q D5q Eb5q | F#5h~ F#5q rq |'

# the four Voices: the line, a fourth below, an octave below, a fourth below that
VOICES = ((0, 'choir', 'lead'), (-5, 'oohs', 'lead2'), (-12, 'choir', 'lead2'),
          (-17, 'oohs', 'lead2'))

CH_A = chart('Gm:16 Eb:8 D5:8')                       # G, E-flat, D: the drones
CH_B = chart('Gm Cm/G Gm Eb/G D5:8 D5:8')
CH_C = chart('Gm:8 Abm:8 Am:8 Bbm:8')
INTRO, A1, B1, A2, C, B2 = 1, 5, 13, 21, 29, 37

# drum grids, 16 steps a bar. The rite's pulse: 3+3+3+3+2+2.
RITE = 'x..x..x..x..x.x.'
RITE_TOM = {'kick': 'x.......x.......', 'tom_lo': RITE}
RITE_FILL = {'kick': 'x.......x.......', 'tom_lo': 'x..x..x..x......', 'tom_mid': '.........x.xxxxx'}
RITE_BAND = {'kick': 'x..x..x..x..x.x.', 'snare': '........X.......', 'hat': 'x.x.x.x.x.x.x.x.',
             'tom_lo': '......x..x......'}
RITE_BAND_FILL = {'kick': 'x..x..x..x......', 'snare': '........X.x.xxXX', 'hat': 'x.x.x.x.x.......',
                  'tom_lo': '..x..x..........'}
RING = {'kick': 'x.x.x.x.x.x.x.x.', 'snare': '....X.......X...', 'hat': 'x.x.x.x.x.x.x.x.',
        'tom_lo': RITE}
RING_FILL = {'kick': 'x.x.x.x.x.x.x.x.', 'snare': '....X.......xxXX', 'hat': 'x.x.x.x.x.......',
             'tom_mid': '..........x.x.x.'}


def voices(b, bar, text, dyn):
    """The four Voices on one line, in parallel."""
    for i, (t, inst, role) in enumerate(VOICES):
        p = b.part(f'v{i + 1}', inst, layer='full', role=role, humanize_ms=14, vel_jitter=0.06)
        p.at(bar).play(f'@{dyn} ' + text, transpose=t)


def build():
    s = Score('battle_vigil', tonic='G', bpm=120, intro_bars=4, loop_bars=40,
              title='Through the Floor', seed=709)
    s.reverb = dict(rt60=3.6, predelay_ms=34, wet_db=0.4, damp=0.55)
    s.master = dict(lufs=-14.0, glue_ratio=1.5)
    b = Battle(s, calm_lufs=-17.0, full_lufs=-14.0)
    b.section('intro', INTRO, chart('Gm:16')).section('A1', A1, CH_A).section('B1', B1, CH_B)
    b.section('A2', A2, CH_A).section('C', C, CH_C).section('B2', B2, CH_B)

    # ================================================================ the Voices
    # four of them in the full mix; the court's prayer is one in the calm
    voices(b, A1, CHANT_A, 'mf')
    voices(b, B1, CHANT_B, 'mf')
    voices(b, A2, CHANT_A, 'f')
    voices(b, B2, CHANT_B, 'f')
    # C: the circle tightens. The cell is a semitone higher each time (the
    # fourth below, the octaves, follow it); eight bars, four cells
    for k in range(4):
        for i, (t, inst, role) in enumerate(VOICES):
            p = b.part(f'v{i + 1}', inst, layer='full', role=role, humanize_ms=14,
                       vel_jitter=0.06)
            p.at(C + 2 * k).play('@f ' + CELL, transpose=t + k)
    # calm: one Voice, the line alone
    one = b.part('c_voice', 'choir', layer='calm', role='lead', humanize_ms=14, vel_jitter=0.06)
    one.at(INTRO + 2).play('@mp Bb3h C4h | D4h Eb4h |')
    for bar, text in ((A1, CHANT_A), (B1, CHANT_B), (A2, CHANT_A), (B2, CHANT_B)):
        one.at(bar).play('@mf ' + text)
    for k in range(4):
        one.at(C + 2 * k).play('@mf ' + CELL, transpose=k)
    # the same single Voice opens the full mix, an octave down, before the rest join
    iv = b.part('i_voice', 'oohs', layer='full', role='lead', humanize_ms=14)
    iv.at(INTRO + 2).play('@mp Bb3h C4h | D4h Eb4h |')

    # a celesta an octave above the top Voice (cold light on the line), and in C a
    # triangle on each cell's first beat
    ces = b.part('ces', 'celesta', role='accent', gain=-1, calm_db=-4)
    for bar, text in ((A1, CHANT_A), (B1, CHANT_B), (A2, CHANT_A), (B2, CHANT_B)):
        ces.at(bar).play('@mp ' + text, transpose=12)
    for k in range(4):
        ces.at(C + 2 * k).play('@mp ' + CELL, transpose=k + 12)

    # the violins an octave above the top Voice: with the band (the call, the circle,
    # the second climb), and under the first climb only for its held leading tone
    cvn = b.part('chant_vn', 'violins', layer='full', role='lead2', gain=0)
    for bar, text in ((A2, CHANT_A), (B2, CHANT_B)):
        cvn.at(bar).play('%sus @mf ' + text, transpose=12)
    cvn.at(B1 + 4).play('%sus @mf F#5w~ | F#5h rh |', transpose=12)
    for k in range(4):
        cvn.at(C + 2 * k).play('@f ' + CELL, transpose=k + 12)
    cvn.expr((B1 + 4, 0.6), (B1 + 5.4, 1.0), (A2, 0.9), (B2 + 4, 0.8), (B2 + 5.4, 1.0))

    # ================================================================ drones and the falling ostinato
    pc = b.part('p_cb', 'basses', role='low', art='sus', calm_db=0)
    pv = b.part('p_vc', 'celli', role='low', art='sus', calm_db=0)
    psub = b.part('p_sub', 'sub', layer='full', role='sub')
    # (held to the end of the climb; bars 19-20 and 43-44 are the hole)
    for bar, ch in ((A1, CH_A), (A2, CH_A), (C, CH_C)):
        bass(pc, bar, ch, 'w', 'b', floor=24, vel=0.7, art='sus')
        bass(pv, bar, ch, 'w', 'b', floor=36, vel=0.68, art='sus')
        bass(psub, bar, ch, 'w', 'b', floor=26, vel=0.6)
    for bar in (B1, B2):
        bass(pc, bar, CH_B[:5], 'w', 'b', floor=24, vel=0.7, art='sus')   # through bar 18
        bass(pv, bar, CH_B[:5], 'w', 'b', floor=36, vel=0.68, art='sus')
        bass(psub, bar, CH_B[:5], 'w', 'b', floor=26, vel=0.6)
        # (D5:8 is the fifth chord: written above for 17-18 only)
    # the hole: a low D and nothing else (the downlifter falls through it)
    hole = b.part('hole_cb', 'basses', role='low', art='soft', calm_db=0)
    holev = b.part('hole_vc', 'celli', role='low', art='soft', calm_db=0)
    for bar in (B1, B2):
        hole.at(bar + 6).play('@p D1w | D1w |')
        holev.at(bar + 6).play('@pp D2w | D2w |')
    # intro: the drone alone
    icb = b.part('i_cb', 'basses', role='low', art='trem', calm_db=0)
    icb.at(INTRO).play('@p G1w~ | G1w~ | G1w~ | G1w |')
    icb.expr((INTRO, 0.3), (INTRO + 2.9, 1.0), (INTRO + 3, 0.95))
    ivc = b.part('i_vc', 'celli', role='low', art='trem', calm_db=0)
    ivc.at(INTRO).play('@p [G2 D3]w~ | [G2 D3]w~ | [G2 D3]w~ | [G2 D3]w |')
    ivc.expr((INTRO, 0.3), (INTRO + 2.9, 1.0), (INTRO + 3, 0.95))

    # the falling ostinato: three-eighth cells that descend the chord (violas
    # and celli, spiccato). A cell does not fit the bar, so it never lands on
    # the beat; it starts over only where the chord changes
    ova = b.part('o_va', 'violas', layer='full', role='ostinato', art='spic', pan=0.15)
    ovc = b.part('o_vc', 'celli', layer='full', role='ostinato', art='spic')
    ovn = b.part('o_vn', 'violins2', layer='full', role='ostinato', art='spic', pan=-0.3, gain=2)
    for bar, ch in ((A1, CH_A), (B1, CH_B[:5]), (A2, CH_A)):
        ostinato(ova, bar, ch, 'e e e', '2 1 0', lo=55, hi=70, vel=0.5)
    # (the second half of B's climb leaves the ostinato only the bars it can fill)
    for bar, ch in ((A2, CH_A),):
        ostinato(ovc, bar, ch, 'e e e', '2 1 0', lo=43, hi=58, vel=0.56)
    ostinato(ovc, B2, CH_B[:5], 'e e e', '2 1 0', lo=43, hi=58, vel=0.56)
    ostinato(ova, B2, CH_B[:5], 'e e e', '2 1 0', lo=55, hi=70, vel=0.56)
    # (the violins take the cell an octave and a half above, from the second call)
    ostinato(ovn, A2, CH_A, 'e e e', '2 1 0', lo=64, hi=79, vel=0.5)
    ostinato(ovn, B2, CH_B[:5], 'e e e', '2 1 0', lo=64, hi=79, vel=0.52)
    # C: in sixteenths now, the cell still three notes long
    ostinato(ova, C, CH_C, 's s s', '2 1 0', lo=55, hi=72, vel=0.56)
    ostinato(ovn, C, CH_C, 's s s', '2 1 0', lo=64, hi=82, vel=0.56)
    ostinato(ovc, C, CH_C, 'e e e', '2 1 0', lo=43, hi=58, vel=0.6)

    # ================================================================ brass and the band
    # horns under the line and trombones on the fourth below it: the Voices
    # doubled, from the second call
    for bar, text, dyn in ((A2, CHANT_A, 'mf'), (B2, CHANT_B, 'f')):
        hn = b.part('hn_line', 'horns', layer='full', role='lead2', pan=-0.2, gain=-2)
        hn.at(bar).play(f'@{dyn} ' + text, transpose=-12)
        tb = b.part('tbn_line', 'trombones', layer='full', role='section', gain=-3)
        tb.at(bar).play(f'@{dyn} ' + text, transpose=-24)
    for k in range(4):
        hn = b.part('hn_line', 'horns')
        hn.at(C + 2 * k).play('@f ' + CELL, transpose=k - 12)
        tb = b.part('tbn_line', 'trombones')
        tb.at(C + 2 * k).play('@f ' + CELL, transpose=k - 24)
    ebs = b.part('ebass', 'rbass', layer='full', role='bass', duck='kit_kick')
    for bar, ch in ((A2, CH_A), (C, CH_C)):
        bass(ebs, bar, ch, 'e e e e e e e e', 'b b b b b b b b', floor=29, vel=0.74,
             accents='> - - > - - > -')
    bass(ebs, B2, CH_B[:5], 'e e e e e e e e', 'b b b b b b b b', floor=29, vel=0.74,
         accents='> - - > - - > -')
    # (the bass guitar plays eighths; the grouping is the kit's and the toms')
    timp = b.part('timp', 'timpani', role='timp', calm_db=-8)
    for bar in (A1, A2):
        timp.at(bar).play('%default @mf G2q rq rh | rw | rw | rw | Eb2q rq rh | rw | D2q rq rh | rw |')
    for bar in (B1, B2):
        timp.at(bar).play('%default @mf G2q rq rh | rw | rw | rw |')
        timp.at(bar + 4).play('%roll @f D2w~ | D2h rh |')
    for k, root in enumerate(('G2', 'Ab2', 'A2', 'Bb2')):
        timp.at(C + 2 * k).play('%default @f ' + root + 'q rq ' + root + 'e ' + root + 'e rq | '
                                + root + 'q rq rh |')
    ti = b.part('timp_i', 'timpani', role='timp', calm_db=-8)
    ti.at(INTRO).play('%roll @p G2w~ | G2w |')
    ti.expr((INTRO, 0.25), (INTRO + 1.95, 1.0))
    ti.at(INTRO + 2).play('%default @mf G2q rq G2q rq | G2q rq D2q D2q |')

    # ================================================================ the fall
    # the climb's last note held and cut at beat 3 of its second bar; then a
    # downlifter dropping two octaves (the words falling) and a low D
    for bar in (B1, B2):
        fall = b.part('fall', 'downlifter', layer='full', role='fx', gain=2)
        fall.at(bar + 5.5).note(s.bar(bar + 5.5), 'D5', 6.0, vel=0.8)
    for bar in (B1, B2):
        boom = b.part('boom', 'boom', layer='full', role='accent', gain=0)
        boom.at(bar + 7).note(s.bar(bar + 7), 'D1', 4.0, vel=0.85)

    # ================================================================ percussion
    perc = b.part('perc', 'orch_perc', role='accent', calm_db=-6)
    for bar in (INTRO + 2, INTRO + 3):
        drums(perc, bar, {'log_lo': 'x...x...'}, step=0.5, vel=0.55)
    for bar in range(A1, B1):
        drums(perc, bar, {'log_lo': 'x.......x.......', 'log_hi': '...x..x..x..x.x.'}, vel=0.55)
    for bar in range(B1, B1 + 6):
        drums(perc, bar, {'log_lo': 'x.......x.......', 'log_hi': '...x..x..x..x.x.'}, vel=0.6)
    for bar in range(A2, A2 + 8):
        drums(perc, bar, {'log_hi': RITE}, vel=0.55)
    for bar in range(B2, B2 + 6):
        drums(perc, bar, {'log_hi': RITE}, vel=0.55)
    for bar in (A1, B1, A2, C, B2):
        drums(perc, bar, {'gong': 'x', 'bd': 'x'}, vel=0.8)
    drums(perc, INTRO, {'bowed': 'x'}, vel=0.6)
    for bar in range(C, C + 8, 2):
        drums(perc, bar, {'tri': 'x...........x...', 'bell_tree': 'x'}, vel=0.5)
    for bar in (A1, A2, B1, B2):
        drums(perc, bar + 4, {'tri': 'x'}, vel=0.5)

    kit = Kit(s, 'kit')
    b.kit = kit
    b.full_only.update(kit.names())
    for i in range(8):
        kit.play(A1 + i, RITE_FILL if i % 4 == 3 else RITE_TOM, vel=0.62)
    for i in range(6):
        kit.play(B1 + i, RITE_FILL if i % 4 == 3 else RITE_TOM, vel=0.62 + 0.03 * i)
    kit.play(B1 + 6, {'kick': 'x...............'}, vel=0.5)   # the floor takes the rest
    for i in range(8):
        kit.play(A2 + i, RITE_BAND_FILL if i % 4 == 3 else RITE_BAND, vel=0.74)
    for i in range(8):
        kit.play(C + i, RING_FILL if i % 2 == 1 else RING, vel=0.78 + 0.01 * i)
    for i in range(6):
        kit.play(B2 + i, RITE_BAND_FILL if i % 4 == 3 else RITE_BAND, vel=0.78 + 0.02 * i)
    for bar in (A2, C, B2):
        kit.play(bar, {'crash': 'X'})

    # ================================================================ calm bed
    # calm: the falling cell on a harp (the ostinato's own, plucked) and a flute
    # a ninth above the one Voice in the circle's tightening
    hp = b.part('c_harp', 'harp', layer='calm', role='accent', gain=3)
    for bar, ch in ((A1, CH_A), (B1, CH_B[:5]), (A2, CH_A), (B2, CH_B[:5])):
        ostinato(hp, bar, ch, 'e e e', '2 1 0', lo=60, hi=79, vel=0.5)
    ostinato(hp, C, CH_C, 'e e e', '2 1 0', lo=60, hi=79, vel=0.52)
    # and a triangle, far off, on the rite's own pulse
    ctri = b.part('c_tri', 'orch_perc', layer='calm', role='accent', gain=2, pan=0.35)
    for bar in list(range(A1, B1 + 6)) + list(range(A2, B2 + 6)):
        drums(ctri, bar, {'tri': RITE}, vel=0.32)
    cfl = b.part('c_flute', 'flute', layer='calm', role='lead2', gain=-3)
    for k in range(4):
        cfl.at(C + 2 * k).play('@mp ' + CELL, transpose=k + 12)
    for sec in ('A1', 'A2'):
        b.calm_bed(sec, piano='0 2 0 2', pad_n=2)
    b.calm_bed('C', piano='0 2 0 2', pad_n=2)
    for sec in ('B1', 'B2'):
        cp = b.part('c_pno', 'grand', layer='calm', role='keys')
        arp(cp, b.bar(sec), CH_B[:5], '0 2 0 2', step=1.0, lo=48, hi=75, vel=0.46,
            accent_every=2, accent=0.08)
    return b.finish()
