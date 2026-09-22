import { getFootprint } from './EntitySystem.js';
// Presentation projection is captured at the event's visibility, never at the
// later viewer's visibility. No live objects or hidden-unit identifiers escape.
export function timelineUnitVisible(state, unit) {
  return (
    unit.faction === 'player' ||
    !state.fog ||
    getFootprint(unit).some((p) => state.fog.visible.includes(`${p.col},${p.row}`))
  );
}
export function battleTimelinePreview(state, terrain = []) {
  const units = [...state.playerUnits, ...state.enemyUnits, ...state.npcUnits]
    .filter((unit) => timelineUnitVisible(state, unit))
    .map((unit) => ({
      id: unit.battleEntityId,
      name: unit.name,
      faction: unit.faction,
      col: unit.col,
      row: unit.row,
      hp: unit.currentHP,
      maxHP: unit.stats.HP,
      level: unit.level,
      acted: unit.hasActed,
      weapon: unit.weapon?.name || 'Unarmed',
      items: [...(unit.inventory || []), ...(unit.consumables || [])].map(
        (item) => `${item.name}${item.uses != null ? ` (${item.uses})` : ''}`,
      ),
      conditions: (unit._conditions || []).map((condition) => condition.id),
    }));
  const known = state.fog ? new Set([...state.fog.everSeen, ...state.fog.visible]) : null;
  const tiles = [];
  for (let row = 0; row < state.mapLayout.length; row++)
    for (let col = 0; col < state.mapLayout[row].length; col++) {
      if (tiles.length >= 1024) break;
      const visible = !known || known.has(`${col},${row}`);
      tiles.push({
        col,
        row,
        label: visible ? terrain[state.mapLayout[row][col]]?.name || 'Terrain' : 'Unknown',
      });
    }
  return {
    cols: state.mapLayout[0].length,
    rows: state.mapLayout.length,
    tiles,
    units,
    enemiesActNext:
      state.phase === 'player' &&
      state.playerUnits.length > 0 &&
      state.playerUnits.every(
        (unit) =>
          unit.currentHP <= 0 ||
          unit.hasActed ||
          unit._conditions?.some((condition) => condition.id === 'sleep'),
      ),
    summary: [
      `Turn ${state.turnNumber} · ${state.phase === 'player' ? 'Player' : 'Enemy'} phase`,
      `${state.goldEarned || 0} battle gold`,
    ],
  };
}
export function timelineChanges(previous, next) {
  if (!previous) return [];
  const facts = [];
  const previousUnits = new Map(previous.units.map((u) => [u.id, u]));
  for (const unit of next.units) {
    const before = previousUnits.get(unit.id);
    if (!before) continue; // A newly visible enemy isn't necessarily a reinforcement.
    if (unit.faction !== before.faction && unit.faction === 'player')
      facts.push(`${unit.name} joined your army.`);
    if (unit.hp !== before.hp) facts.push(`${unit.name}: HP ${before.hp} → ${unit.hp}.`);
    if (unit.level !== before.level)
      facts.push(`${unit.name}: level ${before.level} → ${unit.level}.`);
    if (unit.col !== before.col || unit.row !== before.row)
      facts.push(`${unit.name} moved to column ${unit.col + 1}, row ${unit.row + 1}.`);
    if (JSON.stringify(unit.items) !== JSON.stringify(before.items))
      facts.push(`${unit.name}'s items changed: ${unit.items.join(', ') || 'none'}.`);
    if (unit.weapon !== before.weapon) facts.push(`${unit.name} equipped ${unit.weapon}.`);
    if (JSON.stringify(unit.conditions) !== JSON.stringify(before.conditions))
      facts.push(`${unit.name}: ${unit.conditions.join(', ') || 'no status conditions'}.`);
  }
  return facts;
}

export function combatTimelineFacts(scene, attacker, defender, result) {
  const visible = (unit) =>
    unit.faction === 'player' ||
    !scene.grid?.fogEnabled ||
    getFootprint(unit).some((p) => scene.grid.isVisible?.(p.col, p.row) === true);
  const name = (unit) => (visible(unit) ? unit.name : 'Unseen enemy');
  const facts = [];
  for (const event of result.events || []) {
    if (event.type !== 'strike') continue;
    const actor = event.attackerSide === 'defender' ? defender : attacker;
    const target = actor === attacker ? defender : attacker;
    if (!visible(actor) && !visible(target)) continue;
    for (const skill of event.skillActivations || []) {
      // Engine activation entries combine attacking and defensive procs;
      // don't guess an owner or expose a hidden actor's skill list.
      if (visible(actor) && visible(target) && (skill.name || skill.id))
        facts.push(`${skill.name || skill.id} activated during this strike.`);
    }
    facts.push(
      event.miss
        ? `${name(actor)} missed ${name(target)}.`
        : `${name(actor)} ${event.isCrit ? 'critically hit' : 'hit'} ${name(target)} for ${event.damage} damage.`,
    );
  }

  return facts.slice(0, 100);
}

export function readOnlyBattleReport(history) {
  if (!history) return null;
  return {
    ...structuredClone(history),
    snapshots: {},
    entries: history.entries.map((entry) => ({
      ...structuredClone(entry),
      snapshotId: null,
      destination: false,
    })),
  };
}
