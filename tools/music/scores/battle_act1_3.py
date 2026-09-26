"""Act I battle III — "Open Ground".

The army is small and the sky is wide. This is the public, bright-minor
battle of the first act: a tune a player can whistle after two fights, set
for a light band (one trumpet, horns, strings, harp and marimba, a kit) so
the later acts have somewhere to grow.

The identity is one short line, the refrain:

    D5 . . Bb5 ~ ~ ~ | A5 . . G5 ~ E5 F5 ~ | F5 (held) ... | ... breath |

a leap of a minor sixth struck on the "and" of two, where the harmony moves
too: the band's push is a chord change, i to bVI, and the leap lands on that
chord's root. Then a descending answer over bVII that dips to E and turns up
into F a beat early, and two bars of air in which the horns answer. Under it
the harmony only ever circles i-bVI-bVII (Dm, Bb on the push, C); there is no
major dominant anywhere in the loop. The second phrase is the first a third
higher, F up a major sixth to D.

(The leap was a fifth, D up to A held, then G F: Ember Dusk's A5 arriving off
the beat and falling G F, in the same key and act, and Totality's opening.
The minor sixth keeps the push and the contour and gives this tune its own
top note.)

That refrain is the invariant. What moves is the ground under it: the
refrain's tonal centre steps up by minor thirds, D -> F -> A-flat, and each
new key is entered through its own flat seventh (C -> Dm, Eb -> Fm, Gb -> Abm),
the same bVII -> i step the refrain itself turns on. After the A-flat climax
the cycle touches its fourth step and does not stay: the A-flat refrain's
last chord, G-flat, is F-sharp, the dominant of B minor, so the refrain's
leap sounds once in B, and it lands on G. That G is B minor's flat sixth and
D minor's fourth at once; it turns minor under the answer, and the answer's
held note falls on C, D minor's flat seventh. B minor is a glance of a beat
and a half, not a key; the loop returns to D minor through bVII, open, never
cadential.

  A     1-8    the refrain in D: solo trumpet, the horns answer
  B     9-16   the verse, violas and celli in unison, one idea: the
                refrain's leap turned over. Each bar falls a sixth onto the
                push and climbs three steps back (the answer's rhythm), a
                step higher each time; A-flat and E-flat creep in and turn
                the ground to F, and the last climb runs into the F refrain
  A/F  17-24   the refrain a minor third up: violins, horns answering
  C    25-28   the open sky: D-flat major, the refrain's minor sixth opened
                to a major sixth
  climb 29-32  the sky's third turns minor; the leap rises a step a bar over
                a bass walking D-flat, E-flat, F-flat, G-flat, one horn
                already holding the A-flat to come
  A/Ab 33-40   after two beats of snare alone, the refrain at the top:
                violins, trumpet, the whole kit, and the push handed to the
                trombones and tuba as punches
  link 41-44   the leap in B minor, landing on G (G, then G minor), then C:
                home without a V

Bar numbers above are loop bars (score bars minus the 4-bar intro). The only
lint hits are the refrain's major seventh over bVI (A over B-flat and its
transpositions), which is the colour of the second phrase's held note.

Lead colour and groove are chosen against the other two Act I themes: a
trumpet (not violins) carries the first refrain; the texture is plucked (harp
and marimba in open fifths and octaves, D-A-D, no thirds: open ground) rather
than bowed; and the kit is a broad half-time with the push on the and-of-two,
where Ember Dusk runs a rock beat and Border Marches gallops. No choir, no
piccolo over the tune, no trumpet doubling the horns (Act I budget). The
Thread is not quoted: this is the army's own song.

  calm  flute / clarinet / oboe / flute / solo violin take the tune in turn
        over the calm bed; the harp's open fifths stay, the horns answer softly
  full  trumpet, violins, horns, low strings, marimba, kit and bass guitar
"""

import re

from engine.patterns import Kit, _art, bass, chart, pad
from engine.score import Score, parse_duration

from scores._battle import Battle

KEY = 'music_battle_act1_3'

