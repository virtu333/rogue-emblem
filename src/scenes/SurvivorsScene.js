// SurvivorsScene — Darkest Before Dawn, the survivors mode (docs/specs/survivors-mode.md).
//
// One lord on a free field at night; the game's own foes come in waves; weapons strike on
// their own while the player only moves; dawn breaks at ten minutes. The rules are the pure
// engine/survivors modules on a fixed step and a seeded stream; this scene feeds them the
// stick and draws the world with the battle's own art: traced unit sprites, the combat
// effects atlas, the procedural terrain painter, the combat number look, the music and SFX.
// Nothing here touches a run, a run save or the meta save: the device keeps each lord's best
// night (survivorsModel.recordNight).
import Phaser from 'phaser';
import { battleCanvasSize } from '../ui/BattlefieldLab.js';
import { SurvivorsMenus } from '../ui/survivors/SurvivorsMenus.js';
import { bestFor, clockText, recordNight, resultView } from '../ui/survivors/survivorsModel.js';
import {
  STEP,
  activeBosses,
  chooseOffer,
  createSurvivorsWorld,
  drainEvents,
  startingWeaponId,
  setView,
  stepWorld,
  timeLeft,
} from '../engine/survivors/SurvivorsSim.js';
import { lordProfile } from '../engine/survivors/SurvivorsUnits.js';
import { botChoice, botInput } from '../engine/survivors/SurvivorsBot.js';
import { classKey, idleFrameAt, IDLE_FRAMES, TRACED_PREFIX } from '../ui/TracedSprites.js';
import FX_TABLE from '../art/combatFx/fxAnims.json';
import { paintTerrainCanvasAsync } from '../art/terrain/canvas.js';
import { combatNumberStyle } from '../ui/combatNumberStyle.js';
import { choiceReducedMotion } from '../ui/choiceCards.js';
import { getBossEnrageLayer, getBossMusicKey } from '../utils/musicConfig.js';
import { haptic } from '../utils/haptics.js';
import { InputAction } from '../utils/InputActions.js';
import { popInputScope, pushInputScope } from '../utils/inputFocus.js';
import { transitionToScene, TRANSITION_REASONS } from '../utils/SceneRouter.js';

const VIEW_SHORT_SIDE = 400;
const HUD_ROOM = 72; // world px the screen's short side shows
const UNIT_SIZE = 50;
const BOSS_SIZE = 78;
const NUMBER_CAP = 36;
const FX_CAP = 48;
const FX_KEYS = ['fx_slash', 'fx_thrust', 'fx_ring', 'fx_magic', 'fx_crit'];
const SFX_GAP_MS = 90;

// The night's colour, multiplied over the field: dusk, deepest just before dawn, then dawn.
const NIGHT_STOPS = [
  { t: 0, color: [96, 108, 150] },
  { t: 0.88, color: [42, 50, 86] },
  { t: 0.94, color: [150, 110, 120] },
  { t: 1, color: [255, 236, 214] },
];

/** The night's multiply colour at `share` of the night (0..1). Pure. */
export function nightColor(share) {
  const s = Math.max(0, Math.min(1, share));
  let a = NIGHT_STOPS[0];
  let b = NIGHT_STOPS[NIGHT_STOPS.length - 1];
  for (let i = 0; i < NIGHT_STOPS.length - 1; i++)
    if (s >= NIGHT_STOPS[i].t && s <= NIGHT_STOPS[i + 1].t) {
      a = NIGHT_STOPS[i];
      b = NIGHT_STOPS[i + 1];
      break;
    }
  const k = b.t > a.t ? (s - a.t) / (b.t - a.t) : 1;
  const mix = a.color.map((v, i) => Math.round(v + (b.color[i] - v) * k));
  return (mix[0] << 16) | (mix[1] << 8) | mix[2];
}

/** A seed for a fresh night: the clock, never Math.random (the battle's stream). */
function freshSeed() {
  const t = Date.now() ^ Math.floor((globalThis.performance?.now?.() || 0) * 1000);
  return t >>> 0;
}

export class SurvivorsScene extends Phaser.Scene {
  constructor() {
    super('Survivors');
  }

  init(data) {
    this.gameData = data?.gameData || this.registry.get('gameData') || {};
    this.devRoute = Boolean(data?.devRoute);
    this.fixedSeed = Number.isFinite(data?.seed) ? data.seed : null;
    this.requestedLord = data?.lordName || null;
    // review routes only: the night plays itself (the balance sim's bot), for looking and timing
    this.autoplay = this.devRoute && Boolean(data?.autoplay);
    this.world = null;
    this.mode = 'idle';
    this.stick = { x: 0, y: 0 };
    this.acc = 0;
  }

