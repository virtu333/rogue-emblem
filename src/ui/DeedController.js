// DeedController — the battle's seam into DeedSystem (Deeds & Epithets).
//
// BattleScene calls one line at each engine outcome site: a resolved combat,
// a unit leaving the field, a heal, a dance, the end of an enemy phase. This
// records progress as plain JSON on the units (`_battleDeeds`), so a Vision
// rewind or a suspend/resume carries it exactly like HP. Nothing here writes
// run or meta state mid-battle: deeds commit at victory (`commitVictory`,
// before the save) and the reveal rite plays after the save (`presentVictory`).
//
// Presentation-only side effects (the fallen-with-a-title notice) never touch
// the RNG, and recording failures are swallowed: deeds are decoration and
// must never break a battle.

import {
  commitBattleDeeds,
  recordCombat,
  recordEnemyPhaseEnd,
  recordHeal,
  recordKill,
  recordRefresh,
  sentenceName,
  unitEpithet,
} from '../engine/DeedSystem.js';
import { growthCeremonies } from './GrowthCeremonyController.js';
import { hasDOMHost } from '../utils/domUI.js';

const warn = (where, error) => console.warn(`[DeedController] ${where} skipped:`, error);

export class DeedController {
  constructor(scene) {
    this.scene = scene;
  }

  get deedsData() {
    return this.scene?.gameData?.deeds || null;
  }

  /** Deeds are a run feature: no data, no run or the tutorial → nothing recorded. */
  active() {
    const s = this.scene;
    return Boolean(s?.runManager && this.deedsData && !s.battleParams?.tutorialMode);
  }

  _terrainName(unit) {
    try {
      const terrain = this.scene?.grid?.getTerrainAt?.(unit?.col, unit?.row);
      return typeof terrain?.name === 'string' ? terrain.name : null;
    } catch {
      return null;
    }
  }

  /** After a resolveCombat result is applied (final HP on both units). */
  onCombat(attacker, defender, result) {
    if (!this.active()) return;
    try {
      recordCombat(result, attacker, defender, {
        phase: this.scene.turnManager?.currentPhase || null,
      });
    } catch (error) {
      warn('combat', error);
    }
  }

  /** From removeUnit: the single death funnel. */
  onUnitRemoved(unit, killer = null) {
    if (!this.active()) return;
    try {
      recordKill(unit, killer, { terrain: killer ? this._terrainName(killer) : null });
    } catch (error) {
      warn('kill', error);
    }
  }

  /**
   * A titled unit's death is named in full ("Elara, Who Held the Bridge, has
   * fallen."), after its last words. The commander has its own FALLEN band;
   * this is the quiet crimson line for everyone else. Presentation only.
   */
  announceFall(unit) {
    if (!this.active()) return;
    try {
      if (unit?.faction === 'player' && !unit.isCommander && unitEpithet(unit) && hasDOMHost())
        this.scene._getCeremonies?.()?.showNotice?.({
          message: `${sentenceName(unit)} has fallen.`,
          tone: 'bad',
        });
    } catch {
      /* presentation only */
    }
  }

  /** A staff or healing ability restored `target` from `hpBefore`. */
  onHeal(healer, target, hpBefore) {
    if (!this.active() || !healer || !target || healer === target) return;
    try {
      recordHeal(healer, (Number(target.currentHP) || 0) - (Number(hpBefore) || 0));
    } catch (error) {
      warn('heal', error);
    }
  }

  onRefresh(dancer) {
    if (!this.active()) return;
    try {
      recordRefresh(dancer);
    } catch (error) {
      warn('refresh', error);
    }
  }

  /** onPhaseChange('player'): the enemy phase before `turn` is over. */
  onEnemyPhaseEnd(turn) {
    if (!this.active()) return;
    const s = this.scene;
    try {
      const units = s.playerUnits || [];
      recordEnemyPhaseEnd(units, {
        turn,
        terrainAt: (unit) => this._terrainName(unit),
        commander: units.find((u) => u?.isCommander) || null,
        deedsData: this.deedsData,
      });
    } catch (error) {
      warn('enemy phase', error);
    }
  }

  /**
   * Victory, before the units are serialized and the run is saved. A battle
   * won during the enemy phase closes that phase first. Returns (and keeps on
   * the scene) the announcements for the rite.
   */
  commitVictory(survivors) {
    const s = this.scene;
    s._newDeeds = null;
    if (!this.active()) return [];
    try {
      if (s.turnManager?.currentPhase === 'enemy')
        this.onEnemyPhaseEnd((s.turnManager.turnNumber || 0) + 1);
      const rm = s.runManager;
      const announcements = commitBattleDeeds(survivors, this.deedsData, {
        battleKey: `${rm.currentAct || ''}:${s.nodeId ?? ''}:${rm.completedBattles ?? 0}`,
        act: rm.currentAct || null,
        battle: (Number(rm.completedBattles) || 0) + 1,
        deployedCount: s.battleParams?.deployCount,
      });
      s._newDeeds = announcements.length ? announcements : null;
      return announcements;
    } catch (error) {
      warn('commit', error);
      return [];
    }
  }

  /**
   * The reveal rite for this victory's deeds (after the save). Resolves when
   * dismissed; a no-op without deeds or a DOM host (the roster still shows
   * every title).
   */
  async presentVictory() {
    const s = this.scene;
    const entries = s?._newDeeds;
    s._newDeeds = null;
    if (!Array.isArray(entries) || !entries.length) return false;
    try {
      return (await growthCeremonies(s)?.showDeeds({ entries })) === true;
    } catch (error) {
      warn('rite', error);
      return false;
    }
  }
}

/** The scene's DeedController (created on demand; reset with the scene). */
export function deedsFor(scene) {
  return (scene._deedController ||= new DeedController(scene));
}
