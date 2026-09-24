# Improvement Opportunities — Gameplay, UI/UX, Story (September 20, 2026)

Product-level review of the current build (post UX-audit fixes, TestFlight build 10). This is not a bug audit — everything here works as designed; the question is whether the design leaves value on the table. Three exploration passes (gameplay depth, UX design, narrative) plus live play. Costs: **S** = data-only or trivial code, **M** = data + modest engine/UI work, **L** = new system.

---

## Top 10 across all areas (payoff per cost)

| # | Opportunity | Area | Cost |
|---|---|---|---|
| 1 | Split `reducedEffects` — TestFlight users currently get the juiceless build | UX | S |
| 2 | Wire up the 20 fully-implemented but unreachable skills | Gameplay | S |
| 3 | Battle-speed control (Normal/Fast/Instant + hold-to-speed) | UX | S |
| 4 | Forecast: post-combat HP preview + KO indicator + triangle glyph | UX | S |
| 5 | Gold sinks — economy sim shows 16k–31k unspent gold at run end | Gameplay | S |
| 6 | Run-history dialogue variants + cause-aware defeat epilogues | Story | S |
| 7 | AI target scoring does no combat math (`score = maxHp - hp + (100 - hp)`) | Gameplay | M |
| 8 | Anti-repeat shuffle-bag for all flavor-line pools | Story | S/M |
| 9 | Repeat-player friction: deploy memory, last-difficulty preselect, Title resume button | UX | S/M |
| 10 | Mid-run shrine node — blessings fire once per run today | Gameplay | M |

---

## Gameplay (from data + engine + economy-sim evidence)

### Tier 1 — data-only or near-data
1. **20 dead skills** — `skills.json` has 56 skills; only 21 are reachable by any grant path. `lethality`, `pavise`, `aegis`, `fury`, `sure_shot`, `intimidate`, `renewal`, `duelist_stance`, `skyward`, `draconic_aura` and 10 more are fully implemented in `SkillSystem.js` and granted by nothing. 42 of 52 classes have no `learnableSkills`; base classes learn at level 15 but `PROMOTION_MIN_LEVEL = 10`, so most players promote before ever seeing a learned skill. Assigning promoted-class identity skills (General→pavise, Sniper→sure_shot, Assassin→lethality…) roughly doubles the build space for a `classes.json` edit. **S**
2. **Gold abundance** — `sim:economy` (N=500): 16,011–31,660 gold left over at run end vs ~6,600 max spent; Master Seal affordable by end of Act 2 in 100% of runs; no weapon durability means Iron/Steel are dead content once Silver is affordable. Knobs already in data (`GOLD_PER_KILL_BASE`, battle/boss bonuses, `turnBonus.json`, price curves). A real sink (per-act price escalation or Silver-tier uses) is M. Note: gold abundance is also what papers over the flagged late-act stat-curve gap — tune together. **S/M**
3. **Act 4 loot = Act 3 copy** — `lootTables.json` act3/act4 pools are character-for-character identical except one staff and weights. Zero act-4 weapon arts (`unlockAct` maxes at act3); Light/Staff/Breath types have no arts at all, leaving Sera outside the entire arts system. **S**
4. **Normal-mode enemy variety** — all 12 affixes (`thorns`, `waller`, `teleporter`, `shielded`, `deathburst`…) are gated to 0% on Normal, where beta impressions form. A 5%/tier-1/act2+ rate on Normal is one config block. Also: Normal skips Act 4 entirely and Hard skips the final boss (`difficulty.json` `actsIncluded`) — verify that's intended. **S**
5. **Node-map choice depth** — rows 0, rows-2, rows-1 are pinned single-column (no choice); Act 1 rolls 80% battle; `ACT_LEVEL_SCALING` exists only for act1/act3 so acts 2 and 4 have no intra-act ramp; Act 1 is grassland-only with ~4 rout templates so every Act-1 run looks the same. Rebalance weights + add act2/act4 scaling is S; differentiated elite/risk nodes is M.