  async create() {
    this.events.once('shutdown', () => this._shutdown());
    this.cameras.main.setBackgroundColor('#08070c');
    const wrapper = document.getElementById('game-wrapper') || document.body;
    this.config = this.registry.get('survivorsConfig') || null;
    this.menus = new SurvivorsMenus(wrapper, {
      config: this.config || { durationSec: 600, weapons: {}, passives: {} },
      onStick: (x, y) => {
        this.stick = { x, y };
      },
      onPause: () => this.pause(),
    });
    this._fitCanvas();
    const container = document.getElementById('game-container');
    if (container && typeof ResizeObserver === 'function') {
      this._resizeObserver = new ResizeObserver(() => this._fitCanvas());
      this._resizeObserver.observe(container);
    }
    this._bindInput();
    this._makeTextures();
    if (!this.config) {
      this.menus.showLoading('Loading…');
      try {
        const response = await fetch('data/survivors.json');
        if (!response.ok) throw new Error(`survivors.json: ${response.status}`);
        this.config = await response.json();
        this.registry.set('survivorsConfig', this.config);
      } catch (error) {
        console.error('[Survivors] could not load its data', error);
        this.menus.showLoading('Could not load the night. Check the connection and try again.');
        return;
      }
      if (!this.sys?.isActive?.()) return;
      this.menus.config = this.config;
    }
    if (this.requestedLord && this._lordAvailable(this.requestedLord))
      void this.beginNight(this.requestedLord);
    else this.showLordPicker();
  }

  // --- lords --------------------------------------------------------------------------------

  _lordAvailable(name) {
    if (this.devRoute) return true;
    const meta = this.registry.get('meta');
    return typeof meta?.hasMetLord === 'function'
      ? meta.hasMetLord(name) === true
      : name === 'Edric';
  }

  showLordPicker() {
    this.mode = 'picking';
    this.menus.showHud(false);
    const lords = (this.gameData.lords || []).map((lord) => {
      const profile = lordProfile(this.gameData, lord.name);
      const weaponId = startingWeaponId(this.config, profile);
      const best = bestFor(lord.name);
      return {
        name: lord.name,
        className: lord.class,
        weaponName: this.config.weapons[weaponId]?.name || '',
        available: this._lordAvailable(lord.name),
        best:
          best == null
            ? 'No nights yet'
            : best >= this.config.durationSec
              ? 'Best: dawn'
              : `Best: ${clockText(best)}`,
      };
    });
    const selected = this.lastLord || lords.find((l) => l.available)?.name || 'Edric';
    this.menus.showLordPicker({
      title: this.config.title,
      lords,
      selected,
      onBegin: (name) => void this.beginNight(name),
      onBack: () => this.leave(),
    });
  }

  // --- the night ----------------------------------------------------------------------------

  async beginNight(lordName) {
    if (this.mode === 'loading') return;
    this.mode = 'loading';
    this.lastLord = lordName;
    this.menus.showLoading('The night falls…');
    this._clearNight();
    const seed = this.fixedSeed ?? freshSeed();
    const cam = this.cameras.main;
    this.world = createSurvivorsWorld({
      config: this.config,
      gameData: this.gameData,
      lordName,
      seed,
      view: { width: cam.width / cam.zoom, height: cam.height / cam.zoom },
    });
    const generation = (this._night = (this._night || 0) + 1);
    await this._paintField(seed);
    if (generation !== this._night || !this.sys?.isActive?.()) return;
    this._buildNight();
    this.menus.closePanel();
    this.menus.showHud(true);
    this.menus.setStickEnabled(true);
    this.mode = 'playing';
    this.acc = 0;
    this._music(this.config.music.battle);
    this.audio?.setMusicIntensity?.('calm', 0);
  }

  async _paintField(seed) {
    const field = this.world.field;
    const key = `dbd-field-${this._night}`;
    try {
      const { canvas } = await paintTerrainCanvasAsync(
        { names: field.names, biome: field.biome, seed, cellPx: 24 },
        { signal: (this._paintAbort = new AbortController()).signal },
      );
      if (this.textures.exists(key)) this.textures.remove(key);
      this.textures.addCanvas(key, canvas);
      this.fieldKey = key;
    } catch (error) {
      if (error?.name !== 'AbortError')
        console.warn('[Survivors] terrain paint failed; flat field', error);
      this.fieldKey = null;
    }
  }

