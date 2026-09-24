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
