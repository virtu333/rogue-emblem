import { readFileSync } from 'node:fs';
import { parse } from 'acorn';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/cloud/supabaseClient.js', () => ({ supabase: null }));
import { isCloudHydrationComplete } from '../src/cloud/CloudSync.js';

const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
const schedulingConditions = [];
function visit(node, ancestors = []) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'CallExpression' && node.callee?.name === 'backgroundCloudRefetch') {
    const enclosingIf = ancestors.findLast((parent) => parent.type === 'IfStatement');
    schedulingConditions.push({
      mode: node.arguments[1]?.value,
      condition: enclosingIf?.test,
    });
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => visit(child, [...ancestors, node]));
    else if (value && typeof value === 'object') visit(value, [...ancestors, node]);
  }
}
visit(ast);

describe('actual startup and login background cloud scheduling', () => {
  it('pins both production scheduling sites', () => {
    expect(schedulingConditions.map(({ mode }) => mode).sort()).toEqual(['login', 'session']);
    expect(schedulingConditions.every(({ condition }) => condition)).toBe(true);
  });

  it.each(['session', 'login'])('retries partial reservation hydration after %s boot', (mode) => {
    const { condition } = schedulingConditions.find((site) => site.mode === mode);
    // Evaluate the actual main.js condition, without booting Phaser or auth UI.
    // Either old scheduling predicate would silently stop on deferred-only pulls.
    const shouldSchedule = new Function(
      'pullResult',
      'cloudPullResult',
      'didBoot',
      'isCloudHydrationComplete',
      `return (${source.slice(condition.start, condition.end)});`,
    );
    for (const [result, expected] of [
      [undefined, true],
      [{ rejectedCount: 1, deferredReservationSlots: [] }, true],
      [{ rejectedCount: 0, deferredReservationSlots: [1] }, true],
      [{ rejectedCount: 0, deferredReservationSlots: [] }, false],
    ])
      expect(shouldSchedule(result, result, true, isCloudHydrationComplete)).toBe(expected);
    if (mode === 'login')
      expect(shouldSchedule(undefined, undefined, false, isCloudHydrationComplete)).toBe(false);
  });
});
