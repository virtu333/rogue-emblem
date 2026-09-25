/**
 * CombatChoreography — plays one resolved strike (Combat v2).
 *
 * BattleScene resolves combat first, then hands each strike here with callbacks for
 * the game-facing parts (damage numbers, HP bars). The sequence comes from the pure
 * plan in src/art/combatFx/strikePlan.js and every object it draws is owned by the
 * scene's CombatFxController, so interrupted strikes (rewind, shutdown, restore) clean
 * up through the controller.
 *
 *   windup -> lunge (traced windup/strike frames, afterimages) -> travel (arrows arc,
 *   bolts chain, breath rolls) -> contact (impact frame held, hit flash, damage number,
 *   crit ink vignette + shock ring) -> hit-stop -> react (knockback + ground dust,
 *   crimson tint) -> hold -> recover
 *
 * Presentation only: never reads or writes RNG, never changes the outcome.
 */
import { battleSpeed } from '../utils/combatTiming.js';
import { CombatFxController, unitPoints } from './CombatFxController.js';
import { fxFamily, fxFamilyIdForWeapon } from '../art/combatFx/fxFamilies.js';
import { planStrike, fxSeed } from '../art/combatFx/strikePlan.js';
import { MOTE_COLORS } from '../art/combatFx/fxPalette.js';
import { UI_HEX } from '../utils/uiStyles.js';

const HIT_FLASH = MOTE_COLORS.emberHot;

function tileDistance(a, b) {
  if (!a || !b) return 1;
  const d = Math.abs((a.col ?? 0) - (b.col ?? 0)) + Math.abs((a.row ?? 0) - (b.row ?? 0));
  return Math.max(1, d);
}

export class CombatChoreography {
  constructor(scene) {
    this.scene = scene;
  }

  get fx() {
    return (this.scene._combatFx ||= new CombatFxController(this.scene));
  }

  settings() {
    const scene = this.scene;
    return {
      speed: battleSpeed(scene),
      reduced: Boolean(scene._reduceMotion?.()),
      quality: scene._effectsQuality?.() ?? 'high',
    };
  }

  /** The family and plan for a strike (pure inputs; exposed for tests and tools). */
  describe({ event, striker, target, legendaryArt = null, followUp = false, windUp = false }) {
    const distance = tileDistance(striker, target);
    const familyId = fxFamilyIdForWeapon(striker?.weapon, {
      distance,
      entity: striker?.isEntity === true,
    });
    const family = fxFamily(familyId);
    const plan = planStrike(
      {
        miss: Boolean(event?.miss),
        crit: Boolean(event?.isCrit),
        followUp,
        windUp,
        signature: Boolean(legendaryArt),
        distance,
        projectile: family.projectile
          ? { kind: family.projectile.kind, slow: Boolean(family.projectile.slow) }
          : null,
      },
      this.settings(),
    );
    return { familyId, family, plan, distance };
  }

  /**
   * @param {object} s { event, striker, target, split, legendaryArt, followUp, windUp,
   *   strikeIndex, signatureKey, artStrike, artCatalog, onStrikeSound, onContact, onMiss }
   */
  async playStrike(s) {
    const scene = this.scene;
    const fx = this.fx;
    const { event, striker, target } = s;
    const { family, plan, distance } = this.describe(s);
    const seed = fxSeed(
      striker?.battleEntityId || striker?.name,
      target?.battleEntityId || target?.name,
      scene.turnManager?.turnNumber,
      s.strikeIndex ?? 0,
    );
    const miss = Boolean(event?.miss);
    const tempo = plan.flags.ranged ? 'ranged' : s.followUp ? 'followup' : 'normal';
    const holdStep = plan.steps.find((st) => st.id === 'hitStop');
    const holdMs = holdStep && plan.flags.hitStop ? holdStep.baseMs : 0;

    const sg = striker?.graphic;
    // A rewind, checkpoint restore or shutdown mid-strike bumps the controller's epoch:
    // the rest of this strike belongs to a discarded timeline (or a dead scene), so it
    // stops at the next step instead of drawing or moving anything more.
    const epoch = fx.epoch;
    // A strike resolved after the scene stopped (or before it runs) draws nothing.
    if (!fx._live()) return;
    fx.tintUnit(striker, 0xffffff);
    s.onStrikeSound?.();
    for (const step of plan.steps) {
      if (fx.stale(epoch)) return;
      switch (step.id) {
        case 'windup':
          break; // folded into the lunge (it owns the pull-back)
        case 'lunge':
          await fx.lungeForward(striker, target, {
            windUp: plan.steps.some((st) => st.id === 'windup'),
            tempo,
            px: plan.mode === 'full' ? plan.flags.lungePx : undefined,
            ghost: plan.flags.ghosts && !plan.flags.ranged,
          });
          if (sg?.clearTint && !fx.stale(epoch)) sg.clearTint();
          break;
        case 'travel':
          await fx.travel(family, striker, target, {
            tiles: distance,
            miss,
            ms: step.baseMs,
            seed,
          });
          break;
        case 'contact':
          if (miss) {
            fx.dodge(target, striker, { ghost: plan.flags.ghosts });
            s.onMiss?.();
          } else this._contact(s, family, plan, holdMs, distance, seed);
          break;
        case 'hitStop':
        case 'hold':
        case 'missHold':
          if (step.wait) await scene._awaitSceneDelay(step.baseMs, { label: step.label });
          break;
        case 'react':
          this._react(s, family, plan);
          break;
        case 'recover':
          if (target?.graphic?.clearTint && !miss) target.graphic.clearTint();
          await fx.lungeBack(striker, target, { wait: step.wait });
          break;
        default:
          break;
      }
    }
  }

