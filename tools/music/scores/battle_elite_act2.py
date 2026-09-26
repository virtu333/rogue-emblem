"""Act II elite battles — "The Iron Line".

An Imperial heavy company holds the strongpoint on an Old Kingdom road.
F minor at 148, and everything in it moves at the speed of armour: in
three-bar steps.

The stabs are the company's tread. One accented chord falls on the
downbeat; nothing more until beat 3 two bars later, when the same chord
comes again as a pickup and the next one lands on the following downbeat:
five half notes and one, a cycle that crosses the bar line and marks every
third bar (God-Shattering Star's intro, as verified: the old pitch is the
pickup, the new pitch lands, and the chord bass rises by step). Their top
spells the Empire's drill one pitch per stab, F, G-flat, F, E-flat, falling
to D-flat at the next section: the motif Iron Rain hammers as a riff, here
slow and structural. Under the four stabs of A the chord bass (tuba, the
horns' lowest voice) climbs F, G-flat, A-flat, B-flat: i, bII, bVI, bVII
over the tonic.

The riff is the company's machinery: two low bars on F in the reversed
gallop (16th, 16th, 8th), with one flat/natural pair inside it (G-flat in
its shudder, G natural on its climb) and the leading tone as its last note.
It is never changed, only re-rooted, and it is the piece's modulating
agent: B walks it away from F to D-flat, B-flat and G-flat (each a minor
key of its own, the whole texture moving with it), and the tag takes it
to D-flat once more before the break brings it home. In A it keeps the
stab cycle: two bars from each landing, then a bar's rest into which the
pickup stab strikes (the machine stops, the line stamps, it starts
again). That grouping is this piece's own.

The song is the identity a player takes away. Each of its four three-bar
phrases is the stab's own gesture: after the pickup stab two eighths on
the new pitch, then the octave above lands with the landing stab and is
held (the riff's 16th-16th-8th at half speed), and a tail turns down and
stops before the next pickup stab. The heads climb with the chord bass, F,
G-flat, A-flat, B-flat, while the top of the stabs spells the drill:

    F4 F4 | F5-- Eb | Db. C Db Eb | C (stab) Gb4 Gb4 | Gb5-- F | Eb. Db Eb F | Db ...

Nowhere is there a V-i. The tonic arrives over its own pedal, from the
flat side: D-flat minor into F minor (the tag), E-flat over G into F
minor (the end of C), the bass rising by step rather than falling a fifth.

Leitmotif: the Empire's drill (SCORE.md), in the stabs of A, C and the
tag. No Thread: this is the enemy's music. No choir.

Form (bars, 4/4 at 148): intro 1-3 (the riff; the break and the first
pickup) | A1 4-15 (the song on the trumpets, four stab cycles over the
riff on F) | B 16-27 (the riff re-rooted on D-flat, B-flat and G-flat
minor, four bars each; the violins carry one shape down with it, the
trumpets join the third) | C 28-39 (the riff stops; the stabs over a real
bass rising D-flat, E-flat, F, G; the song again, re-harmonised over it
(its first cycle over D-flat major seven), in the horns and then the
trombones, an octave down; the strings take the riff's rhythm onto the
chord, one section more each cycle; one long crescendo) | A2 40-51 (the
tutti: the song on violins an octave up, trumpets and horns; trumpets on
the stabs' top) | tag 52-54 (the drill falls to D-flat, the riff on
D-flat, the break). Loop 4-54, 51 bars.

calm: the riff on the celli alone, the stabs as muted horns, timpani and a
harp strum, a side drum far off tapping the riff's gallop, the low strings
holding the ground; the song on a clarinet (A1), the violins' shape on
soft violins (B), the song on a bassoon (C), oboe and flute (A2).
full: kit (half time in A1, driving in A2), bass guitar on the riff,
brass stabs with the orchestra, boom and bass drum on every landing.

lint: the only sustained semitone left is C against D-flat at bar 30,
the song's C held over the rising bass's D-flat (D-flat major seven),
intended. The G-flat stabs of A sound over the riff's F on purpose (bII
over the tonic: the Empire's grind); the riff's notes are too short for
lint to list.

The VSCO sections are sampled unevenly (see `even` below): every line is
levelled note by note so its zones don't jump.
"""
import numpy as np

