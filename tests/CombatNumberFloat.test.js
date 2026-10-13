// The floating numbers as drawn (ui/CombatNumberFloat.js) and as BattleScene reads them: every
// float site takes its text, colour, size and motion from combatNumberStyle, and drawing never
// advances Math.random (during a battle that IS the battle RNG).
import { describe, expect, it, vi, afterEach } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/utils/SceneRouter.js', async () => {
  const actual = await vi.importActual('../src/utils/SceneRouter.js');
  return { ...actual, transitionToScene: vi.fn(async () => true) };
});

import { readFileSync } from 'node:fs';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { buildCombatNumber, floatCombatNumber } from '../src/ui/CombatNumberFloat.js';
import {
  REDUCED_FADE_MS,
  REDUCED_HOLD_MS,
  combatNumberStyle,
} from '../src/ui/combatNumberStyle.js';
import { UI_HEX, UI_PALETTE } from '../src/utils/uiStyles.js';

const original = Math.random;
afterEach(() => {
  Math.random = original;
  vi.restoreAllMocks();
});

/**
 * A scene that records what was drawn. Like Phaser, creating a text or a graphic draws from
 * Math.random (its UUID): the draw must land on the presentation stream, never the caller's.
 */
function recorder() {
  const texts = [];
  const graphics = [];
  const tweens = [];
  const fluent = (record) =>
    new Proxy(record, {
      get: (target, key) => {
        if (key in target) return target[key];
        if (key === 'then') return undefined;
        return (...args) => {
          (target.calls ||= []).push([String(key), ...args]);
          return fluent(target);
        };
      },
    });
  const scene = {
    add: {
      text: (x, y, text, style) => {
        Math.random();
        const record = { x, y, text, style, calls: [], destroyed: false };
        record.destroy = () => (record.destroyed = true);
        texts.push(record);
        return fluent(record);
      },
      graphics: () => {
        Math.random();
        const record = { calls: [], destroyed: false };
        record.destroy = () => (record.destroyed = true);
        graphics.push(record);
        return fluent(record);
      },
    },
    tweens: { add: (config) => tweens.push(config) },
  };
  return { scene, texts, graphics, tweens, stage: scene };
}

const callsOf = (record, name) => record.calls.filter(([n]) => n === name);