### Tier 2 — engine work
6. **AI combat math** — `AIController._scoreAttackTarget` is `maxHp - currentHP + (100 - currentHP)`: no expected damage, no kill check, no counter risk, no triangle, no terrain. Enemies also have no aggro leash (nearest-player from turn 1) and the guard archetype is a one-way latch — so forest-tank baiting is the dominant strategy with no counter. `getCombatForecast` is pure; wiring expected-damage × hit + kill bonus − counter risk into scoring is contained. Guard-latch fix is one line. **M — the single largest tactical-depth lever.**
7. **Mid-run shrine node** — blessings are selected exactly once, pre-run, with one slot forced tier 1 (all filler). The tier 2–4 risk/reward `costPools` machinery is the best-designed data in the repo and fires at most once per run. A shrine node (one per act, 2 offers with rolled costs) turns 23 blessings from 1/run into ~4/run. Engine already built and contract-tested; cost is a node type + overlay. **M**
8. **2RN hit rolls** — `Combat.rollStrike` uses a single roll; displayed 75% missing 25% of the time reads as unfair in a bait-centric game. `(r1+r2)/2` is one line plus seeded-test churn. **S**
9. **Lord traits** — TraitSystem deliberately excludes lords, the units that define a run. Rolling one trait per lord (or a lord-only pool with sharper tradeoffs) is the cheapest run-variance injection. **S**
10. **Enemy self-preservation** — no enemy heals, retreats, or seeks terrain (steps off +30-avoid Mountain to attack). A `heal` archetype + terrain tiebreak in landing-tile scoring is the biggest "enemy plays the same game" signal. **M**
11. **Meta-progression texture** — 36 of 68 upgrades are pure +stat/+growth; `starting_skills` unlocks only skills already in the recruit pool. ROADMAP Wave 10 items (class innate skills, lord proficiency, node events) become nearly free once #1 lands. **M**
12. **Smaller tuning** — imbues all weight-10/no-downside (add costs, S); weapon-art HP costs flat 2–9 regardless of max HP (percent-based, S); art-suppresses-doubling rule appears in no description (free clarity win); Archer/Fighter statistically weakest recruits, Dancer has the highest growth total in the game; roster cap 12 vs deploy 6 leaves half the roster permanently benched (M).

**Sim caveats:** `sim:fullrun`'s 0% win rate is an autoplayer artifact (trust `tests/sim/fullrun-runner.js` instead), but it corroborates the known early-Sera-survivability risk; `sim:progression`'s "all lords underpowered" excludes weapon might/forge, overstating the gap.

---

## UI/UX (design-level, not bugs)

### Do before wider TestFlight distribution
1. **`reducedEffects` defaults ON for every mobile UA** (`SettingsManager.js:18`). One flag gates 21 sites: crit cut-ins, camera shake/zoom, proc art, weapon-art bursts, lord quips, and ~halves all animation durations. Testers' first impression is combat resolving as text and tints, and the label ("Reduced effects") gives no hint to turn it off. Split into `reduceMotion` (accessibility, honors `prefers-reduced-motion`) and `effectsQuality` (default High). **S — highest-leverage single change.**
2. **Battle-speed control** — zero speed/skip affordances in the codebase; act-3 battles have 8–14 enemies and several minutes of pure animation each, every battle, in a replay-heavy genre. Normal/Fast/Instant multiplier + hold-to-fast-forward during resolution. **S**
3. **Forecast upgrades** — `ForecastOverlay`/`MobileBattleHUD` show current HP only; the forecast object already carries damage/attackCount. Add predicted-HP ghost bar + KO flag, and a ▲/▼ weapon-triangle glyph (triangle is computed, taught in 3 help pages, and surfaced nowhere at decision time). **S**
4. **Haptics** — zero `Haptic` references; on Capacitor it's a plugin + ~8 call sites (confirm/hit/crit/KO/invalid). **S**
5. **Touch path preview** — `InputController` builds move paths from `pointermove`, which never fires on tap: units teleport with no route shown, no confirm, ice/hazard tiles invisible until triggered. Adopt the node map's existing two-tap pattern with `grid.showPath()`. **S/M**

