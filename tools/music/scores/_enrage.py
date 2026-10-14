"""Enrage layers for the act boss themes and the story bosses' themes.

A boss whose theme is its own score (the Warchief, the Knight Commander, the
Archmage, the Iron Wall, the Berserker King) writes its layer in that score.

When a boss enrages (turn pressure), the game crossfades its theme to a mix
with that boss's own layer added: one boss-specific behaviour, not a generic
louder-and-faster. Each helper lays its parts over (bar, chart) sections of
the loop with Battle.extra(), so the layer shares the theme's timeline.
"""

from engine.patterns import arp, drums, ostinato


def _each(sections):
    for bar, ch in sections:
        yield bar, ch, int(round(sum(b for _, b in ch) / 4))


def iron_captain(b, sections):
    """The drill doubles: a 16th-note snare drill and stamped low brass roots."""
    v = 'enrage_iron_captain'
    sn = b.extra(v, 'ic_snare', 'orch_perc', role='drums')
    tbn = b.extra(v, 'ic_tbn', 'trombones', role='section', art='stac')
    for bar, ch, n in _each(sections):
        for i in range(n):
            drums(sn, bar + i, {'sn': 'XoxoXoxoXoxoXxxx'}, vel=0.6)
        ostinato(tbn, bar, ch, 'q q q q', 'b - b -', lo=40, hi=52, vel=0.78)





def dark_rider(b, sections):
    """The semitone grinds: each chord's root crawls to the note above and back."""
    v = 'enrage_dark_rider'
    cb = b.extra(v, 'dr_crawl', 'basses', role='low', art='spic')
    vc = b.extra(v, 'dr_crawl_vc', 'celli', role='section', art='spic')
    for bar, ch, _ in _each(sections):
        t = b.s.bar(bar)
        for c, beats in ch:
            root = c.bass_note(29)
            for k in range(int(round(beats * 2))):
                p = root + (0, 1, 0, -1)[k % 4]
                cb.note(t + k * 0.5, p, 0.5, vel=0.72, art='spic')
                vc.note(t + k * 0.5, p + 12, 0.5, vel=0.6, art='spic')
            t += beats


def blade_lord(b, sections):
    """No more rests: the violins cut without pause."""
    v = 'enrage_blade_lord'
    vn = b.extra(v, 'bl_vn', 'violins', role='ostinato', art='spic')
    va = b.extra(v, 'bl_va', 'violas', role='ostinato', art='spic')
    for bar, ch, _ in _each(sections):
        arp(vn, bar, ch, '0 1 2 1', step=0.25, lo=67, hi=88, vel=0.6, accent_every=4)
        arp(va, bar, ch, '2 1 0 1', step=0.25, lo=55, hi=72, vel=0.52, accent_every=4)




def emperor(b, sections):
    """The cadence rots while the march goes on: low brass land a semitone above
    each chord root and collapse onto it (his Eb-D, everywhere), over a doubled
    snare drill."""
    v = 'enrage_emperor'
    tbn = b.extra(v, 'em_rot_tbn', 'trombones', role='section')
    tuba = b.extra(v, 'em_rot_tuba', 'tuba', role='low')
    sn = b.extra(v, 'em_snare', 'orch_perc', role='drums')
    for bar, ch, n in _each(sections):
        t = b.s.bar(bar)
        for c, beats in ch:
            root = c.bass_note(41)
            # the flat second above on the downbeat, falling onto the root
            lean = 1.0 if beats >= 4 else 0.5 if beats >= 2 else 0.0
            if lean:
                tbn.note(t, root + 1, lean, vel=0.84)
                tuba.note(t, root - 11, lean, vel=0.8)
            tbn.note(t + lean, root, beats - lean, vel=0.72)
            tuba.note(t + lean, root - 12, beats - lean, vel=0.72)
            t += beats
        for i in range(n):
            drums(sn, bar + i, {'sn': 'x.oox.oox.oox.ox'}, vel=0.62)


def _copy_shifted(src, dst, start_beat, end_beat, shift, transpose=0, vel_scale=1.0):
    for n in list(src.notes):
        if start_beat - 1e-9 <= n.start < end_beat - 1e-9:
            dst.note(n.start + shift, n.pitch + transpose, n.dur, vel=min(1.0, n.vel * vel_scale))


def lieutenant(b, lieut_sections, player_sections, lead='lead_violins'):
    """He is a beat ahead: his tritone shadow now comes before his motif, and in
    the player's own theme his glass plays the player's melody a beat early."""
    v = 'enrage_lieutenant'
    s = b.s
    src = s.parts[lead]
    shadow = b.extra(v, 'lt_early_shadow', 'celesta', role='counter')
    early = b.extra(v, 'lt_early_player', 'glock', role='accent')
    harp = b.extra(v, 'lt_early_harp', 'harp', role='keys')
    for bar, ch, n in _each(lieut_sections):
        a, z = s.bar(bar), s.bar(bar + n)
        _copy_shifted(src, shadow, a, z, -1.0, transpose=-6, vel_scale=0.85)
    for bar, ch, n in _each(player_sections):
        a, z = s.bar(bar), s.bar(bar + n)
        _copy_shifted(src, early, a, z, -1.0, vel_scale=0.8)
        _copy_shifted(src, harp, a, z, -1.0, transpose=-12, vel_scale=0.8)
