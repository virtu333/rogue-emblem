# Rogue Dawn: the score as MIDI

Every piece of the soundtrack as a Standard MIDI File, exported from the
scores in `tools/music/scores/` and `tools/music/stingers/` by
`tools/music/midi.py`. Regenerate with `python3 tools/music/midi.py --all`
(it needs Python 3 and `mido`); this page is written by the same run.

The files hold the written notes, not the recordings: each part of the score
is a track named after the part and its instrument (`mel_vn (Violins I)`), so
the music can be played on any General MIDI synth, loaded into a DAW and
given better instruments, or imported into notation software. The rendered
audio, with the real mix, is in `assets/audio/`.

## Reading the files

- **Names follow the MP3s.** `music/<key>.mid` for loops, `stingers/stinger_<name>.mid`
  for ceremony cues. A cue with several mixes has one file per mix, each holding
  exactly the parts that mix plays: `_calm` (the quiet layer of an adaptive
  battle theme), `_enrage_<boss>` (a boss theme with that boss's enrage layer
  added), `_hum` (the Entity's stem, played under the finale) and
  `music_login` (the title's calm mix, heard as its loop alone).
- **Loops.** A loop is an intro followed by a loop body the game repeats
  forever. The conductor track marks the body with `loopStart` and `loopEnd`
  markers; set your player's or DAW's loop to them. The file stops at the loop
  end (notes may ring a little past it).
- **Timing** is exact: tempo, tempo ramps (as short tempo steps), meter changes
  and the key signature are all in the conductor track.
- **Sounds.** Each channel carries one GM program, chosen per instrument and
  articulation (sustained strings, pizzicato and tremolo are different
  programs). A mix has up to 38 parts and MIDI 15 melodic channels, so parts
  that share a sound may share a channel. Track names always say what the
  part really is. Percussion is on channel 10 (GM/GS drum map); timpani rolls
  and cymbal swells are written out as rolls. Synth parts (sub bass, pads,
  drone, riser) map to the nearest GM synth sounds.
- **Dynamics** come from the score: velocity from the written dynamics and
  accents; a part's expression lane (swells and fades) on CC11, and its mix
  level on CC7. Where parts share a channel, the lane or level that differs
  from the channel's is folded into that part's velocities.
- **Stingers** are written in D. Most are keyed: the game transposes them
  into the key of whatever music is running, and they are exported in D. The
  act cards, the named bosses' cards and the Entity's answer play in one key
  and are exported in it.

A few things only the audio has: the sampled orchestra, the room, and the mix
(each part leveled to its role, the lead ducking the accompaniment). A GM synth
is a sketch of the real sound. `tools/music/SCORE.md` describes every cue.


## Loops

| File | Title | Tempo | Meter | Tonic | Key signature | Length | Form |
|---|---|---|---|---|---|---|---|
| `music_battle_act1.mid` | Ember Dusk | 152 | 4/4 | D | 1 flat | 1:15.8 | loop 0:06.3 to 1:15.8 |
| `music_battle_act1_2.mid` | Border Marches | 150 | 6/8 | G | 2 flats | 1:04.8 | loop 0:02.4 to 1:04.8 |
| `music_battle_act1_2_calm.mid` | Border Marches (calm) | 150 | 6/8 | G | 2 flats | 1:04.8 | loop 0:02.4 to 1:04.8 |
| `music_battle_act1_3.mid` | Open Ground | 132 | 4/4 | D | 1 flat | 1:27.3 | loop 0:07.3 to 1:27.3 |
| `music_battle_act1_3_calm.mid` | Open Ground (calm) | 132 | 4/4 | D | 1 flat | 1:27.3 | loop 0:07.3 to 1:27.3 |
| `music_battle_act1_4.mid` | The Oath at the Ford | 116 | 4/4 | E | 1 sharp | 1:31.0 | loop 0:08.3 to 1:31.0 |
| `music_battle_act1_4_calm.mid` | The Oath at the Ford (calm) | 116 | 4/4 | E | 1 sharp | 1:31.0 | loop 0:08.3 to 1:31.0 |
| `music_battle_act1_calm.mid` | Ember Dusk (calm) | 152 | 4/4 | D | 1 flat | 1:15.8 | loop 0:06.3 to 1:15.8 |
| `music_battle_act2.mid` | Iron Rain | 160 | 4/4 | C | 3 flats | 1:12.0 | loop 0:06.0 to 1:12.0 |
| `music_battle_act2_2.mid` | Steel and Thread | 144 | 4/4 | A | none | 1:06.7 | loop 0:06.7 to 1:06.7 |
| `music_battle_act2_2_calm.mid` | Steel and Thread (calm) | 144 | 4/4 | A | none | 1:06.7 | loop 0:06.7 to 1:06.7 |
| `music_battle_act2_3.mid` | Old Kingdom Roads | 138 | 4/4 | G | 2 flats | 1:23.5 | loop 0:07.0 to 1:23.5 |
| `music_battle_act2_3_calm.mid` | Old Kingdom Roads (calm) | 138 | 4/4 | G | 2 flats | 1:23.5 | loop 0:07.0 to 1:23.5 |
| `music_battle_act2_calm.mid` | Iron Rain (calm) | 160 | 4/4 | C | 3 flats | 1:12.0 | loop 0:06.0 to 1:12.0 |
| `music_battle_act3.mid` | Bleached Rite | 144 | 7/8 | E | 1 sharp | 1:07.1 | loop 0:02.9 to 1:07.1 |
| `music_battle_act3_2.mid` | Against the Rite | 156 | 4/4 | B | 2 sharps | 1:01.5 | loop 0:06.2 to 1:01.5 |
| `music_battle_act3_2_calm.mid` | Against the Rite (calm) | 156 | 4/4 | B | 2 sharps | 1:01.5 | loop 0:06.2 to 1:01.5 |
| `music_battle_act3_3.mid` | Petals on the Fen | 132 | 6/8 | B | 1 sharp | 1:12.3 | loop 0:05.5 to 1:12.3 |
| `music_battle_act3_3_calm.mid` | Petals on the Fen (calm) | 132 | 6/8 | B | 1 sharp | 1:12.3 | loop 0:05.5 to 1:12.3 |
| `music_battle_act3_calm.mid` | Bleached Rite (calm) | 144 | 7/8 | E | 1 sharp | 1:07.1 | loop 0:02.9 to 1:07.1 |
| `music_battle_act4.mid` | Ashfall | 132 | 4/4 | C# | 4 sharps | 1:12.7 | loop 0:07.3 to 1:12.7 |
| `music_battle_act4_2.mid` | Ember Dusk, in Ash | 144 | 4/4 | Db | 4 sharps | 1:20.0 | loop 0:06.7 to 1:20.0 |
| `music_battle_act4_2_calm.mid` | Ember Dusk, in Ash (calm) | 144 | 4/4 | Db | 4 sharps | 1:20.0 | loop 0:06.7 to 1:20.0 |
| `music_battle_act4_calm.mid` | Ashfall (calm) | 132 | 4/4 | C# | 4 sharps | 1:12.7 | loop 0:07.3 to 1:12.7 |
| `music_battle_castle.mid` | Stone That Remembers | 132 | 4/4 | C | 3 flats | 1:31.0 | loop 0:03.6 to 1:30.9 |
| `music_battle_castle_calm.mid` | Stone That Remembers (calm) | 132 | 4/4 | C | 3 flats | 1:31.0 | loop 0:03.6 to 1:30.9 |
| `music_battle_eclipsed.mid` | Totality | 108 | 6/8, 5/8, 4/8 | D | 1 flat | 1:43.3 | loop 0:06.7 to 1:43.3 |
| `music_battle_eclipsed_calm.mid` | Totality (calm) | 108 | 6/8, 5/8, 4/8 | D | 1 flat | 1:43.3 | loop 0:06.7 to 1:43.3 |
| `music_battle_elite.mid` | Against the Standard | 168 | 4/4 | C | 3 flats | 1:08.6 | loop 0:05.7 to 1:08.6 |
| `music_battle_elite_calm.mid` | Against the Standard (calm) | 168 | 4/4 | C | 3 flats | 1:08.6 | loop 0:05.7 to 1:08.6 |
| `music_battle_escape.mid` | One More Crossing | 162 | 12/8 | E | 1 sharp | 0:57.8 | loop 0:04.4 to 0:57.8 |
| `music_battle_escape_calm.mid` | One More Crossing (calm) | 162 | 12/8 | E | 1 sharp | 0:57.8 | loop 0:04.4 to 0:57.8 |
| `music_battle_rescue.mid` | Someone Is Still Out There | 148 | 4/4 | F | 4 flats | 1:11.4 | loop 0:06.5 to 1:11.4 |
| `music_battle_rescue_calm.mid` | Someone Is Still Out There (calm) | 148 | 4/4 | F | 4 flats | 1:11.4 | loop 0:06.5 to 1:11.4 |
| `music_battle_swamp.mid` | The Mire | 112 | 5/4 | F | 5 flats | 1:31.1 | loop 0:05.4 to 1:31.1 |
| `music_battle_swamp_calm.mid` | The Mire (calm) | 112 | 5/4 | F | 5 flats | 1:31.1 | loop 0:05.4 to 1:31.1 |
| `music_battle_tundra.mid` | Rime | 112 | 4/4 | E | none | 1:25.7 | loop 0:08.6 to 1:25.7 |
| `music_battle_tundra_calm.mid` | Rime (calm) | 112 | 4/4 | E | none | 1:25.7 | loop 0:08.6 to 1:25.7 |
| `music_battle_village.mid` | Bells Over the Village | 172 | 3/4 | A | none | 1:12.2 | loop 0:04.2 to 1:11.2 |
| `music_battle_village_calm.mid` | Bells Over the Village (calm) | 172 | 3/4 | A | none | 1:12.2 | loop 0:04.2 to 1:11.2 |
| `music_battle_volcano.mid` | Caldera | 120 | 4/4 | Bb | 1 flat | 1:20.0 | loop 0:08.0 to 1:20.0 |
| `music_battle_volcano_calm.mid` | Caldera (calm) | 120 | 4/4 | Bb | 1 flat | 1:20.0 | loop 0:08.0 to 1:20.0 |
| `music_boss_act1.mid` | The Border Holds | 138 | 4/4 | D | 1 flat | 1:09.6 | loop 0:07.0 to 1:09.6 |
| `music_boss_act1_enrage_iron_captain.mid` | The Border Holds (enrage iron captain) | 138 | 4/4 | D | 1 flat | 1:09.6 | loop 0:07.0 to 1:09.6 |
| `music_boss_act1_enrage_warchief.mid` | The Border Holds (enrage warchief) | 138 | 4/4 | D | 1 flat | 1:09.6 | loop 0:07.0 to 1:09.6 |
| `music_boss_act2.mid` | Doctrine of Lances | 166 | 4/4 | F | 4 flats | 0:57.8 | loop 0:05.8 to 0:57.8 |
| `music_boss_act2_enrage_archmage.mid` | Doctrine of Lances (enrage archmage) | 166 | 4/4 | F | 4 flats | 0:57.8 | loop 0:05.8 to 0:57.8 |
| `music_boss_act2_enrage_dark_rider.mid` | Doctrine of Lances (enrage dark rider) | 166 | 4/4 | F | 4 flats | 0:57.8 | loop 0:05.8 to 0:57.8 |
| `music_boss_act2_enrage_knight_commander.mid` | Doctrine of Lances (enrage knight commander) | 166 | 4/4 | F | 4 flats | 0:57.8 | loop 0:05.8 to 0:57.8 |
| `music_boss_act3.mid` | The Perfect Duel | 172 | 4/4 | E | 1 sharp | 0:55.8 | loop 0:05.6 to 0:55.8 |
| `music_boss_act3_enrage_berserker_king.mid` | The Perfect Duel (enrage berserker king) | 172 | 4/4 | E | 1 sharp | 0:55.8 | loop 0:05.6 to 0:55.8 |
| `music_boss_act3_enrage_blade_lord.mid` | The Perfect Duel (enrage blade lord) | 172 | 4/4 | E | 1 sharp | 0:55.8 | loop 0:05.6 to 0:55.8 |
| `music_boss_act3_enrage_iron_wall.mid` | The Perfect Duel (enrage iron wall) | 172 | 4/4 | E | 1 sharp | 0:55.8 | loop 0:05.6 to 0:55.8 |
| `music_boss_emperor.mid` | Human, Powerful, and Wrong | 120 | 4/4 | Bb | 5 flats | 1:20.0 | loop 0:08.0 to 1:20.0 |
| `music_boss_emperor_enrage_emperor.mid` | Human, Powerful, and Wrong (enrage emperor) | 120 | 4/4 | Bb | 5 flats | 1:20.0 | loop 0:08.0 to 1:20.0 |
| `music_boss_entity.mid` | · · · | 84 | 4/4 | D | 2 flats | 1:42.9 | loop 0:11.4 to 1:42.9 |
| `music_boss_entity_finale.mid` | All of Us Across | 204 | 12/8 | D | 1 flat | 1:17.6 | loop 0:07.1 to 1:17.6 |
| `music_boss_entity_finale_hum.mid` | All of Us Across (hum) | 204 | 12/8 | D | 2 flats | 1:17.6 | loop 0:07.1 to 1:17.6 |
| `music_boss_lieutenant.mid` | Every Future You Could Reach | 168 | 4/4 | D | 1 flat | 1:08.6 | loop 0:05.7 to 1:08.6 |
| `music_boss_lieutenant_enrage_lieutenant.mid` | Every Future You Could Reach (enrage lieutenant) | 168 | 4/4 | D | 1 flat | 1:08.6 | loop 0:05.7 to 1:08.6 |
| `music_colosseum.mid` | The Pit Answers | 138 | 4/4 | A | none | 0:45.2 | loop 0:03.5 to 0:45.2 |
| `music_defeat.mid` | The Thread Is Cut | 58 | 4/4 | D | 1 flat | 0:53.8 | loop 0:20.7 to 0:53.8 |
| `music_explore_act1.mid` | The Loom: Ember Dusk | 100 | 4/4 | D | none | 1:26.4 | loop 0:04.8 to 1:26.4 |
| `music_explore_act2.mid` | The Loom: Iron Rain | 92 | 4/4 | C | 3 flats | 1:28.7 | loop 0:05.2 to 1:28.7 |
| `music_explore_act3.mid` | The Loom: Bleached Rite | 72 | 3/4 | E | none | 1:05.0 | loop 0:05.0 to 1:05.0 |
| `music_explore_act4.mid` | The Loom: Ashfall | 60 | 4/4 | B | 2 sharps | 1:44.0 | loop 0:08.0 to 1:44.0 |
| `music_explore_deep.mid` | The Loom: Unlight | 76 | 4/4 | D | 1 flat | 1:22.1 | loop 0:06.3 to 1:22.1 |
| `music_home_base.mid` | Embers of the Old Kingdom | 84 | 6/8 | F | 1 flat | 1:17.1 | loop 0:04.3 to 1:17.1 |
| `music_login.mid` | The Hollow Sun (calm) | 66 / 56 / 66 | 4/4 | D | 1 flat | 1:42.4 | loop only (1:42.4) |
| `music_loot.mid` | Spoils of the March | 128 | 4/4 | F | 1 flat | 0:16.9 | loop 0:01.9 to 0:16.9 |
| `music_rest.mid` | Liturgy of the Spent Name | 60 / 52 / 60 | 4/4 | F | 1 flat | 2:48.6 | loop 0:08.0 to 2:48.6 |
| `music_run_win.mid` | The Last Light | 76 / 64 / 70 | 4/4 | D | 2 sharps | 1:36.4 | loop 0:06.3 to 1:36.4 |
| `music_shop.mid` | Varen's Mark | 112 | 4/4 | G | 2 flats | 0:53.6 | loop 0:02.1 to 0:53.6 |
| `music_shrine.mid` | What the Sun Kept | 72 | 3/4 | G | 1 sharp | 1:05.0 | loop 0:05.0 to 1:05.0 |
| `music_title.mid` | The Hollow Sun | 66 / 56 / 66 | 4/4 | D | 1 flat | 1:57.0 | loop 0:14.5 to 1:57.0 |
| `music_victory.mid` | Routed | 104 / 80 | 4/4 | D | 2 sharps | 0:33.2 | loop 0:09.2 to 0:33.2 |

## Stingers

| File | Title | Tempo | Meter | Tonic | Key signature | Length | Form |
|---|---|---|---|---|---|---|---|
| `stinger_act_card_act1.mid` | Act I | 96 | 4/4 | D | 2 sharps | 0:05.0 | one-shot |
| `stinger_act_card_act2.mid` | Act II | 100 | 4/4 | C | 3 flats | 0:04.8 | one-shot |
| `stinger_act_card_act3.mid` | Act III | 80 | 4/4 | E | none | 0:06.0 | one-shot |
| `stinger_act_card_act4.mid` | Act IV | 72 | 4/4 | B | 2 sharps | 0:06.7 | one-shot |
| `stinger_act_card_finalBoss.mid` | The Deep | 60 | 4/4 | D | 2 flats | 0:08.0 | one-shot |
| `stinger_arrival.mid` | Reinforcements | 120 | 4/4 | D | 2 flats | 0:02.0 | one-shot, keyed (the game plays it in the key of the music) |
| `stinger_boss_archmage.mid` | Archmage | 116 | 4/4 | F | 4 flats | 0:04.1 | one-shot |
| `stinger_boss_berserker_king.mid` | Berserker King | 140 | 4/4 | E | 1 sharp | 0:03.4 | one-shot |
| `stinger_boss_blade_lord.mid` | Blade Lord | 120 | 4/4 | E | 1 sharp | 0:04.0 | one-shot |
| `stinger_boss_card.mid` | Boss | 112 | 4/4 | D | 1 flat | 0:04.3 | one-shot, keyed (the game plays it in the key of the music) |
| `stinger_boss_dark_rider.mid` | Dark Rider | 126 | 4/4 | F | none | 0:03.8 | one-shot |
| `stinger_boss_emperor_card.mid` | The Emperor | 104 | 4/4 | Bb | 5 flats | 0:04.6 | one-shot |
| `stinger_boss_felled.mid` | Foe Vanquished | 120 | 4/4 | D | 1 flat | 0:02.5 | one-shot, keyed (the game plays it in the key of the music) |
| `stinger_boss_iron_captain.mid` | Iron Captain | 116 | 4/4 | D | 1 flat | 0:04.1 | one-shot |
| `stinger_boss_iron_wall.mid` | Iron Wall | 96 | 4/4 | E | 4 sharps | 0:05.0 | one-shot |
| `stinger_boss_knight_commander.mid` | Knight Commander | 132 | 4/4 | F | 4 flats | 0:03.6 | one-shot |
| `stinger_boss_lieutenant_card.mid` | The Lieutenant | 100 | 4/4 | D | 1 flat | 0:04.8 | one-shot |
| `stinger_boss_warchief.mid` | Warchief | 120 | 4/4 | D | 1 flat | 0:04.0 | one-shot |
| `stinger_deed.mid` | Deed | 128 | 4/4 | D | 1 flat | 0:01.9 | one-shot, keyed (the game plays it in the key of the music) |
| `stinger_eclipse.mid` | The Eclipse | 66 | 4/4 | D | 1 flat | 0:03.6 | one-shot, keyed (the game plays it in the key of the music) |
| `stinger_entity_answer.mid` | The Answer | 204 | 12/8 | D | 1 flat | 0:03.5 | one-shot |
| `stinger_levelup.mid` | Level Up | 132 | 4/4 | D | 1 flat | 0:01.8 | one-shot, keyed (the game plays it in the key of the music) |
| `stinger_levelup_blank.mid` | Level Up — Lean | 132 | 2/4 | D | 1 flat | 0:00.9 | one-shot, keyed (the game plays it in the key of the music) |
| `stinger_levelup_perfect.mid` | Level Up — Perfect | 132 | 4/4 | D | 2 sharps | 0:03.6 | one-shot, keyed (the game plays it in the key of the music) |
| `stinger_lord_fallen.mid` | A Lord Falls | 72 | 4/4 | D | 1 flat | 0:03.3 | one-shot, keyed (the game plays it in the key of the music) |
| `stinger_promotion_crown.mid` | Promotion — Crown | 132 | 4/4 | D | 1 flat | 0:04.5 | one-shot, keyed (the game plays it in the key of the music) |
| `stinger_promotion_gather.mid` | Promotion — Gather | 120 | 4/4 | D | 1 flat | 0:03.0 | one-shot, keyed (the game plays it in the key of the music) |
| `stinger_recruit.mid` | Recruit | 100 | 3/4 | D | 1 flat | 0:03.6 | one-shot, keyed (the game plays it in the key of the music) |
| `stinger_rewind.mid` | Rewind | 100 | 4/4 | D | 1 flat | 0:02.4 | one-shot, keyed (the game plays it in the key of the music) |
| `stinger_sealed.mid` | Sealed | 120 | 4/4 | D | 1 flat | 0:02.0 | one-shot, keyed (the game plays it in the key of the music) |
