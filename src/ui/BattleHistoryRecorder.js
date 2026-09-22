import { battleTimelinePreview } from '../engine/BattleTimelineFacts.js';
import { historyFrameAt } from '../engine/BattleHistoryPresentation.js';
import { getFootprint } from '../engine/EntitySystem.js';

const copy = (v) => structuredClone(v);
export function historyUnitVisible(scene, unit) {
  return Boolean(
    unit &&
    (unit.faction === 'player' ||
      !scene.grid?.fogEnabled ||
      getFootprint(unit).some((p) => scene.grid.isVisible?.(p.col, p.row))),
  );
}

// Hooks observe resolved intent/outcomes. They never consume RNG, allocate a
// battle entity, save, finish an action, or expose hidden actor coordinates.
export function observeHistoryAction(
  scene,
  type,
  actor,
  target = null,
  detail = '',
  outcome = null,
) {
  if (!scene.runManager?.battleInProgress) return;
  const a = historyUnitVisible(scene, actor),
    t = historyUnitVisible(scene, target);
  if (!a && !t) return;
  const name = a ? actor.name : 'Unseen enemy';
  const targetName = t ? target.name : target ? 'unseen enemy' : '';
  const label = `${name} ${type}${targetName ? ` ${targetName}` : ''}${detail ? ` · ${detail}` : ''}.`;
  if (a) commitHistoryPath(scene, actor);
  const beats = (scene._historyBeats ||= []);
  if (beats.length < 256)
    beats.push({
      type,
      actorId: a ? actor.battleEntityId : null,
      targetId: t ? target.battleEntityId : null,
      actorPosition: a ? { col: actor.col, row: actor.row, size: actor.isEntity ? 3 : 1 } : null,
      targetPosition: t
        ? { col: target.col, row: target.row, size: target.isEntity ? 3 : 1 }
        : null,
      label,
      ...(outcome ? { outcome: copy(outcome) } : {}),
    });
  if (a && actor?.battleEntityId && !scene._historyActor)
    scene._historyActor = actor.battleEntityId;
}

export function rememberHistoryPath(scene, unit, path, staged = true) {
  if (!scene.runManager?.battleInProgress || !unit?.battleEntityId || !Array.isArray(path)) return;
  const clipped = path
    .slice(0, 1024)
    .map((p) =>
      unit.faction === 'player' ||
      !scene.grid?.fogEnabled ||
      getFootprint({ ...unit, col: p.col, row: p.row }).some((tile) =>
        scene.grid.isVisible?.(tile.col, tile.row),
      )
        ? { col: p.col, row: p.row }
        : null,
    );
  if (!clipped.some(Boolean)) return;
  // A hidden endpoint must not give the path an identifying owner.
  const visible = historyUnitVisible(scene, unit);
  const beat = {
    type: 'moved',
    actorId: visible ? unit.battleEntityId : null,
    targetId: null,
    path: clipped,
    label: `${visible ? unit.name : 'An enemy'} moved.`,
  };
  if (staged) (scene._historyStagedPaths ||= new Map()).set(unit.battleEntityId, beat);
  else {
    if ((scene._historyBeats ||= []).length < 256) scene._historyBeats.push(beat);
    if (visible) scene._historyActor = unit.battleEntityId;
  }
}

export function commitHistoryPath(scene, unit) {
  const beat = scene._historyStagedPaths?.get(unit?.battleEntityId);
  if (!beat) return;
  scene._historyStagedPaths.delete(unit.battleEntityId);
  if ((scene._historyBeats ||= []).length < 256) scene._historyBeats.push(beat);
}

export function discardHistoryPath(scene, unit) {
  scene._historyStagedPaths?.delete(unit?.battleEntityId);
}

export function resetHistoryRecording(scene) {
  scene._historyBeats = [];
  scene._historyActor = null;
  scene._historyStagedPaths = new Map();
}

