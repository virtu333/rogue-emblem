import { getSlotSummary, getSlotQuarantineKey, getSlotDataKeys } from '../engine/SlotManager.js';
import {
  archiveAndDiscardSlot,
  archiveSlot,
  readSlotArchive,
  retireSlotArchive,
} from '../engine/SlotRecovery.js';
import { deleteSlotCloud } from '../cloud/CloudSync.js';
import { hasDOMHost } from '../utils/domUI.js';
import { nativeCapacitor, getNativeSaveMirror } from '../utils/nativeSaveMirror.js';
import { slotDialog } from './RunFlowMenus.js';
import { UI_DEPTHS } from '../utils/uiDepths.js';
import { UI_HEX, UI_PALETTE, applyTextResolution } from '../utils/uiStyles.js';

function present(scene, title, message, actions) {
  scene.requestCancel({ allowExit: false });
  if (hasDOMHost()) {
    if (scene.slotMenu) scene.slotMenu.root.inert = true;
    scene.nativeDialog = slotDialog(scene, title, message, actions);
    return;
  }
  const cx = scene.cameras.main.centerX;
  const cy = scene.cameras.main.centerY;
  const depth = UI_DEPTHS.CONFIRM_DIALOG;
  const objects = [];
  objects.push(
    scene.add.rectangle(cx, cy, 640, 480, 0x000000, 0.75).setDepth(depth).setInteractive(),
  );
  objects.push(scene.add.rectangle(cx, cy, 440, 310, UI_HEX.panel).setDepth(depth + 1));
  const text = (y, copy, size) =>
    applyTextResolution(
      scene.add.text(cx, y, copy, {
        fontFamily: 'Arial',
        fontSize: `${size}px`,
        color: UI_PALETTE.text,
        align: 'center',
        wordWrap: { width: 400 },
      }),
    )
      .setOrigin(0.5)
      .setDepth(depth + 2);
  objects.push(text(cy - 126, title, 16), text(cy - 66, message, 12));
  const buttons = actions.map(([label, action], i) => {
    const btn = text(cy + 16 + i * 34, `[ ${label} ]`, 13).setInteractive({ useHandCursor: true });
    btn.on('pointerdown', () => action());
    objects.push(btn);
    return btn;
  });
  scene.confirmDialog = objects;
  scene._setDialogFocus(buttons);
}

function exportCopy(slot) {
  const raw = localStorage.getItem(getSlotQuarantineKey(slot));
  if (raw === null) throw new Error('The recovery copy could not be read.');
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = `rogue-dawn-slot-${slot}-recovery.json`;
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function confirmRecoveryChange(scene, slot, retire) {
  if (scene._recoveryAttempt) return;
  const attempt = {};
  scene._recoveryAttempt = attempt;
  const dialog = scene.nativeDialog || scene.confirmDialog;
  const ownsDialog = () =>
    scene._recoveryAttempt === attempt &&
    (scene.nativeDialog || scene.confirmDialog) === dialog &&
    scene.sys?.isActive?.() !== false;
  try {
    let archiveRaw;
    if (!retire) {
      const prepared = archiveSlot(slot);
      if (!prepared.ok) throw new Error(prepared.reason);
      archiveRaw = prepared.raw;
    }
    if (nativeCapacitor()) {
      const mirror = getNativeSaveMirror();
      if (!mirror)
        throw new Error(
          'The device backup is unavailable. Your save was kept. Retry after restarting.',
        );
      const keys = retire ? getSlotDataKeys(slot) : [getSlotQuarantineKey(slot)];
      for (const key of keys) {
        const value = retire ? null : archiveRaw;
        if (!(await mirror.ensureDurable(key, value)))
          throw new Error('The device backup could not be verified. Your recovery data was kept.');
        if (!ownsDialog()) return;
      }
    }
    if (!ownsDialog()) return;
    const result = retire
      ? retireSlotArchive(slot)
      : archiveAndDiscardSlot(slot, localStorage, archiveRaw);
    if (!result.ok) throw new Error(result.reason);
    if (retire) {
      const cloud = scene.registry.get('cloud');
      if (cloud) deleteSlotCloud(cloud.userId, slot);
    }
    scene.requestCancel({ allowExit: false });
    scene.drawSlots();
    showSlotRecovery(scene, slot);
  } catch (err) {
    if (ownsDialog()) showSlotRecovery(scene, slot, err.message);
  } finally {
    if (scene._recoveryAttempt === attempt) scene._recoveryAttempt = null;
  }
}

/** Preserve-first UI. Native/cloud repair is integrated with the later pair helper. */
export function showSlotRecovery(scene, slot, notice = '') {
  let archive;
  try {
    archive = readSlotArchive(slot);
  } catch (err) {
    notice = err.message;
  }
  const summary = getSlotSummary(slot);
  const keep = () => {
    scene.requestCancel({ allowExit: false });
    scene.drawSlots();
  };
  if (!summary?.recoveryRequired) {
    keep();
    return;
  }
  const actions = [['Keep save', keep, true]];
  const archived = archive?.state === 'archived';
  const body = archived
    ? 'A recovery copy holds your original save. Keep it, or export it before freeing this slot.'
    : 'Your save has been kept. Missing progression will not be replaced with defaults. Retry reading, or archive the original data before discarding it.';
  if (hasDOMHost() && archive)
    actions.push([
      'Export recovery copy',
      () => {
        try {
          exportCopy(slot);
        } catch (err) {
          showSlotRecovery(scene, slot, err.message);
        }
      },
    ]);
  if (archived) {
    actions.push([
      'Free slot…',
      () =>
        present(
          scene,
          `Free Slot ${slot}?`,
          'This permanently deletes the recovery copy and any cloud save for this slot. Export and check your copy first if you want to keep it.',
          [
            ['Keep recovery copy', () => showSlotRecovery(scene, slot), true],
            ['Delete copy and free slot', () => void confirmRecoveryChange(scene, slot, true)],
          ],
        ),
    ]);
  } else {
    actions.push(['Retry read', () => showSlotRecovery(scene, slot)]);
    actions.push([
      'Archive and discard…',
      () =>
        present(
          scene,
          `Discard Slot ${slot}?`,
          'A verified recovery copy must be saved before any local data is removed. The slot stays reserved until you separately delete that copy. Cloud data is kept.',
          [
            ['Keep save', () => showSlotRecovery(scene, slot), true],
            ['Archive and discard', () => void confirmRecoveryChange(scene, slot, false)],
          ],
        ),
    ]);
  }
  present(scene, `Slot ${slot} recovery`, `${body}${notice ? `\n\n${notice}` : ''}`, actions);
}