describe('buildCombatNumber / floatCombatNumber', () => {
  it('draws the model: its text, style, depth and a rise-and-fade tween', () => {
    const { scene, texts, tweens } = recorder();
    floatCombatNumber(scene, { kind: 'strike', value: 8, x: 100, y: 60 });
    const model = combatNumberStyle('strike', 8);
    expect(texts).toHaveLength(1);
    expect([texts[0].x, texts[0].y, texts[0].text]).toEqual([100, 60, '8']);
    expect(texts[0].style).toEqual(model.style);
    expect(callsOf(texts[0], 'setOrigin')[0][1]).toBe(0.5);
    expect(callsOf(texts[0], 'setDepth')[0][1]).toBe(model.depth);
    expect(tweens).toHaveLength(1);
    expect(tweens[0]).toMatchObject({
      y: 60 - model.motion.rise,
      alpha: 0,
      delay: 0,
      duration: model.motion.duration,
    });
  });

  it('a crit pops: it starts small and scales back to 1 in a tween of its own, then rises', () => {
    const { scene, texts, tweens } = recorder();
    floatCombatNumber(scene, { kind: 'crit', value: 20, x: 10, y: 40 });
    expect(texts[0].text).toBe('20!');
    expect(texts[0].style.fontSize).toBe('18px');
    const pop = combatNumberStyle('crit', 20).motion.pop;
    expect(callsOf(texts[0], 'setScale')[0][1]).toBe(pop.from);
    expect(tweens).toHaveLength(2);
    expect(tweens[0]).toMatchObject({ scale: 1, duration: pop.duration, ease: pop.ease });
    expect(tweens[1]).toMatchObject({ alpha: 0 });
    expect(tweens[1].y).toBeLessThan(40);
  });

  it('a blow for 0 floats "No damage" with a spark drawn as short lines behind it', () => {
    const { scene, texts, graphics, tweens } = recorder();
    floatCombatNumber(scene, { kind: 'strike', value: 0, x: 50, y: 30 });
    expect(texts[0].text).toBe('No damage');
    expect(texts[0].style.color).toBe(UI_PALETTE.muted);
    expect(graphics).toHaveLength(1);
    const spark = combatNumberStyle('strike', 0).spark;
    expect(callsOf(graphics[0], 'lineTo')).toHaveLength(spark.segments.length);
    expect(callsOf(graphics[0], 'lineStyle')[0].slice(2)).toEqual([UI_HEX.text, 1]);
    expect(callsOf(graphics[0], 'setPosition')[0].slice(1)).toEqual([50, 30 + spark.dy]);
    expect(callsOf(graphics[0], 'setDepth')[0][1]).toBe(callsOf(texts[0], 'setDepth')[0][1] - 1);
    // The spark grows while it fades; the number rises.
    expect(tweens.find((t) => t.targets === graphics[0] || t.scale === spark.growTo)).toBeTruthy();
  });

  it('the number destroys its spark with itself, and destroy() is safe to call twice', () => {
    const { scene, texts, graphics, tweens } = recorder();
    floatCombatNumber(scene, { kind: 'strike', value: 0, x: 0, y: 0 });
    const numberTween = tweens.find((t) => typeof t.onComplete === 'function');
    numberTween.onComplete();
    numberTween.onComplete();
    expect(texts[0].destroyed).toBe(true);
    expect(graphics[0].destroyed).toBe(true);
  });

  it('reduced motion: no pop, no rise, no spark growth, a hold then a fade', () => {
    const { scene, texts, graphics, tweens } = recorder();
    floatCombatNumber(scene, { kind: 'crit', value: 20, x: 10, y: 40, reducedMotion: true });
    floatCombatNumber(scene, { kind: 'strike', value: 0, x: 10, y: 40, reducedMotion: true });
    expect(callsOf(texts[0], 'setScale')).toHaveLength(0);
    for (const tween of tweens) {
      expect(tween.scale).toBeUndefined();
      expect(tween.y).toBeUndefined();
      expect(tween).toMatchObject({ alpha: 0, delay: REDUCED_HOLD_MS, duration: REDUCED_FADE_MS });
    }
    expect(callsOf(graphics[0], 'setScale')).toHaveLength(0);
  });

  it('never advances Math.random, for any kind, motion setting or value', () => {
    const draws = vi.fn(() => 0.5);
    Math.random = draws;
    const { scene } = recorder();
    for (const reducedMotion of [false, true])
      for (const kind of ['strike', 'crit', 'heal', 'drain', 'poison', 'lava', 'acid', 'miss'])
        for (const value of [0, 9]) {
          floatCombatNumber(scene, { kind, value, x: 1, y: 2, reducedMotion });
          buildCombatNumber(scene, { kind, value, x: 1, y: 2, reducedMotion });
        }
    expect(draws).not.toHaveBeenCalled();
  });

  it('a drawing that fails is reported to the caller and leaves nothing on the board', () => {
    const { scene, texts, graphics } = recorder();
    const failing = scene.tweens.add;
    scene.tweens.add = () => {
      throw new Error('Renderer unavailable');
    };
    expect(() => floatCombatNumber(scene, { kind: 'strike', value: 0, x: 0, y: 0 })).toThrow(
      'Renderer unavailable',
    );
    expect([texts[0].destroyed, graphics[0].destroyed]).toEqual([true, true]);
    scene.tweens.add = failing;
  });

  it('a renderer without Graphics still floats the number', () => {
    const { scene, texts } = recorder();
    delete scene.add.graphics;
    expect(() => floatCombatNumber(scene, { kind: 'strike', value: 0, x: 0, y: 0 })).not.toThrow();
    expect(texts[0].text).toBe('No damage');
  });
});

