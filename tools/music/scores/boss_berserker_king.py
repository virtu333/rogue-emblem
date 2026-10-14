"""The Berserker King — "Frightened Acclaim".

Act III's berserker, founder of the berserk school and its own cautionary tale,
crowned by the acclaim of everyone too frightened to object. The corruption
changed nothing in him. Orchestral metal in A, 4/4: the King is a band (the
Emilyguitar through engine/guitar.py, double-tracked open chords and palm mutes
down to A1, the Growlybass, a double-kick kit, taiko, low brass); his court is a
low choir, horns and an organ singing a coronation anthem in D minor.

Mechanism: RAGE, AND THE COURT THAT CHEERS IT.

  * The rage is the tempo. The loop starts at 150 and accelerates without a break
    to 180 (a ramp over bars 5-44), every part with it.
  * The King never changes. His riff (the card's cell, A A C B A E, then a palm-
    muted burst, a B-flat slammed on beat 2 and F-E back to A) is one two-bar riff
    on one chord, A, played the same every time; his tune is the cell augmented,
    falling at the end down the Phrygian scale onto A through B-flat. Only the
    speed and the doubling change: in the last strain he plays the same tune
    tremolo-picked, each note shredded into sixteenths.
  * The court's anthem is a coronation tune in D minor, in half notes (C F A G F
    D G, A C Bb A G Bb A), harmonised Dm Am B-flat E-half-diminished, Dm Gm
    Gm/B-flat, then a bare A, over a bass that walks D A B-flat E, D G B-flat A
    (the band answers the half-diminished chord with a tritone, E and B-flat).
    D minor and A Phrygian are the same seven notes, so the court sings in the
    King's own scale with another tonic, and never reaches it: the anthem's last
    note is A, D minor's dominant, and the band takes it as the King's root
    (B-flat to A, the Phrygian cadence, on a bare fifth: there is no A major chord
    anywhere). In the rushed strains the riff cuts that A off after a beat. The
    court sings low and dark: the choir's tune an octave under the violins' with
    the basses an octave under that, the horns with it, a darkened 'oo' choir for
    its pad, no trumpets until the crowning (and there in the same low octave).
  * Frightened acclaim is diminution: each time the court sings, its notes are
    shorter. The anthem in half notes (B), then in quarters (C), and the second time
    round in C the violins gabble it in eighths, in two octaves, over the choir's
    quarters, the court racing its own anthem at two speeds at once. The two copies
    agree (the fast one ends on the lean too, B-flat over the A).
  * The crowning: the tempo drops from 180 to 150 into a half-time breakdown, so
    the anthem's half notes fall at 75 to the minute, exactly the stately pace of
    the intro: only at the crowning does the court get to sing it as written, with
    the organ, low bells, trumpets and trombones (and the King's lead guitar on the
    tune), while the band crushes its chords in a 3+3+4+3+3 chug. Its last A is
    held over a fill, and the riff's F-E pickup returns the loop to the first bar
    at the same 150.

Form (bars): intro 1-4 (150: the court strikes up the anthem's first bars, Dm to
Am, and is cut off on its dominant, A, by the King's cell in unison blows, then
the riff's second bar) | A 5-12 (the King: the riff, his tune on horns and
trombones, the lead guitar joins at 9) | B 13-20 (the acclamation: the anthem
stately in half notes over a gallop, the guitars a step back; bar 20 its A cut
off by the riff) | A2 21-28 (the King again, twin leads in thirds, the choir
cheering on cue: open fifths on the riff's A, B-flat major on its slam) | C 29-36
(the court rushes: the anthem in quarters twice over a straight eighth-note
drive; the second time the gabble in eighths against it) | E 37-44 (rage: the
King's tune tremolo-picked by both leads over the double kick, the choir singing
it with him an octave under; bar 44 slams A and stops for a beat) | D 45-52 (the
crowning: 150, half time; the anthem as written, the band's chords crushed under
it). Loop 5-52, 48 bars; the tempo is marked at bar 5 (150, ramping to 180) and
bar 45 (150).

Enrage layer (`enrage_berserker_king`): blows on every beat, always on A. Taiko,
bass drum, marcato trombones and tuba and a palm-muted guitar octave strike the
King's root on every quarter of the loop, under the court's chords as well (they
are sung over his A: Dm and Gm over A, the B-flat grinding against it, the
half-diminished chord turned into an A7 with a flat ninth and no third), and the
crowning's half time is no longer allowed to breathe.
"""

from engine.patterns import Kit, chart, drums, pad
from engine.score import Score
from engine.theory import pitch as _p

from scores._battle import Battle

KEY = 'music_boss_berserker_king'
BAR = 4.0

INTRO, A1, B1, A2, C1, E1, D1, END = 1, 5, 13, 21, 29, 37, 45, 53

# ------------------------------------------------------------------ the King
# the riff: two bars, (beat, beats, root, kind, accent). kind: 'pm' a palm-muted
# chug, 'open' a ringing power chord, 'oct' a bare octave (the cell's B)
R1 = [(0.0, 0.5, 'A', 'pm', 1), (0.5, 0.5, 'A', 'pm', 0), (1.0, 0.5, 'C', 'open', 1),
      (1.5, 0.5, 'B', 'oct', 0), (2.0, 1.0, 'A', 'open', 1), (3.0, 1.0, 'E', 'open', 0)]
