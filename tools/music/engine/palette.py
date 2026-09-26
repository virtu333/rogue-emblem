"""The palette: which library plays each instrument, chosen at render time.

The instrument registry (instruments.py) is the legacy palette: VSCO 2 CE,
GeneralUser GS and the sfizz kits. A palette swaps some of its entries for
lab instruments (kind 'lab', rendered by labrender through sfizz) and leaves
every other part exactly as it is.

The game ships the HOUSE palette, the sound lab's verdicts (September 2026).
A score may change an instrument for itself (`Score.palette`, e.g. the
colosseum's frame drum as its taiko). Anything else is an audition: it
renders to References/music-lab/out and never touches the game's assets.

  (nothing) / house                          the house palette (what the game ships)
  legacy                                     the registry as written, no lab instruments
  MUSIC_PALETTE=lab:choir=vpo_mixed          the house palette with one change
  MUSIC_PALETTE=lab:violins=legacy           the house palette, violins back to VSCO
  MUSIC_PALETTE=lab:choir,solo_violin        those two on their first candidate
  MUSIC_PALETTE=lab                          every instrument's first candidate
  MUSIC_PALETTE=lab:@strings                 a named group (see GROUPS)
  build.py / solo.py  --palette <same syntax>

`python3 tools/music/solo.py --list-palette` prints the candidates.

A lab instrument keeps the original's seat (pan, width, depth, bus, range,
reference key), so mixing, role levelling, reverb and the master chain treat
it exactly like the part it replaces: only the sound source changes.
"""

from __future__ import annotations

import copy
import hashlib
import os

LAB_VERSION = 1   # bump when the performer or the lab renderer changes what a stem sounds like

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
_ORIG: dict | None = None
_ACTIVE: dict = {}
_REQUESTED: str | None = None


def request(spec: str | None):
    """The palette this process renders with (--palette); each Renderer applies it
    to its score (see for_score)."""
    global _REQUESTED
    _REQUESTED = spec


def requested() -> str:
    """--palette if given, else MUSIC_PALETTE, else the house palette."""
    if _REQUESTED is not None:
        return _REQUESTED
    return os.environ.get('MUSIC_PALETTE') or 'house'


def lab_dir() -> str:
    return os.environ.get('MUSIC_LAB_DIR', os.path.join(ROOT, 'References', 'music-lab'))


def cache_dir() -> str:
    return os.path.join(lab_dir(), 'cache')


# ------------------------------------------------------------------ helpers
def _p(lib, *parts):
    from . import labrender as L
    return {'sso': L.sso, 'vpo': L.vpo, 'vcsl': L.vcsl}[lib](*parts)


def _strm(prog, **kw):
    return dict(prog=prog, **kw)


SHORT = dict(short=True, dyn_cc=0, cal_vel=91)


# ------------------------------------------------------------------ candidates
def _solo_violin_sso(transition='tuned', style='full'):
    SP = 'Strings - Performance'
    return dict(perform='line', style=style, streams={
        'legato': _strm(('violin2_legato', transition), mono=True, cal_vel=64,
                        legato_cc=transition != 'library',
                        slide=transition != 'library' and style == 'full'),
        'leg': dict(program_of='legato'),
        'first': dict(program_of='legato'),
        'spic': _strm(('rr', _p('sso', SP, 'Violin Solo 2 Spiccato.sfz')), **SHORT),
        'stac': _strm(('plain', _p('sso', SP, 'Violin Solo 2 Staccato.sfz')), **SHORT),
        'pizz': _strm(('plain', _p('sso', SP, 'Violin Solo 2 Pizzicato.sfz')), **SHORT),
        'trem': _strm(('plain', _p('sso', SP, 'Violin Solo 2 Tremolo.sfz'))),
        'chord': _strm(('plain', _p('sso', SP, 'Violin Solo 2 Sustain.sfz'))),
    })


def _plain_one(path, **kw):
    return dict(perform='plain', streams={'main': _strm(('plain', path), **kw)})


