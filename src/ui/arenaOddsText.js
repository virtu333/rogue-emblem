// "Win about 60% · Lose about 40%": the estimate rounded to 5%, never shown as a
// certainty it isn't: an estimate never says 0% or 100%. Pure (no DOM), so headless
// play (tools/play) words the odds as the arena does.
export function arenaOddsText(odds) {
  const pct = (p) => {
    const v = Math.round((p * 100) / 5) * 5;
    if (v < 5) return 'under 5%';
    if (v > 95) return 'over 95%';
    return `about ${v}%`;
  };
  const parts = [`Win ${pct(odds.win)}`, `Lose ${pct(odds.lose)}`];
  if (odds.draw >= 0.025) parts.push(`Draw ${pct(odds.draw)}`);
  return `If fought to the end: ${parts.join(' · ')}`;
}
