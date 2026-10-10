// ActStartNotice.js — the route map's line for what a blessing paid as the act began
// (RunManager._payActStartGrants): "Advance Pay: +250 gold". Pure.

const COUNT_WORDS = ['', '', 'two', 'three', 'four', 'five', 'six', 'seven'];

/** Where Late Bloom's gain lands: "in its two strongest growths", or every stat but Move. */
function armyStatsWhere(count) {
  const n = Math.trunc(Number(count));
  if (!(n >= 1 && n < 8)) return 'to all stats but Move';
  return n === 1 ? 'in its strongest growth' : `in its ${COUNT_WORDS[n]} strongest growths`;
}

/** One line per paid grant, joined; '' when nothing was paid. */
export function describeActStartGrants(grants) {
  const lines = [];
  for (const grant of Array.isArray(grants) ? grants : []) {
    const name = grant?.blessingName || 'Blessing';
    if (grant?.kind === 'gold') {
      lines.push(`${name}: +${grant.value} gold`);
    } else if (grant?.kind === 'army_stats') {
      lines.push(`${name}: every unit +${grant.value} ${armyStatsWhere(grant.stats)}`);
    } else if (grant?.kind === 'item') {
      const what = grant.count > 1 ? `${grant.count} ${grant.itemName}s` : grant.itemName;
      if (grant.overflow >= grant.count) lines.push(`${name}: no room for ${what}`);
      else if (grant.toConvoy >= grant.count) lines.push(`${name}: ${what} in the convoy`);
      else lines.push(`${name}: ${what} delivered`);
    }
  }
  return lines.join('\n');
}
