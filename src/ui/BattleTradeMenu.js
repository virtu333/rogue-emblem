import { observeHistoryAction } from './BattleHistoryRecorder.js';
import { MenuSurface, element, button } from './MenuSurface.js';
import { INVENTORY_MAX, CONSUMABLE_MAX } from '../utils/constants.js';
import {
  addToInventory,
  removeFromInventory,
  hasProficiency,
  equipIfUnarmed,
  inventoryDisplayOrder,
} from '../engine/UnitManager.js';
import { equippedBadgeElement } from './equippedBadge.js';

// Battle-only trading retains movement commitment and separate bag capacities.
export class BattleTradeMenu {
  constructor(scene, left, right) {
    Object.assign(this, { scene, left, right });
    this.surface = new MenuSurface(scene, 'Trade items', () => this.close());
    this.surface.root.classList.add('re-battle-trade');
    this.surface.header.querySelector('button').textContent = 'Done';
    this.render();
    this.surface.focusContent();
  }
  render(message = '') {
    const body = this.surface.body;
    body.replaceChildren();
    const columns = element('div', null, 're-promotion-options');
    for (const owner of [this.left, this.right]) {
      const recipient = owner === this.left ? this.right : this.left;
      const col = element('section', null, 're-card');
      col.append(
        element('h3', owner.name),
        element(
          'p',
          `Equipment ${owner.inventory?.length || 0}/${INVENTORY_MAX} · Supplies ${owner.consumables?.length || 0}/${CONSUMABLE_MAX}`,
        ),
      );
      for (const [key, cap] of [
        ['inventory', INVENTORY_MAX],
        ['consumables', CONSUMABLE_MAX],
      ]) {
        const items = key === 'inventory' ? inventoryDisplayOrder(owner) : owner[key] || [];
        for (const item of items) {
          const full = (recipient[key]?.length || 0) >= cap;
          const detail =
            key === 'inventory'
              ? `${item.type} · Mt ${item.might ?? 0} · Hit ${item.hit ?? 0} · Wt ${item.weight ?? 0}`
              : `${item.uses ?? '—'} uses`;
          const row = button(
            null,
            () => {
              this.selection = { owner, recipient, item, key, cap };
              this.render();
              body.querySelector('.trade-confirm')?.focus();
            },
            're-btn re-row',
          );
          const name = element('strong', item.name);
          if (key === 'inventory' && item === owner.weapon)
            name.append(equippedBadgeElement((tag) => element(tag)));
          row.append(
            name,
            element('small', detail),
            element(
              'small',
              full
                ? `${recipient.name}'s bag is full`
                : key === 'inventory' && !hasProficiency(recipient, item)
                  ? `${recipient.name} cannot equip; can carry`
                  : `Give to ${recipient.name}`,
            ),
          );
          row.setAttribute('aria-pressed', String(this.selection?.item === item));
          row.disabled = full;
          col.append(row);
        }
      }
      columns.append(col);
    }
    const status = element('p', message);
    status.setAttribute('role', 'status');
    body.append(columns, status);
    if (this.selection) {
      const { item, recipient } = this.selection;
      body.append(
        button(
          `Give ${item.name} to ${recipient.name}`,
          () => this.transfer(),
          're-btn re-btn--primary trade-confirm',
        ),
      );
    }
  }
  transfer() {
    const s = this.selection;
    if (this.closed || !s || this.applying) return;
    const { owner, recipient, item, key, cap } = s;
    if (!owner[key]?.includes(item) || (recipient[key]?.length || 0) >= cap) {
      this.selection = null;
      this.render('Item or recipient capacity changed.');
      return;
    }
    // Synchronous mutation, followed by replacement of the selected action.
    this.applying = true;
    if (key === 'inventory') {
      if (!addToInventory(recipient, item)) {
        this.applying = false;
        this.render('Could not transfer this item.');
        return;
      }
      removeFromInventory(owner, item);
      equipIfUnarmed(recipient, recipient.inventory.at(-1));
    } else {
      recipient.consumables ||= [];
      recipient.consumables.push(item);
      owner.consumables.splice(owner.consumables.indexOf(item), 1);
    }
    const scene = this.scene;
    if (!scene.tradeMutatedThisSession) {
      scene.tradeMutatedThisSession = true;
      this.left._movementCommitted = true;
      scene.preMoveLoc = null;
      scene.commitVisionSnapshotIfPending();
    }
    observeHistoryAction(
      scene,
      'traded with',
      this.left,
      this.left === owner ? recipient : owner,
      item.name,
    );
    scene._captureSuspendCheckpoint?.();
    this.selection = null;
    this.applying = false;
    this.render(`${item.name} given to ${recipient.name}.`);
    this.surface.focusContent();
  }
  close() {
    if (this.closed) return;
    const scene = this.scene;
    const mutated = scene.tradeMutatedThisSession;
    scene.cleanupTradeUI();
    scene.showActionMenu(this.left);
    scene.tradeMutatedThisSession = mutated;
  }
  destroy() {
    this.closed = true;
    this.surface.destroy();
  }
}