from engine.dsp import SR
from engine.instruments import INSTRUMENTS
from engine.patterns import Kit, bass, chart, drums, ostinato, pad
from engine.render import _render_raw
from engine.sampler import NoteEvent
from engine.score import Score
from engine.theory import pitch as parse_pitch

from scores._battle import Battle

KEY = 'music_battle_elite_act2'

# ------------------------------------------------------------------ material
# the riff: two bars on the tonic, the reversed gallop (16th 16th 8th), one
# flat/natural pair inside it (G-flat in the shudder, G on the climb) and the
# leading tone as the last note. It is only ever transposed, never changed.
RIFF = ('F2s F2s F3e F2s Gb2s F2e F2s F2s F3e G2e Ab2e |'
        ' F2s F2s F3e F2s Gb2s F2e C3e Ab2e F2e E2e |')

# the company's song: four three-bar phrases, one per stab cycle. Each
# head is the stab's own gesture: after the pickup stab two eighths on the
# new pitch, then the octave above it lands with the landing stab and is
# held (the riff's 16th-16th-8th at half speed). The heads climb F, G-flat,
# A-flat, B-flat (the chord bass) while the stabs above spell the drill;
# each tail turns down and stops before the next pickup stab.
TUNE = """
F5h. Eb5q | Db5q. C5e Db5q Eb5q | C5h rq Gb4e Gb4e |
Gb5h. F5q | Eb5q. Db5e Eb5q F5q | Db5h rq Ab4e Ab4e |
Ab5h. G5q | F5q. Eb5e F5q G5q | F5h rq Bb4e Bb4e |
Bb5h. C6q | Bb5q. Ab5e G5q F5q | G5h rh |
"""
PICKUP = 'rh rq F4e F4e |'          # the bar before every A: into the first landing
# B: one four-bar shape carried down the riff's roots (D-flat minor, B-flat
# minor, G-flat minor); the whole texture moves as one block
BLINE = """
E5h Db5q Ab5q~ | Ab5h. E5q | Gb5q. E5e Eb5q Db5q | Eb5w |
Db5h Bb4q F5q~ | F5h. Db5q | Eb5q. Db5e C5q Bb4q | C5w |
A5h Gb5q Db6q~ | Db6h. Eb6q | E6q. Db6e B5q A5q | Ab5h. rq |
"""
BLINE3 = 'A5h Gb5q Db6q~ | Db6h. Eb6q | E6q. Db6e B5q A5q | Ab5h. rq |'

# a two-voice bed for the song (violas), voiced by hand around it
PAD_A = ('[Ab3 C4]w | [F3 Ab3]w | [Ab3 C4]w | [Bb3 Db4]w | [Bb3 Db4]w | [Bb3 Db4]w |'
         ' [Db4 F4]w | [Db4 F4]w | [Db4 F4]w | [Bb3 Eb4]w | [Bb3 Eb4]w | [Bb3 Eb4]w |')

