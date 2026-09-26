// "Who stands here?" — the unit list for one formation tile. One tap places the
// unit (swapping with whoever was there); the tile can also be emptied.
import { MenuSurface, element, button } from './MenuSurface.js';
import { unitPortrait } from './unitPortrait.js';
import { unitOnTile } from '../engine/FormationPlacement.js';
import { getDisplayLevel } from '../engine/UnitManager.js';

export function formationUnitLine(unit) {
  const weapon = unit.weapon?.name ? ` · ${unit.weapon.name}` : '';
  return `Lv ${getDisplayLevel(unit)} ${unit.className || ''}${weapon}`.trim();
}

export class FormationPicker {
  constructor(scene, formation, tileIndex, { onPick, onClear, onClose }) {
    Object.assign(this, { scene, formation, tileIndex, onPick, onClear, onClose });
    const tile = formation.tiles[tileIndex];
    const terrain = scene.grid?.getTerrainAt?.(tile.col, tile.row);
    this.surface = new MenuSurface(scene, 'Who stands here?', () => this.close(), {
      modal: true,
    });
    this.surface.root.classList.add('re-choice-picker', 'fm-picker');
    const body = this.surface.body;
    body.classList.add('re-scroll');
    if (terrain) {
      const bonus = (v) => {
        const n = parseInt(v, 10) || 0;
        return n >= 0 ? `+${n}` : `−${Math.abs(n)}`;
      };
      body.append(
        element(
          'p',
          `${terrain.name} · Def ${bonus(terrain.defBonus)} · Avoid ${bonus(terrain.avoidBonus)}`,
          'fm-picker-tile',
        ),
      );
    }
    const occupant = unitOnTile(formation.formation, tileIndex);
    const list = element('div', null, 're-choice-list fm-picker-list');
    // Waiting units first, then those already on the field (a pick swaps them).
    const order = [...formation.units.keys()].sort(
      (a, b) =>
        Number(formation.formation.at[a] !== null) - Number(formation.formation.at[b] !== null) ||
        a - b,
    );
    for (const u of order) {
      if (u === occupant) continue;
      const unit = formation.units[u];
      const reason = formation.issue(u, tileIndex);
      const onField = formation.formation.at[u] !== null;
      const row = button(null, () => this.pick(u), 're-btn re-row re-party-row fm-pick');
      const face = unitPortrait(scene, scene.gameData, unit, 'mr-unit-face');
      if (face) row.append(face);
      const name = element('strong', unit.name);
      if (onField)
        name.append(element('span', occupant === -1 ? ' · move here' : ' · swap', 'fm-tag'));
      row.append(name, element('small', reason || formationUnitLine(unit)));
      if (reason) {
        row.disabled = true;
        row.setAttribute('aria-disabled', 'true');
      }
      list.append(row);
    }
    body.append(list);
    if (occupant !== -1) {
      const clear = button(
        `Empty this tile (${formation.units[occupant].name} waits)`,
        () => {
          this.onClear();
          this.close();
        },
        're-btn fm-clear',
      );
      body.append(clear);
    }
    (list.querySelector('button:not(:disabled)') || this.surface.root).focus?.({
      preventScroll: true,
    });
  }

  pick(u) {
    if (this.closed) return;
    this.onPick(u);
    this.close();
  }

  close() {
    if (this.closed) return;
    this.destroy();
    this.onClose?.();
  }

  destroy() {
    if (this.closed) return;
    this.closed = true;
    this.surface.destroy();
  }
}
