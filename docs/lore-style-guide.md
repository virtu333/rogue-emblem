# Lore & Description Style Guide

Reference for the content-variety pass. Goal: keep the terse literary voice and
all canon, but break the repeated sentence shapes so the corpus stops reading as
one machine wrote it. Applies to `lore` (flavor) everywhere and to the two
templated mechanical fields (`classes.description`, `weaponArts.description`).
Leave pure stat-line descriptions (skills, metaUpgrades, affixes,
`blessings.description`) alone — clarity beats variety there.

## The prime rule: cut the second clause

Default to **one clause / one sentence.** Keep a trailing clause or second
sentence ONLY when it carries real information — a mechanical hint (what the
item does), scarcity, or a concrete canon fact. Cut it when it's there for
rhythm, cleverness, or a payoff line.

- ✗ `The mark that turns a soldier into an officer. Earned or survived.` — second clause is unclear and decorative → cut
- ✓ `The mark that turns a soldier into an officer.`
- ✗ `Reassignment to the foot ranks, stamped and final. Report at dawn.` — "Report at dawn" adds nothing → cut
- ✓ `Reassignment to the foot ranks, stamped and final.`
- ✓ `A single dragon scale, sewn in to turn a killing blow.` — second clause states the item's function → keep

When in doubt, delete it and read it again. Shorter almost always wins.

## Tics to ration (measured across the current corpus)

These are fine once or twice; they became a signature because nearly every
entry used one.

1. **Reversal / punch-line closer** — "the recipe survives; the apothecaries did
   not" / "the estate did not read it" / "Lancers learn this exactly once" /
   "asks no questions." **Cap: ≤20% of any file may end on one.** Most should
   just end on the fact.
2. **Fragment-then-reversal** two-beat structure ("Noun phrase. Wry inversion.").
3. **Antithesis via em-dash / semicolon / colon** — "not forgotten; it was
   spent." Allowed, but not as the default engine of every line.
4. **Noun-phrase openers, esp. "A/An …"** — vary the opening. Across any file,
   rotate at least 4 of the shapes below; no more than ~40% may open with a bare
   "A/An [noun]."

## Opener shapes to rotate

- Verb-first / imperative: "Drink it and a month of drills passes in an afternoon."
- Definite noun: "The mark that turns a soldier into an officer."
- Participle/prepositional lead: "Sewn into a gambeson, one dragon scale turns a killing blow."
- Plain declarative fact: "Mends the body whole."
- Bare noun fragment (use sparingly): "Bitter fen-leaf that loosens poison's grip."

## Register palette (rotate, don't homogenize)

plain-instructional · soldier's-eye · dry fact · folk-saying · overheard line ·
grim-declarative. No single register should dominate a file.

## Hard limits (enforced by tests/LoreContent.test.js)

- `lore` length: **items ≤ 85 chars, classes ≤ 160, bosses ≤ 240.**
- Single line — **no `\n`.**
- `lore` must NOT equal `description` (classes, blessings).
- Every weapon/consumable/accessory/whetstone/blessing/class/boss keeps a
  non-empty `lore`.

## Canon ledger — preserve these facts

- **Varen's mark / standard** — the stamp on iron weapons, two centuries running.
- **Old kingdom vs. the empire** — the empire supplanted an older realm; it kept
  the tools and drills and quietly dropped the old oaths. Recurring tension.
- **The court circle** — the mages/keepers running the ritual.
- **The ritual / the summoning** — the central catastrophe; "steered … too late
  to stop."
- **The sacred ground** — consecrated to keep something asleep; the ritual
  overfed it.
- **The 11 bosses** each have an established identity (border captain, warchief,
  first lance / cavalry doctrinaire, court-circle keeper, the black rider, the
  perfect duelist, the breach-holder, the berserk-school founder, the
  bargainer, the ritual's first success, the sleeper). Keep each boss's core
  identity; only vary the prose.

## Workflow

1. One agent per file (large files split into batches), each handed this guide
   plus a per-batch opener/closer quota.
2. Convergence critic: measure tic density across the WHOLE rewritten corpus;
   send over-represented shapes back for a targeted second pass.
3. Verify: `npm run sync-data` → `npm test` (esp. LoreContent) →
   `npm run check:data-parity` → `npm run check:reference`. Canon spot-check.
