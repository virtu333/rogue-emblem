#!/usr/bin/env python3
"""Render "Every Way It Ends" (score.py), mix the narration over it, write the cue sheet.

  python3 tools/cutscene/glass/music.py            # score + narration mix + cues
  python3 tools/cutscene/glass/music.py --cues     # cue sheet only
  python3 tools/cutscene/glass/music.py --mix      # re-mix without re-rendering the score

Outputs (committed; the sample libraries and TTS takes are not in the repo):
  tools/cutscene/glass/far_side.mp3   the score with the narrator's lines laid in at
                                      score.LINES, the music ducked under his voice
  tools/cutscene/glass/cues.json      bar times, sections, each line's time, length
                                      and phrases (from the take), the deaths and cuts
"""

import argparse
import json
import os
import subprocess
import sys
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '../../..'))
# the music engine: this checkout's tools/music, or another checkout's (MUSIC_ENGINE=
# /path/to/tools/music), e.g. the music branch with the house palette
sys.path.insert(0, os.environ.get('MUSIC_ENGINE') or os.path.join(ROOT, 'tools/music'))
sys.path.insert(0, HERE)

import score as sc  # noqa: E402

# which takes: voice/ (draft 1, soft direction) or VOICE_TAKES=voice_cold
VOICE = os.path.join(ROOT, 'References/cutscene/glass', os.environ.get('VOICE_TAKES', 'voice'))
SR = 48000


def ffmpeg():
    return os.environ.get('FFMPEG', 'ffmpeg')


