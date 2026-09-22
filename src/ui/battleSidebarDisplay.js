// Compact labels derived from the existing public objective text. Never inspect
// hidden enemies or change objective rules to construct the sidebar.
export function compactBattleObjective(text = 'Battle') {
  const first = String(text).split('\n')[0];
  const escape = first.match(/^Escape:.*\((\d+\/\d+)\)/);
  if (escape) return `Escape · Lords ${escape[1]}`;
  if (/^Seize: Defeat boss/.test(first)) return 'Seize · Defeat the boss';
  if (/^Seize: Capture throne/.test(first)) return 'Seize · Capture throne';
  return first.replace(': ', ' · ').replace(' remaining', ' remain');
}
export function sidebarCounters(turnText, charges) {
  const par = String(turnText || '').match(/Par:\s*(\d+)\s*\(([^)]+)\)/);
  return `${par ? `Par ${par[1]} · ${par[2]} | ` : ''}Rewinds ${Math.max(0, Math.trunc(charges || 0))}`;
}
