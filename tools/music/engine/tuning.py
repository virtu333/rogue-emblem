"""Sample tuning: a pitch meter and the correction tables the renderers apply.

Some library samples are recorded off pitch (a VSCO tuba note 35 cents flat, a
GeneralUser choir zone 45 cents sharp). `tools/music/tunecheck.py` measures
every sample the palette can play and writes `tools/music/tuning.json`:

  "sfz":  {sample path relative to References/music-libs: cents}
  "sf2":  {"<font>|<bank>|<program>": {key: cents}}

Each value is the correction to apply (minus the measured error). The sfz
sampler adds it to the sample's own `tune`; SoundFont parts retune their keys
through a MIDI Tuning Standard table, so chords stay in tune note by note.
"""

from __future__ import annotations

import hashlib
import json
import os

import numpy as np

from .dsp import SR

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
LIBS = os.path.join(ROOT, 'References', 'music-libs')
TABLE_PATH = os.path.join(os.path.dirname(__file__), '..', 'tuning.json')

_TABLE = None


def table() -> dict:
    global _TABLE
    if _TABLE is None:
        _TABLE = json.load(open(TABLE_PATH)) if os.path.exists(TABLE_PATH) else {}
        _TABLE.setdefault('sfz', {})
        _TABLE.setdefault('sf2', {})
    return _TABLE


def lib_rel(path: str) -> str:
    """A sample's key in the table: its path under References/music-libs."""
    return os.path.relpath(os.path.realpath(path), os.path.realpath(LIBS)).replace(os.sep, '/')


def sample_cents(path: str) -> float:
    """Correction (cents) for one sfz sample; 0 when it measured in tune."""
    return float(table()['sfz'].get(lib_rel(path), 0.0))


def preset_id(font: str, bank: int, program: int) -> str:
    return f'{os.path.basename(font)}|{bank}|{program}'


def preset_cents(font: str, bank: int, program: int) -> dict:
    """{key: cents} correction for a SoundFont preset (empty when none measured)."""
    t = table()['sf2'].get(preset_id(font, bank, program), {})
    return {int(k): float(v) for k, v in t.items()}


def token(inst: dict) -> str:
    """What an instrument's stems depend on in the table (for stem cache keys)."""
    if inst.get('kind') == 'sfz':
        from .sampler import parse_sfz
        files = sorted({a['file'] for a in inst['arts'].values()})
        body = {f: sorted((lib_rel(r.sample), sample_cents(r.sample))
                          for r in parse_sfz(f).regions if sample_cents(r.sample))
                for f in files}
    elif inst.get('kind') == 'sfizz':
        from .sfzrender import _fixes
        body = sorted((lib_rel(p), c) for p, c in _fixes(inst['sfz']).items())
    elif inst.get('kind') == 'sf2':
        body = sorted(preset_cents(inst['font'], inst['bank'], inst['program']).items())
    else:
        return ''
    return hashlib.sha1(json.dumps(body, sort_keys=True).encode()).hexdigest()[:12]


# ------------------------------------------------------------------ the meter
def _peak(mag, freqs, f_lo, f_hi):
    """Parabolic-interpolated peak (frequency, magnitude) inside [f_lo, f_hi]."""
    a, b = np.searchsorted(freqs, [f_lo, f_hi])
    if b - a < 3:
        return None, 0.0
    i = a + int(np.argmax(mag[a:b]))
    if i <= a or i >= b - 1:
        return None, 0.0   # rising into the window edge: not a peak of this partial
    y0, y1, y2 = np.log(mag[i - 1: i + 2] + 1e-12)
    d = 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2) if (y0 - 2 * y1 + y2) != 0 else 0.0
    df = freqs[1] - freqs[0]
    return freqs[i] + d * df, float(np.exp(y1 - 0.25 * (y0 - y2) * d))