  _buildNight() {
    const field = this.world.field;
    this.groundLayer = this.add.layer().setDepth(0);
    this.pickupLayer = this.add.layer().setDepth(1);
    this.unitLayer = this.add.layer().setDepth(2);
    this.fxLayer = this.add.layer().setDepth(3);
    this.nightLayer = this.add.layer().setDepth(4);
    this.numberLayer = this.add.layer().setDepth(5);
    if (this.fieldKey) {
      this.groundLayer.add(
        this.add
          .image(0, 0, this.fieldKey)
          .setOrigin(0, 0)
          .setDisplaySize(field.width, field.height),
      );
    } else {
      const g = this.add.graphics();
      const colors = { Plain: 0x4f6b3a, Forest: 0x2d4a2a, Water: 0x2c4c77, Mountain: 0x6e6a5b };
      for (let r = 0; r < field.rows; r++)
        for (let c = 0; c < field.cols; c++) {
          g.fillStyle(colors[field.names[r][c]] ?? colors.Plain, 1);
          g.fillRect(c * 32, r * 32, 32, 32);
        }
      this.groundLayer.add(g);
    }
    const pl = this.world.player;
    this.playerSprite = this.add
      .image(pl.x, pl.y, this._lordTexture(pl.name), IDLE_FRAMES[0])
      .setDisplaySize(UNIT_SIZE + 4, UNIT_SIZE + 4)
      .setOrigin(0.5, 0.78);
    this.unitLayer.add(this.playerSprite);
    this.hpBar = this.add.graphics().setDepth(1e6);
    this.unitLayer.add(this.hpBar);
    this.lantern = this.add
      .image(pl.x, pl.y, 'dbd-glow')
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(0xdca044)
      .setAlpha(0.32)
      .setScale(5);
    this.night = this.add
      .rectangle(0, 0, 8, 8, 0xffffff)
      .setOrigin(0.5)
      .setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.nightLayer.add([this.night, this.lantern]);
    this.enemySprites = new Map();
    this.spritePool = [];
    this.dying = [];
    this.projSprites = new Map();
    this.projPool = [];
    this.pickupSprites = new Map();
    this.pickupPool = [];
    this.fxPool = [];
    this.fxLive = 0;
    this.numbers = [];
    this.numberPools = new Map();
    this.sfxAt = new Map();
    this.bossEnraged = new Set();
    const cam = this.cameras.main;
    // room above the field so the lord is never under the HUD at the top edge
    cam.setBounds(0, -HUD_ROOM, field.width, field.height + HUD_ROOM);
    cam.startFollow(this.playerSprite, true, 0.18, 0.18);
    cam.centerOn(pl.x, pl.y);
  }

  _clearNight() {
    this._paintAbort?.abort?.();
    this.cameras.main.stopFollow();
    for (const layer of [
      this.groundLayer,
      this.pickupLayer,
      this.unitLayer,
      this.fxLayer,
      this.nightLayer,
      this.numberLayer,
    ])
      layer?.destroy?.();
    this.groundLayer = this.pickupLayer = this.unitLayer = this.fxLayer = null;
    this.nightLayer = this.numberLayer = null;
    this.playerSprite = null;
    if (this.fieldKey && this.textures.exists(this.fieldKey)) this.textures.remove(this.fieldKey);
    this.fieldKey = null;
    this.world = null;
  }

  // --- input -------------------------------------------------------------------------------

  _bindInput() {
    this.keys = this.input.keyboard?.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT', false) || null;
    this._onKeyDown = (event) => this._keyDown(event);
    globalThis.addEventListener?.('keydown', this._onKeyDown);
    this._onVisibility = () => {
      if (document.hidden && this.mode === 'playing') this.pause();
    };
    document.addEventListener('visibilitychange', this._onVisibility);
    pushInputScope(this, (action, payload) => {
      const panel = this.menus?.panelKind;
      if (action === InputAction.PAUSE || action === InputAction.CANCEL) {
        if (this.mode === 'playing') this.pause();
        else if (this.mode === 'paused') this.resume();
        return;
      }
      if (!panel) return;
      if (action === InputAction.NAVIGATE) this.menus.moveFocus(payload?.dy || payload?.dx || 1);
      if (action === InputAction.CONFIRM) this.menus.confirmFocus();
    });
  }

  _keyDown(event) {
    const panel = this.menus?.panelKind;
    if (event.key === 'Escape' || event.key === 'p' || event.key === 'P') {
      if (this.mode === 'playing') this.pause();
      else if (this.mode === 'paused') this.resume();
      return;
    }
    if (!panel) return;
    if (panel === 'offer' && /^[1-4]$/.test(event.key)) {
      this._choose(Number(event.key) - 1);
      return;
    }
    if (['ArrowUp', 'ArrowLeft'].includes(event.key)) this.menus.moveFocus(-1);
    if (['ArrowDown', 'ArrowRight'].includes(event.key)) this.menus.moveFocus(1);
  }

