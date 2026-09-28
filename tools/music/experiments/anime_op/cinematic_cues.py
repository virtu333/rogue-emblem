"""Cue sheet for the cinematic team, in the format of tools/cutscene/hook/music.py
(cues()): the score is the clock (Score.seconds), no audio analysis.

Writes scratchpad/anime/cinematic/cues_anime_op.json."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
from paths import OUT_DIR  # noqa: E402
OUT = os.path.join(OUT_DIR, 'cinematic')
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..', '..')))

import anime_op_edm as song  # noqa: E402
import melody as M           # noqa: E402

s = song.build()
T = s.seconds
BAR = 4.0


def bt(bar, beat=0.0):
    """Seconds at (1-based bar, 0-based beat)."""
    return round(T(s.bar(bar) + beat), 4)


# ---------------------------------------------------------------- the base format
bars = int(s.intro_bars)
total = s.bar(bars + 1)
cues = {
    'title': '欠けた太陽 (The Broken Sun) — anime OP, round 2 (J-rock x EDM, vocal)',
    'bars': [round(T(s.bar(n)), 6) for n in range(1, bars + 2)],
    'barBeats': [s.bar_len(n) for n in range(1, bars + 2)],
    'beats': [round(T(b), 6) for b in range(int(total) + 1)],
    'sections': {'intro': 1, 'hook': 5, 'verse': 9, 'verse2': 17, 'pre': 25, 'build': 32,
                 'chorus': 33, 'break': 48, 'drop': 49, 'outro': 53, 'cut': 56, 'end': 57},
}


def notes_of(name, pred=lambda n: True):
    return [[round(T(n.start), 4), round(T(n.end) - T(n.start), 4), n.pitch]
            for n in sorted(s.parts[name].notes, key=lambda n: n.start) if pred(n)]


CRASH_KEYS = {49, 57, 55}      # crash, crash2/china, splash (Virtuosity keymap)
parts = {
    'lead': notes_of('lead'),
    'kick': notes_of('kit_kick'),
    'snare': notes_of('kit_snare'),
    'crash': notes_of('kit_cym', lambda n: n.pitch in CRASH_KEYS),
    'impact': notes_of('impact'),
}
# kime: the band's unison hits (strum onsets of the left guitar in the kime bars)
KIME_BARS = {1: 0, 2: 0, 3: 0, 4: 0, 8: 0, 12: 3.0, 16: 3.0, 24: 0, 32: 0, 48: 0,
             49: 0, 50: 0, 51: 0, 52: 0, 53: 0, 54: 0, 56: 0}
onsets = {}
for n in s.parts['gtr_L'].notes:
    bar = int(n.start // BAR) + 1
    if bar in KIME_BARS and n.start - (bar - 1) * BAR >= KIME_BARS[bar] - 1e-6:
        key = round(n.start * 8) / 8          # the strings of one strum together
        onsets[key] = max(onsets.get(key, 0), n.end - n.start)
parts['kime'] = [[round(T(b), 4), round(T(b + d) - T(b), 4), 0] for b, d in sorted(onsets.items())]
cues['parts'] = parts
cues['partsNote'] = ('[time s, duration s, MIDI pitch]. kick/snare/crash/impact pitches are '
                     'drum keys; kime pitch is 0. lead = the lead guitar, which plays the sung '
                     'line and, in bars 49-52, the chop line.')

# ---------------------------------------------------------------- lyrics
ROMA = {
    'あ': 'a', 'い': 'i', 'う': 'u', 'え': 'e', 'お': 'o', 'か': 'ka', 'き': 'ki', 'く': 'ku',
    'け': 'ke', 'こ': 'ko', 'さ': 'sa', 'し': 'shi', 'す': 'su', 'せ': 'se', 'そ': 'so',
    'た': 'ta', 'ち': 'chi', 'つ': 'tsu', 'て': 'te', 'と': 'to', 'な': 'na', 'に': 'ni',
    'ぬ': 'nu', 'ね': 'ne', 'の': 'no', 'は': 'ha', 'ひ': 'hi', 'ふ': 'fu', 'へ': 'he',
    'ほ': 'ho', 'ま': 'ma', 'み': 'mi', 'む': 'mu', 'め': 'me', 'も': 'mo', 'や': 'ya',
    'ゆ': 'yu', 'よ': 'yo', 'ら': 'ra', 'り': 'ri', 'る': 'ru', 'れ': 're', 'ろ': 'ro',
    'わ': 'wa', 'を': 'o', 'ん': 'n', 'が': 'ga', 'ぎ': 'gi', 'ぐ': 'gu', 'げ': 'ge',
    'ご': 'go', 'ざ': 'za', 'じ': 'ji', 'ず': 'zu', 'ぜ': 'ze', 'ぞ': 'zo', 'だ': 'da',
    'ぢ': 'ji', 'づ': 'zu', 'で': 'de', 'ど': 'do', 'ば': 'ba', 'び': 'bi', 'ぶ': 'bu',
    'べ': 'be', 'ぼ': 'bo',
}
# (kanji, kana, English gloss, the image)
LINES = [
    ('灰の降る街で', 'はいのふるまちで', 'In a city where the ash falls', 'the ash city'),
    ('目を覚ました', 'めをさました', 'I woke', 'waking in the ash'),
    ('昨日の続きを', 'きのうのつづきを', 'What came after yesterday', 'a day nobody carried on'),
    ('誰も覚えてない', 'だれもおぼえてない', 'no one remembers', 'the forgotten (the Roll)'),
    ('崩れた旗の下', 'くずれたはたのした', 'Beneath the fallen banner', 'the fallen banner'),
    ('冷えた指先', 'ひえたゆびさき', 'cold fingertips', 'cold hands'),
    ('それでも君は', 'それでもきみは', 'And still, you', 'you'),
    ('前を見ていた', 'まえをみていた', 'were looking ahead', 'looking ahead'),
    ('見えない明日を', 'みえないあしたを', 'At a tomorrow no one can see', 'eyes that see tomorrow'),
    ('見つめる瞳が', 'みつめるひとみが', 'the eyes that gaze', 'eyes that see tomorrow'),
    ('暗闇の中で', 'くらやみのなかで', 'In the dark', 'the dark'),
    ('ただひとつ', 'ただひとつ', 'the only one', 'the one light'),
    ('灯ってた', 'ともってた', 'was alight', 'the one light'),
    ('欠けた太陽を', 'かけたたいようを', 'The broken sun', 'the broken sun'),
    ('背にして走れ', 'せにしてはしれ', 'at your back, run', 'the broken sun at your back'),
    ('ほどけそうな', 'ほどけそうな', 'About to come undone,', 'the gold thread about to unravel'),
    ('金の糸を握って', 'きんのいとをにぎって', 'hold on to the gold thread', 'the gold thread'),
    ('何度倒れても', 'なんどたおれても', 'However many times you fall', 'falling'),
    ('何度でも', 'なんどでも', 'again and again', 'fall again and again'),
    ('名もない夜明けを', 'なもないよあけを', 'A dawn with no name', 'a dawn with no name'),
    ('奪いに行け', 'うばいにいけ', 'go and take it', 'taking the dawn'),
    ('まだ', 'まだ', 'Not yet', 'not over yet'),
    ('終わらない', 'おわらない', 'it isn\'t over', 'not over yet (the Hollow Sun cut)'),
]


def romaji(kana, nxt):
    if kana == 'っ':        # the stop: written as the next consonant
        r = ROMA.get(nxt, '')
        return (r[:1] if r[:2] != 'ch' else 't') if r else ''
    return ROMA[kana]


def syllables(notes):
    out = []
    for i, (t, d, p, m) in enumerate(notes):
        nxt = notes[i + 1][3] if i + 1 < len(notes) else ''
        out.append({'t': round(T(t), 4), 'dur': round(T(t + d) - T(t), 4), 'beat': t,
                    'pitch': p, 'kana': m, 'romaji': romaji(m, nxt)})
    return out


sung = M.notes(tag=False)
sy = syllables(sung)
assert ''.join(x['kana'] for x in sy) == ''.join(k for _, k, _, _ in LINES)
lines, i = [], 0
for kanji, kana, gloss, image in LINES:
    part = sy[i:i + len(kana)]
    i += len(kana)
    if kanji.endswith('君は'):
        part[-1]['romaji'] = 'wa'          # the topic particle は is said "wa"
    lines.append({'text': kanji, 'kana': kana, 'romaji': ' '.join(x['romaji'] for x in part),
                  'gloss': gloss, 'image': image, 'start': part[0]['t'],
                  'end': round(part[-1]['t'] + part[-1]['dur'], 4),
                  'bar': int(part[0]['beat'] // BAR) + 1, 'syllables': part})
cues['lyrics'] = lines
# the guitar-only version (round 1, anime_op.mp3) plays the tag line in bars 49-52 instead
tag = [n for n in M.notes(tag=True) if n not in set(sung)]
cues['guitarVersionTagLine'] = {
    'note': 'anime_op.mp3 (guitar only, round 1): bars 48 b4 - 52 carry the last line again, '
            'a semitone up, instead of the chop drop',
    'text': '名もない夜明けを 奪いに行け', 'syllables': syllables(tag)}

# ---------------------------------------------------------------- hits
hits = []
for n in s.parts['impact'].notes:
    hits.append({'kind': 'impact', 't': round(T(n.start), 4), 'bar': int(n.start // BAR) + 1})
for n in s.parts['riser'].notes:
    hits.append({'kind': 'riser', 't': round(T(n.start), 4), 'end': round(T(n.end), 4),
                 'bar': int(n.start // BAR) + 1})
for n in s.parts['downlifter'].notes:
    hits.append({'kind': 'downlifter', 't': round(T(n.start), 4), 'end': round(T(n.end), 4),
                 'bar': int(n.start // BAR) + 1})
hits += [
    {'kind': 'filter_open', 't': bt(1), 'end': bt(5),
     'note': 'the whole band low-passed from 300 Hz, fully open on bar 5'},
    {'kind': 'build', 't': bt(32), 'end': bt(33), 'note': 'accelerating snare roll into the sabi'},
    {'kind': 'band_stop', 't': bt(32, 1.0), 'note': 'the band stops on the B7 hit; roll and pickup over it'},
    {'kind': 'build', 't': bt(48, 1.0), 'end': bt(48, 3.5), 'note': 'second roll, into the drop'},
    {'kind': 'silence', 't': bt(48, 3.5), 'end': bt(49), 'note': 'half a beat of nothing before the drop'},
    {'kind': 'drop', 't': bt(49), 'note': 'beat drop: impact, F minor, the vocal chops'},
    {'kind': 'hollow_sun_cut', 't': bt(56), 'end': bt(56, 0.5),
     'note': 'the last band hit (C) with the leading tone E held over it; everything stops at '
             'the end; nothing resolves to F'},
]
cues['hits'] = sorted(hits, key=lambda h: h['t'])
cues['chops'] = [{'t': round(T(t), 4), 'dur': round(T(t + d) - T(t), 4), 'beat': t, 'pitch': p,
                  'kana': m, 'romaji': ROMA.get(m, m), 'fx': fx}
                 for t, d, p, m, fx in M.chop_notes()]
cues['audio'] = {
    'anime_op_edm_vocal_mix.mp3': 'the target: round 2, vocal (DiffSinger) + J-rock x EDM; '
                                  'starts at 0:00 = bar 1',
    'anime_op.mp3': 'round 1, guitar only (instrumental, lead guitar on the melody); same '
                    'clock, different bars 49-52 (see guitarVersionTagLine)',
}
os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, 'cues_anime_op.json'), 'w') as f:
    json.dump(cues, f, ensure_ascii=False, separators=(',', ':'))
print('cues: bars', len(cues['bars']), 'lines', len(lines), 'syllables', len(sy),
      'hits', len(hits), 'chops', len(cues['chops']), 'end of bar 56', cues['bars'][-1])
for ln in lines:
    print(f"  {ln['start']:7.3f}-{ln['end']:7.3f}  bar {ln['bar']:2d}  {ln['text']}  {ln['romaji']}")
