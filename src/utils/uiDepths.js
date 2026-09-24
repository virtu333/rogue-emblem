// uiDepths.js — Canonical UI depth registry (reference)
// Phaser depth determines z-order. Higher = renders on top.
// This file documents all UI layer depths. Individual files still
// define their own constants — migrate imports in a future PR.

export const UI_DEPTHS = {
  // Battle scene layers
  GRID_BASE: 0,
  OBJECTIVE_TILE: 7, // Above movement/path overlays; below unit sprites.
  OBJECTIVE_LABEL: 15, // Readable even when a unit occupies an exit.
  TERRAIN_HIGHLIGHTS: 10,
  UNITS: 50,
  DAMAGE_NUMBERS: 80,
  FOG_OVERLAY: 90,
  FOG_LABEL: 100,
  UNIT_INSPECTION: 150,
  FORECAST_PANEL: 200,

  NODE_EVENT: 422, // Node-map ambush notification

  // Overlays (ascending priority)
  HOW_TO_PLAY: 500, // HowToPlayOverlay
  ROSTER: 700, // RosterOverlay
  LOOT_DISPLAY: 701, // BattleScene loot
  LOOT_OVERLAY_DIM: 700, // LootScreenController full-screen dim rectangle
  MASTERY_NOTICE: 799, // Post-battle mastery toast (above loot dim; == showLootStatus)
  PAUSE_MENU: 800, // PauseOverlay
  CAMPAIGN_MAP_BG: 830, // CampaignMapOverlay background
  CAMPAIGN_MAP_PANEL: 831, // CampaignMapOverlay panel
  CAMPAIGN_MAP_UI: 832, // CampaignMapOverlay nodes/legend/close
  CAMPAIGN_MAP_FOCUS_RING: 835, // CampaignMapOverlay gamepad ring (UI + 3)
  CONFIRM_DIALOG: 850, // Confirmation prompts
  HELP_BG: 860, // HelpOverlay background (== pause focus ring 860, hidden while covered)
  HELP_PANEL: 861, // HelpOverlay panel
  HELP_UI: 862, // HelpOverlay interactive elements
  HELP_FOCUS_RING: 865, // HelpOverlay gamepad ring (UI + 3)
  COMPENDIUM_BG: 870, // CompendiumOverlay background
  COMPENDIUM_PANEL: 871, // CompendiumOverlay panel
  COMPENDIUM_UI: 872, // CompendiumOverlay interactive elements
  COMPENDIUM_FOCUS_RING: 875, // CompendiumOverlay gamepad ring (UI + 3)
  SETTINGS: 900, // SettingsOverlay (gamepad ring at 905)
  LEVEL_UP_DIM: 900, // LevelUpPopup dim background
  LEVEL_UP_PANEL: 901, // LevelUpPopup panel
  LEVEL_UP_TEXT: 902, // LevelUpPopup text
  DIALOGUE: 960, // DialogueOverlay
  HINTS: 965, // HintDisplay (above dialogue)
};

// DOM surfaces have their own stacking context above the Phaser canvas.
export const DOM_UI_DEPTHS = {
  LAB: 30,
  TITLE: 390, // Title key art, lockup and menu (below every menu and dialogue)
  ROUTE: 400,
  LAUNCH: 920,
  UPGRADE: 950,
  FORECAST: 1000,
  PAUSE: 1100,
  DIALOGUE: 1200,
  MENU: 1250,
};
