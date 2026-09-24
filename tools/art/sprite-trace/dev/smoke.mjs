// Dev: open a battle with ?spriteArt=traced and report which texture each unit uses.
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:3302';
const extra = process.argv[3] || '&spriteArt=traced';
const out = process.argv[4] || null;
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({
  viewport: { width: 844, height: 390 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text()));
await page.addInitScript(() =>
  localStorage.setItem(
    'emblem_rogue_settings',
    JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false }),
  ),
);
await page.goto(`${base}/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1${extra}`);
await page.waitForFunction(() => window.__sceneState?.activeScene === 'Battle', null, {
  timeout: 30000,
});
await page.waitForFunction(
  () => window.__emblemRogueGame.scene.getScene('Battle').playerUnits?.length > 0,
  null,
  { timeout: 30000 },
);
await page.waitForTimeout(2500);
const info = await page.evaluate(() => {
  const b = window.__emblemRogueGame.scene.getScene('Battle');
  return [...b.playerUnits, ...b.enemyUnits, ...(b.npcUnits || [])].map((u) => ({
    name: u.name,
    cls: u.className,
    faction: u.faction,
    key: u.graphic?.texture?.key,
    frame: u.graphic?.frame?.name,
    dw: u.graphic?.displayWidth,
    state: b.battleState,
  }));
});
console.log(JSON.stringify(info, null, 1));
if (out) await page.screenshot({ path: out });
await browser.close();
