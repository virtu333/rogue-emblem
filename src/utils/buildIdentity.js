// What a bug report needs to name the build and the moment it came from: the commit and
// build date (stamped by vite.config.js through tools/build/buildStamp.mjs), the platform,
// the native app's version and build number (the iOS and Android apps, through the
// Capacitor App plugin), and where the run stands (difficulty, act, node, turn). Settings
// shows it with a Copy button (ui/SettingsMenu.js), so it is one tap away from Pause too.
//
// Everything but readNativeAppInfo is pure and synchronous; nothing here writes state.

import { GAME_TITLE } from './gameIdentity.js';
import { actLabel } from './actNames.js';
import { hasNativePlugin, nativeCapacitor } from './nativeSaveMirror.js';
import { isPrologueRun } from '../engine/ScriptedBattle.js';

/** The build's stamp; 'unknown' when built outside vite (or before the stamp existed). */
export const BUILD_STAMP = Object.freeze({
  sha: typeof __BUILD_SHA__ === 'string' && __BUILD_SHA__ ? __BUILD_SHA__ : 'unknown',
  date: typeof __BUILD_DATE__ === 'string' && __BUILD_DATE__ ? __BUILD_DATE__ : 'unknown',
});

/** 'iOS app' | 'Android app' | 'web (phone)' | 'web (desktop)'. */
export function buildPlatformLabel({ win = globalThis, mobile = false } = {}) {
  const cap = nativeCapacitor(win);
  let platform;
  try {
    platform = cap?.getPlatform?.() ?? null;
  } catch {
    platform = null;
  }
  if (platform === 'ios') return 'iOS app';
  if (platform === 'android') return 'Android app';
  return mobile ? 'web (phone)' : 'web (desktop)';
}

/**
 * The native app's `{ version, build }` (marketing version and build number: the
 * TestFlight build, the Play versionCode), or null on the web, without the App plugin,
 * or when the bridge does not answer within `timeoutMs`. Never throws.
 */
export async function readNativeAppInfo({ win = globalThis, timeoutMs = 1500 } = {}) {
  const cap = nativeCapacitor(win);
  if (!cap || !hasNativePlugin(cap, 'App')) return null;
  let timer = null;
  try {
    const info = await Promise.race([
      cap.nativePromise('App', 'getInfo', {}),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
    if (!info || typeof info !== 'object') return null;
    const text = (value) => (value === undefined || value === null ? '' : String(value).trim());
    const version = text(info.version);
    const build = text(info.build);
    return version || build ? { version, build } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Where the run stands, or null with no run. `turn` is the battle's turn (0 or absent
 * outside a battle). In a battle the node is the one being fought; on the route map it is
 * the last node completed (none at an act's start).
 */
export function runContextOf(runManager, { turn = 0 } = {}) {
  const rm = runManager;
  if (!rm || typeof rm !== 'object') return null;
  const modes = rm.gameData?.difficulty?.modes;
  const difficultyId = String(rm.difficultyId || 'normal');
  const difficulty = modes?.[difficultyId]?.label || difficultyId;
  let act;
  try {
    act = isPrologueRun(rm) ? 'Prologue' : actLabel(rm.currentAct);
  } catch {
    act = '';
  }
  const battleNodeId = rm.battleInProgress?.nodeId || null;
  const nodeId = battleNodeId || rm.currentNodeId || null;
  const node = nodeId ? rm.nodeMap?.nodes?.find?.((n) => n?.id === nodeId) : null;
  const battleTurn = Math.trunc(Number(turn) || 0);
  return {
    difficulty,
    act,
    inBattle: Boolean(battleNodeId) || battleTurn > 0,
    nodeId,
    nodeType: node?.type || null,
    turn: battleTurn > 0 ? battleTurn : null,
  };
}

/**
 * The text a player copies into a bug report, one fact per line. `native` is
 * readNativeAppInfo's answer (omitted on the web), `run` runContextOf's.
 */
export function formatBuildReport({
  stamp = BUILD_STAMP,
  platform = 'web (desktop)',
  native = null,
  run = null,
} = {}) {
  const lines = [`${GAME_TITLE} · ${platform}`];
  if (native) {
    const version = native.version ? `version ${native.version}` : '';
    const build = native.build ? `build ${native.build}` : '';
    lines.push(`App: ${[version, build].filter(Boolean).join(', ')}`);
  }
  lines.push(`Commit: ${stamp.sha} (built ${stamp.date})`);
  if (run) {
    lines.push(`Run: ${[run.difficulty, run.act].filter(Boolean).join(' · ')}`);
    if (run.nodeId) {
      const type = run.nodeType ? ` (${run.nodeType})` : '';
      const turn = run.turn ? `, turn ${run.turn}` : '';
      lines.push(`${run.inBattle ? 'Battle at' : 'Last node'}: ${run.nodeId}${type}${turn}`);
    } else if (run.inBattle && run.turn) {
      lines.push(`Battle: turn ${run.turn}`);
    }
  } else {
    lines.push('Run: none in progress');
  }
  return lines.join('\n');
}
