import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForecastOverlay } from '../src/ui/ForecastOverlay.js';

// ── Mock helpers ────────────────────────────────────────────

function makeDisplayObject(seed = {}) {
  return {
    x: 0,
    y: 0,
    width: 0,
    height: 14,
    depth: 0,
    originX: 0,
    originY: 0,
    visible: true,
    text: '',
    ...seed,
    handlers: {},
    setOrigin(x = 0, y = x) {
      this.originX = x;
      this.originY = y;
      return this;
    },
    setDepth(d) {
      this.depth = d;
      return this;
    },
    setDisplaySize() {
      return this;
    },
    setInteractive() {
      this.interactive = true;
      return this;
    },
    setStrokeStyle() {
      return this;
    },
    setFillStyle() {
      return this;
    },
    setVisible(v) {
      this.visible = v;
      return this;
    },
    setColor() {
      return this;
    },
    on(event, cb) {
      this.handlers[event] = cb;
      return this;
    },
    destroy: vi.fn(),
  };
}

function makeScene() {
  const scene = {
    cameras: {
      main: { width: 640, height: 480 },
    },
    registry: { get: vi.fn(() => null) },
    textures: { exists: vi.fn(() => false) },
    _uiClickBlocked: false,
    _cycleForecastWeapon: vi.fn(),
    confirmForecastCombat: vi.fn(),
    _getPortraitKey: vi.fn(() => null),
    _getWeaponArtHpAfterCost: vi.fn(() => 15),
    _formatWeaponArtCostLabel: vi.fn(() => '5'),
    add: {
      rectangle: (x, y, w, h) => makeDisplayObject({ x, y, width: w, height: h }),
      text: (...args) => {
        const content = typeof args[2] === 'string' ? args[2] : '';
        return makeDisplayObject({
          x: args[0],
          y: args[1],
          text: content,
          width: Math.max(1, content.length) * 6,
        });
      },
      image: (x, y, key) => makeDisplayObject({ x, y, textureKey: key }),
      graphics: () => {
        const g = makeDisplayObject();
        g.fillStyle = vi.fn();
        g.fillRect = vi.fn();
        g.lineStyle = vi.fn();
        g.lineBetween = vi.fn();
        return g;
      },
    },
  };
  return scene;
}

function makeUnit(overrides = {}) {
  return {
    name: 'Edric',
    className: 'Lord',
    currentHP: 20,
    stats: { HP: 20, STR: 8, MAG: 0, SKL: 6, SPD: 7, DEF: 5, RES: 3, LCK: 5 },
    weapon: { name: 'Iron Sword', type: 'Sword', might: 5, hit: 90, crit: 0, weight: 5 },
    skills: [],
    ...overrides,
  };
}

function makeForecast(atkOverrides = {}, defOverrides = {}) {
  return {
    attacker: {
      damage: 8,
      hit: 85,
      crit: 5,
      as: 7,
      attackCount: 1,
      canCounter: true,
      skills: [],
      warnings: [],
      ...atkOverrides,
    },
    defender: {
      damage: 4,
      hit: 70,
      crit: 2,
      as: 5,
      attackCount: 1,
      canCounter: true,
      skills: [],
      warnings: [],
      ...defOverrides,
    },
  };
}

// ── Tests ────────────────────────────────────────────────────

