// Presentation only: never scale the scene clock or lifecycle watchdogs.
// Generic brief banners carry errors/instructions, so retain their reading window.
// Skill banners may accelerate: learned skills remain listed in the progression popup.
const COMBAT_WAITS = new Set([
  'terrain_damage_tint_clear',
  'terrain_damage_tail',
  'acid_damage_tint_clear',
  'acid_damage_tail',
  'death_affix_chain_tick',
  'entity_splash_tick',
  'enemy_break_hold',
  'ballista_hit_float',
  'ballista_miss_float',
  'show_poison_damage',
  'show_skill_learned_banner',
  'animate_enemy_move_step',
  'combat_fx_lunge_fallback',
  'combat_fx_windup',
  'combat_fx_lunge_forward',
  'combat_fx_lunge_back',
  'combat_fx_travel',
  'combat_fx_hit_stop',
  'combat_fx_death_fade',
  'proc_banner_in',
  'proc_banner_hold',
  'proc_banner_out',
  'proc_cutin_in',
  'proc_cutin_hold',
  'proc_cutin_out',
  'animate_strike_miss_hold',
  'animate_strike_hit_hold',
  'execute_warp_fade_out',
  'execute_warp_fade_in',
  'staff_relocate_fade_out',
  'staff_relocate_fade_in',
  'animate_cure_tint_clear',
  'animate_cure_tail',
  'animate_heal_tint_clear',
  'animate_heal_tail',
  // The EXP gauge (XpGaugeController): its fill and wrap beat, its closing hold.
  'xp_gauge_fill',
  'xp_gauge_hold',
  // The beat after an enemy whose turn the player saw (ui/EnemyPhasePacing.js).
  'enemy_between_units',
]);
export const BATTLE_SPEEDS = ['normal', 'fast', 'instant'];
export function battleSpeed(scene) {
  const value =
    scene?._combatSpeedSnapshot ?? scene?.registry?.get?.('settings')?.getBattleSpeed?.();
  if (value !== 'instant' && scene?._holdBattleFast && scene?._combatSpeedSnapshot !== undefined)
    return 'fast';
  return BATTLE_SPEEDS.includes(value) ? value : 'normal';
}
/**
 * The battle speed between exchanges of the enemy phase: battleSpeed, with
 * hold-to-fast-forward counted as Fast while the enemy phase runs. battleSpeed reads
 * the hold only inside a combat's speed snapshot; the EXP gauge and the beat between
 * enemies play outside it, so they read the hold here.
 */
export function enemyPhaseSpeed(scene) {
  const speed = battleSpeed(scene);
  if (speed !== 'instant' && scene?._holdBattleFast && scene?.turnManager?.currentPhase === 'enemy')
    return 'fast';
  return speed;
}
export function combatDuration(scene, milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return milliseconds;
  const speed = battleSpeed(scene);
  return speed === 'instant' ? 1 : speed === 'fast' ? milliseconds * 0.5 : milliseconds;
}
export function waitDuration(scene, label, milliseconds) {
  return COMBAT_WAITS.has(label) ? combatDuration(scene, milliseconds) : milliseconds;
}
/**
 * waitDuration at a known speed: a presenter that reads the speed itself (the EXP
 * gauge counts hold-to-fast-forward in the enemy phase as Fast) scales its waits here.
 */
export function speedDuration(speed, label, milliseconds) {
  if (!COMBAT_WAITS.has(label) || !Number.isFinite(milliseconds) || milliseconds <= 0)
    return milliseconds;
  return speed === 'instant' ? 1 : speed === 'fast' ? milliseconds * 0.5 : milliseconds;
}
export function combatTween(scene, config) {
  const scaled = { ...config };
  for (const key of ['duration', 'delay', 'hold', 'repeatDelay']) {
    if (typeof scaled[key] === 'number') scaled[key] = combatDuration(scene, scaled[key]);
  }
  return scaled;
}
export function waitTween(scene, label, config) {
  return COMBAT_WAITS.has(label) ? combatTween(scene, config) : { ...config };
}
