import { findCommander } from './Commander.js';

export function normalizeDeploymentNames(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter((name) => typeof name === 'string' && name.length > 0))]
    : [];
}

// Stored order wins when caps shrink. Never silently select replacement units.
export function resolveDeploymentSelection(roster, limits, names) {
  const selected = new Set();
  const commander = findCommander(roster);
  if (commander && limits.max > 0) selected.add(commander);
  for (const name of normalizeDeploymentNames(names)) {
    const unit = roster.find((entry) => entry.name === name);
    if (unit && selected.size < limits.max) selected.add(unit);
  }
  return [...selected];
}