def _chorus(path, darken=None, female=None, male=None):
    """A choir: chords and pads play the chorus program (velocity = attack
    speed, from note length; low notes men, high notes women, as the library
    splits them). A sung line (one note at a time) goes through the
    performer on a one-voice copy of ONE section (women if the line lies at
    G4 or above, else men), so it neither smears nor changes choir mid-phrase.
    female / male: separate programs (VPO3); otherwise the mixed program's
    own samples are split by name (SSO4)."""
    from .labrender import CHORUS_ATTACK
    f_spec = ('chorus', female, darken, True) if female else ('chorus', path, darken, True, 'female')
    m_spec = ('chorus', male, darken, True) if male else ('chorus', path, darken, True, 'male')
    line = dict(cal_vel=80, mono=True, attack=CHORUS_ATTACK, legato_cc=True)
    return dict(perform='auto', vel_from_length=True, art_map={'default': 'main'},
                line_program={'split': 67, 'hi': 'legato_f', 'lo': 'legato_m'},
                streams={
                    'main': _strm(('chorus', path, darken, False), cal_vel=80,
                                  attack=CHORUS_ATTACK),
                    'legato_f': _strm(f_spec, **line),
                    'legato_m': _strm(m_spec, **line),
                    'leg': dict(program_of='legato_f'),
                    'first': dict(program_of='legato_f'),
                })


SSO_SEC = {'violins': '1st Violins', 'violins2': '2nd Violins', 'violas': 'Violas',
           'celli': 'Celli', 'basses': 'Basses'}
VPO_SEC = {'violins': '1st-violin', 'violins2': '2nd-violin', 'violas': 'viola',
           'celli': 'cello', 'basses': 'bass'}


def _sso_section(inst):
    """SSO4 string section: a line is performed through the rebuilt legato
    program; pads and divisi play the sustain program. CC21 (the library's
    vibrato LFO: its section samples are recorded without vibrato) is set
    to a moderate depth."""
    SP = 'Strings - Performance'
    n = SSO_SEC[inst]
    vib = {21: 56}
    sus = _strm(('plain', _p('sso', SP, f'{n} Sustain.sfz')), cc=vib)
    return dict(perform='auto', art_map={'default': 'chord', 'sus': 'chord', 'vib': 'chord',
                                          'soft': 'soft', 'spic': 'spic', 'stac': 'stac',
                                          'pizz': 'pizz', 'trem': 'trem', 'first': 'chord',
                                          'leg': 'chord'},
                streams={
                    'legato': _strm(('legato', _p('sso', SP, f'{n} Legato.sfz'),
                                     _p('sso', SP, f'{n} Marcato.sfz'),
                                     (('group_volume', '-20'),), 'tuned', 0.16),
                                    mono=True, cal_vel=64, legato_cc=True, slide=True, cc=vib),
                    'leg': dict(program_of='legato'),
                    'first': dict(program_of='legato'),
                    'chord': sus,
                    'soft': dict(sus, db_offset=-3.0, cc={21: 40}),
                    'spic': _strm(('plain', _p('sso', SP, f'{n} Staccato.sfz')), **SHORT),
                    'stac': _strm(('plain', _p('sso', SP, f'{n} Staccato.sfz')), **SHORT),
                    'pizz': _strm(('plain', _p('sso', SP, f'{n} Pizzicato.sfz')), **SHORT),
                    'trem': _strm(('plain', _p('sso', SP, f'{n} Tremolo.sfz'))),
                })


def _vpo_section(inst):
    n = VPO_SEC[inst]
    main = _strm(('plain', _p('vpo', 'Strings', f'{n}-SEC-PERF.sfz')))
    return dict(perform='plain', art_map={'default': 'main', 'sus': 'main', 'vib': 'main',
                                          'soft': 'soft', 'spic': 'stac', 'stac': 'stac',
                                          'pizz': 'pizz', 'trem': 'trem'},
                streams={
                    'main': main,
                    'soft': dict(main, db_offset=-3.0),
                    'stac': _strm(('plain', _p('vpo', 'Strings', f'{n}-SEC-PERF-staccato.sfz')),
                                  **SHORT),
                    'pizz': _strm(('plain', _p('vpo', 'Strings', f'{n}-SEC-PERF-pizzicato.sfz')),
                                  **SHORT),
                    'trem': _strm(('plain', _p('vpo', 'Strings', f'{n}-SEC-PERF-tremolo.sfz'))),
                })


SSO_BRASS = {'horns': 'Horns', 'trumpets': 'Trumpets', 'trombones': 'Trombones', 'tuba': 'Tuba'}
VPO_BRASS = {'horns': 'french-horn', 'trumpets': 'trumpet', 'trombones': 'trombone'}


