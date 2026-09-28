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
