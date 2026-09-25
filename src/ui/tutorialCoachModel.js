// tutorialCoachModel — what the tutorial coach says right now (pure, no DOM/Phaser).
//
// The coach is the tutorial's persistent objective line: one goal at a time,
// anchored to the thing it is about, derived from battle state rather than
// pushed as modal text. Blocking "Field notes" remain only for explanations the
// player must read (forecast, terrain, resources, permadeath, rewind).

export const COACH_CHAPTERS = Object.freeze([
  { id: 'select', label: 'Select' },
  { id: 'move', label: 'Move' },
  { id: 'fight', label: 'Fight' },
  { id: 'win', label: 'Win' },
]);

const CHAPTER_INDEX = Object.fromEntries(COACH_CHAPTERS.map((c, i) => [c.id, i]));

/**
 * @param {object} s  plain snapshot built by TutorialCoach.snapshot()
 * @param {number} s.step            scene.tutorialStep
 * @param {boolean} s.gateReleased   movement lesson finished or skipped
 * @param {string} s.phase           'player' | 'enemy'
 * @param {string} s.state           scene.battleState
 * @param {boolean} s.touch          phrase for taps instead of clicks
 * @param {string} s.commanderName   the lord whose fall loses the battle
 * @param {Array<{name:string, acted:boolean, hp:number, maxHp:number, healer:boolean}>} s.units
 * @param {number} s.enemies         enemies still standing
 * @param {string[]} [s.menu]        labels in the open action menu
 * @param {string} [s.selected]      selected unit's name
 * @param {boolean} [s.selectionMenu] the tap-selected menu (unit can still move)
 * @returns {null | {id:string, chapter:string, goal:string, detail:string,
 *   anchor:null|{kind:'unit'|'fort'|'hud', name?:string, hud?:string}, canSkip:boolean}}
 */
export function tutorialCoachState(s) {
  if (!s || !Number.isFinite(s.step) || s.step < 2) return null;
  const tap = s.touch ? 'Tap' : 'Click';
  const lord = s.commanderName || 'Edric';
  if (!s.gateReleased) {
    if (s.step <= 2)
      return {
        id: 'select',
        chapter: 'select',
        goal: `Select ${lord}`,
        detail: `Blue units are yours; red are the empire's. ${tap} ${lord} to see where he can move.`,
        anchor: { kind: 'unit', name: lord },
        canSkip: true,
      };
    if (s.step === 3)
      return {
        id: 'move',
        chapter: 'move',
        goal: 'Move onto the Fort',
        detail: `Blue tiles show his reach. ${tap} the gold-framed Fort — cover makes him harder to hit and hurt.`,
        anchor: { kind: 'fort' },
        canSkip: true,
      };
    return null; // arrival lesson (Field notes) is showing
  }
  if (s.enemies <= 0) return null; // victory flow owns the screen
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
          ? `${s.selected || 'This unit'} can Heal a wounded ally next to her.`
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
  if (wounded && !wounded.acted && !healer)
    return {
      id: 'protect',
      chapter: 'fight',
      goal: `Protect ${wounded.name}`,
      detail: `${wounded.name} is badly hurt. Select ${wounded.name}, then Item → Vulnerary — or pull back out of reach.`,
      anchor: { kind: 'unit', name: wounded.name },
      canSkip: false,
    };
  if (wounded && healer)
    return {
      id: 'heal',
      chapter: 'fight',
      goal: `Heal ${wounded.name}`,
      detail: `${healer.name} carries a Heal staff: move next to ${wounded.name}, then choose Heal.`,
      anchor: { kind: 'unit', name: healer.name },
      canSkip: false,
    };
  return {
    id: 'fight',
    chapter: s.enemies === 1 ? 'win' : 'fight',
    goal: s.enemies === 1 ? 'Defeat the last enemy' : `Defeat ${remaining}`,
    detail: `Select a unit, move next to a red enemy, then Attack. Keep ${lord} safe — if he falls, the battle is lost.`,
    anchor: null,
    canSkip: false,
  };
}

export function coachChapterIndex(chapter) {
  return CHAPTER_INDEX[chapter] ?? 0;
}
