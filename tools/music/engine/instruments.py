"""Instrument registry: what each part name in a score plays through.

Seating follows a standard orchestral layout seen from the audience
(violins left, celli/basses right, winds center, brass and percussion back).
`depth` places a section front-to-back via reverb send and high damping.
"""

from __future__ import annotations

import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
LIBS = os.path.join(ROOT, 'References', 'music-libs')
VSCO = os.path.join(LIBS, 'VSCO-2-CE')
GU = os.path.join(LIBS, 'GeneralUser-GS', 'GeneralUser-GS.sf2')


def V(name):
    return os.path.join(VSCO, name)


STR_SUS = dict(mode='sustain', release=0.45, legato=True, veltrack_db=11, attack_ms=90,
               swell=0.22, glide_ms=40, glide_frac=0.15, detune_jitter=3, tone_oct=2.0,
               soft_attack=0.09)
STR_SHORT = dict(mode='decay', release=0.12, veltrack_db=13, bite_db=2.5, attack_ms=35,
                 detune_jitter=3, tone_oct=2.2, rr_emulate=True)
BRASS_SUS = dict(mode='sustain', release=0.4, legato=True, veltrack_db=12, attack_ms=65,
                 swell=0.3, glide_ms=35, glide_frac=0.2, blare=1.2, tone_oct=2.4,
                 soft_attack=0.07, detune_jitter=2)
BRASS_SHORT = dict(mode='decay', release=0.16, veltrack_db=13, bite_db=3.0, attack_ms=30,
                   blare=1.0, tone_oct=2.4, detune_jitter=2, rr_emulate=True)
WIND_SUS = dict(mode='sustain', release=0.3, legato=True, veltrack_db=10, attack_ms=60,
                swell=0.28, glide_ms=28, glide_frac=0.2, tone_oct=1.8, soft_attack=0.05)
WIND_SHORT = dict(mode='decay', release=0.12, veltrack_db=11, bite_db=2.0, attack_ms=30,
                  tone_oct=1.8, rr_emulate=True)


def _str(sus, quiet, spic, pizz, trem, **kw):
    arts = {
        'sus': dict(file=V(sus), **STR_SUS),
        'soft': dict(file=V(quiet), **{**STR_SUS, 'release': 0.6, 'attack': 0.12,
                                        'veltrack_db': 9, 'attack_ms': None}),
        'spic': dict(file=V(spic), **STR_SHORT),
        'stac': dict(file=V(spic), **{**STR_SHORT, 'release': 0.08}),
        'pizz': dict(file=V(pizz), mode='oneshot', max_len=1.6, veltrack_db=14,
                     tone_oct=1.6),
        'trem': dict(file=V(trem), mode='sustain', release=0.35, veltrack_db=12, attack_ms=60,
                     tone_oct=2.0, swell=0.1),
    }
    arts['default'] = arts['sus']
    return dict(kind='sfz', arts=arts, expr_tone=True, humanize_ms=9, bus='strings', **kw)


# Virtuosity Drums keymap (keymaps/keymap.sfz)
VDRUM_KEYS = {
    'kick': 36, 'kick2': 35, 'snare': 38, 'snare_off': 39, 'rim': 40, 'stick': 37,
    'xstick': 88, 'flam': 95, 'roll': 96, 'buzz': 93, 'hat': 42, 'hat_pedal': 44,
    'tom_lo': 41, 'tom_floor': 41, 'tom_mid': 43, 'tom_hi': 48, 'tom_rim': 45,
    'crash': 49, 'crash2': 57, 'ride': 51, 'ride_bell': 53, 'splash': 55, 'china': 57,
    'tamb': 54, 'shaker': 82, 'cowbell': 56,
}

