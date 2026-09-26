"""Structural checks on a score's form, run by build.py before rendering.

A bar in which no part sounds at all is almost always a typo in the form
(a section list that stops short of `intro_bars + loop_bars`, a melody that
ends a few bars early). The loop splice would still be seamless, so the
seam check can't see it: the music just falls silent inside the loop.
Intentional silences are declared on the score with `score.silent_ok`.
"""

from __future__ import annotations

from engine.render import _variant_gain


def silent_bars(score, variant: str | None = None) -> list[int]:
    """1-based bars in [1, intro_bars + loop_bars] where nothing sounds in `variant`."""
    total = score.intro_bars + score.loop_bars
    n_bars = int(round(total))
    gains = score.variants.get(variant, {}) if variant else {}
    sounding = [False] * n_bars
    for pname, part in score.parts.items():
        if variant and _variant_gain(gains, pname) is None:
            continue
        for n in part.notes:
            first = max(0, score.bar_at(n.start))
            # a note ending exactly on a barline doesn't sound in the next bar
            last = min(n_bars - 1, score.bar_at(n.end - 1e-6))
            for b in range(first, last + 1):
                sounding[b] = True
    return [i + 1 for i, s in enumerate(sounding) if not s]


def check_form(score) -> list[str]:
    """Problems that should stop a build: silent bars not declared in `silent_ok`."""
    allowed = set(getattr(score, 'silent_ok', ()) or ())
    problems = []
    for variant in [None, *score.variants]:
        bad = [b for b in silent_bars(score, variant) if b not in allowed]
        if bad:
            label = variant or 'all parts'
            problems.append(f'{score.name} ({label}): nothing sounds in bars {_ranges(bad)}')
    return problems


def _ranges(bars: list[int]) -> str:
    out, start, prev = [], None, None
    for b in bars + [None]:
        if start is None:
            start = prev = b
        elif b == prev + 1:
            prev = b
        else:
            out.append(f'{start}' if start == prev else f'{start}-{prev}')
            start = prev = b
    return ', '.join(out)