describe('BattleScene reads the model at every float site', () => {
  function battle({ reduced = false } = {}) {
    const rec = recorder();
    const scene = new BattleScene();
    Object.assign(scene, {
      _battleSession: 1,
      add: rec.stage.add,
      tweens: rec.stage.tweens,
      grid: { gridToPixel: (col, row) => ({ x: col * 32 + 16, y: row * 32 + 16 }) },
      updateHPBar: vi.fn(),
      _reduceMotion: () => reduced,
      _combatFx: { playStatus: vi.fn() },
      _awaitSceneTween: vi.fn(async (config) => config.onComplete?.()),
      _awaitSceneDelay: vi.fn(async () => {}),
    });
    const { scene: _stage, ...pieces } = rec;
    return { scene, ...pieces };
  }
  const target = { name: 'Foe', col: 3, row: 2, graphic: { setTint() {}, clearTint() {} } };
  const striker = { name: 'Hero', col: 2, row: 2 };

  it('a strike floats its damage, a crit its damage with "!" as the crit model', () => {
    const { scene, texts } = battle();
    scene._showStrikeResult({ damage: 9, isCrit: false }, striker, target, false);
    scene._showStrikeResult({ damage: 27, isCrit: true }, striker, target, false);
    expect(texts.map((t) => [t.text, t.style.fontSize, t.style.color])).toEqual([
      ['9', '13px', UI_PALETTE.text],
      ['27!', '18px', UI_PALETTE.accentText],
    ]);
  });

  it('a strike for 0 floats "No damage" with its spark; a dodge floats MISS', () => {
    const { scene, texts, graphics } = battle();
    scene._showStrikeResult({ damage: 0, isCrit: false }, striker, target, false);
    scene._showStrikeMiss(target, false);
    expect(texts.map((t) => t.text)).toEqual(['No damage', 'MISS']);
    expect(graphics).toHaveLength(1);
  });

  it('reduced motion reaches the float: no rise, a hold and a fade', () => {
    const { scene, tweens } = battle({ reduced: true });
    scene._showStrikeResult({ damage: 9, isCrit: true }, striker, target, true);
    expect(tweens).toHaveLength(1);
    expect(tweens[0]).toMatchObject({ delay: REDUCED_HOLD_MS, duration: REDUCED_FADE_MS });
    expect(tweens[0].y).toBeUndefined();
  });

  it('a drain floats the green "+N" beside the striker, Thorns the red cost', () => {
    const { scene, texts } = battle();
    scene._showStrikeResult(
      {
        damage: 5,
        healed: 4,
        heal: 4,
        strikerHealTo: 20,
        reflectTaken: 3,
        reflectDamage: 3,
        strikerHPAfter: 5,
      },
      striker,
      target,
      false,
    );
    expect(texts.map((t) => [t.text, t.style.color])).toEqual([
      ['5', UI_PALETTE.text],
      ['+4', UI_PALETTE.good],
      ['−3 Thorns', UI_PALETTE.bad],
    ]);
  });

  it('poison, lava and acid ticks float their words in their own colours', async () => {
    const { scene, texts } = battle();
    await scene.showPoisonDamage(target, 3);
    await scene.showTerrainDamage(target, 5);
    await scene.showAcidDamage(target, 2);
    expect(texts.map((t) => [t.text, t.style.color])).toEqual([
      ['Poison -3', UI_PALETTE.threatStatus],
      ['Lava -5', UI_PALETTE.terrainBurn],
      ['Acid -2', UI_PALETTE.terrainAcid],
    ]);
  });

  it('the poison tick is awaited as the model describes it, and a cancel removes the number', async () => {
    const { scene, texts } = battle();
    await scene.showPoisonDamage(target, 3);
    const [config, options] = scene._awaitSceneTween.mock.calls[0];
    expect(config).toMatchObject({
      alpha: 0,
      duration: combatNumberStyle('poison', 3).motion.duration,
    });
    expect(options.label).toBe('show_poison_damage');
    options.onCancel();
    expect(texts[0].destroyed).toBe(true);
  });

  it('a float never advances the battle stream, whatever the scene draws', async () => {
    const draws = vi.fn(() => 0.5);
    Math.random = draws;
    const { scene } = battle();
    scene._showStrikeResult(
      { damage: 0, isCrit: false, healed: 2, reflectTaken: 1 },
      striker,
      target,
      false,
    );
    scene._showStrikeResult({ damage: 12, isCrit: true }, striker, target, false);
    scene._showStrikeMiss(target, true);
    await scene.showPoisonDamage(target, 3);
    await scene.showTerrainDamage(target, 5);
    await scene.showAcidDamage(target, 2);
    expect(draws).not.toHaveBeenCalled();
  });
});

describe('no float site keeps a look of its own', () => {
  const read = (path) => readFileSync(path, 'utf8');
  const battleScene = read('src/scenes/BattleScene.js');
  const heal = read('src/ui/HealController.js');

  it('BattleScene and HealController float through the model for every kind', () => {
    for (const kind of [
      'miss',
      'drain',
      'thorns',
      'poison',
      'lava',
      'acid',
      'ballista',
      'deathburst',
      'splash',
    ])
      expect(battleScene, kind).toContain(`kind: '${kind}'`);
    expect(battleScene).toContain("kind: event.isCrit ? 'crit' : 'strike'");
    expect(heal).toContain("kind: 'heal'");
  });

  it('no hand-built damage, heal or hazard text is left beside them', () => {
    for (const source of [battleScene, heal]) {
      expect(source).not.toMatch(/`Poison -|`Lava -|`Acid -|`Splash -/);
      expect(source).not.toMatch(/\.text\([^)]*,\s*'M[Ii][Ss][Ss]'/);
      expect(source).not.toMatch(/\.text\([^)]*`\+\$\{(?:healAmount|event\.healed)\}`/);
      expect(source).not.toMatch(
        /\.text\([^)]*`\$\{(?:event\.damage|result\.damage|effect\.amount)\}/,
      );
    }
  });
});
