# The Score — "The Last Light Is a Thread"

Every track in `assets/audio/music/` is an original composition written as code in
`tools/music/scores/` and rendered by the engine in `tools/music/engine/`. The score
follows the art bible: the world is going dark, and the one warm thing left is Sera's
sight, a gold thread. The music is built on a few leitmotifs, each tied to a fact from
the story.

## Leitmotifs (`scores/_motifs.py`)

| Motif | Shape | Meaning | Where it lives |
|---|---|---|---|
| **The Thread** | scale degrees 5-1-2-5: rise a fourth, a step, a fourth, and hold (A-D-E-A in D minor) | Sera's sight, the gold thread, the player | The main theme. Title (solo violin), every battle melody, the route maps, home base (turned major), run victory |
| **The Hollow Sun** | a phrase that climbs to the leading tone and never reaches the tonic; a bar of silence where the last note should be | the goddess whose name was spent | Title (the orchestra stops on C-sharp), the church hymn (the choir stops before its final note; one bell sounds the third, never the root) |
| **The Empire** | Phrygian half-step drill: D-Eb-D-C, falling to B-flat | the Empire's iron drills | Act I battle C strain, Act II battles and route map, the Act IV riff, the Act I boss march, the Emperor's chorale and anthem |
| **The Lieutenant** | the Thread's rhythm falling instead of rising (A-D-C-A; a free answer, not a strict inversion), shadowed one beat later a tritone away | a seer who fractures time: two futures at once | First heard in the Act III boss theme; the Normal final boss |
| **The Old Kingdom** | an open-fourths horn call | Edric's oath | Title B strain, home base, victory fanfare, loot, Border Marches |
| **Unlight** | no melody: a D/E-flat cluster hum, the Thread played backwards (A-E-D-A) | the Entity, which has no words | The secret boss |

The last cue closes the story: in **The Last Light** (run victory) the phrase the title
leaves hanging finally resolves, and the bells toll D, the root no other cue plays.

## Cue list

| Key | Title | Notes |
|---|---|---|
| `music_title` | The Hollow Sun | 66 bpm, D minor. Drone on an open fifth, bells A-G-E, solo-violin theme, the hollow cadence |
| `music_login` | The Hollow Sun (calm) | Strings/harp/choir mix of the title, exported as a whole-file loop for the HTML login screen |
| `music_home_base` | Embers of the Old Kingdom | 6/8, F major: nylon guitar and harp, flute Thread, horn oath |
| `music_shop` | Varen's Mark | G minor strut: clarinet, accordion, pizzicato walk, marimba |
| `music_rest` | Liturgy of the Spent Name | Organ and choir hymn; the second phrase never ends |
| `music_loot` | Spoils of the March | Short bright loop |
| `music_victory` | Routed | Brass fanfare of the oath, then the Thread at rest |
| `music_defeat` | The Thread Is Cut | Solo cello breaks off mid-theme |
| `music_run_win` | The Last Light | The Thread in D major; the hollow cadence resolves |
| `music_explore_act1` | The Loom: Ember Dusk | Harp/pizzicato "shuttle", flute Thread in D dorian |
| `music_explore_act2` | The Loom: Iron Rain | Celesta rain, muted-horn Empire drill, oboe Thread |
| `music_explore_act3` | The Loom: Bleached Rite | 3/4, organ and choir between E and the Phrygian F; the Thread in E, bent down through F natural |
| `music_explore_act4` | The Loom: Ashfall | Night: drone, heartbeat, bells, oboe fragments |
| `music_battle_act1` | Ember Dusk | 152 bpm D minor, the main battle theme |
| `music_battle_act1_2` | Border Marches | 6/8 cavalry gallop, G minor |
| `music_battle_act2` | Iron Rain | 160 bpm C minor; the Empire drill is the riff |
| `music_battle_act2_2` | Steel and Thread | 144 bpm A minor, driving piano ostinato |
| `music_battle_act3` | Bleached Rite | 7/8, organ and choir, E minor with a raised fourth |
| `music_battle_act3_2` | Against the Rite | B minor to a soaring D major choir chorus, then E major |
| `music_battle_act4` | Ashfall | 132 bpm C-sharp minor doom march, tolling bells |
| `music_boss_act1` | The Border Holds | Empire march in octaves against the Thread |
| `music_boss_act2` | Doctrine of Lances | F minor, everything 3+3+2; the black rider's chromatic crawl |
| `music_boss_act3` | The Perfect Duel | E minor duel; the Lieutenant's sign appears |
| `music_boss_emperor` | Human, Powerful, and Wrong | Organ chorale, imperial anthem, the Thread over the drill |
| `music_boss_lieutenant` | Every Future You Could Reach | Canon a tritone apart; the player's battle theme returns against her motif |
| `music_boss_entity` | · · · | Drones, heartbeat, clusters, the reversed Thread, a two-beat inhale |

## Adaptive battle music

Every field battle theme exists as two mixes on one timeline (`<key>` and
`<key>_calm`), like the "Rain" and "Thunder" versions in Fire Emblem: Three Houses.

- **calm**: a solo voice (solo violin, flute, oboe, clarinet) carries the tune over
  legato low strings, piano in quarters and a soft heartbeat kick.
- **full**: rock kit, bass guitar, brass unisons, string ostinati and choir.

`src/engine/MusicIntensity.js` decides the layer and `src/ui/BattleMusicController.js`
drives it. A battle opens calm. Any exchange of blows raises it to full, and so does an
enemy phase in which some enemy can reach a player unit. It settles back to calm only
after a whole round with no combat and nobody inside the visible threat range.
`src/utils/LoopedMusic.js` starts both layers at the same instant with identical loop
points, so a change of layer is a sample-aligned crossfade: the music never restarts.

## Seamless loops

Each file is an intro followed by a loop body. The engine renders the loop twice
(sample-exact copies) and exports `[0, intro + M + loop + extra]`, and the player loops
`[intro + M, intro + M + loop]`. M (at least 4 s, longer than the reverb) puts the
loop start where the intro's tails have died, so the jump is inaudible. Any constant
MP3 decoder delay shorter than M only shifts both points by the same content offset.
The build checks every file's seam numerically (`seamDb`, which must be under −45 dB).
The shipped files measure between −55 and −130 dB.
