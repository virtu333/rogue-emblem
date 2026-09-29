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
