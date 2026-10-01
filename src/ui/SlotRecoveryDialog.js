import {
  getSlotSummary,
  getSlotQuarantineKey,
  getSlotDataKeys,
  getSlotPairJournalKey,
  getSlotRecoveryOwner,
  getSlotRecoveryOwnerKey,
  getSlotCloudPendingKey,
} from '../engine/SlotManager.js';
import {
  archiveAndDiscardSlot,
  archiveSlot,
  readSlotArchive,
  retireSlotArchive,
  prepareSlotCloudPending,
  claimUnassignedCloudPending,
  retakeSlotArchive,
  forgetSlotArchive,
  discardExportedSlot,
  MAX_SLOT_ARCHIVE_BYTES,
  releaseSlotCloudPending,
  slotArchiveByteSize,
} from '../engine/SlotRecovery.js';
import { fetchAllToLocalStorage } from '../cloud/CloudSync.js';
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
    const userId = scene.registry?.get('cloud')?.userId ?? null;
    let pendingRaw;
    if (retire) {
      archiveRaw = localStorage.getItem(getSlotQuarantineKey(slot));
      const pending = prepareSlotCloudPending(slot, userId);
      if (!pending.ok) throw new Error(pending.reason);
      pendingRaw = pending.raw;
    }
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
        ? [
            ...getSlotDataKeys(slot).filter(
              (key) => ![getSlotRecoveryOwnerKey(slot), getSlotCloudPendingKey(slot)].includes(key),
            ),
            getSlotCloudPendingKey(slot),
          ]
        : [getSlotQuarantineKey(slot)];
      for (const key of keys) {
        const value = retire
          ? key === getSlotCloudPendingKey(slot)
            ? pendingRaw
            : null
          : archiveRaw;
        if (!(await mirror.ensureDurable(key, value)))
          throw new Error('The device backup could not be verified. Your recovery data was kept.');
        if (!ownsDialog()) return;
      }
    }
    if (!ownsDialog()) return;
    const result = retire
      ? retireSlotArchive(slot, localStorage, archiveRaw, ownerRaw, userId)
      : archiveAndDiscardSlot(slot, localStorage, archiveRaw);
    if (!result.ok) throw new Error(result.reason);
    if (retire && userId) {
      await fetchAllToLocalStorage(userId);
      if (!ownsDialog()) return;
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
  const signedInUserId = scene.registry?.get('cloud')?.userId;
  const accountNotice = !signedInUserId
    ? 'You are playing offline. Sign in to check a cloud copy, or explicitly release this reservation to use the slot locally. '
    : owner !== null && owner !== signedInUserId
      ? 'This recovery data belongs to another or unidentified account. Sign back into the original account to choose its cloud copy. '
      : '';
  const pending = localStorage.getItem(getSlotCloudPendingKey(slot)) !== null;
  const body =
    pending && !archive
      ? 'Cloud recovery is pending. Retry with the original account to restore its cloud copy. You can also release the reservation below after reviewing the overwrite warning.'
      : archive?.externalCopy
        ? 'Your original bytes are in the export you verified. This local record only reserves the slot; keep the exported file before freeing it.'
        : archived
          ? 'A recovery copy holds your original save. Keep it, or export it before freeing this slot.'
          : 'Your save has been kept. Missing progression will not be replaced with defaults. Retry reading, or archive the original data before discarding it.';
  if (hasDOMHost() && !nativeCapacitor())
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
          'This removes the local recovery copy. Cloud saves are kept. The slot stays reserved while its original account fetches or clears its cloud copy. Export and check your copy first if you want to keep it.',
          'Delete copy and free slot',
          () => showSlotRecovery(scene, slot),
          () => void confirmRecoveryChange(scene, slot, true),
          'Keep recovery copy',
        ),
    ]);
  } else if (pending && !archive) {
    const userId = scene.registry?.get('cloud')?.userId;
    let unassigned = false;
    try {
      const record = JSON.parse(localStorage.getItem(getSlotCloudPendingKey(slot)));
      unassigned = record?.version === 1 && record.userId === null;
    } catch {
      /* Unknown ownership remains blocked. */
    }
    if (unassigned && userId)
      actions.push([
        'Choose this account’s cloud copy…',
        () =>
          confirm(
            scene,
            `Cloud account for Slot ${slot}?`,
            'This local reservation has no original account. Check the signed-in account’s cloud slot. Its cloud run and progression will return together; if it has no copy, the slot can be used again.',
            'Check this account’s cloud copy',
            () => showSlotRecovery(scene, slot),
            async () => {
              const result = claimUnassignedCloudPending(slot, userId);
              if (result.ok) await fetchAllToLocalStorage(userId);
              showSlotRecovery(scene, slot, result.ok ? '' : result.reason);
            },
          ),
      ]);
    actions.push([
      'Retry cloud recovery',
      async () => {
        const userId = scene.registry?.get('cloud')?.userId;
        if (userId) await fetchAllToLocalStorage(userId);
        showSlotRecovery(scene, slot);
      },
    ]);
    actions.push([
      'Release reservation…',
      () => {
        const expected = localStorage.getItem(getSlotCloudPendingKey(slot));
        const mirror = nativeCapacitor() ? getNativeSaveMirror() : null;
        confirm(
          scene,
          `Release Slot ${slot} reservation?`,
          'This gives up automatic cloud recovery for this slot. Existing local data and the cloud copy are kept. A new game or later cloud backup may replace that cloud copy. Only proceed if you accept that loss or have another verified copy.' +
            (nativeCapacitor() && !mirror
              ? ' Device backup is unavailable: this releases the slot on this device only. An older reservation may return after reinstall or storage recovery.'
              : ''),
          'Release reservation',
          () => showSlotRecovery(scene, slot),
          async () => {
            const dialog = scene.nativeDialog || scene.confirmDialog;
            const result = releaseSlotCloudPending(slot, expected);
            if (!result.ok) {
              showSlotRecovery(scene, slot, result.reason);
              return;
            }
            if (mirror) {
              let durable = false;
              try {
                durable = await mirror.ensureDurable(getSlotCloudPendingKey(slot), null);
              } catch {
                /* Keep the reservation unless release reached device storage. */
              }
              if (!durable) {
                // ensureDurable verifies current local bytes; remove first, then
                // acknowledge. Failed acknowledgement restores only our marker.
                if (localStorage.getItem(getSlotCloudPendingKey(slot)) === null)
                  localStorage.setItem(getSlotCloudPendingKey(slot), expected);
                if ((scene.nativeDialog || scene.confirmDialog) === dialog)
                  showSlotRecovery(
                    scene,
                    slot,
                    'Device backup could not verify release. Your reservation was kept. Retry, or choose the explicit device-only exit.',
                  );
                return;
              }
            }
            if (
              (scene.nativeDialog || scene.confirmDialog) !== dialog ||
              scene.sys?.isActive?.() === false
            )
              return;
            scene.drawSlots();
            showSlotRecovery(scene, slot);
          },
          'Keep reservation',
        );
      },
    ]);
    if (nativeCapacitor())
      actions.push([
        'Release on this device only…',
        () => {
          const expected = localStorage.getItem(getSlotCloudPendingKey(slot));
          confirm(
            scene,
            `Release Slot ${slot} locally?`,
            'Use this exit if device backup cannot verify a release. It gives up automatic cloud recovery; a new game or later backup may replace the cloud copy. Local save bytes and cloud data are kept now. An older reservation may return after reinstall or device storage recovery.',
            'Accept risk and release locally',
            () => showSlotRecovery(scene, slot),
            () => {
              const result = releaseSlotCloudPending(slot, expected);
              scene.drawSlots();
              showSlotRecovery(scene, slot, result.ok ? '' : result.reason);
            },
            'Keep reservation',
          );
        },
      ]);
  } else {
    if (archive?.state === 'archiving')
      actions.push([
        'Retake pending copy',
        () =>
          confirm(
            scene,
            `Retake Slot ${slot} copy?`,
            'This replaces the pending recovery copy with the current local bytes. If you need the older original bytes, keep or export the copy first.',
            'Replace pending copy',
            () => showSlotRecovery(scene, slot),
            () => {
              const result = retakeSlotArchive(slot);
              showSlotRecovery(
                scene,
                slot,
                result.ok ? 'Pending copy updated. Original data was kept.' : result.reason,
              );
            },
          ),
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
  if (!archived && (archive || getRawArchive(slot) !== null))
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
  // WKWebView cannot prove a blob download reached Files. Oversized native
  // originals remain reserved; do not offer an export attestation or destruction.
  const nativeOversized =
    nativeCapacitor() &&
    !pending &&
    !archived &&
    slotArchiveByteSize(slot) > MAX_SLOT_ARCHIVE_BYTES;
  if (nativeOversized) actions.splice(1);
  present(
    scene,
    `Slot ${slot} recovery`,
    `${accountNotice}${body}${nativeOversized ? '\n\nThis save is too large for a verified device recovery copy. Keep it on this device; no data has been removed.' : ''}${notice ? `\n\n${notice}` : ''}`,
    actions,
  );
}
