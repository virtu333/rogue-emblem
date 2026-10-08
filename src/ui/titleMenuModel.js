// titleMenuModel.js — which title actions exist, their labels, badges and order.
// Pure (no DOM, no Phaser) so the contracts are unit-tested: focus order, the
// "Prologue / Start here" promotion, the single-run Resume shortcut and NEW badges.
//
// Groups: 'run' actions stack in the left column under the lockup; 'reference'
// actions sit in the lower-right cluster. The focus order is run then reference, and
// More Info / Records always close it (second-to-last / last).

/**
 * @param {object} state
 * @param {boolean} state.hasSlots        any save slot exists
 * @param {boolean} state.prologueDone    the prologue's practice chapter completed (or skipped
 *   into a first run) on this device
 * @param {boolean} state.hasPrologue     the build ships data/prologue.json
 * @param {{slot:number, actReached:number, latestOf?:number, prologueRun?:boolean}|null} state.resumeSlot
 *   the run Resume opens (pickResumeSlot); `latestOf` > 1 when it is the newest of several;
 *   `prologueRun` when that run is the prologue's (it has no act)
 * @param {boolean} state.seenHowToPlay
 * @returns {Array<{id:string,label:string,group:'run'|'reference',sub?:string,
 *   badge?:string, primary?:boolean}>}
 */
export function buildTitleMenu({
  hasSlots = false,
  prologueDone = false,
  hasPrologue = true,
  resumeSlot = null,
  seenHowToPlay = false,
} = {}) {
  const promotePrologue = hasPrologue && !hasSlots && !prologueDone;
  const prologue = {
    id: 'prologue',
    label: 'Prologue',
    group: 'run',
    ...(promotePrologue ? { sub: 'Start here' } : {}),
    ...(hasSlots && !prologueDone ? { badge: 'New' } : {}),
  };
  const run = [];
  if (promotePrologue) run.push(prologue);
  if (resumeSlot)
    run.push({
      id: 'resume',
      label: resumeSlot.requiresSelection
        ? 'Continue · Select save'
        : resumeSlot.prologueRun
          ? 'Resume · Prologue'
          : `Resume · Act ${resumeSlot.actReached ?? 1}`,
      group: 'run',
      // With several runs going, say which one Resume opens. Short: the desktop stage snaps
      // the 7px subline up to the label's size on some screens ("Latest save · Slot 1" was cut).
      ...(resumeSlot.latestOf > 1 ? { sub: `Latest · Slot ${resumeSlot.slot}` } : {}),
    });
  run.push({
    id: 'newGame',
    // With the prologue shipped, New Game always opens the offer (Skip is its default on
    // a device that finished the prologue), so it is never "Start First Run" there.
    label: !hasSlots && !hasPrologue ? 'Start First Run' : 'New Game',
    group: 'run',
  });
  if (hasSlots) run.push({ id: 'saveSlots', label: 'Save Slots', group: 'run' });
  if (hasPrologue && !promotePrologue) run.push(prologue);
  if (run.length) run[0] = { ...run[0], primary: true };

  const reference = [
    {
      id: 'howToPlay',
      label: 'How to Play',
      group: 'reference',
      ...(seenHowToPlay ? {} : { badge: 'New' }),
    },
    { id: 'compendium', label: 'Compendium', group: 'reference' },
    { id: 'moreInfo', label: 'More Info', group: 'reference' },
    { id: 'records', label: 'Records', group: 'reference' },
  ];
  return [...run, ...reference];
}

/**
 * The active, uncorrupted run Resume opens: the only one, or with several the most
 * recently saved (then `latestOf` counts them). Null when there is none, or when no
 * single run is known to be newest (a legacy save without a time, or a tie).
 */
export function pickResumeSlot(slotSummaries = []) {
  if (slotSummaries.some((slot) => slot?.recoveryRequired || slot?.runCorrupt))
    return { requiresSelection: true };
  const active = slotSummaries.filter((slot) => slot?.hasActiveRun && !slot.runCorrupt);
  if (active.length === 1) return active[0];
  const newest = newestBy(active, (slot) => slot.savedAt);
  return newest ? { ...newest, latestOf: active.length } : null;
}

/**
 * The slot number of the most recently played save (its run or its meta, whichever
 * saved later) when at least two slots hold saves; null for fewer, or no clear newest.
 */
export function latestSlot(slotSummaries = []) {
  const saved = slotSummaries.filter(Boolean);
  if (saved.length < 2) return null;
  return newestBy(saved, (s) => Math.max(s.savedAt || 0, s.metaSavedAt || 0))?.slot ?? null;
}

/** The entry with the strictly greatest positive time, or null. */
function newestBy(entries, timeOf) {
  let best = null;
  let bestTime = 0;
  let tie = false;
  for (const entry of entries) {
    const time = Number(timeOf(entry)) || 0;
    if (time > bestTime) {
      best = entry;
      bestTime = time;
      tie = false;
    } else if (time === bestTime && time > 0) tie = true;
  }
  return tie ? null : best;
}

/**
 * A slot holds meta progression when its save has anything a new run there
 * would keep: bought upgrades, unspent Valor or Supply, a finished run or a
 * milestone. Only a slot with no run in progress (and no unreadable run) can
 * take a new run without overwriting one. `summary` is getSlotSummary's.
 */
export function hasMetaProgression(summary) {
  if (!summary || summary.recoveryRequired || summary.hasActiveRun || summary.runCorrupt)
    return false;
  return (
    (summary.upgradesOwned || 0) > 0 ||
    (summary.valor || 0) > 0 ||
    (summary.supply || 0) > 0 ||
    (summary.runsCompleted || 0) > 0 ||
    (Array.isArray(summary.milestones) && summary.milestones.length > 0)
  );
}

/**
 * The slot New Game offers to keep its upgrades: among slots with meta
 * progression and no run in progress (a slot waiting on a cloud-save choice
 * is skipped), the most recently saved; ties go to the lower slot. Null when
 * none qualifies.
 */
export function pickUpgradeSlot(slotSummaries = []) {
  return (
    (Array.isArray(slotSummaries) ? slotSummaries : [])
      .filter((summary) => hasMetaProgression(summary) && !summary.cloudConflict)
      .sort((a, b) => (b.metaSavedAt || 0) - (a.metaSavedAt || 0) || a.slot - b.slot)[0] || null
  );
}
