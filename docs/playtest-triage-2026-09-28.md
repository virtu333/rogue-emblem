# Playtest triage — 2026-09-28 (iPhone, portrait, Normal + Hard)

Research-only triage of Dave's playtest notes. Six code-reading passes; file:line refs are as of `main` @ 1f14380.
In-flight branch `claude/placement-unit-interaction-2nqaeq` (Formation pick-up, fog-on-commit, help pop-up sizing) overlaps only the help pop-up and Formation-menu items below.

Verdicts: **BUG** · **GAP** (design gap) · **OK** (working as designed; maybe unclear) · **BAL** (balance)

## Wave 1 — bugs and quick wins (S, low risk)

| # | Note | Verdict | Finding | Fix |
|---|---|---|---|---|
| 1 | Rowan not placeable after Save to Title → Continue from Map → redeploy | **BUG (severe)** | First entry locks the battle config with `deployCount` spawn tiles (`BattleScene.js:1266-1290`, `RunManager.lockBattleConfig` :3128, `MapGenerator.js:126`). Continue-from-Map keeps the lock (anti-reroll). Redeploying 6 into a 5-spawn lock silently skips unit 6 (`BattleScene.js:1412` `if (!tiles[i]) continue`). The skipped unit is in neither `playerUnits` nor `nonDeployedUnits`, so `completeBattle` (`RunManager.js:3483-3500`) would record him **fallen** on victory. | Clamp deploy max to `locked.playerSpawns.length` in `create()` with a note; safety net: untiled units go to `nonDeployedUnits`. Tests: locked 5-spawn config → deploy max 5; 6 deployed / 5 spawns → no unit missing from either list. |
| 2 | Help pop-ups truncated everywhere (e.g. Lava Crack terrain) | **BUG** | `contextHelp.css` body `flex:1` collapses under `height: fit-content`. | Fixed on the in-flight branch (1da29cf). Merge, then verify on a real iPhone (e2e is Chromium only). |
| 3 | Can't reach Save to Title / menu during Formation | **BUG/GAP** | Dock Menu → `canOpenPauseFromMenu` (`BattleScene.js:3809`) excludes Formation, falls to `requestCancel` → `FormationController.openMenu` (:406). | Menu opens pause menu in Formation (Back keeps opening the Formation panel); add "Back to map". Do it on/after the in-flight branch (same files). Save & Exit before turn 1 lands on the map (`RunManager.js:4913-4921`). |
| 4 | Rowan joins act 3 far stronger than Edric | **BUG** | `RecruitScaling.js:10-25` targets base level 18 (10 + Edric's 8 promoted levels) *then* adds 8 promoted levels: 24 level-ups vs Edric's 16. Avg Rowan 41 HP / 21 STR / 20 SPD / 18 DEF vs Edric 33 / 15 / 17 / 12. Same formula for promoted boss recruits (`BossRecruitSystem.js:567-594`). | Level base class to 10 (promotion base), promote, then level to promoted target. Re-pin `tests/RecruitScaling.test.js`. |
| 5 | Music restarts after rotating | Known limit (`docs/portrait-battles.md:73`) — fixable | Shutdown cleanup `releaseMusic` (`BattleScene.js:529`) stops the track; same-key `playMusic` would otherwise continue it (`AudioManager.js:88-103`). | Skip `releaseMusic` while `_portraitBattle.switching`; carry calm/full intensity instead of 0 ms snap (`BattleMusicController.js:142`). |
| 6 | Hard map 1: 6 Fighters + ballista vs 2 lords | **BAL** | Normal always 2, Hard always 6, Lunatic 8 (300 seeds). Ballista gate is difficulty-only (`MapGenerator.js:98-113`), 3/4 act-1 rout templates carry one (~79%). `enemyCountBase` *replaces* deploy count, so Hard is harsher early but can have fewer enemies than Normal late. | No ballistas in act 1; retune Hard act-1 count; make `enemyCountBase` a floor. |
| 7 | Vampiric too strong | **BAL** | Imbue, 15% of damage per hit, floored; counts on counters; max(Sol, drain, Vampiric) + Vampire's Bloodshard `perHitHeal` stacks (`Combat.js:1274-1286`). | Cap 2 HP per hit (needs confirmation, see decisions). |
| 8 | Revived units: see profile; give an Iron weapon | **GAP** | Revive list is name/class/cost only (`ChurchMenu.js:119-141`). Death moves all items to convoy (`RunManager.js:3285-3350`); revive returns nothing (:3717-3748). | "Details" button (`MobileRosterSheet` with `run:null`, as in `PartyMenus.js:171-186`); grant Iron weapon of main type if unarmed. |
| 9 | "What happened to class skills?" | **OK + BUG** | Learnables still fire at Lv10 for 12/22 base + 7/30 promoted classes; lords have none. At the 5-skill cap the battle level-up drops them **silently** (`BattleScene.js:9087`); team-XP rewards ignore learned skills (`LootScreenController.js:345`, `PendingRewardController.js:77`). Help text is wrong (says Myrmidon learns Adept — it's Vantage). | Notice when a skill can't be learned; surface reward-XP learns; fix help; show "Lv10: Vantage" in unit details. |
| 10 | Lava Crack didn't seem to fire | **OK (feedback)** | Fires at *end of phase*, not start of turn; only a 12px "-5" float for 450 ms (~7pt on phone). Portrait isn't the cause. | Banner like acid's; fix terrain text wording. |
| 11 | Story wiring | **BUG** | Lunatic's post-Emperor lines (`finalBoss_to_secretAct`, `secretAct_start`) are never played; `act3_to_act4` says "The lieutenant is gone" but Hard/Lunatic never fight him. | Fix `getActTransitionKey`; rewrite act3→IV line. |
| 12 | Small copy | **OK** | Save button not needed (autosave every action). Outfitted Recruits already only draw 8 basic rings/charms. Honed Blades is meant to forge every starting weapon (uses `Math.random`, `RunManager.js:2793`). | Pause menu: "Progress saves automatically". Reword Outfitted Recruits + Honed Blades; seed Honed Blades RNG. |

## Wave 2 — readability (M)

- **Weapon arts** (`src/ui/weaponArtDisplay.js`): numbers stated twice (mods + authored description), retreat caveat, five boilerplate lines on every art. Proposal: `Cost HP 8 · 2/battle · 1/turn` / `Effect …` / `After Retreat 1 tile on hit` / `Needs Sword · Master` / one ≤60-char flavour line; rules behind ⓘ (`WEAPON_ARTS_HELP`). Rewrite ~83 descriptions; data test: no digits in descriptions.
- **Scrolls** (`weaponArtScrollText` :180, `LootScreenController.js:1564`): two-line card + ⓘ → new `SCROLLS_HELP` topic + glossary page. Label "Skill scroll" vs "Art scroll" and split the team list (fixes "is Blink a weapon art?" — it's an action skill).
- **Forecast**: move `battle_doubling` hint inside "How to read" `<details>` (`MobileBattleHUD.js:424-510`); bullet the note.
- **Deeds**: automatic by design (title = highest prestige; Oath = highest-prestige deed's skill at promotion). Add Compendium "Deeds" tab, Oath helper line on the promotion card. Oath is lost silently at the skill cap.
- **Home base currencies** (`CATEGORY_CURRENCY`, `constants.js:261`): Valor = Lords/Equipment/Skills; Supply = Recruits/Economy/Battalion; none are both. Group/colour the tabs.
- **Resume**: shows only with exactly one active run (`titleMenuModel.js:64-67`). Add "Resume latest · Slot N" and a gold border on the most recent slot card.

## Wave 3 — QoL features (S–M)

- **Arena**: add View map / Roster rows and unit Details (`ArenaMenu.js:79-107`; copy shop/church pattern).
- **Convoy consumables**: `useFromConvoy` command for heals, boosters, seals (outside battle only).
- **Forge cost by tier**: today cost depends only on stat + count (`FORGE_COSTS`, `constants.js:244`); legends cost 0 to buy, so they're the best forge value. Multiplier Iron 0.6 / Steel 1.0 / Silver 1.5 / Legend 2.0 in `getForgeCost`; dedupe `ShopMenu.js:509`.
- **Starting skills**: currently per-lord slots, same skill can go on both. Change rule (see decisions).
- **Larger battle menu (portrait)**: one CSS var `--pb-rail-h` (`portraitBattle.css:58`); add Standard/Large setting.

## Wave 4 — design and balance (M–L)

- **Elite pool**: "Blade Lord" and "Iron Wall" are act-3 *bosses* (L17 +2 all). Elite seize nodes draw from the act-boss list (`MapGenerator.js:1795-1873`). Add `enemies.elites.<act>` minibosses scaled to the node.
- **Ballista range by act** (e.g. 3/4/5), stored per ballista in `battleConfig`.
- **Difficulty ladder**: Normal → Lieutenant; Hard → acts 1–IV, ends at Emperor; Lunatic → Entity. Rename via `label` (ids stay). Interim tier = new id; centralise `DIFFICULTY_IDS` first (L).
- **Skill loadout**: `knownSkills` (uncapped) + `skills` (equipped ≤5); roster equip screen; migration (M–L).
- **Church vow**: one choice per church — promotion *or* a minor (tier-1) blessing appended to the run; reuse Ruins per-node choice model (M–L).
- **Anti-heal enemy status** ("Wounded": blocks drain/Sol/Vulnerary, not staves) (M–L).
- **Blessing pass**: outliers — Focused Curriculum, Scout Blessing, Scholar's Vow strong for tier 2; Terrain Mastery, Nomad's Pact weak tier 3; Rally Cry weak; Arsenal Pact weight 0.65 looks like a slip.
- **Story**: cold open (Sera's vision), act-boss dispatches naming the Emperor/ritual, Lieutenant vision in act 3 for Hard/Lunatic, Ashen Summit flavour, Normal epilogue teasing Hard.
- **More lines**: nobody reacts to ally deaths; commander death silent on field; thinnest pools: lord recruit (1), boss half-HP (1), boss defeat (1+1), Hard/Lunatic victory (1 each), lord quips/farewells (3).
- **Supports**: ROADMAP:73 rejects support conversations; a conversation-free adjacency "bond" on the mastery pattern is possible.

## Side findings

- Hard/Lunatic "recruit guardian" code is dead (`MapGenerator.js:243-275`; no data).
- `docs/specs/difficulty_spec.md:13` is stale (says every mode runs acts 1–3 + final).
- Outfitted-recruit accessories are sellable (~500–1000 G per recruit).

## Decisions (Dave, 2026-09-28)

- **Vampiric:** heals at most 2 HP per hit (floored).
- **Starting skills:** each unlocked skill can sit on only one lord at a time.
- **Difficulty ladder:** four tiers, named First Light / Dusk / Nightfall / Black Sun.
  - First Light = today's Normal (ends at the Lieutenant).
  - Dusk = new tier: today's Hard (acts 1–IV, ends at the Emperor), made easier.
  - Nightfall = today's Hard tuning, now continuing to the Entity.
  - Black Sun = today's Lunatic (Entity).
  - Internal ids stay `normal` / `hard` / `lunatic`; the new tier gets a new id.
- **Deeds:** players pick their displayed title; each unit swears one Oath, chosen by the player. The Compendium hides anything not yet encountered.
- **Supports:** backlog; bonds without conversations are acceptable.

## Wave 1 status (branch `claude/playtest-notes-triage-z12dht`)

Done, each with tests that fail without the change:

- #1 Deploy: a re-entered battle caps deployment at its locked map's spawns; an unplaced unit is benched, never lost.
- #4 Recruits that join promoted promote from base level 10 (Rowan beside Great Lord 8: 16 level-ups, not 24).
- #5 Battle music plays on through a turn of the phone (rotation e2e checks the same voice).
- #6 No ballistas in Act 1 (Hard/Lunatic). Hard's Act 1 enemy counts are left for the Dusk tier.
- #7 Vampiric heals at most 2 HP a strike (`drainMaxPerHit`).
- #8 Church: fallen allies' details; revived units come back with an Iron weapon (Heal for staff-only).
- #9 Level-up card names a class skill that found all five slots full; Skills help corrected.
- #10 Lava: one banner names the burns; tile text says "end of its side's phase".
- #11 Story: Lunatic's descent lines play after the Emperor; Act IV and the Emperor no longer mention the Lieutenant's death.
- #12 Pause note (autosave), Outfitted Recruits and Honed Blades copy; Honed Blades rolls from the run seed.
- Starting skills: one lord per skill (moving it from the pickers; old saves keep the first lord's).

Waiting: #2/#3 (help pop-ups, Formation menu) on `claude/placement-unit-interaction-2nqaeq`.
Deferred: team-XP rewards still learn class skills without a card (nothing is lost); Oaths dropped at the skill cap (Deeds work in Wave 2).

## PR #151 merged (Formation pick-up, fog on commit, help pop-ups) — review follow-ups

- Talk: `findTalkTarget` (BattleScene ~6370) offers Talk to a fog-hidden recruit beside a lord who just moved (fog now lifts only on commit). Filter by visibility.
- Shove/Pull: `findShoveTargets` / `findPullTargets` (~5001/5026) test `getUnitAt` on a possibly fogged landing tile; use `seenTileOccupant` like Blink/Warp/Rescue.
- Design sign-off: a unit moving next to a fog-hidden enemy cannot attack it that turn (must Wait); the headless harness no longer reveals on move.
- Formation `moveTo` (~359) clears `heldUnit` before `assign`; a refused assign leaves the held tint until the next redraw.
- Still open from #151: hidden enemies block movement range/paths (needs an ambush-style stop).
- Now unblocked: Formation Menu → pause menu (Save & Exit) and "Back to map" (triage #3).

## Decisions on the #151 follow-ups (Dave, 2026-09-28)

- **Talk / fogged recruit:** reveal the recruit NPC on fog maps (always visible), rather than filter Talk. A recruit banner already marks the recruit from turn 1 through fog (BattleScene, "Recruit battles: a banner marks the recruit"); extend it so the NPC sprite itself is never fog-hidden. Low priority; acceptable to leave as is meanwhile.
- **Shove / Pull:** fix — landing-tile checks go through `seenTileOccupant` (like Blink/Warp/Rescue).
- **No attack on an enemy only the new tile would reveal:** intended. Keep.
- **Hidden enemies and movement:** new design. The blue range and paths ignore hidden enemies (no gaps). A move that runs into a hidden enemy stops on the last free tile before it, the enemy is revealed, and the unit can then act normally (attack, Wait, items). Replaces `buildUnitPositionMap` blocking hidden units; needs the ambush stop in the move/path code, Canto, the AI (AI sees everything, unchanged) and the headless harness.
- **Help pop-ups on iPhone:** fixed by #151 (Dave checked on the merged build; the earlier report predated it).

## Next round, in order (updated after the TestFlight review)

1. Legacy caravan migration keeps carried gear (P2, save loss; below).
2. HP accessories cannot heal at 1 HP (P2, below).
3. Formation Menu → pause menu (Save & Exit, Settings, Help) and "Back to map" (triage #3).
4. Fog batch: relocation staves reveal only on commit (P2, below) and the sibling eager update in `_refreshPostCombatMovementState`; Shove/Pull landing tiles through `seenTileOccupant`; the hidden-enemy ambush stop; the fog help text explains reveal-on-commit.
5. Edric's run-start rotation (P3, below).
6. Difficulty ladder (Dusk / Nightfall / Black Sun).

## Next round progress

- Done: 1 caravan migration keeps gear (9a9d9c36); 2 HP accessory debt (78ca81ae); 3 Formation Menu opens the pause menu, with Back to Map before turn 1 (desktop: Esc → Formation menu → Pause menu).
- Done: 4 fog batch. Rescue/Warp and Blink lift the fog only when the action commits (the combat shove/pull reveal stays: combat is saved as committed first); Shove/Pull never offer a fogged landing tile; hidden enemies no longer shape the blue range, and a move (or Canto) that runs into one stops before it: "Ambush!", the enemy shows, the move is locked in and saved, and the unit can still act (`engine/FogAmbush.js`); Terrain › Fog of War help page and the first-fog hint explain reveal-on-commit and ambushes.
- Done: 5 Edric's rotation: each save remembers the pool lines it has played (`storyFlags.linesPlayed`), and a pick takes the least recently played line of the set that applies.
- Done: 6 difficulty ladder. First Light (`normal`, to the Lieutenant) → Dusk (new `dusk`, to the Emperor) → Nightfall (`hard`, now to the Entity) → Black Sun (`lunatic`). Dusk is halfway on every tuned number (+1 enemy count/level, no stat bonus, army-scaled counts with the Act 1 cap, 10% enemy skills, 4% poison, 8% affixes, par ×0.92, 95% gold/XP, +10% meta currency, 4 church promotions, growth ×0.9), with no status staves, ballistas or secondary weapons (those stay Nightfall+); it sees the Act IV enemy classes. Nightfall gains extended leveling for its fifth act. Unlocks: Dusk ← a First Light win (this slot); Nightfall ← a Dusk win or an old Hard win (any slot); Black Sun ← a Nightfall win (any slot). Runs in progress keep the road they started on.

PR notes for the strict-slice threshold change (CI's check:threshold-pr-notes reads these from the PR body):
- Attribution command: `npm run sim:fullrun:triage` (baseline measured with `node tests/sim/fullrun-slice-runner.js --slice ambush_hard_invincible` on each commit).
- first_bad_sha: 6a3778b8 (difficulty ladder: Nightfall now runs on to the Entity). parent_sha: 3539f856.
- Failing metrics / threshold breaches: ambush_hard_invincible avg_gold 52607 > 52200 (was 50460 on the parent; +1 act, 35 → 37 nodes, 29 → 30 battles). Change: `--max-avg-gold` 52200 → 54400, the same ~3.4% headroom. Every other metric is unchanged.


## Wave 2 status (branch `claude/playtest-notes-triage-z12dht`)

Done, with unit and browser tests:

- Upgrade tabs sit under the currency they spend (Valor: Lords, Equipment, Skills; Supply: Recruits, Economy, Battalion); costs say "Supply"/"Valor".
- Title: with several runs going, Resume opens the newest save and names its slot. Save select: the save played last has a gold rim and a Latest tag.
- Forecast: "How to read" is a list; the speed/doubling note lives inside it.
- Weapon arts: labelled sheet (Cost, Effect, On hit…, Needs, one flavour line); shared rules behind "How weapon arts work". 24 descriptions no longer repeat numbers (Silence Strike and Mire were wrong).
- Scrolls: "Skill scroll: teaches Blink, a battle command, to one unit." vs "Weapon art scroll: binds X to one Sword weapon". Team scrolls split by kind; Scrolls help.
- Deeds: the player picks the title (or none) and the one Oath (roster or promotion chooser); Compendium Deeds tab lists earned deeds and a count of the rest.

Still open from Wave 2: an Oath is lost if the unit already has five skills at promotion (help now warns; a skill loadout, Wave 4, would fix it).

## TestFlight review findings (2026-09-28, main @ 9f330c55)

External review of the last 13 merges (#135–#151). Verdict: fine for an owner-only TestFlight build; hold wider distribution until finding 1 is fixed and a device smoke test passes. Each finding below was re-checked against the code on this branch.

1. **P2 — Legacy caravan migration discards gear when the convoy is full.** `RunManager._dropCaravanUnits` (~3287) ignores `addToConvoy` returning false and still removes the caravan, and it drops fallen caravans with any gear they kept. It runs on load, so the loss is saved. Fix: never destroy items. Put overflow somewhere recoverable, as the fallen-unit transfer does, and also recover fallen caravans' gear. Tests: full weapon and consumable convoys, a fallen caravan, forged and imbued gear, loading twice.
2. **P2 — Relocation staves reveal fog before the action checkpoint.** `HealController.executeRelocate` (~359) calls `updateFogOfWar` before spending the use, the XP and `finishUnitAction`. A Canto caster then enters Canto with enemies revealed and no suspend save, so a reload undoes a move whose information was already seen. Fix: let `finishUnitAction` do the reveal, as other actions do, and audit `_refreshPostCombatMovementState` (~8712). Tests: Warp and Rescue with Canto, then reload.
3. **P2 — Cycling an HP accessory heals at critical HP.** `applyAccessoryStats` (UnitManager ~1710) floors current HP at 1 when unequipping, then adds the full bonus when re-equipping. A Seraph Robe unit goes 1/25 → 1/20 → 6/25 and can re-enter the arena. Fix: carry the unpaid deficit, so a re-equip adds only what was actually removed. Tests: critical HP, trade or swap, death and revival, plus the ordinary 10/20 → 15/25 → 10/20 case.
4. **P3 — Edric's run-start rotation can repeat early.** `NarrativeDirector` (~199) indexes the filtered pool by run count, so a change of partner, result or difficulty reshuffles which line an index means. Fix: a stable master order with context-aware skipping, or remember the lines already played.

Observations:
- Fog now reveals only on commit (#151). Explain this in the fog help text and the TestFlight "What to Test" notes.
- Hidden enemies still block the movement range, a known information leak. The ambush stop is in the next round.
- Build 25 predates #151. Build the candidate SHA for device checks (`testers: none`).

Device checklist before wider distribution (Dave, on iPhone):
- Install over the current build. Check that all three slot summaries, progression, suspended-battle resume and an app kill/relaunch work.
- Check help pop-ups upright and sideways. Rotate on the title, with a finger down, and during an action and the enemy phase.
- Formation: pick up and legal/illegal swaps, replacing a waiting unit, Details, Back, Start.
- Fog: move then Back, Wait, Canto, a relocation staff, reload. Also a trade, a Ruins path, unarmed defence and a music transition.

## Phone review links (deploy previews and the dev server)

Dev routes run on Netlify deploy previews (`VITE_DEV_ROUTES`); append these to the preview URL (PR #152: `https://deploy-preview-152--emblem-rogue.netlify.app`). None of them touch a save slot.

- **Fog ambush + Rescue with Canto:** `/?devScene=battle&preset=fog_ambush&seed=1234`. Place the army (the placement screen runs on previews), Start: a hint names the unit and a gold outline marks a fogged tile it can reach; move onto it and the move stops short ("Ambush!"). Sera has Canto and the Rescue/Warp staves for the relocation check. `devScenarios.js` picks the tile; a seed whose army cannot reach the fog says so.
- **Placement Menu / Back to Map:** `/?devScene=battle&preset=combat_actions&seed=42`: Menu on the placement screen, then Back to Map.
- **Difficulty ladder:** `/?devScene=difficulty&preset=ladder` (Dusk and Nightfall open, Black Sun locked with its reason); `&preset=fresh` shows only First Light open.
- **Roster checks:** `/?devScene=nodemap&preset=roster_checks&seed=1`, then Roster:
  - Bramwell's Oath of the Bridge waits in Deeds (give up a skill, or Keep my skills twice).
  - Corwin (five skills, Master Seal) promotes into the waiting note.
  - Edric wears a Seraph Robe at 1 HP with an Elixir and a Vulnerary: take the robe off, heal, put it back.
- **Endings:** `/?devScene=victory&route=lieutenant` (First Light), `route=emperor` (Dusk), `route=entity` (Nightfall).

## Phone review round (Dave, 2026-09-28)

Results on the preview links: fog ambush and Rescue with Canto, placement Back to Map, the difficulty ladder, the roster checks and the endings all work. Follow-ups, done:
- **Rescue/Warp feedback:** once an ally is picked it wears a pulsing gold outline and its landing tiles are gold squares; the phone rail says what to tap at each step (`Grid.showRelocateGuide`, `relocatePrompt`).
- **Pause menu:** Campaign Map reads **View Campaign Map**.
- **Waiting Oath notice:** a callout heads the unit's roster pane on every tab (with a button to the choice), the unit list says "Oath waiting", the route map's Roster wears a gold pip, and the first one a save meets explains what a waiting Oath is (hint `roster_oath_waiting`).
- **"Castle theme silent at the start":** not the score (it sounds from 0 s at the other Act II themes' level). The route map stopped its track on Travel and the battle's track loaded only after the deploy screen; on a 6× slowed CPU that was ~7 s of silence. The route's track now bridges into the battle's and crossfades.

