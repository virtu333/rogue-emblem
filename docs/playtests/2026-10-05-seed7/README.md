# Seed 7 pilot (2026-10-05): the raw record

The first agent playtest through headless play, kept so its decisions can be checked
and replayed rather than taken from the narrative alone. The narrative is
`docs/playtest-headless-pilot-2026-10-05.md`.

## What is here

- **`played/`**: the session as the agent played it, unchanged.
  - `session.json` holds the options and the 304 commands that changed the game, with
    snapshot-v1 digests.
  - `journal.jsonl` holds every command, refusal, query and note, with the printed
    report of each command.
  - The adapter of the day did not journal query answers or the views it printed. It
    had no manifest. So this record shows what the agent did and what each command
    reported, but not everything it saw.
- **`replay/`**: the same game, re-stamped for the current adapter with
  `rebase --adapt`. `session.json` names its source and every change it made under
  `provenance`:
  - `"end"` became `"end again"` at command 7. When this game was played, `end` always
    ended a turn. The current rules refuse an `end` straight after a turn ended by
    itself. The command played was the skip, so its replay must say so.
  - `"use <unit> Vulnerary"` became `#1` three times. The old rule took the first item
    of that name. The current one refuses a name shared by items that differ (here a
    unit's own Vulnerary and the convoy's).
  - Two `canto stay` were inserted. Gaspar's Measured Step was not modelled then, so
    every move he made was planned without it. Staying where he acted is what the old
    adapter did.

`replay/` was checked against `played/`. Across all 304 commands, every HP change,
fall, level-up, gold award and victory the journal reported is reproduced.

## Use it

```bash
cp -r docs/playtests/2026-10-05-seed7/replay play-sessions/seed7
npm run -s play -- log --session seed7               # the commands, with the agent's notes
npm run -s play -- fork seed7-at-200 --at 200 --session seed7
npm run -s play -- look --session seed7-at-200        # the game as it stood after command 200
```

A fork is a controlled alternative line, not a re-roll. The battle's random stream
resumes where it stood, so the same orders roll the same. Different orders draw
differently from then on.

The replay stops with a divergence error once the game's rules or data change in a
way that changes what one of these commands did. Re-stamping it with `rebase` then
records where play changed.

## Reading the outcome

The run did not end in defeat. The agent stopped on turn 12 of the elite seize
`act2_3_2` with Edric at 7 HP. Classify it as **stopped by the agent**.

Rules the adapter lacked then shaped the game:

- Gaspar's Measured Step was not modelled.
- Vision rewinds were not modelled. The run ended holding **two unused charges**: one
  at the start, and one for beating the Act 1 boss. One of them could have undone
  Sera's fall.
- Weapon-art scrolls could not be bound at all (`teach` refused them).

So the game's verdicts on scrolls and on recovering from Sera's fall need a replay
with those rules before they count as findings.
