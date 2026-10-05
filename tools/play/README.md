# Headless play

Play Rogue Dawn from a shell, one command at a time, without a browser. Use it to let
an agent (or a person) play real runs fast: each command answers in a fraction of a
second, and every run can be replayed, forked and audited.

```bash
npm run -s play -- new --seed 7                    # a new run (play-sessions/default/)
npm run -s play -- "bless 2"                       # take the second blessing
npm run -s play -- "go act1_0_2"                   # travel to a node
npm run -s play -- "start"                         # keep the default formation
npm run -s play -- "options P3"                    # what can Gaspar do this turn?
npm run -s play -- "move P3 5,6 attack E1 with Iron Sword" --note "sword beats axe, doubles"
npm run -s play -- "move P1 2,3 wait; move P2 stay heal P3; end"
```

Each call prints what happened (combat, level-ups, enemy moves) and then the new
state. `--brief` prints only what happened. Several commands can go in one call,
separated by `;` (a `;` inside double quotes stays part of a note). The call stops at
the first refusal and says which commands did not run. Everything before the refusal
stays played. In a chain, `note "..."` writes to the journal, and `--note` belongs to
the first command that changes the game.

## What it is

`tools/play` runs the game's own engine. The run is `RunManager`. Battles are the
headless harness's battle (`tests/harness/HeadlessBattle.js`). Shops, churches, ruins,
loot, roster management and promotions go through the same command modules the menus
use (`ShopCommands`, `ChurchCommands`, `RuinsCommands`, `LootRewardCommands`,
`RosterInventory`, …). The colosseum mirrors `ColosseumOverlay`.

The adapter keeps the game's own split of randomness:

- Each map is generated on its battle seed.
- Each battle and its victory settlement draw on `BattleRng`, seeded from the run.
- Everything else draws on one seeded stream that stands in for the browser's
  `Math.random`.

What you see is what the player knows. Fog hides units. Enemy ids (E1, E2, …) are
given when an enemy is first seen. Danger and threat read the player's knowledge,
as the in-game Danger overlay does. Forecasts show what the game's forecast shows:
the real chance to land (hits roll two numbers, so a rating of 72 lands about 84% of
the time) and the crit rate.

## Sessions

A session is a folder, `play-sessions/<name>/`:

- **`session.json`**: the options (seed, difficulty, …) and the log of every command
  that changed the game. Each log entry carries a digest of the state after it.
- **`journal.jsonl`**: everything that was asked, played, refused or noted, with times
  and the printed output. This is the playtest record.

Nothing else is saved. Each call rebuilds the game by replaying the log from the seed
and checks every digest on the way. If the game's code changed in a way that changes
what a logged command did, the replay stops with a divergence error instead of quietly
playing a different game. If only the adapter changed (for example the digest format),
`--rebase` re-stamps the log.

| Command | What it does |
|---|---|
| `new [--seed N] [--difficulty normal\|dusk\|hard\|lunatic] [--meta none\|max] [--commander NAME --partner NAME] [--force]` | Start a run. `--meta max` buys every Home Base upgrade. |
| `--session NAME` (any command) | Use another session; the default is `$PLAY_SESSION` or `default`. |
| `note "<thought>"` | Write a note to the journal, not the game. |
| `--note "<why>"` (any command) | Attach the reasoning to that command in the log and journal. |
| `log` | The commands played so far, with their notes. |
| `fork NEW [--at N]` | Copy the session (or its first N commands) to NEW. This lets you branch and try another line. |

There is no undo. To explore an alternative, fork at an earlier command.

## Commands by phase

These read the game and work at any time: `look` (the current view), `help` (the
commands for this phase), `roster` (stats, growths, convoy, pools), `map` (the route).

**Blessing:** `bless <n>` or `bless skip`.

**Route map:**