  _contact(s, family, plan, holdMs, distance, seed) {
    const fx = this.fx;
    const { event, striker, target, split } = s;
    const tg = target?.graphic;
    // Readable impact frame: the target flashes hot through the hit-stop.
    // Two frames of hot flash, then the body shows through the rest of the freeze.
    if (plan.flags.hitStop && tg?.setTintFill) {
      fx.tintUnit(target, HIT_FLASH, { fill: true });
      fx._later(Math.min(34, holdMs), () => {
        if (tg.scene && tg.isTinted) fx.tintUnit(target, 0xffe2c0);
      });
    } else fx.tintUnit(target, UI_HEX.dangerLine);
    fx.playImpact(event, striker, target, {
      family,
      distance,
      holdMs,
      signatureKey: s.signatureKey || null,
    });
    fx.playProcOverlays(split, striker, target, { seed });
    if (s.artStrike) fx.playArtBurst(split, target, s.artCatalog);
    const pts = unitPoints(target);
    if (pts) {
      if (plan.flags.impactLight) fx.impactLight(pts.body.x, pts.body.y, family.light);
      if (plan.flags.vignette) {
        const sp = unitPoints(striker);
        const cx = sp && distance <= 3 ? (sp.body.x + pts.body.x) / 2 : pts.body.x;
        const cy = sp && distance <= 3 ? (sp.body.y + pts.body.y) / 2 : pts.body.y;
        fx.vignettePulse(cx, cy, {
          peak: s.signatureKey ? 0.55 : 0.46,
          holdMs: Math.max(0, holdMs - 40),
          outMs: s.signatureKey ? 320 : 220,
        });
      }
      if (plan.flags.motes && (event?.isCrit || s.signatureKey)) {
        fx.moteBurst(pts.body.x, pts.body.y, {
          count: s.signatureKey ? 22 : 10,
          radius: s.signatureKey ? 26 : 16,
          colors: family.magic
            ? [MOTE_COLORS.emberHot, MOTE_COLORS.ember, MOTE_COLORS.emberDeep]
            : [MOTE_COLORS.gilt, MOTE_COLORS.ember, MOTE_COLORS.emberDim],
          seed,
        });
      }
    }
    s.onContact?.();
    if (event?.isCrit || s.signatureKey) {
      fx.critImpact(striker);
      fx.zoomPunch();
    }
  }

  _react(s, family, plan) {
    const fx = this.fx;
    const { striker, target, split } = s;
    fx.tintUnit(target, UI_HEX.dangerLine);
    // Defensive proc: the target braces in place instead of getting knocked back.
    if (split?.target?.length > 0) fx.brace(target);
    else {
      const px = s.event?.isCrit
        ? plan.flags.knockPx
        : family.heavy
          ? Math.max(plan.flags.knockPx, 6)
          : plan.flags.knockPx;
      fx.recoil(target, striker, px);
      if (plan.flags.dust) fx.playDust(target, striker);
    }
    if (plan.flags.ranged) fx.driftHome(striker);
  }
}
