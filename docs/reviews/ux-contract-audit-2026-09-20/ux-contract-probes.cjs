const {
  chromium,
} = require('/Users/davechen/Documents/rogue-emblem/node_modules/@playwright/test');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 667, height: 375 }, hasTouch: true });
  const page = await ctx.newPage();
  const results = {};
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const boot = async (url, scene) => {
    await page.goto('http://127.0.0.1:3000/' + url);
    await page.waitForFunction((k) => window.__sceneState?.activeScene === k, scene);
  };
  const focus = () =>
    page.evaluate(() => ({
      tag: document.activeElement.tagName,
      text: document.activeElement.textContent.slice(0, 70),
      key: document.activeElement.dataset.focus,
    }));
  await boot('?devScene=homebase&mobilePreview=1', 'HomeBase');
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('HomeBase');
    for (const u of s.meta.upgradesData)
      if (u.effects.some((e) => e.unlockSkill)) s.meta.purchasedUpgrades[u.id] = 1;
    s.mobileHome.render();
  });
  await page.locator('[data-focus="skills"]').click();
  await page.locator('.mh-skill').first().focus();
  await page.keyboard.press('Enter');
  results.skillAssignFocus = await focus();
  console.log('ASSIGN_FOCUS', JSON.stringify(results));
  await page.getByRole('button', { name: /^Remove / }).focus();
  await page.keyboard.press('Enter');
  results.skillRemoveFocus = await focus();
  console.log('REMOVE_FOCUS', JSON.stringify(results));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
  results.skillEscapeScene = await page.evaluate(() => window.__sceneState.activeScene);
  console.log('ESCAPE', JSON.stringify(results));
  await page.screenshot({ path: '/tmp/ux-homebase-focus.png' });
  await boot('?devScene=difficulty&mobilePreview=1', 'DifficultySelect');
  results.metaBefore = await page.getByRole('button', { name: /Army upgrades/ }).textContent();
  await page.evaluate(async () => {
    const { dispatchInputAction } = await import('/src/utils/inputFocus.js');
    dispatchInputAction('input:danger');
  });
  results.metaAfterPad = await page.getByRole('button', { name: /Army upgrades/ }).textContent();
  console.log('PAD', JSON.stringify(results));
  await boot(
    '?devScene=battle&preset=combat_actions&seed=42&mobilePreview=1&battleLab=1',
    'Battle',
  );
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'More Info', exact: true }).click();
  await page.getByRole('searchbox').fill('Par');
  results.helpSearch = await page.getByRole('dialog', { name: 'Help', exact: true }).innerText();
  console.log('HELP', JSON.stringify(results));
  await page.screenshot({ path: '/tmp/ux-help-search.png' });
  await boot('?devScene=nodemap&mobilePreview=1', 'NodeMap');
  await page.getByRole('button', { name: 'Skip conversation', exact: true }).click();
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    s.registry.set('activeSlot', 1);
    s.runManager.gold = 10000;
    const n = s.runManager.getAvailableNodes()[0];
    n.type = 'shop';
    const w = s.runManager.roster[0].inventory[0];
    w.weight = 0;
    s.showShopOverlay(n, []);
  });
  const shop = page.locator('.shop-menu');
  await shop.getByRole('button', { name: 'Forge', exact: true }).click();
  await shop.locator('.shop-row').first().click();
  await shop.getByRole('button', { name: 'Choose forge', exact: true }).click();
  results.forgeChoices = await page.locator('.re-choice-picker').allTextContents();
  const weight = page.getByRole('button', { name: /Weight/ });
  results.forgeWeightEnabled = await weight.isEnabled();
  await weight.click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  results.forgeAfter = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap'),
      w = s.runManager.roster[0].inventory[0];
    return { gold: s.runManager.gold, weight: w.weight, level: w._forgeLevel };
  });
  await page.screenshot({ path: '/tmp/ux-forge-zero.png' });
  results.errors = errors;
  fs.writeFileSync('/tmp/ux-contract-probes.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
