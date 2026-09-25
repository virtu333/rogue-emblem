// Smoke the default battlefield (traced sprites): boot a battle, leave deployment, report
// state, page errors and the unit texture keys; optional screenshot.
//   node tools/art/sprite-trace/dev/smoke-default.mjs [--query '&spriteArt=rebuilt'] [--shot out.png]
import { chromium, devices } from 'playwright';

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const base = flag('base', 'http://127.0.0.1:3302');
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({
  ...devices['iPhone 13'],
  viewport: { width: 844, height: 390 },
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
await page.addInitScript(() =>
  localStorage.setItem(
    'emblem_rogue_settings',
    JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false }),
  ),
);
await page.goto(
  `${base}/?devScene=battle&preset=${flag('preset', 'battle_smoke')}&seed=42&battleLab=1${flag('query', '')}`,
);
await page.waitForFunction(() => window.__sceneState?.activeScene === 'Battle', null, {
  timeout: 60000,
});
await page.waitForFunction(
  () => window.__emblemRogueGame.scene.getScene('Battle').playerUnits?.length > 0,
);
const log = [];
for (let i = 0; i < 20; i++) {
  const st = await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    return { state: b.battleState, scene: window.__sceneState?.activeScene };
  });
  log.push(st.state);
  if (st.state === 'PLAYER_IDLE') break;
  if (st.state === 'DEPLOY_SELECTION')
    await page.evaluate(() => {
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      b.children.list
        .filter((o) => o.type === 'Rectangle' && o.input?.enabled && o.listenerCount('pointerdown'))
        .at(-1)
        ?.emit('pointerdown');
    });
  await page.waitForTimeout(500);
}
const units = await page.evaluate(() => {
  const b = window.__emblemRogueGame.scene.getScene('Battle');
  return [...b.playerUnits, ...b.enemyUnits, ...(b.npcUnits || [])].map(
    (u) => `${u.name}/${u.className}/${u.faction}:${u.graphic?.texture?.key}`,
  );
});
console.log(JSON.stringify({ log: [...new Set(log)], units, errors }, null, 1));
if (flag('shot')) await page.screenshot({ path: flag('shot') });
await browser.close();