INSTRUMENTS = {
    # ------------------------------------------------------------ strings
    'violins': _str('ViolinEnsSusVib.sfz', 'ViolinEnsSusVib-Quiet.sfz', 'ViolinEnsSpic.sfz',
                    'ViolinEnsPizz.sfz', 'ViolinEnsTrem.sfz', range=(55, 100), pan=-0.5,
                    width=0.6, depth=0.25, ref_key=72,
                    eq=[('peak', 350, 1.0, -1.5), ('highshelf', 7000, 0.7, 1.5)]),
    'violins2': _str('ViolinEnsSusVib.sfz', 'ViolinEnsSusVib-Quiet.sfz', 'ViolinEnsSpic.sfz',
                     'ViolinEnsPizz.sfz', 'ViolinEnsTrem.sfz', range=(55, 96), pan=-0.22,
                     width=0.6, depth=0.3, ref_key=67, tune_cents=4,
                     eq=[('peak', 350, 1.0, -1.5)]),
    'violas': _str('ViolaEnsSusVib.sfz', 'ViolaEnsSusVib-Quiet.sfz', 'ViolaEnsSpic.sfz',
                   'ViolaEnsPizz.sfz', 'ViolaEnsTrem.sfz', range=(48, 88), pan=0.18,
                   width=0.6, depth=0.3, ref_key=60, eq=[('peak', 300, 1.0, -2)]),
    'celli': _str('CelloEnsSusVib.sfz', 'CelloEnsSusVib-Quiet.sfz', 'CelloEnsSpic.sfz',
                  'CelloEnsPizz.sfz', 'CelloEnsTrem.sfz', range=(36, 77), pan=0.45,
                  width=0.6, depth=0.3, ref_key=50, eq=[('peak', 250, 1.0, -1.5)]),
    'basses': _str('ContrabassSusVB.sfz', 'ContrabassSusVB-Quiet.sfz', 'ContrabassSpic.sfz',
                   'ContrabassPizz.sfz', 'ContrabassTrem.sfz', range=(24, 60), pan=0.62,
                   width=0.5, depth=0.35, ref_key=38),
    'solo_violin': dict(kind='sfz', arts={
        'default': dict(file=V('SViolinVib.sfz'), **{**STR_SUS, 'glide_ms': 60,
                                                       'glide_frac': 0.3}),
        'soft': dict(file=V('SViolinVib-Quiet.sfz'), **{**STR_SUS, 'glide_ms': 70,
                                                          'release': 0.6}),
        'spic': dict(file=V('SViolinSpic.sfz'), **STR_SHORT),
        'pizz': dict(file=V('SViolinPizz.sfz'), mode='oneshot', max_len=1.5, veltrack_db=12),
    }, range=(55, 100), pan=-0.3, width=0.3, depth=0.15, ref_key=76, bus='strings',
        expr_tone=True, humanize_ms=6),

    # ------------------------------------------------------------ brass
    'horns': dict(kind='sfz', arts={
        'default': dict(file=V('FHornSus.sfz'), **{**BRASS_SUS, 'release': 0.5,
                                                     'blare': 1.8}),
        'stac': dict(file=V('FHornStac.sfz'), **BRASS_SHORT),
        'mute': dict(file=V('FHornMute.sfz'), **{**BRASS_SUS, 'blare': 0.0}),
    }, range=(34, 77), pan=-0.3, width=0.5, depth=0.6, ref_key=60, bus='brass',
        expr_tone=True, humanize_ms=10, eq=[('peak', 400, 1.0, -1.5), ('peak', 3000, 1.0, -2.5)]),
    'trumpets': dict(kind='sfz', arts={
        'default': dict(file=V('TrumpetSus.sfz'), **{**BRASS_SUS}),
        'vib': dict(file=V('TrumpetSusVib.sfz'), **{**BRASS_SUS}),
        'stac': dict(file=V('TrumpetStac.sfz'), **BRASS_SHORT),
        'mute': dict(file=V('TrumpetStraightMuteSus.sfz'), **{**BRASS_SUS, 'blare': 0.0}),
    }, range=(52, 84), pan=0.12, width=0.3, depth=0.65, ref_key=67, bus='brass',
        expr_tone=True, humanize_ms=8, eq=[('peak', 3200, 1.0, -3.0), ('highshelf', 8000, 0.7, -2.0)]),
    'trombones': dict(kind='sfz', arts={
        'default': dict(file=V('TromboneSus.sfz'), **{**BRASS_SUS, 'release': 0.45}),
        'stac': dict(file=V('TromboneStac.sfz'), **BRASS_SHORT),
    }, range=(34, 72), pan=0.38, width=0.4, depth=0.65, ref_key=53, bus='brass',
        expr_tone=True, humanize_ms=9, eq=[('peak', 300, 1.0, -2.0), ('peak', 2800, 1.0, -2.5)]),
    'tuba': dict(kind='sfz', arts={
        'default': dict(file=V('TubaSus.sfz'), **{**BRASS_SUS, 'release': 0.5, 'blare': 1.2}),
        'stac': dict(file=V('TubaStac.sfz'), **{**BRASS_SHORT, 'release': 0.2}),
    }, range=(28, 62), pan=0.5, width=0.3, depth=0.65, ref_key=41, bus='brass',
        expr_tone=True, humanize_ms=10),

    # ------------------------------------------------------------ woodwinds
    'flute': dict(kind='sfz', arts={
        'default': dict(file=V('FluteSusVib.sfz'), **WIND_SUS),
        'nv': dict(file=V('FluteSusNV.sfz'), **WIND_SUS),
        'stac': dict(file=V('FluteStac.sfz'), **WIND_SHORT),
    }, range=(60, 96), pan=-0.12, width=0.2, depth=0.45, ref_key=79, bus='winds',
        expr_tone=True, humanize_ms=7),
    'piccolo': dict(kind='sfz', arts={
        'default': dict(file=V('PiccoloSus.sfz'), **WIND_SUS),
        'stac': dict(file=V('PiccoloStac.sfz'), **WIND_SHORT),
    }, range=(67, 103), pan=-0.18, width=0.2, depth=0.45, ref_key=86, bus='winds',
        expr_tone=True, humanize_ms=7),
    'oboe': dict(kind='sfz', arts={
        'default': dict(file=V('OboeSusVib.sfz'), **WIND_SUS),
        'nv': dict(file=V('OboeSusNV.sfz'), **WIND_SUS),
        'stac': dict(file=V('OboeStac.sfz'), **WIND_SHORT),
    }, range=(58, 91), pan=0.08, width=0.2, depth=0.45, ref_key=74, bus='winds',
        expr_tone=True, humanize_ms=7),
    'clarinet': dict(kind='sfz', arts={
        'default': dict(file=V('ClarinetSus.sfz'), **WIND_SUS),
        'stac': dict(file=V('ClarinetStac.sfz'), **WIND_SHORT),
    }, range=(50, 91), pan=-0.08, width=0.2, depth=0.5, ref_key=67, bus='winds',
        expr_tone=True, humanize_ms=7),
    'bassoon': dict(kind='sfz', arts={
        'default': dict(file=V('BassoonSus.sfz'), **WIND_SUS),
        'stac': dict(file=V('BassoonStac.sfz'), **WIND_SHORT),
    }, range=(34, 75), pan=0.15, width=0.2, depth=0.5, ref_key=50, bus='winds',
        expr_tone=True, humanize_ms=7),

    # ------------------------------------------------------------ keys, harp, mallets
    'harp': dict(kind='sfz', arts={
        'default': dict(file=V('Harp.sfz'), mode='oneshot', max_len=5.0, veltrack_db=16),
    }, range=(24, 103), pan=-0.62, width=0.5, depth=0.35, ref_key=67, bus='keys',
        humanize_ms=5),
    'celesta': dict(kind='sf2', font=GU, bank=0, program=8, range=(60, 108), pan=-0.25,
                    width=0.6, depth=0.4, ref_key=84, bus='keys', humanize_ms=4),
    'glock': dict(kind='sfz', arts={
        # each sample's tuning is corrected by tools/music/tuning.json (all run sharp)
        'default': dict(file=V('Glockenspiel.sfz'), mode='oneshot', max_len=3.0, veltrack_db=14),
    }, range=(67, 108), pan=0.25, width=0.3, depth=0.55, ref_key=84, bus='perc', humanize_ms=4),
    'bells': dict(kind='sfz', arts={
        'default': dict(file=V('TubularBells.sfz'), mode='oneshot', max_len=6.0, veltrack_db=12),
        # a bell caught by hand: rings for the written length, then a short fade
        'damp': dict(file=V('TubularBells.sfz'), mode='decay', max_len=6.0, release=0.5,
                     veltrack_db=12),
    }, range=(55, 84), pan=0.3, width=0.3, depth=0.7, ref_key=67, bus='perc', humanize_ms=4),
    'marimba': dict(kind='sfz', arts={
        'default': dict(file=V('Marimba.sfz'), mode='oneshot', max_len=2.0, veltrack_db=14),
    }, range=(41, 96), pan=0.2, width=0.4, depth=0.45, ref_key=72, bus='perc', humanize_ms=4),
    'organ': dict(kind='sfz', arts={
        'default': dict(file=V('OrganQuiet.sfz'), mode='sustain', release=0.9, veltrack_db=0,
                        attack=0.05),
        'loud': dict(file=V('OrganLoud.sfz'), mode='sustain', release=1.2, veltrack_db=0,
                     attack=0.05),
    }, range=(36, 96), pan=0.0, width=1.0, depth=0.75, ref_key=60, bus='keys', humanize_ms=2),

    # ------------------------------------------------------------ orchestral percussion
    'timpani': dict(kind='sfz', arts={
        'default': dict(file=V('Timpani.sfz'), mode='oneshot', max_len=4.0, veltrack_db=16,
                        rr_emulate=True, detune_jitter=4),
        'roll': dict(file=V('TimpaniRolls.sfz'), mode='sustain', release=0.8, veltrack_db=14),
    }, range=(36, 60), pan=-0.05, width=0.5, depth=0.7, ref_key=43, bus='perc', humanize_ms=5),
    # GM-style map: 36 bass drum, 38 snare, 39 snare roll, 49 crash, 51 sus cymbal,
    # 55 tambourine roll, 59 cymbal stick, 79 triangle, 32-35 bass drum rubs
    'orch_perc': dict(kind='sfz', arts={
        'default': dict(file=V('GM-StylePerc.sfz'), mode='oneshot', max_len=6.0, veltrack_db=16,
                        rr_emulate=True),
    }, range=(0, 127), pan=0.15, width=0.6, depth=0.7, ref_key=36, bus='perc', humanize_ms=4,
        fixed_pitch=True),

    'accordion': dict(kind='sf2', font=GU, bank=8, program=21, range=(41, 89), pan=0.25,
                      width=0.4, depth=0.35, ref_key=62, bus='keys', humanize_ms=5),

    # ------------------------------------------------------------ choir (SoundFont)
    'choir': dict(kind='sf2', font=GU, bank=0, program=52, range=(40, 84), pan=0.0,
                  width=1.0, depth=0.75, ref_key=62, bus='choir', humanize_ms=8,
                  expr=True),
    'oohs': dict(kind='sf2', font=GU, bank=0, program=53, range=(40, 84), pan=0.0,
                 width=1.0, depth=0.7, ref_key=62, bus='choir', humanize_ms=8, expr=True),

    # ------------------------------------------------------------ rhythm section (CC0 libraries via sfizz)
    'kit': dict(kind='sfizz', sfz=os.path.join(LIBS, 'virtuosity_drums', 'Programs', '02-full-kit.sfz'),
                range=(0, 127), pan=0.0, width=1.0, depth=0.15, ref_key=38, bus='drums',
                humanize_ms=4, fixed_pitch=True, keys=VDRUM_KEYS, hpf=0),
    # Growlybass maps its samples an octave above sounding pitch (bass-clef
    # convention: its key 40 plays E1, 41 Hz). `transpose` plays key k from the
    # program's key k + 12, so a written E1 (28) sounds E1 from the low-E sample
    # like every other instrument here (the program's keys 33-84 cover 21-72)
    'rbass': dict(kind='sfizz', room=True, duck='kit_kick', sfz=os.path.join(LIBS, 'karoryfer.growlybass', 'growlybass_dirty.sfz'),
                  transpose=12,
                  range=(28, 67), pan=0.0, width=0.0, depth=0.05, ref_key=40, bus='rhythm',
                  humanize_ms=5, hpf=35,
                  comp=dict(thresh_db=-26, ratio=4, attack_ms=6, release_ms=110, makeup_db=6),
                  eq=[('lowshelf', 90, 0.7, 2.0), ('peak', 250, 1.0, -2.0), ('peak', 1400, 1.0, 2.5)]),
    'grand': dict(kind='sfizz', sfz=os.path.join(LIBS, 'SplendidGrandPiano', 'Splendid Grand Piano.sfz'),
                  range=(21, 108), pan=-0.1, width=0.9, depth=0.3, ref_key=64, bus='keys',
                  humanize_ms=4, cc={64: 0, 99: 40}),

    # ------------------------------------------------------------ plucked & drums (GeneralUser)
    'nylon': dict(kind='sf2', font=GU, bank=0, program=24, range=(40, 88), pan=0.3,
                  width=0.4, depth=0.35, ref_key=60, bus='keys', humanize_ms=5),
    'taiko': dict(kind='sf2', font=GU, bank=0, program=116, range=(30, 70), pan=0.0,
                  width=0.8, depth=0.55, ref_key=45, bus='perc', humanize_ms=4),

    # ------------------------------------------------------------ synthesized
    'sub': dict(kind='synth', voice='sub', params=dict(attack=0.02, release=0.3), range=(20, 55),
                pan=0.0, width=0.0, depth=0.0, ref_key=33, bus='rhythm', humanize_ms=0),
    'pad': dict(kind='synth', voice='pad', params={}, range=(24, 96), pan=0.0, width=1.0,
                depth=0.5, ref_key=60, bus='synth', humanize_ms=0),
    'shimmer': dict(kind='synth', voice='shimmer', params={}, range=(60, 108), pan=0.0,
                    width=0.8, depth=0.8, ref_key=88, bus='synth', humanize_ms=0),
    'drone': dict(kind='synth', voice='drone', params={}, range=(12, 60), pan=0.0, width=1.0,
                  depth=0.6, ref_key=26, bus='synth', humanize_ms=0),
    'boom': dict(kind='synth', voice='boom', params={}, range=(20, 50), pan=0.0, width=0.0,
                 depth=0.4, ref_key=29, bus='perc', humanize_ms=0),
    'riser': dict(kind='synth', voice='riser', params={}, range=(0, 127), pan=0.0, width=1.0,
                  depth=0.5, ref_key=60, bus='synth', humanize_ms=0, fixed_pitch=True),
    'reverse': dict(kind='synth', voice='reverse', params={}, range=(0, 127), pan=0.0,
                    width=1.0, depth=0.5, ref_key=60, bus='synth', humanize_ms=0,
                    fixed_pitch=True),
}

