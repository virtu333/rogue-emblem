// Assembly: identity + class recipe + faction + pose/frame -> Figure -> RGBA.
import { Figure } from './figure.mjs';
import { resolve, unlightGrade, actedGrade } from './resolve.mjs';
import { TREATMENTS } from './palette.mjs';
import { RECIPES as CLASSES } from './recipes.mjs';
import { splitImage } from './treat.mjs';

// Tags that make up the "upper body" for the idle breath and lunge offsets.
export const UPPER = [
  'torso',
  'head',
  'hair',
  'hairBack',
  'headgear',
  'armF',
  'armB',
  'weapon',
  'cloakTop',
  'shield',
  'back',
  'cord',
  'rider',
  'riderArm',
];

/**
 * Build one sprite.
 * unit = { cls, faction: 'player'|'enemy'|'corrupted', id: identity, pose: 'idle'|'windup'|'strike', frame: 0..3 }
 */
export function buildFigure(unit) {
  const recipe = CLASSES[unit.cls];
  if (!recipe) throw new Error(`unknown class ${unit.cls}`);
  const f = new Figure();
  const ctx = {
    faction: unit.faction,
    id: { ...(recipe.identityDefaults ?? {}), ...unit.id },
    pose: unit.pose ?? 'idle',
    frame: unit.frame ?? 0,
  };
  recipe.draw(f, ctx);
  // Idle: frames 1 and 2 drop the upper body a pixel (breath); frame 2 also
  // sways loose cloth. Legs never move, so the feet stay on y=43.
  if (ctx.pose === 'idle' && (ctx.frame === 1 || ctx.frame === 2)) {
    f.shiftTags(recipe.upper ?? UPPER, 0, 1);
  }
  if (ctx.pose === 'idle' && ctx.frame >= 2) f.shiftTags(['sway'], -1, 0);
  // per-class extra idle motion, e.g. a pegasus wing beat
  for (const [tags, dx, dy] of (ctx.pose === 'idle' && recipe.idleExtra?.[ctx.frame]) || [])
    f.shiftTags(tags, dx, dy);
  if (ctx.pose === 'windup') f.shiftTags(recipe.upper ?? UPPER, -1, 0);
  if (ctx.pose === 'strike') f.shiftTags(recipe.upper ?? UPPER, 2, 1);
  f.contactShadow();
  return { f, recipe, ctx };
}

export function aliasFor(unit, recipe, ctx) {
  const t = TREATMENTS[unit.faction === 'corrupted' ? 'corrupted' : unit.faction];
  const id = ctx.id;
  return {
    skin: id.skin ?? 'skinWarm',
    hair: id.hairRamp ?? 'hairBrown',
    sub: id.sub ?? 'charcoal',
    leather: id.leather ?? 'leather',
    linen: id.linen ?? 'linen',
    wood: 'wood',
    mount: id.mount ?? 'horseBay',
    mane: id.mane ?? 'maneDark',
    ...t,
    ...(unit.faction === 'player' && recipe.playerAlias ? recipe.playerAlias : {}),
    ...(unit.faction !== 'player' && recipe.enemyAlias ? recipe.enemyAlias : {}),
    ...(unit.alias ?? {}),
  };
}

export function renderUnit(unit, opts = {}) {
  const { f, recipe, ctx } = buildFigure(unit);
  const alias = aliasFor(unit, recipe, ctx);
  let grade = unit.faction === 'corrupted' ? unlightGrade() : null;
  if (opts.acted) {
    const a = actedGrade();
    const g0 = grade;
    grade = { ...(g0 ?? {}), fn: (c, s, sh) => a.fn(g0?.fn ? g0.fn(c, s, sh) : c, s, sh) };
  }
  let rgba = resolve(f, alias, { grade, rim: opts.rim ?? true, outline: opts.outline ?? 'selout' });
  if (unit.faction === 'corrupted' && opts.split !== false)
    rgba = splitImage(rgba, 64, 64, unit.seed ?? 7);
  return { rgba, f, alias, recipe, ctx };
}
