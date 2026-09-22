# Map sprite sizing — September 21

## Goal and scope

Prioritize battlefield sprite consistency before portrait replacement. Keep 32px
map tiles: increasing tile size would change camera fit and reduce the visible map
on phones without correcting differences between sprite pipelines.

## Implemented

- Route both factions' Wyvern Rider/Lord, Pegasus/Falcon Knight and Mage through
  tile-centered rebuilt texture placement. Existing class assets are reused;
  rebuilt enemy Pegasus/Mage artwork stays in use.
- Astrid's base and promoted sprites use the same flyer profile.
- Flyer silhouette limit: 40px wide, 34px high; mage height: 30px. Preserve aspect
  ratio and nearest-neighbor sampling. Other mounted/infantry/entity limits stay.
- Foot baseline stays at y=44 in a 64px texture centered on the unit's tile;
  combat coordinates, hit regions, faction rings and HP bars are unchanged.
- Remove the second contrast-stage reduction for rebuilt Astrid/enemy Mage so
  these sizes have one owner. The existing contour remains.
- No source artwork, portrait, gameplay, save or tile-grid changes.

Former effective mobile wyvern artwork was about 30px high after the fallback
texture shrink; rebuilt enemy Pegasus was 40px. Astrid had a separate 0.9 shrink,
and enemy Mage a separate 0.92 shrink. The shared profile closes that variance.
Dark/soft legacy wyvern artwork remains a potential art replacement candidate;
size normalization does not recover missing source detail.

## Verification

Three muted headed mobile browser cases pass: movement/rewind tile-center
alignment, classic comparison fallback, and ten faction/class/tier examples with
measured visible bounds and common feet after contrast rendering. The contact
sheet was visually reviewed at the same tile scale. The old rewind fixture needed
an active saved slot/checkpoint to satisfy the current durable rewind contract;
updated the fixture rather than bypassing that contract.

Production build and targeted ESLint pass. Screenshot: /tmp/sprite-size-comparison.png.
This patch is local; it has not been packaged into a new TestFlight build.