# ------------------------------------------------------------------ material
# the refrain (written in D): a minor sixth on the push, onto bVI's root; the
# answer over bVII, arriving a beat early on the held note; two bars of air
REFRAIN = """
D5q. Bb5e~ Bb5h | A5q. G5e~ G5e E5e F5q~ | F5w~ | F5h rh |
F5q. D6e~ D6h | C6q. Bb5e~ Bb5e G5e A5q~ | A5w~ | A5h rh |
"""
# the horns' answer, in the refrain's air
ANSWER = """
rw | rw | rh A4q. D5e~ | D5h C5q rq |
rw | rw | rh C5q. F5e~ | F5h E5q rq |
"""
# verse: one idea, the refrain's leap turned over. On the beat a high note,
# a fall of a sixth onto the push, then three steps back up in the answer's
# rhythm; each bar starts a step higher. A-flat and E-flat creep in (bars 5,
# 7) and the last climb, C D E-flat, steps on up to the F the next refrain
# starts on
VERSE = """
D5q. F4e~ F4e G4e A4q | E5q. G4e~ G4e A4e Bb4q | F5q. A4e~ A4e Bb4e C5q | D5h. rq |
F5q. Ab4e~ Ab4e Bb4e C5q | G5q. Bb4e~ Bb4e C5e D5q | Eb5q. G4e~ G4e Ab4e Bb4q | C5e D5e Eb5h rq |
"""
# the open sky: D-flat major, the refrain's minor sixth opened to a major one
SKY = """
Ab4q. F5e~ F5h | Eb5q. C5e~ C5e Ab4e Eb5q | Db5q. Bb5e~ Bb5h | Ab5q. Gb5e~ Gb5e F5e Db5q |
"""
# the climb: the sky's major third turns minor (F -> F-flat) and the same leap
# (third up to root) rises a step a bar while the bass climbs D-flat, E-flat,
# F-flat, G-flat to A-flat; the last bar walks down through C-flat, so the new
# key's one strange note is heard before the refrain lands on it. Then the
# band stops for two beats and only the snare is left: the refrain's arrival
# in A-flat is a hit, not a slip
CLIMB = """
E5q. Db6e~ Db6h | Gb5q. Eb6e~ Eb6h | Ab5q. E6e~ E6h | Bb5q Db6e B5e rh |
"""
# the link: the minor-third climb touches one more step. The A-flat refrain's
# last chord, G-flat, is F-sharp, the dominant of B minor, so the refrain's
# leap sounds once in B, and lands on G: B minor's flat sixth, D minor's
# fourth. G turns minor under the answer (F E C D, already D minor's notes),
# and the answer's held D falls on C (bVII of D). B minor lasts a beat and a
# half: a glance at the fourth step, not a key. The loop point is C -> Dm,
# not V -> i.
LINK = 'B4q. G5e~ G5h | F5q. E5e~ E5e C5e D5q~ | D5w | F5h E5h |'
LINK_HN = 'rw | rw | rh G4q. C5e~ | C5h G4q rq |'
# the horn plants the refrain's leap (D up to B-flat on the push) before the
# band arrives
INTRO_HN = 'D4q. Bb4e~ Bb4h | rw | F4q. D5e~ D5h | rh E4h |'

# i-bVI-bVII, the whole refrain, with bVI arriving on the push; bVII takes a
# fourth for its last beat, the note the tune arrives on early. Bars 7-8 hold
# the fifth over bVI: A over B-flat, the refrain's one major-seventh (lint
# lists it: intended colour)
REFRAIN_CH = 'Dm:1.5 Bb:2.5 C:3 Csus4:1 Dm:4 Bb:2 C:2 ' * 2
VERSE_CH = 'Dm:4 C:2 C7:2 F:4 Gm:4 Bb:4 Gm:4 Cm:4 Eb:4'
SKY_CH = 'Db:4 Ab/C:4 Bbm:4 Gb:4'
CLIMB_CH = 'Dbm:4 Ebm:4 E:4 Gb:4'
LINK_CH = 'Bm:1.5 G:2.5 Gm:4 C:4 Csus4:2 C:2'
INTRO_CH = 'Dm:1.5 Bb:2.5 Dm:4 Bb:4 Csus4:2 C:2'

NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
_SYM = re.compile(r'^([A-G][b#]?)([^/]*)(?:/([A-G][b#]?))?$')


def _pc(n):
    return {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}[n[0]] + \
        (1 if n[1:] == '#' else -1 if n[1:] == 'b' else 0)


def tchart(text, semis=0):
    """A chord chart moved by `semis` (roots and slash basses)."""
    out = []
    for tok in text.split():
        sym, beats = tok.split(':')
        root, qual, over = _SYM.match(sym).groups()
        sym = NAMES[(_pc(root) + semis) % 12] + qual
        if over:
            sym += '/' + NAMES[(_pc(over) + semis) % 12]
        out.append(f'{sym}:{beats}')
    return chart(' '.join(out))


