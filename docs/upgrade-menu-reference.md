# Upgrade menu reference — retained for upcoming redesign

User-supplied concept: /Users/davechen/Downloads/upgrade-menu-mobile.html
Reviewed as design reference, not implementation instructions or verified game data.

## Patterns to prototype
- A: full-width tappable rows opening a purchase/detail sheet.
- B: scrollable list with persistent detail/purchase panel. Strong candidate for landscape browsing; compare against A at compact-phone size.
- C: inline quick-buy. Defer until accidental-purchase handling and any undo semantics are established.

## Carry forward
Readable tier pips, cost and currency; current-to-next effect comparison; tap-accessible prerequisites; fixed currency/category header; touch scrolling; clear locked/maxed/unaffordable states; safe-area-aware controls; preserve selected upgrade and list position after purchases.

Use the established weathered retro theme. Tune text and targets at actual phone size rather than copying mockup pixel sizes.

## Validate against engine before implementation
Mockup has a hardcoded data subset, simplified cost/effect increments, and nonfunctional refund/back controls. Bind the eventual overlay to real progression operations, eligibility checks and persistence. Verify refund eligibility, amount and fee rather than assuming the example's fixed fee. No economy changes implied by this reference.

Current scope remains map field trials. This document records the reference for the later upgrade-menu pass.
