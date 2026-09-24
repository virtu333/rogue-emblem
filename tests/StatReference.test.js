import { it, expect } from 'vitest';
import consumables from '../data/consumables.json';
import { statReferenceEntries } from '../src/ui/statReference.js';
import reference from '../data/referenceViewer.json';
it('covers each stat and draws booster values from live data', () => {
  const rows = statReferenceEntries({ consumables });
  expect(rows).toHaveLength(18);
  expect(rows.filter((r) => r.type === 'Core')).toHaveLength(9);
  for (const item of consumables.filter((i) => i.effect === 'statBoost')) {
    const entry = rows.find((r) => r.type === 'Core' && r.name.startsWith(item.stat + ' —'));
    expect(entry.referenceLines.join(' ')).toContain(`${item.name} +${item.value}`);
  }
  expect(rows.find((r) => r.name.startsWith('MOV')).description).toContain('never grows');
  expect(rows.find((r) => r.name === 'Attack (Atk)').referenceLines).toContain(
    reference.combat.effectiveDamageRule,
  );
  expect(rows.find((r) => r.name === 'Hit').description).toContain('+15 / -5');
  expect(rows.find((r) => r.name === 'Crit / Crit Avoid').description).toContain('15-point');
});
