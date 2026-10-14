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
leaves hanging finally resolves, and the bells toll D. Other cues strike a D bell as a call
(Totality, the eclipse and deed cues, the Act IV card, the Entity's finale); only here does the
Hollow Sun's leading tone rise onto it.

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
| `music_defeat` | The Thread Is Cut | The celli break off mid-theme |
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
| `music_battle_act1_5` | Double Time | Act I. A fighting march in A minor, quick time (116) into double time (174) and back by **metric modulation**, never by a jump: in A2 the strings and snare fall into triplet eighths, accented in twos for the last two bars, and at B those triplets are plain eighths of a beat half as fast again; the same tune returns at the run, note for note. Its drive: a marching orchestral snare in dotted figures over the kit, the whole low end (celli, basses, bass guitar, piano octaves) striking one syncopated rhythm on the root (1 . 2 . 3 . . a), a 3+3+2 eighth ostinato in the second violins under every strain, and over them a broad tune on unison horns: each long note struck short on the downbeat and held from beat two across the bar line, reached by two leaping pickups, the held notes climbing C, G, A and landing on B over the dominant. Coming home, eight dotted-quarter strokes across three bars (D minor, B-flat, E) become the beat of quick time again. C climbs by step F G A (bVI bVII I) into the piece's only A major, turns to the minor iv and leads back to the tune by its one perfect cadence. No choir |
| `music_battle_act2_3` | Old Kingdom Roads | Act II. 138 bpm, G minor: the partisans' signal (two quick notes, a leap of a seventh, a fall) in every key; the bass walks down the minor collection to Ab and then to the piece's only F#, where the violins sing the Empire's drill; then the partisans stop marching in four and dance in three, over a mazurka stamp on beat 2 (after *Chasing Daybreak*). The calm mix opens on a solo violin, not the shop's clarinet |
| `music_battle_act2_4` | Every Other Word | Act II. 150 bpm, B minor: an occupied land passing a message in pieces. The tune is played in **hocket** between two bands that stand apart, strings on the left, flute, oboe and trumpets on the right, and the share grows strain by strain: one note each, two notes, a bar (the broad second tune, called and answered), two bars; in the last strain both bands play the tune whole, in unison. Each band keeps its own octave pair, so a share changes side and colour, never register. Calm: the hocket between a solo violin and a clarinet. A far choir (oohs) only under the last strain |
| `music_battle_act3_3` | Petals on the Fen | Act III. 6/8, B minor: Bm → G/B in one voice over a kept B, C(add#11) → Bm through the F# they share, a plunge-and-climb figure (on the harp in the calm mix); the second strain is a lament over a ground (B–A–G–F#, a tritone up to C, down to B, then a plagal IV) with no dominant; returning phrases lose their breath in 5/8 and 4/8 sub-bars, not their notes (the lament bass and plagal arrivals after *A Funeral of Flowers*) |
| `music_battle_act3_4` | Dawn by Degrees | Act III. 4/4 at 136, B-flat: day breaks one note at a time. The tonic and the tune (written once in scale degrees) never change; the **mode brightens one degree a strain** in circle-of-fifths order, Phrygian, Aeolian, Dorian, Mixolydian, Ionian, and a glockenspiel with a tubular bell strikes each rising note (C, G, D, A) where the tune first sounds it. Every strain climbs to the seventh; only the Ionian makes it a leading tone, over the dominant, and in that bar the band stops, a reversed swell rises under the held A, the bells fall back in the order they lit and the loop drops into Phrygian (the Hollow Sun's resolution stays reserved). After *Chasing Daybreak*'s techniques, not its notes: the side-drum motor, ticking staccato strings over pumping eighths, a broad horn tune, running sixteenths, a strain thinned to bass drum, bells, flute and held choir, and the choir singing the tune at the top. Its key changes, 3/4 switch and 3+3+2 accents are left with it |
| `music_battle_act4_2` | Ember Dusk, in Ash | Act IV. Ember Dusk remembered after the ritual, a semitone down, in Ashfall's world rather than its own: its first phrase note for note (imported from `battle_act1.py`) over Ashfall's half-time tom groove, tremolo strings and tolling bells; the second over a changed bass, the answering tonic replaced by b3–b2 held against the leading tone, then silence. Ember Dusk's own band comes back once, for A3's first phrase; no choir sings the tune (after *A Song for Bygone Days*, *Between Heaven and Earth*) |
| `music_battle_castle` | Stone That Remembers | Castle maps. 132 bpm, C minor, a larger hall: a `Cm–Ab–Bb–Cm` ground that never needs a dominant; once per loop the bass takes the sigh onto the only G major and the harmony turns to Dbmaj7(#11) while the horns bend Edric's oath onto the held G (after *Fódlan Winds*) |
| `music_battle_swamp` | The Mire | Swamp maps. 5/4, F Phrygian: a drone held inside the texture, a one-pitch low cell with a kept rest and a Gb flinch that lands on the beat, then early; the tune sinks by semitone slips; in B the held C turns from a fifth into a tritone (after *Silver for Monsters*) |
| `music_battle_tundra` | Rime | Tundra maps. 112 bpm, E: one held B survives four harmonies (9th, #11, 6th, 5th; E17) and changes colour whenever it changes meaning (violins, muted brass, clarinet, violas, a celesta strike), under a line that knows when to stop moving; the kick breathes on one and three (after *Terra's Theme*). Celesta, glock, harp harmonics; no warmth arrives |
| `music_battle_volcano` | Caldera | Volcano maps. 120 bpm, Bb: a pedal under an E–A–Bb collection with no third, struck in a two-bar stamp with rests while only the taiko keeps the quarters, in modules with octatonic runs that land on the line's pitches and an anvil on beat 3 (after *One-Winged Angel*, E20) |
| `music_battle_village` | Bells Over the Village | A village under attack. 3/4 at 172, A minor: the bell's E–A–A is the fiddle's call; the village answers, a few, then many, then nobody, and without the answer the harmony is stuck on A while the bell rings on (after *Steel for Humans*, *Silver for Monsters*) |
| `music_battle_broken_sun` | Under the Broken Sun | The change-up in every act's pool. 150 bpm, E minor. The anime OP experiment (`experiments/anime_op/`, 欠けた太陽) turned into a battle theme: a J-rock band (the Emilyguitar through `engine/guitar.py`, double-tracked; the Growlybass; the kit) and the house choir on "ah". The OP's kime and the Empire drill open it; the hook (the Thread) on lead guitar; a verse over which the low choir chants the drill (E-F-E-D, then A-Bb-A-G) against palm mutes; the B-melo in half time with an accelerating roll; the chorus sung by the choir in octaves with the guitar a third below over a pumping pad; a new strain, the choir's own hymn (the Thread augmented), first alone over palm mutes, then with the band; the turnaround is the Hollow Sun: choir and guitar climb to D#, the band cuts, and three beats of silence stand where E should be. Calm: clean chorused guitars, a string pad, the clean bass, light drums |
| `music_battle_elite` | Against the Standard | Elite companies. 168 bpm, C minor: a 7-sixteenth cell crosses the bar line over a quarter-note floor, each cell head struck by a rim click and a high marimba, re-forming only at strain starts; a unison hit stops it dead and it resumes half a bar out. The tune climbs D–Eb–F# onto a cadential 6/4 |
| `music_battle_rescue` | Someone Is Still Out There | Recruit rescues. 148 bpm, F minor into F major: the stranger's line has the Thread's rhythm and other intervals (a cry up a seventh); the two meet, and in the last strain the army plays the stranger's line while the bass walks it into F major; the hope is in the inner voices, the major IV over F and a whole-tone shadow of the dominant over the leading tone (after *Indomitable Will*) |
| `music_battle_eclipsed` | Totality | Nodes the Eclipse has taken. 6/8 at 72 (dotted quarter, the slowest battle), D: the Eclipse cue's bell call and its failed answers, which stay under the call and end a step from its D, never on it; each strain loses light from the top down (the high voices, the harp, the cymbals, the choir sinking), the phrases lose their breath in real 5/8 and 4/8 bars, and only the loop brings the light back |
| `music_battle_elite_act2` | The Iron Line | Act II elite companies. 148 bpm, F minor: an Imperial heavy company. The stabs spell the Empire drill (F–Gb–F–Eb, falling to Db) at the speed of armour, in a three-bar cycle that crosses the bar line (a landing on beat 1, the next chord struck on beat 3 as a pickup to the following landing; in A the bass spells the drill with the top, in outer voices, and only C's bass rises by step); a two-bar low riff with one Gb/G pair walks the harmony away and home only by moving its root. The song leaps an octave onto each landing. No V–i (after *God-Shattering Star*) |
| `music_battle_elite_act3` | The Consecrated | Act III elite companies. Cut time at half = 80, A with the Phrygian Bb: the rite's own guard. The choir recites on one tone (E), a syllable a beat, over stabs rising A–Bb–C–D with every other bar empty; the dominant is a pedal the bass leaves by step, never V–i. The hymn goes to horns and trumpets in F over hammering trombones while the choir holds one note into it and stops; when the choir takes the hymn back it climbs to G# and falls silent where A should be (the Hollow Sun; after *God-Shattering Star*) |
| `music_battle_elite_act4` | The Emperor's Own | Act IV elite companies. 164 bpm, Bb minor, the Emperor's key: square strains of 3 bars + a stop bar + 3 bars + a tonic bar; in each stop bar, after a stamp on its downbeat, the bass and the stabs withdraw, the kit keeps going and the trumpets re-enter with a three-note pickup; the tonic arrives only by anticipation. Bass, snare and brass stabs interlock (the stabs are the snare hits). Once per loop the company's standard: the head of the Emperor's anthem, turned minor, with the choir (after *Tearing Through Heaven*) |
| `music_battle_act4_3` | The Name Is Not Spoken | Act IV. 176 bpm, B minor, 3/4 into 4/4: the tune that stands for a person is only ever played, never sung, a new instrument and a new key each time (clarinet in B, piano in D, horns in E), and it climbs to the leading tone and stops (the Hollow Sun). The choir sings only the Empire's public chant, a syllable a beat over a marcato ostinato; then the anthem in 4/4, the imperial drill chant ("Left, and the line") on the tonic and its semitone shadow, climbing a step at a time to end on B (not a dotted march head: that is the Emperor's, and his guard's standard), over an eight-bar modal cycle whose only leading tone is a bass walking G#–A–A#–B, built in three blocks, which falls away so the loop turns on the lone tune (after *Id ~ Purpose*) |
| `music_battle_fog` | What the Fog Keeps | Fog of war. 100 bpm, G Dorian, no drum kit: the calm mix hears the tune only in fragments (its notes passed between distant voices, most of them missing); the full mix, when blows are exchanged, fills it in, so the crossfade is the fog lifting. A phrase's last notes come back a dotted quarter later from the other side of the room; the harmony has no third until the full mix's cadences |
| `music_battle_caravan` | Coin and Canvas | A merchant caravan to protect. 146 bpm, E major, the first joyful battle theme: the tune states the tonic plainly (5–1–3, then a leap to the tonic an octave up) while the bass never plays E at all, sitting on IV and inversions, so the loop never closes (after *Conquest*). The wheel: the bass rolling in eighths with one missing, a strummed nylon guitar, tambourine and harness bells; B turns to C# minor over a G# pedal when the wagons can burn |
| `music_battle_escape_2` | We Came This Far Also | Escape maps, Acts III–IV and the final act, shared in Act II. 4/4 at 174, F minor: an endless climb (a Shepard–Risset scale) in the strings, one pitch class in every octave under a loudness bell, each section climbing its two octaves and handing over without a leap, twelve octaves a loop so it returns to itself; the wrap is hidden mid-phrase, never under the tonic. Over it a head that worries the semitone above the fifth (G Ab G Ab C) and a long answer falling while the climb rises. The climb's speed is the form (one step a bar, two, then four and eight in the sprint); after it, one blow and three beats of stillness on the leading tone. Named for the oldest carving on the old kings' stair |
| `music_battle_rescue_2` | Quick, Quick, Quick, Slow | Recruit rescues, Acts II and IV. 9/8 at 170, E Dorian: a stranger on a plucked zither (VCSL dan tranh) and a darbuka counts the bar 2+2+2+3; the army counts it 3+3+3, and learns the stranger's step one section at a time (the bass in C, the kit in D, the brass in E, the strings in F). The tune gives one note to each of the stranger's groups (E E B A C#, the long note the Dorian sixth over A). After a bar where only the stranger plays, the whole band stamps the stranger's quick-quick-quick-slow at once (bar 45). The calm mix states the army's count on soft timpani, so its change is heard there too |
| `music_battle_fog_2` | Out of Step | Fog of war, Act II and shared in Acts III–IV. The army in D minor, 3/4 at 156, its phrases starting on beat 3 (E up a tritone to B-flat); an Imperial patrol band in B-flat, 2/4 at 117, its march cadencing on the drill at pitch (after Ives's two bands). Every band note is written twice: a far band (calm; muted, filtered, mostly hall) and a near one (full; open, dry), so the crossfade is the enemy arriving. The band quickens until its beat is the army's (bar 45: one unison D, a beat of silence, the kit), then the army's tune is forced into the march, its E bent to E-flat, and takes the E back in D2 |
| `music_battle_castle_2` | Every Voice at Its Post | Castle maps, Act IV and shared in Act III. 4/4 at 140, G minor: a real four-voice fugue whose subject is the Empire's drill a fifth down (G Ab G F / Eb D Eb F Bb A), so every answer is the drill at its own pitch; an invertible countersubject, episodes built from its fragments, middle entries in B-flat and C minor, a stretto of five entries a bar apart, climbing (the choir takes one), and a pedal with the subject in augmentation over the Neapolitan. Strings carry the voices, winds join them at unison in the episodes; the calm mix is the fugue on the organ's quiet stops, the bass voice plucked |
| `music_battle_descent` | Ember Dusk, Below | Act V field battles (the Old Kings' Stair, the Mortuary Column, the Landing). 140 bpm, D minor: Ember Dusk's first phrase (imported from `battle_act1.py`) remembered a third time, further hollowed than Ashfall's, in four **landings**, each a minor third lower (D, B, G-sharp, F: a diminished seventh, so the fourth steps back onto the first and the loop closes with no leap). Each landing keeps i VI VII V (Dm Bbmaj7 C A, shifted with it), and its V never falls a fifth: it steps up a second onto the next landing's i. The tune's reach, the held A5, is a rest; on the beat where it would sound a harp runs down the chord from that A, and the same note sounds three octaves down on bar two's first beats (celli and basses, in the second telling trombones and tuba), alone, the floor under it gone: the climb has fallen through the stair. The first telling is cold and sparse (violins, celesta and oboe over bare tremolo fifths, a kit of three toms stepping down the bar and a kick on each landing, a bell on each landing's root); the lament ground (D C B-flat A twice) follows the Thread's first three notes down, its fourth never played, over a driving root-and-fifth sixteenth figure; the Hollow Sun is the climb F G A B-flat C-sharp over a D pedal that leaves the bass for the last three bars, so the C-sharp is the third of an A that never goes home, and bar 36 is the hole, where the bass falls to C (the C-sharp falls a semitone) and the second telling begins by the stair's own step, never V–i; the second telling brings the band. No choir sings the tune (oohs, far, in the second telling and the climb). Calm: solo violin, the oboe and bassoon on the climb and the fragments, piano fifths, a soft heartbeat |
| `music_battle_vigil` | Through the Floor | The Vigil, the court circle's mini-boss (no boss card, no boss theme). 120 bpm, G minor: four Voices chant the Hollow Sun, the church hymn's climb Bb C D Eb F-sharp, in strict diatonic **parallel organum** (the line, a fourth below it, an octave below it and a fourth below that), so the harmony is hollow fourths and fifths and only the leading tone brings in a chromatic note (the C-sharp under the F-sharp); the voices never cadence and G is never sung. Under them a falling ostinato of three-eighth cells that descend the chord and so never land on the beat, drones G, E-flat, D, and ritual percussion in 3+3+3+3+2+2 (log drums, floor tom, bass drum; never 3+3+2). The call (A) climbs a third, falls back and rests on A over the D pedal; the climb (B) goes to the leading tone and stops, the voices cut, the tam-tam is scraped and the bass drum rubbed, and the F-sharp falls a semitone into two bars of a low F (the words falling through the floor; F to G is a step from below, never V–i) until the rite's 2+2 tail leads back in; in C the circle tightens: the climb in quarters over a bass that rises a semitone every two bars (G, A-flat, A, B-flat), each cell ending on its own leading tone, each tier louder and with one more voice of the band. The band (brass doubling the Voices, bass guitar, kit) comes with the second call. Calm: one Voice (the court at its prayer) over cellos, the piano's fifths, a harp playing the falling cell, a far triangle on the rite's pulse |
| `music_colosseum` | The Pit Answers | A dorian, 3+3+2: a fiddle calls, the crowd answers... then a few voices, then nobody |
| `music_shrine` | What the Sun Kept | Blessing select. G major 3/4, harp and celesta, Lydian gold; the hymn still stops on the leading tone |
| `music_explore_deep` | The Loom: Unlight | The last act's route map: Act I's loom with its notes taken away in three stages over a D drone |
| `music_boss_act1` | The Border Holds | The Iron Captain (and any boss without a theme of its own: the prologue's Captain Varro). Empire march in octaves against the Thread |
| `music_boss_warchief` | Breaker of Treaties | The Warchief. 152 bpm, D Phrygian minor: **the treaty in four, broken into seven, and bled to minor**. Two ways home to D: the treaty (a D major brass chorale in square 4/4 half notes, the piece's only major key and only leading tone) rises by C-sharp; the clans (7/8, 2+2+3, every group head stamped by taiko and bass drum, never 3+3+2, low celli sawing D D, E-flat D, D D E-flat under everything) fall by E-flat, every cadence bII–i. Their war song (A D, D E-flat F; over i, iv and a bare A ground against B-flat; a tritone leap to E-flat falling to D) on horns with trombones growling under, then sung by the clan's low choir while the fiddle laughs in falling minor thirds; each phrase ends on a band-stop "HAH!" (brass, the clan and the drums on the open fifth, trumpets snarling a semitone over it); the axe strain chops e e q q. over i, bVI, bII and a bare A with its flat ninth, an anvil and semitone tremolos, its last HAH dropping into near-silence. Out of it the treaty comes once, muted and far off, in D major, a phrase long; the seven swallows it and it goes on in four over the seven (timpani on its half notes, taiko the seven, realigning every 28 beats) while the clans bleed it to minor with low chants and trombone clusters (D, E-flat, A), until its held C-sharp grinds against E-flat, the brass stamp E-flat, a beat and a half of silence, and the war song crashes back on D |
| `music_boss_knight_commander` | The Doctrine and Its Ledger | The Knight Commander. 6/8 at dotted quarter = 101, B-flat minor: a **doctrine and its ledger**. The doctrine is a slow horn-and-trombone tune whose head is the tonic, the flat second's sigh (C-flat back to B-flat over the tonic pedal) and a leap to his faith, the E-natural, now the tritone (a tubular bell rings it), climbing through a hemiola, every dominant with its flat ninth, over low strings sawing eighths up to C-flat and trumpet clusters on the held notes; the card's long-short-short is the riders' hooves (timpani, field drum). The ledger opens on a cut (tam-tam, a B-flat/C-flat/E stroke): a low choir sings the doctrine while the accompaniment loses a voice every two bars, the bell tolling the tritone for each, down to the field drum and a violin shiver on B-flat and C-flat. The second push climbs a step every two bars in the low brass over a bass rising by semitones B-flat to F through minor, bare and diminished chords, trumpets stabbing minor seconds; the tutti return ends on G-flat over G-flat with a tam-tam and the flat-ninth dominant drives back in: nothing resolves |
| `music_boss_archmage` | The Sums Still Balance | The Archmage, Act II. 152 bpm, E minor: a **palindrome** (E F# G B, A G F# D#, a low climb to C, then the same notes back; the card's figure slowed down) built from a line and its counterpoint in thirds and sixths, so the tune started at its middle page is a strict crab canon (the fold: violins against horns, trombones and celli, over a palindromic harmony); a marimba works a sum in sixteenths, each group one note longer (3 … 10, 12, then over), played backwards by the celesta in the fold; a second tune that counts (one note in its first bar … eight in its last); under it all BEING FED, a low swell (the basses' E, the tuba's F, the trombones' B-flat, oohs, a timpani roll) that grows every strain and is never answered, until the turn, where the tune is stuck on its first bar and the swell is cut dead on beat 3: the card's figure taps twice and the loop restarts clean |
| `music_boss_act2` | Doctrine of Lances | The Dark Rider. F minor, everything 3+3+2; the black rider's chromatic crawl |
| `music_boss_act3` | The Perfect Duel | The Blade Lord. E minor duel; the Lieutenant's sign appears |
| `music_boss_iron_wall` | The Order That Never Came | Act III boss, the Holder of the Breach. 112 bpm, D-flat minor (Phrygian, written C-sharp minor): **a pedal that will not move**, one low C-sharp (basses, the organ's pedal, the sub; the tuba in the last strain) under the whole loop, the celli and violas sawing at it in eighths then sixteenths and pricking it with the Phrygian D above; every chord grinds on it (D minor a minor ninth up, A minor, A-sharp diminished, G minor a tritone away). The tune marches low in horns and trombones (half note, two quarters), down the tonic chord in two-bar cells, each note struck twice with the semitone above pressing on it, then falling a tritone; it ends unresolved on G. At each strain's end a distant trumpet sounds the order to fall back (an F-sharp minor bugle call) and the wall (a dissonant brass and percussion hit) cuts it off sooner each time (five notes, four, three, two). Between: a men's chant on hammered fifths and semitones, a static hammer riff (C-sharp struck, D held against it, G a tritone below) under choir and trumpet clusters, a near-silent strain (tritone oohs, a timpani heartbeat, a growing trombone cluster), then the tune with everyone, the men's choir on the melody |
| `music_boss_berserker_king` | Frightened Acclaim | The Berserker King. Orchestral metal in A Phrygian that accelerates from 150 to 180 over the loop: the King's two-bar riff on A never changes, while his court (a low choir, horns and organ) sings a D-minor coronation anthem in the same seven notes, ever faster (half notes, then quarters with an eighth-note gabble over them), never reaching its tonic: its last A, D minor's dominant, is taken as the King's root on a B♭-A Phrygian cadence; the crowning drops back to 150 for the anthem as written over crushed chords. |
| `music_boss_emperor` | Human, Powerful, and Wrong | Organ chorale, imperial anthem, the Thread over the drill |
| `music_boss_lieutenant` | Every Future You Could Reach | Canon a tritone apart; the player's battle theme returns against his motif; in the last strain Sera's violin answers him once with his own falling line, without the shadow |
| `music_boss_entity` | · · · | A hole in the music: hum, a heartbeat losing beats, the Thread with notes missing; one clear Thread from the player's violin. No choir, no brass, under battle loudness (−19 LUFS). Plays until the Entity's first wound |
| `music_boss_entity_finale` | All of Us Across | The Entity's finale (above): 12/8, Ember Dusk augmented, the choir, the Thread completed by everyone; ends on the leading tone. `_hum` is the Entity's stem under it, its level set by the Entity's HP |

Every boss has a theme of its own: the three act themes belong to the Iron Captain,
the Dark Rider and the Blade Lord, and the Warchief, the Knight Commander, the Archmage,
the Iron Wall and the Berserker King each have their own score. Every boss theme ships its
boss's **enrage layer** (`<theme>_enrage_<boss>`), rendered on the same timeline. When
turn pressure enrages the boss the game crossfades to it: one boss-specific behaviour,
not a generic louder-and-faster (`scores/_enrage.py` for the shared themes; a boss's own
score writes its layer itself).

| Boss | Encounter card (`stinger_boss_*`) | Enrage layer |
|---|---|---|
| Iron Captain | the Empire drill returning to its post (D, not B-flat) | the drill doubles: 16th snare, stamped low brass |
| Warchief | taiko 3+3+2 under horn open fifths, a low clan hum | the whole clan stamps every 2+2+3 head (taiko, bass drum, trombones roaring open fifths over a ground semitone), straight through the treaty's moment of major |
| Knight Commander | imperial arpeggio, hard leading-tone cadence, gallop | lances level: the hooves become a taiko-and-bass-drum stampede on every stride, even under the doctrine and through the ledger; horn-and-trombone charge calls at each phrase over snare rolls |
| Archmage | a celesta calculation corrected a semitone at a time | it answers: a low E–F cluster and bass drum on every downbeat, a breath swelling into the next |
| Dark Rider | a gallop leaning on the semitone above the root, then a tritone | the root crawls to the note above and back, under everything |
| Blade Lord | two clipped neighbour notes and a long dangerous rest | no more rests: the strings cut without pause |
| Iron Wall | augmented low brass; the lower neighbour cannot move the tonic | the wall stops waiting: low-brass, taiko and bass-drum blows land in every bar, shaped to each strain, men's shouts in the call bars and the quiet strain; the order to fall back is never heard |
| Berserker King | the clan cell compressed into blows | blows on every beat, always on A: taiko, bass drum, marcato trombones and tuba, a guitar octave, under the court's chords too |
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
| `voice_silenced` | a Voice of the Vigil falls | the chant's last chord, the Hollow Sun's leading tone in four-voice organum; the top Voice stops where the tam-tam is scraped and the bass drum rubbed (the theme's fall) while the other three hold open fifths and thin away. Nothing resolves. Keyed (D → the Vigil's G) |

## Device budget

What each cue may spend, so escalation stays earned (after the Reference Track
Analysis dossier):

- **Choir** is not used in Act I (battles, boss, route). In Act II it is a far colour
  under the tune (oohs and a choir pad in Iron Rain and Steel and Thread, oohs under Every
  Other Word's last strain, and the Act II boss's last two strains); voices take the foreground with the rite in Act III, the
  Emperor, the Lieutenant and the Vigil (the court circle's four Voices, in organum). The
  Entity never sings; its finale is where the choir finally sings Ember Dusk. The Descent's
  battle theme never lets it sing the tune (oohs, far).
- **Massed doubling** (piccolo over the tune, trumpets doubling horns) is kept out of
  the most frequent theme (Act I battle).
- **Displaced accents on a straight grid** (three-sixteenth groups) belong to the Act I
  battle's string ostinato; **3:2 against the beat** to the sacred ground; a **compound
  motor under a broad line** to escape maps.
- **The Hollow Sun's resolution** (its phrase climbing to the leading tone and rising
  onto the tonic, with tolled bells) is reserved for promotion and the run's final victory,
  which resolves it once. The title, the church hymn, the shrine and every cue that quotes
  the phrase stop on the leading tone instead. Ordinary melodic landings on the tonic
  (Ember Dusk's 3-2-1, the finale's A strain) are not that cadence and are allowed.
- **Each new battle theme owns its mechanism** (the cue list names it): bar contraction to
  Petals on the Fen and Totality, a cross-bar cycle to Against the Standard, a pedal under a
  third-less collection to Caldera, a held note changing meaning to Rime and the title, a stab cycle that spells the drill to The Iron Line, a reciting tone to The Consecrated, the stop bar with a pickup to The Emperor's Own, an unsung tune passed between keys to The Name Is Not Spoken, a tune revealed by the full mix to What the Fog Keeps, a bass that never gives the root to Coin and Canvas, an endless (Shepard–Risset) climb to We Came This Far Also, the army adopting a stranger's grouping of the bar to Quick, Quick, Quick, Slow, an off-stage band in another meter to Out of Step, fugue and stretto to Every Voice at Its Post, metric modulation (triplets becoming the beat, dotted quarters handing it back) to Double Time, a tune in hocket between two bands whose shares grow to Every Other Word, a fixed tune under a mode brightening one degree a strain to Dawn by Degrees, a tune restated a minor third lower each landing with its reach displaced three octaves down to Ember Dusk, Below, four voices in strict parallel organum over a falling cell to Through the Floor.

## Adaptive battle music

Every field battle theme exists as two mixes on one timeline (`<key>` and
`<key>_calm`), like the "Rain" and "Thunder" versions in Fire Emblem: Three Houses.

- **calm**: a solo voice (solo violin, flute, oboe, clarinet) carries the tune over
  legato low strings, piano in quarters and a soft heartbeat kick.
- **full**: rock kit, bass guitar, brass unisons and string ostinati (a far choir colour in
  Act II, the choir itself from Act III on).

`src/engine/MusicIntensity.js` decides the layer and `src/ui/BattleMusicController.js`
drives it. A battle opens calm. Any exchange of blows raises it to full, and so does an
enemy phase in which some enemy can reach a player unit. It settles back to calm only
after a whole round with no combat and nobody inside the visible threat range.
`src/utils/LoopedMusic.js` starts both layers at the same instant with identical loop
points, so a change of layer is a sample-aligned crossfade: the music never restarts.

## Which battle theme plays

A battle's music answers the most specific thing true of it (`engine/BattleMusicSelection.js`):

1. a boss plays its own theme (an act's theme for a boss without one);
2. an escape map plays a pursuit theme;
3. a node the Eclipse has taken plays Totality; a village under attack, Bells Over the Village;
   a recruit rescue, a rescue theme; an elite company, its act's own: Against the Standard
   (Act I), The Iron Line (Act II), The Consecrated (Act III), The Emperor's Own (Act IV);
4. the map's place: castles (two thirds of them), swamps The Mire, tundra Rime, volcanoes
   Caldera;
5. a share of the rest: most maps with a merchant caravan to protect play Coin and Canvas; a
   third of the maps where bandits race for a village ring the village's bells; most maps in
   fog of war play a fog theme;
6. otherwise the act's pool: Act I Ember Dusk, Border Marches, Open Ground, The Oath at the
   Ford, Double Time; Act II Iron Rain, Steel and Thread, Old Kingdom Roads, Every Other Word;
   Act III Bleached Rite, Against the Rite, Petals on the Fen, Dawn by Degrees; Act IV Ashfall,
   Ember Dusk in Ash, The Name Is Not Spoken.
   Every act's pool also holds Under the Broken Sun (the anime-opening theme turned battle),
   the change-up: a path meets it about once an act.

Escapes, rescues, castles and fog have two themes each, chosen by act (`MUSIC.escape`,
`battleSituation`, `battleBiome`), so the same kind of battle sounds different act to act:

| | Act I | Act II | Act III | Act IV and after |
|---|---|---|---|---|
| Escape | One More Crossing | both | We Came This Far Also | We Came This Far Also |
| Rescue | Someone Is Still Out There | Quick, Quick, Quick, Slow | Someone Is Still Out There | Quick, Quick, Quick, Slow |
| Castle | (none) | Stone That Remembers | both | Every Voice at Its Post |
| Fog | What the Fog Keeps | Out of Step | both | both |

Why: One More Crossing (E) stays out of Act III, where Bleached Rite is in E; the rescues
alternate so consecutive acts differ, and Quick, Quick, Quick, Slow (an additive meter in E)
stays out of Bleached Rite's act; the fugue sings, so it waits for Act III; Out of Step is the
Empire's patrol, and Acts III and IV, a third and nearly half of whose battles are in fog, need
both fog themes.

Act V's two themes come before every rule above but the boss's: a map holding the Vigil plays
Through the Floor, and every other battle of the Descent (the Stair, the Column, an event's
fight) plays Ember Dusk, Below (`MUSIC.descent`); a seen Voice's fall plays `voice_silenced`.

Picks are hashed from the run seed, never rolled, so a resumed battle plays what it played.
The act pool (and an act's pair of situation themes) is walked in a per-run order indexed by
the node's row, so a path hears no theme twice until the pool is spent, and every run (and the tutorial) opens on Ember Dusk.

## Seamless loops

Each file is an intro followed by a loop body. The engine renders the loop twice
(sample-exact copies) and exports `[0, intro + M + loop + extra]`, and the player loops
`[intro + M, intro + M + loop]`. M (at least 4 s, longer than the reverb) puts the
loop start where the intro's tails have died, so the jump is inaudible. Any constant
MP3 decoder delay shorter than M only shifts both points by the same content offset.
The build checks every file's seam numerically (`seamDb`, which must be under −45 dB).
The shipped files measure between −53 and −130 dB.

## Drafts (not in the game)

A score that declares `DRAFT = True` is an audition: `build.py --all` leaves it out and
`musicConfig.js` does not know it.

| Score | Title | Notes |
|---|---|---|
| (none at the moment) | | |