# GM drum key names for drum grids
DRUM_KEYS = {
    'kick': 36, 'kick2': 35, 'snare': 38, 'rim': 37, 'clap': 39, 'snare2': 40,
    'hat': 42, 'hat_pedal': 44, 'hat_open': 46, 'tom_lo': 45, 'tom_mid': 47,
    'tom_hi': 50, 'tom_floor': 41, 'crash': 49, 'crash2': 57, 'ride': 51, 'ride_bell': 53,
    'china': 52, 'splash': 55, 'tamb': 54,
}
# This registry is the legacy palette. What a render actually plays is chosen per
# score by engine/palette.py (the house palette, a score's own changes, an audition):
# the Renderer applies it.

ORCH_KEYS = {
    'bd': 36, 'sn': 38, 'sn_taps': 37, 'sn_roll': 39, 'sn_off': 40, 'crash': 49, 'sus': 51,
    'sus_stick': 59, 'swell_s': 47, 'swell_m': 48, 'swell_l': 50, 'gong': 46,
    'gong_scrape': 42, 'tri': 79, 'tamb': 54, 'tamb_roll': 55, 'bd_rub': 32, 'anvil': 67,
    'bowed': 101, 'bell_tree': 83, 'claves': 75, 'log_hi': 76, 'log_lo': 77,
}
