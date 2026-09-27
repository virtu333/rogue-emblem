"""Write melody_notes.md: section timings, chords per bar, lyric under note."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..', '..')))
from paths import OUT_DIR  # noqa: E402
import melody as M  # noqa: E402

SPB = 60 / M.BPM
NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
FLATS = {'C#': 'Db', 'D#': 'Eb', 'F#': 'Gb', 'G#': 'Ab', 'A#': 'Bb'}


def name(p, flat=False):
    n = NAMES[p % 12]
    if flat and n == 'C#':
        n = 'Db'
    return f'{n}{p // 12 - 1}'


def dur(d):
    return {0.25: 's', 0.5: 'e', 0.75: 'e.', 1.0: 'q', 1.5: 'q.', 2.0: 'h', 2.5: 'h+e',
            3.0: 'h.', 4.0: 'w'}.get(d, f'{d:g}b')


def ts(beat):
    t = beat * SPB
    return f'{int(t // 60)}:{t % 60:05.2f}'


notes = M.notes()
lines = ['# 欠けた太陽 (The Broken Sun) — lead sheet', '',
         f'150 BPM, 4/4 (one beat = {SPB:.2f} s, one bar = {4 * SPB:.2f} s). E minor; the tag '
         '(bar 49 on, beat 192, 1:16.80) is a semitone up, F minor.',
         'Beats are absolute from the start of the song file (bar 1 beat 1 = beat 0 = 0:00). '
         'One note per mora (っ and ん and long vowels have their own notes). '
         'Durations: e = eighth, q = quarter, q. = dotted quarter, h = half.', '',
         '## Form', '', '| Section | Bars | Beats | Time |', '|---|---|---|---|']
for nm, a, b in M.SECTIONS:
    lines.append(f'| {nm} | {a}-{b} | {(a - 1) * 4}-{b * 4} | {ts((a - 1) * 4)}-{ts(b * 4)} |')
lines += ['', 'The band cuts off on its last hit, bar 56 beat 1 (beat 220, 1:28.00); the last sung '
          'note (い, the leading tone E5) stops with it at beat 220.5. The files end at 1:28.90 '
          '(0.7 s of room after the hit, faded over the last 0.3 s).', '',
          'Files: `instrumental/anime_op.mp3` (full, lead guitar on the melody) and '
          '`instrumental/anime_op_backing.mp3` (the same mix without the lead and its violin '
          'double, for a sung version; same timeline, about 1.1 dB quieter).', '',
          '## Chords per bar', '']
row = []
for bar in range(1, 57):
    row.append(f'{bar}: {M.CHORDS[bar]}')
    if bar % 8 == 0:
        lines.append(' | '.join(row) + '  ')
        row = []
lines += ['', '## Melody, lyric under note', '',
          'Each line: `bar:beat` (beat 1-based within the bar), pitch, duration, mora.', '']
by_bar = {}
for t, d, p, m in notes:
    by_bar.setdefault(int(t // 4) + 1, []).append((t, d, p, m))
lyr_lines = {
    9: '灰の降る街で 目を覚ました', 12: '昨日の続きを 誰も覚えてない', 16: '崩れた旗の下 冷えた指先',
    20: 'それでも君は 前を見ていた', 25: '見えない明日を 見つめる瞳が',
    29: '暗闇の中で ただひとつ 灯ってた', 32: '欠けた太陽を 背にして走れ',
    36: 'ほどけそうな 金の糸を握って', 39: '何度倒れても 何度でも',
    42: '名もない夜明けを 奪いに行け', 48: '(tag, +1) 名もない夜明けを 奪いに行け',
    53: 'まだ 終わらない'}
for bar in sorted(by_bar):
    if bar in lyr_lines:
        lines += ['', f'**{lyr_lines[bar]}**', '']
    ch = M.CHORDS[bar]
    cells = [f'{name(p, bar >= 49)} {dur(d)}' for t, d, p, m in by_bar[bar]]
    morae = [m for *_, m in by_bar[bar]]
    pos = [f'{t - (bar - 1) * 4 + 1:g}' for t, *_ in by_bar[bar]]
    lines.append(f'- bar {bar} [{ch}] ({ts((bar - 1) * 4)}): ' + '  '.join(
        f'{ps}:{c}/{mo}' for ps, c, mo in zip(pos, cells, morae)))
lines += ['', '## Notes', '',
          '- The sabi opens on the Thread (B-E-F#-B, scale degrees 5-1-2-5) on か-け-た-た, '
          'the last B pushed an eighth ahead of the barline onto the IV chord (Cmaj7 colour).',
          '- The verse riff under the A-melo is the Empire drill: E-E-E-F | E-E-D-D, falling to C.',
          '- まだ 終わらない climbs Bb-C-Db-Eb-E and holds the leading tone E over C major; the '
          'band cuts it off on bar 56\'s downbeat, and nothing resolves to F (the Hollow Sun).',
          '- Syncopation: most phrase-leading long notes arrive an eighth early (beat 4&) and '
          'tie over the barline.', '- Range: B3-G5.']
with open(os.path.join(OUT_DIR, 'melody_notes.md'), 'w') as f:
    f.write('\n'.join(lines) + '\n')
print('wrote melody_notes.md')
