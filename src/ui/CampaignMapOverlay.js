// CampaignMapOverlay — Read-only mini node map shown from the battle pause menu.
// Depth range 830-832 (between PauseOverlay 800 and confirm dialog 850).

import { ACT_CONFIG, NODE_TYPES } from '../utils/constants.js';
import { consumeEscEvent } from '../utils/escPriority.js';

const DEPTH_BG = 830;
const DEPTH_PANEL = 831;
const DEPTH_UI = 832;

const PANEL_W = 480;
const PANEL_H = 380;
const MAP_PAD = 40;
const MAP_TOP = 50;
const MAP_BOTTOM = 310;
const NODE_RADIUS = 8;
const NUM_COLUMNS = 5;

// Node state colors
const COLOR_COMPLETED = 0x555555;
const COLOR_ACTIVE = 0x44ff44;
const COLOR_NEXT = 0xffdd44;
const COLOR_LOCKED_BATTLE = 0xcc6633;
const COLOR_LOCKED_BOSS = 0xcc3333;
const COLOR_LOCKED_SHOP = 0xddaa33;
const COLOR_LOCKED_RECRUIT = 0x44ccaa;
const COLOR_LOCKED_CHURCH = 0xcccccc;

const LOCKED_COLORS = {
  [NODE_TYPES.BATTLE]: COLOR_LOCKED_BATTLE,
  [NODE_TYPES.BOSS]: COLOR_LOCKED_BOSS,
  [NODE_TYPES.SHOP]: COLOR_LOCKED_SHOP,
  [NODE_TYPES.RECRUIT]: COLOR_LOCKED_RECRUIT,
  [NODE_TYPES.CHURCH]: COLOR_LOCKED_CHURCH,
};

const NODE_ICONS = {
  [NODE_TYPES.BATTLE]: '\u2694',
  [NODE_TYPES.BOSS]: '\u2620',
  [NODE_TYPES.SHOP]: '$',
  [NODE_TYPES.RECRUIT]: '!',
  [NODE_TYPES.CHURCH]: '\u271D',
};

/**
 * Classify each node into a visual state.
 * @param {Array} nodes
 * @param {string|null} activeNodeId — the node the player is currently battling in
 * @returns {Map<string, 'completed'|'active'|'next'|'locked'>}
 */
export function classifyNodes(nodes, activeNodeId) {
  const states = new Map();
  if (!Array.isArray(nodes)) return states;
  const activeNode = nodes.find((n) => n.id === activeNodeId);
  const nextNodeIds = new Set(activeNode?.edges || []);

  for (const node of nodes) {
    if (node.id === activeNodeId) {
      states.set(node.id, 'active');
    } else if (node.completed) {
      states.set(node.id, 'completed');
    } else if (nextNodeIds.has(node.id)) {
      states.set(node.id, 'next');
    } else {
      states.set(node.id, 'locked');
    }
  }
  return states;
}

export class CampaignMapOverlay {
  /**
   * @param {Phaser.Scene} scene
   * @param {{ nodeMap: object, currentNodeId: string|null, actId: string, activeNodeId: string|null, onClose: Function }} opts
   */
  constructor(scene, { nodeMap, currentNodeId, actId, activeNodeId, onClose }) {
    this.scene = scene;
    this.nodeMap = nodeMap;
    this.currentNodeId = currentNodeId;
    this.actId = actId;
    this.activeNodeId = activeNodeId;
    this.onClose = onClose;
    this.objects = [];
    this.visible = false;
    this.escKey = null;
  }

  show() {
    this.hide();
    this.visible = true;
    this._draw();

    this.escKey = this.scene.input.keyboard.addKey('ESC');
    this.escKey.on('down', this._onEsc, this);
  }

