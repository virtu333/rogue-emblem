import {
  getSlotSummary,
  getSlotQuarantineKey,
  getSlotDataKeys,
  getSlotPairJournalKey,
  getSlotRecoveryOwner,
  getSlotRecoveryOwnerKey,
} from '../engine/SlotManager.js';
import {
  archiveAndDiscardSlot,
  archiveSlot,
  readSlotArchive,
  retireSlotArchive,
  retakeSlotArchive,
  forgetSlotArchive,
  discardExportedSlot,
} from '../engine/SlotRecovery.js';
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
    return scene.nativeDialog;
  }
  const cx = scene.cameras.main.centerX;
  const cy = scene.cameras.main.centerY;
  const depth = UI_DEPTHS.CONFIRM_DIALOG;
  const objects = [];
  objects.push(
    scene.add.rectangle(cx, cy, 640, 480, 0x000000, 0.75).setDepth(depth).setInteractive(),
  );
  objects.push(scene.add.rectangle(cx, cy, 440, 440, UI_HEX.panel).setDepth(depth + 1));
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
  objects.push(text(cy - 194, title, 16), text(cy - 132, message, 12));
  const buttons = actions.map(([label, action], i) => {
    const btn = text(cy - 20 + i * 34, `[ ${label} ]`, 13).setInteractive({ useHandCursor: true });
    btn.on('pointerdown', () => action());
    objects.push(btn);
    return btn;
  });
  scene.confirmDialog = objects;
  scene._setDialogFocus(buttons);
  return objects;
}

function confirm(scene, title, message, label, cancel, change, cancelLabel = 'Keep save') {
  let dialog;
  dialog = present(scene, title, message, [
    [cancelLabel, cancel, true],
    [
      label,
      () => {
        if ((scene.nativeDialog || scene.confirmDialog) !== dialog) return;
        change();
      },
    ],
  ]);
}

function exportCopy(slot) {
  const values = Object.fromEntries(
    [...getSlotDataKeys(slot), getSlotQuarantineKey(slot), getSlotPairJournalKey(slot)].map(
      (key) => [key, localStorage.getItem(key)],
    ),
  );
  const raw = JSON.stringify({ slot, values });
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = `rogue-dawn-slot-${slot}-recovery-${Date.now()}.json`;
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
  return values;
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
    const ownerRaw = retire ? localStorage.getItem(getSlotRecoveryOwnerKey(slot)) : undefined;
    if (retire) archiveRaw = localStorage.getItem(getSlotQuarantineKey(slot));
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
      const keys = retire
        ? getSlotDataKeys(slot).filter((key) => key !== getSlotRecoveryOwnerKey(slot))
        : [getSlotQuarantineKey(slot)];
      for (const key of keys) {
        const value = retire ? null : archiveRaw;
        if (!(await mirror.ensureDurable(key, value)))
          throw new Error('The device backup could not be verified. Your recovery data was kept.');
        if (!ownsDialog()) return;
      }
    }
    if (!ownsDialog()) return;
    const result = retire
      ? retireSlotArchive(slot, localStorage, archiveRaw, ownerRaw)
      : archiveAndDiscardSlot(slot, localStorage, archiveRaw);
    if (!result.ok) throw new Error(result.reason);
    scene.requestCancel({ allowExit: false });
    scene.drawSlots();
    showSlotRecovery(scene, slot);
  } catch (err) {
    if (ownsDialog()) showSlotRecovery(scene, slot, err.message);
  } finally {
    if (scene._recoveryAttempt === attempt) scene._recoveryAttempt = null;
  }
}

function getRawArchive(slot) {
  try {
    return localStorage.getItem(getSlotQuarantineKey(slot));
  } catch {
    return null;
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
  const owner = getSlotRecoveryOwner(slot);
  const accountNotice =
    owner !== null && owner !== scene.registry?.get('cloud')?.userId
      ? 'This recovery data belongs to another or unidentified account. Sign back into the original account to choose its cloud copy. '
      : '';
  const body = archive?.externalCopy
    ? 'Your original bytes are in the export you verified. This local record only reserves the slot; keep the exported file before freeing it.'
    : archived
      ? 'A recovery copy holds your original save. Keep it, or export it before freeing this slot.'
      : 'Your save has been kept. Missing progression will not be replaced with defaults. Retry reading, or archive the original data before discarding it.';
  if (hasDOMHost())
    actions.push([
      'Export recovery copy',
      () => {
        try {
          const snapshot = exportCopy(slot);
          confirm(
            scene,
            `Check Slot ${slot} export`,
            'Save and open the downloaded file. Check that it contains your original data before continuing. If the download failed, keep your local data. Discard removes all local slot data and recovery records; cloud saves are kept.',
            'I verified the export; discard local data',
            () => showSlotRecovery(scene, slot),
            () => {
              const result = discardExportedSlot(slot, snapshot, true);
              scene.drawSlots();
              showSlotRecovery(scene, slot, result.ok ? '' : result.reason);
            },
            'Keep local data',
          );
        } catch (err) {
          showSlotRecovery(scene, slot, err.message);
        }
      },
    ]);
  if (archived) {
    actions.push([
      'Free slot…',
      () =>
        confirm(
          scene,
          `Free Slot ${slot}?`,
          'This removes the local recovery copy. Cloud saves are kept and can return on your next sign-in. Export and check your copy first if you want to keep it.',
          'Delete copy and free slot',
          () => showSlotRecovery(scene, slot),
          () => void confirmRecoveryChange(scene, slot, true),
          'Keep recovery copy',
        ),
    ]);
  } else {
    if (archive?.state === 'archiving')
      actions.push([
        'Retake pending copy',
        () => {
          const result = retakeSlotArchive(slot);
          showSlotRecovery(
            scene,
            slot,
            result.ok ? 'Pending copy updated. Original data was kept.' : result.reason,
          );
        },
      ]);
    actions.push(['Retry read', () => showSlotRecovery(scene, slot)]);
    actions.push([
      'Archive and discard…',
      () =>
        confirm(
          scene,
          `Discard Slot ${slot}?`,
          'A verified recovery copy must be saved before any local data is removed. The slot stays reserved until you separately delete that copy. Cloud data is kept.',
          'Archive and discard',
          () => showSlotRecovery(scene, slot),
          () => void confirmRecoveryChange(scene, slot, false),
        ),
    ]);
  }
  if (archive || getRawArchive(slot) !== null)
    actions.push([
      'Remove copy only…',
      () => {
        const expected = getRawArchive(slot);
        confirm(
          scene,
          `Remove recovery copy for Slot ${slot}?`,
          'This permanently removes only the local recovery copy, which may hold your only original data. Existing slot data and cloud saves are kept. Export and check all recovery data first.',
          'Remove recovery copy',
          () => showSlotRecovery(scene, slot),
          () => {
            const result = forgetSlotArchive(slot, localStorage, expected);
            scene.drawSlots();
            showSlotRecovery(scene, slot, result.ok ? '' : result.reason);
          },
          'Keep recovery copy',
        );
      },
    ]);
  present(
    scene,
    `Slot ${slot} recovery`,
    `${accountNotice}${body}${notice ? `\n\n${notice}` : ''}`,
    actions,
  );
}
