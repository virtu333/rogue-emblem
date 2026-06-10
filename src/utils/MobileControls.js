// MobileControls.js — HTML overlay virtual controls for mobile
// Pure DOM, no Phaser imports. Communicates via game.events bridge.

const BUTTON_DEFS = {
  danger: { icon: '\u26A0', label: 'Danger' },
  roster: { icon: '\uD83D\uDCCB', label: 'Roster' },
  objective: { icon: '\u2139', label: 'Vision' },
  endTurn: { icon: '\u23ED', label: 'End Turn' },
  inspect: { icon: '\uD83D\uDC41', label: 'Inspect' },
  prevWeapon: { icon: '\u25C0', label: 'Prev Wpn' },
  nextWeapon: { icon: '\u25B6', label: 'Next Wpn' },
  prevTab: { icon: '\u25C0', label: 'Prev' },
  nextTab: { icon: '\u25B6', label: 'Next' },
  prevUnit: { icon: '\u25B2', label: 'Prev Unit' },
  nextUnit: { icon: '\u25BC', label: 'Next Unit' },
};

const CONTEXTS = {
  battle_player_idle: ['danger', 'roster', 'objective', 'inspect', 'endTurn'],
  battle_unit_selected: ['danger', 'roster', 'objective', 'endTurn'],
  battle_idle: ['danger', 'roster', 'objective', 'endTurn'],
  battle_action: ['danger', 'roster'],
  battle_selected: ['danger'],
  battle_forecast: ['prevWeapon', 'nextWeapon'],
  battle_end: ['roster'],
  nodemap: ['roster'],
  homebase: [],
  overlay_tabs: ['prevTab', 'nextTab'],
  overlay_unit_detail: ['prevTab', 'nextTab', 'prevUnit', 'nextUnit'],
  none: [],
};

const MAX_CONTEXT_STACK_DEPTH = 8;

export class MobileControls {
  constructor(game) {
    this.game = game;
    this._baseContext = 'none';
    this._currentContext = 'none';
    this._lastRenderedContext = null;
    this._contextStack = [];
    this._isVisible = false;
    this._rightButtons = [];
    this._leftPanelCleanups = [];
    this._leftButtons = new Map();
    this._buttonVisibility = new Map();
    this._buttonVisibility.set('resetView', false);

    this._leftPanel = document.getElementById('mobile-left-panel');
    this._rightPanel = document.getElementById('mobile-right-panel');
    this._rotatePrompt = document.getElementById('rotate-prompt');

    // Wire left panel buttons (static — never change)
    this._wireLeftPanel();

    // Listen for context events from scenes
    this._onSetContext = (data) => {
      if (data?.resetStack === true) this._contextStack = [];
      this._baseContext = this._normalizeContext(data?.context);
      this._currentContext = this._resolveCurrentContext();
      this._renderRightPanel();
    };
    this._onPushContext = (data) => {
      const next = this._normalizeContext(data?.context);
      const active = this._resolveCurrentContext();
      if (next === active) return;
      if (this._contextStack.length >= MAX_CONTEXT_STACK_DEPTH) return;
      this._contextStack.push(next);
      this._currentContext = next;
      this._renderRightPanel();
    };
    this._onPopContext = () => {
      if (this._contextStack.length > 0) this._contextStack.pop();
      this._currentContext = this._resolveCurrentContext();
      this._renderRightPanel();
    };
    this._onSetButtonVisible = (data) => {
      const action = typeof data?.action === 'string' ? data.action : '';
      if (!action) return;
      const wasVisible = this._isButtonVisible(action);
      const nextVisible = data?.visible !== false;
      this._buttonVisibility.set(action, nextVisible);
      this._applyButtonVisibility(action);
      if (wasVisible !== nextVisible) {
        this._lastRenderedContext = null;
        this._renderRightPanel();
      }
    };

    game.events.on('mobile:setContext', this._onSetContext);
    game.events.on('mobile:pushContext', this._onPushContext);
    game.events.on('mobile:popContext', this._onPopContext);
    game.events.on('mobile:setButtonVisible', this._onSetButtonVisible);

    // Rotate prompt — request fullscreen + landscape lock on tap
    if (this._rotatePrompt) {
      this._onRotateTap = () => {
        const doc = document.documentElement;
        if (doc.requestFullscreen) {
          doc
            .requestFullscreen()
            .then(() => screen.orientation?.lock?.('landscape').catch(() => {}))
            .catch(() => {});
        }
      };
      this._rotatePrompt.addEventListener('click', this._onRotateTap);
    }
  }