  _readStick() {
    let x = this.stick.x;
    let y = this.stick.y;
    const k = this.keys;
    if (k) {
      const kx = (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0);
      const ky = (k.S.isDown || k.DOWN.isDown ? 1 : 0) - (k.W.isDown || k.UP.isDown ? 1 : 0);
      if (kx || ky) {
        x = kx;
        y = ky;
      }
    }
    // the pad's left stick, read straight from the browser (the input bus is discrete)
    const pads = globalThis.navigator?.getGamepads?.() || [];
    for (const pad of pads) {
      if (!pad?.axes || pad.axes.length < 2) continue;
      const ax = pad.axes[0];
      const ay = pad.axes[1];
      if (Math.hypot(ax, ay) > 0.2) {
        x = ax;
        y = ay;
        break;
      }
    }
    return { x, y };
  }

  // --- pause, choices, the end ----------------------------------------------------------------

  pause() {
    if (this.mode !== 'playing') return;
    this.mode = 'paused';
    this.stick = { x: 0, y: 0 };
    this.menus.showPause({
      onResume: () => this.resume(),
      onGiveUp: () => this._endNight(true),
      onHome: () => this.leave(),
    });
  }

  resume() {
    if (this.mode !== 'paused') return;
    this.menus.closePanel();
    this.menus.setStickEnabled(true);
    this.mode = 'playing';
    this.acc = 0;
  }

  _openOffer() {
    this.mode = 'choosing';
    this.stick = { x: 0, y: 0 };
    this.menus.showOffer({ offer: this.world.offer, onChoose: (i) => this._choose(i) });
  }

  _choose(index) {
    if (this.mode !== 'choosing' || !this.world) return;
    if (!chooseOffer(this.world, index)) return;
    this._sfx('sfx_confirm', 0.6, 0);
    this._handleEvents(drainEvents(this.world));
    if (this.world.status === 'choosing') this._openOffer();
    else {
      this.menus.closePanel();
      this.menus.setStickEnabled(true);
      this.mode = 'playing';
      this.acc = 0;
    }
  }

  _endNight(gaveUp = false) {
    if (!this.world || this.mode === 'over') return;
    const world = this.world;
    if (gaveUp && world.status !== 'won') world.status = 'lost';
    this.mode = 'over';
    this.menus.setStickEnabled(false);
    const best = recordNight(
      world.player.name,
      world.status === 'won' ? world.config.durationSec : world.t,
    );
    this._music(world.status === 'won' ? this.config.music.win : this.config.music.lose);
    if (world.status === 'won') haptic('success');
    this.menus.showResult({
      view: resultView(world, { best }),
      onAgain: () => void this.beginNight(world.player.name),
      onLords: () => this.showLordPicker(),
      onHome: () => this.leave(),
    });
  }

  async leave() {
    if (this._leaving) return;
    this._leaving = true;
    this.mode = 'leaving';
    this.audio?.stopMusic?.(this, 300);
    const ok = await transitionToScene(
      this,
      'HomeBase',
      { gameData: this.gameData },
      { reason: TRANSITION_REASONS.RETURN_HOME, retryBlocked: true },
    );
    if (!ok) this._leaving = false;
  }

  // --- the loop -----------------------------------------------------------------------------

  update(_time, delta) {
    if (!this.world || !this.playerSprite) return;
    if (this.mode === 'playing') {
      this.acc += Math.min(delta, 100) / 1000;
      let steps = 0;
      const input = this.autoplay ? botInput(this.world) : this._readStick();
      while (this.acc >= STEP && steps < 6 && this.world.status === 'playing') {
        stepWorld(this.world, input);
        this.acc -= STEP;
        steps++;
      }
      this._handleEvents(drainEvents(this.world));
      if (this.world.status === 'choosing') {
        this._openOffer();
        if (this.autoplay) this._choose(botChoice(this.world));
      } else if (this.world.status === 'won' || this.world.status === 'lost') this._endNight();
    }
    this._render(delta);
  }

  get audio() {
    return this.registry.get('audio');
  }

  _music(key, options) {
    if (key) void this.audio?.playMusic?.(key, this, 600, options);
  }

  _sfx(key, volume = 0.5, gap = SFX_GAP_MS) {
    const now = this.time.now;
    if (gap && now - (this.sfxAt.get(key) || -1e9) < gap) return;
    this.sfxAt.set(key, now);
    this.audio?.playSFX?.(key, volume);
  }

  // --- events -------------------------------------------------------------------------------

