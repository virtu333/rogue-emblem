# Changelog

## Unreleased

### Two New Lance Arts: Lunar Brace and Override (Oct 7, 2026)

- **Lunar Brace** (Lance, Steel, Prof, Act II; 3 HP, 2 per map): the strike adds 30% of the
  foe's Defense (rounded down) as damage, so it bites hardest on armour. It reads the same
  Defense the blow is measured against: terrain, Defense buffs and the foe's own weapon
  included, halved by Luna or Sunder when they halve it. A strike against Resistance
  (magic) gains nothing. Its follow-up, when it has one, is a plain strike. Taught by the
  Lunar Brace Scroll, and may roll on Steel lances.
- **Override** (Lance, Silver, Master rank, Act III, player only; 5 HP, once per map): strikes
  the target and every foe in the two tiles behind it (60% per landed strike, like Skewer),
  then drives each foe it hit back one tile, the farthest first so the line moves as one.
  Ice slides apply; a foe that cannot move stays. Bosses, the Entity, Anchored and rooted
  foes hold their ground and block the foes in front of them. Foes the line killed are not
  pushed. Like every art push it needs you next to the target; from range the line still
  strikes. The preview shows each foe's landing, and names the ones that brace. It may roll
  on Silver lances; only a Master-rank lancer can use it.

### Tighter Pars Where Clears Are Fast (Oct 4, 2026)

- **First Light:** par is two turns tighter on every map. A quick clear still earns an S
  most of the time (about 9 in 10 for an aggressive player), and every seize map still
  leaves an S for a lord who walks straight to the throne.
- **Escape maps:** par two turns tighter (Black Sun: one). An S used to be near-certain on
  every difficulty.
- **Act IV rout maps:** par two turns tighter on Dusk and Nightfall (Black Sun: one).
  Enemies charge from turn 1, so these big maps were often cleared in 3–5 turns against a
  par of 9.
- Act I–III rout maps and seize maps are unchanged. Fewer S-ranks mean a little less
  par bonus gold (about 1–1.5k G over a Dusk or Nightfall run). Maps already generated
  in a saved run keep their par.

### Nightfall: Lighter Act I Rout Maps (Oct 4, 2026)

- **Fewer starting enemies.** Nightfall sizes its garrisons as if you field at least 4
  units (was 5). The first map now has 5 enemies against your 2 lords (was 6); Act I stays
  one or two above Dusk. In Act II only a 4-unit army sees one fewer; from Act III on (5+
  deployed) nothing changes.
- **Fewer Act I reinforcements.** The Act I rout ladder is two waves, not three: 1–2 on
  turn 4, then 1–2 (one level up) on turn 7. That is 2–4 arrivals, where it used to be
  4–6 over turns 4, 6 and 8. Acts II–IV, Dusk and Black Sun are unchanged.

### Arena: Fights to the Finish (Oct 4, 2026)

- **A bout now goes round by round until one fighter falls.** It used to be a single
  exchange, so a level-matched challenger almost never fell: 78–98% of bouts were draws
  that paid no gold, a quarter of the XP, and cost the fighter about a third of its HP.
  Now fewer than 3% of bouts reach the 10-round limit (a draw: the fee comes back, with a
  little XP). Bouts last about 2.5 rounds.
