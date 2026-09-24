// Measure the real pixel budget of a map tile and a unit sprite in the running game.
// Usage: node tools/art/sprite-trace/dev/measure-budget.mjs [baseURL] [extraQuery]
// Needs the dev server (npx vite --port 3302). Prints one JSON row per viewport.
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:3302';
const extra = process.argv[3] || '';
const cases = [
  { name: 'phone 844x390 DPR3', viewport: { width: 844, height: 390 }, dpr: 3, mobile: true },
  { name: 'phone 844x390 DPR1', viewport: { width: 844, height: 390 }, dpr: 1, mobile: true },
  { name: 'phone 667x375 DPR2', viewport: { width: 667, height: 375 }, dpr: 2, mobile: true },
  { name: 'phone 667x375 DPR3', viewport: { width: 667, height: 375 }, dpr: 3, mobile: true },
  { name: 'desktop 1280x720 DPR1', viewport: { width: 1280, height: 720 }, dpr: 1, mobile: false },
  { name: 'desktop 1920x1080 DPR1', viewport: { width: 1920, height: 1080 }, dpr: 1, mobile: false },
  { name: 'desktop 1440x900 DPR2', viewport: { width: 1440, height: 900 }, dpr: 2, mobile: false },
];

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
for (const c of cases) {
  const context = await browser.newContext({
    viewport: c.viewport,
    deviceScaleFactor: c.dpr,
    isMobile: c.mobile,
    hasTouch: c.mobile,
  });
  const page = await context.newPage();
  await page.addInitScript(() =>
    localStorage.setItem(
      'emblem_rogue_settings',
      JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false }),
    ),
  );
  const q = `?devScene=battle&preset=battle_smoke&seed=42${c.mobile ? '&mobilePreview=1' : ''}${extra}`;
  await page.goto(`${base}/${q}`);
  await page.waitForFunction(() => window.__sceneState?.activeScene === 'Battle', null, {
    timeout: 30000,
  });
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').playerUnits?.length > 0,
    null,
    { timeout: 30000 },
  );
  await page.waitForTimeout(1500);
  const m = await page.evaluate(() => {
    const game = window.__emblemRogueGame;
    const b = game.scene.getScene('Battle');
    const canvas = game.canvas;
    const rect = canvas.getBoundingClientRect();
    const cam = b.cameras.main;
    const cssPerCanvas = rect.height / canvas.height;
    const dpr = window.devicePixelRatio;
    const tile = 32;
    const unit = b.playerUnits[0];
    const src = unit.graphic?.texture?.getSourceImage?.();
    return {
      renderer: game.renderer.type === 2 ? 'webgl' : 'canvas',
      canvas: [canvas.width, canvas.height],
      css: [Math.round(rect.width), Math.round(rect.height)],
      dpr,
      zoom: +cam.zoom.toFixed(4),
      minZoom: b._battleCamera?.minZoom,
      maxZoom: b._battleCamera?.maxZoom,
      canvasPxPerTile: +(tile * cam.zoom).toFixed(2),
      cssPxPerTile: +(tile * cam.zoom * cssPerCanvas).toFixed(2),
      devicePxPerTile: +(tile * cam.zoom * cssPerCanvas * dpr).toFixed(2),
      devicePxPerCanvasPx: +(cssPerCanvas * dpr).toFixed(3),
      unitTexture: unit.graphic?.texture?.key,
      unitTextureSize: src ? [src.width, src.height] : null,
      unitDisplay: [unit.graphic?.displayWidth, unit.graphic?.displayHeight],
      imageRendering: getComputedStyle(canvas).imageRendering,
    };
  });
  console.log(JSON.stringify({ case: c.name, ...m }));
  await context.close();
}
await browser.close();