### Repeat-player efficiency
6. **Run-start friction** — 12–13 taps from Title to node for runs 2+; `DifficultySelectScene` hardcodes index 0 so Lunatic players re-navigate every run; `shownDialogueKeys` resets on `startRun` so act intros replay forever. Persist last difficulty, add a HomeBase quick-start, promote seen-dialogue to meta scope. **S**
7. **Title resume** — slot card already knows "Battle suspended"; surface it as the top Title button (`RESUME — Act 2, battle suspended`) instead of Continue→SlotPicker→Slot→HomeBase. **S**
8. **Deploy memory** — only the commander is preselected; the same ~6 units are re-picked ~10 times per run. Persist last deployment + "Same as last battle". Also no next-un-acted-unit control outside gamepad. **M**
9. **Shop comparison** — raw Mt/Hit/Crt with no delta vs the recipient's equipped weapon; no multi-sell; upgrade buy is 1 tap but refund requires confirm (backwards for respec-heavy players). **S/M**

### Feel and accessibility
10. **Level-up moment** — static panel, zero animation, no per-stat reveal, blocks until clicked, decoupled from the kill by checkpointing; in-battle promotion plays no sound. The FE level-up is the genre's signature dopamine beat. Staggered stat pops + tick sfx + auto-dismiss. **M**
11. **Audio gaps** — misses are fully silent (`if (audio && !event.miss)`); no sfx for procs, XP, promotion, status, victory/defeat; Dark tomes play fire sfx (`sfx_dark` loaded, never referenced); music never shifts (no enemy-phase/boss-half-health layer). **S/M**
12. **Accessibility layer** — settings has 3 rows. Missing: text size (all px, no rem — iOS Dynamic Type does nothing), colorblind-safe faction marking (blue/red/green by palette only; red-enemy/green-NPC is the classic deuteranopia collision and mistaking an NPC costs the recruit — add ▲/◆/● ring glyphs), left-hand mode (one `row-reverse`). **M**
13. **Per-enemy threat range + threat intensity** — danger zone is a single flat union at 0.25 alpha; no way to ask "what can that one reach", no 1/2/3+ intensity stepping. (Live play note: at small viewport the flat overlay is easy to miss entirely.) **S**
14. **Enemy-phase camera** — `ensureWorldVisible` only follows the player cursor; on a zoomed phone view the exchange that kills your unit can play off-screen. Pan to each acting enemy, behind a setting. **M**
15. **Teaching in play, not in library** — help is ~24 text pages; the tutorial spec's non-goals list (triangle, skills, promotion, meta) plus zero run-layer tutorial means the strategic game is learned by losing. Live play confirms: "Field Notes" modals front-load rules (the first names upgrades/difficulty/blessings before the player has seen any). `HintManager` (~18 one-time hints) is the right vehicle — add hints at first triangle advantage, first double, first promotion-eligible, first forge, first blessing; convert triangle/terrain pages to diagrams. **M/L**
16. **Node map as strategic overview** — tooltip gives type+objective only (no enemy count, level band, loot tier); no lookahead dimming to show which branches a choice forecloses; most icons are identical crossed swords (live play: path choice reads as geometry, not options). **M**

---

## Story & narrative

Context: the narrative layer is more built out than expected — 449 utterances, a real variant pipeline (`NarrativeDirector` with 8 `when` conditions, `DialogueCast` recasting, `BattleBeatsController`), a lore style guide with contract tests. The problems are **repetition, endgame coverage, and party attachment**, not absence. Boss/item lore is the strongest writing in the project — protect the voice.

