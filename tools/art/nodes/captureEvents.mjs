#!/usr/bin/env node
// Review captures for the Event art (docs/specs/event-art.md, docs/art-direction/events/):
// the route map with Event medals (live, and fallen to the Eclipse as a Dark Omen) and the
// Event page's header band, at 640x480 (desktop), 844x390 (landscape phone) and 390x844
// (upright phone). Needs a dev server (`BROWSER=none npx vite --port 3107 --strictPort`).
//   node tools/art/nodes/captureEvents.mjs [--out References/event-art/captures]
//        [--base http://localhost:3107] [--events drill_yard,toll_bridge,twin_altar]
//        [--sizes 640x480,844x390,390x844] [--no-map]
//        [--chromium /opt/pw-browsers/chromium]
import fs from 'node:fs';
import path from 'node:path';
import { chromium, devices } from '@playwright/test';

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const out = arg('out', 'References/event-art/captures');
const base = arg('base', 'http://localhost:3107');
const events = arg('events', 'drill_yard,toll_bridge,twin_altar').split(',');
const only = arg('sizes', null)?.split(',');
const noMap = argv.includes('--no-map');
const executablePath = arg('chromium', process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium');
fs.mkdirSync(out, { recursive: true });

const SIZES = [
  { name: '640x480', viewport: { width: 640, height: 480 }, phone: false },
  { name: '844x390', viewport: { width: 844, height: 390 }, phone: true },
  { name: '390x844', viewport: { width: 390, height: 844 }, phone: true },
];

const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });

async function open(size, eventId) {
  const phone = size.phone
    ? // eslint-disable-next-line no-unused-vars
      (({ defaultBrowserType, ...d }) => ({
        ...d,
        viewport: size.viewport,
        screen: { width: Math.min(size.viewport.width, size.viewport.height), height: Math.max(size.viewport.width, size.viewport.height) },
      }))(devices['iPhone 13'])
    : { viewport: size.viewport };
  const context = await browser.newContext({ ...phone, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.addInitScript(() =>
    localStorage.setItem(
      'emblem_rogue_settings',
      JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false }),
    ),
  );
  await page.goto(`${base}/?devScene=nodemap&preset=event&seed=42&event=${eventId}`);
  await page.waitForFunction(() => window.__sceneState?.activeScene === 'NodeMap', null, {
    timeout: 30_000,
  });
  const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
  await skip.waitFor({ state: 'visible' });
  await skip.click();
  await page.locator('.re-node-map').waitFor({ state: 'visible' });
  return { context, page };
}

for (const size of SIZES) {
  if (only && !only.includes(size.name)) continue;
  // The route map: live events, a visited one and a fallen one (Dark Omen).
  if (!noMap) {
    const { context, page } = await open(size, events[0]);
    await page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('NodeMap');
      const rm = s.runManager;
      const { eclipseNode } = await import('/src/engine/EclipseSystem.js');
      const pool = rm.nodeMap.nodes
        .filter((n) => n.row >= 2 && !n.completed && n.type !== 'boss' && n.type !== 'event')
        .sort((a, b) => a.row - b.row || a.col - b.col);
      const make = (n) => {
        n.type = 'event';
        n.battleParams = null;
        return n;
      };
      // Every other node of rows 2-5 becomes an event; the first of them also falls.
      const picks = pool.filter((n) => n.row <= 5).filter((_, i) => i % 2 === 0);
      picks.forEach(make);
      // A reachable Event beside a fallen one (the fall is only worth reading when live).
      const reach = rm.getAvailableNodes().filter((n) => n.type !== 'boss');
      const fallen = reach.length > 1 ? make(reach[reach.length - 1]) : picks[1];
      if (fallen) {
        eclipseNode(fallen, {
          runSeed: rm.runSeed ?? 7,
          config: s.gameData.eclipse,
          actId: rm.currentAct,
          mapTemplates: s.gameData.mapTemplates,
          shadow: 30,
        });
      }
      s.drawMap?.();
    });
    await page.waitForTimeout(2600);
    await page.screenshot({ path: path.join(out, `map-${size.name}.png`) });
    await context.close();
  }
  for (const id of events) {
    const { context, page } = await open(size, id);
    await page
      .getByRole('button', { name: /^Event · (Available|You are here)/ })
      .first()
      .click();
    await page.getByRole('button', { name: 'Travel', exact: true }).click();
    await page.locator('.ev-menu .ev-title').waitFor({ state: 'visible' });
    await page.waitForFunction(
      () => document.querySelector('.ev-band')?.classList.contains('has-art') ?? false,
      null,
      { timeout: 8000 },
    ).catch(() => {});
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(out, `event-${id}-${size.name}.png`) });
    await context.close();
  }
}
await browser.close();
console.log(`captures -> ${out}`);
