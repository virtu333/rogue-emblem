// prologueCoachModel — what the prologue coach says right now (pure, no DOM/Phaser).
//
// The coach is the chapter's persistent objective line: one goal at a time, anchored to
// the thing it is about. While a beat's guided step is live (a coach goal with its gate,
// prologueContent.PROLOGUE_COACH) that goal shows; afterwards the goal is derived from
// battle state. Blocking "Field notes" remain only for explanations the player must
// read (forecast, terrain, resources).

export const COACH_CHAPTERS = Object.freeze([
  { id: 'select', label: 'Select' },
  { id: 'move', label: 'Move' },
  { id: 'fight', label: 'Fight' },
  { id: 'win', label: 'Win' },
]);

const CHAPTER_INDEX = Object.fromEntries(COACH_CHAPTERS.map((c, i) => [c.id, i]));

/**
 * @param {object} s  plain snapshot built by PrologueCoach.snapshot()
 * @param {null|{id:string, goal:string, detail:string, chapter:string, anchor:object|null,
 *   canSkip:boolean}} s.scripted  the live guided step's goal, if any
 * @param {boolean} s.gated         a guided step still blocks free play
 * @param {string} s.phase          'player' | 'enemy'
 * @param {string} s.state          scene.battleState
 * @param {boolean} s.touch         phrase for taps instead of clicks
 * @param {string} s.commanderName  the lord whose fall restarts the chapter
 * @param {Array<{name:string, acted:boolean, hp:number, maxHp:number, healer:boolean,
 *   healItem?:string|null}>} s.units  (`healItem`: the first item it carries that heals)
 * @param {number} s.enemies        enemies still standing
 * @param {string[]} [s.menu]       choosable labels in the open action menu
 * @param {string} [s.selected]     selected unit's name
 * @param {boolean} [s.selectionMenu] the tap-selected menu (unit can still move)
 * @param {number} [s.turn]       the turn (the fall warning is turn 1's advice)
 * @param {string[]} [s.strikers] ready units that can strike a seen foe this turn
 * @param {Array<{name:string, col:number, row:number, waits:boolean}>} [s.foes] seen foes
 *   (`waits`: guards or holds its post rather than coming to the player)
 * @param {string[]} [s.recruitsPending] green units the rout requires in the army
 *   (RoutObjective.pendingRequiredRecruits): the goal once the field is clear
 * @returns {null | {id:string, chapter:string, goal:string, detail:string,
 *   anchor:null|{kind:'unit'|'tile'|'hud', name?:string, col?:number, row?:number, hud?:string}, canSkip:boolean}}
 */
