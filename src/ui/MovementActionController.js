import { battleSession, isCurrentBattleSession } from './BattleSession.js';
import { settleAndPresent } from './BattleActionSettlement.js';
import { settleMoves } from '../engine/ActionMovement.js';
import { settleShove } from '../engine/ForcedMovement.js';
import { forcedMoveProbes } from './forcedMoveProbes.js';
import { settleRecruitJoin, validateRecruitJoin } from '../engine/BattleRecruits.js';
import { observeHistoryAction } from './BattleHistoryRecorder.js';
import { deedsFor } from './DeedController.js';
import { presentSettledMoves } from './ActionMovementPresentation.js';
import { safeBattlePresentation } from './safeBattlePresentation.js';
import { CombatFxController } from './CombatFxController.js';
import { hasEffectiveSkill } from '../engine/EffectiveSkills.js';
import { refreshActedAlly } from '../engine/ActionAbilitySystem.js';
import { XP_BASE_DANCE } from '../utils/constants.js';
import { UI_HEX, UI_PALETTE } from '../utils/uiStyles.js';
import { hasDOMHost } from '../utils/domUI.js';
import { growthCeremonies } from './GrowthCeremonyController.js';

function isActor(scene, unit) {
  return !!unit && scene.playerUnits.includes(unit) && unit.currentHP > 0 && !unit.hasActed;
}
/**
 * A dancer's refresh, drawn on the ally (presentation only): the dimming of a unit that has
 * acted lifts, with a heal chime, a buff glint and a sparkle. Dance and Goddess Dance share it.
 */
export function presentRefreshSparkle(scene, ally) {
  safeBattlePresentation('dance refresh graphic', () => scene.undimUnit(ally), { scene });
  safeBattlePresentation(
    'dance sparkle',
    () => {
      scene.registry.get('audio')?.playSFX('sfx_heal');
      const pos = scene.grid.gridToPixel(ally.col, ally.row);
      (scene._combatFx ||= new CombatFxController(scene)).playBuff(pos.x, pos.y);
      const sparkle = scene.add
        .circle(pos.x, pos.y, 20, UI_HEX.hpHigh, scene._reduceMotion() ? 0.4 : 0.6)
        .setDepth(200);
      if (scene._reduceMotion()) scene.time.delayedCall(120, () => sparkle.destroy());
      else
        scene.tweens.add({
          targets: sparkle,
          alpha: 0,
          scale: 1.5,
          duration: 400,
          ease: 'Quad.easeOut',
          onComplete: () => sparkle.destroy(),
        });
    },
    { scene },
  );
}
function matches(a, b, keys) {
  return a?.ally === b?.ally && keys.every((key) => a[key] === b[key]);
}

export class MovementActionController {
  constructor(scene) {
    this.scene = scene;
  }

  executeMove(kind, unit, target, { session = battleSession(this.scene) } = {}) {
    const scene = this.scene;
    const title = kind[0].toUpperCase() + kind.slice(1);
    const keys =
      kind === 'shove'
        ? ['destCol', 'destRow']
        : kind === 'pull'
          ? ['retreatCol', 'retreatRow']
          : [];
    return settleAndPresent(scene, {
      unit,
      session,
      label: kind,
      validate: () =>
        isActor(scene, unit) &&
        (kind === 'swap' || hasEffectiveSkill(unit, kind)) &&
        target?.ally?.currentHP > 0 &&
        scene[`find${title}Targets`](unit).some((entry) => matches(entry, target, keys)),
      settle: () => {
        const allyWasActed = target.ally.hasActed;
        observeHistoryAction(
          scene,
          kind === 'swap' ? 'swapped with' : kind === 'pull' ? 'pulled' : 'shoved',
          unit,
          target.ally,
        );
        // Shove is a forced move: the ally slides on if it lands on Ice, over the real
        // board (ForcedMovement.js); a unit the fog hid can stop the slide, as it stops a walk.
        let moves;
        let ambusher = null;
        if (kind === 'shove') {
          const shove = settleShove(target, forcedMoveProbes(scene).world);
          moves = shove.moves;
          const blocker = shove.blocker;
          if (blocker && typeof blocker === 'object' && scene._isHiddenUnit(blocker)) {
            ambusher = blocker;
            if (blocker.faction === 'enemy')
              observeHistoryAction(scene, 'was ambushed by', target.ally, blocker);
          }
        } else {
          moves = settleMoves([
            {
              unit,
              to:
                kind === 'pull'
                  ? { col: target.retreatCol, row: target.retreatRow }
                  : { col: target.ally.col, row: target.ally.row },
            },
            { unit: target.ally, to: { col: unit.col, row: unit.row } },
          ]);
        }
        return { moves, allyWasActed, ambusher };
      },
      present: async ({ moves, allyWasActed, ambusher }) => {
        safeBattlePresentation(`${kind} menu`, () => scene.hideActionMenu(), { scene });
        await presentSettledMoves(scene, moves, {
          session,
          label: kind,
          duration: kind === 'swap' ? 120 : 80,
        });
        if (!isCurrentBattleSession(scene, session)) return;
        if (ambusher)
          safeBattlePresentation(
            'shove ambush',
            () => {
              const hostile = ambusher.faction === 'enemy';
              const pos = scene.grid.gridToPixel(ambusher.col, ambusher.row);
              scene.showMinorHintAt?.(
                pos.x,
                pos.y,
                hostile ? 'Ambush!' : 'Blocked',
                hostile ? UI_PALETTE.bad : UI_PALETTE.text,
              );
            },
            { scene },
          );
        safeBattlePresentation(
          `${kind} movement state`,
          () =>
            scene._refreshPostCombatMovementState(
              moves.map((move) => move.unit),
              { revealFog: false },
            ),
          { scene },
        );
        if (kind === 'swap' && allyWasActed)
          safeBattlePresentation('swap acted ally dim', () => scene.dimUnit(target.ally), {
            scene,
          });
      },
    });
  }

