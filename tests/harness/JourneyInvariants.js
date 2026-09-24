import { isDeepStrictEqual } from 'node:util';

// Explicit semantic projection; no save/fromJSON call here. UID stamping of
// legacy items is allowed, but item contents, ordering, ownership and equipment
// remain observable. Battle-only state is outside this service harness.
const clone = (value) => JSON.parse(JSON.stringify(value ?? null));
function item(value) {
  if (!value) return null;
  const { uid: _uid, ...fields } = value;
  return clone(fields);
}
function unit(u) {
  const fields = [
    'name',
    'className',
    'tier',
    'level',
    'xp',
    'currentHP',
    'stats',
    'growths',
    'proficiencies',
    'skills',
    'isLord',
    'faction',
    '_hired',
    '_fallenItemsNotice',
    'extendedLevel',
  ];
  return {
    ...Object.fromEntries(fields.map((key) => [key, clone(u[key])])),
    inventory: (u.inventory || []).map(item),
    consumables: (u.consumables || []).map(item),
    weapon: item(u.weapon),
    accessory: item(u.accessory),
  };
}
function stock(state) {
  if (!state) return null;
  return {
    ...clone(state),
    items: (state.items || []).map((entry) => ({ ...entry, item: item(entry.item) })),
  };
}
export function journeySnapshot(run) {
  if (!run) return null;
  return {
    identity: [run.runSeed, run.actIndex, run.currentAct],
    status: run.status,
    currentNodeId: run.currentNodeId,
    nodes: run.nodeMap.nodes.map((n) => ({
      id: n.id,
      completed: !!n.completed,
      arena: n.colosseumState
        ? {
            ...clone(n.colosseumState),
            mercCandidates: (n.colosseumState.mercCandidates || []).map((c) => ({
              ...c,
              unit: unit(c.unit),
            })),
          }
        : null,
    })),
    gold: run.gold,
    completedBattles: run.completedBattles,
    roster: run.roster.map(unit),
    fallenUnits: run.fallenUnits.map(unit),
    convoy: {
      weapons: (run.convoy?.weapons || []).map(item),
      consumables: (run.convoy?.consumables || []).map(item),
    },
    accessories: (run.accessories || []).map(item),
    scrolls: (run.scrolls || []).map(item),
    shops: Object.fromEntries(
      Object.entries(run.shopStateByNodeId || {}).map(([key, state]) => [key, stock(state)]),
    ),
    pendingCaravanShop: clone(run.pendingCaravanShop),
    activeCaravanShop: run.activeCaravanShop
      ? { ...clone(run.activeCaravanShop), shopState: stock(run.activeCaravanShop.shopState) }
      : null,
    churchPromotionTracker: clone(run._churchPromotionTracker),
    shownDialogueKeys: clone(run.shownDialogueKeys || []),
  };
}
export function assertJourneyEqual(expected, actual, boundary) {
  for (const key of new Set([...Object.keys(expected || {}), ...Object.keys(actual || {})])) {
    if (!isDeepStrictEqual(expected?.[key], actual?.[key])) {
      const error = new Error(`Journey persistence: ${boundary}: ${key} differs`);
      error.stateDiff = { field: key, expected: expected?.[key], actual: actual?.[key] };
      throw error;
    }
  }
}
export function assertNodeMonotonic(previous, next) {
  if (!previous || !next || !isDeepStrictEqual(previous.identity, next.identity)) return;
  for (const node of previous.nodes.filter((n) => n.completed)) {
    if (!next.nodes.find((n) => n.id === node.id)?.completed)
      throw new Error(`Journey node monotonicity: ${node.id} became incomplete`);
  }
}
export function assertCaravanEntry(run) {
  if (run.pendingCaravanShop || !Array.isArray(run.activeCaravanShop?.shopState?.items))
    throw new Error('Journey caravan entry: consume pending reward and cache stock');
}
export function assertServiceLeave(run, service) {
  if (service === 'caravan') {
    if (run.getPendingCaravanShop()) throw new Error('Journey leave: caravan still active');
    return;
  }
  const id = `journey-${service}`;
  if (!run.nodeMap.nodes.find((node) => node.id === id)?.completed || run.currentNodeId !== id)
    throw new Error(`Journey leave: ${service} completion or position missing`);
}
export function assertAbandonPayout(before, expected, after, savedRun) {
  if (savedRun) throw new Error('Journey abandon: run save was not removed');
  for (const [field, amount] of [
    ['totalValor', expected.valor],
    ['totalSupply', expected.supply],
    ['runsCompleted', 1],
  ]) {
    if (after[field] !== before[field] + amount)
      throw new Error(`Journey abandon: ${field} payout differs`);
  }
}
