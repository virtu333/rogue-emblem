// Compact labels derived from the existing public objective text. Never inspect
// hidden enemies or change objective rules to construct the sidebar.
export function compactBattleObjective(text = 'Battle') {
  const first = String(text).split('\n')[0];
  const escape = first.match(/^Escape:.*\((\d+\/\d+)\)/);
  if (escape) return `Escape · Lords ${escape[1]}`;
  if (/^Seize: Defeat boss/.test(first)) return 'Seize · Defeat the boss';
  if (/^Seize: Capture throne/.test(first)) return 'Seize · Capture throne';
  // "Rout: 1 enemy remaining" → "Rout · 1 enemy remains" (verb agrees with the count).
  const remaining = first.match(/^(.*?)(\d+) (\S+) remaining$/);
  if (remaining) {
    const [, head, count, noun] = remaining;
    const verb = Number(count) === 1 ? 'remains' : 'remain';
    return `${head}${count} ${noun} ${verb}`.replace(': ', ' · ');
  }
  return first.replace(': ', ' · ');
}
export function sidebarCounters(turnText, charges) {
  const par = String(turnText || '').match(/Par:\s*(\d+)\s*\(([^)]+)\)/);
  return `${par ? `Par ${par[1]} · ${par[2]} | ` : ''}Rewinds ${Math.max(0, Math.trunc(charges || 0))}`;
}
