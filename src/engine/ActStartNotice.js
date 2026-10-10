// ActStartNotice.js — the route map's line for what a blessing paid as the act began
// (RunManager._payActStartGrants): "Advance Pay: +250 gold". Pure.

/** One line per paid grant, joined; '' when nothing was paid. */
export function describeActStartGrants(grants) {
  const lines = [];
  for (const grant of Array.isArray(grants) ? grants : []) {
    const name = grant?.blessingName || 'Blessing';
    if (grant?.kind === 'gold') {
      lines.push(`${name}: +${grant.value} gold`);
    } else if (grant?.kind === 'item') {
      const what = grant.count > 1 ? `${grant.count} ${grant.itemName}s` : grant.itemName;
      if (grant.overflow >= grant.count) lines.push(`${name}: no room for ${what}`);
      else if (grant.toConvoy >= grant.count) lines.push(`${name}: ${what} in the convoy`);
      else lines.push(`${name}: ${what} delivered`);
    }
  }
  return lines.join('\n');
}
