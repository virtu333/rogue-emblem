// E2E: Full journey from Title to Battle and back to Title via Pause -> Save & Return.
// This test intentionally starts from "/" (no devScene shortcuts).

import { test, expect } from '@playwright/test';
import {
  waitForGame,
  waitForScene,
  waitForNodeMapState,
  getSceneState,
  assertNoInvariantErrors,
  collectErrors,
  attachSceneCrashArtifacts,
} from './helpers.js';

const REQUIRED_SCENE_ORDER = [
  'HomeBase',
  'DifficultySelect',
  'BlessingSelect',
  'NodeMap',
  'Battle',
  'Title',
];

function installSaveStateReset(page) {
  return page.addInitScript(() => {
    const directKeys = new Set([
      'emblem_rogue_active_slot',
      'emblem_rogue_meta_save',
      'emblem_rogue_run_save',
    ]);
    const prefixes = ['emblem_rogue_slot_', 'emblem_rogue_hints_slot_'];

    const keys = Object.keys(localStorage);
    for (const key of keys) {
      if (directKeys.has(key) || prefixes.some((prefix) => key.startsWith(prefix))) {
        localStorage.removeItem(key);
      }
    }
  });
}

async function worldToPagePoint(page, worldPoint) {
  const pagePoint = await page.evaluate(({ x, y }) => {
    const game = window.__emblemRogueGame;
    const canvas = game?.canvas || document.querySelector('canvas');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect) return null;
    const rectWidth =
      rect.width > 0 ? rect.width : Number(canvas.clientWidth || canvas.width || 640);
    const rectHeight =
      rect.height > 0 ? rect.height : Number(canvas.clientHeight || canvas.height || 480);
    const width = Number(game?.scale?.gameSize?.width || game?.scale?.width || 640);
    const height = Number(game?.scale?.gameSize?.height || game?.scale?.height || 480);
    const gameWidth = Number.isFinite(width) && width > 0 ? width : 640;
    const gameHeight = Number.isFinite(height) && height > 0 ? height : 480;
    return {
      x: rect.left + (x / gameWidth) * rectWidth,
      y: rect.top + (y / gameHeight) * rectHeight,
    };
  }, worldPoint);
  expect(pagePoint).not.toBeNull();
  return pagePoint;
}

function assertFinitePoint(point) {
  expect(point).not.toBeNull();
  expect(Number.isFinite(point.x)).toBe(true);
  expect(Number.isFinite(point.y)).toBe(true);
}

function assertOrderedSceneHistory(history, expectedPath) {
  let cursor = 0;
  for (const scene of expectedPath) {
    const foundAt = history.indexOf(scene, cursor);
    expect(foundAt).toBeGreaterThanOrEqual(0);
    cursor = foundAt + 1;
  }
}

async function findSceneLabelPoint(page, sceneKey, label, timeoutMs = 10_000) {
  await page.waitForFunction(
    ({ key, text }) => {
      const collectTextNodes = (nodes, out = []) => {
        for (const node of nodes || []) {
          if (!node) continue;
          if (node.type === 'Text') out.push(node);
          if (Array.isArray(node.list)) collectTextNodes(node.list, out);
        }
        return out;
      };
      const resolvePoint = (scene) => {
        const textNodes = collectTextNodes(scene?.children?.list || []);
        for (const textNode of textNodes) {
          if (textNode?.text !== text) continue;
          const candidates = [textNode];
          const parent = textNode.parentContainer;
          if (Array.isArray(parent?.list)) {
            for (const child of parent.list) candidates.push(child);
          }
          for (const candidate of candidates) {
            if (!candidate?.input?.enabled) continue;
            if ((candidate.listenerCount?.('pointerdown') || 0) < 1) continue;
            const bounds = candidate.getBounds?.();
            const worldX = Number.isFinite(bounds?.centerX)
              ? bounds.centerX
              : Number.isFinite(candidate.x)
                ? candidate.x
                : textNode.x;
            const worldY = Number.isFinite(bounds?.centerY)
              ? bounds.centerY
              : Number.isFinite(candidate.y)
                ? candidate.y
                : textNode.y;
            if (Number.isFinite(worldX) && Number.isFinite(worldY)) return { x: worldX, y: worldY };
          }
        }
        return null;
      };
      const scene = window.__emblemRogueGame?.scene?.getScene?.(key);
      return Boolean(resolvePoint(scene));
    },
    { key: sceneKey, text: label },
    { timeout: timeoutMs },
  );

  const worldPoint = await page.evaluate(
    ({ key, text }) => {
      const collectTextNodes = (nodes, out = []) => {
        for (const node of nodes || []) {
          if (!node) continue;
          if (node.type === 'Text') out.push(node);
          if (Array.isArray(node.list)) collectTextNodes(node.list, out);
        }
        return out;
      };
      const resolvePoint = (scene) => {
        const textNodes = collectTextNodes(scene?.children?.list || []);
        for (const textNode of textNodes) {
          if (textNode?.text !== text) continue;
          const candidates = [textNode];
          const parent = textNode.parentContainer;
          if (Array.isArray(parent?.list)) {
            for (const child of parent.list) candidates.push(child);
          }
          for (const candidate of candidates) {
            if (!candidate?.input?.enabled) continue;
            if ((candidate.listenerCount?.('pointerdown') || 0) < 1) continue;
            const bounds = candidate.getBounds?.();
            const worldX = Number.isFinite(bounds?.centerX)
              ? bounds.centerX
              : Number.isFinite(candidate.x)
                ? candidate.x
                : textNode.x;
            const worldY = Number.isFinite(bounds?.centerY)
              ? bounds.centerY
              : Number.isFinite(candidate.y)
                ? candidate.y
                : textNode.y;
            if (Number.isFinite(worldX) && Number.isFinite(worldY)) return { x: worldX, y: worldY };
          }
        }
        return null;
      };
      const scene = window.__emblemRogueGame?.scene?.getScene?.(key);
      return resolvePoint(scene);
    },
    { key: sceneKey, text: label },
  );

  assertFinitePoint(worldPoint);
  return worldToPagePoint(page, worldPoint);
}

