# Scene Lifecycle Hardening Return Priority

Last updated: 2026-02-13

## Priority

When work resumes, return to the **Scene Lifecycle Hardening** stream before taking on new feature merges that touch scenes, transitions, mode modifiers, or run-state.

## Current Status

- SceneGuard transition + shutdown audits are live (sounds/tweens/timers/listeners/objects/overlays).
- E2E leak-budget assertions are live for `Battle -> Title` churn paths.
- Crash bundle attachments are live for E2E failures.
- Merge-gate command exists and passes:
  - `npm run test:merge-gate:scene-lifecycle`

## First Task On Return

Complete the remaining hardening item:

- Add **full-run harness execution** leak-threshold enforcement for scene churn paths (not only targeted E2E smoke transitions), then mark the roadmap item complete.

## Resume Checklist

1. Run `npm run test:merge-gate:scene-lifecycle` to re-baseline.
2. Implement full-run scene churn leak-threshold gate.
3. Add/extend tests to fail fast on budget exceedance in full-run paths.
4. Re-run merge gate and update roadmap checkboxes.