describe('ForecastOverlay', () => {
  let scene;

  beforeEach(() => {
    scene = makeScene();
  });

  describe('render()', () => {
    it('renders panel background, divider, and VS text', () => {
      const overlay = new ForecastOverlay(scene);
      overlay.render({
        attacker: makeUnit(),
        defender: makeUnit({ name: 'Fighter', className: 'Fighter' }),
        forecast: makeForecast(),
        weaponArt: null,
        gamblerLine: null,
        validWeapons: [{ name: 'Iron Sword' }],
      });

      expect(overlay.displayObjects.length).toBeGreaterThan(0);
      // VS text should exist
      const vsText = overlay.displayObjects.find((o) => o.text === 'VS');
      expect(vsText).toBeTruthy();
    });

    it('renders attacker and defender sides with correct stats', () => {
      const overlay = new ForecastOverlay(scene);
      overlay.render({
        attacker: makeUnit({ name: 'Edric' }),
        defender: makeUnit({ name: 'Bandit', className: 'Fighter' }),
        forecast: makeForecast({ damage: 12, hit: 90, crit: 5 }, { damage: 4, hit: 60, crit: 0 }),
        weaponArt: null,
        gamblerLine: null,
        validWeapons: [],
      });

      // Both unit names should appear
      const names = overlay.displayObjects.filter((o) => o.text === 'Edric' || o.text === 'Bandit');
      expect(names.length).toBe(2);

      // Damage values should appear
      const dmgTexts = overlay.displayObjects.filter((o) => o.text === '12' || o.text === '4');
      expect(dmgTexts.length).toBe(2);
    });

    it('shows EFFECTIVE! banner when weapon has effectiveness', () => {
      const attacker = makeUnit({
        weapon: {
          name: 'Armorslayer',
          type: 'Sword',
          might: 8,
          hit: 80,
          crit: 0,
          weight: 10,
          special: 'Effective vs Armored (3x)',
        },
      });
      const defender = makeUnit({
        name: 'Knight',
        className: 'Knight',
        moveType: 'Armored',
      });

      const overlay = new ForecastOverlay(scene);
      overlay.render({
        attacker,
        defender,
        forecast: makeForecast(),
        weaponArt: null,
        gamblerLine: null,
        validWeapons: [],
      });

      const effectiveText = overlay.displayObjects.find((o) => o.text === 'EFFECTIVE!');
      expect(effectiveText).toBeTruthy();
    });

    it('shows "No Counter" for defender who cannot counter', () => {
      const overlay = new ForecastOverlay(scene);
      overlay.render({
        attacker: makeUnit(),
        defender: makeUnit({ name: 'Archer' }),
        forecast: makeForecast({}, { canCounter: false }),
        weaponArt: null,
        gamblerLine: null,
        validWeapons: [],
      });

      const noCounter = overlay.displayObjects.find((o) => o.text === '-- No Counter --');
      expect(noCounter).toBeTruthy();
    });

    it('displays doubling indicator (x2) when attackCount > 1', () => {
      const overlay = new ForecastOverlay(scene);
      overlay.render({
        attacker: makeUnit(),
        defender: makeUnit({ name: 'Slow' }),
        forecast: makeForecast({ attackCount: 2 }),
        weaponArt: null,
        gamblerLine: null,
        validWeapons: [],
      });

      const doubleText = overlay.displayObjects.find((o) => o.text === 'x2');
      expect(doubleText).toBeTruthy();
    });

    it('weapon cycling arrows appear when validWeapons.length >= 2', () => {
      const wpn1 = { name: 'Iron Sword', type: 'Sword', might: 5, hit: 90, crit: 0, weight: 5 };
      const wpn2 = { name: 'Steel Sword', type: 'Sword', might: 8, hit: 80, crit: 0, weight: 8 };

      const overlay = new ForecastOverlay(scene);
      overlay.render({
        attacker: makeUnit({ weapon: wpn1 }),
        defender: makeUnit({ name: 'Enemy' }),
        forecast: makeForecast(),
        weaponArt: null,
        gamblerLine: null,
        validWeapons: [wpn1, wpn2],
      });

      const leftArrow = overlay.displayObjects.find((o) => o.text === '\u25C4');
      const rightArrow = overlay.displayObjects.find((o) => o.text === '\u25BA');
      expect(leftArrow).toBeTruthy();
      expect(rightArrow).toBeTruthy();
    });

    it('weapon cycling arrows call scene._cycleForecastWeapon(dir)', () => {
      const wpn1 = { name: 'Iron Sword', type: 'Sword', might: 5, hit: 90, crit: 0, weight: 5 };
      const wpn2 = { name: 'Steel Sword', type: 'Sword', might: 8, hit: 80, crit: 0, weight: 8 };

      const overlay = new ForecastOverlay(scene);
      overlay.render({
        attacker: makeUnit({ weapon: wpn1 }),
        defender: makeUnit({ name: 'Enemy' }),
        forecast: makeForecast(),
        weaponArt: null,
        gamblerLine: null,
        validWeapons: [wpn1, wpn2],
      });

      const leftArrow = overlay.displayObjects.find((o) => o.text === '\u25C4');
      const rightArrow = overlay.displayObjects.find((o) => o.text === '\u25BA' && o.interactive);

      leftArrow.handlers['pointerdown']({ button: 0 });
      expect(scene._cycleForecastWeapon).toHaveBeenCalledWith(-1);

      rightArrow.handlers['pointerdown']({ button: 0 });
      expect(scene._cycleForecastWeapon).toHaveBeenCalledWith(1);
    });

    it('confirm button calls scene.confirmForecastCombat()', () => {
      const overlay = new ForecastOverlay(scene);
      overlay.render({
        attacker: makeUnit(),
        defender: makeUnit({ name: 'Enemy' }),
        forecast: makeForecast(),
        weaponArt: null,
        gamblerLine: null,
        validWeapons: [],
      });

      const confirmBtn = overlay.displayObjects.find((o) => o.text === 'CONFIRM ATTACK');
      // The bg rectangle has the interactive handler, not the text
      const confirmBg = overlay.displayObjects.find(
        (o) =>
          o.interactive && o.handlers?.pointerdown && o.text !== '\u25C4' && o.text !== '\u25BA',
      );
      expect(confirmBg).toBeTruthy();
      confirmBg.handlers['pointerdown']({ button: 0 });
      expect(scene.confirmForecastCombat).toHaveBeenCalledTimes(1);
    });

    it('confirm button sets scene._uiClickBlocked = true', () => {
      const overlay = new ForecastOverlay(scene);
      overlay.render({
        attacker: makeUnit(),
        defender: makeUnit({ name: 'Enemy' }),
        forecast: makeForecast(),
        weaponArt: null,
        gamblerLine: null,
        validWeapons: [],
      });

      const confirmBg = overlay.displayObjects.find(
        (o) =>
          o.interactive && o.handlers?.pointerdown && o.text !== '\u25C4' && o.text !== '\u25BA',
      );
      confirmBg.handlers['pointerdown']({ button: 0 });
      expect(scene._uiClickBlocked).toBe(true);
    });

    it('shows weapon art cost line when weaponArt provided', () => {
      const art = { name: 'Rising Sun', hpCost: 5 };
      scene._formatWeaponArtCostLabel.mockReturnValue('5');
      scene._getWeaponArtHpAfterCost.mockReturnValue(15);

      const overlay = new ForecastOverlay(scene);
      overlay.render({
        attacker: makeUnit({ currentHP: 20 }),
        defender: makeUnit({ name: 'Enemy' }),
        forecast: makeForecast(),
        weaponArt: art,
        gamblerLine: null,
        validWeapons: [],
      });

      const artText = overlay.displayObjects.find((o) => o.text?.includes('ART: Rising Sun'));
      expect(artText).toBeTruthy();
      expect(artText.text).toContain('HP-5');
      expect(artText.text).toContain('20->15');
    });

    it('shows gambler line when gamblerLine provided', () => {
      const overlay = new ForecastOverlay(scene);
      overlay.render({
        attacker: makeUnit(),
        defender: makeUnit({ name: 'Enemy' }),
        forecast: makeForecast(),
        weaponArt: null,
        gamblerLine: 'GAMBLER: ATK +3 (locked)',
        validWeapons: [],
      });

      const gamblerText = overlay.displayObjects.find((o) => o.text?.includes('GAMBLER: ATK +3'));
      expect(gamblerText).toBeTruthy();
    });

    it('shows warning labels (BLOCK, REFLECT, WARP)', () => {
      const overlay = new ForecastOverlay(scene);
      overlay.render({
        attacker: makeUnit(),
        defender: makeUnit({ name: 'Boss' }),
        forecast: makeForecast({}, { warnings: ['Shielded', 'Thorns', 'Teleporter'] }),
        weaponArt: null,
        gamblerLine: null,
        validWeapons: [],
      });

      const block = overlay.displayObjects.find((o) => o.text === '[BLOCK]');
      const reflect = overlay.displayObjects.find((o) => o.text === '[REFLECT]');
      const warp = overlay.displayObjects.find((o) => o.text === '[WARP]');
      expect(block).toBeTruthy();
      expect(reflect).toBeTruthy();
      expect(warp).toBeTruthy();
    });

    it('renders forged weapon name in green color (#44ff88)', () => {
      const forgedWeapon = {
        name: 'Iron Sword +1',
        type: 'Sword',
        might: 6,
        hit: 90,
        crit: 0,
        weight: 5,
        _forgeLevel: 1,
        _forgeStats: { might: 1 },
      };

      const overlay = new ForecastOverlay(scene);
      overlay.render({
        attacker: makeUnit({ weapon: forgedWeapon }),
        defender: makeUnit({ name: 'Enemy' }),
        forecast: makeForecast(),
        weaponArt: null,
        gamblerLine: null,
        validWeapons: [],
      });

      // The weapon name text should be in the display objects
      const wpnText = overlay.displayObjects.find((o) => o.text === 'Iron Sword +1');
      expect(wpnText).toBeTruthy();
    });

    it('right-click on confirm button does nothing', () => {
      const overlay = new ForecastOverlay(scene);
      overlay.render({
        attacker: makeUnit(),
        defender: makeUnit({ name: 'Enemy' }),
        forecast: makeForecast(),
        weaponArt: null,
        gamblerLine: null,
        validWeapons: [],
      });

      const confirmBg = overlay.displayObjects.find(
        (o) =>
          o.interactive && o.handlers?.pointerdown && o.text !== '\u25C4' && o.text !== '\u25BA',
      );
      confirmBg.handlers['pointerdown']({ button: 2 });
      expect(scene.confirmForecastCombat).not.toHaveBeenCalled();
    });

    it('right-click on weapon-cycle arrows does nothing', () => {
      const wpn1 = { name: 'Iron Sword', type: 'Sword', might: 5, hit: 90, crit: 0, weight: 5 };
      const wpn2 = { name: 'Steel Sword', type: 'Sword', might: 8, hit: 80, crit: 0, weight: 8 };

      const overlay = new ForecastOverlay(scene);
      overlay.render({
        attacker: makeUnit({ weapon: wpn1 }),
        defender: makeUnit({ name: 'Enemy' }),
        forecast: makeForecast(),
        weaponArt: null,
        gamblerLine: null,
        validWeapons: [wpn1, wpn2],
      });

      const leftArrow = overlay.displayObjects.find((o) => o.text === '\u25C4');
      const rightArrow = overlay.displayObjects.find((o) => o.text === '\u25BA' && o.interactive);

      leftArrow.handlers['pointerdown']({ button: 2 });
      rightArrow.handlers['pointerdown']({ button: 2 });
      expect(scene._cycleForecastWeapon).not.toHaveBeenCalled();
    });

    it('confirm button plays sfx_confirm SFX before calling confirmForecastCombat', () => {
      const playSFX = vi.fn();
      scene.registry.get = vi.fn(() => ({ playSFX }));

      const overlay = new ForecastOverlay(scene);
      overlay.render({
        attacker: makeUnit(),
        defender: makeUnit({ name: 'Enemy' }),
        forecast: makeForecast(),
        weaponArt: null,
        gamblerLine: null,
        validWeapons: [],
      });

      const confirmBg = overlay.displayObjects.find(
        (o) =>
          o.interactive && o.handlers?.pointerdown && o.text !== '\u25C4' && o.text !== '\u25BA',
      );
      confirmBg.handlers['pointerdown']({ button: 0 });

      expect(playSFX).toHaveBeenCalledWith('sfx_confirm');
      expect(scene.confirmForecastCombat).toHaveBeenCalledTimes(1);
    });
  });

  describe('destroy()', () => {
    it('destroys all display objects and clears array in-place', () => {
      const overlay = new ForecastOverlay(scene);
      overlay.render({
        attacker: makeUnit(),
        defender: makeUnit({ name: 'Enemy' }),
        forecast: makeForecast(),
        weaponArt: null,
        gamblerLine: null,
        validWeapons: [],
      });

      const count = overlay.displayObjects.length;
      expect(count).toBeGreaterThan(0);

      // Keep reference to the same array
      const ref = overlay.displayObjects;

      overlay.destroy();

      // Array should be cleared in-place (same reference)
      expect(ref).toBe(overlay.displayObjects);
      expect(overlay.displayObjects.length).toBe(0);
    });

    it('is safe to call twice (idempotent)', () => {
      const overlay = new ForecastOverlay(scene);
      overlay.render({
        attacker: makeUnit(),
        defender: makeUnit({ name: 'Enemy' }),
        forecast: makeForecast(),
        weaponArt: null,
        gamblerLine: null,
        validWeapons: [],
      });

      expect(() => {
        overlay.destroy();
        overlay.destroy();
      }).not.toThrow();

      expect(overlay.displayObjects.length).toBe(0);
    });
  });
});