async function clickSceneLabel(page, sceneKey, label, timeoutMs = 10_000) {
  const point = await findSceneLabelPoint(page, sceneKey, label, timeoutMs);
  await page.mouse.click(point.x, point.y);
}

async function pressEscape(page) {
  await page.keyboard.press('Escape');
}

async function dismissNodeMapBlockers(page) {
  await pressEscape(page);
}

async function findFirstAvailableBattleNodePoint(page) {
  await page.waitForFunction(
    () => {
      const nodeMap = window.__emblemRogueGame?.scene?.getScene?.('NodeMap');
      const available = nodeMap?.runManager?.getAvailableNodes?.();
      return Array.isArray(available) && available.some((node) => node?.type === 'battle');
    },
    null,
    { timeout: 12_000 },
  );

  const point = await page.evaluate(() => {
    const nodeMap = window.__emblemRogueGame?.scene?.getScene?.('NodeMap');
    const runManager = nodeMap?.runManager;
    const available = runManager?.getAvailableNodes?.();
    if (!Array.isArray(available)) return null;
    const battleNode = available.find((node) => node?.type === 'battle');
    if (!battleNode) return null;

    const map = runManager?.nodeMap;
    const allNodes = Array.isArray(map?.nodes) ? map.nodes : [];
    if (!allNodes.length) return null;

    const totalRows = Math.max(...allNodes.map((node) => Number(node?.row) || 0)) + 1;
    const mapTop = 60;
    const mapBottom = 400;
    const mapLeft = 80;
    const mapRight = 560;
    const numColumns = 5;

    const yFrac = 1 - battleNode.row / Math.max(totalRows - 1, 1);
    const worldY = mapTop + yFrac * (mapBottom - mapTop);
    const xFrac = battleNode.col / (numColumns - 1);
    const worldX = mapLeft + xFrac * (mapRight - mapLeft);

    return { x: worldX, y: worldY };
  });

  assertFinitePoint(point);
  return worldToPagePoint(page, point);
}

async function enterFirstAvailableBattleNode(page) {
  const point = await findFirstAvailableBattleNodePoint(page);
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.mouse.click(point.x, point.y);
    const entered = await page.evaluate(() => window.__sceneState?.activeScene === 'Battle');
    if (entered) return;
    await page.waitForTimeout(450);
  }
}

test.afterEach(async ({ page }, testInfo) => {
  await attachSceneCrashArtifacts(page, testInfo);
});

test.describe('Journey: full run loop', () => {
  test('Title -> HomeBase -> Difficulty -> Blessing -> NodeMap -> Battle -> Title', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await installSaveStateReset(page);

    await page.goto('/');
    await waitForGame(page);
    await waitForScene(page, 'Title');
    // SceneRouter has a short transition cooldown after boot.
    await page.waitForTimeout(1_000);

    await clickSceneLabel(page, 'Title', 'NEW GAME');
    await waitForScene(page, 'HomeBase');
    await page.waitForTimeout(700);

    await clickSceneLabel(page, 'HomeBase', '[ Begin Run ]');
    await waitForScene(page, 'DifficultySelect');
    await page.waitForTimeout(500);

    // Normal is selected by default.
    await clickSceneLabel(page, 'DifficultySelect', '[ Confirm ]');
    await waitForScene(page, 'BlessingSelect');
    await page.waitForTimeout(300);

    await clickSceneLabel(page, 'BlessingSelect', '[Skip Blessing]');
    await clickSceneLabel(page, 'BlessingSelect', '[ Confirm ]');
    await waitForScene(page, 'NodeMap');

    // Story/dialogue or transient overlays can gate node selection.
    for (let i = 0; i < 4; i++) {
      const nodeMapState = await page.evaluate(() => window.__sceneState?.nodeMap?.state || null);
      if (nodeMapState === 'IDLE') break;
      await dismissNodeMapBlockers(page);
      await page.waitForTimeout(150);
    }
    await waitForNodeMapState(page, 'IDLE', 12_000);
    await page.waitForTimeout(900);

    await enterFirstAvailableBattleNode(page);
    await waitForScene(page, 'Battle');
    await page.waitForFunction(
      () => ['DEPLOY_SELECTION', 'PLAYER_IDLE'].includes(window.__sceneState?.battle?.state),
      null,
      { timeout: 15_000 },
    );

    await pressEscape(page);
    await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PAUSED', null, {
      timeout: 8_000,
    });

    await clickSceneLabel(page, 'Battle', 'Save & Return to Title');
    await clickSceneLabel(page, 'Battle', 'Yes');
    await waitForScene(page, 'Title');

    const sceneState = await getSceneState(page);
    expect(sceneState.activeScene).toBe('Title');
    assertOrderedSceneHistory(
      sceneState.history.map((entry) => entry.to),
      REQUIRED_SCENE_ORDER,
    );

    await assertNoInvariantErrors(page);
    expect(errors).toEqual([]);
  });
});
