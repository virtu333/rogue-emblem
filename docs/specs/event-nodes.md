# Event nodes, longer acts, new skill sources

Status: **Phase 1 approved for build** (owner, 2026-10-06). Phases 2–3 are the agreed
direction, to be specced in detail when Phase 1 lands.

Owner decisions (2026-10-06):

- A new route-map node: a story **Event**, in the spirit of Slay the Spire's "?" rooms.
  Story-based, a mix of good and bad results, varies with difficulty.
- **Outcomes are hidden.** The player sees the situation and the choices, never the result
  of a choice before making it. The text hints honestly.
- **Events may start battles.**
- **More choices per act**, Act 1 especially ("can feel a little basic"): every act gains a
  row, and events take part of the battle share so the number of battles on a path stays
  about the same.
- Companion work already in flight on its own branches: Vulneraries at 2 uses with the
  Apothecary's Recipe upgrade restoring 3; worn weapons (`docs/specs/worn-weapons.md`); the
  first batch of active skills (Swap, Smite, Transfuse).

## 1. The map

### Rows

`ACT_CONFIG` (`src/utils/constants.js`): act1 8 → **9**, act2/act3/act4 9 → **10**,
finalBoss unchanged (2). Rows 0–1 stay battles, `rows-2` stays the Ruins, `rows-1` the boss.
Act 1 gets 5 mixed rows (was 4), acts 2–4 get 6 (was 5).

### Node-type weights

`pickNodeType` keeps its **single** `Math.random()` draw per mixed node (an extra draw
would shift every later draw of the node-map stream). New thresholds:

| | battle | shop | church | event |
|---|---|---|---|---|
| act1 (was .70/.20/.10) | < .56 | < .72 | < .80 | else (.20) |
| acts 2–4 (was .60/.25/.15) | < .50 | < .71 | < .835 | else (.165) |

Expected per path (before the recruit, colosseum and streak passes, which are unchanged in
kind): Act 1 ≈ 2.8 battles in mixed rows (was 2.8), 0.8 shops (0.8), 0.4 churches (0.4),
1.0 event. Acts 2–4 ≈ 3.0 battles (3.0), 1.26 shops (1.25), 0.75 churches (0.75), 1.0 event.
The boss, the Ruins and the two opening battles are as before.

Put the thresholds in one exported table (e.g. `NODE_TYPE_WEIGHTS` keyed by act, with a
default) rather than literals, so tests and sims read the same numbers.

### Generation passes

- `buildBattleParams`: EVENT returns `null` like shop/church/ruins (an event has no battle
  params until a choice starts one; see §4).
- Recruit guarantee: EVENT is **not** convertible (convertible stays battle/shop).
- Colosseum: unchanged (converts a battle).
- Service-streak repair: EVENT joins `serviceTypes` (no more than two non-combat nodes in a
  row on a path, and no event beside or above another event). A conflicting EVENT becomes
  a BATTLE (rebuild params, template and fog exactly as the pass already does for a battle).
- Village ambush: unchanged (shops only).
- `canSeizeAtRow` keeps `ceil(rows/2)`: Act 1 seize maps now on rows 5–6.
- `ACT_LEVEL_SCALING` unchanged: the extra row takes the act's `default` range.
- `villageMinRow` (First Light `{ act1: 3 }`) unchanged.

### Eclipse

EVENT joins `FALLABLE_TYPES`; `data/eclipse.json` `falls.event = { "label": "Swallowed
road", "noun": "omen" }` (update `schemas/eclipse.schema.json`, which lists the keys). A
fallen event becomes an eclipsed rout battle like a fallen church or village (Phase 2 turns
it into a Dark Omen instead, §8). An event with a committed choice is the current node and
is never fallen (the existing current-node exemption).

### Gold

`NODE_GOLD_MULTIPLIER.event = 1.0` (an event battle pays like a battle). Note
`calculateBattleGold` treats 0 as 1.0, so never use 0 for a type that can fight.

## 2. Data: `data/events.json`

