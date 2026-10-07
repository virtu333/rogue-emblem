# Event nodes, Phase 2

Status: **approved direction** (owner, 2026-10-06: "please continue"); this document turns
`docs/specs/event-nodes.md` §13 into a build plan. Phase 1 (the map, the engine, ten events,
the UI) is `event-nodes.md` §1–§12, §16–§17. Owner decisions that shape this phase:

- Event outcomes stay **hidden**; events may start battles.
- Don't add too many systems (2026-10-06): each item below either reuses an existing system
  (recruit NPCs, church vows, reinforcements, affixes, the arena) or is small.
- The Colosseum must limit total fights per visit: with many Vulneraries a single colosseum
  node pays out too much gold and XP (owner, 2026-10-06).

Build order: **2A** engine extensions → **2B** burdens, Cleanse, Dark Omen → **2C** the
colosseum cap (independent) → **2D** content and payoffs → **2E** UI. Each step is pure engine
first, tests with it; the UI only draws.

## 2A. Engine extensions (EventSystem / EventEffects / EventCommands / EventValidation)

### Pages (multi-step events)

An outcome may continue the event instead of ending it: `"next": "<pageId>"`. An event lists
`pages: { <pageId>: { text, choices: [...] } }`; its top-level `intro`/`choices` are page
`start`. The state records `page` and a `path` of `{ page, choiceId, outcomeId, results }`;
`eventView` shows the current page, with the earlier steps' results above it. Each step commits
and saves exactly like a Phase 1 choice (seed key `event:${runSeed}:${nodeId}:${page}:${choiceId}`; a page
an outcome loops back to names its visit from the second time on, `${page}#${n}`, so a revisit rolls
afresh and the first visit's key never changes: `EventSystem.pageSeedId`); a refresh reopens the current page. `leaveEvent` is allowed only on a page whose resolved
outcome has no `next` (or after an explicit `leave` choice). A page may carry its own
`requires` per choice.

**Counters**: an event may declare `counters: { torches: 3 }` (by rung: `countersByRung`), kept
on the state; effects `counter: { key, delta }`, requirements `counterAtLeast: { key, n }`.
Used by the Sunken Mine.

### `join` effect (a unit joins the army)

`{ "type": "join", "class": "<class>" | "classPool": [...], "name"?, "levelOffset"?, "trait"? }`.
Builds the unit with the same builder and rules as a recruit-node recruit (`RecruitNodeSystem`
/ `RecruitScaling`: Edric-anchored level, the act's class rules, a promised name never reused,
`getTakenUnitNames`, Marks when they exist), seeded from the event key. Never a lord, never an
enemy-only class. Lands in the roster (deploy limits are unchanged). Blocked like an item when
the army is at any cap that refuses a recruit.

### `contract` effect (a goal for the next battle)

`{ "type": "contract", "goal": "underPar" | "noLosses", "reward": [effects], "penalty": [effects] }`.
Stored as `run.contract` (one at a time; a second contract choice is blocked while one is
open). Settled in `RunManager.completeBattle` next to the burdens, for the **next battle
victory** (any battle node, boss included): `underPar` = `turnCount <= turnPar`; `noLosses` =
no player unit fell in that battle. Reward or penalty effects apply through the event effect
planner (plan then apply; an item with no room becomes a note). A defeat ends the run as
always. Shown as a chip like a burden ("Contract: win under par"), and on the victory band
("Contract kept: Gained 600 G" / "Contract broken: Burden: Debt"; what was not delivered is said too: "No room for Steel Lance", or "The reward could not be paid" when the settlement failed). A revert never touches it (settled
only at the victory commit).

### `routeEdit` effect (the Cartographer)

- `addRoad`: a new edge from the **current node** to a node in the next row that is not yet
  connected, chosen seeded among candidates that keep the map's rules (lane ±1, no crossing:
  reuse `NodeMapGenerator`'s crossing check, export it). No candidate → the outcome's
  `fallback`.
- `redraw`: one uncompleted, unlocked, non-boss, non-Ruins node in the next two rows reachable
  from here becomes `toType` (`shop` | `church` | `battle`), seeded; battle params are built
  with the generator's own functions under a seeded swap; Eclipse thresholds still key on the
  node id; a node that has already fallen is never redrawn.
- The node map stays valid: a test runs the map validator after every edit over many seeds.

### Roster tells

A choice may list `tells: [{ "when": { "class"|"classes"|"weaponType"|"trait"|"skill": … },
"line": "…{name}…", "reveals": "<outcomeId>" }]`. When a living roster unit matches (seeded
pick among matches, lords last), `eventView` adds the line under the choice, spoken by that
unit (`{name}`). A tell never shows a number; it tells the truth about the named outcome
(e.g. a Thief: "{name}: That's a tripwire.", the outcome `tripwire`). When the choice's outcome
is a **check**, a tell may instead say `"tilts": "pass"` and add `+0.1` to that check (shown
only as the line). Lines ≤ 90 chars, `docs/lore-style-guide.md` voice. The data validator
checks `reveals` names a real outcome of that choice.

### Story-flag reads

`requires.flag` / `notFlag` exist; add `flagAct` (the act a flag was set in, recorded as
`storyFlags[key] = { value, act }` for new writes; old saves' plain values still read) so
payoffs can require "set in an earlier act".

## 2B. Burdens, Cleanse, Dark Omen

### Three new burdens (data in `events.json` `burdens`)

- **Hunted** `{ battles: 2 }`: the next 2 battles get one extra reinforcement wave (a small
  group of the act's pool at the map's reinforcement edge on turn 3; through the existing
  reinforcement scheduler as an extra entry in the battle config, written when the battle is
  generated, so a resumed battle keeps it). Not on boss maps.
- **Sworn Enemy** `{}`: the act boss gains one tier-1 affix (the affix engine's own rules,
  seeded) until it falls; ends at the act's boss victory.
- **Wounded** `{ unitUid, stat, value: -2, battles: 3 }`: one unit fights at −2 to a stat for 3
  battles (a battle stat delta applied at battle start through `engine/BattleStatDeltas.js`, so
  previews, forecasts and the harness see it); ends early if the unit is healed at a church
  (Heal All counts).

Each burden decrements only at the victory commit; a revert never touches it.

### Cleanse: a third church vow

`CHURCH_VOWS` gains `cleanse`: when the run holds a burden, a church offers **Cleanse** (lift
one burden of the player's choice) beside Promotion and Blessing. It commits the church's vow
like the other two (`ChurchVow.commitChurchVow`). Debt is not cleansable ("the lender has
lawyers"): a church never offers to lift it. Never in the prologue, never at the Ruins.

### Dark Omen (a fallen event)

When the Eclipse takes an event node that has no committed choice, it stays an **event**
(`type: 'event'`, `node.eclipse` stamped, `node.darkOmen = true`) instead of becoming a battle,
if the event pool has a `dark` variant eligible there; otherwise it falls to a battle as in
Phase 1. A Dark Omen picks from events with a `dark` block: `{ intro, choices }` overrides
(harsher costs, better prizes; e.g. the Twin Altar's dark face is the only one left). The
route map shows it as an eclipsed event ("Dark Omen"). `EclipseSystem` change is small and
tested (thresholds, determinism, the current-node exemption).

## 2C. The colosseum: a cap per visit

`colosseum.json` `arena.maxFightsPerVisit` (proposal: First Light 5, Dusk 4, Nightfall 4,
Black Sun 3; by rung through the existing `difficulty` block) caps **total bouts at one
colosseum node**, on top of `maxFightsPerUnit` (3; Black Sun 2). The count lives on the run per
colosseum node (saved, like `shopStateByNodeId`), so leaving and re-entering or reloading
never resets it. The arena shows "Bouts left here: N"; at 0 the arena closes ("The crowd goes
home") and the mercenary board stays open. `ColosseumEngine.arenaEntryBlock` gives the reason.
Sims: `sim/colosseum.js` reports gold and XP per visit before/after.

## 2D. Content: eight events and the payoffs

Voice: `docs/lore-style-guide.md`. Same length limits as Phase 1. Every event needs a choice
that is always open (the validator holds it).

1. **The Sunken Mine** (`sunken_mine`, acts 2–4; pages, `torches` 3, Black Sun 2). Each level:
   *Take what's here and climb out* or *Go deeper* (spends a torch). Level 1 ore (a whetstone),
   level 2 the old pay chest (gold), level 3 the guardian (a battle, `afterVictory` a relic:
   a random accessory one tier up). Out of torches → *Feel your way out*: an ambush battle.
   Tell: a Thief or anyone with Pathfinder "{name}: This tunnel breathes. There's a way out."
2. **The Plague Village** (`plague_village`, acts 1–3): *Give your medicine* (consume up to 3
   Vulnerary uses; per use, the reward grows: 1 use → heal all 10%; 3 uses → `join` a Cleric
   or Troubadour "who owes you"); *Loot the empty houses* (gold, `burden` Ill Omen);
   *Walk around it* (nothing). Tell: a staff user "{name}: It isn't catching. It's the well."
3. **The Mercenary Contract** (`merc_contract`, acts 1–4): *Win the next fight under par*
   (`contract underPar`, reward gold, penalty Debt), *…with no one lost* (`noLosses`, reward a
   tier-up weapon, penalty Hunted), *Decline*.
4. **The Cartographer** (`cartographer`, acts 1–3): *Hire her as a guide* (`addRoad`), *Ask
   about the road ahead* (`redraw` to `shop`), *Rob her* (gold, flag `robbed_cartographer`).
5. **The Chained Shelf** (`chained_shelf`, acts 2–4, requires a magic user): *Read it*
   (target a magic user: learn `fiendish_blow` or another dark-tone skill from a pool, `stat`
   −3 max HP), *Burn it* (shadow −4), *Sell it to a scholar* (gold).
6. **The Herald of the Hollow Sun** (`hollow_herald`, acts 2–4, `phaseAtLeast: umbral`):
   *Feed the dark* (target: +2 to the unit's best stat, shadow +8), *Break the rite* (battle;
   `afterVictory` shadow −8), *Listen* (flag `heard_herald`; Black Sun only: a memory line in
   the Entity finale rally, `dialogue.json` `finaleRally`).
7. **The Wandering Smith** (`wandering_smith`, acts 1–4): *Mend* (target: every worn step on
   the unit's weapons repaired, gold cost), *Temper* (target: the equipped weapon gains one
   free forge step if it can be forged; 30% (Nightfall 40%) it instead gains one wear step:
   "Too hot."), *Leave*.
8. **The Turncoat** (`turncoat`, acts 2–3): a deserter asks to join. *Take him in* (`join` a
   level-appropriate Mercenary/Fighter/Archer; Black Sun 35%: he is a spy, `burden` Hunted),
   *Send him off*.

**Payoffs** (events that require Phase 1 flags, set in an earlier act):

- `spared_deserters` → **Old Faces** (`old_faces`, acts 2–3): the deserters you spared stand
  in the next battle as a green **recruit NPC** (the existing recruit-node NPC and Talk; no new
  AI), "We said we wouldn't forget." Built as a battle `effect` with `npc: { join on Talk }`
  reusing `RecruitNpc` / `BattleRecruits`.
- `reported_deserters` → **The Deserters' Revenge** (`deserters_revenge`, acts 2–3): an ambush
  battle, `afterVictory` good gold.
- `robbed_lender` → **The Collectors** (`collectors`, acts 2–4): pay 2× (gold) or fight an elite
  battle.
- `robbed_cartographer` → **A Bad Map** (`bad_map`): a `redraw` that turns a node ahead into a
  battle, or pay her.

Black Sun "lying strangers" are content, not a system: `weightByRung.lunatic` makes a few
friendly outcomes traps (the Turncoat spy, a Twin Altar Dawn that answers with an Ill Omen),
always with an honest hint in the text.

## 2E. UI

EventMenu gains: the page trail (earlier steps' results, collapsed), the current page's
choices; tells under their choice (the speaker's face + line); the contract chip and victory
band lines; Cleanse in ChurchMenu's vow picker (a burden picker); the colosseum's "Bouts left
here"; the Dark Omen medal on the route map. Same platform rules as Phase 1 (§10, §17):
640×480, phone landscape and portrait, focus, ESC, design tokens, e2e in a lane, screenshots
reviewed and not committed.

## Tests (each step)

Failure modes first; outcomes on run state; values by hand; plant a bug per new file. Notable:
pages survive a refresh at every step and never re-roll; counters by rung; `join` respects
taken names and caps; `routeEdit` keeps every map valid over many seeds and never edits a
fallen, completed or locked node; contracts settle once, never on revert, for the next victory
only; tells only for a matching living unit and only true; Hunted's wave survives a resume;
Wounded shows in previews and the harness; Cleanse commits the vow; a Dark Omen keeps
`type: 'event'`; the colosseum cap survives leave/re-enter/reload; every new event resolves
through every choice (the Phase 1 every-choice table extends).

## 2A as built (2026-10-06)

The engine half of §2A is in: pure engine, schema, validator and tests; no UI, no new event
content (test fixtures only), no burdens/Cleanse/Dark Omen (2B), no colosseum (2C). The command
API and view are documented in the header of `src/engine/EventCommands.js` (the UI agent reads
that and the shapes below). What the build settled or changed against the text above:

**New modules.** `RouteEdit.js` (routeEdit, the node-map validity checker), `EventJoin.js`,
`EventTells.js`, `Contracts.js` (the record, the verdict, the words), `ContractSettlement.js`
(`settleContract`; kept apart because settling needs the effect planner, which itself reads the
contract record: no import cycle). Shared builders exported from `NodeMapGenerator.js`:
`rebuildNodeAs`, `edgeCrosses`, `rowsAreUnconstrained`; `generateNodeMap` now calls them, and a
fingerprint over 2000 generated maps (5 acts x 400 seeds, every option on) is byte-identical
before and after. `RUN_FIELDS` / `snapshotRunState` / `restoreRunState` moved into
`EventEffects.js` (the contract settlement shares them) and gained `contract`,
`usedRecruitNames` and `nextUnitUid`.

**Pages.** An outcome with `next` moves the event to that page *at once* (there is no separate
advance command): the step goes to `state.path`, `state.page` is the new page and the top-level
`choiceId`... are cleared, so a refresh reopens the new page's choices and the earlier steps stay
above it as the view's `trail`. `chooseEventOption` returns `next`. "An explicit leave choice" is
simply a choice whose outcomes carry no `next`; `leaveEvent` itself needs a resolved choice on the
current page. The first page (`start`) keeps its Phase 1 seed key, later pages put the page in the
key (`EventSystem.choiceSeedKey`), so no Phase 1 event rolls differently. A page, path or counter
is omitted from the saved state when it is the default, so a record written before pages loads
and displays as it was written (tested with a literal Phase 1 record). New: an optional `page`
option on `chooseEventOption` (the view's `page`): a second tap on a choice that exists on the next
page too is refused ("That page has moved on.") instead of being taken as a step of the new page;
the UI should pass it. An outcome that starts a battle may not also have `next` (validator
refuses; the engine ignores it). Validator: every page is reachable and has a guaranteed way out
(an always-available choice whose every outcome ends the event or leads to a page that has one),
so a loop can never trap the player. `eventLog` entries of later pages carry `page`.

**Counters.** `counters: { torches: 3 }`, `countersByRung: { torches: { lunatic: 2 } }` (a byRung
table *per counter*, "from its rung up"), optional `counterLabels` (default: the key in words).
The effect is `{ type: 'counter', key, delta }` (floors at 0; the record carries the delta actually
applied), the requirement `counterAtLeast: { key, n }` (event-level use is refused: no counters
before the pick). Counters start when the event is picked, so the rung is fixed at arrival.

**join.** Built by `RecruitNodeSystem.buildRecruitNodeUnit` (the recruit-node builder: Edric-anchored
level, seasoned growths, a trait, join bonus, meta gear, the promotion roll for a promoted class)
on a stream of its own, with the lords list emptied so the lord roll can never fire. A class is
valid when it exists, is not enemy-only or a boss, is in *some* act's recruit pool (which leaves out
lord classes, undead and dragons) and, if promoted, is in the pool of *every* act the choice can
play in (a Hero in an Act II event is refused by the validator and filtered at runtime). A failed
promotion roll joins the base class, exactly as a recruit node does. `trait` restricts the trait
roll to that trait. Names avoid `getTakenUnitNames` plus earlier joins of the same outcome. **No
roster cap exists** (Expanded Ranks retired it), so a join is never blocked.

**contract.** One at a time: `eventChoiceBlock` refuses a choice that can open one while one is open
(not a `requires` key, so no data can forget it); such a choice counts as conditional for the
always-available rule. Settled in `completeBattle` right after the burdens are committed (so a
reward lands on the units and gold the commit built, and a penalty Debt starts with the next
victory). `underPar` is `turnCount <= turnPar`; **a battle with no par keeps the contract** (the
goal could not be seen; a penalty must not land for something unmeasurable; the settlement says
`noPar`). `noLosses` counts everyone `completeBattle` finds unmatched among the entering roster and
the recruits who joined mid-battle (`newlyFallen`). Reward and penalty may hold `gold, item, hp
(not target), shadow, vision, blessing, burden, flag, stat (lowestLevel)`; they run through the
effect planner leniently (an item with no room is a note) in a seeded swap; a plan failure or an
apply throw leaves the run as before the terms and the contract is still cleared. A `shadow` term does
not apply the Eclipse's falls itself (its record carries `fell: []`): `completeBattle` applies them right
after the node completes, so `lastEclipseCommit.fell` lists every knot the victory and the contract took. A contract
persists across acts, is saved/sanitized (`normalizeContract`), `run.lastContractSettlement` is not
saved (like the burden record). Validator: a contract may not share a choice with a battle and may
not ride in a battle's spoils.

**routeEdit.** Outcome-level only, and the outcome must carry a `fallback` (the road may have
nothing to change; the fallback may not itself edit or teach); one per outcome. `addRoad` and
`redraw` choose among candidates that keep the generator's rules: lanes within ±1 and no crossing
(relaxed next to a single-node row, as the generator does), plus its service pacing (no more than
two non-combat nodes in a row, none beside its own type). A redraw never touches the start, boss,
Ruins, completed, current, encounter-locked, eclipsed, recruit, arena, event, ambush or
battle-config nodes, nor anything not reachable within two rows from here. If a node fell between
planning and applying (a shadow effect earlier in the same outcome) the edit becomes a note.
`checkNodeMapValidity(nodeMap)` is the invariant checker (also run on 5 x 150 generated maps).

**Roster tells.** `tells: [{ when: { class | classes | weaponType | trait | skill }, line, reveals |
tilts }]`, exactly one `when` key, exactly one of `reveals` / `tilts`. `weaponType` means a proficiency,
`skill` includes the bench. The speaker is a seeded pick among living matches, lords only when no one
else matches. The view gives `{ speaker: { uid, name }, line }` only while choosing (never the outcome,
never a number). **A `reveals` tell is shown only when it is true**: the outcome of a weighted choice is
fixed by the run seed before the choice is made, so the tell appears only when the outcome it names is
the one this run will roll (`EventSystem.selectOutcome`, the same call the commit makes), and the choice
then rolls exactly that. The absence of a tell therefore says "not that one" (a Thief aboard and no
tripwire line: no tripwire). Rejected reading: showing every matching tell whatever the roll, which says
"that is a tripwire" on a road with none. `reveals` is for weighted choices only (the validator refuses it
on a check: a check's outcome depends on who is chosen) and must name an outcome with a positive weight.
`tilts: 'pass'` (check choices only, +0.1 once per choice before the min/max clamp) is the check's tell;
it shows whenever its speaker is aboard and only the line is seen. Validator: lines <= 90 and only
`{name}`, one `tilts` per choice.

**Flags.** New writes are `{ value, act }`; setting the same value again keeps the first act; plain
values from old saves still read. `requires.flagAct` (beside `flag`): `'earlier'` (set in an act
before this one; a flag from a save that recorded no act counts as earlier), `'current'`, or an act
id. Phase 1 tests that compared `storyFlags` to plain values now read through `flagValue`.

**Sims.** `tests/sim/RunPolicies.js`: `chooseEventPlan` works per page (first open non-battle
choice; when any counter is at 1 or less it prefers a choice that ends the event) and
`playEventChoices` walks a whole event; the run driver and `sim/eclipse.js` use it; the driver counts
`contractsKept` / `contractsBroken`.

## 2B as built (2026-10-06)

Burdens, Cleanse and the Dark Omen are in, with data (`data/events.json`, `data/eclipse.json`),
schemas, validator, engine, the church menu and the route-map and event-page wording. What the
build settled or changed against the text of §2B:

**Where a burden is read.** `RunManager.getBattleParams(node)` is the one place a battle learns
about the run's burdens, so the scene, the previews and the headless harness read one list; a key is
added only when a burden applies (an unburdened run's params are unchanged):
`huntedWave` ({ turn, count: [min, max], xpMultiplier }, non-boss only), `swornEnemy` ({ seed:
`eclipseHash("sworn:<runSeed>:<nodeId>")` }, boss nodes only) and `battleDebuffs` ([{ unitUid,
stat, value, source: 'wounded' }]). Settlement is `burdenEffectsOnVictory(run, { gold, shadowGain,
battle: { boss, hunted } })` in `completeBattle`; the record gains `hunted`, `sworn` and `wounded`
parts (`settlementLines`: "Hunted (passed)", "Sworn Enemy falls", "Hale's wound mends").

**Hunted** `{ id, battles, wave }`. `data` burdens `hunted`: 2 battles, wave `{ turn: 3, count: [2, 2],
xpMultiplier: 0.5 }`; First Light `[1, 2]`, Black Sun `[2, 3]` (`onRung`; resolved once, stored on the
record). `generateBattle` writes the wave as `reinforcements.hunted` (`engine/HuntedWave.js`
`withHuntedWave`, no random draw: the map and the next draw of `Math.random` are exactly those of an
unhunted battle) at the template's `spawnEdges`, else the rout ladder's `front`, else the edge on the
enemy's side (`enemySideEdge`: nearest the enemy spawns' centre, farthest from the army's; ties left,
right, top, bottom). `ReinforcementScheduler` rolls it on its absolute turn (no difficulty offset, no
jitter, after every other wave of the turn so those draw as before): a new wave type `hunted`, **par-neutral**
(a price must not buy a turn; the spawn also carries `parNeutral`), copying the map's own foes like any
procedural arrival, at half XP and gold. A victory counts one down only when the battle carried the wave:
the locked map says so (`isHuntedBattle`); with no locked map (the sims, unit tests) every non-boss victory
counts. A boss victory never does. A battle that ends before turn 3 still counts; the wave simply never came. This is intended: clearing the map before the wave arrives is the counterplay to Hunted, not a loophole to close.

**Sworn Enemy** `{ id }`. `AffixEngine.assignSwornAffix(enemySpawns, { affixConfig, difficultyId, random })`:
the first boss spawn that is not the Entity gains one tier-1 affix chosen by `affixes.json` weight from
`createSeededRng(seed)`; the rung's `excludedAffixes`, the class exclusions and the mutual exclusions with
what the boss carries hold; the act's own gating (`excludedActs`, chance) does not (an oath is not a roll).
Ends at the first boss-node victory of any act. The Entity keeps its curated affixes and takes none.

**Wounded** `{ id, unitUid, unitName, stat, value, battles }`. Data: -2, 3 battles (First Light 2). Event
effect `{ type: 'burden', id: 'wounded', params: { scope: 'target' | 'randomUnit', stat: <STR MAG SKL SPD DEF
RES LCK> | 'random' | 'attack', value?, battles? } }`: unit and stat are fixed at planning (a seeded pick for
`randomUnit` / `random`; `attack` is MAG for a caster, else STR). **One wound at a time**: a new one replaces
the old (a "never stacks" rule that fits a per-unit record; the alternative was a list and a picker). The
debuff is a battle stat delta (`applyBattleStartDebuffs`, by unit uid, never by name; the floor is 0 and the
delta taken back exactly at battle end) applied once at a fresh start in `BattleScene.beginBattle` and
`HeadlessBattle`, so the first forecast shows it; a resumed battle's units carry it already. It **counts down
at every victory, deployed or not** (benching a wounded unit avoids the penalty but not the clock). It ends
early when a church's Heal all (and the sanctuary's Rest) reaches the unit (`healRosterAtChurch`, also the
message "All units healed. Hale's wound mends."), and when its unit is no longer in the roster after a victory
(`pruneGoneWounds`). The act-change heal does not mend it. `tests/sim/RunSimulationDriver` now takes battle
deltas back before the commit, as `PostCombatController` does (Intimidate's used to persist in the sims).

**Cleanse.** `CHURCH_VOWS = ['promote', 'blessing', 'cleanse']`. `ChurchVow.churchOffersCleanse` (a church
node, not the Ruins, not the prologue, at least one burden a church can lift), `churchCleanseBlock`,
`cleanseAtChurch(run, nodeId, burdenId)`: removes that burden (`Burdens.removeBurden`), commits the vow, free.
Debt (`UNCLEANSABLE_BURDENS`) is refused by the engine as well as hidden by the menu ("The lender has
lawyers."). The vow lines now read "...gives no blessing and lifts no burden." (Promotion), "...promotes no one
and lifts no burden." (Blessing) and "Your vow here was Cleansing: this altar promotes no one and gives no
blessing." `ChurchMenu.renderCleanse`: a "Cleanse · Free" section under the blessings, one button per burden
("Ill Omen · 2 left") behind a confirmation, Debt's refusal line when the run holds Debt, greyed with the vow's
reason once another vow is made here, absent after a Cleansing. Saves: `churchVowByNodeId` may now hold
`cleanse`; a save with only the two older vows loads as written (`tests/EventBurdensPhase2.test.js`, "saves").

**Dark Omen.** `EclipseSystem.eclipseNode` takes a `darkOmen(node)` question (RunManager passes
`hasDarkOmen(run, node)`, asked once as the node falls, true only when an event with a `dark` face is eligible
there now): a yes keeps `type: 'event'`, stamps `node.eclipse` (`fromType: 'event'`, label `falls.event.darkLabel`
"Dark Omen") and sets `node.darkOmen = true`; otherwise the Phase 1 fall to an eclipsed battle ("Swallowed
road"). Thresholds, determinism and the current-node exemption are unchanged (the fall is the same knot, the
node simply stays an event); no draw is made for the decision. A `dark` block is `{ intro, choices, pages? }`;
`EventSystem.eventFace(event, state)` lays it over the event (title, requires, counters stay the event's), and
the validator checks it exactly like the plain face (an always-available choice, a way out, reachable pages).
`arriveAtEvent` on a `darkOmen` node draws among eligible events that have a dark face (`pickEvent(..., { dark:
true })`, same seeded keys) and records `state.dark = true`; if none is eligible any more the fallback's dark
face stands in, so a Dark Omen can always be played. `eventView` carries `dark`. Five events ship a dark face:
the Twin Altar (the dawn face has fallen; Kneel gives a tier 3 blessing, a Vision, an Ill Omen at +2 shadow and
+4 shadow, Take the offerings 300 + 150 per act and +6 shadow), the Toll Bridge (a strongbox or a fight, or the
ledger for a Vision and the Hunted burden), the Wounded Courier (read the dispatch for a Vision and a Sworn
Enemy, or burn it for -5 shadow), the Drill Yard (+2 SKL or SPD for the lowest-level unit, 25% damage and a
Wounded) and A Quiet Road (the fallback). **UI:** `fallToastText` says "The dark twists the omen." for a lone
Omen; the route map labels it "Dark Omen" (the existing Dark Omen medal, frame 10; the short label under the
medal is OMEN), the info card reads DARK OMEN with its own line (and "You chose: ..." once walked), and the event
page shows the kicker DARK OMEN over the event's own painting, dimmed (`.ev-menu.is-dark-omen`; no new art). A
Phase 1 style fall to a battle still wears the Dark Omen medal (`is-dark-omen` keys on `fromType`); only the label
and card differ.

**Deviations and notes.** (1) Hunted is par-neutral and half-reward (the spec was silent). (2) The sanctuary's
Rest also mends a wound (it heals everyone, and `healRosterAtChurch` is shared). (3) A wound ticks whether or not
its unit fought (see above). (4) Wounded is one record; a fresh wound replaces the old. (5) The Entity takes no
Sworn affix. (6) The `dark` face has no `requires` of its own: eligibility is the event's. (7) The Phase 1 test
that an unvisited event falls to a Swallowed road now strips the dark faces first (with them it stays an Omen).
Tests: `EventBurdensPhase2`, `EventCleanse`, `EventDarkOmen`, `EventPhase2BData`, `EventBurdenUiPhase2`,
`EventDarkPage`, `BattleSceneWounded`.

## 2D as built (2026-10-06)

The content half: the eight events and four payoffs of §2D are in `data/events.json` (22 events
with Phase 1's ten and the fallback), with the small engine effects they needed, their tests and
the sims. No UI was written (2E owns `EventMenu`, `eventMenu.css`, `ChurchMenu` and the words of
the new result records, below) and no painting (the page wears its plain band: art is
`docs/specs/event-art.md`; `tests/EventArt.test.js` `PAINTING_PENDING` lists the twelve and fails
the day one gets art without leaving the list).

### New engine vocabulary

Everything is planned against the ledger and applied all or nothing like the effects before it,
seeded from the choice's key (`event:${runSeed}:${nodeId}:[${page}:]${choiceId}:${phase}${i}:${label}`),
validated by `EventValidation` and listed in the schema.

- **`item` with `pool: { kind: 'accessory', tierOffset }`.** One accessory from the loot table of the
  act `tierOffset` tiers up (`act1` + 1 = `lootTables.act2.accessories`; the top table, Act IV's, caps
  it), sorted by name and picked from the seeded stream. It goes to `run.accessories` (the army's
  accessory pool, with a uid) and **needs no room**, so `choiceMayGrantItem` ignores it: a choice that
  grants only an accessory is still "always available". Record `{ kind:'item', name, tier:null,
  itemType:'Accessory', unit:null, toConvoy:false, pooled:true, worn:[] }`. Validator: `tierOffset` 0-3,
  no `weaponTypes`, `wear` or `to`, and every act the choice can play in must have a table with
  accessories (`tools/validateSchemas.js` now hands the validator `accessories`). Accessories had no
  tier field; "one tier up" is the next act's loot table, which is how the game already stages them.
- **`stat` gains `stat: 'best'` and losses.** `'best'` (alone) is the unit's highest of STR MAG SKL SPD DEF
  RES LCK (never HP or MOV; a tie is settled by the seeded stream). A negative value never takes a stat
  below 0, nor max HP below 1, and HP then keeps current HP inside `[1, max]` (a unit at 2 HP losing 3 max
  HP is left at 1). The record carries the delta actually applied (`value: -2` when 3 was asked of a unit
  with 3 max HP).
- **`forge { stat?: might|crit|hit|weight|random }`**: one forge step, free (a whetstone without the gold),
  on the target's equipped weapon (`ForgeSystem.applyForge`); the stat is a seeded pick among those that
  can still take it. Record `{ kind:'forge', unit, weapon, name, stat }` (`weapon` is the name before,
  `name` after: "Iron Axe" -> "Iron Axe +1").
  **`wear {}`**: one wear step on the equipped weapon (`WeaponWear.applyWear`; the stat is a seeded pick of
  `wearableStats`). A forged weapon cannot wear, a weapon at `WEAR_MAX_STEPS` cannot: the plan comes up
  empty, so a `wear` outcome **must have a `fallback`** (like a teaching outcome), and the fallback plays
  with `fallbackText`. Record `{ kind:'wear', unit, weapon, name, stat }`.
  **`mend {}`**: every wear step on every weapon the target carries is repaired (`repairWeapon`, stat, price
  and name restored exactly); the gold is the choice's own `cost`. Record `{ kind:'mend', unit, steps,
  weapons:[{ from, to, steps }] }`.
  All three need a `target`; at most one of them per outcome (they work one weapon: a second on the same
  weapon plans as empty); none may sit in a fallback, a contract or beside a missing filter: a `forge` needs
  the choice's target filter `forgeableWeapon: true` and a `mend` needs `wornWeapon: true`, so the picker
  can only offer a unit the effect can serve ("Their weapon cannot take more." / "Nothing they carry is
  worn."). An empty plan now reports its own reason (`planned.reason`), not "Nothing to learn.".
- **Target filters `forgeableWeapon` and `wornWeapon`** (`EventSystem.equippedForgeable`): the equipped
  weapon is unworn and has a stat that can still be forged (a staff, a worn weapon or one at every cap
  fails); some carried weapon is worn (`isWorn`).
- **`gold: { refund: true }`**: the gold the choice charged, handed back (`choiceCost`, so scaled by the
  rung), for a fallback's "keep your coin". It stands alone (no `value`), needs a choice with a `cost` and
  belongs in an outcome or its fallback.
- **`battle.elite: true`**: the event's battle is an elite battle (`isElite` in the node's params, as the
  Eclipse's eclipsed battles carry): elite loot and gold (`ELITE_GOLD_MULTIPLIER` 1.25) and the elite rules.
  **`battle.recruit: { class | classPool, name? }`**: a green recruit in the fight, the recruit node's own
  unit with its own Talk. Planned by `EventJoin.pickJoinSelf` (the same seeded class and name picks as a
  `join`: a class a recruit can be in every act the choice plays in, a name nobody in the run has used),
  written as `node.recruitPreview` and `isRecruitBattle` in the node's params when the choice is made.
  `RecruitNodeSystem.isRecruitBattleNode(node)` (a recruit node, or an event node with `eventBattle`,
  `isRecruitBattle` and a valid preview) is what every reader of "a recruit battle" now asks:
  `RunManager.getPromisedRecruitNames` (the name is promised until the node is done), the spawn class, the
  unit the scene builds (`getRecruitNodeUnit`), and the params' `recruitPreview` for `MapGenerator`. An
  event's recruit is built **without the lord roll** (`RunManager._recruitGameData`: lords taken out, as an
  event `join` is), so the deserter is never Rowan; `HeadlessBattle` and the sim driver say the same
  through `battleParams.recruitNoLords`. Everything after that (Talk, `recordBattleRecruit`, the roster at
  victory, fallen recruits, the rescue music) is the recruit node's code unchanged. Record `{ kind:'battle',
  enemyLevelBonus, elite?, recruit?: { className, name } }`.
- **Requirements `notContract: true`** (no contract open: the Mercenary Contract is not even picked while
  one is) and **`roadAhead: true`** (`RouteEdit.roadCandidates` finds a road to add from the event's own
  node). A `reason` replaces the default line, as on every requirement.
- **Rung-only outcomes.** An outcome may carry `weight: 0` when its `weightByRung` lists a positive weight:
  it exists only from that rung up (a `lunatic` entry is Black Sun alone, since the table holds from its
  rung up). The validator checks that **every rung** keeps a positive total across a choice's outcomes, and a
  `reveals` tell may name such an outcome. `weightByRung` values stay positive.
- **The Herald's finale line.** `FinaleRally.composeFinaleRally({ herald })` and `heraldHeard(storyFlags,
  difficultyId)` (the `heard_herald` flag and Black Sun): one answering lord who is not already speaking for
  the fallen or the loop says a line from `dialogue.json` `finaleRally.lords.<Lord>.herald` (two lines for
  each of the seven lords; same voice rules as the other categories). `BattleBeatsController.entityRally`
  passes it.

### The events as built

`{ base, perAct }` amounts are act 1 = base + perAct x 1 (act 2: x 2 ...); costs also take `costScale`
(Nightfall x 1.25, Black Sun x 1.5, rounded to 10). Payoffs weigh 3 (the rest 1): a payoff is eligible only
when its flag was set in an **earlier** act (`flagAct: 'earlier'`; an old save's plain flag counts as
earlier), and about as likely as 3 ordinary events once it is.

1. **The Sunken Mine** (`sunken_mine`, Acts 2-4; pages `start` / `level_two` / `level_three`; `torches` 3, 2 on
   Black Sun). Each of the first two pages: *Take the ore / chest and climb out* (needs a torch; ends the
   event), *Go deeper* (needs a torch, spends one; outcomes `steady` 75 and `draft` 25, Black Sun 60 / 40: a draft
   also takes a second torch; both lead to the next page), *Feel your way out* (always open, ends the event:
   `found` 50, nothing; `ambush` 50, a fight whose spoils are 100 + 50 per act). Ore: a target with a forgeable
   weapon, `forge` one random step. Chest: 150 + 100 per act. Level three: *Face the guardian* (a battle, +1 enemy
   level; after it one accessory a tier up, from the next act's table), *Leave it standing* (needs a torch;
   nothing), *Feel your way out*. Out of torches only the dark way out is open. **Tells** on every *Feel your
   way out*: a Thief or Assassin ("{name}: This tunnel breathes. There's a way out.") or anyone with Pathfinder
   ("{name}: The air moves left. Left is up.") speaks exactly when this run's roll is `found`; their silence
   is the ambush.
2. **The Plague Village** (`plague_village`, Acts 1-3; pages `start` / `ward` / `fever_breaks`). *Give your
   medicine* (a Vulnerary use is spent): `eased` 75 heals everyone 10% and goes on to *Give a second dose*
   (heals 15%, goes on) and then *Give the last dose* (`join` a Cleric: "I owe you a life"); `well` 25: the dose
   is wasted ("It was never the fever"), the event ends. Each later page has a plain *That is all you can spare*.
   **Tell**: a staff user ("{name}: It isn't catching. It's the well.") speaks exactly when this run's first dose
   would be `well`. *Loot the empty houses*: 200 + 100 per act and an Ill Omen. *Walk around it*: nothing. (The
   spec's "per-use scaling" needs no engine effect: a page per dose.)
3. **The Mercenary Contract** (`merc_contract`, every act; `requires.notContract`). *Win the next fight under
   par*: `contract underPar`, reward 300 + 200 per act, penalty a Debt of 200 + 150 per act. *Win the next fight,
   lose no one*: `contract noLosses`, reward a weapon a tier up (`$army`), penalty Hunted. *Decline*. Choosing
   either contract is greyed while one is open (`eventChoiceBlock`).
4. **The Cartographer** (`cartographer`, Acts 1-3). *Hire her as a guide* (100 + 50 per act; **greyed unless a
   road can be added here**, `requires.roadAhead`): `routeEdit addRoad`, and if the map changed meanwhile the
   fallback hands the price back. *Ask about the road ahead* (free): `true_map` `redraw` a node ahead into a
   shop; on Black Sun 30% is `lied`: a node ahead becomes a battle (the hint on the choice says free answers are
   worth what you pay). Both have an empty `fallback` with its own text. *Rob her*: 150 + 100 per act, +2
   shadow, flag `robbed_cartographer`. Measured over 150 seeded maps per act, a road can be added from an
   event-row node 20-23% of the time (a redraw to a shop 43-49%), which is why the hire is greyed rather than
   offered and refunded.
5. **The Chained Shelf** (`chained_shelf`, Acts 2-4; needs someone who can cast). *Read it* (a caster; `learnSkill`
   from `fiendish_blow`, `drain`, `luna`, `wrath`, benched at the cap; **-3 max HP**; a reader who knows all four
   learns nothing and loses nothing: the outcome's `fallback` is empty). *Burn it*: -4 shadow. *Sell it to a
   scholar*: 250 + 150 per act.
6. **The Herald of the Hollow Sun** (`hollow_herald`, Acts 2-4; `phaseAtLeast: umbral`). *Feed the dark* (a unit
   kneels): +2 to its best stat, +8 shadow. *Break the rite*: a battle (+1 enemy level) whose victory lifts 8
   shadow. *Listen*: flag `heard_herald`, -2 shadow; on Black Sun the finale rally carries a Herald line.
7. **The Wandering Smith** (`wandering_smith`, every act). *Mend a worn weapon* (100 + 50 per act; a unit who
   carries a worn weapon): every wear step it carries repaired. *Temper a weapon* (a unit whose equipped weapon is
   forgeable): `tempered` 70 (Nightfall and Black Sun 60) is one free forge step; `too_hot` 30 (40) is one wear
   step, or, on a weapon that is already forged and so cannot wear, 15% of the unit's max HP in sparks (the
   fallback). *Leave him to his anvil*.
8. **The Turncoat** (`turncoat`, Acts 2-3). *Take him in*: `join` a Mercenary, Fighter or Archer (the recruit
   builder, level-scaled); **Black Sun: 35% `spy`**: no one joins and a Hunted burden starts (the choice's hint
   says a man who changed sides once can change them again). *Send him off*.

**Payoffs** (weight 3, flag set in an earlier act):

- **Old Faces** (`old_faces`, Acts 2-3; `spared_deserters`). *Ride to his side*: a battle with a green deserter in it
  (`battle.recruit`: Mercenary, Soldier, Fighter or Archer; Talk him into the army, spoils 80 + 40 per act).
  *Toss him coin and move on* (100 + 50 per act): -3 shadow. *Wave and keep walking*.
- **The Deserters' Revenge** (`deserters_revenge`, Acts 2-3; `reported_deserters`). *Stand and fight*: a battle (+1
  level), spoils 250 + 150 per act. *Repay the bounty* (200 + 100 per act): -2 shadow. *Slip away through the
  hills*: 15% of everyone's health. (The spec's "ambush" is a plain event battle: `isAmbush` is the village
  ambush's map.)
- **The Collectors** (`collectors`, Acts 2-4; `robbed_lender`). *Pay what is owed* (400 + 200 per act). *Fight the
  collectors*: an **elite** battle (+1 level), spoils 300 + 150 per act. *Slip away*: a Debt of 500 + 250 per act.
- **A Bad Map** (`bad_map`, Acts 2-4; `robbed_cartographer`). *Trust the map*: a node ahead becomes a battle
  (`redraw`; with none to change, the road is wrongly drawn but harmless). *Pay her for a true one* (200 + 100 per
  act; greyed where no road can be added): `addRoad`, price refunded if the map changed. *Tear it down and walk*:
  10% of everyone's health.

**Black Sun's lying strangers** are three, each an outcome with `weight: 0` and a `lunatic` weight, each with an
honest hint on its choice: the Turncoat's spy (35%), the Cartographer's lie (30%) and the Twin Altar's Dawn,
which answers with an Ill Omen (25%; the Dawn's other weights on Black Sun are 60 and 15; the hint now reads "It
asks for a coin. It does not promise to answer, or to mean it."). Nothing below Black Sun changes.

**Phase 1 flags the payoffs read.** `deserters_fire` already sets `spared_deserters` (let them go) and
`reported_deserters` (turn them in), the Moneylender `robbed_lender` (rob the cart, at the choice, before the
fight); the Cartographer sets `robbed_cartographer`. `tests/EventPhase2DContent.test.js` plays each chain across an
act change.

### Deviations from §2D, and why

1. "Troubadour" is not a class: the Plague Village's reward is a **Cleric**.
2. The Plague Village's per-use scaling is **pages**, not an effect: one Vulnerary use per page, a reward that
   grows (10%, 15%, a Cleric), and a plain way out on each.
3. The Sunken Mine's torches also fall to **drafts** (the spec only spent them going deeper, which with 3 torches
   and 3 levels would never run out); "Feel your way out" is open on every page and is the only way when none is
   left. The ore is a free forge step on a chosen unit (a whetstone cannot be handed over without the loot
   screen's picker).
4. **`roadAhead`** and greying the Cartographer's paid road: a road can be added at only about one node in five, so
   an always-open hire would be refunded most of the time. The refund (`gold.refund`) stays for the case the map
   changes between the page and the choice.
5. The Cartographer's "redraw" is a **seeded pick that can find nothing**: both answers have an empty fallback.
6. The Hollow Herald's *Listen* sets the flag on every rung and lifts 2 shadow so it is a real choice below Black
   Sun; the finale line is Black Sun's alone, as the spec says.
7. The Turncoat's spy does **not** join (a trap, not a double effect). The Collectors' and the Revenge's prices are
   milder than "2x": 400 + 200 per act (the cart paid 300 + 150) so that Act IV (1200 G, 1800 on Black Sun) stays
   payable.
8. Weights: payoffs 3 (the spec gave none), so a flag that took a decision a road ago is not buried among 17 events.
9. Old Faces is the event's own battle (the spec said "the next battle"): the node is the current node, so the
   fight, its Talk and its spoils are one visit and one save.
10. A `weight: 0` outcome (rung-only) relaxes Phase 1's "weights positive" validator rule; a `{ lunatic }` table
    holds from Black Sun up, which is Black Sun.

### For 2E (the UI)

- **Records the page cannot word yet** (`eventMenuModel.eventResultLines` returns no line for them; the engine
  tests prove their shapes): `forge`, `wear`, `mend`, `join`, `contract`, `route`, `counter`; an `item` record
  with `pooled: true` (say "to the accessory pool"); a `battle` record's `elite` and `recruit` (the Fight page
  could say "A green ally is in the fight" / "An elite battle"). `tests/EventMenu.test.js` counts lines only for
  kinds in `RESULT_CHIPS`, so adding a chip for one starts counting it.
- **A greyed choice with a custom `reason`** is the road requirement's: "She walks the road a while and finds no
  road to add." (the guide is greyed on most maps).
- **Tells** appear on *Feel your way out* (every page of the Mine) and on the Plague Village's first dose.
- The Mine's counters (`Torches`) and page trail are the 2A view; the Plague Village uses the trail too.
- The outcome of `forge` / `wear` / `mend` names the weapon before and after (`weapon`, `name`).
- Intros for art prompts are in the report of this step (`data/events.json` holds them verbatim).

### Tests

`EventPhase2DEffects` (every new effect, with a bug planted once per group), `EventPhase2DData` (each new validator
rule planted; the schema), `EventPhase2DContent` (eligibility, flags and chains, every event's outcomes by hand,
rungs, tells, payoffs), `FinaleRally` (the Herald line), `tests/sim/EventPhase2DDriver` (the harness and the
default and fight policies on every new event, a whole run), and the shared walkers `tests/eventWalk.js` now used
by `EventEveryChoice` and `EventMenu` (every page, choice and outcome, rung-only outcomes on Black Sun).

## 2E as built (2026-10-06)

The UI half of Phase 2: every surface the engine of 2A–2C gave a record to, built against the engine
API and tested with fixture events (the shipped 2D content uses the same shapes). No engine rule
changed; the words of a result record are `engine/EventResultWords.js` (`describeResult`; `eventMenuModel.js` adds the chip and the kind, the contract band takes the same text). What was built, and
what the build settled or changed against the text of §2E:

**Pages (EventMenu).** The choosing page reads, top to bottom: the head, the status line, the
**counters**, the **steps behind this page**, the intro and the choices. A step that moves the event to
another page (`result.next`) comes up **in full** above the new page under "Just now" (its choice, its
words and its result lines; the page scrolls to it), and every older step sits behind one toggle,
"Earlier on this road · N steps", **collapsed**; opening it lists the steps (`eventTrailModel`: `recent`
and `steps`). The spec's "collapsed by default" is kept for the trail; the one step just taken is the
exception, because a step's news (a spent torch, a find) is exactly what the player must not have to
open a toggle to read. After a refresh nothing is "just now" (it is not saved): every step is behind
the toggle. A new page (a step taken, or the last step's outcome) always shows the toggle collapsed
again; a redraw of the same page keeps it as the player left it. The final outcome page keeps the trail
above it. Every choice carries `page: view.page` (the page it was **shown** on), so the engine's "That
page has moved on." refusal can reach the UI: the commit then closes the picker (it answers `ok: true,
movedOn: true`, nothing was committed), re-reads the page and says "The page has moved on. Choose
again." (`PAGE_MOVED_ON_LINE`); any other refusal (gold, a block, a target) stays a refusal in the
picker. The commit also hands a route edit to the route map (below).

**Counters.** `eventCounterModel`: "Torches 2/3" in the pixel face with a pip per point of the counter's
starting value, lit while it lasts (up to eight pips; more reads as a number alone; a counter that grew
past its start lights everything it has), a warm border at 0, and a spoken label ("Torches: 2 of 3")
with the pips `aria-hidden`. Shown on every phase of an event that has counters.

**Tells.** Under their choice, in the same row (`.ev-choice-row`, the button stays the one control): a
small face (`unitPortrait`, the speaker found by uid) and the line, in the voice's italic. The engine
already writes the speaker's name into the line (`{name}`); a line that does not name them gets the name
under it (`eventTellModel`, `caption`). Shown only on the choosing page (the view carries them only
then), never the outcome a tell reveals, never a number.

**Results** (`eventResultLines`): a line for every kind the engine records. New chips and words:
`counter` (COUNT: "Torches −1", "2 left"; "Torches: none to spend" for a delta of 0), `join` (JOIN: "Hale
joins the army", "Archer · Lv 4", **the new unit's face** leads the row), `contract` (CONTRACT: "Contract:
Under par", the goal's line, "Kept: +600 G. Broken: Debt 300 G."), `route` (ROAD: "A new road opens to a
village", "A place ahead is now a village · It was a battle", with the row; a redraw to a battle reads as bad
news, to a shop or church as good), `note` (the engine's words). The 2B burden line now reads as
sentences ("Each victory gathers more shadow until the omen passes. 2 battles left, +1 shadow each.";
`sentence` raises the first letter and ends every clause with one stop). The existing "every shipped
outcome" page test counts a line per record and so covers the new kinds; `tests/EventPagesUi.test.js`
also draws **every page of every shipped event** (the first, the later ones, the dark face's) and takes
every open choice through the page, so 2D's content is held to the same bar the day it lands.

**2D's records, once merged.** `forge` (FORGE: "Hale's Iron Sword is forged", "+1 Might · now Iron Sword +1";
the sizes are `FORGE_BONUSES`), `wear` (WEAR, in the wear words of `WeaponWear`: "Dulled −1 Might"), `mend` (MEND:
"Hale's weapons are mended", the steps repaired and each `from → to`), and an `item` with `pooled: true` ("Seraph
Robe to the accessory pool"). A `battle` record is still no result line; its `elite` and `recruit` are said on the
Fight page as notes under "There is no way around this fight." (`eventBattleNotes`: "An elite fight: harder foes,
better spoils."; "Ada fights among them. Reach them with a lord and Talk to bring them in."). A greyed choice with
a custom reason (the Cartographer's guide) reads under its hint in the warm colour at every viewport (e2e,
all five).

**A route edit on the route map.** The engine has already changed the map when the page is shown; the
route map says so when the page closes. `EventController.noteRouteChange` (on each commit)
-> `NodeMapMenu.noteRouteChange({ nodeIds, text })` -> on the next draw (never while the event page is
open) the changed place (an `addRoad`'s far end, a redraw's node) is **selected**, **ringed** for seven
seconds (`.re-loom-changed`, a pulse unless Reduce motion, a still ring then) and the line ("A new road
opens ahead." / "A place ahead has changed.") is the Eclipse's own toast. Decoration only: a refresh
loses the ring, never the road.

**The contract.** A chip in the burden row under the Loom's header (`NodeMapMenu._burdenRow`, class
`re-burden re-contract`, the gilt of a seal against the burdens' red): "CONTRACT · UNDER PAR", the full
terms on its title and on a tap or Enter ("Win the next battle by turn par or sooner. Kept: +600 G.
Broken: Debt 300 G."), after the burdens in the same row; the pause lists (route map and battle) carry it as
an entry of `pauseBurdenEntries` with the same terms (`.mp-burdens li.is-contract`). The row's label
says "Burdens and contract" when one is held. The victory band takes `run.lastContractSettlement.lines`
as parts ("Contract kept: Gained 600 G", "Contract broken: Burden: Debt": each record in the Event page's own words, joined with " · ") beside the burden's, only for this
battle's node (`PostCombatController`). A contract is not shown on the battle HUD itself (the pause menu
and the band are its in-battle surfaces); see the open question below.

**Cleanse.** The vow picker's section is now a row per burden a church can lift: the button
("Ill Omen · 2 left"), the burden's words under it (its line and its count) and, behind a confirmation
("Lift the burden", the vow said in the confirmation), the lift. A **Debt** the run holds is listed as a
greyed row with the altar's refusal ("The lender has lawyers: no altar lifts a Debt."), never pressable. When
a vow already made here shuts the section the reason is said **once** under the heading (not under every
row); the words sit on ink, since the church's painting runs behind the page. A run with only a Debt (or no
burden) still shows no Cleanse (`churchOffersCleanse`, unchanged).

**The colosseum.** #214 already showed "Bouts left here: N" on the menu, the fighter list and the result;
2E adds the two screens that cost a fee and had none: the **tier** choice and the **forecast** (`ArenaMenu`),
and a style for the line.

**The Dark Omen.** `RouteGraph` keys the medal (frame 10) and `is-dark-omen` on `node.darkOmen === true`
(not on `eclipse.fromType === 'event'`): an event that **fell to a fight** is an ordinary eclipsed battle
(the elite frame 7, "Swallowed road", the burnt look), and only a node that kept its story wears the
Omen's own picture, no longer burnt (`--icon-filter: none`) so the violet flame reads. The canvas
fallback's tooltip says "Dark Omen — The dark has twisted what waits here". The card's and the page's
words are as 2B built them; reviewed: the card promises "a harsher price, a richer prize", which is the
honest general truth of a dark face (it names no choice and no number). The Phase 1 test that expected a
Swallowed road to wear frame 10 now expects 7.

**Review route** (`utils/devStartup.js`, dev and previews only). Beside `?devScene=nodemap&preset=event&seed=N&event=<id>`:
`&as=church|colosseum` (the party's next node is that service), `&burdens=ill_omen:2,debt:450,hunted,sworn_enemy,wounded`,
`&contract=underPar|noLosses`, `&omen=1` (the event node is a Dark Omen), `&act=2` (the review starts in that act, for the events that wait there), `&units=Thief,Mage` and the **review
fixtures** `event=dev_mine|dev_contract|dev_roads|dev_join|dev_stress` (`utils/devEventFixtures.js`: a three-page
mine with torches and a Thief's tell, two contracts, the two route edits with their fallbacks, a join, and the
longest strings the page must hold). Nothing here is game data.

**Tests.** `tests/EventUiPhase2E.test.js` (the model for every new line, the trail, counters, tells,
route change and contract chip; the chip row and the pause list; the ring; the Omen's medal against a
Swallowed road), `tests/EventPagesUi.test.js` (the page through the real controller and menu: counters,
the trail and its toggle, a refresh, a stale tap, tells with the right face under the right choice, every new
result kind, and every page of every shipped event), `tests/PostCombatController.test.js` (the band's
contract and burden parts, for this node only), and browser specs: `tests/e2e/event-pages.spec.js` (lane
`run-flow`: 640x480, 844x390, 667x375) and `tests/e2e/portrait-event-pages.spec.js` (lane `portrait`:
375x667, 390x844), sharing `tests/e2e/eventHelpers.js`. They play a three-page event through its trail
with a refresh in the middle, a contract from the choice to the chip, the pause list and the victory band's
line on a won battle, a new road and a redrawn place with their ring, a join, Cleanse lifting a burden and
committing the vow, a Dark Omen's medal and page next to a genuine Swallowed road, and the arena's bouts on
every fee screen. The shipped events are played too (`&act=2&units=Thief&event=sunken_mine` for the torches, the Thief's tell and a
step with its trail; `plague_village` through three doses to a join; `cartographer` with its guide greyed). Screenshots
at all five viewports were reviewed during the build and are not kept.

**Open questions.** (1) The contract is on the route map, the pause list and the band but not on the
battle HUD: a small "Contract: under par" line by the turn counter would help a player racing par; it is a
battle-HUD change (and BattleScene is a god object), so it was left for a decision. (2) The route ring is
not saved: a refresh on the outcome page, then Continue, shows the new road without the ring. (3) The
trail's "just now" step is not saved either; the older steps are always one tap away.

## Not in Phase 2

Marks, the Necromancer, multi-bar bosses, new skills and arts: `event-nodes.md` §14–§15
(Phase 3). Art: `docs/specs/event-art.md`.