  _handleEvents(events) {
    for (const event of events) {
      switch (event.type) {
        case 'fire':
          this._sfx(this.config.weapons[event.weapon]?.sfx, 0.3, 120);
          break;
        case 'swing':
          this._fx(
            'fx_slash',
            event.x + Math.cos(event.angle) * event.reach * 0.5,
            event.y + Math.sin(event.angle) * event.reach * 0.5,
            {
              rotation: event.angle,
              scale: event.reach / 30,
            },
          );
          break;
        case 'thrust':
          this._fx(
            'fx_thrust',
            event.x + Math.cos(event.angle) * event.length * 0.5,
            event.y + Math.sin(event.angle) * event.length * 0.5,
            {
              rotation: event.angle,
              scaleX: event.length / 44,
              scaleY: 1.1,
            },
          );
          break;
        case 'aura':
          this._fx('fx_ring', event.x, event.y, { scale: event.radius / 21 });
          break;
        case 'burst':
          this._fx('fx_magic', event.x, event.y, { scale: event.radius / 20 });
          this._sfx('sfx_fire', 0.25, 140);
          break;
        case 'hit': {
          const sprite = this.enemySprites.get(event.id);
          if (sprite) sprite.flashUntil = this.time.now + 70;
          if (event.crit) {
            this._fx('fx_crit', event.x, event.y - 14, { scale: 0.8 });
            this._number(event.crit ? 'crit' : 'strike', event.amount, event.x, event.y - 30, true);
            this._sfx('sfx_crit', 0.35, 150);
          } else this._number('strike', event.amount, event.x, event.y - 28, false);
          break;
        }
        case 'kill': {
          const sprite = this.enemySprites.get(event.id);
          if (sprite) {
            this.enemySprites.delete(event.id);
            sprite.dieAt = this.time.now;
            this.dying.push(sprite);
          }
          if (event.kind === 'boss') this._sfx('sfx_death', 0.7, 0);
          break;
        }
        case 'playerHit':
          this._number('thorns', event.amount, event.x, event.y - 34, true, `-${event.amount}`);
          this._sfx('sfx_hit', 0.5, 100);
          haptic('light');
          break;
        case 'dodge':
          this._number('miss', 0, event.x, event.y - 34, true);
          this._sfx('sfx_miss', 0.4, 150);
          break;
        case 'miracle':
          this._number('heal', 0, event.x, event.y - 40, true, 'Miracle');
          this._sfx('sfx_light', 0.6, 0);
          break;
        case 'heal':
          if (event.amount >= 2 && this.world)
            this._number('heal', event.amount, this.world.player.x, this.world.player.y - 40, true);
          break;
        case 'pickup':
          if (event.kind === 'xp') this._sfx('sfx_cursor', 0.12, 70);
          else this._sfx(event.kind === 'chest' ? 'sfx_loot' : 'sfx_heal', 0.6, 0);
          break;
        case 'levelup':
          this._sfx('sfx_levelup', 0.7, 0);
          haptic('success');
          break;
        case 'chest':
          this._sfx('sfx_loot', 0.7, 0);
          break;
        case 'elite':
          this.menus.flashBanner(`A ${event.className} of the dark draws near`, 1800);
          break;
        case 'enemyShot':
          this._sfx(event.magic ? 'sfx_dark' : 'sfx_bow', 0.15, 160);
          break;
        case 'boss': {
          this.menus.flashBanner(`${event.name} rides in`, 2600);
          haptic('heavy');
          const theme = getBossMusicKey(event.name, 'act1');
          const enrage = getBossEnrageLayer(theme, event.name);
          void this.audio?.playStinger?.(`boss_${classKey(event.name)}`, {
            fallbackSfx: 'sfx_thunder',
          });
          this._music(theme, enrage ? { layers: { enrage } } : undefined);
          this.audio?.setMusicIntensity?.('full', 0);
          break;
        }
        case 'bossWindup': {
          const sprite = this.enemySprites.get(event.id);
          if (sprite) sprite.windupUntil = this.time.now + 600;
          break;
        }
        case 'bossDown':
          this.menus.flashBanner(`${event.name} falls`, 2200);
          void this.audio?.playStinger?.('boss_felled', { fallbackSfx: 'sfx_shatter' });
          if (!activeBosses(this.world).length) {
            this._music(this.config.music.battle);
            this.audio?.setMusicIntensity?.('full', 0);
          }
          break;
        case 'lost':
          this._sfx('sfx_death', 0.8, 0);
          break;
        default:
          break;
      }
    }
  }

  // --- drawing ------------------------------------------------------------------------------

  _lordTexture(name) {
    const key = `${TRACED_PREFIX}lord_${classKey(name)}`;
    return this.textures.exists(key) ? key : '__WHITE';
  }

  _enemyTexture(e) {
    const keys =
      e.kind === 'boss' && e.name
        ? [`boss_${classKey(e.name)}`, `enemy_${classKey(e.className)}`]
        : e.kind === 'elite'
          ? [`enemy_${classKey(e.className)}-corrupt`, `enemy_${classKey(e.className)}`]
          : [`enemy_${classKey(e.className)}`];
    for (const k of keys) if (this.textures.exists(TRACED_PREFIX + k)) return TRACED_PREFIX + k;
    return '__WHITE';
  }

