// The battle rewards' Reroll button (Branching Threads, a Home Base upgrade). Pure: turns
// the engine's reroll status (engine/PendingBattleRewards.js rewardRerollStatus) into what
// the button shows. Hidden when the run has no rerolls at all, so nothing changes for a
// player without the upgrade.

/**
 * @param {{ granted: number, left: number, block: string } | null} status
 * @returns {{ hidden: true } | { hidden: false, disabled: boolean, label: string, reason: string }}
 */
export function rewardRerollButtonState(status) {
  const granted = Math.max(0, Math.trunc(Number(status?.granted) || 0));
  if (granted <= 0 || status?.block === 'none' || status?.block === 'noReward')
    return { hidden: true };
  const left = Math.max(0, Math.trunc(Number(status.left) || 0));
  if (left <= 0 || status.block === 'spent')
    return {
      hidden: false,
      disabled: true,
      label: 'No rerolls left',
      reason: 'Every reroll this run is spent.',
    };
  const label = `Reroll (${left})`;
  if (status.block === 'picked')
    return {
      hidden: false,
      disabled: true,
      label,
      reason: 'Rerolls only before the first pick.',
    };
  if (status.block)
    return { hidden: false, disabled: true, label, reason: 'These rewards cannot be rerolled.' };
  return {
    hidden: false,
    disabled: false,
    label,
    reason: `Draw new choices. ${left} ${left === 1 ? 'reroll' : 'rerolls'} left this run.`,
  };
}