def _sso_brass(inst):
    """SSO4 brass section: sustain (its dynamic layers crossfaded on CC1) and
    staccato; no mutes in the library, so muted notes are the sustain through
    a low-pass (said plainly in the label)."""
    BP = 'Brass - Performance'
    n = SSO_BRASS[inst]
    sus = _strm(('plain', _p('sso', BP, f'{n} Sustain.sfz')))
    return dict(perform='plain', art_map={'default': 'sus', 'vib': 'sus', 'stac': 'stac',
                                          'mute': 'mute'},
                streams={
                    'sus': sus,
                    'stac': _strm(('plain', _p('sso', BP, f'{n} Staccato.sfz')), **SHORT),
                    'mute': _strm(('dark', _p('sso', BP, f'{n} Sustain.sfz'), 1500)),
                })


def _vpo_brass(inst):
    """VPO3 brass section: sustain and staccato. VPO3 has no mutes, so muted
    notes keep the registry's own muted samples (`keep_arts`)."""
    n = VPO_BRASS[inst]
    main = _strm(('plain', _p('vpo', 'Brass', f'{n}-SEC-PERF.sfz')))
    return dict(perform='plain', art_map={'default': 'main', 'vib': 'main', 'stac': 'stac'},
                keep_arts=('mute',),
                streams={
                    'main': main,
                    'stac': _strm(('plain', _p('vpo', 'Brass', f'{n}-SEC-PERF-staccato.sfz')),
                                  **SHORT),
                })


SSO_WINDS = {'flute': 'Flute Solo 1', 'oboe': 'Oboe Solo', 'clarinet': 'Clarinet Solo',
             'bassoon': 'Bassoon Solo', 'piccolo': 'Piccolo Solo'}


def _sso_wind(inst):
    """SSO4 solo woodwind: a line through the rebuilt legato program with the
    performer (a breath where the phrase has a rest), held chords on the
    looped-decay sustain, staccato."""
    WP = 'Woodwinds - Performance'
    n = SSO_WINDS[inst]
    sus = _strm(('plain', _p('sso', WP, f'{n} Sustain (looped, decay).sfz')))
    stac = _strm(('plain', _p('sso', WP, f'{n} Staccato.sfz')), **SHORT)
    return dict(perform='auto', art_map={'default': 'chord', 'nv': 'chord', 'stac': 'stac',
                                          'first': 'chord', 'leg': 'chord'},
                streams={
                    'legato': _strm(('legato', _p('sso', WP, f'{n} Legato.sfz'), None, None,
                                     'tuned', 0.05), mono=True, cal_vel=64, legato_cc=True),
                    'leg': dict(program_of='legato'),
                    'first': dict(program_of='legato'),
                    'chord': sus,
                    'spic': stac,
                    'stac': stac,
                })


def _drum(path, key, **kw):
    return dict(perform='plain', streams={'main': _strm(('plain', path), fixed_key=key,
                                                        **{**SHORT, **kw})})


