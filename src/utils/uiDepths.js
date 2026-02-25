// uiDepths.js — Canonical UI depth registry (reference)
// Phaser depth determines z-order. Higher = renders on top.
// This file documents all UI layer depths. Individual files still
// define their own constants — migrate imports in a future PR.

export const UI_DEPTHS = {
  // Battle scene layers
  GRID_BASE: 0,
  TERRAIN_HIGHLIGHTS: 10,
  UNITS: 50,
  DAMAGE_NUMBERS: 80,
  FOG_OVERLAY: 90,
  FOG_LABEL: 100,
  UNIT_INSPECTION: 150,
  FORECAST_PANEL: 200,

  // Overlays (ascending priority)
  HOW_TO_PLAY: 500, // HowToPlayOverlay
  ROSTER: 700, // RosterOverlay
  LOOT_DISPLAY: 701, // BattleScene loot
  PAUSE_MENU: 800, // PauseOverlay
  CONFIRM_DIALOG: 850, // Confirmation prompts
  HELP_BG: 860, // HelpOverlay background
  HELP_PANEL: 861, // HelpOverlay panel
  HELP_UI: 862, // HelpOverlay interactive elements
  SETTINGS: 900, // SettingsOverlay
  LEVEL_UP_DIM: 900, // LevelUpPopup dim background
  LEVEL_UP_PANEL: 901, // LevelUpPopup panel
  LEVEL_UP_TEXT: 902, // LevelUpPopup text
  DIALOGUE: 960, // DialogueOverlay
  HINTS: 965, // HintDisplay (above dialogue)
};