def _frame(x, fe, sr, max_harm, fundamental_only, ensemble=False):
    """One window's tuning (cents from fe), partial disagreement, partial count, spectrum.

    ensemble: the partials of a section recorded as one sample (a choir) are
    clusters of detuned voices, and their loudest peak is one voice, not the
    section. The pitch heard is the cluster's centre: each partial is then
    the power-weighted centroid of its cluster."""
    n = len(x)
    nfft = 1 << int(np.ceil(np.log2(n * 8)))
    mag = np.abs(np.fft.rfft((x - x.mean()) * np.hanning(n), nfft))
    freqs = np.fft.rfftfreq(nfft, 1 / sr)
    ks = [1] if fundamental_only else \
        [k for k in range(1, max_harm + 1) if k * fe < min(3000.0, sr / 2 - 500)] or [1]
    # coarse: harmonic sum over candidate offsets
    cands = np.arange(-150, 151, 1.0)
    score = np.zeros(len(cands))
    for k in ks:
        score += np.interp(k * fe * 2 ** (cands / 1200), freqs, mag) / k ** 0.5
    if ensemble:
        score = np.convolve(score, np.ones(81) / 81, 'same')   # the cluster, not one voice
    f0 = fe * 2 ** (float(cands[int(np.argmax(score))]) / 1200)
    est, w = [], []
    for k in ks:
        if ensemble:
            band = (freqs >= k * f0 * 2 ** (-70 / 1200)) & (freqs <= k * f0 * 2 ** (70 / 1200))
            p = mag[band] ** 2
            if band.sum() < 3 or p.sum() <= 0:
                continue
            pf, pm = float(np.sum(freqs[band] * p) / p.sum()), float(np.sqrt(p.sum()))
        else:
            pf, pm = _peak(mag, freqs, k * f0 * 2 ** (-40 / 1200), k * f0 * 2 ** (40 / 1200))
        if pf is not None:
            est.append(1200 * np.log2(pf / k / fe))
            w.append(pm)
    if not est:
        return None
    est, w = np.array(est), np.array(w)
    keep = w >= 0.1 * w.max()
    est, w = est[keep], w[keep]
    c = float(np.sum(est * w) / np.sum(w))
    return c, float(np.sqrt(np.sum(w * (est - c) ** 2) / np.sum(w))), int(len(est)), mag, freqs


def _wquant(v, w, q):
    o = np.argsort(v)
    cw = np.cumsum(w[o]) / np.sum(w)
    return float(v[o][min(int(np.searchsorted(cw, q)), len(v) - 1)])


def _autocorr(x, fe, sr):
    """Second opinion: the period (cents from fe) from the autocorrelation
    peak within +-150 cents of the expected one, or None when that is not a
    peak or the period is too short to resolve (under 50 samples)."""
    P = sr / fe
    if P < 50:
        return None
    x = x - x.mean()
    n = len(x)
    ac = np.fft.irfft(np.abs(np.fft.rfft(x, 2 * n)) ** 2)[:n]
    lo, hi = int(P * 2 ** (-150 / 1200)), int(np.ceil(P * 2 ** (150 / 1200))) + 1
    if hi + 1 >= n:
        return None
    i = lo + int(np.argmax(ac[lo:hi]))
    if i <= lo or i >= hi - 1:
        return None
    y0, y1, y2 = ac[i - 1: i + 2]
    d = 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2) if (y0 - 2 * y1 + y2) != 0 else 0.0
    return 1200 * np.log2(P / (i + d))


