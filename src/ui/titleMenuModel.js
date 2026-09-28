// titleMenuModel.js — which title actions exist, their labels, badges and order.
// Pure (no DOM, no Phaser) so the contracts are unit-tested: focus order, the
// "Tutorial / Start here" promotion, the single-run Resume shortcut and NEW badges.
//
// Groups: 'run' actions stack in the left column under the lockup; 'reference'
// actions sit in the lower-right cluster. The focus order is run then reference, and
// More Info / Records always close it (second-to-last / last).

/**
 * @param {object} state
 * @param {boolean} state.hasSlots        any save slot exists
 * @param {boolean} state.tutorialDone    tutorial completed on this device
 * @param {{slot:number, actReached:number}|null} state.resumeSlot  the only active run
 * @param {boolean} state.seenHowToPlay
 * @returns {Array<{id:string,label:string,group:'run'|'reference',sub?:string,
 *   badge?:string, primary?:boolean}>}
 */
export function buildTitleMenu({
  hasSlots = false,
  tutorialDone = false,
  resumeSlot = null,
  seenHowToPlay = false,
} = {}) {
  const promoteTutorial = !hasSlots && !tutorialDone;
  const tutorial = {
    id: 'tutorial',
    label: 'Tutorial',
    group: 'run',
    ...(promoteTutorial ? { sub: 'Start here' } : {}),
    ...(hasSlots && !tutorialDone ? { badge: 'New' } : {}),
  };
  const run = [];
  if (promoteTutorial) run.push(tutorial);
  if (resumeSlot)
    run.push({
      id: 'resume',
      label: `Resume · Act ${resumeSlot.actReached ?? 1}`,
      group: 'run',
    });
  run.push({
    id: 'newGame',
    label: !hasSlots && tutorialDone ? 'Start First Run' : 'New Game',
    group: 'run',
  });
  if (hasSlots) run.push({ id: 'saveSlots', label: 'Save Slots', group: 'run' });
  if (!promoteTutorial) run.push(tutorial);
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

/** The single active, uncorrupted run that gets a direct Resume shortcut (or null). */
export function pickResumeSlot(slotSummaries = []) {
  const active = slotSummaries.filter((slot) => slot?.hasActiveRun && !slot.runCorrupt);
  return active.length === 1 ? active[0] : null;
}

/**
 * A slot holds meta progression when its save has anything a new run there
 * would keep: bought upgrades, unspent Valor or Supply, a finished run or a
 * milestone. Only a slot with no run in progress (and no unreadable run) can
 * take a new run without overwriting one. `summary` is getSlotSummary's.
 */
export function hasMetaProgression(summary) {
  if (!summary || summary.hasActiveRun || summary.runCorrupt) return false;
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
