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
| **Unlight** | no melody at all: a hum on D and its semitone shadow, and the Thread with its notes taken away (the answer, then the downbeat, then all but one inner note) | the Entity, which has no words | The secret boss, the Deep route map, the Entity's card (silence); under its finale, the hum is the Entity's own stem |

The last cue closes the story: in **The Last Light** (run victory) the phrase the title
leaves hanging finally resolves, and the bells toll D, the root no other cue plays.

## The Entity's finale

The Entity's theme is composed by removal (the answer, then the downbeat, then all but
one note). The first time anyone wounds the Entity, everything it took comes back:

1. **The hinge.** The theme stops dead: the hum that never stopped is cut (90 ms). Two
   seconds of silence. Then `stinger_entity_answer`: one violin plays the Thread at the
   finale's tempo and holds its last A. The cue's `handoff` (3.53 s) is the finale's
   first downbeat, and the game starts the finale there, sample-aligned.
2. **All of Us Across** (`music_boss_entity_finale`, 12/8, dotted quarter = 136, D minor).
   The whole army answers on beat one. A: Ember Dusk, the run's first battle theme, at
   double length over a motor whose eighths group in fours against the bar's two halves
   (3:2, after *Twilight of the Gods*): a broad line over moving ground (*The Apex of the
   World*). B: *Id (Purpose)*'s descending-fifths chain (i iv bVII bIII bVI ii° V) over its walking
   bass, every dotted quarter moving, the dominant in first inversion; horns, trumpets,
   then violins and the choir join one at a time, and the complete Thread arrives only
   when they all sing it. A2: the choir Act I never had sings Ember Dusk, and the phrase
   climbs to the leading tone (C#) and stops there; on the bar's last beat the harmony
   turns to bVII, so the C# falls to C and the loop returns without a V-i. The cadence it
   withholds is The Last Light's, which the killing blow starts.
3. **The Entity pushes back.** `music_boss_entity_finale_hum` is the Entity's own stem
   on the finale's timeline (the D hum with its E-flat shadow, the cluster, the col legno
   pulse without its downbeat). It plays as an additive layer whose level is the
   Entity's remaining HP: the dissonance drains out of the harmony as it is wounded.

4. **The army answers.** On the finale's first downbeat the army speaks, one line every
   two bars over each speaker's unit, timed from the audio clock (`BattleMusicController`
   `onFinale` → `BattleBeatsController.entityRally`, composed by `engine/FinaleRally.js`
   from `dialogue.json` `finaleRally`). The commander opens; the lords answer each other
   by name; the two strongest recruits join in their temperament's voice; Sera, whose
   sight the Thread is, closes. Lines remember the run: a unit lost along the way, a
   save that has met the Entity before, a speaker below half HP. Never more than seven
   lines, so the rally ends inside the first strain, and it never blocks input: the
   music keeps time, the words ride on it. A unit that falls before its line leaves it
   unsaid.

If turn pressure enrages the Entity before anyone wounds it, the same hinge starts the
finale. A resumed battle whose Entity is already wounded opens on the finale (no rally:
it was heard when the wound was dealt).


## Cue list