export function captureHistoryFrame(scene, state, archive) {
  const previous = historyFrameAt(archive, (archive?.records.length || 0) - 1);
  const base = battleTimelinePreview(state, scene.gameData?.terrain);
  const allUnits = [...state.playerUnits, ...state.enemyUnits, ...state.npcUnits];
  const byId = new Map(allUnits.map((u) => [u.battleEntityId, u]));
  const live = new Map(
    [...(scene.playerUnits || []), ...(scene.enemyUnits || []), ...(scene.npcUnits || [])].map(
      (u) => [u.battleEntityId, u],
    ),
  );
  const visible = state.fog ? new Set(state.fog.visible) : null;
  const seen = new Set(state.fog?.everSeen || []);
  const cols = state.mapLayout[0].length,
    rows = state.mapLayout.length;
  const priorTiles = previous?.cols === cols && previous?.rows === rows ? previous.tiles : [];
  const tiles = state.mapLayout.flatMap((row, y) =>
    row.map((terrain, x) => {
      const key = `${x},${y}`,
        knownNow = !visible || visible.has(key);
      const old = priorTiles[y * cols + x];
      const explored = seen.has(key);
      const known = knownNow || (explored && old?.known === true);
      const details = [];
      if (knownNow) {
        if (scene.battleConfig?.escapeTiles?.some((t) => t.col === x && t.row === y))
          details.push('Escape route');
        const ballista = state.ballistas?.find((b) => b.col === x && b.row === y);
        if (ballista)
          details.push(`Ballista · ${ballista.owner}${ballista.captured ? ' · captured' : ''}`);
        if (state.villageState?.col === x && state.villageState?.row === y)
          details.push(`Village · ${state.villageState.status}`);
        const temporary = state.temporaryTerrains?.find((t) => t.col === x && t.row === y);
        if (temporary) details.push('Temporary terrain');
      } else if (known) details.push(...(old.details || []));
      return {
        col: x,
        row: y,
        known: Boolean(known),
        details,
        label: knownNow
          ? scene.gameData?.terrain?.[terrain]?.name || 'Terrain'
          : known
            ? old.label
            : 'Unknown',
        fog: knownNow ? 'visible' : explored ? 'explored' : 'unseen',
      };
    }),
  );
  // Use footprint-aware filtering for both the compact preview and full map.
  const units = base.units.map((u) => {
    const data = byId.get(u.id),
      current = live.get(u.id);
    let spriteKey = current?.graphic?.texture?.key || '';
    if (spriteKey.startsWith('contrast-')) spriteKey = spriteKey.slice(9);
    if (!spriteKey && scene.textures?.exists && scene.getSpriteKey && current)
      spriteKey = scene.getSpriteKey(current);
    return {
      ...u,
      name: String(u.name || 'Unit').slice(0, 256),
      className: data?.className || '',
      spriteKey,
      size: data?.isEntity ? 3 : 1,
      width: current?.graphic?.displayWidth || (data?.isEntity ? 92 : 30),
      height: current?.graphic?.displayHeight || (data?.isEntity ? 92 : 30),
      conditions: u.conditions.slice(0, 64),
      buffs: [
        ...(data?._battleTimedWeaponArtBuffs || []).flatMap((b) => Object.entries(b.stats || {})),
        ...Object.entries(data?._battleDeltas || {}),
      ]
        .filter(
          ([stat, value]) =>
            ['HP', 'STR', 'MAG', 'SKL', 'SPD', 'LCK', 'DEF', 'RES', 'MOV'].includes(stat) &&
            Number.isFinite(value) &&
            value !== 0,
        )
        .slice(0, 32)
        .map(([stat, value]) => `${value > 0 ? '+' : ''}${value} ${stat}`),
      affixes: (data?.affixes || []).filter((a) => typeof a === 'string').slice(0, 16),
    };
  });
  return { ...base, version: 2, biome: scene.grid?.biome || '', cols, rows, tiles, units };
}

export function historyRecordInfo(scene, history, entry, frame) {
  const latest = history.presentation?.records.at(-1);
  const parents = copy(latest?.parents || {});
  const actorId = scene._historyActor || scene._pendingActionCompletion?.unitId || null;
  const sequence = history.presentation?.nextId || history.presentationNextId || 1;
  if (actorId && !parents[actorId]) parents[actorId] = sequence;
  const parentId = actorId ? parents[actorId] : null;
  const beats = (scene._historyBeats || []).slice(0, 256);
  const previous = historyFrameAt(
    history.presentation,
    (history.presentation?.records.length || 0) - 1,
  );
  const oldUnits = new Map((previous?.units || []).map((u) => [u.id, u]));
  for (const unit of frame.units) {
    const old = oldUnits.get(unit.id);
    if (!old) continue;
    const changes = [];
    if (old.hp !== unit.hp) changes.push(`HP ${old.hp} → ${unit.hp}`);
    if (old.className !== unit.className) changes.push(unit.className);
    if (JSON.stringify(old.conditions) !== JSON.stringify(unit.conditions))
      changes.push(unit.conditions.join(', ') || 'conditions cleared');
    if (old.acted !== unit.acted && !unit.acted) changes.push('can act again');
    if (JSON.stringify(old.buffs) !== JSON.stringify(unit.buffs))
      changes.push(unit.buffs?.join(', ') || 'stat effects cleared');
    if (changes.length && beats.length < 256)
      beats.push({
        type: 'changed',
        actorId: null,
        targetId: unit.id,
        label: `${unit.name}: ${changes.join(' · ')}.`,
      });
  }
  if (['player_action', 'enemy_action'].includes(entry.kind) && actorId) delete parents[actorId];
  if (entry.kind === 'turn_start' || (entry.kind === 'player_action' && frame.enemiesActNext))
    for (const id of Object.keys(parents)) delete parents[id];
  const facts = [
    ...new Set([...beats.map((b) => b.label), ...entry.facts.filter((f) => typeof f === 'string')]),
  ].slice(0, 256);
  return {
    entryId: entry.id,
    anchorId: entry.id,
    revision: entry.revision,
    generation: history.presentationGeneration || 0,
    kind: entry.kind,
    turnNumber: entry.turnNumber,
    phase: entry.phase,
    parentId,
    actorId,
    parents,
    beats,
    facts,
    gap: !latest,
    endpointOnly: !latest || !beats.length || beats.some((b) => b.path?.some((p) => !p)),
    enemiesActNext: frame.enemiesActNext,
  };
}
