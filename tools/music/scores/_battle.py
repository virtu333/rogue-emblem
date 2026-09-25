"""Shared arranging kit for the adaptive battle and boss cues.

A cue declares its own material (melodies, charts, grooves, form) and uses
these helpers to lay it onto the standard ensemble:

  full ("thunder")  orchestra + rock kit + bass guitar + brass + choir
  calm ("rain")     a solo voice on the tune over legato low strings,
                    piano in quarters and soft pads; a quiet heartbeat kick

Parts are created on first use and reused across sections; each part is
tagged full-only, calm-only or shared so the two mix variants fall out
automatically.
"""

from __future__ import annotations

from engine.patterns import Kit, arp, bass, chart, drums, ostinato, pad
from engine.score import Score


class Battle:
    def __init__(self, s: Score, calm_lufs=-17.0, full_lufs=-14.0, adaptive=True):
        self.s = s
        self.adaptive = adaptive
        self.full_only: set[str] = set()
        self.calm_only: set[str] = set()
        self.calm_gain: dict[str, float] = {}
        self.sections: dict[str, tuple[int, list]] = {}
        self.kit = None
        self.calm_kit = None
        self.full_lufs = full_lufs
        self.calm_lufs = calm_lufs
        # extra mixes of the same score (a boss's enrage layer): parts heard only
        # in that mix, and parts (or globs) that mix takes away
        self.variant_only: dict[str, set[str]] = {}
        self.variant_mutes: dict[str, set[str]] = {}
        self.variant_lufs: dict[str, float] = {}

    # ------------------------------------------------------------ plumbing
    def part(self, name, inst, layer='both', calm_db=None, **opts):
        if name not in self.s.parts:
            self.s.part(name, inst, **opts)
        if layer == 'full':
            self.full_only.add(name)
        elif layer == 'calm':
            self.calm_only.add(name)
        if calm_db is not None:
            self.calm_gain[name] = calm_db
        return self.s.parts[name]

    def extra(self, variant, name, inst, **opts):
        """A part heard only in the mix `variant` (e.g. 'enrage_blade_lord')."""
        p = self.part(name, inst, **opts)
        self.variant_only.setdefault(variant, set()).add(name)
        return p

    def extra_variant(self, variant, mute=(), lufs=None):
        """Declare mix `variant`; `mute` lists parts (or globs) it takes away and
        `lufs` overrides its loudness (a mix that takes away should not be
        normalised back up to the full mix's level)."""
        self.variant_only.setdefault(variant, set())
        self.variant_mutes[variant] = set(mute)
        if lufs is not None:
            self.variant_lufs[variant] = lufs

    def section(self, name, bar, ch):
        self.sections[name] = (bar, ch)
        return self

    def bar(self, sec):
        return self.sections[sec][0]

    def chart(self, sec):
        return self.sections[sec][1]

    def finish(self):
        s = self.s
        extras = set().union(*self.variant_only.values()) if self.variant_only else set()
        hide = {p: None for p in extras}
        if not self.adaptive:
            s.variant('full', dict(hide), lufs=self.full_lufs)
        else:
            calm = {p: None for p in self.full_only}
            calm.update(self.calm_gain)
            calm.update(hide)
            s.variant('full', {**{p: None for p in self.calm_only}, **hide}, lufs=self.full_lufs)
            s.variant('calm', calm, lufs=self.calm_lufs)
        # each extra mix is the full mix plus its own parts, minus its mutes
        for variant, own in self.variant_only.items():
            gains = {p: None for p in (extras - own) | self.calm_only}
            gains.update({p: None for p in self.variant_mutes.get(variant, ())})
            s.variant(variant, gains, lufs=self.variant_lufs.get(variant, self.full_lufs))
        return s

    # ------------------------------------------------------------ melody
    def lead(self, sec, text, inst='violins', name=None, transpose=0, dyn='f', layer='both',
             role='lead', calm_db=None, art=None, **opts):
        name = name or f'lead_{inst}'
        if layer == 'both' and calm_db is None and name not in self.calm_gain:
            calm_db = -5.0   # shared tunes sit under the calm layer's solo voices
        p = self.part(name, inst, layer=layer, role=role, calm_db=calm_db, **opts)
        prefix = f'@{dyn} ' + (f'%{art} ' if art else '')
        p.at(self.bar(sec)).play(prefix + text, transpose=transpose)
        return p

    # ------------------------------------------------------------ strings
    def spic8(self, sec, inst='celli', degrees='b b b b b b b b', lo=38, hi=55, vel=0.64,
              name=None, accents='> - - > - - > -', layer='both', calm_db=None):
        p = self.part(name or f'ost8_{inst}', inst, layer=layer, role='ostinato', art='spic',
                      calm_db=calm_db)
        ostinato(p, self.bar(sec), self.chart(sec), 'e e e e e e e e', degrees, lo=lo, hi=hi,
                 vel=vel, accents=accents)
        return p

    def spic16(self, sec, inst='violins2', pattern='0 1 2 1', lo=62, hi=81, vel=0.6, name=None,
               layer='both', calm_db=None):
        p = self.part(name or f'ost16_{inst}', inst, layer=layer, role='ostinato', art='spic',
                      calm_db=calm_db)
        arp(p, self.bar(sec), self.chart(sec), pattern, step=0.25, lo=lo, hi=hi, vel=vel,
            accent_every=1)
        return p

    def pads(self, sec, inst='violas', n=2, lo=53, hi=67, vel=0.55, art='sus', name=None,
             layer='both', role='pad', calm_db=None):
        p = self.part(name or f'pad_{inst}', inst, layer=layer, role=role, calm_db=calm_db)
        pad(p, self.bar(sec), self.chart(sec), n=n, lo=lo, hi=hi, vel=vel, art=art)
        return p

    def low(self, sec, style='q', vel=0.66, layer='both', calm_db=-3):
        """Contrabasses: 'q' spiccato quarters, 'w' sustained roots."""
        p = self.part('cb', 'basses', layer=layer, role='low', calm_db=calm_db)
        if style == 'w':
            bass(p, self.bar(sec), self.chart(sec), 'w', 'b', floor=26, vel=vel, art='sus')
        else:
            bass(p, self.bar(sec), self.chart(sec), 'q q q q', 'b b b b', floor=26, vel=vel,
                 art='spic')
        return p

    # ------------------------------------------------------------ rhythm section
    def groove(self, sec, beat, fill=None, every=4, vel=0.74, crash=True, n_bars=None):
        if self.kit is None:
            self.kit = Kit(self.s, 'kit')
            self.full_only.update(self.kit.names())
        start = self.bar(sec)
        n = n_bars or self._bars(sec)
        for b in range(start, start + n):
            last = fill is not None and (b - start) % every == every - 1
            self.kit.play(b, fill if last else beat, vel=vel)
        if crash:
            self.kit.play(start, {'crash': 'X'})

    def _bars(self, sec):
        beats = sum(b for _, b in self.chart(sec))
        return int(round(beats / self.s.bar_beats))

    def rbass(self, sec, rhythm='e e e e e e e e', notes='r r r r r r 8 r', vel=0.74,
              accents='> - - > - - > -', text=None, transpose=0):
        p = self.part('ebass', 'rbass', layer='full', role='bass', duck='kit_kick')
        if text:
            p.at(self.bar(sec)).play(f'@f {text}', transpose=transpose)
        else:
            bass(p, self.bar(sec), self.chart(sec), rhythm, notes, floor=28, vel=vel,
                 accents=accents)
        return p

    def sub(self, sec, vel=0.6):
        p = self.part('sub', 'sub', layer='full', role='sub')
        bass(p, self.bar(sec), self.chart(sec), 'w', 'b', floor=26, vel=vel)

    # ------------------------------------------------------------ brass & choir
    def brass_pad(self, sec, inst='horns', n=3, lo=50, hi=67, vel=0.55, layer='full', name=None,
                  calm_db=None):
        p = self.part(name or f'bpad_{inst}', inst, layer=layer, role='pad', calm_db=calm_db)
        pad(p, self.bar(sec), self.chart(sec), n=n, lo=lo, hi=hi, vel=vel)
        return p

    def stabs(self, sec, rhythm='q. q. q', lo=60, hi=76, vel=0.62, inst='trumpets'):
        p = self.part(f'stab_{inst}', inst, layer='full', role='accent', art='stac')
        ostinato(p, self.bar(sec), self.chart(sec), rhythm, ' '.join(['1'] * 8), lo=lo, hi=hi,
                 vel=vel)
        ostinato(p, self.bar(sec), self.chart(sec), rhythm, ' '.join(['0'] * 8), lo=lo, hi=hi,
                 vel=vel - 0.05)
        return p

    def choir(self, sec, kind='choir', n=3, lo=55, hi=74, vel=0.62, layer='full'):
        p = self.part(f'choir_{kind}', kind, layer=layer, role='choir')
        pad(p, self.bar(sec), self.chart(sec), n=n, lo=lo, hi=hi, vel=vel)
        return p

    # ------------------------------------------------------------ percussion
    def timp(self, sec, text):
        p = self.part('timp', 'timpani', role='timp', calm_db=-8)
        p.at(self.bar(sec)).play(text)
        return p

    def hit(self, bar, pieces=('crash', 'bd'), vel=0.8):
        p = self.part('perc', 'orch_perc', role='accent', calm_db=-8)
        drums(p, bar, {k: 'x' for k in pieces}, vel=vel)

    def riser(self, bar, beats=8, vel=0.65):
        p = self.part('riser', 'riser', layer='full', role='fx')
        p.note(self.s.bar(bar), 60, beats, vel=vel)

    # ------------------------------------------------------------ the calm bed
    def calm_bed(self, sec, piano='0 2 4 2', piano_lo=50, piano_hi=79, low=True, pad_n=2,
                 heartbeat=True, piano_step=1.0):
        bar, ch = self.sections[sec]
        p = self.part('c_pno', 'grand', layer='calm', role='keys')
        arp(p, bar, ch, piano, step=piano_step, lo=piano_lo, hi=piano_hi, vel=0.46,
            accent_every=2, accent=0.08)
        if low:
            lp = self.part('c_low', 'celli', layer='calm', role='bass', art='soft')
            bass(lp, bar, ch, 'h h', 'r 5', floor=38, vel=0.5, art='soft')
            lb = self.part('c_lowcb', 'basses', layer='calm', role='low', art='soft')
            bass(lb, bar, ch, 'w', 'b', floor=26, vel=0.5, art='soft')
        if pad_n:
            vp = self.part('c_pad', 'violas', layer='calm', role='pad', art='soft')
            pad(vp, bar, ch, n=pad_n, lo=53, hi=69, vel=0.45, art='soft')
        if heartbeat:
            if self.calm_kit is None:
                self.calm_kit = Kit(self.s, 'ckit', gains={'kick': -4})
                self.calm_only.update(self.calm_kit.names())
            for b in range(bar, bar + self._bars(sec)):
                self.calm_kit.play(b, {'kick': 'x.......x.......'}, vel=0.42)
