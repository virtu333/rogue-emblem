"""Rest / church — "Liturgy of the Spent Name".

The old faith's hymn, kept by the seer order. Its first phrase closes
properly on F. Its second phrase climbs to the place where the goddess's
name would be sung... and the choir stops: a bar of silence and one bell,
because the name was spent. A solo cello carries the tune between verses.
"""

from engine.patterns import arp, chart, drums, pad, pad_under
from engine.score import Score

KEY = 'music_rest'

S1 = """
F4h G4h | A4h. G4q | F4q G4q A4q Bb4q | C5w |
D5h C5h | Bb4q A4q G4h | A4q Bb4q C5q E4q | F4w |
"""
S2 = """
A4h C5h | D5h. C5q | Bb4q A4q G4q F4q | G4w |
A4h Bb4h | C5h D5h | C5q Bb4q A4q G4q | rw |
"""
CH1 = chart('F:2 C/E:2 F:3 C:1 Dm:1 Gm7:1 F/A:1 Bb:1 Csus4:2 C:2 '
            'Bb:2 F/A:2 Gm:1 F/A:1 C:2 F:1 Bb:1 F/C:1 C7:1 F:4')
CH2 = chart('F:2 Am:2 Bb:3 F:1 Gm:1 F/A:1 C/E:1 Dm:1 C:4 '
            'F:2 Gm:2 F/A:2 Bb:2 F/C:1 C7:1 F:1 C7:1')   # 7 bars: the eighth is silence


def build():
    s = Score('rest', tonic='F', bpm=60, intro_bars=2, loop_bars=40, title='Liturgy of the Spent Name',
              seed=23)
    s.reverb = dict(rt60=4.2, predelay_ms=40, wet_db=1.5, damp=0.5)
    s.master = dict(lufs=-18.0, glue_ratio=1.2, lead_duck=1.0)
    s.tempo(41, 60, ramp_to=52)
    s.tempo(43, 60)
    s.variant('full', {}, lufs=-18.0)
    V1, INTER, V2 = 3, 19, 27

    org = s.part('organ', 'organ', role='pad', gain=-3)
    org.at(1).play('@mp [F3 C4 A4]w~ | [F3 C4 A4]w |')
    pad(org, V1, CH1, n=3, lo=48, hi=67, vel=0.45)
    pad(org, V1 + 8, CH2, n=3, lo=48, hi=67, vel=0.45)
    pad(org, V2, CH1, n=3, lo=48, hi=67, vel=0.5)
    pad(org, V2 + 8, CH2, n=3, lo=48, hi=67, vel=0.5)
    ped = s.part('pedal', 'organ', role='low', gain=-6)
    for bar, ch in ((V1, CH1), (V1 + 8, CH2), (V2, CH1), (V2 + 8, CH2)):
        t = s.bar(bar)
        for c, beats in ch:
            ped.note(t, c.bass_note(36), beats, vel=0.45)
            t += beats

    # verse one: wordless, soft
    sop1 = s.part('sop1', 'oohs', role='lead')
    sop1.at(V1).play('@mp' + S1 + S2)
    atb1 = s.part('atb1', 'oohs', role='choir')
    pad_under(atb1, V1, CH1, sop1, n=3, lo=45, vel=0.42)
    pad_under(atb1, V1 + 8, CH2, sop1, n=3, lo=45, vel=0.42)
    hp = s.part('harp', 'harp', role='keys', gain=-3)
    arp(hp, V1, CH1, '0 1 2 3', step=0.5, lo=53, hi=77, vel=0.4)
    arp(hp, V1 + 8, CH2, '0 1 2 3', step=0.5, lo=53, hi=77, vel=0.4)

    # interlude: the cello sings the first phrase
    vc = s.part('cello', 'celli', role='lead', art='sus')
    vc.at(INTER).play('@mf' + S1, transpose=-12)
    vc.expr((INTER, 0.8), (INTER + 3, 1.0), (INTER + 4, 0.85), (INTER + 7, 1.0), (V2, 0.7))
    str_pad = s.part('strings', 'violins2', role='pad', art='soft')
    pad(str_pad, INTER, CH1, n=2, lo=60, hi=76, vel=0.4, art='soft')
    va = s.part('violas', 'violas', role='pad', art='soft')
    pad(va, INTER, CH1, n=2, lo=53, hi=65, vel=0.4, art='soft')
    cb = s.part('basses', 'basses', role='low', art='soft')
    t = s.bar(INTER)
    for c, beats in CH1:
        cb.note(t, c.bass_note(28), beats, vel=0.42, art='soft')
        t += beats

    # verse two: sung, with strings
    sop2 = s.part('sop2', 'choir', role='lead')
    sop2.at(V2).play('@mf' + S1 + S2)
    atb2 = s.part('atb2', 'choir', role='choir')
    pad_under(atb2, V2, CH1, sop2, n=3, lo=45, vel=0.5)
    pad_under(atb2, V2 + 8, CH2, sop2, n=3, lo=45, vel=0.5)
    vn = s.part('violins', 'violins', role='counter', art='soft')
    vn.at(V2).play('@mp' + S1, transpose=12)
    pad(va, V2, CH1, n=2, lo=53, hi=65, vel=0.42, art='soft')
    pad(va, V2 + 8, CH2, n=2, lo=53, hi=65, vel=0.42, art='soft')

    # the missing name: silence, and one bell (the third, never the root)
    bells = s.part('bells', 'bells', role='accent', gain=-3)
    bells.at(V1 + 15).play('@mp rq A4h. |')
    bells.at(V2 + 15).play('@mp rq A4h. |')
    return s