  executeDance(unit, target, { session = battleSession(this.scene) } = {}) {
    const scene = this.scene;
    return settleAndPresent(scene, {
      unit,
      session,
      label: 'dance',
      validate: () =>
        isActor(scene, unit) &&
        hasEffectiveSkill(unit, 'dance') &&
        target?.ally?.currentHP > 0 &&
        scene.findDanceTargets(unit).some((entry) => entry.ally === target?.ally),
      settle: () => {
        observeHistoryAction(scene, 'danced for', unit, target.ally);
        deedsFor(scene).onRefresh(unit);
        refreshActedAlly(target.ally);
        return { xp: scene.awardScaledXP(unit, XP_BASE_DANCE, { present: false }) };
      },
      // The gain's EXP gauge plays after this, with any level-up card (awardScaledXP
      // queued its record in the settlement).
      present: () => {
        safeBattlePresentation('dance menu', () => scene.hideActionMenu(), { scene });
        presentRefreshSparkle(scene, target.ally);
      },
    });
  }

  async executeTalk(lord, { session = battleSession(this.scene) } = {}) {
    const scene = this.scene;
    let npc;
    // True when the rout waited on this very recruit (RoutObjective's requiredRecruits:
    // the prologue's Sera), read before the join. A standard run requires nobody, so
    // its Talk never reaches checkBattleEnd from here.
    let routWaited = false;
    const done = await settleAndPresent(scene, {
      unit: lord,
      session,
      label: 'talk',
      state: 'COMBAT_RESOLVING',
      validate: () =>
        isActor(scene, lord) &&
        lord.isLord === true &&
        !!(npc = scene.findTalkTarget(lord)) &&
        validateRecruitJoin(npc, scene.npcUnits, scene.playerUnits),
      settle: () => {
        routWaited =
          scene.battleConfig?.objective === 'rout' &&
          (scene.pendingRequiredRecruits?.() || []).includes(npc.name);
        const result = settleRecruitJoin({
          npc,
          npcUnits: scene.npcUnits,
          playerUnits: scene.playerUnits,
          battleRecruits: scene._battleRecruits,
          runManager: scene.runManager,
          turn: scene.turnManager?.turnNumber,
          battleBlessings: scene._battleBlessings || null,
        });
        scene._battleRecruits = result.battleRecruits;
        observeHistoryAction(scene, 'recruited', lord, npc);
        // A prologue chapter's authored recruit (Sera) says its own line.
        const authored = scene._prologue?.talkLine?.(npc) || null;
        const lines = (npc.isLord ? scene.gameData.dialogue?.lordRecruitLines?.[npc.name] : null) ||
          scene.gameData.dialogue?.recruitLines?.[npc.className] || ['Joined the army!'];
        return {
          npc,
          line:
            authored ||
            scene.runManager?.pickNarrativeLine?.(
              lines,
              `recruit:${npc.className}:${npc.isLord ? npc.name : 'class'}`,
            ) ||
            lines[0],
        };
      },
      present: async ({ npc, line }) => {
        safeBattlePresentation('talk menu', () => scene.hideActionMenu(), { scene });
        let carded = false;
        await safeBattlePresentation(
          'talk recruit card',
          async () => {
            const growth = hasDOMHost() ? growthCeremonies(scene) : null;
            if (growth) carded = await growth.showRecruit({ unit: npc, kind: 'recruit', line });
          },
          { scene },
        );
        if (!isCurrentBattleSession(scene, session)) return;
        if (!carded)
          await safeBattlePresentation(
            'talk dialogue',
            () => scene.dialogueOverlay.show(npc.name, line, scene._getPortraitKey(npc)),
            { scene },
          );
        if (!isCurrentBattleSession(scene, session)) return;
        safeBattlePresentation(
          'talk recruit graphic',
          () => {
            scene.removeUnitGraphic(npc);
            scene.addUnitGraphic(npc);
          },
          { scene },
        );
        safeBattlePresentation('talk objective', () => scene.updateObjectiveText(), { scene });
        // The prologue's talk beat (Sera joins: her lesson starts here).
        if (scene._prologue)
          await safeBattlePresentation('talk beat', () => scene._prologue.onTalk(lord, npc), {
            scene,
          });
      },
    });
    // A join can complete a rout that waited on this recruit. The action's own
    // completion only checks the battle's end when it ends the phase, so the join
    // checks it here, and only then.
    if (done && routWaited && isCurrentBattleSession(scene, session)) scene.checkBattleEnd?.();
    return done;
  }
}
