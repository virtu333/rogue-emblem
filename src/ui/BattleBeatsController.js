import { presentationText } from '../utils/presentationText.js';
import { createSeededRng } from '../engine/BlessingEngine.js';
/**
 * BattleBeatsController -- mid-battle story beats.
 *
 * Three beats, all data-driven from dialogue.json and all safe to miss
 * (missing sections or tutorial battles without a runManager safely skip):
 *  - checkBossHalfHealth: once per battle, when the boss first drops below
 *    half HP, a brief auto-dismissing dialogue line (farewell-style).
 *    Gated through runManager.shownDialogueKeys so suspend/resume never
 *    replays it. Shows even in reduced-effects mode -- it's story.
 *  - onCritStrike / onKill: rare floating one-liner quips above a lord
 *    (all lords, both phases). 20% chance on crit or regular kill under a
 *    shared 10s cooldown; a lord's killing blow on a boss always quips.
 *    Preserved at every effects quality with isolated presentation randomness.
 *  - getBossPreBattleEntries: composes the boss's preBattle entries with
 *    the commander's reply (preBattleReply, variant-gated per commander;
 *    only the loop-aware bosses have one).
 *  - entityRally: when the Entity's finale answers (see BattleMusicController),
 *    the army says its lines over its own units, one every two bars from the
 *    finale's first downbeat (engine/FinaleRally.js, dialogue.json
 *    finaleRally): the commander opens, the lords answer each other, the
 *    strongest recruits join in, Sera closes. Never blocks input: the music
 *    keeps time, the words ride on it.
 */

import { buildNarrativeContext, selectDialogueEntries } from '../engine/NarrativeDirector.js';
import { adaptDialogueEntries } from '../engine/DialogueCast.js';
import { composeFinaleRally } from '../engine/FinaleRally.js';
import { isEntity } from '../engine/EntitySystem.js';

const QUIP_DEPTH = 501; // Screen-pinned above battlefield effects.
const QUIP_OFFSET_Y = -58; // clear of proc chips (-26/-44) and damage numbers (-16 -> -32)
const QUIP_COOLDOWN_MS = 10000; // shared across ALL quips so exchanges never chain
const QUIP_CHANCE = 0.2;
const RALLY_HOLD_MS = 2600;
const RALLY_FADE_MS = 600;

export class BattleBeatsController {
  constructor(scene, random = createSeededRng(Date.now() >>> 0)) {
    this._random = random;
    this.scene = scene;
    this._lastQuipAt = -Infinity;
    this._live = new Set(); // quip texts still on screen (for destroy())
    this._rallyTimers = [];
    this._rallied = false;
  }

