# Five Rooms: boss themes for an ocarina

A standalone suite written with this repo's music engine (`tools/music/engine`). It is
not part of Rogue Dawn: nothing here is registered in the game, and rendering it
writes no game assets.

The premise: *Ocarina of Time* gives most of its bosses a shared battle theme. Elden
Ring gives every major boss a piece of its own, built from who that boss is. These are
five such pieces for five of Ocarina's rooms, in that manner: large orchestra and
choir, a quiet first phase and a second that is not, and each one built on a single
musical mechanism taken from how the fight actually works.

Everything is original. No melody from either game is quoted. This is an unofficial
fan work, not affiliated with or endorsed by Nintendo or FromSoftware.

## The pieces

| # | Boss | Title | Meter, key | The mechanism |
|---|---|---|---|---|
| 1 | Dark Link | No Reflection | 6/8, D | A strict mirror. Every note the shadow plays is the hero's note turned upside down around D, computed, never written; the piece is the mirror's delay closing (a bar, half a bar, none). Dorian is its own reflection, so at first the shadow is consonant; the brighter the hero plays, the darker the mirror answers (major comes back Phrygian, Lydian comes back Locrian). They can agree on two notes only, D and A-flat. |
| 2 | Phantom Ganon | Six Paintings of the Same Road | 12/8, G minor and C-sharp minor | Two riders approach at once in two keys a tritone apart; one turns round (its tune in strict retrograde) and the other rides out of the wall, in its key. The piece only modulates this way. Then the volley: an augmented arpeggio thrown between low and high, a semitone higher each stroke (so each side owns one whole-tone scale), the gaps shrinking 4 4 3 3 2 2 1 1 1 1 ½ ½ ½ ½ beats. |
| 3 | Volvagia | The Ground and the Coil | 3/4, F minor | A passacaglia that gets hit. An eight-bar ground bass (the mountain, and the hammer) never changes; the dragon is one unbroken line of eighth notes that stops for exactly one beat each time the ground comes round, and comes up out of a different instrument. Thirteen turns. |
| 4 | Bongo Bongo | Two Hands, No Drummer | 15/8, C | Five against three: the left hand beats five to the bar, the right three, and they meet only on the downbeat. Every note of the tune starts on one of their seven strokes (3 2 1 3 1 2 3). At first the tune is only struck, on timpani; then the same notes are sung and held, and you can see what has been hitting you. |
| 5 | Twinrova | The Sisters Finish Each Other's Sentences | 7/8, A | Two scales that share only their tonic and fifth, and between them own all twelve notes. Neither sister can sing a note that is not hers, so the tune is passed, bar by bar, then half-bar by half-bar, then note by note down the chromatic scale. Merged, one voice sings every bar, hot and cold by turns. |

Each score's docstring is its programme note: the form, bar by bar, and what the
mechanism does where.

**The Hero's Call** runs through all five: seven notes on the five pitches a five-hole
ocarina plays (D F A B D'), D A B A F A D'. It is none of the songs the game teaches.
Dark Link's whole tune grows out of it and its mirror; in the gallery it is the
ocarina that says someone has come in, and the brass after the phantom falls; over
Volvagia's ground the horns play it when the dragon is stunned; against Bongo Bongo
it is played one note to a stroke, in the monster's own rhythm (seven notes, seven
strokes); against Twinrova it is the mirror shield's answer, and turns out to lie
wholly inside the ice scale.

## Rendering

Setup is the engine's own (`tools/music/README.md`: Python packages, ffmpeg,
fluidsynth, `sfizz_render`, and `bash tools/music/fetch_libraries.sh` for the sample
libraries).

```bash
python3 tools/music/experiments/ocarina_bosses/render.py --all          # all five
python3 tools/music/experiments/ocarina_bosses/render.py dark_link      # one
python3 tools/music/experiments/ocarina_bosses/render.py volvagia --bars 57 73   # an excerpt
python3 tools/music/experiments/ocarina_bosses/render.py twinrova --check        # no audio: form, ranges, clashes
```

Output goes to `References/music-lab/ocarina_bosses/` (gitignored; `$OCARINA_BOSSES_OUT`
overrides it). For each piece:

- `<name>.mp3`: the listening cut (the intro, the loop once, its opening again, fading);
- `<name>_loop.mp3`: intro plus a seamless loop region, with `loops.json` giving
  `loopStart` / `loopEnd` in seconds, in the same form the game's own tracks use.

The engine's measured tables (onset compensation, level calibration) are copied to the
output folder and used from there, so the suite's extra instruments never add entries
to the game's tables.

## What the suite adds to the engine (in `kit.py`, nothing in `engine/` is changed)

- **An ocarina, modelled rather than sampled.** A vessel flute is nearly a sine wave
  whose pitch follows breath pressure. The voice plays a line as a player would: notes
  that touch are slurred on one breath, separated notes are tongued, a note scoops up
  into tune as the breath arrives and sags as it leaves, a held note takes a slow,
  uneven vibrato.
- **`mirror`, `retrograde`, `shift`, `tchart`**: transforms on the engine's note
  strings and chord charts. The Dark Link score contains no shadow part: it is
  `mirror(hero)`.
- A harpsichord, a bowed-glass pad and hand drums from the GeneralUser GS SoundFont the
  engine already uses.

All five are orchestra and choir only: no drum kit, no bass guitar.

## Credits

The sample libraries are the engine's (`docs/music-credits.md`): Sonatina Symphonic
Orchestra 4 (CC Sampling Plus 1.0), Virtual Playing Orchestra 3 (CC BY-SA sources),
VSCO-2 Community Edition (CC0), GeneralUser GS, Splendid Grand Piano. Renders made with
them carry the same attribution requirements as the game's soundtrack.