Source of truth in `data/`, synced to `public/data/`, loaded by `DataLoader` and
`tests/testData.js`, validated by `npm run validate:data` (an AJV schema plus semantic
checks: every effect type known, every skill/item/burden id real, every target filter
satisfiable by some class, weights positive, ids unique, text within length).

```jsonc
{
  "version": 1,
  "costScale": { "normal": 1, "dusk": 1, "hard": 1.25, "lunatic": 1.5 },
  "events": [
    {
      "id": "old_swordmaster",
      "title": "The Old Swordmaster",
      "acts": ["act1", "act2"],            // omit = every act 1–4 (never finalBoss)
      "weight": 1,                          // pick weight among eligible events
      "oncePerRun": true,                   // default true
      "requires": { /* §3 */ },
      "intro": "An old woman is splitting firewood with a practice sword...",
      "choices": [
        {
          "id": "train",
          "label": "Ask her to teach",
          "hint": "She looks at your sword arm, not your face.",   // optional flavour line
          "requires": { /* §3 */ },
          "target": { "prompt": "Who trains with her?", "filter": { "weaponTypes": ["Sword", "Lance", "Axe"] } },
          "cost": { "gold": 0 },                                    // optional; scaled by costScale
          "outcomes": [
            { "id": "taught", "weight": 70, "weightByRung": { "hard": 60, "lunatic": 55 },
              "text": "...", "effects": [ /* §5 */ ] },
            { "id": "refused", "weight": 30, "text": "...", "effects": [] }
          ]
        }
      ]
    }
  ]
}
```

Outcome selection is either by `weight` (with optional `weightByRung` overrides, keyed by
difficulty id) or by a **check**: `"check": { "stats": ["SKL", "SPD"], "of": "target" |
"bestInArmy", "base": 0.25, "perPoint": 0.02, "against": 20, "min": 0.15, "max": 0.85,
"byRung": { "lunatic": -0.1 } }` → chance = clamp(base + (sum − against) × perPoint +
rungDelta, min, max); the choice then names `"pass"` and `"fail"` outcomes. Checks reward a
strong unit without showing a number.

## 3. Eligibility and requirements

`requires` (event-level gates whether the event can be picked; choice-level greys the
choice out with a reason line):

- `acts`, `minRow`, `maxRow`
- `difficultyAtLeast` / `difficultyAtMost` (via `isDifficultyAtLeast`, never id lists)
- `phaseAtLeast` / `phaseAtMost` (Eclipse phase ids)
- `goldAtLeast` (after `costScale`)
- `roster`: `{ weaponTypes: [...] }` (someone can wield one), `{ magic: true }`,
  `{ staff: true }`, `{ minUnits: n }`
- `fallen`: true (a fallen, unrevived ally exists this run)
- `consumable`: `"Vulnerary"` (someone or the convoy holds one with a use left)
- `flag` / `notFlag`: story flags (§6)
- `notBurden`: burden id

The **target filter** (`target.filter`) uses the same vocabulary per unit
(`weaponTypes`, `magic`, `staff`, `notLord`, `minLevel`, `notFullHp`, `living`); a choice
whose filter matches nobody is greyed out ("No one here can wield a blade.").

## 4. The engine

All pure (no Phaser, no DOM), unit-tested, following `RuinsCommands` / `ChurchVow`.

- `src/engine/EventSystem.js`: catalog, eligibility, the pick, outcome selection.
- `src/engine/EventEffects.js`: one handler per effect type (§5); plan-then-apply.
- `src/engine/EventCommands.js`: the commands the UI and sims call:
  - `eventState(run, nodeId)`
  - `arriveAtEvent(run, nodeId, catalog)`: picks and records the event if none is
    recorded yet; returns the state.
  - `eventChoiceBlock(run, nodeId, choiceId, targetUid)`: `''` or the reason line.
  - `chooseEventOption(run, nodeId, choiceId, { targetUid })`: commits and applies.
  - `pendingEventBattle(run, nodeId)` / `completeEventBattle(run, nodeId)`: the after-victory
    effects, applied once.
  - `leaveEvent(run, nodeId)`: allowed only once a choice is resolved; then the scene calls
    `markNodeComplete` and saves.

