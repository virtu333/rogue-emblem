// Centralized UI style constants for consistent look across all panels

export const UI_FONTS = {
  header:    { fontFamily: 'monospace', fontSize: '14px', color: '#ffdd44', fontStyle: 'bold' },
  body:      { fontFamily: 'monospace', fontSize: '12px', color: '#e0e0e0' },
  small:     { fontFamily: 'monospace', fontSize: '10px', color: '#888888' },
};

export const UI_COLORS = {
  panelBg: 0x222222, panelBorder: 0x888888,
  gold: '#ffdd44', white: '#e0e0e0', gray: '#888888',
  // Stat colors for inspection panel / level-up
  hp: '#ff6666', offense: '#ffdd44', speed: '#66ddff',
  defense: '#66ff66', utility: '#e0e0e0',
};

// Map stat name → color
export const STAT_COLORS = {
  HP:  UI_COLORS.hp,
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
  high:   0x44cc44,  // >70%
  medium: 0xdddd44,  // 40-70%
  low:    0xcc4444,  // <40%
};

export function getHPBarColor(ratio) {
  if (ratio > 0.7) return HP_BAR_COLORS.high;
  if (ratio >= 0.4) return HP_BAR_COLORS.medium;
  return HP_BAR_COLORS.low;
}