export function prologueCoachState(s) {
  if (!s) return null;
  if (s.scripted) return { canSkip: false, anchor: null, ...s.scripted, scriptedStep: true };
  if (s.gated) return null; // a note of the guided step is showing
  const tap = s.touch ? 'Tap' : 'Click';
  const lord = s.commanderName || 'Edric';
  const pending = Array.isArray(s.recruitsPending) ? s.recruitsPending.filter(Boolean) : [];
  if (s.enemies <= 0) {
    // The field is clear but the chapter waits on a recruit (P3's Sera): the one
    // objective left, whatever is open. Without one the victory flow owns the screen.
    if (!pending.length) return null;
    const who = pending[0];
    return {
      id: 'recruit-required',
      chapter: 'win',
      goal: `Reach ${who} and Talk`,
      detail: `The road is clear, but ${who} must join before this chapter ends. Move ${lord} next to ${who} and choose Talk. Only a lord can.`,
      anchor: { kind: 'unit', name: lord },
      canSkip: false,
    };
  }
  const remaining = s.enemies === 1 ? 'the last enemy' : `all ${s.enemies} enemies`;
  if (s.phase === 'enemy')
    return {
      id: 'enemy',
      chapter: 'fight',
      goal: 'Enemy phase',
      detail: 'Red units move and strike now. Units in cover take less damage.',
      anchor: null,
      canSkip: false,
    };
  if (s.state === 'UNIT_ACTION_MENU' && s.selectionMenu)
    return {
      id: 'move-free',
      chapter: 'fight',
      goal: `Move ${s.selected || 'your unit'}`,
      detail: `${tap} a blue tile to move — or act from where ${s.selected || 'it'} stands.`,
      anchor: null,
      canSkip: false,
    };
  if (s.state === 'UNIT_ACTION_MENU') {
    const menu = s.menu || [];
    const canAttack = menu.includes('Attack');
    const canHeal = menu.some((label) => /^Heal\b|^Staff\b/.test(label));
    return {
      id: canAttack ? 'act-attack' : canHeal ? 'act-heal' : 'act-wait',
      chapter: 'fight',
      goal: canAttack ? 'Attack' : 'Choose an action',
      detail: canAttack
        ? 'Attack opens a forecast first — nothing happens until you confirm.'
        : canHeal
          ? `${s.selected || 'This unit'} can use a staff on a highlighted ally.`
          : 'No enemy in reach. Wait ends this move; Item uses a Vulnerary.',
      anchor: { kind: 'hud', hud: canAttack ? 'attack' : 'actions' },
      canSkip: false,
    };
  }
  if (s.state === 'UNIT_SELECTED')
    return {
      id: 'move-free',
      chapter: 'fight',
      goal: `Move ${s.selected || 'your unit'}`,
      detail: `${tap} a blue tile. Red tiles show what it could strike from there.`,
      anchor: null,
      canSkip: false,
    };
  if (s.state?.startsWith?.('SELECTING_'))
    return {
      id: 'target',
      chapter: 'fight',
      goal: 'Choose a target',
      detail: `${tap} a highlighted unit, or Back to change your mind.`,
      anchor: null,
      canSkip: false,
    };
  if (s.state !== 'PLAYER_IDLE') return null;
  const units = s.units || [];
  const ready = units.filter((u) => !u.acted && u.hp > 0);
  if (units.length && !ready.length)
    return {
      id: 'end-turn',
      chapter: 'fight',
      goal: 'End your turn',
      detail: 'Everyone has acted. End turn and the enemy moves next.',
      anchor: { kind: 'hud', hud: 'end-turn' },
      canSkip: false,
    };
  const wounded = units.find((u) => u.hp > 0 && u.hp <= u.maxHp * 0.5);
  const healer = ready.find((u) => u.healer && u !== wounded);
  if (wounded && !wounded.acted && !healer) {
    // What it can heal with: its own item, an ally's by Trade (Trade keeps its turn,
    // so Item follows in the same action), or nothing but distance. A snapshot without
    // `healItem` (older callers) keeps the general advice.
    const known = units.some((u) => 'healItem' in u);
    const donor = units.find((u) => u !== wounded && u.hp > 0 && u.healItem);
    const own = wounded.healItem;
    const detail =
      !known || own
        ? `${wounded.name} is badly hurt. Select ${wounded.name}, then Item → ${own || 'Vulnerary'} — or pull back out of reach.`
        : donor
          ? `${wounded.name} is badly hurt and carries no ${donor.healItem}, but ${donor.name} does. Move ${wounded.name} next to ${donor.name}, choose Trade and take it, then Item → ${donor.healItem}. Or pull back out of reach.`
          : `${wounded.name} is badly hurt and has nothing to heal with. Pull back out of the red reach.`;
    return {
      id: 'protect',
      chapter: 'fight',
      goal: `Protect ${wounded.name}`,
      detail,
      anchor: { kind: 'unit', name: wounded.name },
      canSkip: false,
    };
  }
  if (wounded && healer)
    return {
      id: 'heal',
      chapter: 'fight',
      goal: `Heal ${wounded.name}`,
      detail: `${healer.name} carries a Heal staff: move next to ${wounded.name}, then choose Heal.`,
      anchor: { kind: 'unit', name: healer.name },
      canSkip: false,
    };
  // The fall warning is the chapter's opening advice; later turns leave it out.
  const safety =
    (Number(s.turn) || 1) <= 1
      ? ` Keep ${lord} safe: if he falls, this chapter starts over. In a real run, the whole run would end.`
      : '';
  const chapter = s.enemies === 1 ? 'win' : 'fight';
  // Who could strike a foe this turn (move, then weapon reach), when the scene says.
  const strikers = Array.isArray(s.strikers)
    ? ready.filter((u) => s.strikers.includes(u.name))
    : null;
  const foes = Array.isArray(s.foes) ? s.foes : [];
  if (strikers && !strikers.length && ready.length && foes.length) {
    // Nobody reaches a foe this turn: the goal is to close in, pointing at the nearest.
    const nearest = nearestFoe(foes, ready);
    const waiting = foes.every((f) => f.waits);
    return {
      id: 'advance',
      chapter,
      goal: s.enemies === 1 ? 'Advance on the last enemy' : 'Advance on the enemy',
      detail: waiting
        ? `${foes.length === 1 ? `The ${nearest.name} holds its ground` : 'They hold their ground'} and won't come to you. No one can reach ${foes.length === 1 ? 'it' : 'them'} this turn: move closer, then End turn.${safety}`
        : `No one can reach an enemy this turn. Move closer, or take cover and let them come: Danger shows their reach.${safety}`,
      anchor: nearest ? { kind: 'tile', col: nearest.col, row: nearest.row } : null,
      canSkip: false,
    };
  }
  const pool = strikers?.length ? strikers : ready;
  const fighter = pool.find((u) => u.name === s.selected) || pool.find((u) => !u.healer) || pool[0];
  const range = fighter?.attackRange;
  const approach =
    range?.max > 1
      ? `move into weapon range of a red enemy (${range.min === range.max ? range.max : `${range.min}–${range.max}`} tiles)`
      : 'move next to a red enemy';
  return {
    id: 'fight',
    chapter,
    goal: s.enemies === 1 ? 'Defeat the last enemy' : `Defeat ${remaining}`,
    detail: strikers?.length
      ? `${fighter.name} can reach an enemy this turn: ${approach}, then Attack.${safety}`
      : `Select ${fighter?.name || 'a unit'}, ${approach}, then Attack.${safety}`,
    anchor: null,
    canSkip: false,
  };
}

/** The visible foe closest to any ready unit (grid steps). */
function nearestFoe(foes, units) {
  let best = null;
  let bestDistance = Infinity;
  for (const foe of foes)
    for (const unit of units) {
      if (!Number.isInteger(unit.col)) continue;
      const d = Math.abs(foe.col - unit.col) + Math.abs(foe.row - unit.row);
      if (d < bestDistance) [best, bestDistance] = [foe, d];
    }
  return best || foes[0] || null;
}

/**
 * Labels of the action-menu rows the player can choose right now: the phone rail's
 * items when it shows the menu, else the canvas rows (Phaser Text: the label is
 * `.text`). Greyed rows (Silenced, a guidance hold) are not offered.
 */
export function availableMenuLabels(scene) {
  const hudItems = scene?._mobileBattleHud?.menu?.items;
  if (Array.isArray(hudItems))
    return hudItems
      .filter((item) => item && !item.disabled && item.label)
      .map((item) => item.label);
  return (scene?.actionMenu || [])
    .filter((row) => typeof row?._action === 'function' && !row._menuDisabled && row.text)
    .map((row) => row.text);
}

export function coachChapterIndex(chapter) {
  return CHAPTER_INDEX[chapter] ?? 0;
}
