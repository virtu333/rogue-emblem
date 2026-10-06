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
and saves exactly like a Phase 1 choice (seed key `event:${runSeed}:${nodeId}:${page}:${choiceId}`);
a refresh reopens the current page. `leaveEvent` is allowed only on a page whose resolved
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
("Contract kept: +600 G" / "Contract broken: Debt 300 G"). A revert never touches it (settled
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

## Not in Phase 2

Marks, the Necromancer, multi-bar bosses, new skills and arts: `event-nodes.md` §14–§15
(Phase 3). Art: `docs/specs/event-art.md`.