  destroy() {
    for (const obj of this._live) {
      if (obj?.scene) obj.destroy();
    }
    this._live.clear();
    for (const t of this._rallyTimers) clearTimeout(t);
    this._rallyTimers = [];
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

  /**
   * The Entity's finale answers: the army speaks, the first line on the
   * finale's downbeat (`leadMs` from now), then one every `barMs * 2`. Once
   * per battle. Returns the composed rally ([{ unit, speaker, line }]).
   */
  entityRally({ leadMs = 0, barMs = 1765 } = {}) {
    const scene = this.scene;
    if (this._rallied) return [];
    this._rallied = true;
    const rm = scene.runManager || null;
    let rally = [];
    try {
      const ctx = this._ctx('The Entity');
      const entity = (scene.enemyUnits || []).find((u) => isEntity(u));
      const maxHP = Number(entity?.stats?.HP) || 0;
      const fallen = (Array.isArray(rm?.fallenUnits) ? rm.fallenUnits : [])
        .filter((u) => typeof u?.name === 'string')
        .sort((a, b) => Number(Boolean(b.isLord)) - Number(Boolean(a.isLord)))
        .map((u) => u.name);
      rally = composeFinaleRally({
        units: scene.playerUnits,
        pool: scene.gameData?.dialogue?.finaleRally,
        voice: scene.gameData?.dialogue?.unitVoice || null,
        commander: ctx.commander,
        seed: Number(rm?.runSeed) >>> 0,
        memory: ctx.bossSlainCount + ctx.bossKilledYouCount > 0,
        fallen,
        hurt: !entity || maxHP <= 0 || entity.currentHP < maxHP,
      });
    } catch (_) {
      rally = [];
    }
    const step = Math.max(1000, 2 * (Number(barMs) || 1765));
    rally.forEach(({ unit, line }, i) => {
      const timer = setTimeout(
        () => {
          this._rallyTimers = this._rallyTimers.filter((t) => t !== timer);
          // a unit that falls before its line leaves it unsaid
          if (!(unit.currentHP > 0)) return;
          this._showRallyText(unit, line);
        },
        Math.max(0, Number(leadMs) || 0) + i * step,
      );
      this._rallyTimers.push(timer);
    });
    return rally;
  }

  _showRallyText(unit, line) {
    const scene = this.scene;
    try {
      const pos = scene.grid?.gridToPixel?.(unit.col, unit.row);
      if (!pos) return;
      const screen = scene._worldToScreen?.(pos.x, pos.y) || pos;
      const cam = scene.cameras?.main;
      const width = cam?.width || 640;
      const height = cam?.height || 480;
      const text = presentationText(scene, screen.x, screen.y + QUIP_OFFSET_Y, line, {
        fontFamily: 'monospace',
        fontSize: '14px',
        align: 'center',
        wordWrap: { width: Math.max(96, Math.min(250, width - 24)) },
        color: '#fff4d6',
        fontStyle: 'bold',
        backgroundColor: '#140f08e6',
        padding: { x: 8, y: 5 },
      })
        .setOrigin(0.5)
        .setDepth(QUIP_DEPTH + 1)
        .setAlpha(0);
      // the speaker, on a gold tab over the line
      const name = presentationText(scene, 0, 0, unit.name, {
        fontFamily: "'Press Start 2P', monospace",
        fontSize: '8px',
        color: '#1a1206',
        backgroundColor: '#e8b64c',
        padding: { x: 5, y: 3 },
      })
        .setOrigin(0.5, 1)
        .setDepth(QUIP_DEPTH + 2)
        .setAlpha(0);
      const halfW = (text.width || 0) / 2;
      const halfH = (text.height || 0) / 2;
      const tab = name.height || 14;
      text.x = Math.max(8 + halfW, Math.min(width - 8 - halfW, screen.x));
      text.y = Math.max(8 + tab + halfH, Math.min(height - 8 - halfH, screen.y + QUIP_OFFSET_Y));
      name.x = text.x;
      name.y = text.y - halfH;
      for (const obj of [text, name]) {
        scene._pinToScreen?.(obj);
        this._live.add(obj);
      }
      scene.tweens.add({ targets: [text, name], alpha: 1, duration: 150 });
      scene.tweens.add({
        targets: [text, name],
        alpha: 0,
        delay: RALLY_HOLD_MS,
        duration: RALLY_FADE_MS,
        onComplete: () => {
          for (const obj of [text, name]) {
            this._live.delete(obj);
            if (obj?.scene) obj.destroy();
          }
        },
      });
    } catch (_) {
      /* a line of dialogue must never break combat */
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
    const now = scene.time?.now ?? 0;
    if (!guaranteed) {
      if (now - this._lastQuipAt < QUIP_COOLDOWN_MS) return;
      if (this._random() >= chance) return;
    }
    const pool = scene.gameData?.dialogue?.lordQuips?.[poolKey]?.[lord.name];
    if (!Array.isArray(pool) || pool.length === 0) return;
    const line =
      scene.runManager?.pickNarrativeLine?.(pool, `quip:${poolKey}:${lord.name}`) ||
      pool[Math.floor(this._random() * pool.length)];
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
      const screen = scene._worldToScreen?.(pos.x, pos.y) || pos;
      const cam = scene.cameras?.main;
      const width = cam?.width || 640;
      const height = cam?.height || 480;
      const travel = scene._reduceMotion?.() ? 0 : 20;
      const quip = presentationText(scene, screen.x, screen.y + QUIP_OFFSET_Y, line, {
        fontFamily: 'monospace',
        fontSize: '13px',
        wordWrap: { width: Math.max(80, Math.min(280, width - 24)) },
        color: '#ffe9a8',
        fontStyle: 'italic',
        backgroundColor: '#000000cc',
        padding: { x: 5, y: 2 },
      })
        .setOrigin(0.5)
        .setDepth(QUIP_DEPTH)
        .setAlpha(0);
      // Clamp the entire bubble and its upward animation, not just its anchor.
      const halfW = (quip.width || 0) / 2;
      const halfH = (quip.height || 0) / 2;
      quip.x = Math.max(8 + halfW, Math.min(width - 8 - halfW, screen.x));
      quip.y = Math.max(8 + halfH + travel, Math.min(height - 8 - halfH, screen.y + QUIP_OFFSET_Y));
      scene._pinToScreen?.(quip);
      this._live.add(quip);
      scene.tweens.add({
        targets: quip,
        alpha: 1,
        duration: 120,
      });
      scene.tweens.add({
        targets: quip,
        y: quip.y - travel,
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