  _makeTextures() {
    const make = (key, w, h, draw) => {
      if (this.textures.exists(key)) return;
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      draw(g);
      g.generateTexture(key, w, h);
      g.destroy();
    };
    const gem = (color, edge) => (g) => {
      g.fillStyle(edge, 1);
      g.fillPoints(
        [
          { x: 5, y: 0 },
          { x: 10, y: 6 },
          { x: 5, y: 12 },
          { x: 0, y: 6 },
        ],
        true,
      );
      g.fillStyle(color, 1);
      g.fillPoints(
        [
          { x: 5, y: 2 },
          { x: 8, y: 6 },
          { x: 5, y: 10 },
          { x: 2, y: 6 },
        ],
        true,
      );
    };
    make('dbd-gem-0', 10, 12, gem(0x77a5c6, 0x1c2f4f));
    make('dbd-gem-1', 10, 12, gem(0x86b27b, 0x1b4239));
    make('dbd-gem-2', 10, 12, gem(0xf3cb6c, 0x80461f));
    make('dbd-chest', 18, 14, (g) => {
      g.fillStyle(0x34301d, 1).fillRect(0, 2, 18, 12);
      g.fillStyle(0x80461f, 1).fillRect(1, 3, 16, 10);
      g.fillStyle(0xdca044, 1).fillRect(0, 6, 18, 2).fillRect(8, 5, 2, 5);
    });
    make('dbd-vulnerary', 10, 14, (g) => {
      g.fillStyle(0x16131e, 1).fillRect(3, 0, 4, 4).fillRect(1, 4, 8, 10);
      g.fillStyle(0x86b27b, 1).fillRect(2, 6, 6, 7);
      g.fillStyle(0xb8ae78, 1).fillRect(4, 1, 2, 3);
    });
    if (!this.textures.exists('dbd-glow')) {
      const size = 64;
      const canvas = this.textures.createCanvas('dbd-glow', size, size);
      const ctx = canvas?.getContext?.();
      if (ctx) {
        const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
        canvas.refresh();
      }
    }
    for (const key of FX_KEYS) {
      const anim = FX_TABLE.anims[key];
      if (!anim || this.anims.exists(`dbd-${key}`) || !this.textures.exists('fx_atlas')) continue;
      this.anims.create({
        key: `dbd-${key}`,
        frames: anim.durations.map((duration, i) => ({
          key: 'fx_atlas',
          frame: `${key}/${i}`,
          duration,
        })),
        repeat: 0,
      });
    }
  }

  _fx(key, x, y, { rotation = 0, scale = 1, scaleX = null, scaleY = null } = {}) {
    if (!this.fxLayer || this.fxLive >= FX_CAP || !this.anims.exists(`dbd-${key}`)) return;
    if (this._reduced()) return;
    let sprite = this.fxPool.pop();
    if (!sprite) {
      sprite = this.add.sprite(0, 0, 'fx_atlas').setBlendMode(Phaser.BlendModes.ADD);
      sprite.on('animationcomplete', () => {
        sprite.setVisible(false);
        this.fxLive--;
        this.fxPool.push(sprite);
      });
      this.fxLayer.add(sprite);
    }
    this.fxLive++;
    const anchor = FX_TABLE.anims[key]?.anchor || [0.5, 0.5];
    sprite
      .setVisible(true)
      .setOrigin(anchor[0], anchor[1])
      .setPosition(x, y)
      .setRotation(rotation)
      .setScale(scaleX ?? scale, scaleY ?? scale);
    sprite.play(`dbd-${key}`);
  }

  _reduced() {
    if (this._reducedAt === undefined || this.time.now - this._reducedAt > 2000) {
      this._reducedAt = this.time.now;
      this._reducedValue = choiceReducedMotion(this);
    }
    return this._reducedValue;
  }

  _number(kind, value, x, y, important, text = null) {
    if (!this.numberLayer) return;
    if (!important && this.numbers.length >= NUMBER_CAP * 0.6) return;
    if (this.numbers.length >= NUMBER_CAP) return;
    const look = combatNumberStyle(kind, value, { reducedMotion: this._reduced() });
    let pool = this.numberPools.get(look.kind);
    if (!pool) this.numberPools.set(look.kind, (pool = []));
    let label = pool.pop();
    if (!label) {
      label = this.add.text(0, 0, '', look.style).setOrigin(0.5, 1);
      this.numberLayer.add(label);
    }
    label
      .setText(text ?? look.text)
      .setPosition(x, y)
      .setAlpha(1)
      .setVisible(true)
      .setScale(1);
    this.numbers.push({ label, kind: look.kind, born: this.time.now, x, y, motion: look.motion });
  }

