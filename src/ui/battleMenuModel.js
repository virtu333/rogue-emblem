// battleMenuModel — a battle menu as data (no Phaser, no DOM).
//
// A menu is a list of rows with stable ids. The desktop canvas menu and the phone
// rail each render the same rows; neither needs the other's objects. What a row
// offers, why it is greyed and what choosing it does live here once.
//
// A row:
//   id           stable within the menu ('ability:blink', 'back')
//   label        the command's name
//   status       an optional second line (uses left, why it is unavailable)
//   description  an optional explanation (the rail shows it under the row)
//   note         an optional aside that informs without renaming the command
//   item         the weapon/item/staff the row stands for, if any
//   disabled     shown but not choosable
//   color        the canvas text colour
//   invoke()     what choosing the row does

/** Normalise one row (every field present, so renderers never guess). */
export function menuRow({
  id,
  label,
  status = null,
  description = null,
  note = null,
  item = null,
  disabled = false,
  color = null,
  invoke,
}) {
  if (!id) throw new Error('menuRow: a row needs a stable id');
  if (typeof invoke !== 'function') throw new Error(`menuRow ${id}: invoke must be a function`);
  return { id, label, status, description, note, item, disabled: Boolean(disabled), color, invoke };
}

/** A row's text as one block: its name, then its status on a second, indented line. */
export function rowText(row) {
  return row.status ? `${row.label}\n   ${row.status}` : row.label;
}

/**
 * The phone rail renders battle menus (it exists only with the touch UI, and hides
 * any canvas rows). A menu built from rows skips its canvas rows then.
 */
export function railOwnsMenus(scene) {
  return Boolean(scene?._mobileBattleHud);
}

/**
 * A command of the scene's open menu by its row id, or null (no menu open, the menu
 * was replaced, or it does not offer the command). BattleScene._registerActionMenu
 * publishes each menu's items with the menu they belong to.
 */
export function openMenuCommand(scene, id) {
  const published = scene?._actionMenuPublished;
  if (!published || !scene.actionMenu || published.objects !== scene.actionMenu) return null;
  return published.items.find((item) => item?.id === id) || null;
}

/**
 * States whose open menu is a unit's command rows: its action menu, or the confirm
 * after a Canto move (Wait ends the turn there; Back returns to the Canto choice).
 */
export const CANTO_CONFIRM_STATE = 'CANTO_CONFIRM';
export function isUnitMenuState(state) {
  return state === 'UNIT_ACTION_MENU' || state === CANTO_CONFIRM_STATE;
}

export const DANGER_STATES = new Set([
  'PLAYER_IDLE',
  'UNIT_SELECTED',
  'UNIT_ACTION_MENU',
  'CANTO_MOVING',
  CANTO_CONFIRM_STATE,
  'DEPLOY_POSITIONING',
]);

export function canUseDanger(scene) {
  return (
    DANGER_STATES.has(scene?.battleState) &&
    scene.turnManager?.currentPhase !== 'enemy' &&
    !scene.isStoryInputLocked?.() &&
    !scene._isPrologueGateActive?.()
  );
}
