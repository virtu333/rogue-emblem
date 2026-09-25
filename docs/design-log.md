# Design Log

Running log of design discussions, decisions, and deferred ideas. Newest entries first.
Each entry links to specs in `docs/specs/` when an idea graduates to implementation.

---

## 2026-09-25 — Items, rewards and services art (built)

Every item, scroll, stone, blessing and upgrade has a pixel icon drawn in code from its
data, in a socket whose shape is its category and whose rim is its tier; items shown large
get a painted 96 px picture; blessings are tarot paintings; each service has its place.
Spec and deviations: [`specs/items-art.md`](specs/items-art.md); captures:
[`art-direction/items/production/`](art-direction/items/production/README.md).

**Decisions**
- Icons are generated, not painted: 302 icons render natively at 16/32/48 from
  `tools/art/icons/`, byte-stable (a unit test rebuilds and compares). One atlas per size,
  loaded as a CSS background only when a screen shows that size.
- Paintings are only where an item is large (the detail pane); never shrunk — a smaller
  slot shows the pixel icon at an integer scale. Scrolls, blessings and upgrades keep
  their pixel glyph even large: the glyph is the information.
- The reward reveal is presentation and plays once per battle: the reward record carries
  `revealed`, so a resume never replays it. On the list, the tap that skips it selects.
- Motion (forge sparks, candle flicker, card turn, the upgrade stamp) is CSS on DOM, off
  under Reduce motion (game setting or OS).
- The 37 legacy `icon_*` textures loaded at boot were unused: deleted.

**Deferred**
- The choice-screen redesign's reward cards and tarot blessing cards: wired on a preview
  merge, ported when the redesign lands (its `itemArtSlot` must move off `icon_*`).
- Canvas loot banner and HUD item names stay text.

---

## 2026-09-25 — Deeds & Epithets (built)

Units earn titles from what they do — "Elara, Who Held the Bridge" — instead of from
support conversations (rejected earlier). Spec and deviations:
[`specs/deeds-epithets.md`](specs/deeds-epithets.md); presentation:
[`art-direction/gameplay/deeds/`](art-direction/gameplay/deeds/README.md).

**Decisions**
- 19 deeds (9 battle, 10 run). Recorded from engine outcomes on the unit (`_battleDeeds`),
  so Vision rewind and suspend carry them; committed only at victory, before the save.
- Titles never touch `unit.name`; one set of display helpers composes them.
- Held the Line counts enemy phases held **in a row** (the looser "three in a battle"
  landed for almost every frontliner in the sim).
- Oaths: the greatest deed teaches, on a player promotion, a skill no scroll or
  curriculum offers (Pavise, Aegis, Lethality, Fury, Sure Shot, Renewal, Vigilance,
  Unyielding, Colossus, Critical +15, Pathfinder, Skirmisher, Drain, Duelist Stance,
  Discipline, Fiendish Blow). Skyward and Intimidate stay lord signatures.
- No compendium list of conditions: the help page explains the idea, the deeds are found.

**Sim (`npm run sim:deeds`, scripted agent)**
- Normal, 60 seeds: the scripted army loses within ~1.4 battles, so only early deeds
  show (Avenger 57% of runs — an ally falls and the killer is cut down — Held 2%,
  Would Not Fall 3%). Not representative of a player.
- Invincible, 40 seeds (a 2–3 unit army carries every kill and tanks every phase, so
  counts are inflated): 14.2 deeds / run, every unit titled; Held the Line, Bossbane,
  Weapon Sworn, Veteran ~100% of runs; Lord's Shield 88%; Red Harvest 98%; Greenwood 60%;
  Would Not Fall 55%; Keen Edge 30%; Deathblow 23%; Untouched, Giantslayer, the Last
  3–5%; Lantern, Tempo, Heights, Mire 0 (no healer/dancer/terrain play in the script).
  Median first award ≈ battle 10–15 of ~21.
- Reading: with a real 6–10 unit army sharing kills, the run-scope deeds land on carries
  and specialists; battle-scope deeds are the common first title. Revisit thresholds with
  playtest data (`tuning` and `min` values are data).

