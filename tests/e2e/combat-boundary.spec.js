import { test, expect } from '@playwright/test';
import { waitForScene } from './helpers.js';

// The actual scene entry point must settle Teleporter damage, position and its
// checkpoint even when Phaser objects disappear or a strike renderer throws.
test('Teleporter combat saves the same outcome without an HP bar or a working strike renderer', async ({
  browser,
}) => {
  test.setTimeout(120000);
  const outcomes = [];
  for (const presentation of ['normal', 'missing HP bar', 'throwing strike']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() =>
      localStorage.setItem(
        'emblem_rogue_settings',
        JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false, battleSpeed: 'instant' }),
      ),
    );
    await page.goto('/?devScene=battle&preset=combat_actions&seed=42&battleLab=1');
    await waitForScene(page, 'Battle');
    await page.waitForFunction(
      () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
    );
    const outcome = await page.evaluate(async (presentation) => {
      const scene = window.__emblemRogueGame.scene.getScene('Battle');
      const { getMetaKey, getRunKey, setActiveSlot } = await import('/src/engine/SlotManager.js');
      const meta = scene.registry.get('meta');
      meta.storageKey = getMetaKey(1);
      meta._save();
      scene.registry.set('activeSlot', 1);
      setActiveSlot(1);
      if (scene._battleRewindPolicy !== 'fixed-v1') throw new Error('Fixture requires fixed-v1');
      const attacker = scene.playerUnits.find((unit) => unit.name === 'Edric');
      const defender = scene.enemyUnits.find((unit) => unit.name === 'Knight');
      for (const unit of [attacker, defender]) {
        unit.stats = { HP: 100, STR: 12, MAG: 0, SKL: 0, SPD: 0, DEF: 5, RES: 5, LCK: 0, MOV: 5 };
        unit.currentHP = 100;
        unit.skills = [];
        unit.traits = [];
        unit.accessory = null;
        unit._conditions = [];
        unit.xp = 0;
        unit.hasActed = false;
      }
      attacker.stats.SPD = 20;
      attacker.weapon = { ...attacker.weapon, might: 10, hit: 999, crit: 0 };
      attacker.inventory[0] = attacker.weapon;
      defender.weapon = null;
      defender.inventory = [];
      defender.affixes = ['teleporter'];
      attacker.affixes = [];
      scene.reseedBattleRng(123);
      scene._timelineBoundary = 'turn_start';
      if (!scene._captureSuspendCheckpoint({ session: scene._battleSession }))
        throw new Error('Fixture checkpoint failed');
      if (presentation === 'missing HP bar') {
        defender.hpBar?.bg?.destroy();
        defender.hpBar?.fill?.destroy();
        defender.hpBar = null;
      } else if (presentation === 'throwing strike') {
        scene.animateStrike = async () => {
          throw new Error('Injected strike renderer failure');
        };
      }
      await scene.executeCombat(attacker, defender);
      const checkpoint = JSON.parse(localStorage.getItem(getRunKey(1))).battleInProgress.checkpoint;
      const state = (unit) => ({
        hp: unit.currentHP,
        position: [unit.col, unit.row],
        acted: unit.hasActed === true,
        xp: unit.xp,
      });
      return {
        live: { attacker: state(attacker), defender: state(defender) },
        saved: {
          attacker: state(checkpoint.playerUnits.find((unit) => unit.name === 'Edric')),
          defender: state(checkpoint.enemyUnits.find((unit) => unit.name === 'Knight')),
        },
        rng: scene._battleRng.getState(),
        savedRng: checkpoint.rngState,
        pending: checkpoint.pendingActionCompletion,
        intent: checkpoint.pendingCommittedAction,
      };
    }, presentation);
    expect(outcome.live.attacker.acted).toBe(true);
    expect(outcome.live.defender.hp).toBeGreaterThan(0);
    expect(outcome.live.defender.hp).toBeLessThan(100);
    expect(outcome.live.defender.position).not.toEqual([4, 3]);
    expect(outcome.saved).toEqual(outcome.live);
    expect(outcome.savedRng).toEqual(outcome.rng);
    expect(outcome.pending).toBeNull();
    expect(outcome.intent).toBeNull();
    expect(errors).toEqual([]);
    outcomes.push(outcome);
    await context.close();
  }
  expect(outcomes[1]).toEqual(outcomes[0]);
  expect(outcomes[2]).toEqual(outcomes[0]);
});