# ------------------------------------------------------------------ stabs
# chord voicings per instrument. In A the horns' top spells the drill (F4,
# G-flat4, F4, E-flat4, then D-flat4) above a tuba rising F, G-flat, A-flat,
# B-flat; in C the trumpets spell it an octave up over a real bass rising
# D-flat, E-flat, F, G.
VOICE = {
    'Fm':    dict(hn='Ab3 C4 F4', tbn='C3 F3', tuba='F2', timp='F2', vn='C5 F5'),
    'Gb':    dict(hn='Bb3 Db4 Gb4', tbn='Db3 Gb3', tuba='Gb2', timp='Gb2', vn='Db5 Gb5'),
    'Db/Ab': dict(hn='Ab3 Db4 F4', tbn='Db3 Ab3', tuba='Ab2', timp='Ab2', vn='Db5 F5'),
    'Eb/Bb': dict(hn='G3 Bb3 Eb4', tbn='Eb3 Bb3', tuba='Bb2', timp='Bb2', vn='Bb4 Eb5'),
    'Dbm':   dict(hn='E3 Ab3 Db4', tbn='Ab2 Db3', tuba='Db2', timp='Db2', vn='Ab4 Db5'),
    'Db5':   dict(tpt='Ab4 Db5', hn='Db4 Ab4', tbn='Gb3 Db4', tuba='Gb2', timp='Db2',
                  vn='Ab4 Db5'),
    'Db':    dict(tpt='Db5 F5', hn='Db4 F4 Ab4', tbn='Db3 Ab3', tuba='Db2', timp='Db2',
                  cb='Db2', vn='Ab5 F6'),
    'Ebm':   dict(tpt='Eb5 Gb5', hn='Eb4 Gb4 Bb4', tbn='Eb3 Bb3', tuba='Eb2', timp='Eb2',
                  cb='Eb2', vn='Bb5 Gb6'),
    'FmC':   dict(tpt='C5 F5', hn='F4 Ab4 C5', tbn='F3 C4', tuba='F2', timp='F2', cb='F2',
                  vn='C6 F6'),
    'Eb/G':  dict(tpt='Bb4 Eb5', hn='Eb4 G4 Bb4', tbn='G3 Bb3', tuba='G2', timp='G2', cb='G2',
                  vn='Bb5 Eb6'),
}
A_DRILL = ('Fm', 'Gb', 'Db/Ab', 'Eb/Bb')
C_DRILL = ('Db', 'Ebm', 'FmC', 'Eb/G')

INTRO, A1, B0, C0, A2, TAG = 1, 4, 16, 28, 40, 52


# ------------------------------------------------------------------ even zones
# The VSCO sections are unevenly sampled: the horns' zone from G4 up is about
# 10 dB hotter than the one below it, the contrabasses' from G2 up 11 dB, the
# oboe's A-flat 5 to B-flat 5 12 dB colder than F5, the flute's G6 11 dB
# hotter. A line that crosses a zone jumps. `even` measures each note once
# (the sampler alone, the note's own velocity with its dynamic taken out) and
# writes an expression lane that brings every note to the line's median,
# multiplied into any lane the part already has, so the written dynamics stay.
_LEVELS = {}


def _zone_level(inst, art, key, vel):
    k = (inst, art, key, round(vel, 2))
    if k not in _LEVELS:
        spec = INSTRUMENTS[inst]
        a = art if art in spec['arts'] else 'default'
        cfg = spec['arts'][a]
        # a held note is heard mostly through its sustain, a short one whole
        dur = 3.0 if cfg.get('mode') == 'sustain' else 0.4
        buf = _render_raw(inst, spec, [NoteEvent(t=0.05, dur=dur, key=key, vel=vel, art=a)],
                          int((dur + 1.0) * SR), seed=1)
        seg = buf[int(0.05 * SR):int((0.05 + max(dur, 0.4)) * SR)].astype(np.float64)
        lvl = 10 * np.log10(np.mean(seg ** 2) + 1e-15)
        _LEVELS[k] = lvl - cfg.get('veltrack_db', 14.0) * (vel - 1)
    return _LEVELS[k]


def _lane_at(points, beat):
    if not points:
        return 1.0
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return float(np.interp(beat, xs, ys))


def even(part, tol_db=1.5, cap_db=11.0, boost_db=4.0):
    """Flatten the sampler's zone jumps across a (monophonic) line."""
    spec = INSTRUMENTS[part.inst]
    if spec['kind'] != 'sfz' or not part.notes:
        return part
    notes = sorted(part.notes, key=lambda n: n.start)
    lv = [_zone_level(part.inst, n.art, n.pitch + part.score.transpose, n.vel) for n in notes]
    med = float(np.median(lv))
    old = list(part.expr_points)
    pts = []
    for i, (n, l) in enumerate(zip(notes, lv)):
        off = l - med
        off = 0.0 if abs(off) < tol_db else max(-boost_db, min(cap_db, off))
        v = 10 ** (-off / 26.0)                     # the lane is applied as lane ** 1.3
        end = notes[i + 1].start if i + 1 < len(notes) else n.end + 1.0
        a, z = n.start, max(n.start + 0.02, end - 0.03)
        pts += [(a, v * _lane_at(old, a)), (z, v * _lane_at(old, z))]
    part.expr_points = sorted(pts)
    return part