R2 = [(0.0, 0.25, 'A', 'pm', 1), (0.25, 0.25, 'A', 'pm', 0), (0.5, 0.25, 'A', 'pm', 0),
      (0.75, 0.25, 'A', 'pm', 0), (1.0, 1.0, 'Bb', 'open', 2), (2.0, 0.25, 'A', 'pm', 1),
      (2.25, 0.25, 'A', 'pm', 0), (2.5, 0.5, 'A', 'pm', 0), (3.0, 0.5, 'F', 'open', 1),
      (3.5, 0.5, 'E', 'open', 1)]
PC = {'A': 9, 'Bb': 10, 'B': 11, 'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7}
# the bass takes the card's shape low: the E falls a fourth (E1), the F falls too
BASS = {'A': 33, 'Bb': 34, 'B': 35, 'C': 36, 'E': 28, 'F': 29, 'D': 38, 'G': 31}

# his tune: the cell augmented, A A C B | A Bb E; at the end a fall down the
# Phrygian scale, G F E D C Bb A
KING = [('A4', 1), ('A4', 1), ('C5', 1), ('B4', 1), ('A4', 1), ('Bb4', 1), ('E5', 2),
        ('G5', 1), ('G5', 1), ('F5', 1), ('E5', 1), ('D5', 3), ('E5', 1),
        ('A4', 1), ('A4', 1), ('C5', 1), ('B4', 1), ('A4', 1), ('Bb4', 1), ('A5', 2),
        ('G5', 1), ('F5', 1), ('E5', 1), ('D5', 1), ('C5', 1), ('Bb4', 1), ('A4', 2)]
# the second lead, mostly a third below (a sixth under the held D, which has to sit
# on both the riff's A and its B-flat)
KING_LO = [('F4', 1), ('F4', 1), ('A4', 1), ('G4', 1), ('F4', 1), ('G4', 1), ('C5', 2),
           ('E5', 1), ('E5', 1), ('D5', 1), ('C5', 1), ('F4', 3), ('C5', 1),
           ('F4', 1), ('F4', 1), ('A4', 1), ('G4', 1), ('F4', 1), ('G4', 1), ('F5', 2),
           ('E5', 1), ('D5', 1), ('C5', 1), ('B4', 1), ('A4', 1), ('G4', 1), ('F4', 2)]

# ------------------------------------------------------------------ the court
# the coronation anthem, D minor, as written (half-note pulse: two bars of 4/4
# each hold four of its "beats"); its last note is A, the court's dominant and
# the King's root
ANTHEM = [('C5', 1.5), ('C5', 0.5), ('F5', 2), ('A5', 3), ('G5', 1), ('F5', 2), ('D5', 2),
          ('G5', 4), ('A5', 1.5), ('A5', 0.5), ('C6', 2), ('Bb5', 3), ('A5', 1),
          ('G5', 2), ('Bb5', 2), ('A5', 4)]
# i v bVI ii-half-diminished | i iv iv/Bb, then the bare A: the bass walks
# D A Bb E, D G Bb A, B-flat to A the Phrygian cadence; no A major anywhere
ANTHEM_CH = [('Dm', 4), ('Am', 4), ('Bb', 4), ('Em7b5', 4), ('Dm', 4), ('Gm', 4),
             ('Gm/Bb', 4), ('A5', 4)]


def text(notes, scale=1.0, last=None, transpose=0):
    """Note list -> notation, durations scaled; `last` replaces the final duration
    (the cut-off A) and pads the rest with a rest."""
    out = []
    for i, (p, d) in enumerate(notes):
        d *= scale
        if last is not None and i == len(notes) - 1:
            out.append(f'{p}:{last:g}')
            if d - last > 1e-9:
                out.append(f'r:{d - last:g}')
            continue
        out.append(f'{p}:{d:g}')
    return ' '.join(out)


def anthem_chart(scale=1.0, last=None):
    ch = [(c, d * scale) for c, d in ANTHEM_CH]
    if last is not None:
        ch[-1] = (ch[-1][0], last)
    return chart(' '.join(f'{c}:{d:g}' for c, d in ch))


def g_root(name):
    """Guitar root, A1..G#2 (the Emilyguitar reaches A1)."""
    return 33 + (PC[name] - 9) % 12


def b_root(name):
    """Bass guitar root, E1..Eb2."""
    return 28 + (PC[name] - 4) % 12


def voicing(name, kind, fifth=7):
    r = g_root(name)
    if kind == 'oct' or fifth == 12:
        return [r, r + 12]
    if kind == 'pm':
        return [r, r + fifth]
    return [r, r + fifth, r + 12]


def strum(part, t, dur, notes, vel):
    for i, p in enumerate(notes):
        part.note(t + i * 0.012, p, max(0.05, dur - i * 0.012), vel=vel)


PC_NAME = {v: k for k, v in PC.items()}


def chord_name(c):
    """The band's root: the chord's bass ('Gm/Bb' -> 'Bb', 'Em7b5' -> 'E')."""
    return PC_NAME[c.bass]


def band_fifth(c):
    """What the band stacks on the court's bass: its fifth when the chord has it,
    the tritone on the half-diminished chord (E and B-flat), else a bare octave."""
    pcs = set(c.pcs)
    for iv in (7, 6):
        if (c.bass + iv) % 12 in pcs:
            return iv
    return 12


def build():
    s = Score('boss_berserker_king', tonic='A', bpm=150, intro_bars=4, loop_bars=48,
              title='Frightened Acclaim', seed=1747)
    # the rage: 150 -> 180 across bars 5-44; the crowning drops back to 150, the
    # tempo the loop starts on, so the seam is at one speed
    s.tempo(A1, 150, ramp_to=180)
    s.tempo(D1, 150)
    s.reverb = dict(rt60=2.3, predelay_ms=24, wet_db=-1.5, room_db=-4)
    s.master = dict(lufs=-13.5, glue_ratio=1.6, lead_duck=2.0)
    b = Battle(s, full_lufs=-13.5, adaptive=False)
    b.section('A', A1, chart('A5:32')).section('B', B1, anthem_chart())
    b.section('A2', A2, chart('A5:32')).section('E', E1, chart('A5:32'))
    b.section('D', D1, anthem_chart())

    def T(bar, beat=0.0):
        return s.bar(bar) + beat

    # ------------------------------------------------ the band
    amp_rhythm = dict(rig=True, gain_db=29, tight=135, mid_hz=700, mid_db=0.5, bias=0.3,
                      mid2_db=-3.0, treble_db=1.0, presence_db=2.0)
    amp_pm = dict(rig=True, gain_db=27, palm=True, tight=120, mid_db=0.5, bias=0.3,
                  treble_db=0.5)
    amp_lead = dict(rig=True, gain_db=31, tight=170, mid_hz=850, mid_db=4.5, bias=0.2,
                    treble_db=2.0, presence_db=2.0, delay_mix=0.14, delay_s=0.28,
                    delay_fb=0.28)
    # (the rhythm guitars lose some low-mid mud and sit a little under the kit)
    GTR_EQ = [('peak', 300, 0.9, -3.0)]
    gL = b.part('gtr_L', 'egtr', role='section', pan=-0.95, width=0.0, amp=amp_rhythm,
                reverb=0.06, eq=GTR_EQ, gain=-2.0)
    gR = b.part('gtr_R', 'egtr2', role='section', pan=0.95, width=0.0, amp=amp_rhythm,
                reverb=0.06, eq=GTR_EQ, gain=-2.0)
    pL = b.part('pm_L', 'egtr_pm', role='section', pan=-0.85, width=0.0, amp=amp_pm,
                reverb=0.04, eq=GTR_EQ, gain=-3.0)
    pR = b.part('pm_R', 'egtr_pm2', role='section', pan=0.85, width=0.0, amp=amp_pm,
                reverb=0.04, eq=GTR_EQ, gain=-3.0)
    lead = b.part('lead', 'egtr', role='lead', pan=0.12, width=0.0, amp=amp_lead,
                  reverb=0.16, humanize_ms=3)
    lead2 = b.part('lead2', 'egtr3', role='lead2', pan=-0.12, width=0.0, amp=amp_lead,
                   reverb=0.16, humanize_ms=3)
    ebass = b.part('ebass', 'rbass', role='bass', duck=None)
    kit = Kit(s, 'kit', gains={'kick': 2.5, 'snare': 2.0, 'toms': 1.0, 'cym': 0.0})
    b.kit = kit
    K = kit.play

    # the orchestra
    hn = b.part('hn', 'horns', role='lead2', eq=[('peak', 300, 1.0, -2.0)])
    tbn = b.part('tbn', 'trombones', role='section')
    tuba = b.part('tuba', 'tuba', role='low')
    tpt = b.part('tpt', 'trumpets', role='lead2')
    vc = b.part('vc_riff', 'celli', role='ostinato', art='spic')
    cb = b.part('cb_riff', 'basses', role='low', art='spic')
    lowsus = b.part('low_sus', 'celli', role='low', art='sus')
    cbsus = b.part('cb_sus', 'basses', role='low', art='sus')
    vn = b.part('vn', 'violins', role='lead2', art='sus')
    vn2 = b.part('vn2', 'violins2', role='section', art='sus')
    sop = b.part('choir_sop', 'choir', role='lead', gain=2.0)
    # (sung low, the stately anthem needs a little more of the choir to carry)
    sop.opts['fader'] = [(1, 0), (12.9, 0), (13, 1.5), (19.9, 1.5), (20, 0), (52.9, 0)]
    # (the court sings low, so its lower octave and the horns give up some low-mid
    # weight to the band)
    LOWMID = [('peak', 280, 1.0, -3.0)]
    ten = b.part('choir_ten', 'choir', role='lead2', gain=-2.5, eq=LOWMID)
    # (the court's pad is the darkened choir, 'oo' rather than 'ah')
    cpad = b.part('choir_pad', 'oohs', role='choir')
    stab = b.part('choir_stab', 'choir', role='choir', gain=1.0)
    organ = b.part('organ', 'organ', role='keys', art='loud', gain=-2.0)
    bells = b.part('bells', 'bells', role='accent', art='damp', gain=-3.0)
    timp = b.part('timp', 'timpani', role='timp')
    taiko = b.part('taiko', 'taiko', role='drums', gain=-1.0)
    perc = b.part('perc', 'orch_perc', role='accent')

    # ------------------------------------------------ helpers
    def riff(bar, which, vel=0.8, strings=True, cut=None, start=0.0):
        """One riff bar (R1 or R2) at `bar`, from beat `start`; `cut` drops events at
        or after that beat."""
        for t, d, root, kind, acc in (R1 if which == 1 else R2):
            if cut is not None and t >= cut - 1e-9 or t < start - 1e-9:
                continue
            v = min(1.0, vel + (0.1 if acc == 1 else 0.18 if acc == 2 else 0.0))
            t0 = T(bar, t)
            if kind == 'pm':
                for i, part in enumerate((pL, pR)):
                    strum(part, t0 + 0.008 * i, d * 0.85, voicing(root, 'pm'), v)
            else:
                for i, part in enumerate((gL, gR)):
                    strum(part, t0 + 0.008 * i, d * 0.92, voicing(root, kind), v)
            ebass.note(t0, BASS[root], d * 0.88, vel=v)
            if strings and (d >= 0.5 or acc):
                cb.note(t0, BASS[root] if BASS[root] >= 28 else BASS[root] + 12,
                        max(d, 0.5) * 0.9, vel=v - 0.08, art='spic')
                vc.note(t0, g_root(root) + 12, max(d, 0.5) * 0.9, vel=v - 0.1, art='spic')

    def riffs(bar, n_bars, vel=0.8):
        for i in range(n_bars):
            riff(bar + i, 1 + i % 2, vel=vel)

    TL = []

    def chord_timeline(bar, ch):
        t = T(bar)
        for c, d in ch:
            TL.append((t, d, c))
            t += d

    def chord_at(beat):
        for t, d, c in TL:
            if t - 1e-9 <= beat < t + d - 1e-9:
                return c
        raise ValueError(f'no chord at beat {beat}')

    def court_band(bar, beats, mode, vel=0.76, pattern=None):
        """The band under the anthem: power chords on the court's roots.
        gallop: e s s a beat, an open chord struck on each change; sixteen: palm-muted
        sixteenths, an open chord on each change; crush: the breakdown's chugs."""
        t0 = T(bar)
        last = None
        steps = []
        if mode == 'gallop':
            for q in range(int(beats)):
                steps += [(q, 0.5), (q + 0.5, 0.25), (q + 0.75, 0.25)]
        elif mode == 'sixteen':
            steps = [(i * 0.25, 0.25) for i in range(int(beats * 4))]
        elif mode == 'crush':
            for k in range(int(beats // 4)):
                cells = [i for i, c in enumerate(pattern) if c != '.']
                for j, i in enumerate(cells):
                    nxt = cells[j + 1] if j + 1 < len(cells) else 16
                    steps.append((k * 4 + i * 0.25, (nxt - i) * 0.25))
        for t, d in steps:
            c = chord_at(t0 + t)
            name = chord_name(c)
            fifth = band_fifth(c)
            change = c.symbol != last or abs(t % 4) < 1e-9 and mode == 'crush'
            last = c.symbol
            accent = change or abs(t % 1) < 1e-9
            v = min(1.0, vel + (0.1 if accent else 0.0))
            if mode == 'crush':
                for i, part in enumerate((pL, pR)):
                    strum(part, t0 + t + 0.008 * i, min(d, 0.75) * 0.8, voicing(name, 'pm', fifth), v)
                if change:
                    for i, part in enumerate((gL, gR)):
                        strum(part, t0 + t + 0.008 * i, min(d, 1.0) * 0.95,
                              voicing(name, 'open', fifth), v)
                ebass.note(t0 + t, b_root(name), min(d, 0.75) * 0.85, vel=v)
                continue
            if change:
                for i, part in enumerate((gL, gR)):
                    strum(part, t0 + t + 0.008 * i, (0.5 if mode == 'sixteen' else 1.0) * 0.92,
                          voicing(name, 'open', fifth), v)
            for i, part in enumerate((pL, pR)):
                strum(part, t0 + t + 0.008 * i, d * 0.8, voicing(name, 'pm', fifth),
                      v if not change else v - 0.1)
            if mode == 'gallop' or abs(t % 0.5) < 1e-9:
                ebass.note(t0 + t, b_root(name), (d if mode == 'gallop' else 0.5) * 0.85,
                           vel=v)

    def anthem_voices(bar, scale, dyn, last=None, choir=True, trumpets=False, horns=True,
                      pad_ch=None, pad_vel=0.62, choir_pad=True):
        """The court sings low: the choir's tune an octave under the violins' (C4-C5)
        with the basses an octave under that, an 'oo' pad between, the horns with
        the choir; trumpets only at the crowning, and then in the same low octave."""
        txt = text(ANTHEM, scale, last)
        if choir:
            sop.at(bar).play(f'@{dyn} ' + txt, transpose=-12)
            ten.at(bar).play(f'@{dyn} ' + txt, transpose=-24)
            if choir_pad:
                pad(cpad, bar, pad_ch or anthem_chart(scale, last), n=3, lo=50, hi=65,
                    vel=pad_vel)
        if trumpets:
            tpt.at(bar).play(f'@{dyn} ' + txt, transpose=-12)
        if horns:
            hn.at(bar).play(f'@{dyn} ' + txt, transpose=-12)

    def low_roots(bar, ch, vel=0.66):
        t = T(bar)
        for c, d in ch:
            root = b_root(chord_name(c))
            cbsus.note(t, root if root >= 28 else root + 12, d, vel=vel, art='sus')
            lowsus.note(t, root + 12 if root + 12 >= 36 else root + 24, d, vel=vel, art='sus')
            t += d

    # ================================================= intro 1-4
    # 1-2: the court strikes up its anthem, stately; on its dominant the King cuts it off
    head = ANTHEM[:5]          # C. C F | A. G
    sop.at(INTRO).play('@f ' + text(head), transpose=-12)
    ten.at(INTRO).play('@f ' + text(head), transpose=-24)
    hn.at(INTRO).play('@mf ' + text(head), transpose=-12)
    ich = chart('Dm:4 Am:4')
    pad(cpad, INTRO, ich, n=3, lo=50, hi=65, vel=0.58)
    pad(organ, INTRO, ich, n=4, lo=48, hi=67, vel=0.6, art='loud')
    organ.at(INTRO).play('%loud @mf D2w | A2w |')
    low_roots(INTRO, ich, vel=0.6)
    timp.at(INTRO).play('%roll @mp D2w | %default @f A2q rq A2q A2e A2e |')
    timp.expr((INTRO, 0.45), (INTRO + 0.95, 1.0), (INTRO + 1, 1.0))
    drums(perc, INTRO, {'crash': 'x', 'bd': 'x'}, vel=0.7)
    drums(perc, INTRO + 1, {'sn_roll': '............xxxx'}, vel=0.6, ramp=0.4)
    # 3: the cell as blows, everyone in unison; 4: the riff's second bar, a fill into A
    riff(INTRO + 2, 1, vel=0.88)
    riff(INTRO + 3, 2, vel=0.84)
    cell = 'A2e^ A2e^ C3e^ B2e^ A2q^ E2q^ |'
    tbn.at(INTRO + 2).play('@ff ' + cell)
    tuba.at(INTRO + 2).play('@ff ' + cell, transpose=-12)
    hn.at(INTRO + 2).play('@ff ' + cell, transpose=12)
    tbn.at(INTRO + 3).play('@f rq Bb2q^ rq F2e E2e |')
    tuba.at(INTRO + 3).play('@f rq Bb1q^ rq F1e E1e |')
    taiko.at(INTRO + 2).play('@ff A2e A2e A2e A2e A2q A2q | A2s A2s A2s A2s A2q A2e A2e A2e A2e |')
    K(INTRO + 2, {'kick': 'x.x.x.x.x...x...', 'snare': 'x.x.x.x.x...x...',
                  'crash': 'X.......X.......'}, vel=0.84)
    K(INTRO + 3, {'kick': 'xxxxx...x.x.x.x.', 'snare': '....X...xxxxXXXX',
                  'crash': '....X...........', 'tom_lo': '........x.x.....'}, vel=0.8)
    drums(perc, INTRO + 2, {'bd': 'x.x.x.x.x...x...'}, vel=0.72)
    boom = b.part('boom', 'boom', role='accent', gain=2.0)
    boom.note(T(INTRO + 2), 'A1', 3.0, vel=0.85)

    # ================================================= A 5-12: the King
    riffs(A1, 8, vel=0.78)
    ktxt = text(KING)
    hn.at(A1).play('@f ' + ktxt, transpose=-12)
    tbn.at(A1).play('@f ' + ktxt, transpose=-24)
    lead.at(A1 + 4).play('@f ' + text(KING[13:]))
    KIT_R1 = {'kick': 'x.x.x.x.x...x...', 'snare': '....x.......x...', 'hat': 'x.x.x.x.x.x.x.x.'}
    KIT_R2 = {'kick': 'xxxxx...xxx.x.x.', 'snare': '....X.......x...', 'hat': 'x.x.x.x.x.x.x.x.',
              'crash': '....X...........'}
    FILL_R2 = {'kick': 'xxxxx...x.x.x.x.', 'snare': '....X.......xxXX', 'hat': 'x.x.x.x.x.x.....',
               'crash': '....X...........', 'tom_lo': '..........x.....'}
    for i in range(8):
        bar = A1 + i
        g = dict(KIT_R1 if i % 2 == 0 else (FILL_R2 if i % 4 == 3 else KIT_R2))
        if i in (0, 4):
            g['crash'] = 'X...............'
            g.pop('hat')
            g['ride'] = '..x.x.x.x.x.x.x.'
        K(bar, g, vel=0.76)
    for bar in range(A1, A1 + 8):
        taiko.at(bar).play('@f A2q rq A2q rq |' if (bar - A1) % 2 == 0
                           else '@f rq A2q rq A2e A2e |')
    timp.at(A1).play('%default @ff A2q rq rh |')
    timp.at(A1 + 4).play('%default @ff A2q rq rh |')
    drums(perc, A1, {'crash': 'x', 'bd': 'x'}, vel=0.8)
    # the violins hold a high, tight fifth under the lead's entry
    vn2.at(A1 + 4).play('%trem @mf [A4 A5]w~ | [A4 A5]w~ | [A4 A5]w~ | [A4 A5]w |')
    vn2.expr((A1 + 4, 0.6), (A1 + 7.9, 1.0))

    # ================================================= B 13-20: the acclamation, stately
    chB = anthem_chart(1.0)
    chord_timeline(B1, chB)
    # (no 'oo' pad here: the trombones hold the harmony, so the gallop keeps its bite)
    anthem_voices(B1, 1.0, 'f', last=1.0, choir_pad=False)
    vn.at(B1).play('%sus @f ' + text(ANTHEM, 1.0, last=1.0))
    low_roots(B1, anthem_chart(1.0)[:-1])
    pad(tbn, B1, anthem_chart(1.0)[:-1], n=2, lo=45, hi=60, vel=0.55)
    court_band(B1, 28, 'gallop', vel=0.72)
    # bar 20: the anthem's A, sung once and cut off by the riff's second bar
    riff(B1 + 7, 2, vel=0.84)
    GALLOP = {'kick': 'x.xxx.xxx.xxx.xx', 'snare': '....x.......x...', 'ride': 'x...x...x...x...'}
    for i in range(7):
        g = dict(GALLOP)
        if i in (0, 2, 4, 6):
            g['crash'] = 'X...............'
        if i == 6:
            g['snare'] = '....x.......x.xx'
        K(B1 + i, g, vel=0.74)
    K(B1 + 7, {'kick': 'xxxxx...x.x.x.x.', 'snare': 'X...X...xxxxXXXX', 'crash': 'X...X...........',
               'tom_lo': '........x.x.....'}, vel=0.82)
    timp.at(B1).play('%default @f D2q rq rh | A2q rq A2q rq | Bb2q rq rh | E2q rq E2q E2q |'
                     ' D2q rq rh | G2q rq rh | Bb2q rq rq Bb2q | A2q rq rh |')
    drums(perc, B1, {'crash': 'x', 'bd': 'x'}, vel=0.8)
    drums(perc, B1 + 6, {'sus': 'x'}, vel=0.6)
    taiko.at(B1 + 7).play('@ff A2q A2q rq A2e A2e |')

    # ================================================= A2 21-28: the King, the court cheering
    riffs(A2, 8, vel=0.82)
    lead.at(A2).play('@f ' + ktxt)
    lead2.at(A2).play('@f ' + text(KING_LO))
    hn.at(A2).play('@ff ' + ktxt, transpose=-12)
    tbn.at(A2).play('@ff ' + ktxt, transpose=-24)
    # the court cheers on cue: open fifths on the riff's A, B-flat major on its slam
    for i in range(8):
        bar = A2 + i
        if i % 2 == 0:
            stab.at(bar).play("@f rh [A3 E4 A4]e' r:1.5 |")
        else:
            stab.at(bar).play("@ff rq [Bb3 D4 F4 Bb4]e' r:2.5 |")
    KIT2_R1 = {'kick': 'xxxxxxxxx...x...', 'snare': '....x.......x...', 'ride': 'x.x.x.x.x.x.x.x.'}
    KIT2_R2 = {'kick': 'xxxxx...xxxxx.x.', 'snare': '....X.......x...', 'ride': 'x...x.x.x.x.x.x.',
               'china': '....X...........'}
    FILL2 = {'kick': 'xxxxx...x.x.x.x.', 'snare': '....X...x.x.xxXX', 'china': '....X...........',
             'tom_hi': '.........x.x....', 'tom_lo': '..........x.x...'}
    for i in range(8):
        g = dict(KIT2_R1 if i % 2 == 0 else (FILL2 if i % 4 == 3 else KIT2_R2))
        if i in (0, 4):
            g['crash'] = 'X...............'
        K(A2 + i, g, vel=0.8)
    for bar in range(A2, A2 + 8):
        taiko.at(bar).play('@ff A2q rq A2q rq |' if (bar - A2) % 2 == 0
                           else '@ff rq A2q rq A2e A2e |')
    vn2.at(A2).play('%trem @f [A4 A5]w~ | [A4 A5]w~ | [A4 A5]w~ | [A4 A5]w |'
                    ' [A4 A5]w~ | [A4 A5]w~ | [A4 A5]w~ | [A4 A5]w |')
    vn2.expr((A2, 0.7), (A2 + 3.9, 0.9), (A2 + 4, 0.8), (A2 + 7.9, 1.0))
    timp.at(A2).play('%default @ff A2q rq rh | rw | rw | rw | A2q rq rh | rw | rw | %roll A2w |')
    drums(perc, A2, {'crash': 'x', 'bd': 'x'}, vel=0.85)

    # ================================================= C 29-36: the court rushes
    # the anthem in quarters, twice; the second time the violins and the flute gabble
    # it in eighths against the choir (two speeds of one tune at once)
    for k in range(2):
        bar = C1 + 4 * k
        ch = anthem_chart(0.5)
        chord_timeline(bar, ch)
        anthem_voices(bar, 0.5, 'f' if k == 0 else 'ff', last=1.0, choir_pad=False)
        low_roots(bar, anthem_chart(0.5)[:-1], vel=0.68)
        # the band: sixteenths on the court's roots up to its A, then the riff's tail
        court_band(bar, 14, 'sixteen', vel=0.72 + 0.04 * k)
    riff(C1 + 7, 2, vel=0.88, start=2.0)
    # (the first pass's A: the riff's tail without the F-E, a bare E octave (no B
    # natural to brighten the turn) into the D minor of the second pass)
    for t, d, root, kind in ((2.0, 0.25, 'A', 'pm'), (2.25, 0.25, 'A', 'pm'),
                             (2.5, 0.5, 'A', 'pm'), (3.0, 1.0, 'E', 'oct')):
        t0 = T(C1 + 3, t)
        for i, part in enumerate((pL, pR) if kind == 'pm' else (gL, gR)):
            strum(part, t0 + 0.008 * i, d * 0.88, voicing(root, kind), 0.86)
        ebass.note(t0, BASS[root], d * 0.88, vel=0.86)
    # first pass: the second violins race in eighths on the chords; second: the
    # gabble
    t = T(C1)
    for c, d in anthem_chart(0.5):
        tones = c.tones_in_range(60, 79)
        for i in range(round(d * 2)):
            vn2.note(t + i * 0.5, tones[[0, 1, 2, 1][i % 4] % len(tones)], 0.5, vel=0.58,
                     art='spic')
        t += d
    vn.at(C1).play('%sus @f ' + text(ANTHEM, 0.5, last=1.0))
    gab = text(ANTHEM, 0.25) + ' ' + text(ANTHEM, 0.25)
    # (the gabble has its own parts, so it is levelled as a line of its own, and the
    # rhythm guitars step back for it, as they do for the stately anthem in B)
    gvn = b.part('gab_vn', 'violins', role='counter', art='spic', gain=1.5, pan=-0.45)
    gvn2 = b.part('gab_vn2', 'violins2', role='counter', art='spic', gain=0.0, pan=-0.15)
    gvn.at(C1 + 4).play('%spic @ff ' + gab)
    gvn2.at(C1 + 4).play('%spic @f ' + gab, transpose=-12)
    for g in (gL, gR, pL, pR):
        g.opts['fader'] = [(1, 0), (12.9, 0), (13, -3.0), (19.9, -3.0), (20, 0), (28.9, 0),
                           (29, -2.0), (32.9, -2.0), (33, -3.5), (36.9, -3.5), (37, 0),
                           (52.9, 0)]
    RUSH = {'kick': 'x.x.x.x.x.x.x.x.', 'snare': '....x.......x...', 'china': 'x...x...x...x...'}
    for i in range(8):
        g = dict(RUSH)
        if i in (0, 4):
            g['crash'] = 'X...............'
        if i in (3, 7):
            g = {'kick': 'x.x.x.x.xxxxx.x.', 'snare': '....x...X...xxXX',
                 'china': 'x...x...........', 'crash': '........X.......'}
        K(C1 + i, g, vel=0.78 + 0.01 * i)
    for k in range(2):
        timp.at(C1 + 4 * k).play('%default @f D2q rq A2q A2q | Bb2q rq E2q E2q |'
                                 ' D2q rq G2q rq | Bb2q rq A2q rq |')
        drums(perc, C1 + 4 * k, {'crash': 'x', 'bd': 'x'}, vel=0.78)
    drums(perc, C1 + 3, {'sn_roll': '........xxxxxxxx'}, vel=0.6, ramp=0.4)

    # ================================================= E 37-44: rage
    # his tune tremolo-picked, the court singing it with him, the double kick driving
    for i in range(7):
        riff(E1 + i, 1 + i % 2, vel=0.84, strings=False)
    riff(E1 + 7, 2, vel=0.88, cut=2.0)
    for p, part, src in ((0, lead, KING), (0, lead2, KING_LO)):
        t = T(E1)
        for i, (pn, d) in enumerate(src):
            last = i == len(src) - 1
            n16 = 4 if last else round(d * 4)     # the last A is struck, not shredded
            for j in range(n16):
                pitch = _p('A3') if last and part is lead2 else _p(pn)
                part.note(t + j * 0.25, pitch, 0.25 if not last else 0.95,
                          vel=0.8 if j % 4 == 0 else 0.7)
                if last:
                    break
            t += d
    # (the court sings it an octave under the guitars)
    sop.at(E1).play('@ff ' + text(KING, last=1.0), transpose=-12)
    ten.at(E1).play('@ff ' + text(KING, last=1.0), transpose=-24)
    hn.at(E1).play('@ff ' + text(KING, last=1.0), transpose=-12)
    DRIVE = {'kick': 'xxxx.x.xxxxx.x.x', 'snare': '....X.......X...',
             'ride_bell': 'x.x.x.x.x.x.x.x.'}
    for i in range(7):
        g = dict(DRIVE)
        if i in (0, 4):
            g['crash'] = 'X...............'
        if i == 3:
            g['china'] = '....X...........'
        K(E1 + i, g, vel=0.76)
    # bar 44: the slam on A, then nothing for a beat
    K(E1 + 7, {'kick': 'xxxxX...X.......', 'snare': '....X...X.......', 'crash': '....X...X.......',
               'tom_lo': '........X.......'}, vel=0.9)
    for i, part in enumerate((gL, gR)):
        strum(part, T(E1 + 7, 2.0) + 0.008 * i, 1.0, voicing('A', 'open'), 0.95)
    ebass.note(T(E1 + 7, 2.0), 33, 1.0, vel=0.95)
    cb.note(T(E1 + 7, 2.0), 33, 1.0, vel=0.9, art='sus')
    for bar in range(E1, E1 + 7):
        taiko.at(bar).play('@ff A2q A2q A2q A2q |')
    taiko.at(E1 + 7).play('@ff A2s A2s A2s A2s A2q A2q rq |')
    timp.at(E1).play('%default @ff A2q rq rh | rw | rw | rw | A2q rq rh | rw | %roll @f A2w |'
                     ' %default @ff A2q rq A2q rq |')
    drums(perc, E1, {'crash': 'x', 'bd': 'x'}, vel=0.85)
    drums(perc, E1 + 7, {'bd': '....x...x.......', 'crash': '........x.......'}, vel=0.9)

    # ================================================= D 45-52: the crowning
    # 150 again, half time: the anthem as written, at last at its stately pace
    chD = anthem_chart(1.0, last=3.0)
    chord_timeline(D1, anthem_chart(1.0))
    anthem_voices(D1, 1.0, 'ff', last=3.0, pad_ch=chD, pad_vel=0.7, trumpets=True)
    lead.at(D1).play('@f ' + text(ANTHEM, 1.0, last=3.0))
    vn.at(D1).play('%sus @ff ' + text(ANTHEM, 1.0, last=3.0))
    vn2.at(D1).play('%sus @f ' + text(ANTHEM, 1.0, last=3.0), transpose=-12)
    for n in sop.notes:
        if T(D1) - 1e-9 <= n.start < T(END) - 1e-9:
            bells.note(n.start, n.pitch, max(n.dur, 1.0), vel=0.62)
    pad(organ, D1, chD, n=4, lo=50, hi=69, vel=0.66, art='loud')
    t = T(D1)
    for c, d in chD:
        r = 36 + (c.bass - 0) % 12
        organ.note(t, r, d, vel=0.66, art='loud')
        t += d
    low_roots(D1, chD, vel=0.72)
    pad(tbn, D1, chD, n=3, lo=41, hi=60, vel=0.7)
    t = T(D1)
    for c, d in chD:
        tuba.note(t, b_root(chord_name(c)), d, vel=0.72)
        t += d
    CRUSH = 'x..x..x...x..x..'
    court_band(D1, 28, 'crush', vel=0.8, pattern=CRUSH)
    HALF = {'kick': CRUSH, 'snare': '........X.......', 'china': 'x...x...x...x...'}
    for i in range(7):
        g = dict(HALF)
        if i in (0, 4):
            g['crash'] = 'X...............'
        if i == 3:
            g['tom_lo'] = '............x.x.'
        K(D1 + i, g, vel=0.82)
    # bar 52: the crowned A held, the band back in full time under it, the riff's
    # F-E pickup into bar 5
    for i in range(12):
        t0 = T(D1 + 7, i * 0.25)
        for j, part in enumerate((pL, pR)):
            strum(part, t0 + 0.008 * j, 0.2, voicing('A', 'pm'), 0.72 + 0.02 * i)
        ebass.note(t0, 33, 0.2, vel=0.72 + 0.02 * i)
    for i, part in enumerate((gL, gR)):
        strum(part, T(D1 + 7) + 0.008 * i, 1.8, voicing('A', 'open'), 0.9)
    riff(D1 + 7, 2, vel=0.88, strings=False, start=3.0)
    K(D1 + 7, {'kick': 'x.......x.x.x.x.', 'snare': '........xxxxxxXX', 'crash': 'X...............',
               'tom_lo': '........x...x...'}, vel=0.8, ramp=0.3)
    timp.at(D1).play('%default @ff D2q rq A2q rq | A2q rq E2q rq | Bb2q rq F2q rq |'
                     ' E2q rq Bb2q rq | D2q rq A2q rq | G2q rq D2q rq | Bb2q rq G2q rq |'
                     ' A2q rq %roll A2h |')
    # (the taiko on the court's roots here, beats 1 and 3)
    for t0, d, c in TL:
        if T(D1) - 1e-9 <= t0 < T(D1 + 7) - 1e-9:
            for q in range(0, int(d), 2):
                taiko.note(t0 + q, 38 + (c.bass - 2) % 12, 1.0, vel=0.88)
    drums(perc, D1, {'gong': 'x', 'bd': 'x', 'crash': 'x'}, vel=0.95)
    boom.note(T(D1), 'D1', 4.0, vel=0.95)
    drums(perc, D1 + 4, {'crash': 'x', 'bd': 'x'}, vel=0.85)

    # ================================================= enrage: blows on every beat, on A
    v = 'enrage_berserker_king'
    e_tk = b.extra(v, 'bk_taiko', 'taiko', role='drums')
    e_bd = b.extra(v, 'bk_bd', 'orch_perc', role='drums')
    e_tbn = b.extra(v, 'bk_tbn', 'trombones', role='section', art='stac')
    e_tuba = b.extra(v, 'bk_tuba', 'tuba', role='low', art='stac')
    e_gtr = b.extra(v, 'bk_gtr', 'egtr_pm', role='section', pan=0.0, width=0.0,
                    amp=dict(amp_pm, gain_db=29), reverb=0.04)
    for bar in range(A1, END):
        t = T(bar)
        for q in range(4):
            acc = 0.9 if q == 0 else 0.82
            e_tk.note(t + q, 'A2', 1.0, vel=acc)
            e_tbn.note(t + q, 'A2', 0.6, vel=acc, art='stac', accent=2)
            e_tuba.note(t + q, 'A1', 0.6, vel=acc, art='stac')
            strum(e_gtr, t + q, 0.45, [33, 45], acc)
        drums(e_bd, bar, {'bd': 'x...x...x...x...'}, vel=0.78)
    return b.finish()
