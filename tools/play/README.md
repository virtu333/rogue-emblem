# Headless play

Play Rogue Dawn from a shell, one command at a time, without a browser. Use it to let
an agent (or a person) play real runs fast. Each command answers in a fraction of a
second. Every run can be replayed, forked and audited.

```bash
npm run -s play -- new --seed 7 --agent "model X, prompt v3, 300-call budget"
npm run -s play -- "bless 2"                       # take the second blessing
npm run -s play -- "go act1_0_2"                   # travel to a node
npm run -s play -- "start"                         # keep the default formation
npm run -s play -- "options P3"                    # what can Gaspar do this turn?
npm run -s play -- "move P3 5,6 attack E1 with Iron Sword" --note "sword beats axe, doubles"
npm run -s play -- "move P1 2,3 wait; move P2 stay heal P3; end" --same-turn
npm run -s play -- report                          # what the run amounts to
```

Each call prints what happened (combat, level-ups, enemy moves), then the new state,
then the session's revision (`(rev 12)`).

- `--brief` prints only what happened.
- `--json` prints one JSON object instead: each command's result, then the state as
  data.
- Several commands can go in one call, separated by `;` (a `;` inside double quotes
  stays part of a note). The call stops at the first refusal and says which commands
  did not run. Everything before the refusal stays played.
- `--same-turn` also stops the chain once the turn or phase moves on, so orders
  planned for one turn never run into the next.

## What it is

`tools/play` runs the game's own engine:

- The run is `RunManager`.
- Battles are the headless harness's battle (`tests/harness/HeadlessBattle.js`).
- Shops, churches, ruins, loot, roster management, skill loadouts, weapon-art binding
  and promotions go through the same command modules the menus use (`ShopCommands`,
  `ChurchCommands`, `RuinsCommands`, `LootRewardCommands`, `RosterInventory`,
  `SkillLoadout`, `RosterArtCommands`, …).
- The colosseum mirrors `ColosseumOverlay`.

The adapter keeps the game's own split of randomness:

- Each map is generated on its battle seed.
- Each battle and its victory settlement draw on `BattleRng`, seeded from the run.
- Everything else draws on one seeded stream that stands in for the browser's
  `Math.random`.
- Inside a session the engine's clock is fixed and its UUIDs are seeded, so a replay
  rebuilds exactly the same state.

### What you see is what the player knows

- Fog hides units. Enemy ids (E1, E2, …) are given when an enemy is first seen.
- Danger, threat, `options` and the JSON observation read the player's knowledge, as
  the in-game Danger overlay does.
- In `options` a reachable tile shows one of these marks:
  - a digit: how many visible enemies can strike it next enemy phase;
  - `s`: only a status staff reaches it;
  - `o`: no visible enemy reaches it (not "safe": the fog may hide more);
  - `?`: it is in fog, so nothing is known.
- Attack tiles are listed with the fewest visible attackers first. That ranking is a
  convenience, not a judgement of survival.
- The event feed shows what the player could see as each thing happened. A hidden
  unit shows only in a fight with a unit in view, as "an unseen Fighter". Events
  among hidden units are left out.
- Moves are planned on what you can see. If a unit hidden in the fog stands on the
  path, the move stops on the last tile before it (an **ambush**, as in the game). The
  move is locked in, and the unit still has its action: give it one where it stands
  (`move P2 stay attack E5`).
- Forecasts show what the game's forecast shows: the real chance to land (hits roll
  two numbers, so a rating of 72 lands about 84% of the time) and the crit rate.

## Sessions

A session is a folder, `play-sessions/<name>/`:

| File | What it holds |
|---|---|
| `session.json` | The options, the log of every command that changed the game (each with a digest of the state after it), the revision, and, for a derived session, its provenance. |
| `manifest.json` | What made it: code commit, data fingerprint, adapter and digest versions, the agent's configuration (`--agent "..."` or `--agent-file cfg.json`), and the mechanics the adapter does not model. |
| `journal.jsonl` | The playtest record: every command and its report, every query and its answer, every view printed, refusals, faults, notes, unmodelled mechanics in reach, and the outcome. |
| `diagnostics.jsonl` | Each battle command's events as they really were, fog or no fog. It is for analysis after a run. The agent playing must not read it. |
| `report.json` | Written by `report`. |

