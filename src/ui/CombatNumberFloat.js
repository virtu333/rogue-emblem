// CombatNumberFloat.js — draws the floating combat numbers that combatNumberStyle describes.
//
// Every number floated over a unit in battle (a blow, a crit, "No damage", a heal, a poison,
// lava or acid tick, a miss, Thorns, a ballista bolt, a Deathburst, the Entity's splash) is
// built here from the model, so no site picks its own colour, size or reduced-motion rule.
//
// Presentation only, and the battle's Math.random IS its RNG: the text goes through
// presentationText and the spark's Graphics through withPresentationRandom, so drawing a
// number never advances the battle stream. No particle emitters. The numbers are plain
// Phaser objects at world positions (Grid.gridToPixel), so they stay upright when portrait
// play turns the board: only pixel conversion is rotated, never the text.
import { presentationText } from '../utils/presentationText.js';
import { withPresentationRandom } from '../utils/presentationRandom.js';
import { UI_HEX } from '../utils/uiStyles.js';
import { combatNumberStyle } from './combatNumberStyle.js';

function quietly(fn) {
  try {
    fn();
  } catch {
    /* cosmetic only */
  }
}

/** The spark of a blow that did nothing: a tiny star at the unit's body, gone in a moment. */
function buildSpark(scene, spec, x, y, depth) {
  const make = scene.add?.graphics;
  if (typeof make !== 'function') return null;
  const spark = withPresentationRandom(() => make.call(scene.add));
  if (!spark) return null;
  spark.lineStyle?.(spec.width, UI_HEX.text, 1);
  for (const [x1, y1, x2, y2] of spec.segments) {
    spark.beginPath?.();
    spark.moveTo?.(x1, y1);
    spark.lineTo?.(x2, y2);
    spark.strokePath?.();
  }
  spark.setPosition?.(x, y + spec.dy);
  spark.setDepth?.(depth - 1);
  if (spec.grow) spark.setScale?.(spec.growFrom);
  return spark;
}

/**
 * Build one floating number at (x, y) and return `{ model, text, spark, tween, destroy }`.
 * `tween` is the number's rise-and-fade config (it destroys the number and its spark when done):
 * the caller adds it to the scene (`scene.tweens.add(tween)`), or awaits it
 * (`scene._awaitSceneTween(tween, { onCancel: destroy })`) where the flow waits on the number.
 * The crit's pop and the spark's own tween start here; they never need awaiting.
 *
 * `kind` / `value`: see combatNumberStyle. `depth` overrides the kind's own depth.
 */
export function buildCombatNumber(scene, { kind, value, x, y, reducedMotion = false, depth } = {}) {
  const model = combatNumberStyle(kind, value, { reducedMotion });
  const layer = Number.isFinite(depth) ? depth : model.depth;
  const text = presentationText(scene, x, y, model.text, model.style)
    .setOrigin(0.5)
    .setDepth(layer);

  let spark = null;
  const destroy = () => {
    quietly(() => text.destroy());
    quietly(() => spark?.destroy());
    spark = null;
  };

  // A drawing that fails is the caller's to report (safeBattlePresentation), but never leaves a
  // half-built number on the board.
  try {
    if (model.spark) spark = buildSpark(scene, model.spark, x, y, layer);
    const { motion } = model;
    if (motion.pop) {
      text.setScale?.(motion.pop.from);
      scene.tweens.add({
        targets: text,
        scale: 1,
        duration: motion.pop.duration,
        ease: motion.pop.ease,
        easeParams: motion.pop.easeParams,
      });
    }
    if (spark) {
      scene.tweens.add({
        targets: spark,
        alpha: 0,
        ...(model.spark.grow ? { scale: model.spark.growTo } : {}),
        delay: model.spark.delay,
        duration: model.spark.duration,
      });
    }
  } catch (err) {
    destroy();
    throw err;
  }

  const { motion } = model;
  const tween = {
    targets: text,
    ...(motion.rise ? { y: y - motion.rise } : {}),
    alpha: 0,
    delay: motion.delay,
    duration: motion.duration,
    onComplete: destroy,
  };
  return { model, text, spark, tween, destroy };
}

/** Float a number now: build it and start its tween. Returns the built number. */
export function floatCombatNumber(scene, options) {
  const number = buildCombatNumber(scene, options);
  try {
    scene.tweens.add(number.tween);
  } catch (err) {
    number.destroy();
    throw err;
  }
  return number;
}