def measure(x: np.ndarray, expected_midi: float, sr: int = SR, max_harm: int = 8,
            fundamental_only: bool = False, ensemble: bool = False) -> dict:
    """Tuning of a note against the pitch it should have.

    The note is known to within a semitone, so each partial is looked for near
    k times the expected frequency: no octave guessing. The note is cut into
    windows (at least 8 periods, 80 ms); in each, a harmonic-sum search over
    +-150 cents finds the offset, then each partial's peak is refined and the
    partials are averaged, weighted by level. The autocorrelation period gives
    a second opinion; a window where the two disagree by more than 15 cents is
    not counted. The note's tuning is the energy-weighted median over the
    windows (the centre of a vibrato, the body of a scooped note: the constant
    correction that leaves the least error). `ensemble` (a section sampled as
    one voice): each partial is its cluster's centroid, over 1 s windows, and
    the autocorrelation (which also hears the centre) is not consulted. Returns
      cents     the tuning error
      spread    how much the partials disagree (median over windows)
      agree     the fraction of windows where both methods agree
      iqr       how much the pitch moves over the note (weighted 25-75 %)
      drift     first half of the note against the second half
      octave_suspect  as much energy half-way between the expected partials
                as on them (the note may sound an octave lower), or no odd
                partials (an octave higher): never trust such a reading."""
    x = np.asarray(x, np.float64)
    if x.ndim == 2:
        x = x.mean(axis=1)
    n = len(x)
    if n < int(0.04 * sr) or not np.any(x):
        return None
    fe = 440.0 * 2 ** ((expected_midi - 69) / 12)
    L = min(n, int(1.0 * sr) if ensemble else max(int(0.08 * sr), int(8 * sr / fe)))
    hop = max(L // 4, int(0.01 * sr))
    starts = list(range(0, n - L + 1, hop)) or [0]
    rms = np.array([np.sqrt(np.mean(x[a:a + L] ** 2)) for a in starts])
    rows, tried = [], 0
    for a, r in zip(starts, rms):
        if r < rms.max() * 0.1:     # the body only: within 20 dB of the loudest window
            continue
        tried += 1
        f = _frame(x[a:a + L], fe, sr, max_harm, fundamental_only, ensemble)
        if f is None:
            continue
        # (a bar's inharmonic partials would mislead the autocorrelation)
        ac = None if ensemble or fundamental_only else _autocorr(x[a:a + L], fe, sr)
        if ac is not None and abs(ac - f[0]) > 15.0:
            continue
        rows.append((a, f[0], f[1], f[2], r ** 2))
    if not rows:
        return None
    t = np.array([r[0] for r in rows])
    c = np.array([r[1] for r in rows])
    w = np.array([r[4] for r in rows])
    cents = _wquant(c, w, 0.5)
    iqr = _wquant(c, w, 0.75) - _wquant(c, w, 0.25)
    mid = np.median(t)
    first, second = t <= mid, t > mid
    drift = abs(_wquant(c[first], w[first], 0.5) - _wquant(c[second], w[second], 0.5)) \
        if first.any() and second.any() else 0.0
    # octave sanity, on the whole note
    whole = _frame(x, fe, sr, max_harm, fundamental_only, ensemble)
    suspect = False
    if whole is not None:
        mag, freqs = whole[3], whole[4]
        f0 = fe * 2 ** (cents / 1200)
        ks = [k for k in range(1, 7) if k * f0 < sr / 2]
        on = sum(np.interp(k * f0, freqs, mag) for k in ks)
        half = sum(np.interp((k - 0.5) * f0, freqs, mag) for k in ks)
        odd = sum(np.interp(k * f0, freqs, mag) for k in ks if k % 2)
        even = sum(np.interp(k * f0, freqs, mag) for k in ks if not k % 2)
        suspect = bool(half > 0.5 * on) or (not fundamental_only and bool(odd < 0.1 * even))
    return {'cents': cents, 'spread': float(np.median([r[2] for r in rows])),
            'partials': int(np.median([r[3] for r in rows])), 'agree': len(rows) / tried,
            'iqr': iqr, 'drift': drift, 'frames': len(rows), 'octave_suspect': suspect}


def body(x: np.ndarray, sr: int = SR, t_max: float = 1.5, floor_db: float = -20.0):
    """The part of a note that carries its pitch: from where it comes within
    `floor_db` of its peak (plus 30 ms of attack transient), while it stays
    there, at most `t_max` seconds."""
    m = np.asarray(x, np.float64)
    if m.ndim == 2:
        m = m.mean(axis=1)
    hop = int(0.01 * sr)
    nf = len(m) // hop
    if nf < 5:
        return m
    rms = np.sqrt(np.convolve((m[: nf * hop] ** 2).reshape(nf, hop).mean(axis=1),
                              np.ones(5) / 5, 'same'))
    loud = np.nonzero(rms >= rms.max() * 10 ** (floor_db / 20))[0]
    a = int(loud[0]) * hop + int(0.03 * sr)
    b = min(a + int(t_max * sr), (int(loud[-1]) + 1) * hop)
    if b - a < int(0.06 * sr):
        a, b = int(loud[0]) * hop, (int(loud[-1]) + 1) * hop
    return m[a:b]


