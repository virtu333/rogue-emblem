import { safeBattlePresentation } from './safeBattlePresentation.js';
import { MenuSurface, element, button } from './MenuSurface.js';
import { hasDOMHost } from '../utils/domUI.js';
import { TILE_SIZE, FACTION_COLORS, ENTITY_FOOTPRINT } from '../utils/constants.js';
import { UI_HEX } from '../utils/uiStyles.js';
import { isEntity, getEntityCenter } from '../engine/EntitySystem.js';

// A unit that joins mid-battle (a reinforcement, a raised Skeleton, a risen Zombie, a Vigil's
// Hollowed) is on the roster before it is drawn, so a sprite that fails to draw costs only the
// sprite. It must never cost the player the sight of a unit that moves and strikes: a failed
// sprite is cleared (whatever part of it was made) and a plain marker stands in, a square in the
// faction's colour with its HP bar, which the fog, moves and death treat as any sprite. If even
// the marker cannot be drawn, the unit is noted, and at the next player turn's checkpoint the
// battle asks for a reload (Resume Battle draws it again) rather than let the player go on
// against a unit they cannot see. A resume and a Vision rewind redraw their roster through here
// too, and ask the same once the restored state is saved.

const PARTS = ['graphic', 'label', 'factionIndicator', 'hpBar', 'affixPips'];
const undrawn = new WeakMap(); // scene -> Set of units with nothing drawn

/** Run `draw` with every object `scene.add` makes recorded in `created`. */
function tracked(scene, created, draw) {
  const add = scene.add;
  if (add) {
    scene.add = new Proxy(add, {
      get(target, key) {
        const value = Reflect.get(target, key);
        if (typeof value !== 'function') return value;
        return (...args) => {
          const result = value.apply(target, args);
          if (result?.destroy) created.push(result);
          return result;
        };
      },
    });
  }
  try {
    return draw();
  } finally {
    scene.add = add;
  }
}

/** Destroy what a failed drawing made and leave the unit with no presentation fields. */
function discard(unit, created) {
  for (const object of created) {
    try {
      object.destroy();
    } catch {
      /* the renderer is already failing; the reference is dropped below */
    }
  }
  for (const part of PARTS) unit[part] = part === 'affixPips' ? [] : null;
}

/** The stand-in: a faction-coloured square on the unit's tile (an Entity's whole body) and its HP bar. */
function drawUnitMarker(scene, unit) {
  const entity = isEntity(unit);
  const at = entity ? getEntityCenter(unit) : unit;
  const pos = scene.grid.gridToPixel(at.col, at.row);
  const span = entity ? TILE_SIZE * ENTITY_FOOTPRINT.width : TILE_SIZE;
  const color = FACTION_COLORS[unit.faction] ?? UI_HEX.dangerLine;
  const barWidth = span - (entity ? 8 : 6);
  const barY = pos.y + span / 2 - 4;
  const graphic = scene.add
    .rectangle(pos.x, pos.y, span - 8, span - 8, color)
    .setStrokeStyle(2, 0x000000)
    .setDepth(10 + Math.min(unit.row ?? 0, 90) * 0.01);
  const bg = scene.add.rectangle(pos.x, barY, barWidth, 3, 0x000000).setDepth(12);
  const fill = scene.add
    .rectangle(pos.x, barY, barWidth, 3, UI_HEX.dangerLine)
    .setOrigin(0.5)
    .setDepth(13);
  Object.assign(unit, { graphic, label: null, factionIndicator: null, hpBar: { bg, fill } });
  unit.affixPips = [];
  scene.updateHPBar(unit);
  return true;
}

/**
 * Draw a unit that is already on the battle. Returns 'sprite' (drawn as ever), 'marker' (the
 * sprite failed and the stand-in is drawn) or 'none' (nothing could be drawn: the next player
 * turn asks for a reload, see `guardUndrawnUnits`). Never throws, never changes game state.
 */
export function drawArrivalGraphic(scene, unit, label = 'unit graphic') {
  const created = [];
  let failure = null;
  try {
    tracked(scene, created, () => scene.addUnitGraphic(unit));
  } catch (error) {
    failure = error;
  }
  if (!failure) {
    undrawn.get(scene)?.delete(unit);
    return 'sprite';
  }
  safeBattlePresentation(
    label,
    () => {
      throw failure;
    },
    { scene },
  );
  discard(unit, created);
  const markerParts = [];
  const marked = safeBattlePresentation(
    `${label} marker`,
    () => tracked(scene, markerParts, () => drawUnitMarker(scene, unit)),
    { scene },
  );
  if (marked === true) {
    undrawn.get(scene)?.delete(unit);
    return 'marker';
  }
  discard(unit, markerParts);
  if (!undrawn.has(scene)) undrawn.set(scene, new Set());
  undrawn.get(scene).add(unit);
  return 'none';
}

const onBoard = (scene, unit) =>
  unit.currentHP > 0 &&
  !unit._removing &&
  [scene.playerUnits, scene.enemyUnits, scene.npcUnits].some((list) => list?.includes(unit));

/**
 * At a player turn's checkpoint (the battle is durable here): try once more to draw each unit
 * still undrawn on the board; if any stays invisible, ask for a reload. Returns the units still
 * undrawn.
 */
export function guardUndrawnUnits(scene) {
  const pending = undrawn.get(scene);
  if (!pending?.size) return [];
  for (const unit of [...pending]) {
    if (!onBoard(scene, unit) || unit.graphic) pending.delete(unit);
    else if (drawArrivalGraphic(scene, unit, 'undrawn unit graphic') !== 'none')
      pending.delete(unit);
  }
  const still = [...pending];
  if (still.length)
    safeBattlePresentation('undrawn unit reload prompt', () => showReloadPrompt(scene), { scene });
  return still;
}

function showReloadPrompt(scene) {
  if (scene._undrawnReloadPrompt || !hasDOMHost()) return;
  const surface = new MenuSurface(scene, 'A unit could not be drawn', () => {}, { modal: true });
  surface.header.querySelector('button')?.remove();
  const status = element(
    'p',
    'A unit on the battlefield could not be drawn. Reload to resume this battle from the start of this turn.',
  );
  status.setAttribute('role', 'status');
  surface.body.append(
    status,
    button('Reload', () => window.location.reload(), 're-btn re-btn--primary'),
  );
  surface.focusContent();
  scene._undrawnReloadPrompt = surface;
  scene.events?.once?.('shutdown', () => {
    surface.destroy();
    scene._undrawnReloadPrompt = null;
  });
}
