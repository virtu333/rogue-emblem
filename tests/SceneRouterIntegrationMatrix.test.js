import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE_DIR = path.resolve('src');
const SOURCE_FILES = [
  'scenes/BootScene.js',
  'scenes/bootTransition.js',
  'scenes/TitleScene.js',
  'scenes/SlotPickerScene.js',
  'scenes/HomeBaseScene.js',
  'scenes/DifficultySelectScene.js',
  'scenes/BlessingSelectScene.js',
  'scenes/NodeMapScene.js',
  'scenes/BattleScene.js',
  'scenes/RunCompleteScene.js',
  'ui/DeployScreenOverlay.js',
  'ui/PostCombatController.js',
  'ui/TransitionRecoveryPrompt.js',
  'ui/TransitionRecoveryController.js',
];

const REQUIRED_REASON_MATRIX = {
  'scenes/BootScene.js': ['BOOT', 'RETRY'],
  'scenes/TitleScene.js': ['CONTINUE', 'NEW_GAME'],
  'scenes/SlotPickerScene.js': ['BACK', 'CONTINUE'],
  'scenes/HomeBaseScene.js': ['BEGIN_RUN', 'BACK'],
  'scenes/DifficultySelectScene.js': ['BEGIN_RUN', 'BACK'],
  'scenes/BlessingSelectScene.js': ['BEGIN_RUN', 'BACK'],
  'scenes/NodeMapScene.js': ['SAVE_EXIT', 'ABANDON_RUN', 'ENTER_BATTLE', 'VICTORY'],
  // VICTORY, BATTLE_COMPLETE, DEFEAT, RETRY moved to PostCombatController + TransitionRecoveryController
  'scenes/BattleScene.js': ['BACK', 'ABANDON_RUN', 'SAVE_EXIT'],
  'scenes/RunCompleteScene.js': ['RETURN_HOME', 'RETURN_TITLE'],
  'ui/DeployScreenOverlay.js': ['BACK'],
  'ui/PostCombatController.js': ['VICTORY', 'BATTLE_COMPLETE', 'DEFEAT', 'RETRY'],
  'ui/TransitionRecoveryController.js': ['DEFEAT', 'RETURN_TITLE'],
};

function getSource(filePath) {
  return readFileSync(path.join(SOURCE_DIR, filePath), 'utf8');
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
      } else if (ch === '"' || ch === "'" || ch === '`') {
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
  // Primary: explicit TRANSITION_REASONS.X in call arguments
  // Secondary: shorthand { reason } pass-through used by helper wrappers
  // (e.g., TransitionRecoveryPrompt.js).
  // Kept as safety net for future refactors that pass reason through helper params.
  return (
    /reason\s*:\s*TRANSITION_REASONS\.[A-Z_]+/s.test(callSource) ||
    /,\s*\{\s*reason\s*\}\s*,?\s*\)/s.test(callSource)
  );
}

const ALLOWED_BYPASS_COUNT = {
  'scenes/BattleScene.js': 2, // 2 pause abandon/save-exit fallback (recovery bypasses moved to TransitionRecoveryController)
  'scenes/bootTransition.js': 1, // boot transition final fallback after lock-reset retry
  'scenes/NodeMapScene.js': 2, // save-exit + abandon callback fallback
  'ui/TransitionRecoveryPrompt.js': 1, // shared title recovery fallback
  'ui/TransitionRecoveryController.js': 3, // defeat RunComplete + defeat Title + victory Title fallbacks
};

describe('SceneRouter integration matrix', () => {
  it('transition-owning files do not call scene.start/sleep/wake/restart directly', () => {
    const directLifecycleCall = /\.scene\.(start|sleep|wake|restart)\s*\(/g;
    const bypassMarker = '// scene-router-bypass';
    for (const file of SOURCE_FILES) {
      const src = getSource(file);
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
      expect(bypassedCount, `${file} has ${bypassedCount} bypasses but expected ${allowed}`).toBe(
        allowed,
      );
    }
  });

  it('all transitionToScene and restartScene calls include reason metadata', () => {
    for (const file of SOURCE_FILES) {
      const src = getSource(file);
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
    for (const file of SOURCE_FILES) {
      const src = getSource(file);
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