def read_audio(path):
    raw = subprocess.run([ffmpeg(), '-loglevel', 'error', '-i', path, '-f', 'f32le', '-ac', '2',
                          '-ar', str(SR), '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, 2).copy()


# The narrator's voice. He is the Lieutenant, whose motif is shadowed a beat late a
# tritone away (a seer who sees two futures at once), so his voice has that shadow: a
# copy a tritone down, a beat behind, dark and quiet. It is barely there in the myth and
# grows when he speaks of himself. The voice itself is made a little deeper, drier and
# closer (less warmth, more presence, held steady by a compressor).
SHADOW_DB = {'default': -22, 'l16': -15, 'l20': -13, 'l21': -16, 'l22': -18, 'l23': -12,
             'l24': -11}
VOICE_FX = VOICE + '_fx'


def treat(lid):
    src = os.path.join(VOICE, f'{lid}.wav')
    out = os.path.join(VOICE_FX, f'{lid}.wav')
    if os.path.exists(out) and os.path.getmtime(out) > max(os.path.getmtime(src),
                                                            os.path.getmtime(__file__)):
        return out
    os.makedirs(VOICE_FX, exist_ok=True)
    g = SHADOW_DB.get(lid, SHADOW_DB['default'])
    graph = (
        '[0:a]aresample=48000,asplit=2[m][s];'
        '[m]rubberband=pitch=0.955:formant=shifted,highpass=f=80,'
        'equalizer=f=260:t=q:w=1:g=-3,equalizer=f=4500:t=q:w=1.2:g=2,'
        'acompressor=threshold=-24dB:ratio=3:attack=5:release=90:makeup=2[mm];'
        '[s]rubberband=pitch=0.7071:formant=preserved,lowpass=f=2000,highpass=f=90,'
        f'volume={g}dB,adelay=110[ss];'
        '[mm][ss]amix=inputs=2:normalize=0:duration=longest[out]')
    subprocess.run([ffmpeg(), '-y', '-loglevel', 'error', '-i', src, '-filter_complex', graph,
                    '-map', '[out]', '-ac', '1', out], check=True)
    return out


def phrases(path):
    """Spoken phrases of a take: runs of speech split by at least 0.22 s of quiet."""
    w = wave.open(path)
    sr = w.getframerate()
    x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(float) / 32768
    hop = sr // 100
    e = np.array([np.sqrt((x[i:i + hop] ** 2).mean()) for i in range(0, len(x) - hop, hop)])
    on = e > max(0.01, e.max() * 0.06)
    segs, i, n = [], 0, len(on)
    while i < n:
        if not on[i]:
            i += 1
            continue
        j = i
        while j < n:
            k = j
            while k < n and not on[k]:
                k += 1
            if k - j >= 22 or k >= n:
                break
            j = k
            while j < n and on[j]:
                j += 1
        segs.append([round(i / 100, 2), round(j / 100, 2)])
        i = j
    return len(x) / sr, segs


def cues(s):
    bar_t = [round(s.seconds(s.bar(n)), 6) for n in range(1, sc.BARS + 2)]
    lines = {}
    for lid, t in sc.LINES.items():
        f = os.path.join(VOICE, f'{lid}.wav')
        dur, segs = phrases(f) if os.path.exists(f) else (0, [])
        lines[lid] = {'t': t, 'dur': round(dur, 3), 'phrases': segs}
    return {'title': s.title, 'bars': bar_t, 'sections': sc.SECTIONS, 'lines': lines,
            'deaths': sc.DEATHS, 'officers': sc.OFFICERS, 'emperor': sc.EMPEROR,
            'end': bar_t[-1]}


def mix(music_path, out_mp3, cue):
    m = read_audio(music_path)
    total = max(len(m), int(cue['end'] * SR) + SR)
    music = np.zeros((total, 2), np.float32)
    music[: len(m)] = m
    voice = np.zeros((total, 2), np.float32)
    for lid, L in cue['lines'].items():
        v = read_audio(treat(lid) if os.environ.get('VOICE_FX', '1') != '0'
                       else os.path.join(VOICE, f'{lid}.wav'))
        a = int(L['t'] * SR)
        voice[a: a + len(v)] += v[: total - a]
    # the voice: a touch of warmth and room, level-matched
    vr = np.sqrt((voice ** 2).mean(1))
    speech = vr > 1e-4
    rms = np.sqrt((voice[speech] ** 2).mean()) if speech.any() else 1
    voice *= 0.16 / rms
    # duck the music under the voice (-8 dB, 120 ms attack, 600 ms release)
    env = np.zeros(total, np.float32)
    k = int(0.05 * SR)
    act = np.convolve(vr > 0.002, np.ones(k), 'same') > 0
    g = 1.0
    att, rel = np.exp(-1 / (0.12 * SR)), np.exp(-1 / (0.6 * SR))
    lo = 10 ** (-8 / 20)
    for i in range(total):  # a plain one-pole follower
        tgt = lo if act[i] else 1.0
        c = att if tgt < g else rel
        g = tgt + (g - tgt) * c
        env[i] = g
    out = music * env[:, None] + voice
    # a look-ahead limiter at -1 dBFS, so the booms don't turn the whole film down
    from scipy.ndimage import maximum_filter1d, uniform_filter1d
    ceiling = 10 ** (-1 / 20)
    w = int(0.005 * SR)
    peak = maximum_filter1d(np.abs(out).max(1), size=2 * w + 1)
    gain = np.minimum(1.0, ceiling / np.maximum(peak, 1e-9))
    gain = uniform_filter1d(maximum_filter1d(1 - gain, size=int(0.08 * SR)), size=int(0.02 * SR))
    out *= (1 - gain)[:, None]
    out = np.clip(out, -ceiling, ceiling)
    subprocess.run([ffmpeg(), '-y', '-loglevel', 'error', '-f', 'f32le', '-ac', '2', '-ar', str(SR),
                    '-i', '-', '-c:a', 'libmp3lame', '-b:a', '192k', out_mp3],
                   input=out.astype(np.float32).tobytes(), check=True)
    return out_mp3


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cues', action='store_true')
    ap.add_argument('--mix', action='store_true')
    a = ap.parse_args()
    s = sc.build()
    cue = cues(s)
    with open(os.path.join(HERE, 'cues.json'), 'w') as fh:
        json.dump(cue, fh, separators=(',', ':'))
    print('cues.json: end at', cue['end'], 's')
    if a.cues:
        return
    score_dir = os.path.join(ROOT, 'References/cutscene/glass/score')
    os.makedirs(score_dir, exist_ok=True)
    if not a.mix:
        from engine.form import check_form
        from engine.render import Renderer
        problems = check_form(s)
        if problems:
            raise SystemExit('\n'.join(['form check failed:', *problems]))
        print(Renderer(s).export('far_side_score', variants=['full'], out_dir=score_dir))
    src = [f for f in os.listdir(score_dir) if f.startswith('far_side_score')
           and f.endswith(('.ogg', '.mp3', '.wav', '.m4a'))]
    if not src:
        raise SystemExit('no rendered score in ' + score_dir)
    print(mix(os.path.join(score_dir, sorted(src)[0]), os.path.join(HERE, 'far_side.mp3'), cue))


if __name__ == '__main__':
    main()