CANDIDATES = {
    'solo_violin': {
        'sso': dict(
            label='Sonatina 4 solo violin, performed',
            what='SSO4 Solo Violin 2 (legato program rebuilt: 3 transition speeds, marcato accent '
                 'layer on new bows), spiccato with an alternate round robin, staccato, '
                 'articulation state machine, phrase dynamics on CC1, humanised entrances',
            lab=_solo_violin_sso()),
        'sso_clean': dict(
            label='Sonatina 4 solo violin, clean changes',
            what='SSO4 Solo Violin 2 through the performer in its clean style: the same slurs, '
                 'spiccato and round robins, but no finger slides, no marcato bite unless the '
                 "score writes '^', even new bows, no swell inside a note, a gentle phrase arch",
            lab=_solo_violin_sso(style='clean')),
        'sso_rebow': dict(
            label='Sonatina 4 solo violin, performed, every note re-bowed',
            what='The performer (phrase dynamics, humanised timing, spiccato/staccato '
                 'choices) but no slurs: every long note starts from its own recorded bow '
                 'attack on the Sustain program, overlapping the last one\'s release',
            lab=dict(_solo_violin_sso(), rebow=True, streams={
                **_solo_violin_sso()['streams'],
                'sus': _strm(('plain', _p('sso', 'Strings - Performance',
                                          'Violin Solo 2 Sustain.sfz')))})),
        'sso_plain': dict(
            label='Sonatina 4 solo violin, unperformed',
            what='SSO4 Solo Violin 2 Sustain, every note as written, written dynamic on CC1, '
                 'no state machine',
            lab=_plain_one(_p('sso', 'Strings - Performance', 'Violin Solo 2 Sustain.sfz'))),
        'vpo': dict(
            label='Virtual Playing Orchestra 3 solo violin (PERF)',
            what='VPO3 1st-violin-SOLO-PERF (No Budget Orchestra samples), written dynamic on CC1, '
                 'velocity per note, no state machine',
            lab=dict(_plain_one(_p('vpo', 'Strings', '1st-violin-SOLO-PERF.sfz')))),
    },
    'choir': {
        'sso_mixed': dict(label='Sonatina 4 Mixed Chorus',
                          what="SSO4 'Mixed Chorus' (Performance): 'ah', CC1 dynamics with its "
                               'bright/dark crossfade, velocity = attack speed from note length',
                          lab=_chorus(_p('sso', 'Chorus - Performance', 'Mixed Chorus.sfz'))),
        'sso_large': dict(label='Sonatina 4 Large Chorus',
                          what="SSO4 'Large Chorus' (Performance): the same 'ah' samples doubled "
                               'across neighbouring keys and panned, wider and thicker',
                          lab=_chorus(_p('sso', 'Chorus - Performance', 'Large Chorus.sfz'))),
        'vpo_mixed': dict(label='Virtual Playing Orchestra 3 choir (mixed)',
                          what='VPO3 choir-MIXED-PERF: the SSO 1.0 chorus samples, re-looped, with '
                               'random pitch/amp/timing per note, CC1 dynamics',
                          lab=_chorus(_p('vpo', 'Vocals', 'choir-MIXED-PERF.sfz'), None,
                                      _p('vpo', 'Vocals', 'choir-FEMALE-PERF.sfz'),
                                      _p('vpo', 'Vocals', 'choir-MALE-PERF.sfz'))),
    },
    'oohs': {
        'sso_mixed_dark': dict(label='Sonatina 4 Mixed Chorus, darkened',
                               what="SSO4 'Mixed Chorus' through a 1.4 kHz low-pass: no library has "
                                    "an 'ooh', so this is the 'ah' with its brightness off",
                               lab=_chorus(_p('sso', 'Chorus - Performance', 'Mixed Chorus.sfz'),
                                           1400)),
        'vpo_mixed_dark': dict(label='Virtual Playing Orchestra 3 choir, darkened',
                               what='VPO3 choir-MIXED-PERF through a 1.4 kHz low-pass',
                               lab=_chorus(_p('vpo', 'Vocals', 'choir-MIXED-PERF.sfz'), 1400,
                                           _p('vpo', 'Vocals', 'choir-FEMALE-PERF.sfz'),
                                           _p('vpo', 'Vocals', 'choir-MALE-PERF.sfz'))),
    },
}

for _inst in SSO_SEC:
    CANDIDATES[_inst] = {
        'sso': dict(label=f'Sonatina 4 {SSO_SEC[_inst]}',
                    what=f'SSO4 {SSO_SEC[_inst]} (Performance): lines through the rebuilt legato '
                         'program with the performer, pads on Sustain, CC1 dynamics, CC21 '
                         'vibrato 56, Staccato (2 round robins), Pizzicato, Tremolo',
                    lab=_sso_section(_inst)),
        'vpo': dict(label=f'Virtual Playing Orchestra 3 {VPO_SEC[_inst]} section (PERF)',
                    what=f'VPO3 {VPO_SEC[_inst]}-SEC-PERF (+ staccato, pizzicato, tremolo '
                         'programs), CC1 dynamics, no performer',
                    lab=_vpo_section(_inst)),
    }
for _inst in SSO_BRASS:
    CANDIDATES[_inst] = {
        'sso': dict(label=f'Sonatina 4 {SSO_BRASS[_inst]}',
                    what=f'SSO4 {SSO_BRASS[_inst]} Sustain (dynamic layers crossfaded on CC1) and '
                         'Staccato; no mutes in the library (muted notes: sustain through a '
                         '1.5 kHz low-pass); no performer',
                    lab=_sso_brass(_inst)),
    }
    if _inst in VPO_BRASS:
        CANDIDATES[_inst]['vpo'] = dict(
            label=f'Virtual Playing Orchestra 3 {VPO_BRASS[_inst]} section (PERF)',
            what=f'VPO3 {VPO_BRASS[_inst]}-SEC-PERF (+ staccato), CC1 dynamics; muted notes '
                 'play open; no performer',
            lab=_vpo_brass(_inst))