Nothing else is saved. Each call rebuilds the game by replaying the log from the seed
and checks every digest on the way.

- A digest hashes a canonical snapshot of the whole game: every unit's stats, kit and
  conditions; terrain and fog; unclaimed spoils; pools; shop stock; ids. A replay that
  reaches a different state anywhere stops with a divergence error instead of quietly
  playing a different game.
- A refused command changes nothing. A refusal or fault that comes after a command
  began to change things rebuilds the game from the log.
- The record is saved after each command, before its report is printed, so a command
  that printed is a command kept. A call killed mid-save leaves the previous record
  whole, because the file is replaced atomically.
- Calls on one session run one at a time. A second call waits for the first (the
  `session.lock`).

| Command | What it does |
|---|---|
| `new [--seed N] [--difficulty normal\|dusk\|hard\|lunatic] [--meta none\|max] [--commander NAME --partner NAME] [--agent "..."] [--force]` | Start a run. `--meta max` buys every Home Base upgrade. |
| `--session NAME` (any command) | Use another session. The default is `$PLAY_SESSION` or `default`. |
| `note "<thought>"` | Write a note to the journal, not the game. |
| `--note "<why>"` (any command) | Attach the reasoning to that command in the log and journal. |
| `log` | The commands played so far, with their notes. |
| `fork NEW [--at N]` | Copy the session (or its first N commands) to NEW, to try another line. |
| `rebase NEW [--adapt]` | Replay into NEW without checking digests and stamp fresh ones. The original is never changed. The copy records which commands now reach a different state. `--adapt` carries an older session across rule changes and records each change. |
| `stop voluntary\|timeout\|blocked "<why>"` | Conclude the run here. Later commands are refused; fork to play on. |
| `report [--json]` | Replay the session and summarise it. |
| `--expect-rev N` | Refuse to run unless the session is at revision N. Use it when a plan rests on a view that another call may have changed. |
| `--id KEY` | Run this call at most once. A retry with the same key changes nothing and says what the first one did. |

`--adapt` makes three kinds of change:

- It inserts `canto stay` where a unit can now move on after acting.
- It turns `end` into `end again` where `end` is now guarded.
- It turns an item name into `#n` where the name now matches items that differ.

Exit codes:

- 0: ok.
- 1: usage or internal error.
- 2: refused.
- 3: the replay diverged or failed.
- 4: engine fault. That command was rolled back; anything before it in the call stays
  played. A fault is a bug in the game or the adapter, never a move to retry.
- 5: the command was saved, but the view after it failed to render.
- 6: the session is busy, or not at the expected revision.

There is no undo in a battle except the game's own (Vision, below). To explore an
alternative, fork at an earlier command.

## Commands by phase

These read the game and work at any time:

- `look`: the current view (`--json` for data).
- `help`: the commands for this phase.
- `roster`: stats, growths, convoy and pools.
- `map`: the route.

**Blessing:** `bless <n>` or `bless skip`.

**Route map:**

- `go <node id>` travels to a node, or re-enters the service you are standing on.
- Roster management between battles:
  - `equip <unit> <weapon>`
  - `store <unit> <item>` puts an item in the convoy.
  - `withdraw <unit> <item>` takes one out.
  - `use <unit> <item> [<class>]` uses heals, boosters and seals. A seal names its
    class.
  - `give <unit> <item> to <unit>`
  - `accessory <unit> <name|none>`
  - `teach <unit> <scroll>` teaches a skill scroll.
  - `teach <unit> <scroll> on <weapon> [replace <slot>]` binds a weapon-art scroll.
  - `bench <unit> <skill>` sets an equipped skill aside.
  - `unbench <unit> <skill> [for <skill>]` takes a benched skill into battle.
- Items are named by name, unique prefix or `#n` (their place in the list). A name
  shared by items that differ (uses, forging, arts) is refused, with each one's
  number.

**Deploy** (only when the army is larger than the battle allows):
`deploy Edric, Sera, Gaspar` or `deploy last`. The commander always deploys.