# The refrain's chords change on the push (beat 1.5), but its bass, punches and
# calm piano keep a figure per BAR: these helpers lay a one-bar figure down
# bar by bar and take each note from the chord sounding at its onset, so the
# figure's second note simply lands on the new chord (the engine's own helpers
# restart the figure at every chord change).
def _chord_at(ch, off):
    t = 0.0
    for c, beats in ch:
        if off < t + beats - 1e-9:
            return c, t, t + beats
        t += beats
    c, beats = ch[-1]
    return c, t - beats, t


def _grid(part, bar, ch, rhythm, pick, vel, art, accents):
    durs = [parse_duration(d) for d in rhythm.split()]
    accs = accents.split() if accents else []
    t0 = part.score.bar(bar)
    base = part.vel if vel is None else vel
    total = sum(b for _, b in ch)
    for k in range(int(round(total / 4))):
        pos, i = 0.0, 0
        while pos < 4 - 1e-9:
            d = durs[i % len(durs)]
            c, _, _ = _chord_at(ch, k * 4 + pos)
            p = pick(c, i)
            if p is not None:
                v = base + (0.14 if accs and accs[i % len(accs)] == '>' else 0.0)
                part.note(t0 + k * 4 + pos, p, min(d, 4 - pos), vel=min(1.0, v),
                          art=_art(part, art))
            pos += d
            i += 1


def grid_bass(part, bar, ch, rhythm, notes, floor=33, vel=None, art=None, accents=None):
    """patterns.bass, one figure per bar: r(oot) 5 8 or '-'."""
    sel = notes.split()

    def pick(c, i):
        s = sel[i % len(sel)]
        if s == '-':
            return None
        if s == '5':
            p = c.root_note(floor) + 7
            return p - 12 if p > floor + 14 else p
        return c.bass_note(floor) + (12 if s == '8' else 0)
    _grid(part, bar, ch, rhythm, pick, vel, art, accents)


