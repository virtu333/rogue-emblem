// Shared layout constants for the NodeMap shop/church overlays. Lives outside
// NodeMapScene so extracted overlay controllers can import them without a
// scene <-> controller module cycle.

import { SAFE_BOTTOM_Y } from '../utils/constants.js';

export const OVERLAY_PANEL_W = 560;
export const OVERLAY_PANEL_H = 425; // overlay panel height (px) — independent of button safety margin
export const OVERLAY_PANEL_DEPTH = 301;
export const OVERLAY_CONTENT_DEPTH = 302;

export const SHOP_LIST_TOP_Y = 105;
export const SHOP_LIST_BOTTOM_Y = 390;
export const SHOP_SCROLL_STEP = 24;
export const UNIT_PICKER_SCROLL_STEP = 30;

export const CHURCH_ITEM_HEIGHT = 30;
export const CHURCH_LIST_TOP_Y = 160; // Below heal button + status message area
export const CHURCH_VIEW_MAP_Y = SAFE_BOTTOM_Y - 36; // View Map button Y (matches showChurchOverlay)
export const CHURCH_LIST_BOTTOM_Y = CHURCH_VIEW_MAP_Y - 20; // 20px gap above View Map button to prevent overlap
export const CHURCH_SCROLL_STEP = CHURCH_ITEM_HEIGHT; // Row-height-aligned for deterministic scrolling
