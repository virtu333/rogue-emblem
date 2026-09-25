// Boot time and decoded-texture budget on a throttled phone profile.
//
//   node tools/art/sprite-trace/dev/measure-boot.mjs [--base http://127.0.0.1:3303] [--runs 3]
//        [--query '&spriteArt=rebuilt'] [--cpu 4] [--mbps 12] [--rtt 60] [--battle]
//
// Point it at a production build (`npm run build && npx vite preview --port 3303`) so the
// numbers are the shipped bundle. Each run is a cold context (empty HTTP cache, no service
// worker) on an iPhone-13-class landscape viewport at DPR 3, CPU throttled `--cpu`x and the
// network shaped to `--mbps` down / `--rtt` ms. Reports: ms from navigation to the Title
// scene (and, with --battle, to a devScene battle's PLAYER_IDLE), and the decoded RGBA bytes
// of every Phaser texture source grouped by key family (sprite canvases and atlases count
// once each; WebGL keeps a GPU copy of each on top).
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const base = flag('base', 'http://127.0.0.1:3303');
const runs = +flag('runs', 3);
const query = flag('query', '');
const cpu = +flag('cpu', 4);
const mbps = +flag('mbps', 12);
const rtt = +flag('rtt', 60);
const battle = args.includes('--battle');

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});

const family = (key) => {
  if (key.startsWith('rebuilt-source-')) return 'rebuilt sources';
  if (key.startsWith('rebuilt-portrait')) return 'portraits';
  if (key.startsWith('rebuilt-')) return 'rebuilt 64px canvases';
  if (key.startsWith('traced-')) return 'traced sprites (atlas pages)';
  if (key.startsWith('portrait') || key.includes('pc98')) return 'portraits';
  if (key.startsWith('enemy_') || /^[a-z_]+$/.test(key)) return 'other';
  return 'other';
};

async function once() {
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: rtt,
    downloadThroughput: (mbps * 1e6) / 8,
    uploadThroughput: (mbps * 1e6) / 16,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  await page.addInitScript(() =>
    localStorage.setItem(
      'emblem_rogue_settings',
      JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false }),
    ),
  );
  let bytes = 0;
  page.on('response', async (r) => {
    const len = +(r.headers()['content-length'] || 0);
    bytes += len;
  });
  // production builds ignore devScene: Title is the boot target; --battle then plays the
  // real first-run path (New Game, the opening lines, the first battle node, Travel)
  const url = `${base}/?${query.replace(/^&/, '')}`;
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'commit' });
  const skip = page.locator('#auth-skip');
  skip
    .waitFor({ state: 'visible', timeout: 60000 })
    .then(() => skip.click())
    .catch(() => {});
  await page.waitForFunction(() => window.__sceneState?.activeScene === 'Title', null, {
    timeout: 240000,
    polling: 100,
  });
  const scene = Date.now() - t0;
  let ready = scene;
  if (battle) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await page.getByRole('button', { name: 'New Game', exact: true }).tap({ timeout: 60000 });
    await page.waitForFunction(() => window.__emblemRogueGame.scene.isActive('NodeMap'), null, {
      timeout: 120000,
    });
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(250);
      if (await page.locator('.re-node-map').isVisible()) break;
      for (const name of ['Continue', 'Skip conversation']) {
        const b = page.getByRole('button', { name, exact: true }).first();
        if (await b.isVisible().catch(() => false)) {
          await b.tap().catch(() => {});
          break;
        }
      }
    }
    const nodeId = await page.evaluate(
      () =>
        window.__emblemRogueGame.scene
          .getScene('NodeMap')
          .runManager.getAvailableNodes()
          .find((n) => n.type === 'battle').id,
    );
    await page.locator(`[data-node="${nodeId}"]`).tap();
    await page.getByRole('button', { name: 'Travel', exact: true }).tap();
    const t1 = Date.now();
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    await page.waitForFunction(
      () =>
        window.__emblemRogueGame.scene.isActive('Battle') &&
        (window.__emblemRogueGame.scene.getScene('Battle')?.playerUnits?.length || 0) > 0,
      null,
      { timeout: 240000, polling: 100 },
    );
    // "ready" for a battle = Travel tapped -> units on the map
    ready = Date.now() - t1;
    await page.waitForTimeout(1500);
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const tex = await page.evaluate(() => {
    const list = window.__emblemRogueGame.textures.list;
    const out = [];
    // a traced sprite texture borrows its atlas page's source: count every source once
    const seen = new Set();
    for (const [key, t] of Object.entries(list)) {
      if (key === '__DEFAULT' || key === '__MISSING' || key === '__WHITE') continue;
      let px = 0;
      for (const s of t.source || []) {
        if (seen.has(s)) continue;
        seen.add(s);
        px += (s.width || 0) * (s.height || 0);
      }
      out.push([key, px * 4]);
    }
    return {
      out,
      heap: performance.memory?.usedJSHeapSize || 0,
    };
  });
  const groups = {};
  let total = 0;
  for (const [key, b] of tex.out) {
    const f = family(key);
    groups[f] = (groups[f] || 0) + b;
    total += b;
  }
  const tracedCount = tex.out.filter(([k]) => k.startsWith('traced-')).length;
  await context.close();
  return { scene, ready, total, groups, tracedCount, heap: tex.heap, bytes };
}

const results = [];
for (let i = 0; i < runs; i++) results.push(await once());
await browser.close();
const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const MB = (b) => (b / 1048576).toFixed(1);
const last = results.at(-1);
console.log(
  JSON.stringify(
    {
      url: `${base} ${battle ? 'battle (ms = Travel -> units on map)' : 'title (ms = navigation -> Title)'}${query}`,
      profile: `cpu ${cpu}x, ${mbps} Mbps, ${rtt} ms rtt, 844x390 @3x, cold cache`,
      runs: results.map((r) => r.ready),
      medianMs: med(results.map((r) => r.ready)),
      transferredMB: MB(last.bytes),
      decodedTexturesMB: MB(last.total),
      byFamilyMB: Object.fromEntries(Object.entries(last.groups).map(([k, v]) => [k, MB(v)])),
      tracedTextures: last.tracedCount,
      jsHeapMB: MB(last.heap),
    },
    null,
    2,
  ),
);