### The pick (on arrival, not at generation)

The event is chosen when the player first enters the node, from the events eligible
**then** (so "a fallen ally exists" and gold gates read the real run). The pick is seeded:
order eligible events by `hash(runSeed:nodeId:eventId)` weighted by `weight`, using the
existing FNV-1a + mulberry32 helpers (`createSeededRng`, `eclipseHash`; no new hash). It is
written to `run.eventStateByNodeId[nodeId] = { eventId }` and saved before the menu shows,
so a refresh reopens the same event. Events already seen this run (`run.eventLog`) are
excluded when `oncePerRun`. If nothing is eligible the fallback `quiet_road` is used (never
logged as once-per-run).

### The choice (committed before the reveal)

`chooseEventOption`:

1. Re-checks the block (requirement, target, cost).
2. Selects the outcome with `createSeededRng(`event:${runSeed}:${nodeId}:${choiceId}`)`
   (a check reads the target's stats at that moment). Never `Math.random`, never the battle
   RNG; the node-map and Eclipse streams are untouched.
3. **Plans** every effect (validates: the item exists, the skill can be learned or benched,
   the gold is there...) and only then **applies** all of them. A plan failure applies
   nothing and returns `{ ok: false, reason }`; the data validator should make that
   unreachable.
4. Records `{ eventId, choiceId, outcomeId, targetUid, results, battle }` on
   `eventStateByNodeId[nodeId]`, appends `{ eventId, choiceId, outcomeId, act }` to
   `run.eventLog`, and returns the outcome text and `results` (plain records for display:
   `{ kind: 'gold', value: -120 }`, `{ kind: 'skill', unit: 'Rowan', skillId, benched }`...).

The scene saves immediately after. A refresh, crash or Save & Exit after the choice reopens
the **outcome page**, never the choices: nothing re-rolls, nothing applies twice.

### Battles from an event

An outcome with a `battle` effect:

- builds rout-battle params on the node at choice time with `convertNodeToRoutBattle`
  under a seeded stream (`withEclipseSeed`-style swap keyed `event-battle:${runSeed}:${nodeId}`);
  **the node keeps `type: 'event'`** (verify `convertNodeToRoutBattle` does not set the type;
  if it does, restore it), with `node.eventBattle = true`;
- records `battle: 'pending'` and the outcome's `afterVictory` effects;
- the scene saves, then launches through the normal `handleBattle(node)` path (encounter
  lock, deploy, suspend checkpoint all unchanged).

Victory: `completeBattle` marks the node complete as for any battle (gold with the event
multiplier). On return to the route map, `completeEventBattle` applies `afterVictory` once
(guarded by `battle: 'won'`), and the scene shows the victory text and results (a pending
marker like `pendingAmbushNodeId`, saved). Revert / Continue from Map: the node is the
current, uncompleted node; the event menu reopens on the outcome page with only **Fight**
(the choice cannot change). Defeat is a normal defeat.

Event battles: `objective: 'rout'`, the row's level range, `enemyLevelBonus` from the
effect (default 0), the act's pool; Eclipse gain and par as any battle; normal loot.

### State and saves

On `RunManager`: `eventStateByNodeId` (reset per act, like `ruinsChoiceByNodeId`),
`eventLog` (run-long), `storyFlags` (run-long object of string → string|number|boolean),
`burdens` (run-long array), `pendingEventNodeId`. Constructor, `startRun`, `startPrologue`
(empty), `advanceAct` (reset only `eventStateByNodeId`), `toJSON`, `fromJSON` with a
sanitizer that drops malformed entries (ids must be strings; unknown event ids are kept so
a later build can still show the record; results must be plain records). Old saves load
with empty fields.

## 5. Effects (Phase 1 vocabulary)

| type | params | notes |
|---|---|---|
| `gold` | `value` (±) | losses floor at 0; costs live in `choice.cost`, not here |
| `item` | `name` or `pool`, `to` (`target` \| `auto` \| `convoy`), `wear` | through `LootRewardCommands.applyRewardTarget` (convoy when bags are full). `pool`: `{ kind: 'weapon', weaponTypes: '$target' \| '$army' \| [...], tierOffset: 0 \| 1 }` picks a loot-eligible weapon (never Legend, Rare, signature, scroll or staff) one tier step from the act's baseline (act1 Iron, act2 Steel, act3–4 Silver); `wear: n` applies `n` seeded wear steps (WeaponWear). |
| `learnSkill` | `skillId` or `pool: [...]`, `to: 'target'` | `learnSkill(unit, id)`; at the cap it is benched (never lost). A pool drops skills the unit knows; an empty pool falls through to the outcome's `fallback` effects. Never lord/personal or enemy-only skills (validator). |
| `fallenSkill` | `to: 'target'` | one of the chosen fallen unit's skills the target can learn (same rules) |
| `hp` | `percent` or `value`, `mode: damage \| heal`, `scope: target \| all \| commander \| randomUnit` | `UnitHealth` only; damage floors at 1 (an event never kills) |
| `shadow` | `value` (±) | through `EclipseSystem.commitShadow` semantics (both global and act shadow, like Kindle for relief), then `applyEclipseNow()` so falls happen. Prologue/Eclipse-off: no-op. Update `docs/specs/eclipse.md` ("Shadow changes nowhere else"). |
| `vision` | `value` (±) | `visionChargesRemaining`, floor 0 |
| `blessing` | `tier` | a random (seeded) blessing of that tier the run does not hold, **boons only** via `addBlessingMidRun`, restricted to an allow-list of mid-run-safe boon types (no `starting_*`, `skip_first_shop`, `deploy_cap_delta`...). The validator checks each tier has at least one safe blessing. |
| `burden` | `id`, `params` | §7 |
| `flag` | `key`, `value` | `storyFlags[key] = value` |
| `layToRest` | — | the chosen fallen unit can no longer be revived (removed from `fallenUnits`, recorded as laid to rest) |
| `consume` | `name: 'Vulnerary'`, `uses: 1` | spends one use from the healthiest holder, else the convoy |
| `stat` | `stat` (one or a list, seeded pick), `value`, `scope: target \| lowestLevel` | permanent, applied like a stat booster (class caps hold) |
| `battle` | `enemyLevelBonus`, `afterVictory: [effects]` | §4 |

Gold amounts may be written as `{ "base": 100, "perAct": 100 }` (act 1 = base + perAct ×
1); costs are multiplied by `costScale[difficulty]` and rounded to 10.

## 6. Story flags

`storyFlags` is written by events and read by event `requires` (Phase 2 also by battles and
other nodes: spared deserters return as green allies, a reported camp turns hostile).
Phase 1 only writes and gates on them.

## 7. Burdens (Phase 1: two)

A burden is a run-long penalty with its own end condition, listed on the route map (a chip
row in the loom header / node-map HUD, tap for its line) and in the pause menu.

- **Ill Omen** `{ battles: 3, extraShadow: 1 }`: each battle victory gains `extraShadow`
  more shadow (added to the battle's gain before the cap, through `commitShadow`), for the
  next `battles` victories. First Light: `battles` 2.
- **Debt** `{ owed }`: at each battle victory, half the battle's gold goes to the lender
  until `owed` is paid. The victory band shows `Debt −N G`. First Light: a quarter.

Both are applied in `RunManager.completeBattle` (one burden hook module, e.g.
`engine/Burdens.js`, pure: `burdenEffectsOnVictory(run, { gold, shadowGain })`), both are
reverted correctly by a battle revert (they are only touched at the victory commit, so the
existing entry snapshot covers them: verify), both end and disappear when spent. A burden
never stacks with itself (taking Debt twice adds to `owed`; Ill Omen refreshes `battles`).

Cleansing at a church is Phase 2.

## 8. Difficulty and the Eclipse

- `costScale` multiplies every gold cost.
- `weightByRung` / `check.byRung` tilt hidden odds (harsher on Nightfall and Black Sun).
- Burdens are gentler on First Light (above).
- An event may require a rung (`difficultyAtLeast`) or a phase (`phaseAtLeast`): Phase 2
  adds Umbral-only events (the Herald) and Black Sun variants.
- Phase 2 **Dark Omen**: a fallen event becomes a darker variant of an event rather than a
  battle (harder price, better prize), in place of the Phase 1 eclipsed battle.

## 9. Phase 1 content (10 events)

Voice: `docs/lore-style-guide.md`. Intros ≤ 260 characters, choice labels ≤ 32, outcome
text ≤ 200. The texts below are the content; the JSON may tighten wording but keep the
hints honest: every hidden result is guessable from the words on a second run.

### 9.1 The Old Swordmaster (`old_swordmaster`, acts 1–2)
Intro: *An old woman is splitting firewood with a practice sword. She hasn't missed a log.
"You're staring," she says, without looking up.*
- **Ask her to teach** (target: Sword, Lance or Axe user, "Who trains with her?").
  - *taught* 70 (Nightfall 60, Black Sun 55): *She drills them until dark. "Again." Again.
    Then, at last: "Fine."* → `learnSkill` pool by the target's best melee type: Sword
    [`darting_blow`, `duelist_stance`, `vantage`], Lance [`guard`, `pavise`,
    `armored_blow`], Axe [`death_blow`, `wrath`, `fury`]; `hp` damage 30% target (sore).
    Fallback (knows all three): `hp` heal all 20%.
  - *refused* 30: *"No." She doesn't explain. She does, however, feed you.* → `hp` heal
    all 20%.
- **Spar with her** (same target). Check: SKL+SPD of target, base .30, perPoint .025,
  against 24, Black Sun −.10.
  - *pass*: *Their blade stops at her collar. She laughs, really laughs, and fetches
    something wrapped in oilcloth.* → `learnSkill` (same pool), `item` pool weapon of the
    target's type, `tierOffset` 1.
  - *fail*: *She taps their wrist. The sword drops. "Dead," she says. "Twice."* → `hp`
    damage to 1 HP (value = currentHP − 1) target.
- **Leave her to her wood**: *She nods at the woodpile as you go. It's very neat.* → none.

### 9.2 The Abandoned Armory (`abandoned_armory`, acts 1–3)
Intro: *The garrison left in a hurry: boots by the door, a cold pot, racks of weapons
nobody came back for. Somewhere inside, a door is barred from the wrong side.*
- **Take from the racks**: *Plain issue, oiled and ready. Someone kept this place.* →
  `item` pool weapon `$army`, `tierOffset` 0, `to: auto`.
- **Search the quartermaster's office**:
  - *cache* 55 (Nightfall 45): *Under a loose board: a fine weapon, badly kept.* → `item`
    pool weapon `$army`, `tierOffset` 1, `wear` 2.
  - *tripwire* 45 (Nightfall 55): *A wire, a click, and the shelf comes down on whoever
    was first through the door.* → `hp` damage 40% commander; `gold` 80.
- **Force the barred door**: *Someone was still home.* → `battle` (enemyLevelBonus 0),
  `afterVictory`: `item` pool weapon `$army` `tierOffset` 1 (no wear), `gold`
  `{ base: 100, perAct: 100 }`.

### 9.3 The Twin Altar (`twin_altar`, acts 1–4)
Intro: *Two faces cut from one stone, one toward the sunrise and one toward the dark.
There are offerings before both. More before the dark one.*
- **Pray to the Dawn** (cost `{ base: 100, perAct: 100 }`):
  - *answered* 80: *Warmth on the back of the neck, like a hand.* → `blessing` tier 1.
  - *silence* 20: *Nothing answers. The coin is gone anyway.* → none.
- **Pray to the face in shadow**: *It answers at once. That should have worried you
  more.* → `blessing` tier 3, `burden` `ill_omen`.
- **Take the offerings**: *The dark face is smiling. You're almost sure it wasn't
  before.* → `gold` `{ base: 150, perAct: 100 }`, `shadow` +3.

### 9.4 The Wounded Courier (`wounded_courier`, acts 1–4)
Intro: *An imperial courier sits against a milestone with an arrow through his thigh and
a sealed dispatch in his fist. He watches your banner and decides not to run.*
- **Tend his wound** (requires `consumable: Vulnerary`; `consume` 1 use first):
  - *grateful* 70: *He presses a worn seer's token into your hand. "For the road. Mine's
    done."* → `vision` +1.
  - *bolts* 30: *He is gone by morning. So is a purse.* → `gold` −`{ base: 50, perAct: 50 }`.
- **Read the dispatch**: *Patrol routes, three days old. You know where they won't be.* →
  `shadow` −4.
- **Sell it at the next market**: *A clerk pays well for imperial seals and asks no
  questions.* → `gold` `{ base: 150, perAct: 100 }`, `flag` `sold_dispatch`.

### 9.5 Deserters' Fire (`deserters_fire`, acts 1–3)
Intro: *Six imperial deserters around a fire too small for them. They've seen your
banner. Nobody reaches for a weapon. Yet.*
- **Let them go**: *"We won't forget." Deserters always say that. They leave you their
  rations.* → `hp` heal all 15%, `flag` `spared_deserters`.
- **Take their gear**: *They reach for their weapons after all.* → `battle`,
  `afterVictory`: `item` pool weapon `$army` `tierOffset` 0, `gold` `{ base: 100,
  perAct: 50 }`; `flag` `robbed_deserters`.
- **Turn them in**: *The bounty is paid in clean coin. It doesn't feel clean.* → `gold`
  `{ base: 200, perAct: 100 }`, `shadow` +2, `flag` `reported_deserters`.

### 9.6 The Echo (`the_echo`, acts 1–4, requires `fallen`)
The event names one fallen, unrevived ally (`{fallen}`: seeded among them, lords first),
recorded on the state so the outcome page and a refresh agree.
Intro: *At a crossroads cairn a voice you know asks you to stop. {fallen} is here.
Mostly.*
- **Lay them to rest**: *You build the cairn higher. The voice thanks you, and goes.* →
  `layToRest`, `shadow` −6.
- **Ask for a last lesson** (target: living unit; greyed if `fallenSkill` has nothing for
  anyone): *"Watch my feet, not my hands." Then the voice is only wind.* → `fallenSkill`,
  `layToRest`.
- **"Not yet." Walk on**: *The voice says nothing. It doesn't have to.* → none (they can
  still be revived).

### 9.7 The Toll Bridge (`toll_bridge`, acts 1–3)
Intro: *A rope bridge, a hut, and a man with a crossbow and a ledger. "Toll," he says,
and names a sum. It's a lot.*
- **Pay the toll** (cost `{ base: 100, perAct: 100 }`): *He writes your name in the ledger,
  spelled wrong.* → none.
- **Bluff** (check: LCK, `of: bestInArmy`, base .35, perPoint .03, against 8, Black Sun −.10):
  - *pass*: *He looks at your banner, then at his ledger, and decides it can wait.* → none.
  - *fail*: *"Nice try." He whistles. The hut was bigger than it looked.* → `battle`,
    `afterVictory`: `gold` `{ base: 150, perAct: 100 }`.
- **Ford the river**: *Cold, fast and deeper in the middle than anyone admitted.* → `hp`
  damage 20% all (Nightfall+: 30%).

### 9.8 The Moneylender (`moneylender`, acts 1–3, `notBurden: debt`)
Intro: *A gilded cart with four guards and a man in very good gloves. "Short of coin,
captain? My terms are very reasonable."*
- **Borrow** (receives `{ base: 300, perAct: 200 }`):
  - *fair* 75 (Nightfall 60): *He counts it out twice and smiles once.* → `gold` +X,
    `burden` `debt` owed 1.5X.
  - *gouged* 25 (Nightfall 40): *You read the terms on the road. Then you read them again.*
    → `gold` +X, `burden` `debt` owed 2X.
- **Decline**: *"Another time." He seems certain there will be one.* → none.
- **Rob the cart**: *The guards were not there for show.* → `battle` (enemyLevelBonus 1),
  `afterVictory`: `gold` `{ base: 300, perAct: 150 }`, `flag` `robbed_lender`.

### 9.9 The Drill Yard (`drill_yard`, acts 1–2)
Intro: *An abandoned drill yard: straw men, a sand pit, a rack of blunted blades. A sign
reads TWO HOURS. NO EXCUSES.*
- **Drill until dark**: *By sundown everyone is sore and nobody is slower.* → `hp` damage
  15% all, and `stat` +1 SKL or SPD (seeded) to the unit with the lowest level (ties: lowest
  XP), through the same code path as a stat booster (class caps hold).
- **Rest in the barracks**: *Real beds. Lumpy, but real.* → `hp` heal all 30%.

### 9.10 A Quiet Road (`quiet_road`, fallback, every act, never once-per-run, weight 0)
Intro: *Nothing on this road but birdsong and an old well. Nobody complains.*
- **Rest a while**: *A long drink and a short sleep.* → `hp` heal all 25%.
- **Press on**: *You make good time.* → `shadow` −1.
## 10. The UI

- `src/ui/EventMenu.js` (renderer, `MenuSurface` DOM like `ChurchMenu`) + an
  `EventController` (lifecycle, like `ChurchController`): open, choose, target pick
  (`ChoicePicker` with unit faces, filtered rows greyed with the reason), outcome page,
  Fight (event battle), Continue (leave → `markNodeComplete`, save, `checkActComplete`).
- Layout: kicker `EVENT`, title in Cinzel, intro, choices as large buttons: label, optional
  hint line, cost seal (`150 G`), requirement reason when blocked. No odds, no outcome
  previews, ever. Outcome page: the outcome text, then each result as a line with its icon
  (gold, skill learned/benched, item and recipient, HP, shadow, Vision, burden).
- Must work at 640×480 and phone landscape/portrait (`html.portrait-ui` rules inside
  `@media (orientation: portrait)`), keyboard/gamepad focus, `escPriority`, `uiDepths`,
  design tokens only (`check:ui-theme`). ESC before choosing returns to the route map with
  the event still current (re-entry reopens it); after choosing, ESC = Continue.
- Route map: `NODE_ICONS`/`NODE_COLORS`, `RouteGraph` `FRAMES`/`LABELS` (a frame: reuse an
  existing medal with a distinct label until art lands), tooltip "Event — Something waits
  on the road", loom `KIND`/`SERVICE`/`flavorPool`, `CampaignMapOverlay`, the node-map
  overlay guard in `onNodeClick` and `NodeMapMenu`, and the onNodeClick branch (EVENT →
  `currentNodeId = id` → `handleEvent`; a pending event battle → straight to the outcome
  page with Fight).
- Burden chips on the route map (§7).
- Guidance: `guide_first_event` (essential, once per slot, never in the prologue), as the
  menu's status line on the first event: *"An event: choose how to meet it. You won't see
  what a choice brings until you make it, but the words are honest."*
- Music: the route-map track continues.

## 11. Sims and harness

- `tests/sim/RunSimulationDriver.js`: `_runEventNode` arrives, picks a choice by policy
  (default: the first available choice that does not start a battle; a `fight` policy
  takes battles), resolves it, runs the battle through `_runBattleNode` when one starts,
  applies `afterVictory`, completes the node. `RunPolicies.NODE_PRIORITY.event = 3`.
- `sim/strategy.js` and `sim/eclipse.js`: route events through the same command module.
- `sim/fullrun.js` stays a battle-only model (it ignores services today); note it in the
  sim header.
- Before/after on the same seeds (`sim:pacing`, `sim:strategy`, `sim:eclipse`): battles per
  act, level at each boss, gold at each boss, shadow at act end, commander-KO rate. Report
  in the PR.

## 12. Tests (Phase 1)

Failure modes first; each test catches one.

- Generation: rows per act; only rows 2..rows-3 hold events; no event in row 0/1, the Ruins
  or boss rows; events never carry battle params at generation; frequency bands for every
  type per act over many seeds (replace the old church/shop bands); the single draw (the
  same seed gives the same map for every non-event node choice as the threshold table
  implies); streak rule with events; recruit pass never converts an event.
- Eclipse: an event can fall and becomes an eclipsed battle labelled "Swallowed road"; the
  current event never falls.
- Pick: deterministic per (runSeed, nodeId); once-per-run exclusion; eligibility gates
  (fallen, consumable, gold, roster, rung, phase, flags, burdens); fallback.
- Choice: seeded outcome is stable across save/load and refresh; a second
  `chooseEventOption` is refused; plan-then-apply (a forced plan failure leaves the run
  untouched: gold, roster, convoy, shadow, flags, log); each effect type's outcome
  (asserted on run state, values derived by hand); `costScale` per rung; checks read the
  target's stats (two units, different odds, same seed).
- Battles: choice → pending battle params on an `event` node; revert keeps the choice and
  reopens Fight; victory applies `afterVictory` exactly once even across a refresh on the
  route map; gold uses the event multiplier.
- Burdens: Ill Omen adds shadow per victory and ends; Debt garnishes gold, ends at 0; a
  reverted battle leaves both unchanged; First Light values; no double stacking.
- Saves: every new field round-trips; malformed fields are sanitized; an old save loads.
- Data: the validator rejects an unknown effect, skill, item, burden or an unsatisfiable
  filter (plant one of each).
- Prologue: its map has no events; `guide_first_event` never shows there.
- UI: rendering-only adapters for EventMenu (no headless canvas branches), choice → outcome
  → continue, blocked choice reasons, target picker filter.
- An e2e spec in a lane: enter an event on the route map, choose, see the outcome, continue.

## 13. Phase 2 (direction)

- More events: the Sunken Mine (multi-page delve with a torch counter), the Plague Village,
  the Mercenary Contract (a goal for the next battle), the Cartographer (route edits: add an
  edge, redraw one upcoming node), the Chained Shelf (mage-only dark skill), the Herald of
  the Hollow Sun (Umbral+), the Wandering Smith (repair, temper, melt), recruit-a-deserter.
- Story-flag payoffs: spared deserters return as green allies in a later battle; a reported
  camp turns hostile; a robbed lender sends collectors.
- **Roster tells**: a unit with the right class, trait or skill speaks up and reveals one
  hidden outcome ("Tamsin: That's a tripwire.").
- Burdens: Hunted (an extra wave in the next 2 battles), Sworn Enemy (the act boss gains an
  affix), Wounded (a unit's stat malus for N battles); **Cleanse** at a church as a third
  vow (competes with Promotion and Blessing).
- Dark Omen variants for fallen events; Black Sun lying strangers.

## 14. Phase 3: skills (direction)

New ways to learn: event teachers (Phase 1 starts this), **deeds that teach** (a deed earns
its matching skill once: *Would Not Fall* → Miracle), **Study the Boss** (the unit that
lands an act boss's killing blow may learn one of its skills or take gold), **accessories
that roll a bound skill** (owner idea 2026-10-06: like rare weapons' `_grantedSkill`; the
skill lives on the item, does not count toward the cap, leaves with it; prerequisite: one
`effectiveSkills(unit)` read used by every battle path — today `_grantedSkill` is only read
by combat mods, strike skills and defense skills, not turn-start, auras, terrain, range or
the action menu), skill ranks from use, bonds (later).

Active skills after Swap/Smite/Transfuse: Hook (pull an enemy 1–2; boss rule TBD), Leap,
Reposition (half a Dance), Mark Target, Flare (fog), Charge!, Barricade (temporary Pillar),
Taunt (needs AI), Second Wind, Thaw/Quench, **Steal** — paired with enemies carrying spare
items on higher rungs and in later acts (today they rarely carry any, owner 2026-10-06).

Other skill types: on-kill (Lifetaker, Bloodrush, Reaper's Due), on-ally-fall (Vengeance),
stances (Steady Stance, Charge), deploy/fog (Scout, Ambusher, Quartermaster), terrain (Ice
Skater, Marsh Walker, Firewalker), **Eclipse skills** (Duskborn, Sunkeeper, Last Light),
objective (Rearguard, Siegebreaker, Ballista Adept), out of battle (Haggler, Scavenger,
Teacher), and cursed skills that hold a slot and cannot be benched (Bloodprice: arts have
no per-battle limit but cost double HP; Glass Cannon).
