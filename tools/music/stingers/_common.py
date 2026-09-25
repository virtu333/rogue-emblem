"""Shared set-up for the one-shot stingers.

Every stinger is written in D and rendered in each tonic the music uses
(build.py passes `transpose`), so it lands in the key of the track under it
while the game ducks that track. Keep lines within about a fourth either way
of their instrument's range limits: transposition spans -6..+5 semitones.
"""

from engine.score import Score


def cue(name, bpm, bars, title, transpose=0, meter=(4, 4), seed=1, lufs=-17.0, rt60=2.2):
    s = Score(f'stinger_{name}', bpm=bpm, meter=meter, intro_bars=bars, title=title,
              seed=seed, one_shot=True, transpose=transpose)
    s.reverb = dict(rt60=rt60, predelay_ms=22, wet_db=0.0)
    s.master = dict(lufs=lufs, glue_ratio=1.3, lead_duck=0)
    s.variant('full', {}, lufs=lufs)
    return s
