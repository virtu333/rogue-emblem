"""The Entity — "· · ·".

It does not speak and it has no theme. A hum on D and E-flat (a semitone
that never resolves), a heartbeat, a choir whose clusters drift like weather,
and the Thread played backwards (A-E-D-A: Sera's line unwound). The pulse
tightens into a col legno-like ostinato, the brass swell in clusters, the
reversed thread is shouted by everyone, and then everything stops for two
beats, as if the thing below the world breathed in.
"""

from engine.patterns import Kit, chart, drums, ostinato
from engine.score import Score

from scores._battle import Battle

KEY = 'music_boss_entity'

UNTHREAD = 'A5q E5q D5q A4q'


def build():
    s = Score('boss_entity', bpm=90, intro_bars=4, loop_bars=32, title='· · ·', seed=113)
    s.reverb = dict(rt60=4.5, predelay_ms=40, wet_db=2.0, damp=0.5)
    s.master = dict(lufs=-14.5, glue_ratio=1.5, lead_duck=0)
    b = Battle(s, full_lufs=-14.5, adaptive=False)
    A, B, C, D = 5, 13, 21, 29
    for name, bar in (('A', A), ('B', B), ('C', C), ('D', D)):
        b.section(name, bar, chart('Dm Dm Dm Dm Dm Dm Dm Dm'))

    # the hum
    hum = b.part('hum', 'drone', role='fx', gain=3)
    hum.at(1).play('@mf D1w~ | D1w~ | D1w~ | D1w |')
    for bar in range(A, D + 8, 4):
        hum.at(bar).play('@f D1w~ | D1w~ | D1w~ | D1w |')
    hum.expr((1, 0.2), (5, 0.8), (13, 1.0), (29, 1.0), (36.4, 1.0), (36.5, 0.0), (36.99, 0.0))
    cl = b.part('cluster_cb', 'basses', role='low', art='trem')
    for bar in range(A, D + 8, 2):
        cl.at(bar).play('@mf [D2 Eb2]w~ | [D2 Eb2]w |')
    cl.expr((5, 0.5), (13, 0.8), (29, 1.0), (36.4, 1.0), (36.5, 0.0), (36.99, 0.0))

    # heartbeat
    kit = Kit(s, 'kit', gains={'kick': 2, 'toms': 0})
    for bar in range(1, D + 8):
        if bar == D + 7:
            kit.play(bar, {'kick': 'x.....x.........'}, vel=0.9)
            continue
        beat = {'kick': 'x.....x.........'} if bar < B else \
               {'kick': 'x.....x.x.......', 'tom_lo': '..x.......x...x.'}
        kit.play(bar, beat, vel=0.72 if bar < B else 0.82)
    taiko = b.part('taiko', 'taiko', role='accent')
    for bar in range(B, D + 7):
        taiko.at(bar).play('@f D2q rq rq D2e D2e |' if bar % 2 else '@f D2q rq D2q rq |')

    # choir weather: slow drifting clusters
    oohs = b.part('choir_oohs', 'oohs', role='choir')
    drift = ['[D4 Eb4 A4]', '[C#4 D4 G#4]', '[D4 E4 Bb4]', '[Eb4 F4 A4]']
    for i, bar in enumerate(range(1, D + 8, 2)):
        oohs.at(bar).play(f'@mf {drift[i % 4]}w~ | {drift[i % 4]}w |')
    oohs.expr((1, 0.3), (5, 0.7), (21, 1.0), (36.4, 1.0), (36.5, 0.0), (36.99, 0.0))
    aahs = b.part('choir_aahs', 'choir', role='lead')
    aahs.at(C).play('@ff ' + ' | '.join(['A4w', 'E4w', 'D4w', 'A3w'] * 2) + ' |')
    aahs.at(D).play('@ff ' + ' | '.join(['A4h E4h', 'D4h A3h'] * 3) + ' | A4w | rw |')

    # the thread, unwound
    glass = b.part('glass', 'celesta', role='accent')
    for bar in (A + 1, A + 5, B + 3, B + 7):
        glass.at(bar).play(f'@mf {UNTHREAD} |')
    rev = b.part('rev', 'reverse', role='fx')
    for bar in (A + 3, B + 3, C + 3, C + 7):
        rev.note(s.bar(bar), 60, 4, vel=0.8)
    tpt = b.lead('C', 'A4w | E4w | D4w | A3w | A4w | E4w | D4w | A3w |', inst='trumpets',
                 dyn='ff', name='unthread_tpt', role='lead2')
    hn = b.lead('C', 'A3w | E3w | D3w | A2w | A3w | E3w | D3w | A2w |', inst='horns',
                dyn='ff', name='unthread_hn', role='lead2')
    b.lead('D', 'A5h E5h | D5h A4h | A5h E5h | D5h A4h | A5h E5h | D5h A4h | A5w | rw |',
           inst='violins', dyn='ff', name='unthread_vn', role='lead')

    # the pulse tightens
    col = b.part('col_legno', 'celli', role='ostinato', art='spic')
    for bar in range(B, D + 7):
        col.at(bar).play('@f D3e Eb3e D3e Eb3e D3e Eb3e D3e Eb3e |')
    vla = b.part('vla_trem', 'violas', role='pad', art='trem')
    for bar in range(C, D + 7, 2):
        vla.at(bar).play('@f [A3 Bb3]w~ | [A3 Bb3]w |')
    hi = b.part('vn_high', 'violins2', role='pad', art='trem')
    for bar in range(A, D + 7, 4):
        hi.at(bar).play('@p [D6 Eb6]w~ | [D6 Eb6]w~ | [D6 Eb6]w~ | [D6 Eb6]w |')
    hi.expr((5, 0.3), (21, 0.8), (29, 1.0), (36.4, 1.0), (36.5, 0.0), (36.99, 0.0))

    # brass cluster swells
    tbn = b.part('brass_cluster', 'trombones', role='pad')
    tuba = b.part('tuba', 'tuba', role='low')
    for bar in range(B, D + 7, 4):
        tbn.at(bar).play('@f [D3 Eb3 A3]w~ | [D3 Eb3 A3]w | rw | rw |')
        tuba.at(bar).play('@f D2w~ | D2w | rw | rw |')
    tbn.expr((B, 0.2), (B + 1.9, 1.0), (B + 2, 0.0), (B + 4, 0.2), (B + 5.9, 1.0), (B + 6, 0.0),
             (C, 0.3), (C + 1.9, 1.0), (C + 2, 0.0), (C + 4, 0.3), (C + 5.9, 1.0), (C + 6, 0.0),
             (D, 0.4), (D + 1.9, 1.0), (D + 2, 0.0), (D + 4, 0.4), (D + 5.9, 1.0), (D + 6, 0.0))

    timp = b.part('timp', 'timpani', role='timp')
    timp.at(D - 1).play('%roll @p D2w |')
    timp.expr((D - 1, 0.2), (D - 0.05, 1.0), (D, 1.0))
    timp.at(D).play('%default @ff D2q rq Eb2q rq |' * 6 + ' D2q D2q D2q D2q | D2q rq rh |')
    perc = b.part('perc', 'orch_perc', role='accent')
    for bar in (A, B, C, D):
        drums(perc, bar, {'gong': 'x', 'bd': 'x'}, vel=0.8)
    drums(perc, D - 2, {'swell_l': 'x'}, vel=0.7)
    # the inhale: silence at the end of the last bar (everything above is gated there)
    boom = b.part('boom', 'boom', role='accent')
    for bar in (A, C, D):
        boom.note(s.bar(bar), 26, 1, vel=0.9)
    return b.finish()
