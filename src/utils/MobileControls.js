import { bindCancelablePress } from './cancelablePress.js';
import { isolateDOMInput } from './domInputBoundary.js';
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
    this._pressEpoch = 0;
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

    this._boundaryCleanups = [this._leftPanel, this._rightPanel, this._rotatePrompt]
      .filter(Boolean)
      .map((root) => isolateDOMInput(root, { keyboard: true }));

    // Wire left panel buttons (static — never change)
    this._wireLeftPanel();

    // Listen for context events from scenes
    this._onSetContext = (data) => {
      this._pressEpoch++;
      if (data?.resetStack === true) this._contextStack = [];
      this._baseContext = this._normalizeContext(data?.context);
      this._currentContext = this._resolveCurrentContext();
      this._renderRightPanel();
    };
    this._onPushContext = (data) => {
      this._pressEpoch++;
      // No same-context dedup: every push gets its own entry (keyed by the
      // caller's token when provided). Deduping silently dropped the second
      // of two stacked overlays sharing a context, so its later pop removed
      // an entry that belonged to something else — the context-drift bug.
      if (this._contextStack.length >= MAX_CONTEXT_STACK_DEPTH) return;
      const next = this._normalizeContext(data?.context);
      this._contextStack.push({ context: next, token: data?.token ?? null });
      this._currentContext = next;
      this._renderRightPanel();
    };
    this._onPopContext = (data) => {
      this._pressEpoch++;
      const token = data?.token;
      if (token != null) {
        // Token pop: remove that caller's entry wherever it sits; unknown
        // tokens are a no-op (idempotent double-pop, depth-capped push).
        for (let i = this._contextStack.length - 1; i >= 0; i--) {
          if (this._contextStack[i].token === token) {
            this._contextStack.splice(i, 1);
            break;
          }
        }
      } else if (this._contextStack.length > 0) {
        this._contextStack.pop();
      }
      this._currentContext = this._resolveCurrentContext();
      this._renderRightPanel();
    };
    this._onSetButtonVisible = (data) => {
      this._pressEpoch++;
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

    // Unsupported browsers show a plain rotation instruction, without a fake action.
    this._rotateButton = document.getElementById('rotate-lock');
    if (this._rotateButton) {
      const supported =
        typeof document.documentElement.requestFullscreen === 'function' &&
        typeof globalThis.screen?.orientation?.lock === 'function';
      this._rotateButton.hidden = !supported;
      this._onRotateTap = async () => {
        try {
          await document.documentElement.requestFullscreen();
          await screen.orientation.lock('landscape');
        } catch {
          this._rotateButton.hidden = true;
        }
      };
      if (supported) this._rotateButton.addEventListener('click', this._onRotateTap);
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
    for (const { el, cleanup } of this._rightButtons) {
      cleanup?.();
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
      this._rightButtons.push({ el: btn, action, cleanup: btn._pressCleanup });
    }
  }

  _normalizeContext(context) {
    const next = typeof context === 'string' ? context : 'none';
    return CONTEXTS[next] ? next : 'none';
  }

  _resolveCurrentContext() {
    if (this._contextStack.length > 0) {
      return this._contextStack[this._contextStack.length - 1].context;
    }
    return this._baseContext;
  }

  _syncPanelVisibility() {
    const shouldShow = this._isVisible && this._currentContext !== 'none';
    const changed = this._panelsShown !== shouldShow;
    this._panelsShown = shouldShow;
    if (this._leftPanel) this._leftPanel.style.display = shouldShow ? 'flex' : 'none';
    if (this._rightPanel) this._rightPanel.style.display = shouldShow ? 'flex' : 'none';
    if (changed) {
      this._pressEpoch++;
      this.game.scale?.refresh?.();
    }
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

    btn._pressCleanup = this._addTouchHandler(btn, () => {
      this.game.events.emit(`mobile:${action}`);
    });

    return btn;
  }

  _addTouchHandler(el, handler) {
    return bindCancelablePress(el, handler, {
      enabled: () => this._isVisible && this._currentContext !== 'none',
      context: () => this._pressEpoch,
    });
  }

  destroy() {
    for (const cleanup of this._boundaryCleanups) cleanup();
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
    for (const { cleanup } of this._rightButtons) cleanup?.();
    this._rightButtons = [];
    if (this._rotateButton && this._onRotateTap)
      this._rotateButton.removeEventListener('click', this._onRotateTap);
  }
}