- `go <node id>` travels to a node, or re-enters the service you are standing on.
- Roster management between battles:
  - `equip <unit> <weapon>`
  - `store <unit> <item>` puts an item in the convoy.
  - `withdraw <unit> <item>` takes one out.
  - `use <unit> <item> [<class>]` uses heals, boosters and seals. A seal names its class.
  - `give <unit> <item> to <unit>`
  - `accessory <unit> <name|none>`
  - `teach <unit> <scroll>`

**Deploy** (only when the army is larger than the battle allows):
`deploy Edric, Sera, Gaspar` or `deploy last`. The commander always deploys.

**Formation** (before turn 1 once three or more units deploy): `place <unit> <x,y>`
moves a unit to a marked tile. A unit already there swaps into the old tile. `start`
begins the battle.

**Battle:** units are named by id (`P1`, `E3`, `N1`) or by name. Coordinates are
`x,y`: column, then row.

- `move <unit> <x,y|stay> [equip <weapon>] <action>`, where `<action>` is one of:
  - `wait`
  - `attack <enemy> [with <weapon>] [art <art id>]`
  - `heal <ally> [with <staff>]`
  - `item <item> [on <adjacent ally>]`
  - `talk` (a lord beside a recruit)
  - `seize`
  - `escape`
  - `smash <x,y>` (zombie remains)
  - `strike <area art> at <x,y>`
- `end` ends the player phase. The enemy phase runs and is reported. When the last
  unit acts, the phase ends by itself (as in the game). An `end` straight after that
  is refused, because it would skip the new turn. `end again` skips it on purpose.
- `auto turn` and `auto battle` hand the rest of the turn, or the battle, to the
  harness's tactician (`sim/lib/TacticianAgent.js`). `auto battle` hands back after
  40 turns without a result.
- Queries:
  - `options <unit>` shows where the unit can stop, with danger for each tile. It also
    lists every attack it can make with a forecast for each weapon, plus heals, Talk,
    the throne or escape tiles, and items.
  - `forecast <unit> <x,y> <enemy> [with <weapon>] [art <art>]` gives one full forecast.
  - `threat <x,y> [<unit>]` lists who can strike that tile next enemy phase.
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
  is safer. Scrolls and accessories go to the team pools. Buying a weapon its holder
  cannot use is allowed, as in the shop, and is noted.
- `sell s<n>`.
- `forge <unit> <weapon> might|hit|crit|weight`.
- `restock`.
- `leave`.

**Church:**

- `heal`
- `revive <name>`
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

## From code

```js
import { loadGameData } from './tests/testData.js';
import { PlaySession } from './tools/play/session.js';

const session = await PlaySession.create(loadGameData(), { seed: 7 });
const { lines, view } = await session.exec('bless 1'); // throws PlayError on a refusal
const text = await session.query('look');
const record = session.toRecord(); // JSON; PlaySession.fromRecord(gameData, record) rebuilds it
```

One session runs at a time per process. Each command takes over `Math.random` and the
item-uid counter while it runs and gives them back afterwards. Two sessions can be
interleaved, but not run concurrently.

## What headless play does not model

These are what the harness's battle leaves out (see `tests/harness/HeadlessBattle.js`)
and what has no engine command yet:

- **Vision rewinds.** You have charges, but battles cannot be rewound. Fork a session
  instead, knowing that the game would not let you.
- **Canto and Measured Step**, Shove, Pull, Swap, Dance, in-battle Trade, rescue and
  warp staves, ballista use, and promotion or reclass seals in battle. Seals work from
  the route map with `use`.
- **Ambushes in fog.** A move into a tile held by an unseen unit is refused, and the
  refusal says so.
- **Skill loadout, weapon-art binding, and deed oaths and titles** between battles.
- **The prologue.** Sessions are standard runs.
- **Presentation:** story lines, ceremonies, hints and anything the browser shows but
  the engine does not decide.

The battle is the harness's mirror of `BattleScene`, not the scene itself. A
difference between them is a harness bug worth reporting. The browser specs remain
the check on the scene.
