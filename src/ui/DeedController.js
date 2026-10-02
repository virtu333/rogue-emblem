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
  addFallenBattleRecord,
  commitBattleDeeds,
  commitFallenBattleDeeds,
  fallenBattleRecord,
  findFallenBattleRecord,
  normalizeFallenBattleRecords,
  recordAreaStrike,
  recordCombat,
  recordEnemyPhaseEnd,
  recordHeal,
  recordKill,
  recordRefresh,
  recordStaffUse,
  sentenceName,
  unitEpithet,
} from '../engine/DeedSystem.js';
import { normalizeBattleRecruits } from '../engine/BattleRecruits.js';
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

  /** After a chosen-center area art's blast is applied (no combat result). */
  onAreaStrike(caster, weapon, credits) {
    if (!this.active()) return;
    try {
      recordAreaStrike(caster, weapon, credits);
    } catch (error) {
      warn('area strike', error);
    }
  }

  /**
   * From removeUnit: the single death funnel. A fallen player unit leaves a
   * record of what it did and carried this battle (`scene._fallenBattleRecords`,
   * world state that rewinds and resumes with the battle), used at victory.
   */
  onUnitRemoved(unit, killer = null) {
    const s = this.scene;
    // The death record carries what the unit held as it fell (its fallen record
    // and the convoy depend on it), so it is taken in any run battle, deeds or not.
    if (s?.runManager && !s.battleParams?.tutorialMode) {
      try {
        const record = fallenBattleRecord(unit);
        if (record) s._fallenBattleRecords = addFallenBattleRecord(s._fallenBattleRecords, record);
      } catch (error) {
        warn('fallen', error);
      }
    }
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

  /** A staff use was spent (heal, cure, warp, rescue): the staff's use count. */
  onStaffUse(user, staff) {
    if (!this.active()) return;
    try {
      recordStaffUse(user, staff);
    } catch (error) {
      warn('staff', error);
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
      const ctx = {
        battleKey: `${rm.currentAct || ''}:${s.nodeId ?? ''}:${rm.completedBattles ?? 0}`,
        act: rm.currentAct || null,
        battle: (Number(rm.completedBattles) || 0) + 1,
      };
      const announcements = commitBattleDeeds(survivors, this.deedsData, {
        ...ctx,
        deployedCount: s.battleParams?.deployCount,
        fallenCount: s._playerDeathsThisBattle,
      });
      s._newDeeds = announcements.length ? announcements : null;
      // The fallen keep what they did here, folded into the deeds they entered
      // with (completeBattle writes them to the fallen record). No rite.
      const posthumous = this.commitFallen(ctx);
      // The save remembers every deed its army has earned (the Compendium lists them).
      const earned = [...announcements, ...posthumous].map((a) => a.deedId);
      if (earned.length) s.registry?.get?.('meta')?.recordDeedsEarned?.(earned);
      return announcements;
    } catch (error) {
      warn('commit', error);
      return [];
    }
  }

  /**
   * Commit the fallen units' battle records (scene._fallenBattleRecords, kept for
   * completeBattle's `fallenBattleRecords`) against the deeds each entered with:
   * its roster entry, or its as-joined record for a mid-battle recruit.
   */
  commitFallen(ctx) {
    const s = this.scene;
    try {
      const records = normalizeFallenBattleRecords(s._fallenBattleRecords);
      const entrants = [
        ...(s.runManager?.roster || []),
        ...normalizeBattleRecruits(s._battleRecruits).map((entry) => entry.unit),
      ];
      const posthumous = commitFallenBattleDeeds(records, this.deedsData, ctx, (record) =>
        entrants.find((unit) => findFallenBattleRecord([record], unit) === record),
      );
      s._fallenBattleRecords = records;
      return posthumous;
    } catch (error) {
      warn('fallen commit', error);
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
