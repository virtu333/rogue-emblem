import { isolateBattleTextFactory } from '../../src/utils/presentationText.js';

/** Count actual rendering calls, including fluent calls, and fail a chosen call.
 * Lifecycle predicates deliberately remain real booleans, never generic proxies.
 */
export function presentationFailureProxy(scene, failure = 0, { skipped = false } = {}) {
  let calls = 0;
  const labels = [];
  const call =
    (fn = () => {}, label = 'presentation') =>
    (...args) => {
      labels.push(label);
      calls++;
      if (failure === 'all' || calls === failure) throw new Error(`Renderer unavailable: ${label}`);
      return fn(...args);
    };
  const visual = new Proxy(
    {},
    {
      get: (_, key) => {
        if (key === 'then' || key === 'scene' || key === 'isTinted') return undefined;
        if (['x', 'y'].includes(key)) return 32;
        if (['width', 'height', 'displayWidth', 'displayHeight'].includes(key)) return 30;
        if (key === 'alpha') return 1;
        return call(() => visual, `visual.${String(key)}`);
      },
    },
  );
  const surface = (methods, prefix = 'surface', uncounted = []) =>
    new Proxy(methods, {
      get: (target, key) =>
        typeof target[key] === 'function' && !uncounted.includes(key)
          ? call(target[key], `${prefix}.${String(key)}`)
          : target[key],
    });
  scene.add = surface(
    {
      text: () => {
        Math.random();
        return visual;
      },
      image: () => visual,
      rectangle: () => visual,
      graphics: () => visual,
      container: () => visual,
      sprite: () => visual,
    },
    'add',
  );
  scene.tweens = surface({ add: () => {}, killTweensOf: () => {}, killAll: () => {} }, 'tweens');
  const fxMethods = Object.fromEntries(
    [
      'tintUnit',
      'lungeForward',
      'travel',
      'dodge',
      'playImpact',
      'playProcOverlays',
      'playArtBurst',
      'impactLight',
      'vignettePulse',
      'moteBurst',
      'critImpact',
      'zoomPunch',
      'recoil',
      'playDust',
      'driftHome',
      'brace',
      'lungeBack',
      '_later',
      'playStrikeSound',
      'finishStrike',
      'deathFade',
      'playOverlay',
      'playStatus',
      'clear',
    ].map((name) => [name, () => {}]),
  );
  scene._combatFx = surface(
    { ...fxMethods, _live: () => !skipped, stale: () => false, epoch: 0 },
    'fx',
    ['_live', 'stale'],
  );
  scene._musicCtrl = surface({ onCombat() {}, onCombatResolved() {} }, 'music');
  scene._battleBeats = surface(
    {
      onKill() {},
      onAllyFall() {},
      onCritStrike() {},
      onChipLance() {},
      onLowHealth() {},
      checkBossHalfHealth() {},
    },
    'beats',
  );
  scene._inputController = surface({ refreshHoverInfo() {} }, 'input');
  scene._pinnedThreats = surface({ invalidate() {} }, 'pinned');
  scene.hideActionMenu = call(scene.hideActionMenu.bind(scene), 'hideActionMenu');
  scene.grid.clearAttackHighlights = call(
    scene.grid.clearAttackHighlights.bind(scene.grid),
    'grid.clearAttackHighlights',
  );
  for (const name of [
    'updateHPBar',
    'removeUnitGraphic',
    'updateObjectiveText',
    'showMinorHintAt',
    'updateUnitPosition',
    'refreshVisibleDangerZone',
    'updateEnemyVisibility',
    'animateHeal',
    'dimUnit',
    'undimUnit',
    '_playLevelUpSfx',
    '_stopLevelUpSfx',
  ])
    scene[name] = call(() => {}, name);
  scene._awaitSceneDelay = call(async () => ({ status: 'finished' }), 'delay');
  isolateBattleTextFactory(scene);
  const count = () => calls;
  Object.assign(count, { visual, call, surface, labels });
  return count;
}
