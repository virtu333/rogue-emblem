# NG+ (New Game Plus): draft spec

Status: draft, revised with Dave's answers 2026-10-14 (section 11). No code yet.
Thread: "NG+ option" in proj-rogue-emblem.

## 1. The ask (Dave)

- An expensive unlock: 1000 Valor + 1000 Supply, a dump for spare meta currency.
- Needs a Nightfall win.
- Opens NG+ runs on that save slot. Each NG+ run keeps the lords' skills and loot, plus 2 recruits
  (the units themselves, with their skills and loot), so the roster and its gear keep growing loop
  over loop.
- Related to endless mode; maybe extra difficulty modifiers alongside.

## 2. What exists today (grounding)

| Area | What the code does now | Why it matters for NG+ |
|---|---|---|
| Meta currencies | Valor and Supply per slot (`MetaProgressionManager`). A run pays `50/act + 15/battle + 100 on a win`, times the rung's `currencyMultiplier` (Nightfall 1.5). | A Nightfall win pays roughly 1000 of each. So 1000/1000 costs about one Nightfall win's income. All 82 upgrades together cost about 52k; Branching Threads (400 forever) is the only sink today. |
| Upgrades | Each upgrade costs one currency (its category's). Gates are `requires.milestones` (`beatHard` = Nightfall win). Power of Friendship / Commander choice already sit behind `beatHard` and are billed as "NG+ positioning" in `docs/choose-starting-lord-spec.md`. | A two-currency price is new: either a special Home Base item or a small schema addition. |
| Rungs | First Light / Dusk / Nightfall / Black Sun (`normal/dusk/hard/lunatic`). Unlocks in `DifficultyEngine.DIFFICULTY_UNLOCKS`. Nightfall and Black Sun already have `extendedLevelingEnabled` (units past promoted 20 gain 1 random stat per level). | Extended leveling is a ready-made "keep growing" track for veterans. |
| Endless mode | Does not exist. `difficulty_spec.md` lists "Endless (clear Lunatic)" and "Lunatic+ (random enemy skills)" as later scope, and ROADMAP item 23. The only "endless" in code is escape-map pursuit waves. | Free to define. |
| Run start | `RunManager.startRun` builds a fresh roster (`createInitialRoster`: commander + partner at their start level, meta bonuses applied), a fresh seed, fresh ledgers. | Veterans would be added here. |
| Recruit scaling | Recruits join at a level anchored on the commander (`RecruitScaling.resolveRecruitScalingTargets`). | If veteran lords kept level 20 promoted, every Act I recruit would join at promoted level 10+. |
| Deploy limits | Act I 3-4, Act II 4-5, Act III 5-7, Act IV+ 5-8. | Two lords + 2 veterans exactly fills Act I's 4 slots. |
| One-per-run weapons | `run.legendaryGrants` (LegendaryOwnership) keeps Legend and Epic weapons to one per run; signature weapons via Deadly Arsenal. | Carried legend/epic weapons must be written into the new run's ledger, and a carried signature weapon must stop Deadly Arsenal granting a second. |
| Victory payout | `_applySettledRewardsToMeta` pays once per run id (`settledRunIds`) and writes `victoryRecord.roster` (summaries, not whole units). | The carry pick must be settled exactly once, beside the payout. |
| Meta save format | `META_SAVE_FIELDS`; since #368 an unknown top-level meta key is kept and written back by older builds (both shipped app builds have this). | A new `ngPlus` meta key is safe on old builds. |
| Run save format | `engine/RunFormat.js`: a run holding a mechanic an older client would misplay carries a capability; older clients refuse it ("Update needed"), and it stays off the cloud while `CloudSync.CLOUD_SAFE_RUN_FORMAT` is 1 (the Descent works this way). | An NG+ run with enemy scaling or modifiers needs a capability, so it would be local-only. See section 8. |

## 3. Proposed shape (one paragraph)

Buy **NG+** at Home Base (1750 Valor + 1750 Supply, needs a Black Sun win). From then on, every
Nightfall or Black Sun **win** on that slot ends with a "Who rides again?" screen: you send
1 surviving lord and 2 surviving recruits to the **Barracks** (no cap; it grows every win).
A new NG+ run starts with your lords (a lord in the Barracks comes back with their kit) and up
to 2 recruit veterans from the Barracks. Veterans come back
as the same people (name, portrait, traits, Mark, growths, skills, gear, deeds) but **at a fresh
level**, so the early acts still work; their edge is their skills and kit. Each NG+ win raises
the slot's **NG+ cycle**, and enemies get a little tougher each cycle: this cycle ladder is the
endless mode. Optional **Omens** (opt-in modifiers built from existing difficulty levers) add
challenge on top.

## 4. Core rules

### 4.1 Unlock
- Home Base item "New Game+" in Lord Bonuses (or its own tab), shown as `???` until
  `beatLunatic` (a Black Sun win).
- Price 1750 Valor **and** 1750 Supply, paid in one save. A Black Sun win pays about 1350 of
  each (its 2x currency rate), so this is roughly 1.3 Black Sun wins. Never refundable (Home Base refund skips it).
- Stored as `purchasedUpgrades.ng_plus = 1` so the existing max-merge (cloud, adopt) keeps it.
- Data: `metaUpgrades.json` entry with `costs: [{ valor: 1000, supply: 1000 }]` (a new `costs`
  shape, validated) or a dedicated entry outside the upgrade list. Recommend the dedicated
  entry: it keeps the 82-upgrade schema and the refund/revision code untouched.

### 4.2 What carries

| Thing | Lords | Veterans (2 recruits) |
|---|---|---|
| The unit itself | Re-created each run as today (so new meta bonuses apply), then their kit is put back | Yes: name, portrait variant, traits, Mark, rolled growths, class line |
| Level and stats | Fresh start (as today) | Fresh start: base class of their line, level 1, stats rebuilt from class base + their own growths on the run seed, plus the normal recruit join bonus |
| Class | Start class | Base class of the line (a Hero comes back a Mercenary; promotes again with a Master Seal) |
| Skills | Every learned skill, equipped and benched, kept with the loadout | Same |
| Weapons, staves, consumables in the bag | Kept (forge, wear, imbue, uses kept) | Same |
| Accessory worn | Kept (bound skill kept) | Same |
| Deeds, epithets, Oaths | Kept | Kept |
| Weapon proficiencies | Kept (incl. masteries) | Kept |
| Convoy, gold, blessings, burdens, Vision, Rite, Eclipse | No | No |
| Stat boosters already drunk, Blood Covenant / Kingmaker stat gains | Lost with the level reset | Lost |

Rules around the edges:
- Legend and Epic weapons carried in are written into the new run's `legendaryGrants`, so they
  never drop twice in that run. A carried signature weapon counts as the lord's, so Deadly Arsenal
  does not hand over a second copy.
- A weapon a unit cannot wield after the class reset stays in its bag (it is wieldable again
  after promotion) or goes to the convoy if the bag is full. Proposal: stays in the bag.
- A lord's Barracks entry is keyed by lord name, so it follows the lord whether they start as
  commander, partner, or join as the third lord. Only lords picked into the Barracks keep kit.
- Items and units in the Barracks run through the same load migrations as a run save
  (`ITEM_RENAMES`, traits, skill slots, boon revisions) each time they are read, with a revision
  stamp per entry.

### 4.3 The Barracks
- Lives in the slot's meta (`meta.ngPlus.barracks`). Grows by up to 2 veterans per NG+-eligible
  recruits and 1 lord per win. No cap (the roster has none either); the player can release a
  veteran by hand.
- Run start (NG+ only): the run's lords who are in the Barracks come back with their kit; pick
  up to 2 recruit veterans to bring. The rest wait.
- Same unit twice: a veteran in play is "out" of the Barracks for that run; its record is
  replaced by its end-of-run copy on a win.

### 4.4 Win, loss, death
- Win: the "Who rides again?" screen. You pick 1 surviving lord and 2 surviving recruits to add
  (or refresh). Veterans you brought who survived, lords included, are updated to their
  end-of-run copy automatically and do not use a pick.
- Anyone from the Barracks who falls and is not revived by the end of the run leaves it for good,
  even on a loss. That includes lords: the lord stays playable as a fresh lord, but their kept
  skills and gear are gone until they are picked again. Everything else stays as it was.
- The pick is settled exactly once with the run payout (`settledRunIds`), and saved before the
  run save is cleared, so a refresh on that screen comes back to it.

### 4.5 First NG+ after unlocking
- Every Black Sun win (before or after buying) stores its survivors as a pending pick
  on the slot, so buying NG+ right after the win opens "Who rides again?" from that win, not a
  wait for the next one.
- A slot that won Nightfall before this ships has no stored win: its first NG+ run starts with
  lords only and fills the Barracks from its first win.

### 4.6 Which rungs
- NG+ runs on Black Sun only (Dave, 2026-10-18; it was Nightfall and Black Sun until then). A
  lower rung stays a normal run (no carry). Keeps NG+ an endgame mode and avoids farming an
  easier rung.

## 5. NG+ cycles (the endless ladder)

- `meta.ngPlus.cycle` starts at 0; each NG+ win raises it by 1. Shown as "NG+3" on the slot card,
  run records and the difficulty screen.
- Each cycle adds a small, data-driven step through the existing difficulty levers
  (`difficulty.json`-style table, `ngPlus.json`), for example per cycle:
  enemy level +1, `enemySkillChance` +5%, affix chance +3%, capped around cycle 5, then
  only the records grow. Exact numbers come from a sim (`sim:fullrun` with a carried-roster
  policy) before shipping.
- A loss does not lower the cycle. Optional: a "cycle select" to replay a lower cycle.

### Relation to endless mode
Two possible meanings:
1. **Between runs** (recommended): NG+ cycles are the endless ladder. Each loop you are stronger,
   enemies are a bit stronger, and Omens let you push further. Cheap: reuses every system.
2. **Within one run**: after the finale you keep going into Act VI, VII... with growing scaling.
   Needs new act content and post-cap scaling, a separate and much bigger project. Park it.

## 6. Omens (optional modifiers)

Opt-in at run start (NG+ runs only), Hades-Heat style. Each is one existing lever, so they are
cheap. A first set:

| Omen | Lever | Effect |
|---|---|---|
| Iron Tide | `enemyCountBonus` | +1 enemy per map |
| Honed Steel | `enemyEquipTierShift` | enemies carry one weapon tier higher |
| Marked Foes | affix gating | affix chance x2, +1 max per foe |
| Lean Purse | `goldMultiplier` | battle gold -30% |
| Dear Market | `shopPriceMultiplier` | shop prices +25% |
| Short Fuse | turn par / enrage | par -1, bosses enrage a turn earlier |
| Stone-hearted | `revivalStones` | +1 stone on every act boss |
| Long Night | Eclipse gain | shadow gain x1.5 |
| Thin Ranks | `deployLimitBonus` | deploy max -1 |
| Lunatic+ | enemy skills | every foe gets one random combat skill (the old "Lunatic+" idea) |

Reward: the run records the Omen total ("NG+3, Omens 7"), and the best total per rung is shown on
the slot. Optional extra reward: each 3 Omen points lets you bring one more veteran. Currency
bonuses are pointless once Home Base is bought out, so no currency reward.

## 7. UI touch points

- Home Base: the NG+ item; after purchase, a Barracks page (veterans, their kit, release).
- Difficulty select: on Black Sun with NG+ owned, an "NG+" toggle and the cycle.
- New run: "Bring veterans" picker (up to 2) and an Omen picker.
- Victory: "Who rides again?" (before Run Complete hands off to Home Base).
- Slot card and run records: "NG+N", Omen total.
- Roster: a veteran badge.

## 8. Save format (plain version)

- **Meta (`ngPlus` key: unlock, cycle, Barracks, pending pick, best Omens):** safe. Since #368,
  older builds keep meta keys they do not know and write them back, and both shipped app builds
  have that. The Barracks is a few KB per veteran; fine for local storage and the cloud meta row.
  Cloud merge rule: the meta payload is taken whole on fetch (as today), so the Barracks follows
  its payload; the adopt-merge takes the copy with the higher cycle.
- **NG+ run saves:** need a new run-format capability (`ngPlus`), because an older client would
  drop the cycle scaling and Omens and play the run easier. Effect, same as the Descent today:
  - an older app build cannot open an NG+ run ("Update needed"), and
  - **NG+ runs do not back up to the cloud** while `CLOUD_SAFE_RUN_FORMAT` is 1, for the whole
    run, not just Act V.
  - Fix for both: once every build in use carries the run-format guard, raise
    `CLOUD_SAFE_RUN_FORMAT` to 2. That would also bring Descent runs back to the cloud. Worth
    checking whether the two shipped app builds (TestFlight #51 / Play #21 and later) are the
    oldest in use.
- **Old saves:** nothing changes for a slot that never buys NG+.

## 9. Engineering outline

Pure modules (engine), each with tests:
- `engine/NgPlus.js`: unlock check, cycle, the pick (`settleCarryPick`), Barracks add/release,
  sanitizer.
- `engine/VeteranRebuild.js`: turns a stored unit into a fresh-level unit of its base class on a
  keyed seed stream (`veteran:<runSeed>:<uid>`), never `Math.random`, so the run's other
  streams are unchanged.
- `RunManager.startRun({ ngPlus })`: lords' kit applied after `createInitialRoster`, veterans
  added, ledgers primed, capability floor raised.
- `RunFormat`: `ngPlus` capability, `RUN_FORMAT_FIELDS` entries.
- Difficulty: cycle and Omens as a modifier layer read through `getDifficultyModifier`, so
  `getBattleParams` and the harness see them the same way.
- Sims: carried-roster policy for `sim:fullrun`; tune the cycle table and check Act I with 2
  veterans at fresh level plus Silver-tier gear.

Phases:
1. Unlock, Barracks, carry pick, NG+ run start with fresh-level veterans, capability.
2. Cycles and Omens.
3. Later: veterans in the Barracks can show up at recruit nodes mid-run; repeatable
   "Barracks wing" expansions as an ongoing currency sink; within-run endless.

## 11. Dave's answers (2026-10-14)

- Price 1750 Valor + 1750 Supply; unlock needs a Black Sun win (`beatLunatic`).
- Veterans return at a fresh level in their base class: agreed.
- Barracks grows by 2 recruits per win, **no cap**.
- Each "Who rides again?" keeps **1 lord** (not all surviving lords).
- Lords who fall leave the Barracks too.
- Omens as Slay the Spire ascensions / Hades Heat: agreed.

- NG+ runs allowed on Nightfall and Black Sun (player's choice; phase 2 scaling and Omens carry
  the challenge). Changed 2026-10-18: Black Sun only (§14).
- **Pacing rule (overrides the 4.2 table):** at each "Who rides again?", each picked character
  keeps **1 item and 1 skill or ability** of their choice from this run. Kept things build up
  over loops: kept skills cap at **10 skills and 5 abilities** per character (at the cap, a new
  one replaces one the player chooses); kept items live in the unit's bag up to its bag size.
  Everything else the character had this run (other skills, other gear) is gone. Skills a class
  teaches by level are not "kept": the unit relearns them by levelling, as always.
- Build approved: phase 1 started 2026-10-14.

## 10. Decisions for Dave (original questions, answered in section 11)

1. **Do veterans keep their levels?** Recommend no: fresh level, keep skills/gear/growths.
   Keeping level-20 promoted units breaks Act I, recruit scaling and loot, and would need much
   heavier enemy scaling.
2. **Does the carried group keep growing?** Recommend: the Barracks grows by 2 per win (cap 8),
   and each run you bring up to 2 of them (Act I fits 4). Alternative: all veterans start every
   run.
3. **Do veterans die for good?** Recommend yes: one who falls in an NG+ run leaves the Barracks.
4. **Endless:** recommend NG+ cycles as the endless ladder, plus Omens; in-run endless later.

Defaults taken without asking: Nightfall/Black Sun only; convoy, gold and blessings never carry;
pending pick from the last win so buying NG+ pays off immediately.

## 12. Phase 1 as built (2026-10-14)

- **State** (`engine/NgPlusState.js`, pure): `meta.ngPlus = { v: 1, rev, barracks, bring, pendingRide, wins }`, its own meta key (`META_SAVE_FIELDS`). A record is a lord's (`lord:<name>`) or a recruit's (`vet:<runId>:<uid>`, with base class, growths, traits, Mark, face) and holds `keptSkills` (with their slot kind) and `keptItems`. Every NG+ change adopts a newer copy on disk before it is checked and applied (`_commitNgPlus`), and the adopt-merge takes the newer write's state whole (`adoptNgPlusState`; a payload without the key keeps ours), so a release, a pick or a Bring made by another tab is never undone and a stale tab's change is checked against it (refused if it no longer holds; the unlock too, so a stale tab never buys NG+ a second time); the cloud fetch keeps one payload whole, as for every meta key. A kept item's uid has exactly one owner across the Barracks: a pick refuses an item another record keeps (`kept_by_other`, e.g. a heirloom traded to another veteran during the run; the pick screen lists it as theirs), normalization drops a later copy (another record's, or a second one on the same record), and a run start installs each uid once.
- **Unlock**: `meta.unlockNgPlus()` needs `beatLunatic`, takes 1750 Valor and 1750 Supply and sets `purchasedUpgrades.ng_plus = 1` in one write; not in `metaUpgrades.json`, so Home Base never refunds it.
- **Ride**: every standard win on Nightfall or Black Sun stores its survivors as `pendingRide` inside the run's payout write (`NgPlusRun.ngPlusRunEnd` → `meta.recordNgPlusRunEnd`, so a reload never records it twice), bought or not. Candidates: player units on the roster, never Gaspar or the merchant. Keepable skills leave out lord personals, class innates and the class line's curriculum (a sworn Oath is keepable and, the owner's call, comes back as an ordinary skill: a normal slot, benchable, the Oath slot left free for a new Oath); keepable items are bag, belt and worn accessory. The pick fills up to 1 lord and 2 recruits, each with 1 skill and 1 item; a full kind (10 skills, 5 abilities; 5 weapons, 3 consumables, 1 accessory) needs the one it replaces. It may be filled a few at a time: the ride remembers who was sent (`pendingRide.picked`) and stays open until every slot it can fill is filled, or the player commits an empty pick ("Done").
- **NG+ run**: the difficulty screen's "New Game+" switch (on by default; Nightfall and Black Sun, army upgrades on, NG+ bought) passes `meta.ngPlusRunStart()` to `startRun({ ngPlus })`. Every starting lord with a record takes their kit back; the brought recruits (up to 2, more with Barracks Wing) join at level 1 in their base class, rebuilt from saved growths and traits (a trait's stat change applied once, its growth change already in the growths; nothing rolled), with the run's recruit stat upgrades and the act's join bonus; a record's growths are **innate** (`growthsBasis: 'innate'`: the recruit's own roll, `unit.rolledGrowths`, stamped by `createRecruitUnit` and re-rolled by a reclass, plus its traits' growth changes; never Home Base upgrades, the rung's `growthBonusMultiplier`, blessings or a promotion's bonus), so the run it rides into adds its own recruit growth upgrades at its own rung's scale and its blessings reach it with the roster; a record saved before that (no `growthsBasis`: its growths as the unit ended that run, which cannot be taken apart) is a legacy veteran and comes back with exactly those growths, nothing added (`tests/NgPlusGrowthIdentity.test.js`); the meta save keeps a second copy of the marker under its own key, `ngPlusInnateGrowths` (record id, or `ride:<runId>:<ref>` for a pending candidate, to the growths it was written beside), because a build from before the marker rebuilds records through its own whitelist and drops `growthsBasis` but keeps an unknown meta key: a load or adopt marks again each record whose growths still match its entry (`NgPlusState.restoreInnateGrowths`; tested through that older build's own code, `tests/fixtures/legacy/pre437`, in `tests/NgPlusGrowthProvenanceCompat.test.js`); a third lord who joins later takes their kit too (`run.ngPlus.lordKits`). Kept Legend and Epic weapons go into `legendaryGrants`; a kept signature weapon replaces Deadly Arsenal's fresh copy.
- **Run end**: members (`run.ngPlus.members`, by record id and unit uid) who fell leave the Barracks; the commander a defeat took is set back one ride instead (`setBackIds` → `undoLastRide`: the latest ride's skill and item leave, what that ride replaced comes back; each record keeps a `rideLog` of up to 30 rides, and one left with nothing kept and no rides leaves), the owner's call, since every lost run ends with the commander down; on a win each member still standing keeps its kept items as they are now (an item used up or sold is gone), and `wins` counts NG+ wins.
- **Format**: `run.ngPlus` is the `ngPlus` run-format capability, so an NG+ run is local-only while `CLOUD_SAFE_RUN_FORMAT` is 1 and an older client refuses it.
- **UI**: Home Base's "NG+" tab (`ui/NgPlusPanel.js`, words in `ui/ngPlusModel.js`) shows once the slot has won Black Sun or bought NG+: the unlock, "Who rides again?" (its commit beside Begin Run; tapping a survivor opens their loadout without dropping anyone else's choices, a Remove button takes one out, a full slot's survivor can still be read), the Barracks (bring, release with a confirm). While a bought NG+'s pick is still open, Begin Run asks once ("Begin anyway"), since the next eligible win replaces it (`openRideWarning`). A lord's keeps stack win over win; kept items past the bag's room start the run in the convoy. The run result says when a ride waits.
- **Upgrades** (2026-10-15, Dave's "repeatable sinks"): two tiered buys on the NG+ tab, once NG+ is bought (`NG_PLUS_UPGRADES` in `NgPlusState.js`; `meta.buyNgPlusUpgrade(id)` checks and pays inside `_commitNgPlus`, so a stale tab buys the next tier, never the same one twice). Each tier costs the same Valor and Supply, 400 more than the last, never refunded. **Barracks Wing** (`purchasedUpgrades.ng_plus_barracks_wing`, 800/1200/1600/2000, 4 tiers): one more recruit veteran brought per tier (`bringLimitFor`: 2 up to 6, `MAX_BRING_LIMIT`). **Seer's Lantern** (`ng_plus_seers_lantern`, 600 up to 2200, 5 tiers): +1 Vision charge per tier in every run, NG+ or not, added after Home Base's Vision upgrades (`ngPlusVisionBonus` in `getActiveEffects`). Like the unlock, both keys sit in `purchasedUpgrades` outside `metaUpgrades.json`, so cloud and adopt max-merge them and Home Base never refunds them.
- Tests: `tests/NgPlus.test.js`, `tests/e2e/ng-plus.spec.js` (`mobile-ui` lane).

## 13. Echo and kept forges (2026-10-17)

Measured before this (`sim/ngplus.js`, 40 paired Black Sun seeds, a greedy player stacking the
commander lord and two recruits): after 5 loops an NG+ start won with no commander fall 20% of the
time against 2% for an ordinary start, almost all of it from the lords' kits (stacked forged
Silver weapons, up to +15 in Act I). Enemy levels alone did not cancel it; enemy stats did.
Write-up: project file `reviews/ascension-true-ending.md`.

- **Echo** (`engine/NgPlusEcho.js`): each Barracks member playing the run (a brought veteran, a
  lord whose kit came back, a third lord's on arrival) adds its record's `rides`. The sum is
  `run.ngPlus.echo` (saved; an NG+ run saved before has 0). `getBattleParams` adds the highest
  step of `difficulty.json` `ngPlus.echo` the Echo reaches: `enemyLevelBonus` (to
  `bossLevelBonus` too), `enemyStatBonus`, `enemyCountBonus`, and `bossStones` (one more Revival
  Stone on act bosses, the Emperor and the Lieutenant, never an elite captain:
  `withEchoBossStones`). Steps only ever add (`validateNgPlusConfig`, run by `validate:data`).
  The table climbs gently (the owner, 2026-10-17: no spike at one Echo): each step raises one
  lever by one, from Echo 3 (level +1) to Echo 41 (a second stone); at about loop 5 (Echo 14) it
  matches the measured step, levels +2 and stats +1. `tests/NgPlusEcho.test.js` holds the climb.
  Shown on the difficulty screen's NG+ switch (`ngPlusToggleLabel`: "New Game+: On · Echo N",
  from `echoPreview`: the brought veterans and the starting pair), each Barracks row (its
  record's own Echo), the Barracks' "Next NG+ run" line and the pause list (`NG+ · Echo N`).
- **Saves** (run-format capability `ngPlusEcho`, beside `ngPlus`): every NG+ run this build
  writes carries `run.ngPlus.echo` (0 included), so a client that plays NG+ but not Echo refuses
  it rather than dropping the Echo and never waking the sleeping forges. Migration: an NG+ save
  from before Echo has no `echo` and is read as Echo 0 with its kept forges awake, the rules it
  was made under; once this build saves it, it carries the capability.
- **Kept forges wake by act** (`engine/KeptForges.js`): a kept weapon placed at an NG+ start (or
  on a third lord's arrival) keeps only the act's awake limit of its forges (`ngPlus.keptForgeAwake`:
  Act I 2, II 4, III 6, IV 8, then all); the rest are taken off (`deforgeWeapon`, price kept) into
  `_dormantForges` and put back in order (`reapplyForgeStep`) as each act begins
  (`RunManager.advanceAct` → `wakeArmyForges`, bags and convoy). Every reader of a weapon sees the
  awake forges only. The run's own forges (shop, whetstone rewards, events, blessings) land on a
  kept weapon at once, sleeping forges or not (the owner, 2026-10-17: a reward forge must never
  wait for Act V): `_keptForgeBase` stamps how many forges the weapon rode in with, so the awake
  limit counts kept forges only and a wake slips them in under the run's forges (history: kept
  first, then the run's); `canForge`, `forgeStatBlock` and `getForgeCost` count sleeping forges
  toward the +15 and per-stat caps and the per-stat price, so a wake never fails.
- **Only some forges ride on** (the owner, 2026-10-17): the Barracks stores a weapon awake with
  the forges it rode in with plus at most `ngPlus.keptForgeCarry` (4) of the run's own, the
  earliest made (`KeptForges.carriedCopy`, read by `rideCandidates` and the run end's refresh);
  each one dropped takes its price with it. A weapon kept for the first time rode in with none.
  Grandfathered: a Barracks weapon placed before the stamp existed (a live run of an older
  build) keeps every forge it has, and every Barracks record keeps what it already stores.
  The roster card says "N kept forges still waking".
- Tests: `tests/NgPlusEcho.test.js`.

### 13.1 Waking at a shop (2026-10-18)

The owner's ask: a shop's smith can wake a kept weapon's sleeping forges early, up to the act's
awake limit per shop (Act I 2, II 4, III 6, IV 8). `engine/ShopForgeWake.js` (pure):

- **One wake** brings back the weapon's earliest sleeping forge (`wakeForges` to one more than
  are awake, so the run's own forges stay on top), at the price forging that stat would cost the
  weapon now (`FORGE_COSTS` at the stat's awake count, times the tier, the shop's discount
  applied; Smith's Mark's first-forge credit is for forges and repairs, not wakes). The weapon's
  price is unchanged: a sleeping forge was always counted in it.
- **The shop's count**: `shopWakeLimit(run)` reads `ngPlus.keptForgeAwake` for the act, shared by
  the whole army and apart from the shop's forge uses. It is saved with the shop
  (`shopStateByNodeId[node].wakesUsed`, written only once a wake is made; an older client drops it
  harmlessly), so leaving, re-entering or reloading never resets it. The final act wakes every
  forge at its start, so it has nothing left to wake.
- **The act start counts them**: a forge woken early is awake, so the next act start wakes only up
  to that act's limit (two shop wakes in Act I leave Act II's start two to wake).
- **Refused** (nothing spent): no forge asleep, Smith's Exile, the shop's wakes spent, gold short,
  or the weapon changed since the player reviewed it (`expectedDormant`). A kept weapon is forged,
  so it never wears.
- **Shop screen** (`ui/ShopMenu.js`): the Forge tab lists a weapon with sleeping forges even at
  the forge cap; its card says "N kept forges sleeping · L of X shop wakes left." beside a
  "Wake +5 Crit · 300 G" button with one confirm.
- Tests: `tests/ShopForgeWake.test.js`, `tests/ShopForgeWakeMenu.test.js`.

## 14. Black Sun only (2026-10-18)

Dave chose Black Sun only: NG+ runs and "Who rides again?" happen only on Black Sun, and
Nightfall plays as a normal run. `NgPlusState.NG_PLUS_RUNGS` is `['lunatic']`, the one rule
the difficulty screen's switch, `meta.ngPlusRunStart` and the ride (`ngPlusRunEnd`) read.
Nothing already saved is lost: a ride a Nightfall win stored before the change can still be
picked, and an NG+ run already under way on Nightfall plays and settles its Barracks as before
(its fallen leave, its win counts), but its win stores no new ride. Knots (Heat) stay on
Nightfall and Black Sun. `sim/ngplus.js` still harvests veterans from Nightfall runs: the
scripted player wins those far more often, and a harvest only reads the survivors
(`rideCandidates`), so it stays a fair stand-in for Black Sun veterans.

## 15. The Pack, and forge slots shown whole (2026-10-21)

Playtest feedback (Jeff, via Dave): every NG+ run he redid each veteran's gear by hand, and kept
weapons looked unfinished when they were not.

**The Pack** (`NgPlusState.packOf` / `setPack`, saved on the record as `pack`; the meta command
`setNgPlusPack`; the Barracks' veteran page, `ui/ngPlusModel.packView`). Set once per veteran,
used every NG+ run by `NgPlusRun.applyKit`:
- `wield`: the kept weapon it starts holding (equipped when it can wield it).
- `convoy`: kept bag items that start in the convoy (the bag if the convoy is full). They stay
  kept: a convoy copy is the same uid, read at the run's end like any other.
- `equip`: kept skills that start equipped (at most `MAX_SKILLS` skills and `MAX_ABILITIES`
  abilities, `pack_full` past that). Each benched one goes in, benching an equipped skill of its
  kind the Pack does not name (latest first); lord, class and Oath skills never move.
- A kept accessory is always worn, Pack or not: the one the unit started with goes to the pool.
Ids the record no longer keeps drop out on read. A build from before the Pack rebuilds records
through its own whitelist and drops `pack`, so the veteran sets out as before there: nothing is
lost but the preference.

**Forge slots** (`ForgeSystem.forgeSlots`, `forgeProgressText`, `forgeStatusLine`): the forge caps
count sleeping forges, so every forge view now counts them too: "Fully forged 15/15 · 13 asleep"
in the roster and item details, "Might is at its forge limit (5/5 · 2 asleep)." when a stone or
shop forge is refused, and the reward picker lists a full weapon with that reason instead of
hiding it (`LootRewardCommands.rewardWeaponBlock` / `rewardWeaponCandidates`).
