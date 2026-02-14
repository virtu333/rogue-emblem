# Tutorial v2 Guided Flow Spec

Status: Planned (update to shipped tutorial flow)
Date: 2026-02-14
Owner: Gameplay / onboarding

## Goal

Tighten the tutorial's first-turn teaching so new players explicitly learn:
1. unit selection (Edric first),
2. movement to a tactical tile (Fort),
3. terrain bonus awareness (top-left terrain info),
4. danger/inspection workflows,
while eliminating intermittent multi-track music overlap during tutorial entry/exit.

## Scope

In scope:
- Tutorial-only scripted gating for early steps.
- Tutorial-only hint script updates.
- Tutorial-only Edric/Fort visual guidance highlights.
- Tutorial audio overlap hardening across Title <-> Battle tutorial transitions.

Out of scope:
- New map content, new units, or tutorial length expansion.
- New music assets or track flow changes.
- Changes to non-tutorial battle onboarding.
- Meta/run progression behavior.

## Required Behavior

### A. Scripted early tutorial path (hard gate)

During tutorial mode, enforce this exact sequence:
1. Player must select Edric first.
2. Player must move Edric onto the designated Fort tile.
3. After Edric reaches Fort and the danger/inspect hint is dismissed, strict gating ends.

If player deviates before gating ends:
- Show a blocking `showImportantHint(...)` popup with explicit corrective instruction.
- Revert the invalid action when possible (for example, wrong move destination should be undone).
- Keep tutorial step unchanged.

### B. Prompt and copy updates

Update tutorial hints to include:
- Edric-first instruction.
- Fort destination instruction.
- Terrain explanation with explicit callout to top-left terrain info.
- Post-Fort hint that explains:
  - Danger Zone (`[D]` / on-screen button),
  - enemy movement/threat checking and inspection via right-click (desktop),
  - viewing unit details/stats (`View Unit [V]`),
  - mobile equivalent line (long-press or Inspect mode).

All corrective prompts for wrong actions in the scripted segment must be blocking popups (not minor hints).

### C. Visual guidance

While "select Edric" step is active:
- Edric is visibly highlighted.

While "move to Fort" step is active:
- The Fort destination tile is visibly highlighted.

Highlights must clear immediately after their corresponding step completes.

### D. Music overlap fix (no flow change)

Keep existing track sequence:
- Title music on Title,
- battle music during tutorial battle,
- victory/defeat track,
- return to Title music.

But ensure no overlapping looping music tracks during:
- Title -> Tutorial entry,
- Tutorial skip -> Title,
- Tutorial victory -> Title,
- Tutorial defeat -> Title.

This includes preventing occasional bleed from menu/node-map tracks into tutorial flow.

## Definition of Done

1. In tutorial mode, selecting a non-Edric unit first does not advance; a blocking corrective hint is shown.
2. In tutorial mode, moving Edric to a non-Fort tile does not advance; move is reverted and a blocking corrective hint is shown.
3. Edric highlight is present only for the Edric-selection step.
4. Fort highlight is present only for the Fort-move step.
5. Terrain bonus hint explicitly references top-left terrain info.
6. Danger/inspect hint appears only after Edric reaches Fort and blocks input until dismissed.
7. Desktop hint text mentions right-click inspect and `V`; mobile hint text includes long-press/Inspect equivalent guidance.
8. Tutorial flow resumes normal step progression after the danger/inspect hint is dismissed.
9. No regression to non-tutorial hint flow or combat flow.
10. Across tutorial transition paths, active looping music count remains <= 1.

## Invariants

1. `battleParams.tutorialMode` remains the authoritative tutorial switch.
2. Tutorial retains no run rewards, no meta progression writes (except tutorial completion flag).
3. Tutorial skip behavior remains available at any point (with existing confirmation UX).
4. Existing tutorial roster/map contract remains unchanged unless explicitly modified by a separate spec.

## Edge Cases

1. Player repeatedly selects Sera before Edric: each attempt receives blocking corrective hint; no step advance.
2. Player selects Edric but attempts cancel/end-turn before Fort move: blocked with corrective hint.
3. Player reaches Fort, then opens/cancels menus rapidly: danger/inspect hint still fires once and unblocks correctly.
4. Player skips tutorial mid-hint: no stale step/state write after scene transition.
5. Mobile input path: no right-click dependency for completion; hint copy still accurate.
6. Audio load/unlock timing on first interaction: no duplicate loop starts.

## Risks

1. Over-constraining input can feel punitive if corrective copy is unclear.
2. Revert logic must avoid desync with fog/movement/action menu state.
3. Async hint callbacks can write stale state after transition if scene-alive checks are missed.
4. Audio overlap fix can accidentally mute intended transitions if owner/release semantics are wrong.

## Test Plan (acceptance level)

Unit / scene-level:
1. Tutorial step gate test: non-Edric first selection triggers blocking correction and no step advance.
2. Tutorial step gate test: Edric non-Fort move is undone and no step advance.
3. Highlight lifecycle test: Edric/Fort highlights appear and clear on correct step boundaries.
4. Hint text branch test: desktop vs mobile danger/inspect guidance copy.
5. Transition audio test (mocked AudioManager): tutorial entry/skip/victory/defeat paths do not leave >1 active looping track.

Integration / harness:
1. Tutorial scripted flow smoke: Edric->Fort->danger/inspect dismissal progresses, then normal tutorial flow continues.
2. Regression smoke: non-tutorial battle hint sequence unchanged.