**Deferred**: hidden promoted classes unlocked by deeds (needs traced sprites v3); a
Deeds page in the victory records detail beyond the titled roster rows.

---

## 2026-09-25 — Traits v2: class-aware, additive, and spelled out per unit

**Trigger:** the user saw a boss-recruit Cavalier offered with Reckless ("+2 ATK /
-1 DEF *instead of the class perk*") and asked for a balance and design audit.
Playtest #30 had flagged Brawny as downside-only on a tome mage.

**Findings** (sim: `npm run sim:traits`; full table in `specs/traits-v2.md`):
- Reckless lost against the perk it replaced for 11 of 12 recruit classes
  (−3.1 duel win, −10.2 survival on average), and it was strictly worse than Frenzy and Focus.
- Keen, Clever, Lucky and Cornered were near-blank (+1 to +2). Brawny lowered survival
  everywhere. Lazy's +1 STR was dead on casters.
- Woodsman did nothing on the 43% of act-2/3 maps with no forest or mountain.
  Lone Wolf punished healers for healing.
- Reclass silently wiped every trait growth bonus, and promoted recruits were
  judged by their base class.

**Decisions:**
- **No trait replaces a class perk.** Mastery traits shift the threshold or
  multiply the perk (the new Slow Oath doubles it for 2 more battles). The UI names the
  perk and both numbers: "Wayfarer becomes +2 Atk, +2 Spd (from +1 Atk, +1 Spd)".
- **Tradeoffs must be playable.** Reckless becomes +3 Atk when it initiates and
  −2 Def when an enemy does, a positioning decision. Stalwart is its mirror;
  Lone Wolf and Shieldmate pull opposite ways on formation.
- **Rolling is class-aware.** Roles gate or weight every trait, and stat traits
  target the stat the class fights with (`ATTACK`). Result: no downside-only rolls,
  and healers draw Hungry and Shieldmate far more often.
- Lords never roll Reckless, Lone Wolf or Slow Oath: no lone-lord juggernaut, and
  legendaries stay special.
- Saves migrate once and only ever gain stats. Brawny and Clever become Kindled in the
  right stat (Brawny also refunds its speed growth), Lazy becomes Slow Oath at the
  same threshold, and Steady, Keen and Lucky are grandfathered.
- RNG cost is unchanged: one draw for the count plus one per pick.

Spec: `specs/traits-v2.md`. Captures: `art-direction/gameplay/traits-v2/`.

---

## 2026-09-25 — The Eclipse: the run clock made visible

**Graduated to spec and built:** `specs/eclipse.md` (captures:
`art-direction/gameplay/eclipse/`).

The rule from 2026-07-04 — *punish the clock, not the unit* — was enforced by a hidden
mechanism: two turns over par, XP and gold decayed silently. The Eclipse replaces it with
a clock the player can see and plan around. Every turn a battle runs past par−3 darkens
the Hollow Sun (shadow, 0–100, committed only at victory so rewind/suspend stay exact);
shadow takes the land ahead — outer lanes first — turning villages, chapels, recruits and
arenas into eclipsed elite battles. Darkness is also opportunity: eclipsed fights pay
elite spoils. Act bosses (−3) and church Kindle (−8 for gold, a real sink) lift it; the
run's phase (Pale → Waning → Umbral → Totality → Hollow) raises enemy levels and affixes.

Decisions:
- **Visible beats silent.** With the Eclipse on, late-pressure XP/gold decay is off;
  par, rating and rating gold stay; boss enrage stays (it is visible in the boss bar).
- **Transform, never delete.** A fallen node keeps its edges, so routing and boss
  reachability can never break; thresholds are computed from `runSeed` + node id, never
  stored, so saves need no migration and the node-map generator is byte-identical.
- **Tuned by sim, not by guess.** The spec's 10/10 (max gain, boss relief) left an A-rank
  player Pale all run; 6/3 hits the targets (A: Pale → Waning → ~Umbral; S keeps maps
  whole; C reaches Totality by Act III). `node sim/eclipse.js` reports shadow by act and
  what was lost "ahead" of the party.
- **Deferred:** eclipsed-node variety beyond rout (seize/escape conversions), an Eclipse
  meta upgrade (e.g. a slower sun), and dialogue that reacts to the phase.

---

## 2026-09-25 — Rewind to before any unit's action

Player request (high priority): Vision rewind must reach the moment before any player
unit's action, not only the turn start. Playtesting origin/main showed the capability
existed on paper but not in practice: the timeline labelled rows by the event *after*
which it restored (so undoing an action meant picking the row above it, and the first
action of a turn could only be undone via "Turn begins"), and the 512 KB history evicted
action snapshots first — in a late-game battle no rewind point survived past turn 2.

Decisions:
- **Rewind opens a picker of "Before <unit>'s <action>" points** (newest first, portrait,
  target, outcome chips, map preview, one tap to preview, one to spend). The full battle
  timeline stays under History.
- **Budget:** points after a keyframe are stored as exact structural patches; review-only
  previews are shed before any rewind point; this turn's points are shed last. All actions
  of the current and three previous turns now fit at late-game size (~375 KB).
- **Set-aside partial actions** (trade, re-equip) become their own point at the next
  activation, so "before Y" never undoes X's trade.
- **Lunatic keeps turn-start rewinds**, now as `difficulty.json` `rewindGranularity`
  (flip to `action` to change). Legacy-v1 battles gain action points and keep their
  reroll-on-rewind rule.

Spec: `specs/rewind-any-action.md`. Screenshots: `art-direction/gameplay/rewind/`.

---

## 2026-09-25 — Traced map sprites are the battlefield art; lords and bosses redrawn at map size

Traced sprites (owner: "they look great, make them the default") are now what every unit
wears on the battlefield — 335 sprites, six frames each, two atlas pages (24.8 MB
decoded); the rebuilt set is a dev comparison (`?spriteArt=rebuilt`). The weak spot of the
v2 study was the lords and bosses traced from ~128 px rebuilt art (scale 0.11–0.45, faces
collapsed). Decision: redraw those 19 at map size with the shared image client (style
board + an approved map sprite for scale + the unit's rebuilt sprite and portrait for
identity) and trace the redraws at 0.55–0.8. Kept: identity first — a take that matched
the portrait beat a take with a higher scale. The empire's iron swap no longer greys a
boss's own gold (Emperor, Knight Commander). Combat v2 fix found on the way: a rewind
mid-lunge left the striker off its tile (`CombatFxController.reset` now stops the lunge).
Spec: `specs/traced-sprites.md`; records: `art-direction/sprites-v3/`.

---

## 2026-09-25 — Portrait variety: every recruit their own face

iPhone playtest: two Fighters (Bram, Roderick) wore the identical bald, bearded portrait. Every
generic class had one face. Decisions:

- **Five people per class line, drawn in every class of the line** (175 player-side drawings,
  60 people; Falcon Knight and Wyvern Lord have ten via the cross promotions). Promotion keeps
  the person and changes the gear; we chose matched promoted drawings over mapping promoted
  units to their base face so the promotion rite shows *this* unit in the new class's armour.
- **Enemies get four faces per human class** (128) in the Empire's iron and crimson; monsters,
  lords and bosses keep theirs. All legacy generic/enemy defaults were remastered to the rebuilt
  quality so old and new sit in one set.
- **Stable, never random:** `unit.portraitVariant` is chosen once from a hash of run seed, name
  and class, skipping faces the army already has; genders follow the recruit name pools (a
  "Bram" is never drawn as a woman, a "Hedda" never as a man). Enemies hash their spawn identity.
  Legacy saves backfill on load. Nothing reads `Math.random` (the battle RNG).
- **No new texture memory at boot:** the atlases and baked textures still hold only the 94
  defaults; variants are display-sized figures the DOM decodes on demand and the canvas loads
  lazily (capped, released after battle).
- Text lists that named units (church, colosseum, shop choosers, records) now show the same face.

Spec: `specs/portrait-variety.md`. Art and pipeline: `art-direction/portraits-variety/`.

---

## 2026-09-25 — Attack flow: target first, weapon second; equipped weapon always first

From iPhone playtesting: picking a weapon before a target made every attack a two-menu
detour, and the forecast arrows (#8) were the part players actually used. Decisions:

- **Attack is target-first.** Highlight the range union over every usable weapon; the
  forecast opens on the equipped weapon (else the first in inventory order that can hit)
  and switches weapons and targets in place with live numbers. Each new target starts from
  the equipped weapon (FE convention). Cancel → same target; Back → action menu. After
  moving, tapping an enemy in reach opens its forecast directly.
- **Forecast weapon changes are previews**; only confirming equips. The bag never moves
  while cycling (stable list), Cancel restores weapon and exact order.
- **Weapon arts stay their own action** (bound to one weapon); **staves stay
  staff-then-target** when several are usable (ranges/targets/effects differ per staff)
  and staff use no longer counts as an equipment change.
- **Equipped weapon is always inventory slot 1** (FE). Normalized on load at run level
  (legacy saves read right immediately; deterministic, idempotent, RNG-free); battle
  checkpoints/rewind snapshots restore exactly (index-based state, exact-resume promise).
  Weapon-art selections carry the weapon uid to survive the reorder. Enemy AI bags are
  not reordered (AI determinism); every view displays equipped-first with an E mark.
- Found the #23/#35 projection gap: descriptive weapon specials and static accessories
  (Lightning, Soothing Stone) hid the HP/KO line. Now only HP-changing effects do.

Spec: `specs/attack-flow.md`. Screens: `art-direction/ux-polish/attack-flow/`.

---

## 2026-09-25 — UX polish pass from the iPhone landscape playtest

Phone playtest at ~844×390 surfaced six sore spots; all addressed, plus a mobile audit.
**Spec:** `specs/ux-polish-2026-09-25.md`; captures in `art-direction/ux-polish/`.

Decisions worth remembering:
- **The tutorial teaches by doing.** A persistent, non-modal coach states one goal at a time
  and always offers Leave; blocking notes are reserved for real lessons (terrain, forecast,
  resources). A fresh player can jump from the tutorial straight into a first run.
- **Explain, don't label.** "About …" buttons became a compact ⓘ plus press-and-hold on the
  card itself, with a hover preview on desktop; the gesture is taught once.
- **Danger must win against every grade and ground.** Fill + bright edge + hatch, stepping
  with the number of threats; its toggle is docked and never scrolls away.
- **Scrolling in the rail is a necessary evil — make it graceful.** One bounded region,
  fades and a "more ▾/▴" cue, primary action first, fixed controls outside the scroller.
- **Boss presence belongs on the boss.** World-space bar on the unit; words live off-map.
- **One rule for every band card.** Bands span the battlefield; busts break out above the
  band, sized by a shared cap; kickers never ellipsize; spoken lines read in full.
- **Save select is a ceremony, not a form.** Candle shrine over the Hollow Sun: who, where,
  how far, one action. An empty slot is an unlit candle that begins a run.

Deferred (audit residuals): Loom node card text can run past its panel at 844×390; the
"Tap to continue" hint on band cards sits a few px into the sidebar gutter; dev-route
"Save failed" toasts on NodeMap (no active slot) obscure captures.

---

## 2026-07-04 (later) — Next-phase content batch (accessories II, abilities II, staves, imbues II)

Idea dump for the wave after the current five PRs land. Not yet specced. Notes flag
implementation cost, philosophy fit, and collisions with the in-flight wave.

**Latitude (user, same day):** this list is inspiration, not a contract — at spec time, freely
rename, retune numbers, reshape concepts, cut entries that don't earn their complexity, and add
new ones that fit the themes (roster incentives, telegraphed counterplay, build-defining rare
finds). The design principles at the top of the 2026-07-04 entry are the actual constraints.

### Ruling: ally-relocation is staff-exclusive

Verified: no Warp/Rescue staves exist (8 staves total; the utility-staff niche is empty —
Sleep/Silence are enemy-only). Decision: **Warp and Rescue effects ship only as staves**, giving
healers a second high-leverage role (roster-incentive aligned). Self-teleport (Blink, wave 1
scroll) stays a skill. Definitions, FE-classic:
- **Rescue Staff** — pull a distant ally (within MAG-scaled range) to a tile adjacent to the caster.
- **Warp Staff** — send an adjacent ally to a passable tile within MAG-scaled range.
Both use the existing staff plumbing (uses, MAG 8/14/20 bonus uses, staff XP). The "Warp/Recall"
entries in the ability list below are superseded by this ruling.
**Graduated to spec:** `specs/warp-rescue-staves.md` (2026-07-04).

### Accessories, wave 2

| Item | Effect | Notes |
|---|---|---|
| Chronal Locket | Once per battle, survive a lethal hit at 1 HP | Guaranteed Miracle; Sera timeline flavor. Reuse the per-battle usage-counter pattern; interacts with the Miracle skill (must not double-fire — locket consumes first or last, pick and document). Cheap. |
| Shadow Cloak | Enemies won't target holder unless it's the only unit in range | Aggro-drop for fragile mages/healers. Needs an AI hook in `_scoreAttackTarget`; same plumbing as Provoke (aggro-up) below — build both flags at once. |
| Sunstone Band | Heal 20% max HP at start of each turn | Juggernaut enabler — accepted deliberately (roguelikes love a busted find). `turnStartEffects.healSelfPercent` already exists (Soothing Stone) so it's a data-only item. Adopt the suggested "only while no ally adjacent" gate: it creates clean anti-synergy with Phalanx Band/Mentor's Band, so the item declares an identity instead of stacking with formation play. Act3+, expensive. |
| Timeweaver's Pendant | Once per battle, rewind holder to its turn-start position and HP | Item-based personal Vision. Flag: needs a turn-start snapshot + restore path; Vision/BattleSuspend systems are precedent but this is the priciest item here — spec carefully (interaction with kills made, XP gained, statuses since turn start: rewind position/HP only, nothing else). |
| Aegis Mantle | Halve incoming ranged/magic damage | Hard counter to act3 mage stacks/siege; melee still punishes. New combat-mod key, clean Combat.js seam. |
| Berserker's Chain | +30 crit; holder cannot be healed by staves | Glass-cannon enabler with a real cost. Needs a heal-block check in staff targeting (HealController) + clear UI messaging on why the target is invalid. |
| Phantom Step | Ignore enemy zone of control | **Reinterpretation required: the game has no ZoC mechanic** — enemies block tiles outright. Implement as FE "Pass": holder may path *through* enemy-occupied tiles (still can't end on them). Grid/movement flag; moderate. |
| Oathkeeper's Ring | While above 75% HP: immune to crits and effective damage | `above75` condition + `negateEffectiveness` already exist; crit immunity is one new key. Cheap, great tension (protection drops when chipped). |
| Gluttonous Idol | +1 random stat per kill, battle-only | Snowball that resets per map so it can't warp the run. Battle-scoped buff container exists (timed-buff array) — needs a non-expiring-until-battle-end variant. |

### Utility abilities, wave 2 (same action framework as wave 1)

| Ability | Effect | Notes |
|---|---|---|
| Smoke Veil | Allies in radius untargetable until next player phase | Defensive turn-skip. Shares the untargetable-flag AI plumbing with Shadow Cloak. |
| Recall | Swap positions with any ally on the map | Cheap effect, huge ceiling; needs a map-wide ally-pick targeting mode (new but simple — highlight allies, not tiles). |
| ~~Warp~~ | — | Superseded: staff-exclusive (see ruling above). |
| Bulwark | Until next turn, allies adjacent to caster take −50% damage | Mobile fort; strongest once a Defend-style objective exists (future Part B) but fine standalone. Timed aura via the buff container. |
| Time Stop | All enemies skip movement next enemy phase (can still counter) | Movement-only neuter = literally mass `root` — the root status already means "may act, not move," so this is `applyCondition('root')` on all enemies. Trivial to build; price very high, single use. Panic button vs reinforcement dumps. |
| Meteor | Fixed AoE damage, 2-tile radius, anywhere on map | Flat damage (ignores MAG) so it doesn't warp mage builds. **Requires the pick-a-center AOE targeting UI wave 1 explicitly deferred** — this is the feature that justifies building it. |
| Provoke | Enemies in range must target caster next enemy phase | Taunt; pairs with Oathkeeper/Aegis tank. Same AI-scoring hook family as Shadow Cloak. |
| Second Wind | Refresh self (act again), no movement on second action | Self-Dance for ranged units. Watch balance: double Bolting/ballista turns; maybe once per battle and act3+. |

### Imbues, wave 2

| Imbue | Effect | Notes |
|---|---|---|
| Stormcharged | +1 max range, **counter-only** (melee counters at 1-2), halved damage on the extended-range counter | User-refined to defense-only; conditional range needs a counter-context check in Combat.js — the wave-1 combatMods vocabulary has `rangeBonus` but not counter-only. |
| Venomous (20% max HP) | Post-combat poison scaling off target max HP, ignores DEF | **Collision: wave-1 `venom` imbue is flat 5 poison.** Resolve by upgrading the wave-1 imbue to the % version rather than shipping both (percent version is the anti-boss/anti-juggernaut-mirror tool the player wields). |
| Reaver | Reverses weapon triangle | The `"Reverses weapon triangle"` special string is already parsed (Combat.js:535) — nearly free. |
| Lightweight | Weapon weight set to 0 | Trivial to implement; quietly top-tier (frees Silver/Killer doubling) — price accordingly. |
| Piercing | 20% chance per hit to ignore DEF (true damage) | Luna-proc as an imbue; reuse skill-proc infrastructure. |
| Soulbound | +1 might each time the wielder levels up (permanent for the run) | Signature-blade fantasy. Bind to the unit at application (`_soulboundTo`); might only accrues from the bound wielder's level-ups; needs a level-up hook + serialization. Medium. |

### Sequencing notes

- Wave 2 depends on wave 1 landing: abilities II builds on AbilityController; imbues II on
  ImbueSystem; accessories II will re-collide with the accessories count assertions.
- Shadow Cloak + Provoke + Smoke Veil share one AI-targeting-modifier system — spec them together.
- Meteor is the forcing function for pick-a-center targeting; bundle any other center-targeted
  effects into that PR.
- Staves (Warp/Rescue) are self-contained and could ship early in wave 2 — highest
  roster-incentive value per unit of work in this batch.

---

## 2026-07-04 — Early-game difficulty vs. Edric juggernaut

### Problem statement

Two symptoms, one cause:

1. The early game is hard with only Edric + Sera.
2. Funneling everything into Edric (the juggernaut line) is often the dominant strategy — and because the early game is hard with two units, it's also the *taught* strategy.

Heavy-handed anti-juggernaut effects (ambush spawns, % damage, RNG status on your best unit,
"targets your strongest unit" mechanics) are feelbads and are off the table.

### Design principles adopted

- **Pay secondary objectives in a different currency than kills.** Gold, items, recruits,
  and meta-currency reward a second flank without competing with the juggernaut's XP.
  If side objectives paid combat XP, the juggernaut would just collect them too.
- **Punish the clock, not the unit.** The turn-par system (XP/gold decay, boss enrage)
  is the sanctioned juggernaut tax. Effects that make solo play *slower* rather than
  *deadlier* funnel into a pressure system players already understand.
- **Distance-gate + turn-gate split objectives** so one unit mathematically cannot do
  everything; the opportunity cost is visible on the map, never a targeted nerf.
- **No effect that scales off the unit being strong** (e.g. % max-stat damage,
  "targets highest level"). Reads as the game cheating.
- **Make recruits attractive through utility the lord doesn't have** (fliers, thieves,
  tools) and through positive XP incentives — not by nerfing the lord.

### Decisions (graduating to specs / PRs)

| # | Idea | Notes | Spec |
|---|------|-------|------|
| 1 | **Village & bandit secondary objectives** | Classic FE: village/cache tile on the far side of the map; scripted bandit squad beelines for it; player reaching it first earns gold/item, bandits raze it. Optional, no punishment for ignoring. Builds on the Merchant Caravan micro-objective framework (PR #54). ~1 secondary objective per map max — avoid checklist fatigue. | `specs/village-bandit-objectives.md` |
| 2 | **Recruit-focused meta upgrades + lord upgrade cost rebalance** | New expensive recruit upgrades (flagship: recruits join with a forged weapon). Lord base-stat and growth upgrades become more expensive than the recruit equivalents, tilting long-term meta investment toward roster width. | `specs/recruit-meta-upgrades.md` |
| 3 | **Weapon imbues** | Rare weapon blessings that attach a special effect to a specific weapon (lifesteal, anti-armor, on-hit status chance, etc.). Delivered like whetstones / via forge-adjacent flow. Persist through save/load. | `specs/weapon-imbues.md` |
| 4 | **Legendary accessories (incl. EXP Share, Mercury Sandals)** | EXP Share: the *strong* unit equips it and gives up their accessory slot; adjacent lower-level allies siphon XP from the holder's combats. Turns juggernaut turns into roster development with a real cost. Mercury Sandals: infantry holder gains flying-type movement. Plus 2-4 more build-around legendaries. **Amendment (same day):** Mentor's Band must NOT be rare — as a catch-up enabler its value decays with lateness, and it's self-limiting, so it ships act2+ in loot AND shops at a moderate price; only the power items (Sandals/Phalanx/Pursuit) stay act3+ legendary-rare. | `specs/legendary-accessories.md` |
| 5 | **Utility abilities (single-use action skills)** | New battle actions alongside Fight/Item/Weapon Art/Wait: Teleport N tiles, Rally (temp party buff), AOE heal, AOE root. Weapon-art-like but utility-driven; charge-limited per battle or per run. Granted via rare loot (scroll-like items) and/or legendary accessories. | `specs/utility-abilities.md` |

### Liked, deferred (revisit later)

- **Full support/bond system** (adjacency-accrued ranks granting hit/avoid auras).
  Very FE-coded and the strongest long-term "roster > one unit" lever, but a large
  system (pair tracking, rank UI, balance). The EXP Share accessory (#4) is the
  cheap probe of the same design space — ship it first, see how adjacency play feels.
- **Mentor/assist XP** (adjacent lower-level ally gains trickle XP on lord kills)
  as a baseline mechanic. Overlaps with EXP Share; if EXP Share proves the loop,
  consider promoting a small baseline version later.
- **Wary AI** — enemies that can't hurt the juggernaut stop suiciding into him and
  instead hold chokes / guard objectives / drift toward squishies. Deep fix (the AI
  currently *feeds* the juggernaut) and reads as "smart enemies," not a nerf; slower
  solo clears get taxed by the existing par system. Needs careful AIController work +
  sim validation — schedule as its own investigation.
- **Rescue-recruits** (green unit escort → joins roster). Merchant Caravan (#54)
  already probes escort mechanics; extend to recruit rewards once villages land.
- **Hold-point bonus objectives** (hold a shrine N turns → blessing shard/discount).
- **Twin-pincer rout template** (two converging enemy clusters — geometry-driven
  anti-turtle pressure).
- **Underdog XP surfacing** — the +6-level underdog XP bonus already exists in
  `calculateCombatXP` but is invisible; add a "Underdog!" toast so it works as an
  incentive. Cheap; bundle into any XP-adjacent PR.
- **Raise Corrosive/Thorns/Rally affix weights**, and consider low-chance tier-1
  affixes on Normal in act 3+ (currently Normal = 0% — Normal players juggernaut
  hardest). Pure data tweak; wants sim validation.
- **Weapon-economy pressure on soloists** (occasional `sunderWeapon` enemies outside
  scripted boss waves). Taxes juggernauts through gold, not death.

### Explicitly rejected

- End-of-battle ratings scoring "distinct units used" — checklist feelbad.
- Untelegraphed ambush spawns, flat % damage, RNG sleep-lock on the player's carry,
  and anything that targets "your strongest unit" by rule.

### Existing systems these build on

- Turn par / late pressure: `data/turnBonus.json`, `TurnBonusCalculator.js` (XP/gold
  decay 2+ turns over par, boss enrage) — the sanctioned slow-play tax.
- XP diminishing returns: `UnitManager.calculateCombatXP` (steep decay at +4..+6
  level advantage, flat minimum at +7; underdog bonus capped at +6).
- Affix engine (`data/affixes.json`) — telegraphed anti-solo-tank effects already
  exist (Corrosive, Thorns, Rally).
- Micro-objective framework from Merchant Caravan (PR #54).
- Class Mastery + Trait system (PR #53) — new accessories/skills must compose with it.
