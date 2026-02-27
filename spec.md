# Light Story Scaffolding Spec

Status: Historical draft (feature slice shipped on `main`; keep as contract/reference notes)  
Date: 2026-02-14 (authored)  
Owner: Gameplay / Narrative

> Note: This spec captures pre-implementation intent as of February 14, 2026.
> Runtime behavior has since landed in production code and data.
> Treat this file as historical context, not the authoritative current-state doc.

## Goal

Add a minimal, data-driven story layer that delivers short narrative context at key moments without introducing a full dialogue engine.

This is "light scaffolding" only:
- brief text scenes,
- blocking overlay,
- no branching,
- no gameplay rule changes.

## Scope

In scope:
- Act transition story beats.
- Boss pre-battle and boss-defeat lines.
- Run-complete lines (victory/defeat).
- Keep existing recruit dialogue flow and data support.
- Use one shared dialogue data source (`data/dialogue.json`) with safe fallbacks.

Out of scope:
- Cutscenes, branching dialogue, choices, VN-style systems.
- New combat mechanics, rewards, progression, or balance changes.
- Secret Act and Lunatic-specific runtime hooks unless already reachable in current flow.

## Current Baseline (as of this spec)

- Dialogue data currently exists and is loaded optionally (`data/dialogue.json`), but is recruit-line focused.
- Recruit dialogue is wired during Talk/recruit flow.
- No canonical act-transition story scenes are currently shown.
- No canonical boss pre-battle/defeat narrative scenes are currently shown.
- RunComplete currently shows results and rewards only.

## Data Contract

`data/dialogue.json` supports these top-level sections:
- `recruitLines` (existing, keep compatible)
- `actTransitions` (new/expanded)
- `bossEncounters` (new/expanded)
- `runComplete` (new/expanded)

Entry shape:
- Single line: `{ "speaker": "Sera", "portrait": "sera", "line": "..." }`
- Sequence: `[ { ... }, { ... } ]`

Fallback behavior:
- Missing section/key: scene is skipped.
- Missing portrait: text still displays.
- Invalid optional key: ignore key, do not crash scene transition.

## Trigger Requirements

1. Act transition:
- Trigger once when act advances.
- Display before next map interaction is accepted.

2. Boss pre-battle:
- Trigger once when a boss battle scene initializes.

3. Boss defeat:
- Trigger on boss victory before post-battle transition path completes.

4. Run complete:
- Trigger in RunComplete scene for configured result key(s) before button interaction.

5. Recruit lines:
- Existing recruit talk dialogue remains functional.

## UI and UX Requirements

- Use a blocking dialogue overlay (single shared system).
- Supports single entry and multi-entry sequence.
- Advance by click/tap/confirm key.
- Provide a skip affordance for story sequences.
- Story scenes do not auto-dismiss on timer.

## Invariants

- No change to combat determinism or battle math.
- No change to run rewards, economy, unlocks, or loss conditions.
- No hard dependency on dialogue presence (game must run with missing sections).
- Tutorial logic remains isolated and unchanged.

## Definition of Done

1. Configured act transition lines display exactly once per transition.
2. Configured boss pre-battle and boss-defeat lines display at correct points.
3. RunComplete displays configured narrative line(s) for supported outcome keys.
4. Missing dialogue keys/portraits do not throw and do not block transitions.
5. Recruit dialogue remains operational.
6. Non-story battle and node-map flows remain unchanged.

## Test Requirements

Unit / scene-level:
1. Dialogue payload parsing with missing optional sections.
2. Act transition trigger fires once and blocks interaction until dismissal.
3. Boss pre-battle trigger fires once in boss context.
4. Boss defeat trigger ordering is before final transition.
5. RunComplete trigger appears for configured outcome key.
6. Missing portrait fallback renders text without crash.

Integration / harness:
1. End-to-end smoke for one run path with at least one transition story beat.
2. Recruit dialogue regression check.
3. Determinism/parity unaffected in headless paths where story UI is bypassed.

## Risks

1. Scene lifecycle races if async dialogue callbacks restore state after transition.
2. Input lock leakage if overlay does not consistently gate interaction.
3. Content drift if dialogue keys are added without contract tests.
4. Audio/state overlap if story sequencing introduces extra transition timing.

## Follow-up Decisions (to lock before implementation)

1. First slice coverage: shipped path only (`normal` + `hard`) vs include dormant Lunatic keys now.
2. RunComplete coverage: both `victory` and `defeat` vs `victory` only.
3. Overlay behavior unification: whether recruit dialogue should also move to manual-advance (no timer) for consistency.