  _render(delta) {
    const world = this.world;
    const now = this.time.now;
    const pl = world.player;
    const reduced = this._reduced();
    // the lord
    const walking = pl.moving && this.mode === 'playing';
    const hop = walking && !reduced ? -Math.abs(Math.sin(now / 95)) * 2 : 0;
    this.playerSprite.setPosition(pl.x, pl.y + 6 + hop);
    this.playerSprite.setFrame(
      walking ? IDLE_FRAMES[Math.floor(now / 110) % IDLE_FRAMES.length] : idleFrameAt(now),
    );
    if (pl.facing.x) this.playerSprite.setFlipX(pl.facing.x < -0.1);
    this.playerSprite.setDepth(pl.y);
    this.playerSprite.setAlpha(pl.invuln > 0 && Math.floor(now / 60) % 2 ? 0.55 : 1);
    this.hpBar.clear();
    const w = 30;
    this.hpBar.fillStyle(0x08070c, 0.85).fillRect(pl.x - w / 2 - 1, pl.y + 12, w + 2, 5);
    const hpShare = pl.hp / pl.maxHp;
    this.hpBar.fillStyle(hpShare > 0.5 ? 0x86b27b : hpShare > 0.25 ? 0xe8a44a : 0xec7a5c, 1);
    this.hpBar.fillRect(pl.x - w / 2, pl.y + 13, w * hpShare, 3);
    this.hpBar.setDepth(pl.y + 1);
    // foes
    const seen = (this._seen = (this._seen || 0) + 1);
    for (const e of world.enemies) {
      let s = this.enemySprites.get(e.id);
      if (!s) {
        s = this.spritePool.pop() || this._newUnitSprite();
        const size =
          e.kind === 'boss'
            ? BOSS_SIZE
            : UNIT_SIZE * (e.kind === 'elite' ? world.config.elites.sizeScale : 1);
        s.setTexture(this._enemyTexture(e), IDLE_FRAMES[0])
          .setDisplaySize(size, size)
          .setVisible(true)
          .setAlpha(1);
        s.phase = e.id % 4;
        s.flashUntil = 0;
        s.windupUntil = 0;
        s.dieAt = 0;
        this.enemySprites.set(e.id, s);
      }
      s.seen = seen;
      s.setPosition(e.x, e.y + 6 + (reduced ? 0 : -Math.abs(Math.sin(now / 110 + s.phase)) * 1.5));
      s.setDepth(e.y);
      s.setFlipX(e.facing > 0);
      const frame = reduced ? IDLE_FRAMES[0] : idleFrameAt(now, s.phase);
      if (s.frame?.name !== frame) s.setFrame(frame, false, false);
      if (now < s.flashUntil) s.setTintFill(0xffffff);
      else if (now < s.windupUntil) s.setTint(Math.floor(now / 80) % 2 ? 0xff6a48 : 0xffffff);
      else s.setTint(0xffffff);
      if (e.kind === 'boss' && e.hp <= e.maxHp / 2 && !this.bossEnraged.has(e.id)) {
        this.bossEnraged.add(e.id);
        this.audio?.setMusicIntensity?.('enrage', 800);
      }
    }
    for (const [id, s] of this.enemySprites) {
      if (s.seen === seen) continue;
      this.enemySprites.delete(id);
      this._releaseUnitSprite(s);
    }
    this.dying = this.dying.filter((s) => {
      const k = (now - s.dieAt) / 260;
      if (k >= 1) {
        this._releaseUnitSprite(s);
        return false;
      }
      s.setTintFill(0xec7a5c).setAlpha(1 - k);
      s.y -= delta * 0.03;
      return true;
    });
    // shots
    const seenShot = seen;
    for (const p of world.projectiles) {
      let s = this.projSprites.get(p.id);
      if (!s) {
        s =
          this.projPool.pop() ||
          this._layerImage(this.fxLayer, 'fx_atlas', 'fx_proj_arrow/0', true);
        s.setVisible(true).setTint(0xffffff).setScale(1.6);
        this.projSprites.set(p.id, s);
      }
      s.seen = seenShot;
      s.setPosition(p.x, p.y);
      const spin = Math.floor(now / 70) % 4;
      if (p.kind === 'axe') s.setFrame(`fx_proj_axe/${spin}`).setRotation(now / 60);
      else if (p.kind === 'fire')
        s.setFrame(`fx_proj_fire/${spin}`).setRotation(Math.atan2(p.vy, p.vx));
      else if (p.kind === 'enemyFire')
        s.setFrame(`fx_proj_dark/${spin}`).setRotation(Math.atan2(p.vy, p.vx));
      else {
        s.setFrame('fx_proj_arrow/0').setRotation(Math.atan2(p.vy, p.vx));
        if (p.kind === 'enemyArrow') s.setTint(0xff6a48);
      }
    }
    for (const [id, s] of this.projSprites) {
      if (s.seen === seenShot) continue;
      this.projSprites.delete(id);
      s.setVisible(false);
      this.projPool.push(s);
    }
    // pickups
    for (const p of world.pickups) {
      let s = this.pickupSprites.get(p.id);
      if (!s) {
        s = this.pickupPool.pop() || this._layerImage(this.pickupLayer, 'dbd-gem-0');
        const key =
          p.kind === 'chest'
            ? 'dbd-chest'
            : p.kind === 'vulnerary'
              ? 'dbd-vulnerary'
              : p.value >= 20
                ? 'dbd-gem-2'
                : p.value >= 4
                  ? 'dbd-gem-1'
                  : 'dbd-gem-0';
        s.setTexture(key).setVisible(true);
        this.pickupSprites.set(p.id, s);
      }
      s.seen = seen;
      s.setPosition(p.x, p.y + (reduced ? 0 : Math.sin(now / 200 + p.id) * 1.5));
    }
    for (const [id, s] of this.pickupSprites) {
      if (s.seen === seen) continue;
      this.pickupSprites.delete(id);
      s.setVisible(false);
      this.pickupPool.push(s);
    }
    // numbers
    this.numbers = this.numbers.filter((n) => {
      const age = now - n.born;
      const m = n.motion;
      const total = m.delay + m.duration;
      if (age >= total) {
        n.label.setVisible(false);
        this.numberPools.get(n.kind).push(n.label);
        return false;
      }
      const k = Math.max(0, (age - m.delay) / m.duration);
      n.label.setPosition(n.x, n.y - m.rise * k).setAlpha(1 - k * k);
      if (m.pop && age < m.pop.duration)
        n.label.setScale(m.pop.from + (1 - m.pop.from) * (age / m.pop.duration));
      else n.label.setScale(1);
      return true;
    });
    // the night
    const cam = this.cameras.main;
    const share = world.t / world.config.durationSec;
    this.night
      .setPosition(cam.midPoint.x, cam.midPoint.y)
      .setSize(cam.width / cam.zoom + 64, cam.height / cam.zoom + 64)
      .setFillStyle(nightColor(share));
    this.night.setOrigin(0.5);
    this.lantern.setPosition(pl.x, pl.y).setAlpha(0.3 * (1 - Math.max(0, share - 0.9) * 10));
    // HUD
    if (this.mode === 'playing' || this.mode === 'choosing' || this.mode === 'paused') {
      const boss = activeBosses(world)[0] || null;
      this.menus.updateHud(world, { timeLeft: timeLeft(world), boss });
      if (this.mode === 'playing') {
        const calm = world.enemies.length < this.config.music.calmBelow && !boss;
        const level = calm ? 'calm' : 'full';
        if (level !== this._intensity && !boss) {
          this._intensity = level;
          this.audio?.setMusicIntensity?.(level, 1500);
        }
      }
    }
  }

