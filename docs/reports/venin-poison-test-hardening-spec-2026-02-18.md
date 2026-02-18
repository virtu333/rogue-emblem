# Venin Poison Test Hardening Spec (2026-02-18)

## Summary

Recent Venin enemy-spawn work is functionally complete, but one combat regression test can silently pass if `Venin Bow` data is missing. This patch hardens poison tests so missing required weapon data fails loudly.

## Definition of Done

- Poison-focused combat tests no longer use early-return skips for missing Venin weapons.
- `tests/Combat.test.js` explicitly asserts required Venin weapon fixtures exist before combat resolution.
- If `Venin Blade` or `Venin Bow` is removed/renamed in data, the affected test fails with a direct assertion error.
- Existing poison behavior assertions remain unchanged.
- Targeted tests and full `npm test` pass.

## Non-Goals

- No gameplay tuning changes (drop rates, spawn logic, poison math, or balance).
- No runtime engine changes in `src/`.
- No UI changes.

## Affected Files

- `tests/Combat.test.js`
- `docs/reports/venin-poison-test-hardening-spec-2026-02-18.md` (this spec)

## Invariants

- Poison remains post-combat and non-lethal per existing combat logic.
- Test determinism remains unchanged (existing RNG mocking stays in place).
- Test coverage intent stays the same: validate poison application, not data loading internals.

## Edge Cases

- Missing `Venin Bow` in weapons data: test fails immediately via explicit expectation.
- Missing `Venin Blade` in weapons data: dual-poison test fails immediately via explicit expectation.

## Risks

- Low risk: stricter tests may fail on branches with stale weapon data, which is the intended signal.
- No runtime/performance/compatibility risk because patch is test-only.