  show() {
    this._isVisible = true;
    this._syncPanelVisibility();
    this._renderRightPanel();
  }

  hide() {
    this._isVisible = false;
    this._syncPanelVisibility();
  }

  _wireLeftPanel() {
    if (!this._leftPanel) return;
    const buttons = this._leftPanel.querySelectorAll('.mobile-btn');
    for (const btn of buttons) {
      const action = btn.dataset.action;
      if (!action) continue;
      this._leftButtons.set(action, btn);
      const unlisten = this._addTouchHandler(btn, () => {
        this.game.events.emit(`mobile:${action}`);
      });
      this._leftPanelCleanups.push(unlisten);
      this._applyButtonVisibility(action);
    }
  }

  _renderRightPanel() {
    if (!this._rightPanel) return;
    this._syncPanelVisibility();
    const ctx = this._currentContext;
    if (ctx === this._lastRenderedContext) return;
    this._lastRenderedContext = ctx;

    // Clear existing buttons
    for (const { el } of this._rightButtons) {
      el.remove();
    }
    this._rightButtons = [];

    const actions = CONTEXTS[ctx] || [];
    for (const action of actions) {
      const def = BUTTON_DEFS[action];
      if (!def) continue;
      if (!this._isButtonVisible(action)) continue;
      const btn = this._createButton(def, action);
      this._rightPanel.appendChild(btn);
      this._rightButtons.push({ el: btn, action });
    }
  }

  _normalizeContext(context) {
    const next = typeof context === 'string' ? context : 'none';
    return CONTEXTS[next] ? next : 'none';
  }

  _resolveCurrentContext() {
    if (this._contextStack.length > 0) {
      return this._contextStack[this._contextStack.length - 1];
    }
    return this._baseContext;
  }

  _syncPanelVisibility() {
    const shouldShow = this._isVisible && this._currentContext !== 'none';
    if (this._leftPanel) this._leftPanel.style.display = shouldShow ? 'flex' : 'none';
    if (this._rightPanel) this._rightPanel.style.display = shouldShow ? 'flex' : 'none';
  }

  _isButtonVisible(action) {
    return this._buttonVisibility.get(action) !== false;
  }

  _applyButtonVisibility(action) {
    const visible = this._isButtonVisible(action);
    const leftBtn = this._leftButtons.get(action);
    if (leftBtn) leftBtn.style.display = visible ? '' : 'none';
    for (const ref of this._rightButtons) {
      if (ref.action === action && ref.el) {
        ref.el.style.display = visible ? '' : 'none';
      }
    }
  }

  _createButton(def, action) {
    const btn = document.createElement('button');
    btn.className = 'mobile-btn';
    btn.dataset.action = action;

    const icon = document.createElement('span');
    icon.className = 'mobile-btn-icon';
    icon.textContent = def.icon;
    btn.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'mobile-btn-label';
    label.textContent = def.label;
    btn.appendChild(label);

    this._addTouchHandler(btn, () => {
      this.game.events.emit(`mobile:${action}`);
    });

    return btn;
  }

  _addTouchHandler(el, handler) {
    // Use touchend for action (native button feel), prevent passthrough to canvas
    let touchStarted = false;
    let lastTouchTime = 0;

    const onTouchStart = (e) => {
      e.preventDefault();
      e.stopPropagation();
      touchStarted = true;
    };

    const onTouchEnd = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (touchStarted) {
        touchStarted = false;
        lastTouchTime = Date.now();
        handler();
      }
    };

    const onTouchCancel = () => {
      touchStarted = false;
    };

    // Also support mouse click for devtools testing
    const onClick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Only fire if not already handled by touch (ghost-click guard: 400ms)
      if (!touchStarted && Date.now() - lastTouchTime > 400) handler();
    };

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: false });
    el.addEventListener('touchcancel', onTouchCancel);
    el.addEventListener('click', onClick);

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchCancel);
      el.removeEventListener('click', onClick);
    };
  }

  destroy() {
    this._isVisible = false;
    if (this.game?.events) {
      this.game.events.off('mobile:setContext', this._onSetContext);
      this.game.events.off('mobile:pushContext', this._onPushContext);
      this.game.events.off('mobile:popContext', this._onPopContext);
      this.game.events.off('mobile:setButtonVisible', this._onSetButtonVisible);
    }
    for (const unlisten of this._leftPanelCleanups) unlisten();
    this._leftPanelCleanups = [];
    this._leftButtons.clear();
    if (this._rotatePrompt && this._onRotateTap) {
      this._rotatePrompt.removeEventListener('click', this._onRotateTap);
    }
  }
}
