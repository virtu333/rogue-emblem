// The EXP bar in unit profiles (docs/specs/exp-bars.md §3.1), beside healthBar.js.
// Presentation only: it reads a unit's XP (engine/XpProgress) and never writes it.
// Player units only: enemies and NPCs have no EXP to show.
import { XP_PER_LEVEL } from '../utils/constants.js';
import { xpSnapshot } from '../engine/XpProgress.js';
import { UI_HEX, UI_PALETTE } from '../utils/uiStyles.js';

/** The canvas row's colours: the DOM row's tokens (reKit.css .re-xp / .re-xp-row). */
export const XP_CANVAS_COLORS = Object.freeze({
  label: UI_PALETTE.info,
  value: UI_PALETTE.text,
  maxText: UI_PALETTE.muted,
  bed: UI_HEX.sunken,
  fill: UI_HEX.info,
  maxFill: UI_HEX.muted,
});

/** Whether a unit's profile shows EXP at all. */
export function showsXp(unit) {
  return unit?.faction === 'player';
}

/** The bar's facts: the XP shown, and whether the unit is at its level cap (MAX). */
export function xpBarFacts(unit, { extendedLevelingEnabled = false } = {}) {
  const snapshot = xpSnapshot(unit, { extendedLevelingEnabled });
  const xp = Math.min(snapshot.xp, XP_PER_LEVEL - 1);
  return snapshot.capped
    ? { capped: true, xp, value: 'MAX', text: 'EXP MAX, at the level cap', ratio: 1 }
    : {
        capped: false,
        xp,
        value: `${xp}/${XP_PER_LEVEL}`,
        text: `${xp} of ${XP_PER_LEVEL} EXP`,
        ratio: xp / XP_PER_LEVEL,
      };
}

/**
 * The meter: `span.re-xp[role=meter]` with its fill, or null for a unit that shows
 * no EXP. At the level cap the bar is full in the muted colour and reads MAX.
 * `extendedLevelingEnabled` (the run's difficulty) keeps a promoted unit at 20
 * filling a normal bar.
 */
export function createXpBar(unit, { extendedLevelingEnabled = false } = {}) {
  if (!showsXp(unit)) return null;
  const facts = xpBarFacts(unit, { extendedLevelingEnabled });
  const bar = document.createElement('span');
  bar.className = facts.capped ? 're-xp is-max' : 're-xp';
  bar.setAttribute('role', 'meter');
  bar.setAttribute('aria-label', `${unit.name} EXP`);
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', String(XP_PER_LEVEL));
  bar.setAttribute('aria-valuenow', String(facts.capped ? XP_PER_LEVEL : facts.xp));
  bar.setAttribute('aria-valuetext', facts.text);
  const fill = document.createElement('span');
  fill.className = 're-xp-fill';
  fill.style.width = `${facts.ratio * 100}%`;
  bar.append(fill);
  return bar;
}

/**
 * The profile row under the HP bar: "EXP [bar] 45/100" (or MAX), or null for a unit
 * that shows no EXP.
 */
export function createXpRow(unit, options = {}) {
  const bar = createXpBar(unit, options);
  if (!bar) return null;
  const facts = xpBarFacts(unit, options);
  const row = document.createElement('span');
  row.className = 're-xp-row';
  const label = document.createElement('span');
  label.className = 're-xp-label';
  label.textContent = 'EXP';
  label.setAttribute('aria-hidden', 'true');
  const value = document.createElement('span');
  value.className = 're-xp-value';
  value.textContent = facts.value;
  value.setAttribute('aria-hidden', 'true');
  row.append(label, bar, value);
  return row;
}

/**
 * The same EXP row on a Phaser canvas (the headless RosterOverlay / UnitDetailOverlay
 * fallbacks): "EXP", then a bar drawn with the panels' 180×8 HP-bar code, then the value
 * ("45/100" or MAX). The words go through the panel's own `text(x, y, str, color, size)`
 * helper (which owns them); returns the bar's two rectangles for the caller to own, []
 * for a unit that shows no EXP.
 */
export function drawCanvasXpRow(
  scene,
  x,
  y,
  unit,
  { text, depth, colors = XP_CANVAS_COLORS, extendedLevelingEnabled = false } = {},
) {
  if (!showsXp(unit) || !scene?.add?.rectangle) return [];
  const facts = xpBarFacts(unit, { extendedLevelingEnabled });
  const labelW = 28;
  const barW = 180;
  const barH = 8;
  const objects = [];
  text?.(x, y, 'EXP', colors.label, '10px');
  const bx = x + labelW;
  const bg = scene.add.rectangle(bx, y + 5, barW, barH, colors.bed).setOrigin(0, 0.5);
  const fill = scene.add
    .rectangle(bx, y + 5, barW * facts.ratio, barH, facts.capped ? colors.maxFill : colors.fill)
    .setOrigin(0, 0.5);
  for (const object of [bg, fill]) {
    if (depth != null) object.setDepth?.(depth);
    objects.push(object);
  }
  text?.(bx + barW + 8, y, facts.value, facts.capped ? colors.maxText : colors.value, '10px');
  return objects;
}
