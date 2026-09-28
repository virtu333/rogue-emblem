"""Round 2 section for melody_notes.md, prepended to the round-1 lead sheet."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..', '..')))
import leadsheet as L  # noqa: E402  (writes the round-1 sheet on import)
from paths import OUT_DIR  # noqa: E402
import melody as M  # noqa: E402

ts, name, dur = L.ts, L.name, L.dur
r2 = ['## Round 2: J-rock x EDM (`instrumental/round2/`)', '',
      'Same tempo, meter and timeline (56 bars, 150 BPM, files 1:28.90). The sung line is '
      '`melody_v2.json`: identical to `melody.json` except that the tag\'s repeated line '
      '(名もない夜明けを 奪いに行け, bar 48 beat 4 to bar 52) is gone. Bars 49-52 are now a '
      'four-bar vocal-chop drop in F minor (`chops.json`). The Hollow Sun outro (まだ 終わらない) '
      'is unchanged.', '',
      '| Section | Bars | Beats | Time | What the arrangement does |', '|---|---|---|---|---|']
DESC = {
    'Intro (filtered kime, then the hook)': 'band kime under a low-pass opening from 300 Hz; '
    'noise riser; impact on bar 5; the hook with a pumping supersaw stack and 808',
    'A-melo': 'clean arps plus a sixteenth-note pluck arp (its filter opening); A2 adds the '
    '808 and a pad',
    'B-melo (half time; bar 32 the build)': 'downlifter into half time; pad and pluck sweep '
    'open; bar 32 = one-bar accelerating snare roll (8ths, triplets, 16ths, sextuplets) and a '
    'riser, the vocal pickup か-け-た-た over it',
    'Sabi': 'impact on the downbeat; band plus supersaw stack and pad pumping on every '
    'quarter; 808 ducked under the kick; bar 48 = C5 hit, accelerating roll, silence from '
    'beat 4.5',
    'Drop: vocal chops (+1, F minor)': 'beat drop on bar 49 (impact): half-time drums with a '
    'trap hat, future-bass wobble chords (8th-triplet filter LFO, pitch scoop) on Db Eb Cm '
    'Fm(add9), the band rings a chord a bar; the chops sit on top (no sung line)',
    'Outro (Hollow Sun)': 'downlifter out of the drop; まだ 終わらない climbs to E and the band '
    '(with an impact) cuts on bar 56 beat 1',
}
for nm, a, b in M.SECTIONS_V2:
    r2.append(f'| {nm} | {a}-{b} | {(a - 1) * 4}-{b * 4} | {ts((a - 1) * 4)}-{ts(b * 4)} | '
              f'{DESC[nm]} |')
r2 += ['', '### The chop drop (bars 49-52, F minor: Db | Eb | Cm | Fm(add9))', '',
       '`pitch` is the sounding pitch (MIDI). The fx are suggestions: stutter = retrigger in '
       '16ths or 32nds; gate = chopped short; pitch_up = an octave-up layer or a scoop; '
       'formant_shift = a formant-shifted copy; reverse = reversed, ending on the next beat. Bars '
       '49 and 51 open on the Thread in F minor (C-F-G-C on か-け-た-た); bar 52 climbs なんどでも '
       'to C6, and a reversed ま swells into the outro\'s まだ (same pitch, C5). In '
       '`anime_op_edm.mp3` the lead guitar plays this line; the backing leaves it empty for the '
       'chops.', '']
for t, d, p, m, fx in M.chop_notes():
    bar = int(t // 4) + 1
    r2.append(f'- bar {bar} beat {t - (bar - 1) * 4 + 1:g} (abs {t:g}, {ts(t)}): '
              f'{name(p, True)} {dur(d)} {m}' + (f' [{", ".join(fx)}]' if fx else ''))
r2 += ['', '---', '', '## Round 1 lead sheet (the melody is unchanged; round 2 drops the tag line)',
       '']
path = os.path.join(OUT_DIR, 'melody_notes.md')
lines = open(path).read().split('\n')
out = lines[:2] + r2 + lines[2:]
with open(path, 'w') as f:
    f.write('\n'.join(out))
print('wrote melody_notes.md with round 2')
