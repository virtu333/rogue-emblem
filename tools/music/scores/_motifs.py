"""The score's leitmotifs, shared by every cue (see tools/music/SCORE.md).

Written in D minor / D-based modes unless a cue transposes them.

THREAD       Sera's sight, the gold thread, "you". Scale degrees 5-1-2-5: a
             line pulled taut (rise a fourth, a step, a fourth) and held.
HOLLOW SUN   The goddess whose name was spent. A hymn cadence that climbs to
             the leading tone and never reaches the tonic: the missing note
             is the name. Cues that quote it leave a bar of silence there.
EMPIRE       The iron drill. Phrygian half-step: D-Eb-D-C, falling to Bb.
LIEUTENANT   The thread inverted and doubled a tritone apart, in canon a beat
             behind itself: a future fractured into two.
OLD KINGDOM  Edric's oath: a horn call built on open fourths and fifths.
UNLIGHT      The Entity: no melody. A cluster hum, and the thread reversed.
"""

# THREAD: the core cell and the full theme (title / battle source)
THREAD = 'A4q D5q E5q A5q'
THREAD_THEME = """
A4h D5q E5q | A5w | G5q. F5e E5q D5q | E5w |
A4h D5q E5q | A5h C6h | Bb5q. A5e G5q C#5q | D5w |
"""
# the same theme ending on the unresolved leading tone (the Hollow Sun)
THREAD_THEME_HOLLOW = """
A4h D5q E5q | A5w | G5q. F5e E5q D5q | E5w |
A4h D5q E5q | A5h C6h | Bb5q. A5e G5q C#5q~ | C#5q rq rh |
"""
THEME_CHORDS = 'Dm Bbmaj7 Gm7:2 C/E:2 A Dm F Gm:2 A7:2 Dm'

# EMPIRE: dotted drill, falls to the flat sixth
EMPIRE = 'D3q. Eb3e D3q C3q | Bb2h. rq |'

# OLD KINGDOM: Edric's call (D mixolydian colour)
OLD_KINGDOM = 'D4q. A4e A4q G4e A4e | D5h A4h |'

# LIEUTENANT: inverted thread (5-1-7-5 downward) and its tritone shadow
LIEUT = 'A5q D5q C5q A4q'
LIEUT_SHADOW = 'Eb5q Ab4q Gb4q Eb4q'