# drum grids (16 steps)
HALF = {'kick': 'x.x.......x.x...', 'snare': '........X.......', 'hat': 'x.x.x.x.x.x.x.x.'}
HALF_PK = {'kick': 'x.x.......x.x...', 'snare': '........X.....xx', 'hat': 'x.x.x.x.x.x.....'}
DRIVE = {'kick': 'x.x...x.x.x...x.', 'snare': '....X.......X...', 'ride': 'x.x.x.x.x.x.x.x.'}
DRIVE_PK = {'kick': 'x.x...x.x.x.....', 'snare': '....X...X...X.xx', 'ride': 'x.x.x.x.x.x.....'}
WALK = {'kick': 'x.x.....x.x.....', 'snare': '....X.......X...', 'ride': 'X.x.x.x.X.x.x.x.'}
WALK_FILL = {'kick': 'x.x.....x.x.....', 'snare': '....X.......xoxx', 'ride': 'X.x.x.x.X.x.....'}
BREAK = {'tom_hi': 'x.x.............', 'tom_lo': '....x.x.........', 'kick': '........x.......',
         'snare': '........X...xxxx'}
# the calm mix's side drum, far off: the riff's gallop on beats 1 and 3
SIDE = {'sn_taps': 'xxX.....xxX.....'}
SIDE_PK = {'sn_taps': 'xxX.....X...oxox'}