- **The forecast shows the odds** of the bout fought to the end ("Win about 60% · Lose
  about 40%"), estimated from many simulated bouts that never touch the run's dice.
- **The entry fee is paid when the bout starts.** A win returns it with the prize and full
  XP. A loss keeps it and leaves the fighter at 1 HP.
- **Yield between rounds:** the fee is gone, but the fighter keeps the HP it has. Leaving
  mid-bout counts as yielding. Every round is saved as it is fought.
- **Bigger prizes:** Bronze 150 → 200 G, Silver 400 → 500, Gold 800 → 1000, Platinum
  1500 → 1800. In a sim of fresh fighters, the first bout is worth about +140 G on average
  in Act I Bronze, +270–380 G in Silver and Gold, and +300–540 G in Platinum. HP lost in
  the arena still carries into the next battle.

### Poison Needs a Hit (Oct 3, 2026)

- **A missed attack no longer poisons.** The enemy-only Adder Blade and Adder Bow (5) and
  the Venomous imbue (7) took their after-combat poison even when every strike missed.
  Now, like the Venomous affix (which already needed a hit) and status imbues such as
  Binding, a side's poison lands only if at least one of its strikes hit. A hit that
  deals no damage still poisons, and poison still never kills.
- The Poison tag, the help page and the Venomous imbue's description say so.

### iOS App: Music Plays Again (Oct 3, 2026)

- **The iOS app had no music** (title, map or battle) since the build with hashed audio
  (#170). The app serves its files through Capacitor, which answers an mp3 with a bare
  non-HTTP response, so `fetch` reported status 0 and every track was refused. Before
  #170 a failed fetch fell back to Phaser's loader, which accepts that response; #170
  removed the fallback so nothing could skip the recording check.
- On `capacitor://` (and `file://`) music and ceremony cues now load through XHR, as
  Phaser's loader does, and their bytes still pass the SHA-256 check. Ceremony cues
  (level up, promotion, boss cards) load the same way; their `fetch` had the same
  problem in the app, so they fell back to their sound effects there. The web game still uses `fetch`.

### Roster: The Weapon Comparison Is a Table (Oct 3, 2026)

- A carried weapon's "Compared with <equipped>" note in Unit Details › Equipment is now
  a small table, one row per stat: old → new with the change in green (better) or red
  (worse). An unchanged stat shows once, marked "same". It sits with the item's numbers,
  above its weapon art and lore. The shop and reward screens keep their one-line summary
  from the same rows, so all three still agree.

### Dusk Pressure PR 4: Status Staves and Siege Tomes by Rung (Oct 2, 2026)

- **Staves and siege tomes are a per-battle chance.** When a caster who could carry one
  stands on the map, the battle rolls once: Dusk fields Silence staves only, from Act III
  (15% / 20%), and a Breachbolt in Act IV (15%); Nightfall staves from Act II
  (10 / 25 / 30 / 35%) and siege from Act III (25 / 30 / 35%); Black Sun a little more
  of each, with up to two staves. Before, each caster rolled a few percent, so they were
  rare however the rungs were set.
- Shops guarantee cures in every act that fields staves (now Dusk Acts III–IV and
  Nightfall Act II too).
- The roll never changes the map itself, and runs saved before keep their old odds.
- Siege casters still move and fire like other casters; an Artillery AI that fires from
  a post is a later change. Spec: `docs/specs/dusk-pressure.md` §2c.

### Dusk Pressure PR 3: Hold-Position Garrisons and the Seize Par Fix (Oct 2, 2026)

- **Garrisons hold their ground on Dusk and harder.**
  - Part of a seize or escape map's enemies now holds instead of marching into your kill
    zone: 35/45/55% of a seize garrison and 30/40/50% of an escape garrison's exit half.
    They are the enemies nearest the throne or the exits, in packs of two or more.
  - A pack wakes when one of its members:
    - sees a unit of yours inside its Danger tiles (the red zone is the wake zone; a
      holder hidden in fog does not count until you see it);
    - is struck, hexed or shoved;
    - sees its boss enrage.
  - Waiting out the anti-turtle clock does not wake them.
  - "The garrison stirs!" marks a pack you can see waking.
  - Holds replace the seize guards on those rungs. First Light keeps its guards.
- **Seize par is tighter** on Dusk (−3), Nightfall (−4) and Black Sun (−4), never looser
  on a harder rung, and never below a lord's straight walk to the throne plus 4 turns,
  so an S stays reachable. A slow seize lands in B.
- Both are fixed when a map is generated, so saved and locked battles play as they did.
- Spec: `docs/specs/dusk-pressure.md` §2b and §6.

### Area Weapon Arts, Engine (Oct 1, 2026)

- **Elite enemies swing area arts on Nightfall and Black Sun.** From Act III, one or two
  enemies on an elite battle carry Sweeping Cleave (axes, swords) or Skewer (lances,
  bows), set in `enemies.json` `eliteAreaArts`. They use them like any art (HP cost, two
  per map), mostly to finish a unit. Threat sight's line counts them: "2 foes can reach ·
  1 with an area art". No other battle changes, not even its generated layout.
- **Balance change: splash and pierce are now each victim's own blow.** Cinder Quake (Burning Quake), Radiant Burst, Barrage, Cataclysm Bolt and Tempest no longer pass on a share of the hit that landed on the target. Each foe in the area takes the art's own strike against its own DEF or RES, terrain, weapon triangle and weapon bonuses. Crits and strike skills no longer carry over, and the art's flat bonuses and passive skills still count. Against a foe built like the target, the numbers match the old non-crit splash. Tempest's effectiveness now reaches fliers in its area, capped at 3× (only the target itself can reach 5×). Cataclysm keeps its fixed 5.
- **Piercing Charge and Doom Thrust** strike the foe behind with their own blow on every landed hit. Doom Thrust now pierces at range 2 as well, though its push still needs it to stand next to the target. Pierce, like before, lands even if the counter then fells its user.
- **Anchored** foes can no longer be pushed or swapped by weapon arts (Overrun, Doom Thrust, Lunge). Before, the affix's protection was never applied.
- **Four new area arts.** Each is taught by a scroll; Cleave and Skewer drop in Acts 2-3, Benediction and Battering Ram in Act 3, and all four can also roll on Steel/Silver weapons:
  - **Sweeping Cleave** (Axe/Sword, Steel, 6 HP, 2 per map): a 50% blow to every other foe next to you.
  - **Skewer** (Lance/Bow, Steel, 6 HP, 2 per map): a 60% blow to up to two foes behind the target on each hit, at any range.
  - **Benediction** (Light, Silver, 6 HP, 3 per map, player only): on a hit, allies next to you heal half the damage you dealt.
  - **Battering Ram** (Lance/Axe, Silver, 6 HP, 2 per map, player only): pushes the target up to two tiles. If something stops it, the target takes 5, and so does a foe it crashes into.
- **Previews before you confirm.** An area art tints the tiles it covers and rings each foe you can see in reach. The forecast lists each foe's damage, KOs and heals, and the board shows them as numbers. A foe hidden in fog is never shown, though it still takes the blow.
- **Stormcall (Breachbolt): call the storm down on any tile in reach.** Pick the art, aim at a tile 3-10 away (the cursor starts on the nearest foe you can see; the blast and its numbers show only what you can see), then Fire. Every foe within a tile of it takes 80% of the art's own blow: no hit roll, no counter. 8 HP and one of the tome's shots, twice a battle, once a turn. Mouse, keyboard (arrows, Enter, Q/E to step through foes, Esc), pad (A, B, L1/R1) and touch (tap, ◀ Foe ▶, Back) all work, on an upright phone too. A refresh mid-strike finishes the same strike.
- **Galeforce Assault (Oathaxe): a kill lets its user move and act again.** Once a turn, like the art itself. Its old one-tile step after combat is gone; the HP cut to 5 and the STR buff for allies stay. Commander's Gambit takes precedence when both fire. A saved battle resumes with the refresh intact.
- **XP for every foe an area art hits.** Besides the target's usual XP, each other foe the area hits pays 0.35 of the combat XP for that foe, or 0.6 for a kill, at most 75 base per action, before the battle's XP multipliers. Elite and boss victims count their own bonus, and Mentor's Band shares it. Battles and the sim harness pay it together (`AREA_XP_LIVE`).
- Spec: `docs/specs/aoe-weapon-arts.md`.

### Dusk Pressure PR 1: Breachbolt Shots, Par-Neutral Waves, Shared Turn Pressure (Oct 1, 2026)

No tuning yet (docs/specs/dusk-pressure.md, PR 1).

- **Breachbolt shots are spent:**
  - Nothing ever spent a Breachbolt use, so an enemy siege caster fired every enemy phase and a looted copy never ran dry.
  - A combat in which the wielder strikes with it (attacking or countering, hit or miss) now spends one shot. The player's copy has 3 per battle and an enemy's has 5 (`weapons.json` `uses` / `usesByFaction`), with no MAG bonus. Shots refill after every battle.
  - A spent copy cannot counter.
  - An enemy siege caster keeps its own weapon behind the tome and switches to it once its shots are gone. The Danger overlay draws that weapon's reach.
  - A unit whose Breachbolt fires its last shot switches to its next usable weapon as soon as the combat's deaths are settled, so it can counter again at once. Kill credit still goes to the Breachbolt. A player unit only switches to a weapon it can equip, and a banner names the new weapon. An enemy with nothing to switch to stops attacking.
  - The weapon tooltip, the roster card and the Siege keyword show the shots, read from data. A Breachbolt already in a save (still holding `uses: 1`) takes the catalog counts when the run loads (`engine/WeaponCatalogMigration.js`, beside the item-name and Gambler's Coin migrations).
- **Par-neutral waves:** whether a wave raises par is now one rule shared by the battle and the headless harness (`ReinforcementScheduler.waveRaisesPar`). Repeating pursuit waves stay par-neutral as before, and the coming rout ladder will be too.
- **Reinforcement tiles:**
  - Procedural arrivals no longer land on Lava Crack, the Acidic tiles, a Ballista, a Throne or a Village.
  - An arrival's tile must suit every class it might copy, so an Armored arrival is never left stranded on Swamp.
  - An authored arrival is checked against its own class.
- **Anti-turtle clock:**
  - The anti-turtle and boss enrage clock moved to `engine/TurnPressure.js`, and the headless harness now runs it too. Before, harness guards never left their posts.
  - **Fix:** the clock's baseline was taken before any enemy had spawned, so kills never counted as progress and the AI turned aggressive three turns into every battle. Kills now reset it.
- **Headless harness parity:** enemy spawn gear (Entity weapons, Sunder and Poison, siege tomes, status staves, Nightfall+ secondaries) now comes from one engine module (`engine/EnemySpawnGear.js`), and the harness's enemies use their status staves.

### Sell Safety, Item Use Counts and the Fallen (Oct 1, 2026)

- **Sell list risk tags**: each Sell row says whose only weapon ("Only weapon") or staff ("Only staff") it is, and, more quietly, a unit's last weapon of a type ("Only bow"). Selling a healer's only staff now warns ("Leaves Sera without a staff"), like the last weapon always did.
- **Item use counts**: every weapon counts its strikes and the kills its strikes made, and every staff its casts, per item. Sell rows show them ("14 strikes", "9 casts"), and so do the sell detail and the roster's item card ("Used in 14 strikes · 3 kills", "Cast 9 times").
- **The fallen keep their last battle**: kills, crits and deeds a unit earned in the battle where it fell are no longer lost (deeds only a survivor can earn excepted, and the fatal battle does not count toward Veteran).
- **Fix: a fallen unit's items**: a unit that fell was saved with the bags it entered the battle with, so an item it traded away mid-battle was duplicated (with its new owner and in the convoy), an item it was given was lost, and a Vulnerary it drank came back full. Its record now carries what it held as it fell.

### Staff Relocation Visuals (Sep 30, 2026)

- Rescue and Warp preserve each visual element's opacity when moving an already-used ally, so the next turn restores its ready appearance without leaving the sprite or HP bar faded.

### Audio Recording Versions (Sep 30, 2026)

- Returning desktop installs now request exact soundtrack versions instead of replaying old cached placeholder music. Adaptive layers validate recording identity and timeline compatibility; invalid recordings fail cleanly.
- iOS hashes compact audio before bundling. Audio diagnostics identify recording versions and rejected layers.

### Home Base Stat Upgrade Pricing (Sep 27, 2026)
- **Stat upgrades priced by value**: Every lord/recruit growth and flat stat track now costs (value weight x a shared escalating curve), so the next tier of any stat is roughly as good a buy as any other. Weights (DEF = 1): SPD 1.15 (offense and defense), STR 0.8, HP 0.55 growth / 0.85 flat, RES 0.45, MAG 0.4, SKL 0.4, LCK 0.35. SPD costs most (lord SPD flat `250 / 695 / 1460`), MAG/SKL/LCK least (lord LCK flat `125 / 210 / 445`).
- **MAG and LCK tracks**: eight new stat upgrades (lord and recruit, growth and flat) on the same curves: Keen Minds / Lucky Stars, Recruit Arcana / Recruit Fortune, Lord Sorcery / Lord Fortune, Lord Arcana / Lord Providence. Flat tiers unlock at growth tier 3; Lord Arcana also needs Act 1 beaten, like the other offensive lord flats.
- **`sim/metaStatValue.js`**: paired-seed full-run sweep (real run loop) that measures what each stat track is worth in battles won; the weights above blend its results with design judgement.

### Village Ambush + Coverage Hardening (Feb 18, 2026)
- **Village ambush flow**: Shop nodes can become ambush encounters by difficulty (Normal 10%, Hard 20%, Lunatic 25%). Players must win a rout battle before the shop opens, then receive a 20% ambush discount that applies to item prices, rerolls, and forge costs, stacking multiplicatively with blessing discounts.
- **Ambush deterministic fullrun slice**: Added a Hard-difficulty invincible PR slice on seeds 301-312 to continuously gate battle-first ambush shop flow and economy invariants, including a strict `avg_ambush_battles` threshold.
- **Ambush edge-case test coverage**: Added simulation defeat/timeout abort coverage for ambush shop battles, plus generator assertions for intermediate ambush probability and ambush battleParams row/level scaling composition.

### Economy + Inventory + Reclass Sync (Feb 18, 2026)
- **Fallen-unit transfer behavior hardened**: Fallen units now route eligible weapons/staves and consumables to convoy, accessories to the accessory pool, avoid duplicate convoy transfer on deep-equal equipped-weapon edge cases, and preserve blocked equipped items on the fallen unit when convoy is full.
- **Shop sell + capacity UX clarified**: Consumables can now be sold in village shops; sell-list scrolling now uses a unified row model (no dead-scroll drift); shop picker, battle trade, and roster trade surfaces now show labeled capacities (`Inventory x/5 | Consumables y/3`).
- **Shop convoy fallback preserved**: Full unit rows in the shop picker remain selectable so purchases can still route to convoy when personal slots are full.
- **Reclass seal closeout landed**: `starting_reclass_seal` is now present in runtime/public meta upgrade data and validated by run-start regression coverage.
- **Meta economy retune applied**: Updated outlier upgrades and costs, including `Plunder` (`+10% / +20%`, costs `125 / 325`), `War Chest` pricing (`50 / 100 / 150` for flat `+500 / +1000 / +1500`), `Expanded Ranks` (`+3` at `175`), vision charge pricing, and starting-gear economy costs.

### Act 4 + Narrative + Systems Hardening (Feb 15, 2026)
- **Act 4 hard-mode progression shipped**: Added runtime progression support for Act 4 with new templates, terrain hazards, and slide-aware AI behavior.
- **Reinforcement system expanded and hardened**: Added contract validation, scripted boss-map waves, deterministic turn jitter, and parity/state fixes with focused regressions.
- **Boss-map generation safeguards**: Added hybrid arena validation/overrides, boss-only template gating, and deterministic fallback handling for missing objective pools.
- **Act 4 boss follow-up polish**: Trimmed map presentation, routed emperor sprite usage, and added spawn-pressure guards for boss encounters.
- **Narrative flow foundation landed**: Added dialogue system support, act transition narrative hooks, and boss naming updates.
- **NodeMap dialogue input safety**: Node clicks are now queued during story dialogue to avoid skipped or invalid map actions.
- **Weapon Arts expansion (Phase 1/2)**: Added stat-scaling, expanded magic-art catalog coverage, and new tactical-depth arts/combat flags.
- **Weapon Art assignment reliability**: Hardened run-start art assignment and instance-bound selection behavior with dedicated regression coverage.
- **Weapon Art meta wiring split**: Meta upgrade progression for arts was split for clearer unlock flow, with migration-only legacy reference cleanup in docs.
- **Scene lifecycle hardening pass**: Added transition metadata, cleanup contracts, leak detection/audits, crash tracing, SceneRouter facade coverage, and combat NaN guards.
- **Audio lifecycle reliability**: Hardened overlap prevention and delayed-transition behavior with watchdog + scene guard improvements.
- **Mobile controls architecture upgrade**: Added HTML overlay infrastructure, scene context stack handling, listener lifecycle cleanup, ghost-click prevention, and Home Base mobile cancel/menu semantics.
- **Tutorial flow improvements**: Hardened tutorial gate/skip flows, clarified terrain hints and Fort move checks, and added a turn-3 vision-rewind intro step.
- **Help/tutorial discoverability**: Added Eye guidance and help search support, plus tuned chunk-E tutorial rewards.
- **Meta-progression economy updates**: Added a full refund system with UI/tests, split Deadly Arsenal into Rapier/Silver tiers, added Vanguard Cadre + Field Supplies II, and retuned upgrade costs.
- **Economy reward rebalance**: Increased battle/loot/par gold rewards, updated gold multipliers, and tuned War Chest starting-gold scaling.
- **XP tuning for priority targets**: Added a +30% XP bonus for boss/elite kills.
- **Combat/runtime fixes**: Added `resBonus` support, fixed Adept state initialization paths, corrected Rapier cavalry effectiveness text/data mismatch, and fixed lethal-armory export/wiring.
- **Loot/accessory flow fixes**: Restored accessory loot feedback, added accessory pool equip UX, fixed loot quality/category mapping/effect parsing, and hardened legacy migration parity.
- **Battle/UI readability pass**: Added weapon stats in equip menus, weight in attack picker details, tighter equip stat layout, faction base rings, tinted HP bar backgrounds, and richer post-battle recruit/loot card text.
- **Home Base / shop UX polish**: Added meta-upgrade hover tooltips, centered Home Base footer controls, and added NodeMap shop-item hover detail text.
- **Release-gate and regression expansion**: Added CI workflow coverage for unit + harness gates, expanded Playwright scene/node-map coverage, and added economy/mobile/context regression + CLI smoke tests.
- **Harness governance updates**: Added threshold calibration guidance and adjusted sim PR gate thresholds with refreshed reference artifacts.

### Weapon Arts + Wyvern + Convoy (Feb 12, 2026)
- **Weapon Arts foundation shipped**: Added weapon art data/system integration, battle command flow, and forecast/execution parity safeguards (including HP-cost timing parity and unlock gating hardening).
- **Scroll overwrite transaction hardening**: Scroll apply now commits atomically on confirm (no pre-confirm mutation), re-plans at commit time to avoid stale overwrite state, and preserves cancel/failure behavior without mutating weapon slots.
- **Act-based weapon art progression**: Added run-state unlock progression by act and node-map unlock banner notifications.
- **Unlock safety hardening**: Empty unlock states are treated as authoritative (no fallback leak to full catalog), and unknown `unlockAct` values now fail closed.
- **Weapon art contract hardening**: Added engine-level `unlockAct` config validation so malformed act IDs fail closed anywhere `canUseWeaponArt` is evaluated.
- **Enemy art AI guardrails**: Enemy weapon art selection now uses deterministic tie-breaks (score -> lower HP cost -> ID), with explicit regression tests for tie resolution and lethal self-cost rejection.
- **Forecast/execute parity regression coverage**: Added tests that enforce identical post-cost HP skill context between forecast and execution paths, repeated-preview no-consumption behavior, and illegal-candidate filtering in enemy art tie scenarios.
- **Home Base UI declutter**: Removed the non-interactive Arts tab from Home Base to reduce navigation noise while Weapon Arts progression remains handled in run/battle flows.
- **Help discoverability update**: Added a dedicated Help page for Weapon Arts usage, costs, and limits after removing the Home Base Arts tab.
- **Help clarity follow-up**: Clarified Weapon Arts help copy for `Req Prof` vs `Req Mast`, and explicitly documented act-unlock (run progression) vs meta-unlock (active from run start) semantics.
- **Acquisition/meta surface clarity**: Home Base upgrade descriptions now call out Weapon Art unlock side effects (for example, Deadly Arsenal now explicitly indicates it unlocks Weapon Arts).
- **Initial Weapon Arts balance pass**: Tuned `Longshot` and increased legendary art HP costs, with new data-level guardrail tests to prevent reintroducing low-risk dominant picks.
- **Difficulty-aware enemy art frequency**: Enemy Weapon Art usage now scales by difficulty (stricter/less frequent on Normal, more frequent on Hard/Lunatic) with deterministic regression coverage for thresholding and proc-rate behavior.
- **3c polish wrap-up hardening**: Added run-start integration coverage for meta/act unlock availability in battle choices, plus deterministic enemy-art proc roll injection/clamping for safer harness/test behavior.
- **Weapon Arts UX copy polish**: Help page now explicitly calls out that status text explains why an art is unavailable.
- **QA playtest checklist added**: Added `docs/weapon_arts_playtest_checklist.md` as a repeatable smoke path for forecast parity, unlock-source behavior, requirement clarity, legendary/enemy guardrails, and difficulty sanity.
- **Meta-innate spawn wiring**: Shop and battle-loot weapon generation now bind eligible meta-unlocked arts onto spawned Iron/Steel weapons (`meta_innate` source), with deterministic selection and regression tests.
- **Meta unlock surfaced for spawn binding**: Replaced legacy `Arcane Etching` (`weapon_art_infusion`) with `iron_arms` + `steel_arms` + `art_adept`; basic Sword/Lance/Axe/Bow arts now bind to eligible Iron/Steel spawns via the new upgrades, with legacy key support retained only for save migration.
- **Wyvern foundation (no reclass)**: Added Wyvern Rider/Lord integration and deterministic coverage while explicitly deferring Second Seal/reclass scope.
- **Wyvern hardening follow-up**: Promotion/load paths now normalize class-driven state (`moveType`, `mov` sync, tier/proficiencies) to prevent legacy drift; post-normalization weapon relink ensures equipped weapons remain legal.
- **Convoy MVP landed**: Added convoy storage + overflow routing with hardened transaction paths for shop overflow and battle loot pickup failure cases.
- **Accessory flow simplification**: Removed in-battle accessory action; accessory management is now roster-oriented.

### UX / Input Reliability (Feb 12, 2026)
- **Menu click bleed-through guard**: Added one-shot input suppression so UI clicks (weapon picker/menu buttons) do not trigger unintended map actions on pointer-up.
- **Defeat-state hardening**: Added stronger post-defeat input/state guards to avoid softlock-like interaction drift.
- **Title screen polish**: Added `MORE INFO` surface + GitHub link, title-button layout refresh, and desktop notice readability improvements.

### AI Reliability (Feb 11, 2026)
- **Path-aware enemy chase fix**: Enemy AI no longer idles when reaching a target requires temporarily increasing Manhattan distance (common around river/bridge detours). Chase logic now picks a reachable step along the shortest real path to an eventual attack tile.
- **Regression coverage added**: `tests/AIController.test.js` now includes a detour scenario to prevent reintroducing long-distance idle behavior.

### Documentation + Release Sync (Feb 11, 2026)
- **Difficulty foundation shipped on `main`**: Added/landed `difficulty.json`, deterministic modifier wiring, run-state persistence, Home Base difficulty UX, and Lunatic preview lock state.
- **Hard unlock rule tightened**: Hard mode now unlocks only after a true victory run (not partial progress), with guardrails in run-complete and menu flows.
- **Startup hardening + mobile-safe loading**: Added startup telemetry/runtime flags, asset warmup + scene loader split, and watchdog recovery to reduce boot stalls and improve mobile reliability.
- **Wave 6 blessings follow-through**: Blessings telemetry + act hit-bonus integration merged, with associated analytics/tests.
- **Save migration coverage**: Added migration path to backfill missing class innate skills on existing saves.
- **Test baseline updated**: `npm test` now passes at **846 tests** on `main`.

### New Features
- **Complete Weapon Stats Display**: All weapon stats (Mt/Ht/Cr/Wt/Rng) now visible in RosterOverlay and UnitInspectionPanel. Hover tooltip for weapon specials (Ragnell, Runesword, etc.).

### Major Features
- **Turn Bonus System**: S/A/B/C rating per battle based on turn par, bonus gold per act
- **Staff Mechanics Overhaul**: MAG-based healing, limited uses with scaling, 5 staves (Heal/Mend/Physic/Recover/Fortify)
- **Weapon Forging**: +1Mt/+5Crit/+5Hit/-1Wt per forge (max 3), shop forge tab, loot whetstones
- **Help & Onboarding**: 8-tab help dictionary, 4-page How to Play guide
- **3 Save Slots**: Independent slot system with migration from single-save
- **Meta-Progression**: 41 tiered upgrades across 6 categories (Recruits/Lords/Economy/Battalion/Equipment/Skills)
- **Starting Equipment & Skills**: Meta tabs for weapon forge, deadly arsenal, accessories, staff upgrades, skill assignments
- **Supabase Auth**: Username/password login with cloud save sync (3 tables with RLS)
- **Music System**: 21 background tracks with per-act battle/explore/boss music, 18 SFX
- **Recruitment System**: NPC spawn on recruit nodes, Talk to recruit, level scaled to lord
- **Economy**: Shops (buy/sell/forge tabs), reroll, node gold multipliers, loot tables with roster filtering
- **Node Map**: Column-lane system (5 lanes, non-crossing edges), act progression, auto-save
- **Accessories**: 18 items (11 stat-based + 7 combat effect), equip/unequip/trade
- **Fog of War**: Vision ranges by class, fog generation per node
- **Expanded Skills**: 21 skills (6 trigger types), on-defend (Pavise/Aegis/Miracle), scroll consumables
- **Expanded Weapons**: 52 weapons, throwables, effectiveness, poison, drain, siege, equipped stat bonuses
- **Balance Simulations**: 4 sim scripts (progression, matchups, economy, full run)

### UI & Polish
- Animated pixel-art title screen and auth/login screen
- Tabbed unit inspection panel (Stats/Gear, 160px width)
- Roster overlay with portraits, skill tooltips, trade picker
- Danger zone overlay (D key toggle), enemy range on right-click
- Combat forecast with miracle indicator, weapon auto-switch tooltip
- Dynamic roster bar spacing, HP bar gradient

### Bug Fixes
- **NEW GAME scene flow**: Fixed NEW GAME button to go through HomeBase before NodeMap (was skipping meta-progression screen)
- Weapon/consumable cloning (shared reference bug)
- Music overlap on scene transitions
- Node map visual crossing fix (fixed 5-column grid)
- Staff depletion + auto-equip, Miracle reset per battle
- removeFromInventory filter (combat weapons only)
- Recruit level scaling to lord level
- Various UI overflow and positioning fixes