for _inst in SSO_WINDS:
    CANDIDATES[_inst] = {
        'sso': dict(label=f'Sonatina 4 {SSO_WINDS[_inst]}',
                    what=f'SSO4 {SSO_WINDS[_inst]} (Performance): lines through the rebuilt '
                         'legato program with the performer, chords on Sustain (looped, decay), '
                         'Staccato, CC1 dynamics',
                    lab=_sso_wind(_inst)),
    }

CANDIDATES['celesta'] = {
    'sso': dict(label='Sonatina 4 Celeste',
                what='SSO4 Percussion/Celeste (hard and soft layers by velocity), release '
                     'held by its CC64 ring control at 40; high-passed at 200 Hz (its samples '
                     'carry a 40-100 Hz key/hammer thump on every note, below the instrument)',
                inst=dict(hpf=200),
                lab=dict(perform='plain', streams={'main': _strm(
                    ('plain', _p('sso', 'Percussion', 'Celeste.sfz')), cc={64: 40}, **SHORT)})),
}
_MEMB = ('Membranophones', 'Struck Membranophones')
CANDIDATES['taiko'] = {
    'vcsl_bd_muted': dict(label='VCSL bass drum, muted hits',
                          what="VCSL 'Bass Drum 3 - Legacy', muted hits (key 61): 7 velocity "
                               'layers with round robins; every written pitch plays the one drum',
                          lab=_drum(_p('vcsl', *_MEMB, 'Bass Drum 3 - Legacy.sfz'), 61)),
    'vcsl_bd_open': dict(label='VCSL bass drum, open hits',
                         what="VCSL 'Bass Drum 3 - Legacy', open hits (key 60): 7 velocity "
                              'layers with round robins, long ring',
                         lab=_drum(_p('vcsl', *_MEMB, 'Bass Drum 3 - Legacy.sfz'), 60)),
    'vcsl_frame': dict(label='VCSL frame drum, large',
                       what="VCSL 'Frame Drum', large drum hits (key 61): 2 velocity layers, "
                            '2 round robins',
                       lab=_drum(_p('vcsl', *_MEMB, 'Frame Drum.sfz'), 61)),
}

# folk colour (a sketch for the village / caravan world)
_ZITH = ('Chordophones', 'Zithers')
_DOUM, _TEK, _KA, _SLAP = 60, 61, 62, 63
CANDIDATES['kit'] = {
    'darbuka': dict(label='VCSL darbuka as the hand drums',
                    what="VCSL 'Darbuka' (2 round robins per stroke): kit toms and kick -> doum, "
                         'snare, rim and stick -> tek, hi-hat -> ka, high tom -> slap; cymbals '
                         'and shakers left out',
                    lab=dict(perform='plain', streams={'main': _strm(
                        ('plain', _p('vcsl', *_MEMB, 'Darbuka.sfz')),
                        key_map={36: _DOUM, 35: _DOUM, 41: _DOUM, 43: _DOUM, 45: _DOUM,
                                 48: _SLAP, 38: _TEK, 39: _TEK, 40: _TEK, 37: _TEK, 88: _TEK,
                                 95: _TEK, 96: _TEK, 93: _TEK, 42: _KA, 44: _KA},
                        **SHORT)})),
}
CANDIDATES['accordion'] = {
    'psaltery': dict(label='VCSL bowed psaltery',
                     what="VCSL 'Psaltery, Bowed and Plucked - LongBow' (range G4-G6: lower notes "
                          'move up an octave), written dynamic as velocity',
                     lab=_plain_one(_p('vcsl', *_ZITH, 'Psaltery, Bowed and Plucked - LongBow.sfz'),
                                    **{**SHORT, 'short': False})),
    'dan_tranh': dict(label='VCSL dan tranh (plucked zither)',
                      what="VCSL 'Dan Tranh - Vibrato' (plucked, with a bent vibrato), written "
                           'dynamic as velocity',
                      lab=_plain_one(_p('vcsl', *_ZITH, 'Dan Tranh - Vibrato.sfz'), **SHORT)),
}