### Data-only wave (~200 lines, zero code)
1. **Run-history variants on act transitions** — every act transition has exactly 7 commander variants; pick Edric and mid-run text is byte-identical forever. `minRunsCompleted`/`lastRunResult` keys exist and are used at exactly one site (`runStart`). 60–80 new lines makes run 1 / run 5 / run 20 read differently. **S**
2. **Cause-aware defeat epilogues** — `runComplete.defeat` never uses the already-recorded `lastRun.defeatedBy`; dying to The Emperor reads identically to dying to an act-1 bandit. `{lastFoe}` token substitution already exists. **S**
3. **Act 4 + secret act commander voices** — `act3_to_act4`, `act4_to_finalBoss`, `finalBoss_to_secretAct`, `secretAct_start` are plain arrays with no variants; the endgame, where veterans live, is the thinnest content. Also only 4 of 11 bosses have `preBattleReply`. **S**
4. **Recruit namePool hygiene** — a Sage named "Sage", one named "Grimoire", one named "Tomes"; Sniper "Bullseye"; cross-class duplicate names (Dante, Shade, Celeste, Tempest, Theron); only 6 names/class so repeats appear within one roster. Replace ~12 placeholders, de-dup, widen to 10–12/class. **S**
5. **Lord lore + motivation** — 0 of 7 lords have a `lore` field (every boss does); lord choice is answerable only by stat line. `CompendiumOverlay` already renders `lore` generically. **S**

### Code-assisted
6. **Anti-repeat shuffle-bag** — all flavor pools use memoryless `Math.random()`; with 4–6-line pools and ~12 nodes/act, players see the same line 2–3× per act. A ~20-line `pickFresh()` util + 4 call-site swaps makes the existing 449 lines feel twice as large — best content-per-effort ratio anywhere in this report. **S/M**
7. **Trait voice lines** — `traits.json`'s 15 traits are pure stat mods; recruit dialogue is 2 lines per class. `voiceLines: {recruit, farewell}` per trait (≈90 lines) multiplies combinatorially against 21 class pools — the cheapest route to caring about a random unit, and the closest roguelike-compatible analogue to FE supports. **M**
8. **Place names** — no location in the world is ever named (worldbuilding nouns are otherwise consistent: "the empire" ×21, "old kingdom" ×13). Name one region per act + one-line `lore` per map template, surfaced on the battle-intro banner. **M**
9. **Two-lord banter** — `DialogueCast` already resolves both lords and `showSequence` plays multi-entry arrays; the second lord almost never answers. Player-chosen pairings make this the one place combinatorial scenes are nearly free. **M**
10. **Roster-aware epilogues** — run-complete never names who died or who carried the run; `{topKiller}`/`{fallenLord}` tokens mirror the existing `{lastFoe}` implementation. **M**
11. **Sera's ledger (cross-run codex)** — ROADMAP already made the canon call (runs are Sera's timelines); boss memory variants exist, but nothing accumulates — run 30 says nothing run 3 didn't. Hades-codex-style HomeBase screen unlocking entries off existing story flags. **L**

**Cautions:** new `when` keys must be added to `KNOWN_WHEN_KEYS` (`NarrativeDirector.js:20-29`) — a contract test catches typos; bulk prose must respect `docs/lore-style-guide.md` limits enforced by `tests/LoreContent.test.js`.

---

## Suggested sequencing

1. **Pre-TestFlight-push (days):** UX #1 (effects flag split), #2 (battle speed), #3 (forecast), #4 (haptics) — these shape every tester's first impression.
2. **Data-only content wave (parallel, no engine risk):** Gameplay #1/#2/#3/#4 (dead skills, gold, act-4 loot, Normal affixes) + Story #1–#5 (~200 lines of dialogue/names/lore) + shuffle-bag.
3. **The two engine levers:** AI combat-math scoring (biggest tactical-depth win) and the shrine node (biggest replayability win).
4. **Feel pass:** level-up moment, audio gaps, repeat-player friction bundle (deploy memory, difficulty preselect, Title resume).
5. **Longer arcs:** accessibility settings pass, hint-driven teaching, node-map strategic view, trait voices + lord banter, Sera's ledger.

Cross-cutting synergies worth exploiting: dead skills (#G1) makes meta-progression rework (#G11) nearly free; gold sinks (#G2) and the stat-curve gap should be tuned as one system; trait voices (#S7) rides on the same traits the gameplay side may expand for lords (#G9).
