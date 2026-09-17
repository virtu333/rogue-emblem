# Touch upgrade menu

HomeBase opens a touch loadout with lord portraits, commander/partner selection, visible skill-slot limits, readable skill descriptions, and Begin Run. Upgrades opens a scrolling category/list pane with persistent details/purchase controls; Home base returns to the loadout. Commander tiers and skill unlock/assignment rules are delegated to MetaProgressionManager. Brand-new save slots retain the existing first-run fast path; returning players enter Home Base.

- Uses all six categories from the current meta-upgrade data.
- Shows tier progress, currency, current/next effects and tap-accessible prerequisite explanations.
- Purchases call MetaProgressionManager.purchaseUpgrade; refunds use canRefund/refundUpgrade, including fee and dependent-upgrade restrictions. No economy changes.
- Refund preview shows returned cost, fee and net amount, with explicit confirm/cancel.
- Preserves category scroll/selection; a purchase keeps the current upgrade selected.
- Long details scroll above the spending controls; keyboard/gamepad input belongs to the overlay until it closes.
- Scene shutdown removes DOM and input scope. Local persistence uses the existing manager.

Review: `/?devScene=homebase&mobilePreview=1`. This development route can seed review currency; it is not the ordinary new-player balance. Purchases use the active local save, so use an isolated browser profile for destructive testing.

Validation: progression/refund/description/gamepad unit suites, isolated browser purchase/refund/reload checks, all-category overflow checks at 640×480 and 844×390, compact 667×375 spending flow, and production build. Native device verification remains outstanding. Commander and skill assignment controls use MobileHomeBase; scene teardown removes both surfaces and their input scopes.