# ------------------------------------------------------------------ the house palette
# What the game ships: the sound lab's verdicts (a blind A/B, September 2026).
#   solo violin  Sonatina 4 over VSCO in every test; the player's note changes kept
#                clean (the listener, a violinist, heard the full performer's bow
#                changes as too obvious). VPO3's solo violin is not a candidate to ship:
#                its samples' licence may be non-commercial.
#   oohs         Sonatina 4 Mixed Chorus, darkened: the Act III map with it was the pick
#   strings      VPO3 sections: crisper eighth notes than VSCO or Sonatina
#   brass        VPO3 horns, trumpets, trombones (VSCO sounded synthetic, Sonatina
#                muddy); the tuba stays VSCO (VPO3 has no section tuba)
#   oboe, celesta  Sonatina 4
#   kept         choir (GeneralUser GS sounded the more real sung line exposed), taiko
#                (GeneralUser GS on the volcano; the colosseum takes the VCSL frame
#                drum, see its score), the rest of the woodwinds (not auditioned)
# Licences: Sonatina 4 is CC Sampling Plus 1.0 and VPO3's strings and brass carry
# CC BY-SA sources; both need the credit in docs/music-credits.md.
HOUSE = {
    'solo_violin': 'sso_clean',
    'oohs': 'sso_mixed_dark',
    'violins': 'vpo', 'violins2': 'vpo', 'violas': 'vpo', 'celli': 'vpo', 'basses': 'vpo',
    'horns': 'vpo', 'trumpets': 'vpo', 'trombones': 'vpo',
    'oboe': 'sso',
    'celesta': 'sso',
}
LEGACY = 'legacy'        # as a candidate name: the registry's own instrument
ORIG_SUFFIX = '@legacy'  # the registry's instrument, kept beside a lab one (keep_arts)

# instrument-level overrides a candidate may carry (on top of the original's seat)
OVERRIDES = {
    ('solo_violin', 'sso'): dict(humanize_ms=0, vel_jitter=0.02),
    ('solo_violin', 'sso_clean'): dict(humanize_ms=0, vel_jitter=0.02),
    ('solo_violin', 'sso_rebow'): dict(humanize_ms=0, vel_jitter=0.02),
    ('solo_violin', 'sso_plain'): dict(humanize_ms=6),
    ('solo_violin', 'vpo'): dict(humanize_ms=6),
}

GROUPS = {}


def candidates():
    return {k: list(v) for k, v in CANDIDATES.items()}


# ------------------------------------------------------------------ selection
def _tokens(spec: str) -> dict:
    """'choir=vpo_mixed,solo_violin,@g' -> {inst: candidate or LEGACY}."""
    out = {}
    for tok in [t.strip() for t in spec.split(',') if t.strip()]:
        if tok.startswith('@'):
            out.update(_tokens(GROUPS[tok[1:]]))
            continue
        inst, _, cand = tok.partition('=')
        if inst not in CANDIDATES:
            raise SystemExit(f'palette: no lab candidates for {inst!r} (have {sorted(CANDIDATES)})')
        cand = cand or next(iter(CANDIDATES[inst]))
        if cand != LEGACY and cand not in CANDIDATES[inst]:
            raise SystemExit(f'palette: {inst} has no candidate {cand!r} '
                             f'(have {sorted(CANDIDATES[inst])} or {LEGACY!r})')
        out[inst] = cand
    return out


def _merge(base: dict, changes: dict) -> dict:
    out = dict(base)
    for inst, cand in changes.items():
        if cand == LEGACY:
            out.pop(inst, None)
        else:
            out[inst] = cand
    return out


def parse(spec: str | None) -> dict:
    """A palette spec -> {inst: candidate}. 'lab:choir=vpo_mixed,solo_violin' is the
    house palette with the choir on vpo_mixed and the solo violin on its first candidate."""
    spec = (spec or '').strip()
    if not spec or spec in ('house', 'default'):
        return dict(HOUSE)
    if spec in (LEGACY, 'off', 'none'):
        return {}
    if spec == 'lab':
        return {inst: next(iter(c)) for inst, c in CANDIDATES.items()}
    if spec.startswith('lab:'):
        return _merge(HOUSE, _tokens(spec[4:]))
    raise SystemExit(f'palette: cannot read {spec!r} (house, legacy, lab, lab:<changes>)')


def explicit(spec: str | None) -> set:
    """Instruments a spec settles itself (they win over a score's own choice)."""
    spec = (spec or '').strip()
    if spec in (LEGACY, 'off', 'none', 'lab'):
        return set(CANDIDATES)
    return set(_tokens(spec[4:])) if spec.startswith('lab:') else set()


