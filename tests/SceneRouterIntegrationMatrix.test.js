import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SCENE_DIR = path.resolve('src/scenes');
const SCENE_FILES = [
  'BootScene.js',
  'TitleScene.js',
  'SlotPickerScene.js',
  'HomeBaseScene.js',
  'DifficultySelectScene.js',
  'BlessingSelectScene.js',
  'NodeMapScene.js',
  'BattleScene.js',
  'RunCompleteScene.js',
];

const REQUIRED_REASON_MATRIX = {
  'BootScene.js': ['BOOT', 'RETRY'],
  'TitleScene.js': ['CONTINUE', 'NEW_GAME'],
  'SlotPickerScene.js': ['BACK', 'CONTINUE'],
  'HomeBaseScene.js': ['BEGIN_RUN', 'BACK'],
  'DifficultySelectScene.js': ['BEGIN_RUN', 'BACK'],
  'BlessingSelectScene.js': ['BEGIN_RUN', 'BACK'],
  'NodeMapScene.js': ['SAVE_EXIT', 'ABANDON_RUN', 'ENTER_BATTLE', 'VICTORY'],
  'BattleScene.js': ['BACK', 'ABANDON_RUN', 'SAVE_EXIT', 'VICTORY', 'BATTLE_COMPLETE', 'DEFEAT', 'RETRY'],
  'RunCompleteScene.js': ['RETURN_HOME', 'RETURN_TITLE'],
};

function getSceneSource(sceneFile) {
  return readFileSync(path.join(SCENE_DIR, sceneFile), 'utf8');
}

function extractCalls(source, fnName) {
  const calls = [];
  const rx = new RegExp(`\\b${fnName}\\s*\\(`, 'g');
  let match;
  while ((match = rx.exec(source)) !== null) {
    const callStart = match.index;
    const openParen = callStart + match[0].lastIndexOf('(');
    let i = openParen + 1;
    let depth = 1;
    let quote = null;
    let escaped = false;

    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === quote) {
          quote = null;
        }
      } else if (ch === '"' || ch === '\'' || ch === '`') {
        quote = ch;
      } else if (ch === '(') {
        depth++;
      } else if (ch === ')') {
        depth--;
      }
      i++;
    }

    if (depth === 0) {
      calls.push(source.slice(callStart, i));
      rx.lastIndex = i;
    }
  }
  return calls;
}

function hasInlineReason(callSource) {
  return /reason\s*:\s*TRANSITION_REASONS\.[A-Z_]+/s.test(callSource);
}

const ALLOWED_BYPASS_COUNT = {
  'BattleScene.js': 2, // nuclear fallback in showDefeatTransitionRecovery
};

describe('SceneRouter integration matrix', () => {
  it('scene files do not call scene.start/sleep/wake/restart directly', () => {
    const directLifecycleCall = /\.scene\.(start|sleep|wake|restart)\s*\(/g;
    const bypassMarker = '// scene-router-bypass';
    for (const file of SCENE_FILES) {
      const src = getSceneSource(file);
      const matches = [...src.matchAll(directLifecycleCall)];
      let bypassedCount = 0;
      let unbypassedCount = 0;
      for (const m of matches) {
        const lineStart = src.lastIndexOf('\n', m.index) + 1;
        const lineEnd = src.indexOf('\n', m.index);
        const line = src.slice(lineStart, lineEnd === -1 ? src.length : lineEnd);
        if (line.includes(bypassMarker)) {
          bypassedCount++;
        } else {
          unbypassedCount++;
        }
      }
      const allowed = ALLOWED_BYPASS_COUNT[file] || 0;

      expect(unbypassedCount, `${file} has unbypassed direct scene lifecycle call`).toBe(0);
      expect(bypassedCount, `${file} has ${bypassedCount} bypasses but expected ${allowed}`).toBe(allowed);
    }
  });

  it('all transitionToScene and restartScene calls include reason metadata', () => {
    for (const file of SCENE_FILES) {
      const src = getSceneSource(file);
      const transitionCalls = extractCalls(src, 'transitionToScene');
      const restartCalls = extractCalls(src, 'restartScene');
      const lifecycleCalls = transitionCalls.concat(restartCalls);

      for (const call of lifecycleCalls) {
        expect(
          hasInlineReason(call),
          `${file} has lifecycle call without TRANSITION_REASONS reason: ${call}`,
        ).toBe(true);
      }
    }
  });

  it('covers expected reason matrix per scene', () => {
    for (const file of SCENE_FILES) {
      const src = getSceneSource(file);
      const requiredReasons = REQUIRED_REASON_MATRIX[file] || [];
      for (const reason of requiredReasons) {
        expect(
          src.includes(`TRANSITION_REASONS.${reason}`),
          `${file} is missing TRANSITION_REASONS.${reason}`,
        ).toBe(true);
      }
    }
  });
});