| Key | Title | Notes |
|---|---|---|
| `music_title` | The Hollow Sun | 66 bpm, D minor. Drone on an open fifth, bells A-G-E, solo-violin theme that leaves its ending unsaid, the hollow cadence. The thread's high A holds through the first statement while the harmony moves under it (fifth, seventh, ninth, sixth, root) |
| `music_login` | The Hollow Sun (calm) | Strings/harp/choir mix of the title, exported as a whole-file loop for the HTML login screen |
| `music_home_base` | Embers of the Old Kingdom | 6/8, F major: nylon guitar and harp, flute Thread, horn oath |
| `music_shop` | Varen's Mark | G minor strut: clarinet, accordion, pizzicato walk, marimba |
| `music_rest` | Liturgy of the Spent Name | Organ and choir hymn; the second phrase climbs to the leading tone and stops: a silent bar where the name was |
| `music_loot` | Spoils of the March | Short bright loop |
| `music_victory` | Routed | Brass fanfare of the oath, then the Thread at rest |
| `music_defeat` | The Thread Is Cut | Solo cello breaks off mid-theme |
| `music_run_win` | The Last Light | The Thread in D major; the hollow cadence resolves |
| `music_explore_act1` | The Loom: Ember Dusk | Harp/pizzicato "shuttle", flute Thread in D dorian |
| `music_explore_act2` | The Loom: Iron Rain | Celesta rain, muted-horn Empire drill, oboe Thread |
| `music_explore_act3` | The Loom: Bleached Rite | 3/4, organ and choir between E and the Phrygian F; the Thread in E, bent down through F natural; a pizzicato pulse in twos against the three (the sacred ground's 3:2) |
| `music_explore_act4` | The Loom: Ashfall | Night: drone, heartbeat, bells, oboe fragments. Its full statement is Act I's route-map tune note for note, over a changed bass, with its answer missing (after *A Song for Bygone Days*) |
| `music_battle_act1` | Ember Dusk | 152 bpm D minor, the main battle theme |
| `music_battle_act1_2` | Border Marches | 6/8 cavalry gallop, G minor |
| `music_battle_act2` | Iron Rain | 160 bpm C minor; the Empire drill is the riff |
| `music_battle_act2_2` | Steel and Thread | 144 bpm A minor, driving piano ostinato |
| `music_battle_act3` | Bleached Rite | 7/8, organ and choir, E minor with a raised fourth |
| `music_battle_act3_2` | Against the Rite | B minor to a soaring D major choir chorus, then E major |
| `music_battle_act4` | Ashfall | 132 bpm C-sharp minor doom march, tolling bells |
| `music_battle_escape` | One More Crossing | Escape maps. 12/8, E minor: a modest motor under the Thread at half speed; B strain a minor third up; no choir |
| `music_battle_act1_3` | Open Ground | Act I. 132 bpm, D: a minor-sixth leap on the push, where the harmony moves to bVI, a falling answer and two bars of air; the verse turns the leap over; the refrain climbs D → F → Ab by minor thirds on `i–bVI–bVII` and never uses a V (after *Blue Skies and a Battle*). Solo trumpet, harp and marimba fifths; no choir |
| `music_battle_act1_4` | The Oath at the Ford | Act I. 116 bpm march, E: Edric's oath on horns in fourths over an E pedal that brightens through A/E, D/E, C/E; the call's rise never changes, only where it lands, and in A′ the violins hold the landings above it as a descant (after *One Final Effort*, *Conquest*) |
| `music_battle_act2_3` | Old Kingdom Roads | Act II. 138 bpm, G minor: the partisans' signal (two quick notes, a leap of a seventh, a fall) in every key; the bass walks down the minor collection to Ab and then to the piece's only F#, where the violins sing the Empire's drill; then the partisans stop marching in four and dance in three, over a mazurka stamp on beat 2 (after *Chasing Daybreak*). The calm mix opens on a solo violin, not the shop's clarinet |
| `music_battle_act3_3` | Petals on the Fen | Act III. 6/8, B minor: Bm → G/B in one voice over a kept B, C(add#11) → Bm through the F# they share, a plunge-and-climb figure (on the harp in the calm mix); the second strain is a lament over a ground (B–A–G–F#, a tritone up to C, down to B, then a plagal IV) with no dominant; returning phrases lose their breath in 5/8 and 4/8 sub-bars, not their notes (the lament bass and plagal arrivals after *A Funeral of Flowers*) |
| `music_battle_act4_2` | Ember Dusk, in Ash | Act IV. Ember Dusk remembered after the ritual, a semitone down, in Ashfall's world rather than its own: its first phrase note for note (imported from `battle_act1.py`) over Ashfall's half-time tom groove, tremolo strings and tolling bells; the second over a changed bass, the answering tonic replaced by b3–b2 held against the leading tone, then silence. Ember Dusk's own band comes back once, for A3's first phrase; no choir sings the tune (after *A Song for Bygone Days*, *Between Heaven and Earth*) |
| `music_battle_castle` | Stone That Remembers | Castle maps. 132 bpm, C minor, a larger hall: a `Cm–Ab–Bb–Cm` ground that never needs a dominant; once per loop the bass takes the sigh onto the only G major and the harmony turns to Dbmaj7(#11) while the horns bend Edric's oath onto the held G (after *Fódlan Winds*) |
| `music_battle_swamp` | The Mire | Swamp maps. 5/4, F Phrygian: a drone held inside the texture, a one-pitch low cell with a kept rest and a Gb flinch that lands on the beat, then early; the tune sinks by semitone slips; in B the held C turns from a fifth into a tritone (after *Silver for Monsters*) |
| `music_battle_tundra` | Rime | Tundra maps. 112 bpm, E: one held B survives four harmonies (9th, #11, 6th, 5th; E17) and changes colour whenever it changes meaning (violins, muted brass, clarinet, violas, a celesta strike), under a line that knows when to stop moving; the kick breathes on one and three (after *Terra's Theme*). Celesta, glock, harp harmonics; no warmth arrives |
| `music_battle_volcano` | Caldera | Volcano maps. 120 bpm, Bb: a pedal under an E–A–Bb collection with no third, struck in a two-bar stamp with rests while only the taiko keeps the quarters, in modules with octatonic runs that land on the line's pitches and an anvil on beat 3 (after *One-Winged Angel*, E20) |
| `music_battle_village` | Bells Over the Village | A village under attack. 3/4 at 172, A minor: the bell's E–A–A is the fiddle's call; the village answers, a few, then many, then nobody, and without the answer the harmony is stuck on A while the bell rings on (after *Steel for Humans*, *Silver for Monsters*) |
| `music_battle_elite` | Against the Standard | Elite companies. 168 bpm, C minor: a 7-sixteenth cell crosses the bar line over a quarter-note floor, each cell head struck by a rim click and a high marimba, re-forming only at strain starts; a unison hit stops it dead and it resumes half a bar out. The tune climbs D–Eb–F# onto a cadential 6/4 |
| `music_battle_rescue` | Someone Is Still Out There | Recruit rescues. 148 bpm, F minor into F major: the stranger's line has the Thread's rhythm and other intervals (a cry up a seventh); the two meet, and in the last strain the army plays the stranger's line while the bass walks it into F major; the hope is in the inner voices, the major IV over F and a whole-tone shadow of the dominant over the leading tone (after *Indomitable Will*) |
| `music_battle_eclipsed` | Totality | Nodes the Eclipse has taken. 6/8 at 72 (dotted quarter, the slowest battle), D: the Eclipse cue's bell call and its failed answers, which stay under the call and end a step from its D, never on it; each strain loses light from the top down (the high voices, the harp, the cymbals, the choir sinking), the phrases lose their breath in real 5/8 and 4/8 bars, and only the loop brings the light back |
| `music_battle_elite_act2` | The Iron Line | Act II elite companies. 148 bpm, F minor: an Imperial heavy company. The stabs spell the Empire drill (F–Gb–F–Eb, falling to Db) at the speed of armour, in a three-bar cycle that crosses the bar line (a landing on beat 1, the next chord struck on beat 3 as a pickup to the following landing, over a bass rising by step); a two-bar low riff with one Gb/G pair walks the harmony away and home only by moving its root. The song leaps an octave onto each landing. No V–i (after *God-Shattering Star*) |
| `music_battle_elite_act3` | The Consecrated | Act III elite companies. Cut time at half = 80, A with the Phrygian Bb: the rite's own guard. The choir recites on one tone (E), a syllable a beat, over stabs rising A–Bb–C–D with every other bar empty; the dominant is a pedal the bass leaves by step, never V–i. The hymn goes to horns and trumpets in F over hammering trombones while the choir holds one note into it and stops; when the choir takes the hymn back it climbs to G# and falls silent where A should be (the Hollow Sun; after *God-Shattering Star*) |
| `music_battle_elite_act4` | The Emperor's Own | Act IV elite companies. 164 bpm, Bb minor, the Emperor's key: square strains of 3 bars + a stop bar + 3 bars + a tonic bar; in each stop bar the bass withdraws, the kit keeps going and the trumpets re-enter with a three-note pickup; the tonic arrives only by anticipation. Bass, snare and brass stabs interlock (the stabs are the snare hits). Once per loop the company's standard: the head of the Emperor's anthem, turned minor, with the choir (after *Tearing Through Heaven*) |
| `music_battle_act4_3` | The Name Is Not Spoken | Act IV. 176 bpm, B minor, 3/4 into 4/4: the tune that stands for a person is only ever played, never sung, a new instrument and a new key each time (clarinet in B, piano in D, horns in E), and it climbs to the leading tone and stops (the Hollow Sun). The choir sings only the Empire's public chant, a syllable a beat over a marcato ostinato; then the anthem in 4/4, an eight-bar modal cycle whose only leading tone is a bass walking G#–A–A#–B, built in three blocks, which falls away so the loop turns on the lone tune (after *Id ~ Purpose*) |
| `music_battle_fog` | What the Fog Keeps | Fog of war. 100 bpm, G Dorian, no drum kit: the calm mix hears the tune only in fragments (its notes passed between distant voices, most of them missing); the full mix, when blows are exchanged, fills it in, so the crossfade is the fog lifting. A phrase's last notes come back a dotted quarter later from the other side of the room; the harmony has no third until the full mix's cadences |
| `music_battle_caravan` | Coin and Canvas | A merchant caravan to protect. 146 bpm, E major, the first joyful battle theme: the tune states the tonic plainly (5–1–3, then an octave leap) while the bass never plays E at all, sitting on IV and inversions, so the loop never closes (after *Conquest*). The wheel: the bass rolling in eighths with one missing, a strummed nylon guitar, tambourine and harness bells; B turns to C# minor over a G# pedal when the wagons can burn |
| `music_colosseum` | The Pit Answers | A dorian, 3+3+2: a fiddle calls, the crowd answers... then a few voices, then nobody |
| `music_shrine` | What the Sun Kept | Blessing select. G major 3/4, harp and celesta, Lydian gold; the hymn still stops on the leading tone |
| `music_explore_deep` | The Loom: Unlight | The last act's route map: Act I's loom with its notes taken away in three stages over a D drone |
| `music_boss_act1` | The Border Holds | Empire march in octaves against the Thread |
| `music_boss_act2` | Doctrine of Lances | F minor, everything 3+3+2; the black rider's chromatic crawl |
| `music_boss_act3` | The Perfect Duel | E minor duel; the Lieutenant's sign appears |
| `music_boss_emperor` | Human, Powerful, and Wrong | Organ chorale, imperial anthem, the Thread over the drill |
| `music_boss_lieutenant` | Every Future You Could Reach | Canon a tritone apart; the player's battle theme returns against his motif; in the last strain Sera's violin answers him once with his own falling line, without the shadow |
| `music_boss_entity` | · · · | A hole in the music: hum, a heartbeat losing beats, the Thread with notes missing; one clear Thread from the player's violin. No choir, no brass, under battle loudness (−19 LUFS). Plays until the Entity's first wound |
| `music_boss_entity_finale` | All of Us Across | The Entity's finale (above): 12/8, Ember Dusk augmented, the choir, the Thread completed by everyone; ends on the leading tone. `_hum` is the Entity's stem under it, its level set by the Entity's HP |

Every boss theme also ships one **enrage layer per boss** (`<theme>_enrage_<boss>`),
rendered on the same timeline. When turn pressure enrages the boss the game
crossfades to it: one boss-specific behaviour, not a generic louder-and-faster
(`scores/_enrage.py`).

| Boss | Encounter card (`stinger_boss_*`) | Enrage layer |
|---|---|---|
| Iron Captain | the Empire drill returning to its post (D, not B-flat) | the drill doubles: 16th snare, stamped low brass |
| Warchief | taiko 3+3+2 under horn open fifths, a low clan hum | the clan joins: taiko throughout, horn fifths and hum on the tonic |
| Knight Commander | imperial arpeggio, hard leading-tone cadence, gallop | the gallop doubles, trumpet arpeggio charges |
| Archmage | a celesta calculation corrected a semitone at a time | the calculation accelerates in 16ths, corrected every other bar |
| Dark Rider | a gallop leaning on the semitone above the root, then a tritone | the root crawls to the note above and back, under everything |
| Blade Lord | two clipped neighbour notes and a long dangerous rest | no more rests: the strings cut without pause |
| Iron Wall | augmented low brass; the lower neighbour cannot move the tonic | the bass finally moves: a walking line |
| Berserker King | the clan cell compressed into blows | blows on every beat: taiko, bass drum, marcato brass |
| The Emperor | the anthem's leading-tone cadence, then the flat-second collapse | every chord rots: the low brass land a semitone above its root and fall onto it |
| The Lieutenant | his motif and its shadow; the player's Thread cut off | he is a beat ahead: the shadow comes first; the player's own melody sounds a beat early |
| The Entity | no card music: the theme drains to near-silence | no enrage layer: turn pressure starts its finale (if no wound has yet) |

## Ceremony cues (stingers)

Short one-shot cues in `tools/music/stingers/`, played by `AudioManager.playStinger`
while the track under them ducks. A **keyed** cue is written in D and rendered in
every tonic the soundtrack uses (each score declares its `tonic`), so a level-up in
the Act II battle sounds in C and one in the shop sounds in G.

| Cue | Plays at | Shape |
|---|---|---|
| `levelup` / `_perfect` / `_blank` | the level-up card (by kind) | the Thread as a harp run onto D-A-E; perfect adds horns and lands on a bright major chord; blank is two kind notes |
| `promotion_gather` → `promotion_crown` | the promotion rite: open → the new name burning in | a swell timed to the burn, then the Thread crowned over bVI-bVII... and answered by D (only here and the run win) |
| `recruit` | "joins your army" | Edric's horn call answered by the flute |
| `sealed` | a skill or rank sealed | a stamp and a ringing fifth |
| `deed` | an epithet's title card | slash, slam, brush, seal on the card's own beats |
| `arrival` | reinforcements | a snare roll and the Empire cell |
| `boss_felled` | FOE VANQUISHED | an impact and the Thread lifted to the open fifth |
| `lord_fallen` | a lord falls (before Sera's Vision) | the cello starts the Thread and stops |
| `rewind` | Vision / Rewind | a reversed swell and the Thread in retrograde |
| `eclipse` | a node falls to the Eclipse | a bell calls; the answer never comes |
| `act_card_<act>` | the act title card | Edric's oath voiced per act, in that act's map key (fixed) |
| `boss_<name>` / `boss_card` | the boss encounter card | each boss's own motif (table above) in its theme's key |
| `entity_answer` | the Entity's first wound (the hinge) | one violin's Thread; its `handoff` is the finale's first downbeat |

## Device budget

What each cue may spend, so escalation stays earned (after the Reference Track
Analysis dossier):

- **Choir** is not used in Act I (battles, boss, route). Voices arrive with the rite
  in Act III, the Emperor and the Lieutenant. The Entity never sings; its finale is
  where the choir finally sings Ember Dusk.
- **Massed doubling** (piccolo over the tune, trumpets doubling horns) is kept out of
  the most frequent theme (Act I battle).
- **Displaced accents on a straight grid** (three-sixteenth groups) belong to the Act I
  battle's string ostinato; **3:2 against the beat** to the sacred ground; a **compound
  motor under a broad line** to escape maps.
- **A completed tonic cadence of the Thread** is reserved for promotion and the run's
  final victory, which resolves it once (with the bells). The title, the victory fanfare,
  the route maps and the field and boss battles stop on the leading tone, the fifth or the
  second instead.
- **Each new battle theme owns its mechanism** (the cue list names it): bar contraction to
  Petals on the Fen and Totality, a cross-bar cycle to Against the Standard, a pedal under a
  third-less collection to Caldera, a held note changing meaning to Rime and the title, a stab cycle that spells the drill to The Iron Line, a reciting tone to The Consecrated, the stop bar with a pickup to The Emperor's Own, an unsung tune passed between keys to The Name Is Not Spoken, a tune revealed by the full mix to What the Fog Keeps, a bass that never gives the root to Coin and Canvas.

## Adaptive battle music

Every field battle theme exists as two mixes on one timeline (`<key>` and
`<key>_calm`), like the "Rain" and "Thunder" versions in Fire Emblem: Three Houses.

- **calm**: a solo voice (solo violin, flute, oboe, clarinet) carries the tune over
  legato low strings, piano in quarters and a soft heartbeat kick.
- **full**: rock kit, bass guitar, brass unisons and string ostinati (choir from Act III on).

`src/engine/MusicIntensity.js` decides the layer and `src/ui/BattleMusicController.js`
drives it. A battle opens calm. Any exchange of blows raises it to full, and so does an
enemy phase in which some enemy can reach a player unit. It settles back to calm only
after a whole round with no combat and nobody inside the visible threat range.
`src/utils/LoopedMusic.js` starts both layers at the same instant with identical loop
points, so a change of layer is a sample-aligned crossfade: the music never restarts.

## Which battle theme plays

A battle's music answers the most specific thing true of it (`engine/BattleMusicSelection.js`):

1. a boss plays its theme (the antagonists' own, else the act's);
2. an escape map plays One More Crossing;
3. a node the Eclipse has taken plays Totality; a village under attack, Bells Over the Village;
   a recruit rescue, Someone Is Still Out There; an elite company, its act's own: Against the
   Standard (Act I), The Iron Line (Act II), The Consecrated (Act III), The Emperor's Own (Act IV);
4. the map's place: castles Stone That Remembers (two thirds of them), swamps The Mire,
   tundra Rime, volcanoes Caldera;
5. a share of the rest: most maps with a merchant caravan to protect play Coin and Canvas; a
   third of the maps where bandits race for a village ring the village's bells; most maps in
   fog of war play What the Fog Keeps;
6. otherwise the act's pool: Act I Ember Dusk, Border Marches, Open Ground, The Oath at the
   Ford; Act II Iron Rain, Steel and Thread, Old Kingdom Roads; Act III Bleached Rite, Against
   the Rite, Petals on the Fen; Act IV Ashfall, Ember Dusk in Ash, The Name Is Not Spoken.

Picks are hashed from the run seed, never rolled, so a resumed battle plays what it played.
The act pool is walked in a per-run order indexed by the node's row, so a path hears no theme
twice until the pool is spent, and every run (and the tutorial) opens on Ember Dusk.

## Seamless loops

Each file is an intro followed by a loop body. The engine renders the loop twice
(sample-exact copies) and exports `[0, intro + M + loop + extra]`, and the player loops
`[intro + M, intro + M + loop]`. M (at least 4 s, longer than the reverb) puts the
loop start where the intro's tails have died, so the jump is inaudible. Any constant
MP3 decoder delay shorter than M only shifts both points by the same content offset.
The build checks every file's seam numerically (`seamDb`, which must be under −45 dB).
The shipped files measure between −53 and −130 dB.