def for_score(spec: str | None, score_palette: dict | None) -> dict:
    """The selection a score renders with: the spec, then the score's own changes
    (`Score.palette`) for any instrument the spec does not settle."""
    for inst, cand in (score_palette or {}).items():
        if inst not in CANDIDATES or (cand != LEGACY and cand not in CANDIDATES[inst]):
            raise SystemExit(f'palette: a score asks {inst}={cand}, which is no candidate')
    mine = {k: v for k, v in (score_palette or {}).items() if k not in explicit(spec)}
    return _merge(parse(spec), mine)


def is_audition(spec: str | None) -> bool:
    """True unless the spec is the house palette: an audition never writes game assets."""
    return parse(spec) != HOUSE


def build(inst_name: str, cand: str, orig: dict) -> dict:
    c = CANDIDATES[inst_name][cand]
    keep = ('range', 'pan', 'width', 'depth', 'ref_key', 'bus', 'humanize_ms', 'fixed_pitch',
            'keys', 'room', 'duck', 'hpf', 'vel_jitter')
    inst = {k: copy.deepcopy(orig[k]) for k in keep if k in orig}
    inst.update(kind='lab', lab=copy.deepcopy(c['lab']), expr_cc=True,
                lab_id=f'{inst_name}={cand}', label=c['label'])
    if c['lab'].get('keep_arts'):
        # these articulations still play the registry's own instrument
        inst['keep_arts'] = tuple(c['lab']['keep_arts'])
        inst['orig_name'] = inst_name + ORIG_SUFFIX
    if c['lab'].get('perform') in ('line', 'auto'):
        # the performer shapes dynamics itself; random velocity would only blur its choices
        inst['vel_jitter'] = 0.02
    inst.update(copy.deepcopy(OVERRIDES.get((inst_name, cand), {})))
    inst.update(copy.deepcopy(c.get('inst', {})))
    return inst


def apply(spec, instruments: dict) -> dict:
    """Select a palette (restoring the default first). Returns {inst: candidate}."""
    global _ORIG, _ACTIVE
    if _ORIG is None:
        _ORIG = copy.deepcopy(instruments)
    for k in list(instruments):
        if k not in _ORIG:
            del instruments[k]
    for k, v in _ORIG.items():
        instruments[k] = copy.deepcopy(v)
    chosen = parse(spec) if isinstance(spec, str) or spec is None else dict(spec)
    for inst_name, cand in chosen.items():
        instruments[inst_name] = build(inst_name, cand, _ORIG[inst_name])
        if 'orig_name' in instruments[inst_name]:
            instruments[instruments[inst_name]['orig_name']] = copy.deepcopy(_ORIG[inst_name])
    _ACTIVE = chosen
    return chosen


def legacy_name(inst_name: str) -> str:
    """'horns@legacy' -> 'horns' (calibration and onset tables are the registry's)."""
    return inst_name[:-len(ORIG_SUFFIX)] if inst_name.endswith(ORIG_SUFFIX) else inst_name


def active() -> dict:
    return dict(_ACTIVE)


def describe() -> str:
    if not _ACTIVE:
        return 'palette: legacy'
    if _ACTIVE == HOUSE:
        return 'palette: house'
    diff = {k: v for k, v in _ACTIVE.items() if HOUSE.get(k) != v}
    diff.update({k: LEGACY for k in HOUSE if k not in _ACTIVE})
    return 'palette: house + ' + ', '.join(f'{k}={v}' for k, v in sorted(diff.items()))


_CODE_HASH = None


def cache_token(inst: dict) -> str:
    """Identity of a lab stem: the candidate, its generated programs (content
    hashed) and the lab code itself, so an edit to the performer re-renders."""
    global _CODE_HASH
    from . import labrender
    if _CODE_HASH is None:
        here = os.path.dirname(__file__)
        _CODE_HASH = hashlib.sha1(b''.join(
            open(os.path.join(here, f), 'rb').read()
            for f in ('perform.py', 'labrender.py', 'sfzlab.py'))).hexdigest()
    progs = sorted(labrender.program(st['prog'])[0]
                   for st in inst['lab']['streams'].values() if 'prog' in st)
    return hashlib.sha1(repr((LAB_VERSION, _CODE_HASH, inst.get('lab_id'), inst.get('lab'),
                              progs)).encode()).hexdigest()