  _draw() {
    const cx = this.scene.cameras.main.centerX;
    const cy = this.scene.cameras.main.centerY;
    const nodes = this.nodeMap?.nodes || [];

    // Dark fullscreen bg
    const bg = this.scene.add
      .rectangle(cx, cy, 640, 480, 0x000000, 0.7)
      .setDepth(DEPTH_BG)
      .setInteractive();
    this.objects.push(bg);

    // Panel
    const panelX = cx;
    const panelY = cy;
    const panel = this.scene.add
      .rectangle(panelX, panelY, PANEL_W, PANEL_H, 0x1a1a2e, 1)
      .setDepth(DEPTH_PANEL)
      .setStrokeStyle(2, 0x888888);
    this.objects.push(panel);

    const panelLeft = panelX - PANEL_W / 2;
    const panelTop = panelY - PANEL_H / 2;

    // Title
    const actConfig = ACT_CONFIG[this.actId] || {};
    const actStr = typeof this.actId === 'string' ? this.actId : '';
    const actNum = actStr === 'finalBoss' ? '' : actStr.replace('act', 'Act ');
    const titleText = actNum
      ? `${actNum}: ${actConfig.name || ''}`
      : actConfig.name || 'Campaign Map';
    const title = this.scene.add
      .text(panelX, panelTop + 18, titleText, {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ffdd44',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH_UI);
    this.objects.push(title);

    // Close button
    const closeBtn = this.scene.add
      .text(panelLeft + PANEL_W - 16, panelTop + 8, '[X]', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#cc5555',
      })
      .setOrigin(0.5, 0)
      .setDepth(DEPTH_UI)
      .setInteractive({ useHandCursor: true });
    closeBtn.on('pointerover', () => closeBtn.setColor('#ff8888'));
    closeBtn.on('pointerout', () => closeBtn.setColor('#cc5555'));
    closeBtn.on('pointerdown', () => this.hide());
    this.objects.push(closeBtn);

    if (nodes.length === 0) return;

    // Classify node states
    const states = classifyNodes(nodes, this.activeNodeId);

    // Compute positions (same math as NodeMapScene, scaled to panel)
    const totalRows = Math.max(...nodes.map((n) => n.row)) + 1;
    const mapLeft = panelLeft + MAP_PAD;
    const mapRight = panelLeft + PANEL_W - MAP_PAD;
    const mapTop = panelTop + MAP_TOP;
    const mapBottom = panelTop + MAP_BOTTOM;
    const positions = new Map();

    for (const node of nodes) {
      const yFrac = 1 - node.row / Math.max(totalRows - 1, 1);
      const y = mapTop + yFrac * (mapBottom - mapTop);
      const xFrac = node.col / (NUM_COLUMNS - 1);
      const x = mapLeft + xFrac * (mapRight - mapLeft);
      positions.set(node.id, { x, y });
    }

    // Draw edges
    const graphics = this.scene.add.graphics().setDepth(DEPTH_UI);
    this.objects.push(graphics);

    for (const node of nodes) {
      const from = positions.get(node.id);
      for (const edgeId of node.edges || []) {
        const to = positions.get(edgeId);
        if (!from || !to) continue;
        const fromState = states.get(node.id);
        const toState = states.get(edgeId);
        // Highlight traveled path (completed→completed, completed→active) and upcoming choices (active→next)
        const isActivePath =
          (fromState === 'active' && toState === 'next') ||
          (fromState === 'completed' && (toState === 'active' || toState === 'completed'));
        graphics.lineStyle(
          isActivePath ? 2 : 1,
          isActivePath ? 0xffdd44 : 0x666666,
          isActivePath ? 0.9 : 0.3,
        );
        graphics.lineBetween(from.x, from.y, to.x, to.y);
      }
    }

    // Draw nodes
    for (const node of nodes) {
      const pos = positions.get(node.id);
      if (!pos) continue;
      const state = states.get(node.id);

      let color;
      let alpha = 1;
      if (state === 'completed') {
        color = COLOR_COMPLETED;
      } else if (state === 'active') {
        color = COLOR_ACTIVE;
      } else if (state === 'next') {
        color = COLOR_NEXT;
      } else {
        color = LOCKED_COLORS[node.type] || COLOR_LOCKED_BATTLE;
        alpha = 0.4;
      }

      const circle = this.scene.add
        .circle(pos.x, pos.y, NODE_RADIUS, color, alpha)
        .setDepth(DEPTH_UI);
      this.objects.push(circle);

      // Icon text
      const icon = NODE_ICONS[node.type] || '?';
      const iconColor = state === 'completed' ? '#888888' : '#ffffff';
      const iconText = this.scene.add
        .text(pos.x, pos.y, icon, {
          fontFamily: 'monospace',
          fontSize: '9px',
          color: iconColor,
        })
        .setOrigin(0.5)
        .setDepth(DEPTH_UI)
        .setAlpha(state === 'locked' ? 0.5 : 1);
      this.objects.push(iconText);

      // "YOU" marker for active node
      if (state === 'active') {
        const marker = this.scene.add
          .text(pos.x, pos.y - NODE_RADIUS - 10, '\u25BC YOU', {
            fontFamily: 'monospace',
            fontSize: '8px',
            color: '#44ff44',
          })
          .setOrigin(0.5)
          .setDepth(DEPTH_UI);
        this.objects.push(marker);

        // Pulsing tween on the circle
        this.scene.tweens.add({
          targets: circle,
          scaleX: 1.3,
          scaleY: 1.3,
          duration: 600,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
    }

    // Legend strip at bottom of panel
    this._drawLegend(panelX, panelTop + PANEL_H - 30);
  }

  _drawLegend(cx, y) {
    const entries = [
      { label: 'Done', color: '#555555' },
      { label: 'Here', color: '#44ff44' },
      { label: 'Next', color: '#ffdd44' },
      { label: 'Locked', color: '#888888' },
    ];
    const spacing = 80;
    const startX = cx - ((entries.length - 1) * spacing) / 2;

    for (let i = 0; i < entries.length; i++) {
      const ex = startX + i * spacing;
      const dot = this.scene.add
        .circle(ex - 14, y, 4, parseInt(entries[i].color.replace('#', ''), 16))
        .setDepth(DEPTH_UI);
      if (entries[i].label === 'Locked') dot.setAlpha(0.4);
      this.objects.push(dot);

      const lbl = this.scene.add
        .text(ex, y, entries[i].label, {
          fontFamily: 'monospace',
          fontSize: '8px',
          color: entries[i].color,
        })
        .setOrigin(0, 0.5)
        .setDepth(DEPTH_UI);
      this.objects.push(lbl);
    }
  }

  _onEsc(_key, event) {
    if (!consumeEscEvent(this.scene, event)) return;
    this.hide();
  }

  hide() {
    if (this.escKey) {
      this.escKey.off('down', this._onEsc, this);
      this.escKey = null;
    }
    for (const obj of this.objects) obj.destroy();
    this.objects = [];
    const wasVisible = this.visible;
    this.visible = false;
    if (wasVisible && this.onClose) this.onClose();
  }
}