def grid_ost(part, bar, ch, rhythm, degrees, lo=48, hi=72, vel=None, art=None, accents=None):
    """patterns.ostinato, one figure per bar: chord-tone indices, 'b', '-'."""
    degs = degrees.split()

    def pick(c, i):
        dg = degs[i % len(degs)]
        if dg == '-':
            return None
        if dg == 'b':
            return c.bass_note(lo)
        tones = c.tones_in_range(lo, hi)
        return tones[int(dg) % len(tones)] + 12 * (int(dg) // len(tones))
    _grid(part, bar, ch, rhythm, pick, vel, art, accents)


def grid_arp(part, bar, ch, pattern, step=1.0, lo=55, hi=84, vel=None, accent_every=None,
             accent=0.12):
    """patterns.arp on a steady grid: each step takes the chord at its onset;
    a note that would ring into a chord it doesn't belong to stops at the
    change."""
    idx = [int(x) for x in pattern.split()]
    t0 = part.score.bar(bar)
    base = part.vel if vel is None else vel
    total = sum(b for _, b in ch)
    k, prev = 0, None
    for i in range(int(round(total / step))):
        off = i * step
        c, cs, ce = _chord_at(ch, off)
        if c is not prev:
            k, prev = 0, c
        tones = c.tones_in_range(lo, hi)
        p = tones[idx[k % len(idx)] % len(tones)]
        v = base
        if accent_every:
            q = (off - cs) / accent_every
            if abs(q - round(q)) < 1e-6:
                v = min(1.0, v + accent)
        dur = step
        if off + step > ce + 1e-9 and ce < total - 1e-9:
            nxt = _chord_at(ch, ce)[0]
            if p % 12 not in nxt.pcs:
                dur = ce - off
        part.note(t0 + off, p, dur, vel=v, art=_art(part, None))
        k += 1


def calm_bed_push(b, sec):
    """Battle.calm_bed for a section whose chords change on the push."""
    bar, ch = b.sections[sec]
    grid_arp(b.part('c_pno', 'grand', layer='calm', role='keys'), bar, ch, '0 2 4 2', step=1.0,
             lo=57, hi=79, vel=0.46, accent_every=2, accent=0.08)
    grid_bass(b.part('c_low', 'celli', layer='calm', role='bass', art='soft'), bar, ch, 'h h',
              'r 5', floor=38, vel=0.5, art='soft')
    bass(b.part('c_lowcb', 'basses', layer='calm', role='low', art='soft'), bar, ch, 'w', 'b',
         floor=26, vel=0.5, art='soft')
    pad(b.part('c_pad', 'violas', layer='calm', role='pad', art='soft'), bar, ch, n=2, lo=53,
        hi=69, vel=0.45, art='soft')
    if b.calm_kit is None:
        b.calm_kit = Kit(b.s, 'ckit', gains={'kick': -4})
        b.calm_only.update(b.calm_kit.names())
    for bb in range(bar, bar + b._bars(sec)):
        b.calm_kit.play(bb, {'kick': 'x.......x.......'}, vel=0.42)


HARP_FIG = (0, 7, 12, 19, 24, 19, 12, 7)
MAR_FIG = (12, 7, 0, 7, 12, 19, 12, 7)


def fifths(part, bar, ch, figure=HARP_FIG, floor=55, step=0.5, vel=0.5, accent=(0, 3)):
    """Open fifths and octaves on each chord's root: no third (and no ninth to
    rub against the tune's thirds), so the figure never decides the mode.
    Accents on the beat and the push."""
    t = part.score.bar(bar)
    for c, beats in ch:
        r = c.root_note(floor)
        for i in range(int(round(beats / step))):
            v = vel + (0.1 if (i % 8) in accent else 0.0)
            part.note(t + i * step, r + figure[i % len(figure)], step, vel=v,
                      art=part.opts.get('art') or 'default')
        t += beats


def cut(score, start, end, keep=('kit_', 'ckit_', 'riser')):
    """Silence every part but the drums in [start, end) beats."""
    for name, part in score.parts.items():
        if name.startswith(keep):
            continue
        kept = []
        for n in part.notes:
            if n.start >= end - 1e-9 or n.end <= start + 1e-9:
                kept.append(n)
            elif n.start < start - 1e-9:
                n.dur = start - n.start
                kept.append(n)
        part.notes = kept


def swell(part, bars, length=4):
    """A phrase-length breath on a lead: swell into the held note, ease off
    into the air at the phrase end."""
    for b in bars:
        part.expr((b, 0.8), (b + 1.25, 1.0), (b + length - 0.6, 0.9), (b + length - 0.05, 0.78))


# drum grids, 16 steps per bar: the push (and-of-two) is step 6
ANTHEM = {'kick': 'x.....x.........', 'snare': '........X.....o.',
          'tom_lo': '..............x.', 'tamb': 'xoxoxoxoxoxoxoxo'}
ANTHEM_FILL = {'kick': 'x.....x.........', 'snare': '........X...x.xx',
               'tom_hi': '..........xx....', 'tamb': 'xoxoxoxoxo......'}
MARCH = {'kick': 'x...x...x...x...', 'snare': '....x..o....x.o.', 'hat': 'x.x.x.x.x.x.x.x.',
         'tamb': '..x...x...x...x.'}
MARCH_FILL = {'kick': 'x...x...x...x...', 'snare': '....x.......xxXX', 'hat': 'x.x.x.x.x.x.....'}
DRIVE = {'kick': 'x.....x.x.....x.', 'snare': '....x...o...X..o', 'hat': 'x.xxx.xxx.xxx.xx',
         'tamb': '....x.......x...'}
DRIVE_FILL = {'kick': 'x.....x.x.......', 'snare': '....x.......xxxx', 'tom_lo': '..........xx....'}
CLIMB_BEAT = {'kick': 'x...x...x...x...', 'snare': '....x.......x...', 'ride': 'x.x.x.x.x.x.x.x.'}
SKY_BEAT = {'kick': 'x.....x...x.....', 'snare': '........x.......', 'ride': 'x.x.x.x.x.x.x.x.',
            'tom_lo': '..............x.', 'tamb': 'xoxoxoxoxoxoxoxo'}
TOP = {'kick': 'x.....x.x.x...x.', 'snare': '....X..o....X.o.', 'ride': 'X.x.X.x.X.x.X.x.',
       'tamb': 'xoxoxoxoxoxoxoxo'}
TOP_FILL = {'kick': 'x.....x.x.......', 'snare': '....x.......xxXX', 'tom_hi': '........xx......',
            'tom_lo': '..........xx....'}


def build():
    s = Score('battle_act1_3', tonic='D', bpm=132, intro_bars=4, loop_bars=44, title='Open Ground',
              seed=113)
    s.reverb = dict(rt60=2.2, predelay_ms=28, wet_db=-1.0)
    s.master = dict(lufs=-14.0, glue_ratio=1.5)
    b = Battle(s, calm_lufs=-17.0, full_lufs=-14.0)
    b.section('intro', 1, chart(INTRO_CH))
    b.section('A', 5, tchart(REFRAIN_CH)).section('B', 13, chart(VERSE_CH))
    b.section('AF', 21, tchart(REFRAIN_CH, 3)).section('C', 29, chart(SKY_CH))
    b.section('P', 33, chart(CLIMB_CH))
    b.section('AAb', 37, tchart(REFRAIN_CH, 6)).section('link', 45, chart(LINK_CH))

    # ================================================================ the tune
    # A: a solo trumpet, the public voice; violins2 an octave under, quietly
    b.lead('A', REFRAIN, inst='trumpets', name='tpt', transpose=-12, dyn='f', layer='full',
           art='vib', gain=3)
    b.lead('A', REFRAIN, inst='violins2', name='vn2_mel', transpose=-12, dyn='mf', role='lead2',
           layer='full', art='sus')
    # B: the verse in the tenor, violas and celli in unison
    b.lead('B', VERSE, inst='violas', name='va_mel', dyn='f', art='sus', layer='full')
    b.lead('B', VERSE, inst='celli', name='vc_mel', transpose=-12, dyn='f', role='lead2',
           art='sus', layer='full')
    # A/F: the violins take it up a minor third
    b.lead('AF', REFRAIN, inst='violins', name='vn_mel', transpose=3, dyn='f', art='sus',
           layer='full', gain=1.5)
    b.lead('AF', REFRAIN, inst='violins2', name='vn2_mel', transpose=-9, dyn='mf', role='lead2',
           layer='full')
    # C: the sky, violins in octaves
    b.lead('C', SKY, inst='violins', name='vn_mel', dyn='f', layer='full')
    b.lead('C', SKY, inst='violins2', name='vn2_mel', transpose=-12, dyn='mf', role='lead2',
           layer='full')
    b.lead('P', CLIMB, inst='violins', name='vn_mel', dyn='f', layer='full')
    b.lead('P', CLIMB, inst='violins2', name='vn2_mel', transpose=-12, dyn='f', role='lead2',
           layer='full')
    # A/Ab: the top; violins high, the trumpet back in its own octave
    b.lead('AAb', REFRAIN, inst='violins', name='vn_mel', transpose=6, dyn='ff', layer='full')
    b.lead('AAb', REFRAIN, inst='trumpets', name='tpt', transpose=-6, dyn='ff', layer='full',
           art='vib')
    b.lead('AAb', REFRAIN, inst='violins2', name='vn2_mel', transpose=-6, dyn='f', role='lead2',
           layer='full')
    b.lead('link', LINK, inst='violins', name='vn_mel', dyn='f', layer='full')
    b.lead('link', LINK, inst='violins2', name='vn2_mel', transpose=-12, dyn='mf', role='lead2',
           layer='full')

    # the horns: the call in the intro, the answer in every refrain's air
    hn = b.part('hn_call', 'horns', role='counter', calm_db=-7, pan=-0.25)
    hn.at(1).play('@mf' + INTRO_HN)
    for sec, t in (('A', -12), ('AF', -9), ('AAb', -6)):
        hn.at(b.bar(sec)).play('@f' + ANSWER, transpose=t)
    hn.at(b.bar('link')).play('@f ' + LINK_HN)
    hn.expr((1, 0.7), (4.9, 0.9), (5, 0.85), (36.9, 0.95), (37, 1.0), (44.9, 1.0))

    # calm: one solo voice at a time
    b.lead('A', REFRAIN, inst='flute', dyn='mf', layer='calm', gain=3)
    b.lead('B', VERSE, inst='clarinet', dyn='mf', layer='calm', gain=3)
    b.lead('AF', REFRAIN, inst='oboe', transpose=3, dyn='mf', layer='calm', gain=4)
    b.lead('C', SKY, inst='flute', dyn='mf', layer='calm')
    b.lead('P', CLIMB, inst='flute', dyn='mf', layer='calm')
    b.lead('AAb', REFRAIN, inst='solo_violin', transpose=6, dyn='f', layer='calm',
           gain=4)
    b.lead('link', LINK, inst='clarinet', dyn='mf', layer='calm')

    # every lead breathes with its phrase: in on the leap, out at the air
    for name, bars in (('tpt', (5, 9, 37, 41)), ('vn2_mel', (5, 9, 21, 25, 29, 33, 37, 41, 45)),
                       ('va_mel', (13, 17)), ('vc_mel', (13, 17)),
                       ('vn_mel', (21, 25, 29, 33, 37, 41, 45)),
                       ('lead_flute', (5, 9, 29, 33)), ('lead_clarinet', (13, 17, 45)),
                       ('lead_oboe', (21, 25)), ('lead_solo_violin', (37, 41))):
        swell(s.parts[name], bars)

    # ================================================================ open fifths
    hp = b.part('harp', 'harp', role='ostinato', calm_db=-5, gain=-1.5)
    mar = b.part('marimba', 'marimba', role='ostinato', layer='full', pan=0.3)
    for sec in ('intro', 'A', 'B', 'AF', 'C', 'P', 'AAb', 'link'):
        fifths(hp, b.bar(sec), b.chart(sec), vel=0.46)
        if sec != 'intro':
            fifths(mar, b.bar(sec), b.chart(sec), figure=MAR_FIG, floor=62,
                   vel=0.42 if sec == 'C' else 0.5)

    # ================================================================ strings
    for sec in ('AF', 'AAb', 'link'):
        b.pads(sec, 'violas', n=2, lo=53, hi=67, art='sus', layer='full')
    b.pads('C', 'violas', n=3, lo=53, hi=69, art='sus', layer='full')
    b.pads('P', 'violas', n=3, lo=53, hi=69, art='trem', layer='full', name='pad_trem')
    b.pads('B', 'violins2', n=2, lo=67, hi=81, vel=0.45, art='soft', name='b_vn2', layer='full')
    celli = b.part('vc_low', 'celli', role='section', layer='full')
    for sec in ('A', 'link'):
        grid_bass(celli, b.bar(sec), b.chart(sec), 'q. h e', 'r r 8', floor=38, vel=0.62,
                  art='spic')
    ost8 = b.part('ost8_celli', 'celli', layer='full', role='ostinato', art='spic')
    for sec in ('AF', 'AAb'):
        grid_ost(ost8, b.bar(sec), b.chart(sec), 'e e e e e e e e', 'b b b b b b b b', lo=38,
                 hi=55, vel=0.64, accents='> - - > - - - -')
    celli_c = b.part('vc_sky', 'celli', role='section', layer='full', art='sus')
    bass(celli_c, b.bar('C'), b.chart('C'), 'h h', 'r 5', floor=38, vel=0.56, art='sus')
    # the climb: the whole low end walks up D-flat, E-flat, F-flat, G-flat
    bass(celli_c, b.bar('P'), b.chart('P'), 'q q q q', 'r r r 8', floor=37, vel=0.62, art='sus')
    b.part('cb', 'basses', layer='full', role='low').at(b.bar('P')).play('%sus @f Db2w | Eb2w | E2w | Gb2w |')
    for sec in ('A', 'AF', 'AAb', 'link'):
        b.low(sec, 'w', layer='full')
    b.low('B', 'w', layer='full')
    b.low('C', 'w', layer='full')
    # the climb: one horn holds A-flat, the coming tonic, under the rising bass
    b.part('hn_ped', 'horns', role='counter', layer='full').at(b.bar('P')).play(
        '@mf Ab3w~ | Ab3w~ | Ab3w~ | Ab3w |')

    # ================================================================ brass
    b.brass_pad('C', 'horns', n=2, lo=48, hi=62, vel=0.46, name='hn_pad')
    # the climax: the push the tune and the kick share becomes the low brass's
    # rhythm, punches with holes (the beat, the and-of-two, then air) so the
    # tune stays on top
    tbn = b.part('tbn', 'trombones', role='section', layer='full', art='stac')
    tuba = b.part('tuba', 'tuba', role='low', layer='full', art='stac')
    for deg in ('0', '1', '2'):
        grid_ost(tbn, b.bar('AAb'), b.chart('AAb'), 'q. e h', f'{deg} {deg} -', lo=46, hi=62,
                 vel=0.68, accents='> - -')
    grid_ost(tuba, b.bar('AAb'), b.chart('AAb'), 'q. e h', 'b b -', lo=28, hi=45, vel=0.7)
    b.brass_pad('link', 'trombones', n=2, lo=45, hi=58, vel=0.5, name='tbn_link')

    # ================================================================ rhythm section
    k = Kit(s, 'kit', gains={'snare': -1.5, 'cym': -3.0})
    b.kit = k
    b.full_only.update(k.names())
    k.play(1, {'tom_lo': 'x.......x.......'}, vel=0.5)
    k.play(2, {'tom_lo': 'x.......x...x...'}, vel=0.56)
    k.play(3, {'kick': 'x.....x.........', 'tom_lo': 'x...x...x...x...', 'tamb': 'x.x.x.x.x.x.x.x.'},
           vel=0.64)
    k.play(4, {'kick': 'x.....x.x.......', 'snare': '........xxxxxxxx', 'tamb': 'x.x.x.x.'},
           vel=0.72, ramp=0.5)
    b.groove('A', ANTHEM, ANTHEM_FILL, every=4)
    b.groove('B', MARCH, MARCH_FILL, every=4)
    b.groove('AF', DRIVE, DRIVE_FILL, every=4)
    b.groove('C', SKY_BEAT, None, vel=0.7)
    b.groove('P', CLIMB_BEAT, None, n_bars=2, vel=0.7)
    k.play(35, {'kick': 'x.......x.......', 'snare': 'x...x...x.x.x.x.'}, vel=0.66, ramp=0.3)
    k.play(36, {'kick': 'x...x...x...x...', 'snare': 'xxxxxxxxxxxxxxxx'}, vel=0.74, ramp=0.5)
    b.groove('AAb', TOP, TOP_FILL, every=4)
    b.groove('link', ANTHEM, ANTHEM_FILL, every=4)

    eb = b.part('ebass', 'rbass', layer='full', role='bass', duck='kit_kick')
    for sec in ('A', 'link'):
        grid_bass(eb, b.bar(sec), b.chart(sec), 'q. h e', 'r r 8', floor=28, vel=0.74)
    # the verse's tune is in the tenor: the bass keeps to the push and leaves
    # the low-mid to it
    bass(eb, b.bar('B'), b.chart('B'), 'q. h e', 'r r 8', floor=28, vel=0.72)
    grid_bass(eb, b.bar('AF'), b.chart('AF'), 'q. e q q', 'r r 8 r', floor=28, vel=0.74)
    bass(eb, b.bar('C'), b.chart('C'), 'q. h e', 'r r 8', floor=28, vel=0.72)
    bass(eb, b.bar('P'), b.chart('P'), 'e e e e e e e e', 'r r r r r r r r', floor=37, vel=0.72)
    grid_bass(eb, b.bar('AAb'), b.chart('AAb'), 'e e e e e e e e', 'r r r r r r 8 r', floor=28,
              vel=0.76, accents='> - - > - - - -')
    for sec in ('A', 'B', 'AF', 'C', 'P', 'AAb', 'link'):
        b.sub(sec)

    # ================================================================ percussion
    b.timp('intro', '%roll @p D2w | %default @f D2q rq rh | Bb2q rq rh | C3q rq C3e C3e C3q |')
    b.part('timp', 'timpani').expr((1, 0.3), (1.95, 1.0), (2, 1.0))
    b.timp('A', '@f D2q rq rh |')
    b.timp('B', '@f D2q rq rh |')
    b.timp('AF', '@ff F2q rq rh |')
    b.timp('C', '@mf Db2q rq rh |')
    b.timp('P', '@f Db2q rq rh | Eb2q rq rh | %roll @mf E2w | Gb2w |')
    b.timp('AAb', '%default @ff Ab2q rq rh |')
    b.timp('link', '@f B2q. G2e rh | G2q rq rh | C3q rq rh | %roll C3w |')
    for bar in (5, 13, 21, 29, 37):
        b.hit(bar)
    b.riser(35, beats=8)
    b.riser(47, beats=6, vel=0.5)

    # ================================================================ calm bed
    for sec in ('A', 'B', 'AF', 'C', 'P', 'AAb', 'link'):
        if sec in ('A', 'AF', 'AAb', 'link'):
            calm_bed_push(b, sec)
        else:
            b.calm_bed(sec, piano='0 2 4 2', piano_lo=57, piano_hi=79)

    # lift, hold, cut, hit: two beats of snare alone before the A-flat refrain
    cut(s, s.bar(36) + 2, s.bar(37))
    return b.finish()