def build():
    s = Score('battle_elite_act2', tonic='F', bpm=148, intro_bars=3, loop_bars=51,
              title='The Iron Line', seed=211)
    s.reverb = dict(rt60=2.1, predelay_ms=24, wet_db=-1.5, damp=0.5)
    s.master = dict(lufs=-14.0, glue_ratio=1.6)
    b = Battle(s, calm_lufs=-17.0, full_lufs=-14.0)
    b.section('intro', INTRO, chart('Fm:8 Dbm:4'))
    b.section('A1', A1, chart('Fm:12 Gb:12 Db/F:12 Eb:12'))
    b.section('B', B0, chart('Dbm:16 Bbm:16 Gbm:16'))
    b.section('C', C0, chart('Db:12 Ebm:12 Fm:12 Eb/G:12'))
    b.section('A2', A2, chart('Fm:12 Gb:12 Db/F:12 Eb:12'))
    b.section('tag', TAG, chart('Dbm:12'))
    # B: each unit's last bar and a half hold the second degree: sus2, not minor
    CH_BPAD = chart('Dbm:10 Dbsus2:6 Bbm:10 Bbsus2:6 Gbm:10 Gbsus2:6')
    CH_C = b.chart('C')

    # ================================================================ the riff
    vc = b.part('riff_vc', 'celli', role='lead2', art='spic', calm_db=0)
    eb = b.part('ebass', 'rbass', layer='full', role='bass', duck='kit_kick')

    def riff(bar, shift, n=1, eb_shift=-12, every=2):
        for i in range(n):
            at = bar + every * i
            vc.at(at).play('%spic @f ' + RIFF, transpose=shift)
            eb.at(at).play('@f ' + RIFF, transpose=shift + eb_shift)

    # in A the riff keeps the stab cycle: its two bars from each landing,
    # then a bar's rest in which the pickup stab sounds alone
    riff(INTRO, 0)
    riff(A1, 0, 4, every=3)
    riff(B0, -4, 2, eb_shift=0)       # D-flat (bass guitar an octave up: D-flat 2)
    riff(B0 + 4, 5, 2)                # B-flat
    riff(B0 + 8, 1, 2)                # G-flat
    riff(A2, 0, 4, every=3)
    riff(TAG, -4, 1, eb_shift=0)
    sub = b.part('sub', 'sub', layer='full', role='sub')
    for sec in ('B', 'tag'):
        bass(sub, b.bar(sec), b.chart(sec), 'w', 'b', floor=26, vel=0.6)
    CH_RISE = chart('Db:12 Eb:12 F:12 G:12')     # C's bass, rising by step
    bass(sub, C0, CH_RISE, 'w', 'r', floor=25, vel=0.6)

    # ================================================================ the stabs
    stp = b.part('stab_tpt', 'trumpets', role='section', layer='full', art='stac', gain=6)
    shn = b.part('stab_hn', 'horns', role='section', layer='full', art='stac', gain=7)
    stb = b.part('stab_tbn', 'trombones', role='section', layer='full', art='stac', gain=6)
    stu = b.part('stab_tuba', 'tuba', role='low', layer='full', art='stac', gain=4)
    svn = b.part('stab_vn', 'violins', role='accent', layer='full', art='stac', gain=3)
    scb = b.part('stab_cb', 'basses', role='low', art='stac', calm_db=-4)
    tmp = b.part('timp', 'timpani', role='timp', calm_db=0, gain=-2)
    cst = b.part('cstab_hn', 'horns', role='section', layer='calm', art='mute', gain=3)
    perc = b.part('perc', 'orch_perc', role='accent', calm_db=-5, gain=2)
    boom = b.part('boom', 'boom', role='fx', layer='full', gain=4)
    charp = b.part('c_harp', 'harp', role='accent', layer='calm', gain=3)

    def stab(bar, beat, ch, land=True, lift=0.0):
        v = VOICE[ch]
        t = s.bar(bar) + beat - 1
        vel = (0.92 if land else 0.82) + lift
        for key, part in (('tpt', stp), ('hn', shn), ('tbn', stb), ('vn', svn)):
            for p in v.get(key, '').split():
                part.note(t, p, 1.0, vel=vel, art='stac')
        stu.note(t, v['tuba'], 1.0, vel=vel, art='stac')
        if 'cb' in v:
            scb.note(t, v['cb'], 1.0, vel=vel, art='stac')
        for p in v['hn'].split():
            cst.note(t, p, 0.75, vel=vel - 0.22, art='mute')
        # the calm stab: the horns' chord struck on the harp, low to high
        strum = sorted({parse_pitch(v['tuba']) + 12} | {parse_pitch(p) for p in
                       (v['hn'] + ' ' + v['vn']).split()})
        for k, p in enumerate(strum):
            charp.note(t + 0.06 * k, p, 2.0, vel=0.62 if land else 0.5)
        tmp.note(t, v['timp'], 1.0, vel=vel - 0.05, art='default')
        perc.note(t, 36, 1.0, vel=vel - (0.0 if land else 0.15))
        if land:
            boom.note(t, parse_pitch(v['tuba']) - 12, 2.0, vel=0.8)

    def cycle(bar, ch):
        """A landing on beat 1 of `bar`, and the same chord again as the
        pickup on beat 3 two bars later: 5 + 1 half notes, then the next."""
        stab(bar, 1, ch, land=True)
        stab(bar + 2, 3, ch, land=False)

    stab(INTRO + 2, 3, 'Dbm', land=False)             # into the first landing
    for a in (A1, A2):
        for i, ch in enumerate(A_DRILL):
            cycle(a + 3 * i, ch)
    for i, ch in enumerate(A_DRILL):          # A2: the trumpets take the drill's top too
        top = VOICE[ch]['hn'].split()[-1]
        for bar, beat in ((A2 + 3 * i, 1), (A2 + 3 * i + 2, 3)):
            stp.note(s.bar(bar) + beat - 1, parse_pitch(top) + 12, 1.0, vel=0.9, art='stac')
    stab(B0, 1, 'Dbm')                                # the drill falls to D-flat
    for bar, beat, p in ((B0 + 2, 3, 'Db2'), (B0 + 3, 1, 'Db2'), (B0 + 5, 3, 'Bb2'),
                         (B0 + 6, 1, 'Bb2'), (B0 + 8, 3, 'Gb2'), (B0 + 9, 1, 'Gb2')):
        tmp.note(s.bar(bar) + beat - 1, p, 1.0, vel=0.7, art='default')
    stab(B0 + 11, 3, 'Db5', land=False)
    for i, ch in enumerate(C_DRILL):         # C grows louder, cycle by cycle
        stab(C0 + 3 * i, 1, ch, land=True, lift=0.04 * i - 0.14)
        stab(C0 + 3 * i + 2, 3, ch, land=False, lift=0.04 * i - 0.12)
    stab(TAG, 1, 'Dbm')
    stab(TAG + 2, 3, 'Dbm', land=False)

    # ================================================================ tunes
    # the song: A1 on the trumpets alone (the horns are the stabs); the
    # pickups before every A land it on the first stab
    tpt = b.part('tune_tpt', 'trumpets', role='lead', layer='full', gain=2)
    for bar in (INTRO + 2, TAG + 2):
        tpt.at(bar).play('@f ' + PICKUP)
    tpt.at(A1).play('@f ' + TUNE)
    ccl = b.part('c_tune_cl', 'clarinet', role='lead', layer='calm', gain=1)
    for bar in (INTRO + 2, TAG + 2):
        ccl.at(bar).play('@mf ' + PICKUP)
    ccl.at(A1).play('@mf ' + TUNE)
    # B: the violins, the one shape carried down the riff's roots
    b.lead('B', BLINE, inst='violins', name='b_vn', dyn='f', art='sus', layer='full', gain=4)
    b.lead('B', BLINE, inst='violins2', name='b_vn2', transpose=-12, dyn='f', art='sus',
           layer='full', role='lead2')
    b.part('b_tpt', 'trumpets', role='lead2', layer='full').at(B0 + 8).play(
        '@f ' + BLINE3, transpose=-12)
    csv = b.part('c_b_vn', 'violins', role='lead', layer='calm', art='soft')
    csv.at(B0).play('%soft @mf ' + BLINE)
    # C: the song again, re-harmonised over the rising bass (its first
    # cycle over D-flat major seven), in the company's own low voice: the
    # horns an octave down, the trombones joining them from the second cycle;
    # in the calm mix a bassoon
    csong = PICKUP + TUNE.strip().rsplit('|', 2)[0] + '| G5h rq F4e F4e |'
    chn = b.part('c_hn', 'horns', role='lead', layer='full', gain=1)
    chn.at(C0 - 1).play('@f ' + csong, transpose=-12)
    ctb = b.part('c_tbn', 'trombones', role='lead2', layer='full')
    ctb.at(C0 - 1).play('@f ' + csong, transpose=-12)
    ctb.notes = [n for n in ctb.notes if n.start >= s.bar(C0 + 2) + 3 - 1e-6]
    tpt.at(C0 + 11).play('@f rh rq F4e F4e |')          # into A2
    # one long crescendo from the first cycle to A2
    for p_ in (chn, ctb):
        p_.expr((C0 - 1, 0.5), (C0 + 11.9, 0.95), (C0 + 12, 0.95))
    cbn = b.part('c_bsn', 'bassoon', role='lead', layer='calm', gain=1)
    cbn.at(C0 - 1).play('@mf ' + csong, transpose=-12)
    # A2: the tutti, the song in three octaves
    vn8 = b.part('a2_vn', 'violins', role='lead', layer='full', art='sus')
    vn8.at(A2).play('@ff ' + TUNE, transpose=12)
    tpt.at(A2).play('@ff ' + TUNE)
    hn8 = b.part('tune_hn', 'horns', role='lead2', layer='full')
    hn8.at(A2 - 1).play('@ff ' + PICKUP + TUNE, transpose=-12)
    cob = b.part('c_a2_ob', 'oboe', role='lead', layer='calm', gain=-1)
    cob.at(A2 - 1).play('@mp ' + PICKUP + TUNE)
    cfl = b.part('c_a2_fl', 'flute', role='lead2', layer='calm', gain=-2)
    cfl.at(A2 - 1).play('@mp ' + PICKUP + TUNE, transpose=12)

    # ================================================================ harmony
    cva = b.part('c_pad_va', 'violas', role='pad', art='soft', layer='calm', gain=2)
    cva.at(A1).play('%soft @mp ' + PAD_A)
    cva.at(A2).play('%soft @mp ' + PAD_A)
    pva = b.part('pad_va', 'violas', role='pad', art='soft', layer='calm')
    pad(pva, B0, CH_BPAD, n=2, lo=55, hi=69, vel=0.5, art='soft')
    hp = b.part('b_hn_pad', 'horns', role='pad', layer='full')
    pad(hp, B0, CH_BPAD, n=2, lo=56, hi=68, vel=0.5)

    # ================================================================ C: the line
    # the bass rises by step under the stabs, held by the basses and pulsed
    # by the bass guitar; the strings take the riff's rhythm (16th 16th 8th)
    # onto the chord, one section more each cycle
    rise = b.part('c_rise', 'basses', role='low', art='sus', calm_db=-4)
    for i, ch in enumerate(C_DRILL):
        r = VOICE[ch]['cb']
        rise.at(C0 + 3 * i).play(f'@mf {r}w~ | {r}w~ | {r}w |')
    bass(eb, C0 + 3, CH_RISE[1:], 'e e e e e e e e', 'r r r r r r r r', floor=37, vel=0.72,
         accents='> - - > - - > -')
    mva = b.part('c_mot_va', 'violas', role='ostinato', art='spic', calm_db=-3, gain=-2)
    ostinato(mva, C0, CH_C, 's s e', '0 0 2', lo=65, hi=80, vel=0.6, accents='> - -')
    mv2 = b.part('c_mot_vn2', 'violins2', role='ostinato', art='spic', layer='full', gain=-2)
    ostinato(mv2, C0 + 3, CH_C[1:], 's s e', '0 0 2', lo=72, hi=88, vel=0.58,
             accents='> - -')
    mvc = b.part('c_mot_vn', 'violins', role='ostinato', art='spic', layer='full', gain=-2)
    ostinato(mvc, C0 + 6, CH_C[2:], 's s e', '2 2 0', lo=79, hi=94, vel=0.6,
             accents='> - -')
    for p in (mva, mv2, mvc):
        p.expr((C0, 0.5), (C0 + 11.9, 1.0), (C0 + 12, 0.9))
    rise.expr((C0, 0.6), (C0 + 11.9, 1.0), (C0 + 12, 1.0))

    # ================================================================ drums
    kit = Kit(s, 'kit', gains={'snare': 1.5, 'kick': 0.5})
    b.kit = kit
    b.full_only.update(kit.names())
    kit.play(1, {'kick': 'x.x.......x.x...', 'hat': 'x.x.x.x.x.x.x.x.'}, vel=0.6)
    kit.play(2, {'kick': 'x.x.......x.x...', 'hat': 'x.x.x.x.x.x.x.x.'}, vel=0.68)
    kit.play(3, BREAK, vel=0.8, ramp=0.3)
    for i in range(12):
        # every third bar carries the pickup: the snare leads into the landing
        kit.play(A1 + i, HALF_PK if i % 3 == 2 else HALF, vel=0.76)
    for i in range(11):
        kit.play(B0 + i, WALK_FILL if i % 4 == 3 else WALK, vel=0.74)
    kit.play(B0 + 11, BREAK, vel=0.82)
    c_grooves = (
        {'kick': 'x.......x.......', 'tom_lo': 'xxx.....xxx.....'},
        {'kick': 'x.......x.......', 'tom_lo': 'xxx.....xxx.....', 'hat': 'x.x.x.x.x.x.x.x.'},
        {'kick': 'x.x...x.x.x...x.', 'tom_lo': 'xxx.....xxx.....', 'snare': '....X.......X...',
         'hat': 'x.x.x.x.x.x.x.x.'},
        {'kick': 'x.x...x.x.x...x.', 'tom_lo': 'xxx.....xxx.....', 'snare': '....X.......X...',
         'ride': 'x.x.x.x.x.x.x.x.'},
    )
    for i in range(11):
        g = dict(c_grooves[i // 3])
        if i % 3 == 2:
            g['snare'] = g.get('snare', '................')[:12] + '..xx'
        kit.play(C0 + i, g, vel=0.64 + 0.014 * i)
    kit.play(C0 + 11, {'kick': 'x.x.x.x.x.......', 'snare': 'x.x.x.x.X...xxXX',
                       'tom_lo': 'xxx.............'}, vel=0.86, ramp=0.3)
    for i in range(12):
        kit.play(A2 + i, DRIVE_PK if i % 3 == 2 else DRIVE, vel=0.84)
    kit.play(TAG, HALF, vel=0.76)
    kit.play(TAG + 1, HALF, vel=0.76)
    kit.play(TAG + 2, BREAK, vel=0.8, ramp=0.3)
    # the landings ring
    for bar in (A1, B0, C0, A2, TAG):
        kit.play(bar, {'crash': 'X'})
    for a in (A1, C0):
        for k in (3, 6, 9):
            kit.play(a + k, {'crash2': 'x'})
    for k in (3, 6, 9):
        kit.play(A2 + k, {'crash': 'X', 'crash2': 'x'})

    tmp.at(1).play('%roll @p F2w~ | F2w |')
    tmp.at(C0 + 11).play('%roll @mf G2w |')            # into A2
    tmp.expr((1, 0.3), (2.95, 1.0), (3, 1.0), (A1, 1.0), (C0 + 10.99, 1.0), (C0 + 11, 0.3),
             (C0 + 11.97, 1.0))
    b.riser(C0 + 10, beats=8, vel=0.5)
    b.riser(B0 + 10, beats=8, vel=0.5)

    # ================================================================ calm bed
    # far off: the company's side drum keeps the riff's gallop, with a ruff
    # into every landing
    side = b.part('c_side', 'orch_perc', role='accent', layer='calm', pan=-0.3, gain=1)
    for sec in ('A1', 'C', 'A2'):
        for i in range(12):
            drums(side, b.bar(sec) + i, SIDE_PK if i % 3 == 2 else SIDE, vel=0.5)
    # the low strings hold the ground under the calm mix: F under the riff,
    # B-flat through the G-flat cycle (the chord's third, a fifth under F)
    clo = b.part('c_low', 'basses', role='low', art='soft', layer='calm', gain=4, hpf=32)
    cvc = b.part('c_low_vc', 'celli', role='bass', art='soft', layer='calm', gain=0)
    for bar in (A1, A2):
        clo.at(bar).play('%soft @mf F1w~ | F1w~ | F1w | Bb1w~ | Bb1w~ | Bb1w | F1w~ | F1w~ |'
                         ' F1w~ | F1w~ | F1w~ | F1w |')
        cvc.at(bar).play('%soft @mp Ab2w~ | Ab2w~ | Ab2h rh | Db3w~ | Db3w~ | Db3h rh | F2w~ |'
                         ' F2w~ | F2h rh | Bb2w~ | Bb2w~ | Bb2h rh |')
    clo.at(INTRO).play('%soft @mp F1w~ | F1w | Db2h rh |')
    clo.at(B0).play('%soft @mf Db2w~ | Db2w~ | Db2w~ | Db2w | Bb1w~ | Bb1w~ | Bb1w~ | Bb1w |'
                    ' Gb1w~ | Gb1w~ | Gb1w~ | Gb1h rh |')
    cvc.at(B0).play('%soft @mp Ab2w~ | Ab2w~ | Ab2w~ | Ab2w | F2w~ | F2w~ | F2w~ | F2w |'
                    ' Db3w~ | Db3w~ | Db3w~ | Db3h rh |')
    clo.at(TAG).play('%soft @mf Db2w~ | Db2w | Db2h rh |')
    # even out the sampler's zones along every line
    for name in ('tune_tpt', 'c_tune_cl', 'b_vn', 'b_vn2', 'b_tpt', 'c_b_vn', 'c_hn', 'c_tbn',
                 'c_bsn', 'a2_vn', 'tune_hn', 'c_a2_ob', 'c_a2_fl', 'c_rise', 'c_low', 'c_low_vc',
                 'riff_vc', 'c_mot_va', 'c_mot_vn2', 'c_mot_vn', 'stab_cb'):
        even(s.parts[name])
    return b.finish()
