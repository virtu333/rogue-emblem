"""The Entity — "· · ·".

It does not speak, sing or proclaim, and it has no theme: it is a hole in
the music. A hum on D with its semitone shadow (E-flat), a heartbeat that
keeps losing beats, and fragments of the Thread with notes missing. Across
the loop it takes more away, in three stages:

  A   the answer is missing: the celesta gives the Thread's first two notes
      (reversed: A, E) and nothing replies;
  B   the downbeat is missing: the pulse (a D-Eb col legno and the
      heartbeat) keeps going, but every bar starts late;
  C   only an inner note is left: E, the middle of the Thread chord, alone.
  D   the one clear statement is the player's: a single violin plays the
      whole Thread (A-D-E-A), once, softly. Nothing answers it.

No choir, no brass proclamation, no drop, and it sits well under the battle
themes' loudness: in its presence the orchestra thins out. The hum never
stops, so the silences are never mistaken for the music failing. When it
enrages it takes away even the pulse, the glass and the player's line.
"""

from engine.patterns import Kit, chart, drums
from engine.score import Score

from scores._battle import Battle

KEY = 'music_boss_entity'


def build():
    s = Score('boss_entity', tonic='D', bpm=84, intro_bars=4, loop_bars=32, title='· · ·',
              seed=113)
    s.reverb = dict(rt60=4.5, predelay_ms=40, wet_db=2.0, damp=0.5)
    s.master = dict(lufs=-19.0, glue_ratio=1.3, lead_duck=0)
    b = Battle(s, full_lufs=-19.0, adaptive=False)
    A, B, C, D = 5, 13, 21, 29
    END = D + 8
    for name, bar in (('A', A), ('B', B), ('C', C), ('D', D)):
        b.section(name, bar, chart('Dm Dm Dm Dm Dm Dm Dm Dm'))

    # ---------------------------------------------------------------- the hole
    hum = b.part('hum', 'drone', role='fx', gain=2)
    for bar in range(1, END, 4):
        hum.at(bar).play('@mf D1w~ | D1w~ | D1w~ | D1w |')
    cl = b.part('cluster_cb', 'basses', role='low', art='trem')
    for bar in range(1, END, 2):
        cl.at(bar).play('@p [D2 Eb2]w~ | [D2 Eb2]w |')
    cl.expr((1, 0.3), (A, 0.6), (C, 0.8), (D, 0.5))
    hi = b.part('vn_high', 'violins2', role='pad', art='trem')
    for bar in range(C, END, 4):
        hi.at(bar).play('@pp [D6 Eb6]w~ | [D6 Eb6]w~ | [D6 Eb6]w~ | [D6 Eb6]w |')
    va = b.part('vla_shadow', 'violas', role='pad', art='trem')
    for bar in range(C, D, 2):
        va.at(bar).play('@pp [A3 Bb3]w~ | [A3 Bb3]w |')
    perc = b.part('perc', 'orch_perc', role='accent')
    drums(perc, A, {'gong': 'x'}, vel=0.45)

    # ---------------------------------------------------------------- the heartbeat, losing beats
    kit = Kit(s, 'kit', gains={'kick': 0})
    for bar in range(1, END):
        if bar < B:          # a heartbeat that forgets its second beat every fourth bar
            beat = 'x..x............' if bar % 4 else 'x...............'
        elif bar < C:        # every bar starts late
            beat = '..x..x..........'
        elif bar < D:        # thinning: every other bar
            beat = '..x..x..........' if bar % 2 else '................'
        else:                # almost gone
            beat = 'x...............' if bar % 2 else '................'
        if 'x' in beat:
            kit.play(bar, {'kick': beat}, vel=0.7)

    # ---------------------------------------------------------------- the pulse, without its downbeat
    col = b.part('col_legno', 'celli', role='ostinato', art='spic')
    for bar in range(B, D):
        col.at(bar).play('@mf re Eb3e D3e Eb3e D3e Eb3e D3e Eb3e |')
    col.expr((B, 0.5), (C, 0.9), (D - 1, 0.6))

    # ---------------------------------------------------------------- the Thread, with notes missing
    glass = b.part('glass', 'celesta', role='accent')
    for bar in (A + 1, A + 5):
        glass.at(bar).play('@mf A5q E5q rh |')            # A: no answer
    for bar in (B + 3, B + 7):
        glass.at(bar).play('@mf rq E5q D5q rq |')          # B: enters late, ends early
    for bar in range(C + 1, D, 2):
        glass.at(bar).play('@mp rh E5q rq |')              # C: only the inner note

    # ---------------------------------------------------------------- the player's light
    player = b.part('player', 'solo_violin', role='lead')
    player.at(D + 2).play('@mf A4h D5q E5q | A5w |')
    player.expr_beats((s.bar(D + 2), 0.7), (s.bar(D + 3), 1.0), (s.bar(D + 4), 0.6))

    # when it enrages it takes away the pulse, the glass and the player's line
    b.extra_variant('enrage_entity', mute=['kit_*', 'col_legno', 'glass', 'player'], lufs=-22.0)
    return b.finish()
