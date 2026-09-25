"""Enrage layers for the act boss themes.

When a boss enrages (turn pressure), the game crossfades its theme to a mix
with that boss's own layer added: one boss-specific behaviour, not a generic
louder-and-faster. Each helper lays its parts over (bar, chart) sections of
the loop with Battle.extra(), so the layer shares the theme's timeline.
"""

from engine.patterns import arp, bass, drums, ostinato


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


def warchief(b, sections, tonic_pc=2):
    """The clan comes: taiko in 3+3+2 throughout; on the tonic chords the horns
    sound open fifths and the clan hums (the theme's march sits in the low brass,
    so the clan joins where it agrees with it and drums everywhere else)."""
    v = 'enrage_warchief'
    tk = b.extra(v, 'wc_taiko', 'taiko', role='drums')
    hn = b.extra(v, 'wc_hn', 'horns', role='section')
    hum = b.extra(v, 'wc_hum', 'oohs', role='choir')
    for bar, ch, _ in _each(sections):
        ostinato(tk, bar, ch, 'e e e e e e e e', 'b - - b - - b -', lo=38, hi=50, vel=0.8)
        t = b.s.bar(bar)
        for c, beats in ch:
            if c.root == tonic_pc:
                for off, dur in ((0.0, 1.5), (1.5, 1.5), (3.0, 1.0)):
                    if off < beats - 1e-9:
                        d = min(dur, beats - off)
                        hn.note(t + off, 50 + (tonic_pc - 2), d, vel=0.72)   # D3
                        hn.note(t + off, 57 + (tonic_pc - 2), d, vel=0.64)   # A3
                hum.note(t, 50 + (tonic_pc - 2), beats, vel=0.42)
            t += beats


def knight_commander(b, sections):
    """The charge: the gallop doubles and trumpets sound the imperial arpeggio."""
    v = 'enrage_knight_commander'
    cb = b.extra(v, 'kc_gallop', 'basses', role='low', art='spic')
    vc = b.extra(v, 'kc_gallop_vc', 'celli', role='section', art='spic')
    tpt = b.extra(v, 'kc_tpt', 'trumpets', role='section')
    for bar, ch, _ in _each(sections):
        bass(cb, bar, ch, 'e s s e s s e s s e s s', 'r r r r r r r r r r r r', floor=29,
             vel=0.7, art='spic')
        bass(vc, bar, ch, 'e s s e s s e s s e s s', 'r r r r r r r r r r r r', floor=41,
             vel=0.62, art='spic')
        ostinato(tpt, bar, ch, 'e e e e h', '0 1 2 3 -', lo=58, hi=77, vel=0.72)


def archmage(b, sections):
    """The calculation accelerates: celesta sixteenths, a note corrected every other bar."""
    v = 'enrage_archmage'
    cel = b.extra(v, 'am_cel', 'celesta', role='ostinato')
    gl = b.extra(v, 'am_gl', 'glock', role='accent')
    for bar, ch, _ in _each(sections):
        arp(cel, bar, ch, '0 1 2 3', step=0.25, lo=72, hi=96, vel=0.5)
        arp(gl, bar, ch, '3', step=1.0, lo=79, hi=96, vel=0.42)
    bb = b.s.bar_beats
    for n in cel.notes:
        bar_i = int(n.start // bb)
        # every other bar the fourth note of each beat is corrected down a semitone
        if bar_i % 2 == 1 and abs((n.start % 1.0) - 0.75) < 1e-6:
            n.pitch -= 1


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


def iron_wall(b, sections):
    """The bass finally moves: a walking line under the wall."""
    v = 'enrage_iron_wall'
    tbn = b.extra(v, 'iw_walk_tbn', 'trombones', role='section')
    tuba = b.extra(v, 'iw_walk_tuba', 'tuba', role='low')
    cb = b.extra(v, 'iw_walk_cb', 'basses', role='low')
    for bar, ch, _ in _each(sections):
        bass(tbn, bar, ch, 'q q q q', 'r 3 5 8', floor=40, vel=0.7)
        bass(tuba, bar, ch, 'q q q q', 'r 3 5 8', floor=28, vel=0.72)
        bass(cb, bar, ch, 'q q q q', 'r 3 5 8', floor=28, vel=0.66, art='spic')


def berserker_king(b, sections):
    """Blows on every beat: taiko, bass drum and marcato low brass."""
    v = 'enrage_berserker_king'
    tk = b.extra(v, 'bk_taiko', 'taiko', role='drums')
    perc = b.extra(v, 'bk_bd', 'orch_perc', role='drums')
    tbn = b.extra(v, 'bk_tbn', 'trombones', role='section')
    for bar, ch, n in _each(sections):
        ostinato(tk, bar, ch, 'q q q q', 'b b b b', lo=38, hi=52, vel=0.82)
        ostinato(tbn, bar, ch, 'q q q q', 'b b b b', lo=40, hi=52, vel=0.8)
        for i in range(n):
            drums(perc, bar + i, {'bd': 'x...x...x...x...'}, vel=0.7)


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
    """She is a beat ahead: her tritone shadow now comes before her motif, and in
    the player's own theme her glass plays the player's melody a beat early."""
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
