/**
 * BattleBeatsController -- mid-battle story beats.
 *
 * Three beats, all data-driven from dialogue.json and all safe to miss
 * (missing sections, tutorial battles without a runManager, or reduced
 * effects simply skip -- a beat can never block or crash combat):
 *  - checkBossHalfHealth: once per battle, when the boss first drops below
 *    half HP, a brief auto-dismissing dialogue line (farewell-style).
 *    Gated through runManager.shownDialogueKeys so suspend/resume never
 *    replays it. Shows even in reduced-effects mode -- it's story.
 *  - onCritStrike / onKill: rare floating one-liner quips above a lord
 *    (all lords, both phases). 20% chance on crit or regular kill under a
 *    shared 10s cooldown; a lord's killing blow on a boss always quips.
 *    Skipped entirely in reduced-effects mode.
 *  - getBossPreBattleEntries: composes the boss's preBattle entries with
 *    the commander's reply (preBattleReply, variant-gated per commander;
 *    only the loop-aware bosses have one).
 */

import { buildNarrativeContext, selectDialogueEntries } from '../engine/NarrativeDirector.js';
import { adaptDialogueEntries } from '../engine/DialogueCast.js';

const QUIP_DEPTH = 301; // world-space, same tier as proc chips (damage text is 300)
const QUIP_OFFSET_Y = -58; // clear of proc chips (-26/-44) and damage numbers (-16 -> -32)
const QUIP_COOLDOWN_MS = 10000; // shared across ALL quips so exchanges never chain
const QUIP_CHANCE = 0.2;

export class BattleBeatsController {
  constructor(scene) {
    this.scene = scene;
    this._lastQuipAt = -Infinity;
    this._live = new Set(); // quip texts still on screen (for destroy())
  }

  destroy() {
    for (const obj of this._live) {
      if (obj?.scene) obj.destroy();
    }
    this._live.clear();
  }

  _ctx(bossName = null) {
    const scene = this.scene;
    return buildNarrativeContext({
      meta: scene.registry?.get?.('meta') || null,
      runManager: scene.runManager || null,
      bossName,
    });
  }

  /**
   * Boss preBattle entries + the commander's reply, in order. Bosses without
   * a preBattleReply section (most of them) get just their preBattle lines.
   */
  getBossPreBattleEntries(bossName) {
    const encounters = this.scene.gameData?.dialogue?.bossEncounters;
    const boss = encounters?.[bossName];
    if (!boss) return [];
    const ctx = this._ctx(bossName);
    const pre = selectDialogueEntries(boss.preBattle, ctx) || [];
    const reply = selectDialogueEntries(boss.preBattleReply, ctx) || [];
    return [...pre, ...reply];
  }

  /**
   * Fire the boss's half-health line the first time it drops strictly below
   * 50% HP. Awaited by the combat resolvers after deaths are applied, so a
   * boss killed outright from above half never speaks.
   */
  async checkBossHalfHealth() {
    const scene = this.scene;
    if (!scene.isBoss || !scene.runManager || !scene._bossName) return;
    const boss = scene.enemyUnits?.find((u) => u?.isBoss && u.currentHP > 0);
    if (!boss) return;
    const maxHP = Number(boss.stats?.HP) || 0;
    if (maxHP <= 0 || boss.currentHP * 2 >= maxHP) return;

    const bossName = scene._resolveBossDialogueName?.(scene._bossName);
    if (!bossName) return;
    const dialogueKey = `boss_half_${bossName}`;
    if (scene.runManager.hasShownDialogue?.(dialogueKey)) return;

    const entries = selectDialogueEntries(
      scene.gameData?.dialogue?.bossEncounters?.[bossName]?.halfHealth,
      this._ctx(bossName),
    );
    if (!Array.isArray(entries) || entries.length === 0) return;

    // Mark before showing (matches _showStoryDialogueOnce): a refresh
    // mid-dialogue loses the line, never replays it.
    scene.runManager.markDialogueShown?.(dialogueKey);
    const adapted = adaptDialogueEntries(entries, scene.runManager.getStartingLordNames?.());
    for (const entry of adapted) {
      if (!entry || typeof entry.line !== 'string') continue;
      try {
        // Auto-dismisses after ~3s; input is locked while visible via
        // isStoryInputLocked()'s dialogueOverlay.visible check.
        await scene.dialogueOverlay?.show(entry.speaker, entry.line, entry.portrait);
      } catch (_) {
        /* a failed overlay must not break combat flow */
      }
    }
  }

  /** A lord landed a critical strike (either phase). Fire-and-forget. */
  onCritStrike(striker) {
    if (!striker?.isLord || striker.faction !== 'player') return;
    this._maybeQuip(striker, 'onCrit', { chance: QUIP_CHANCE });
  }

  /** A unit died; quip for a lord's killing blow. Fire-and-forget. */
  onKill(victim, killer) {
    if (!killer?.isLord || killer.faction !== 'player') return;
    if (!(killer.currentHP > 0)) return;
    if (victim?.isBoss) {
      this._maybeQuip(killer, 'onKill', { guaranteed: true });
    } else {
      this._maybeQuip(killer, 'onKill', { chance: QUIP_CHANCE });
    }
  }

  _maybeQuip(lord, poolKey, { chance = 1, guaranteed = false } = {}) {
    const scene = this.scene;
    if (scene._isReducedEffects?.()) return;
    const now = scene.time?.now ?? 0;
    if (!guaranteed) {
      if (now - this._lastQuipAt < QUIP_COOLDOWN_MS) return;
      if (Math.random() >= chance) return;
    }
    const pool = scene.gameData?.dialogue?.lordQuips?.[poolKey]?.[lord.name];
    if (!Array.isArray(pool) || pool.length === 0) return;
    const line = pool[Math.floor(Math.random() * pool.length)];
    if (typeof line !== 'string' || !line) return;
    if (guaranteed) {
      // A boss-kill quip replaces any quip already on screen (e.g. the crit
      // quip from the same killing strike) instead of stacking with it.
      this.destroy();
    }
    this._lastQuipAt = now;
    this._showQuipText(lord, line);
  }

  _showQuipText(lord, line) {
    const scene = this.scene;
    try {
      const pos = scene.grid?.gridToPixel?.(lord.col, lord.row);
      if (!pos) return;
      const quip = scene.add
        .text(pos.x, pos.y + QUIP_OFFSET_Y, line, {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#ffe9a8',
          fontStyle: 'italic',
          backgroundColor: '#000000cc',
          padding: { x: 5, y: 2 },
        })
        .setOrigin(0.5)
        .setDepth(QUIP_DEPTH)
        .setAlpha(0);
      this._live.add(quip);
      scene.tweens.add({
        targets: quip,
        alpha: 1,
        duration: 120,
      });
      scene.tweens.add({
        targets: quip,
        y: pos.y + QUIP_OFFSET_Y - 20,
        alpha: 0,
        delay: 900,
        duration: 1400,
        onComplete: () => {
          this._live.delete(quip);
          if (quip?.scene) quip.destroy();
        },
      });
    } catch (_) {
      /* rendering flavor text must never break combat */
    }
  }
}
