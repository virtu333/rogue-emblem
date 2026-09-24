import palette from '../ui/uiPalette.json';
export const UI_PALETTE = palette;
export const UI_HEX = Object.fromEntries(
  Object.entries(palette).map(([k, v]) => [k, Number.parseInt(v.slice(1), 16)]),
);
// Centralized UI style constants for consistent look across all panels

// Canvas font stacks matching the DOM tokens (--re-pixel / --re-body in mobileTheme.css).
export const UI_FONT_FAMILIES = Object.freeze({
  pixel: "'Press Start 2P', monospace",
  body: "system-ui, -apple-system, 'Segoe UI', sans-serif",
});

export const UI_FONTS = {
  header: {
    fontFamily: 'Press Start 2P',
    fontSize: '10px',
    color: palette.text,
    fontStyle: 'bold',
  },
  body: { fontFamily: 'Arial', fontSize: '13px', color: palette.text },
  small: { fontFamily: 'Arial', fontSize: '11px', color: palette.muted },
};

export const UI_COLORS = {
  panelBg: UI_HEX.panel,
  panelBorder: UI_HEX.line,
  gold: palette.accent,
  white: palette.text,
  gray: palette.muted,
  // Stat colors for inspection panel / level-up
  hp: palette.bad,
  offense: palette.accent,
  speed: palette.info,
  defense: palette.good,
  utility: palette.text,
};

// Map stat name → color
export const STAT_COLORS = {
  HP: UI_COLORS.hp,
  STR: UI_COLORS.offense,
  MAG: UI_COLORS.offense,
  SKL: UI_COLORS.offense,
  SPD: UI_COLORS.speed,
  DEF: UI_COLORS.defense,
  RES: UI_COLORS.defense,
  LCK: UI_COLORS.utility,
  MOV: UI_COLORS.utility,
};

// HP bar gradient thresholds
export const HP_BAR_COLORS = {
  high: UI_HEX.hpHigh, // >70%
  medium: UI_HEX.hpMedium, // 40-70%
  low: UI_HEX.hpLow, // <40%
};

export function getHPBarColor(ratio) {
  if (ratio > 0.7) return HP_BAR_COLORS.high;
  if (ratio >= 0.4) return HP_BAR_COLORS.medium;
  return HP_BAR_COLORS.low;
}

/** Internal texture resolution multiplier for crisp text on pixelArt canvas */
export const TEXT_RESOLUTION = 2;

/** Safely apply resolution to a Phaser text object (no-ops in test mocks) */
export function applyTextResolution(text) {
  if (text?.setResolution) {
    text.setResolution(TEXT_RESOLUTION);
    // Phaser updates style.resolution after construction but CanvasRenderer reads
    // the texture source resolution. Keep both in sync to avoid double-size text.
    if (text.frame?.source) text.frame.source.resolution = TEXT_RESOLUTION;
  }
  return text;
}