  _layerImage(layer, key, frame, add = false) {
    const image = this.add.image(0, 0, key, frame);
    if (add) image.setBlendMode(Phaser.BlendModes.ADD);
    layer.add(image);
    return image;
  }

  _newUnitSprite() {
    const s = this.add.image(0, 0, '__WHITE').setOrigin(0.5, 0.78);
    this.unitLayer.add(s);
    return s;
  }

  _releaseUnitSprite(s) {
    s.setVisible(false).setTint(0xffffff).setAlpha(1);
    this.spritePool.push(s);
  }

  // --- canvas -------------------------------------------------------------------------------

  _fitCanvas() {
    const container = document.getElementById('game-container');
    const rect = container?.getBoundingClientRect?.();
    if (!rect || rect.width < 1 || rect.height < 1) return;
    if (!this.originalSize)
      this.originalSize = { width: this.scale.width, height: this.scale.height };
    const { width, height } = battleCanvasSize(rect.width, rect.height, 1);
    if (width !== this.scale.width || height !== this.scale.height) {
      this.scale.setGameSize(width, height);
      this.cameras.main.setSize(width, height);
    }
    const zoom = Math.min(width, height) / VIEW_SHORT_SIDE;
    this.cameras.main.setZoom(zoom);
    if (this.world) setView(this.world, width / zoom, height / zoom);
    this.scale.refresh();
  }

  _shutdown() {
    this._night = (this._night || 0) + 1;
    this._paintAbort?.abort?.();
    this._resizeObserver?.disconnect();
    globalThis.removeEventListener?.('keydown', this._onKeyDown);
    document.removeEventListener('visibilitychange', this._onVisibility);
    popInputScope(this);
    this.menus?.destroy();
    this.menus = null;
    if (this.fieldKey && this.textures.exists(this.fieldKey)) this.textures.remove(this.fieldKey);
    if (this.originalSize)
      this.scale.setGameSize(this.originalSize.width, this.originalSize.height);
    this.world = null;
  }
}
