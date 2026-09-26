import { presentationText } from '../utils/presentationText.js';
import { createBattleTerrain } from './BattleMapVisuals.js';
import { drawWeatheredTile, WEATHERED_TILE_SIZE } from './WeatheredTerrain.js';
import { softenGrassTexture, contrastSpriteKey } from './BattleContrast.js';
import { ensureTracedTexture } from './TracedSprites.js';
import { TILE_SIZE, FACTION_COLORS } from '../utils/constants.js';
import { UI_DEPTHS } from '../utils/uiDepths.js';
import { UI_PALETTE, UI_HEX } from '../utils/uiStyles.js';

const point = (unit) => ({
  x: (unit.col + unit.size / 2) * TILE_SIZE,
  y: (unit.row + unit.size / 2) * TILE_SIZE,
});

export class BattleHistoryRenderer {
  constructor(scene) {
    this.scene = scene;
    this.objects = [];
    this.units = new Map();
    this.terrainTextures = new Map();
    this.generation = 0;
  }
  clear() {
    this.scene.tweens.killAll();
    for (const o of this.objects) o.destroy();
    this.objects = [];
    this.units.clear();
  }
  add(object) {
    this.objects.push(object);
    return object;
  }
  terrain(tile, frame, x, y) {
    const s = this.scene;
    if (this.art && tile.known) {
      const at = (col, row) =>
        col >= 0 && col < frame.cols && row >= 0 && row < frame.rows
          ? frame.tiles[row * frame.cols + col]?.label
          : undefined;
      const signature = JSON.stringify([
        frame.biome,
        tile.col,
        tile.row,
        at(tile.col, tile.row),
        at(tile.col - 1, tile.row),
        at(tile.col + 1, tile.row),
        at(tile.col, tile.row - 1),
        at(tile.col, tile.row + 1),
      ]);
      let key = this.terrainTextures.get(signature);
      if (!key && this.terrainTextures.size < 1024) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = WEATHERED_TILE_SIZE;
        const ctx = canvas.getContext('2d');
        if (drawWeatheredTile(ctx, this.art, at, tile.col, tile.row, { biome: frame.biome })) {
          if (tile.label === 'Plain') softenGrassTexture(ctx, WEATHERED_TILE_SIZE);
          key = `${s.sys.settings.key}-terrain-${this.terrainTextures.size}`;
          s.textures.addCanvas(key, canvas);
          this.terrainTextures.set(signature, key);
        }
      }
      if (key) return s.add.image(x, y, key).setDisplaySize(TILE_SIZE, TILE_SIZE);
    }
    return tile.known
      ? createBattleTerrain(s, tile.label, x, y, frame.biome)
      : s.add.rectangle(x, y, TILE_SIZE, TILE_SIZE, tile.fog === 'unseen' ? 0x111722 : 0x38404a);
  }
  render(frame) {
    this.clear();
    const s = this.scene;
    for (const tile of frame.tiles) {
      const x = (tile.col + 0.5) * TILE_SIZE,
        y = (tile.row + 0.5) * TILE_SIZE;
      this.add(this.terrain(tile, frame, x, y));
      if (tile.details?.length && tile.fog === 'visible')
        this.add(
          presentationText(
            s,
            x,
            y + 8,
            tile.details.some((d) => d.startsWith('Ballista'))
              ? 'B'
              : tile.details.some((d) => d.startsWith('Village'))
                ? 'V'
                : '◇',
            { fontSize: '10px', color: UI_PALETTE.accentText, backgroundColor: '#152032' },
          ).setOrigin(0.5),
        );
      if (tile.fog !== 'visible')
        this.add(
          s.add.rectangle(x, y, TILE_SIZE, TILE_SIZE, 0x080c14, tile.fog === 'unseen' ? 0.5 : 0.35),
        );
    }
    for (const unit of frame.units) {
      const p = point(unit),
        color = FACTION_COLORS[unit.faction] || 0xaaaaaa;
      const group = this.add(s.add.container(p.x, p.y).setDepth(UI_DEPTHS.UNITS + unit.row / 100));
      const ring = s.add
        .ellipse(0, unit.size > 1 ? unit.size * 16 - 10 : 6, unit.size * 24, 12)
        .setStrokeStyle(2, color, 0.9);
      // an NPC person's verdigris texture is made at runtime: remake it after a reload
      ensureTracedTexture(s, unit.spriteKey);
      const graphic =
        unit.spriteKey && s.textures.exists(unit.spriteKey)
          ? s.add
              .image(0, 0, contrastSpriteKey(s, unit.spriteKey))
              .setDisplaySize(Math.min(128, unit.width || 30), Math.min(128, unit.height || 30))
          : s.add.rectangle(0, 0, unit.size * 26, unit.size * 26, color);
      if (unit.acted) graphic.setAlpha(0.55);
      const width = unit.size * TILE_SIZE - 6,
        y = (unit.size * TILE_SIZE) / 2 - 4;
      const ratio = Math.max(0, Math.min(1, unit.hp / unit.maxHP));
      const bg = s.add.rectangle(0, y, width, 3, 0x101010);
      const hp = s.add
        .rectangle(-width / 2, y, width * ratio, 3, ratio > 0.5 ? 0x77dd88 : UI_HEX.warn)
        .setOrigin(0, 0.5);
      group.add([ring, graphic, bg, hp]);
      if (!unit.spriteKey || !s.textures.exists(unit.spriteKey))
        group.add(
          presentationText(s, 0, 0, unit.name.slice(0, 1), {
            fontSize: '14px',
            color: UI_PALETTE.text,
          }).setOrigin(0.5),
        );
      if (unit.affixes?.length)
        group.add(
          presentationText(s, 12, -14, '◆', { fontSize: '10px', color: '#ddb7ff' }).setOrigin(0.5),
        );
      if (unit.buffs?.length)
        group.add(
          presentationText(s, -12, -14, '↑', {
            fontSize: '12px',
            color: UI_PALETTE.info,
          }).setOrigin(0.5),
        );
      if (unit.conditions.length)
        group.add(
          presentationText(s, 0, -18, unit.conditions.includes('sleep') ? 'Zzz' : '!', {
            fontSize: '12px',
            color: '#ffee99',
            backgroundColor: '#18202c',
          }).setOrigin(0.5),
        );
      this.units.set(unit.id, group);
    }
    this.frame = frame;
  }
  focus(frame, beats = [], from = null) {
    const ids = new Set(beats.flatMap((b) => [b.actorId, b.targetId]).filter(Boolean));
    const known = new Map([...(from?.units || []), ...frame.units].map((u) => [u.id, u]));
    const units = [...known.values()].filter((u) => ids.has(u.id));
    const targets = units.length
      ? units
      : frame.units.filter((u) => u.faction === 'player').slice(0, 1);
    if (!targets.length) {
      this.scene.cameras.main.centerOn(frame.cols * 16, frame.rows * 16);
      return;
    }
    let points = targets.map(point);
    const camera = this.scene.cameras.main;
    if (
      Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x)) >
        camera.width / camera.zoom - 64 ||
      Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y)) >
        camera.height / camera.zoom - 64
    ) {
      const affected = beats.map((b) => known.get(b.targetId)).find(Boolean);
      if (affected) points = [point(affected)];
    }
    this.scene.cameras.main.centerOn(
      points.reduce((n, p) => n + p.x, 0) / points.length,
      points.reduce((n, p) => n + p.y, 0) / points.length,
    );
  }
  show(
    frame,
    { from = null, beats = [], reverse = false, animate = false } = {},
    settled = () => {},
  ) {
    const generation = ++this.generation;
    this.timer?.remove(false);
    this.timer = null;
    this.render(animate && from ? from : frame);
    this.focus(frame, beats, from);
    if (!animate || !from) {
      const ids = new Set(beats.flatMap((b) => [b.actorId, b.targetId]).filter(Boolean));
      for (const unit of frame.units.filter((u) => ids.has(u.id))) {
        const p = point(unit);
        this.add(
          this.scene.add
            .rectangle(p.x, p.y, 30 * unit.size, 30 * unit.size)
            .setStrokeStyle(2, UI_HEX.accent)
            .setDepth(UI_DEPTHS.DAMAGE_NUMBERS),
        );
      }
      settled();
      return;
    }
    const duration = 420;
    const routes = new Map();
    for (const beat of beats.filter((b) => b.path?.length && b.actorId)) {
      const prior = routes.get(beat.actorId);
      if (!prior) routes.set(beat.actorId, { ...beat, path: [...beat.path] });
      else if (
        prior.path.at(-1)?.col === beat.path[0]?.col &&
        prior.path.at(-1)?.row === beat.path[0]?.row
      )
        prior.path.push(...beat.path.slice(1));
      else prior.path.push(null, ...beat.path);
    }
    for (const beat of routes.values()) {
      const group = this.units.get(beat.actorId);
      const source = from.units.find((u) => u.id === beat.actorId);
      const target = frame.units.find((u) => u.id === beat.actorId);
      if (!group || !source || !target || !beat.path?.length || beat.path.some((p) => !p)) continue;
      const path = reverse ? [...beat.path].reverse() : beat.path;
      // Only a verified recorded route can animate movement. Never interpolate
      // across an unknown segment or invent a route between snapshot endpoints.
      if (
        path[0].col !== source.col ||
        path[0].row !== source.row ||
        path.at(-1).col !== target.col ||
        path.at(-1).row !== target.row
      )
        continue;
      const step = (i) => {
        if (generation !== this.generation || i >= path.length) return;
        const p = point({ ...path[i], size: source.size });
        this.scene.tweens.add({
          targets: group,
          x: p.x,
          y: p.y,
          duration: duration / Math.max(1, path.length - 1),
          onComplete: () => step(i + 1),
        });
      };
      step(1);
    }
    const connections = new Set();
    for (const beat of beats) {
      if (
        !beat.actorId ||
        !beat.targetId ||
        beat.actorId === beat.targetId ||
        connections.size >= 8
      )
        continue;
      const key = `${beat.actorId}:${beat.targetId}`;
      if (connections.has(key)) continue;
      const source = beat.actorPosition,
        target = beat.targetPosition;
      if (!source || !target) continue;
      connections.add(key);
      const a = point(source),
        b = point(target);
      const line = this.add(
        this.scene.add
          .line(0, 0, a.x, a.y, b.x, b.y, beat.type === 'healed' ? 0x88ffaa : 0xffdd88, 0.8)
          .setOrigin(0, 0)
          .setLineWidth(2)
          .setDepth(UI_DEPTHS.DAMAGE_NUMBERS),
      );
      this.scene.tweens.add({ targets: line, alpha: 0, duration: 500 });
    }
    const ids = new Set(beats.flatMap((b) => [b.actorId, b.targetId]).filter(Boolean));
    for (const id of ids) {
      const unit = frame.units.find((u) => u.id === id) || from.units.find((u) => u.id === id);
      if (!unit) continue;
      const p = point(unit);
      const ring = this.add(
        this.scene.add
          .rectangle(p.x, p.y, 30 * unit.size, 30 * unit.size, UI_HEX.accent, 0.1)
          .setStrokeStyle(2, UI_HEX.accent)
          .setDepth(UI_DEPTHS.DAMAGE_NUMBERS),
      );
      this.scene.tweens.add({ targets: ring, alpha: 0, duration: 500 });
      const before = from.units.find((u) => u.id === id),
        after = frame.units.find((u) => u.id === id);
      if (before && after && before.hp !== after.hp) {
        this.add(
          presentationText(this.scene, p.x, p.y - 28, `${before.hp} → ${after.hp}`, {
            fontSize: '14px',
            color: UI_PALETTE.text,
            backgroundColor: '#172032',
          })
            .setOrigin(0.5)
            .setDepth(UI_DEPTHS.DAMAGE_NUMBERS),
        );
      }
    }
    for (const u of from.units)
      if (!frame.units.some((v) => v.id === u.id)) {
        const group = this.units.get(u.id);
        this.scene.tweens.add({ targets: group, alpha: 0, duration });
      }
    this.timer?.remove(false);
    this.timer = this.scene.time.delayedCall(520, () => {
      if (generation !== this.generation) return;
      this.render(frame);
      settled();
    });
  }
  cancel() {
    this.generation++;
    this.timer?.remove(false);
    this.timer = null;
    this.clear();
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.generation++;
    this.timer?.remove(false);
    this.clear();
    for (const key of this.terrainTextures.values()) this.scene.textures.remove(key);
    this.terrainTextures.clear();
  }
}