**Formation** (before turn 1 once three or more units deploy):

- `place <unit> <x,y>` moves a unit to a marked tile. A unit already there swaps into
  the old tile.
- `start` begins the battle.

**Battle:** units are named by id (`P1`, `E3`, `N1`) or by name. Ids are new each
battle (the opening line lists the army's), so names are safer in orders written
ahead. Coordinates are `x,y`: column, then row.

- `move <unit> <x,y|stay> [equip <weapon>] <action> [then <x,y|stay>]`, where
  `<action>` is one of:
  - `wait`
  - `attack <enemy> [with <weapon>] [art <art id>]`
  - `heal <ally> [with <staff>]`
  - `item <item> [on <adjacent ally>]`: a Vulnerary or Elixir heals only the unit
    carrying it (and never a Wounded one); `on` is for cures (Herb, Remedy), which
    reach an adjacent ally. A refusal says which rule stopped it.
  - `talk` (a lord beside a recruit)
  - `seize`
  - `escape`
  - `smash <x,y>` (zombie remains)
  - `strike <area art> at <x,y>`
  - `swap <ally>`, `shove <ally>`, `pull <ally>` (Shove and Pull need the skill)
  - `dance <ally>` (a Dancer: an ally that has acted acts again)
  - `ability <name> [at <x,y>]`: Blink (`at` a tile), Rally Cry, Healing Circle,
    Ensnare. Each is once per battle.
  - `trade <ally> give <item> [for <their item>]` or `trade <ally> take <their item>`.
    A trade is free: the move is locked in, and the unit still has its action (next
    order: `move <unit> stay <action>`).
- **Canto and Measured Step.** After acting (Canto: anything but Wait; Measured Step:
  a noncombat action, never a fight), a unit with movement left may move on.
  `then <x,y>` in the order does it in one go. Without it, `canto <x,y>` or
  `canto stay` must come before any other order (`options <unit>` shows where it can
  go).
- `end` ends the player phase. The enemy phase runs and is reported. When the last
  unit acts, the phase ends by itself (as in the game). An `end` straight after that
  is refused, because it would skip the new turn. `end again` skips it on purpose.
- **Vision.**
  - `rewinds` lists the moments of this battle a charge can return to. These are each
    point between orders in your phase: the current turn and three before it, and turn
    starts only on Black Sun.
  - `rewind <n>` spends a charge and returns there. The battle's random stream resumes
    where it stood, so the same orders roll the same.
  - When your commander falls with a charge left, the run waits on `rewind <n>` or
    `accept`.
- `auto turn` and `auto battle` hand the rest of the turn, or the battle, to the
  harness's tactician (`sim/lib/TacticianAgent.js`). The tactician never uses Canto,
  trades or abilities. `auto battle` hands back after 40 turns without a result.
- Queries:
  - `options <unit>` shows where the unit can stop, with the marks above. It also
    lists:
    - every attack it can make, with a forecast for each weapon;
    - heals and Talk;
    - the allies it could trade with, swap, shove, pull or dance for;
    - its abilities;
    - the throne or escape tiles;
    - its items.
  - `forecast <unit> <x,y> <enemy> [with <weapon>] [art <art>]` gives one full
    forecast. The tile need not be reachable this turn, so next turn's strikes can be
    planned; it must be within a weapon's reach of the enemy.
  - `threat <x,y> [<unit>]` lists who can strike that tile next enemy phase. With a
    unit, it is read as if that unit stood there and its own tile were empty: the
    preview of a move.
  - Danger and `threat` are reach, not intent: a boss on its throne or a guard that
    holds may never come. They are also read from the board as it stands, your units
    included, so a unit that moves away can open a path to another.
  - `unit <id>` gives a unit's details, skills and growths.

A move is validated in full before anything moves, so a refused order changes nothing.

**Spoils** (after a won battle):

- `take <n> [to] <unit>|convoy|pool` (`take 2 Edric`, `take 3 to convoy`).
- Forge and imbue stones: `take <n> forge <unit> <weapon> [might|hit|crit|weight|<imbue id>]`.
- `skip` takes the gold instead.
- A boss may offer a recruit (`recruit <n>|none`). A due lord arrival (`lord <n>|none`,
  `reroll`) comes first.

**Shop** (also the ruins' wares and the caravan):

- `buy <n|name> for <unit>|convoy`. The numbers shift after each purchase, so a name
  is safer. Scrolls and accessories go to the team pools (`for convoy` and `for pool`
  both mean the pool; `for <unit>` equips an accessory at once). Buying a weapon its holder
  cannot use is allowed, as in the shop, and is noted.
- `sell s<n>`.
- `forge <unit> <weapon> might|hit|crit|weight`.
- `restock` (not at a caravan): new wares for a fee that rises each time. Untouched
  stock is replaced whole; once anything was bought, what is left stays and new items
  fill the empty places.
- `leave`.

**Church:**

- `heal`
- `revive <name>`: the revived come back at 1 HP; `heal` again afterwards (it is
  free and can be repeated).
- `promote <unit> [<class>]`
- `bless <n>`: taking a blessing is the church's one vow, like a promotion.
- `kindle`: lift Eclipse shadow.
- `leave`

**Ruins:**

- `path rest` heals everyone; then `revive <name>` and `leave`.
- Or `path scavenge`, which opens the wares at once. Leaving them returns to the
  ruins, where `wares` opens them again and `leave` goes on.

**Colosseum:**

- `arena <unit> <tier>` meets a challenger and shows the forecast and odds before you
  pay. Then `fight` or `back`.
- `next` or `yield` between rounds.
- `mercs` shows the mercenary board, then `hire <n>`.
- `leave`.

## Running a playtest whose results mean something

- **Fix what you compare.** Use the same seeds, rules, agent configuration
  (`--agent`), observation format and call budget. Keep exploratory runs apart from
  scored ones, and `auto` baselines apart from agent-directed play.
- **Conclude every run.** It ends in victory or defeat by itself. Otherwise say why it
  ended: `stop voluntary`, `stop timeout`, or `stop blocked` (an unmodelled mechanic
  stood in the way). An engine fault (exit 4) is neither a loss nor an agent mistake:
  report it with the session.
- **Read the report**, not just the result. It gives the army and damage kinds entering
  each battle, the fallen, turns against par, spoils offered against spoils taken,
  purchases, refusals, and unmodelled mechanics that were in reach. `report --json`
  across matched seeds is the table to compare.
- **Fork at decisions** (`fork NEW --at N`) to try a few deliberate alternative lines
  from the same moment. That tells you more about one problem than another long run
  does. A fork is a controlled alternative, not a re-roll: the same orders roll the
  same, and different orders draw differently from then on.

The record of the first agent playtest, raw and replayable, is in
`docs/playtests/2026-10-05-seed7/`.

## From code

```js
import { loadGameData } from './tests/testData.js';
import { PlaySession } from './tools/play/session.js';

const session = await PlaySession.create(loadGameData(), { seed: 7 });
const { lines } = await session.exec('bless 1'); // throws PlayError on a refusal
const text = await session.query('look');
const data = session.observe(); // the state as data
const record = session.toRecord(); // JSON; PlaySession.fromRecord(gameData, record) rebuilds it
```

- One session runs at a time per process. Each command takes over `Math.random`, the
  item-uid counter, `Date.now` and `crypto.randomUUID` while it runs, and gives them
  back afterwards. Two sessions can be interleaved, but not run concurrently.
- After a refusal that had begun to change things, or after an engine fault,
  `session.game` is a new object rebuilt from the log. Read objects from it again.

## What headless play does not model

These are listed in every session's manifest. Each one is noticed in the journal (and
printed) the first time the army could have used it, so a run's record says which of
its outcomes they may have shaped.

- **Rescue and warp staves**, and **manning a ballista**.
- **Promotion and reclass seals in battle.** Seals work from the route map with `use`.
- **The prologue.** Sessions are standard runs.
- **Deed oaths and titles** between battles.
- **Presentation:** story lines, ceremonies, hints, the rewind timeline's labels, and
  anything the browser shows but the engine does not decide.

The battle is the harness's mirror of `BattleScene`, not the scene itself. A
difference between them is a harness bug worth reporting. The browser specs remain the
check on the scene.
