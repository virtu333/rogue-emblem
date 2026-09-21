import { describe, expect, it, vi } from 'vitest';
import { installSeedSafeCanvasTextures } from '../src/utils/seedSafeCanvasTextures.js';
const uuid = '0ccae8a0-2884-402f-bac9-30a874a493f3';
function manager() {
  const list = new Map();
  return {
    list,
    exists: (key) => list.has(key),
    addCanvas: vi.fn(function (key, source, skipCache) {
      if (!skipCache && this.exists(key)) throw new Error('Duplicate texture');
      const texture = { key, source, destroy: () => list.delete(key) };
      if (!skipCache) list.set(key, texture);
      return texture;
    }),
  };
}
describe('seed-safe generated canvas textures', () => {
  it('retains both live textures across repeated UUIDs without consuming RNG', () => {
    const textures = manager();
    installSeedSafeCanvasTextures(textures);
    const random = vi.spyOn(Math, 'random');
    const first = textures.addCanvas(uuid, {});
    const second = textures.addCanvas(uuid, {});
    const third = textures.addCanvas(uuid, {});
    expect(new Set([first.key, second.key, third.key]).size).toBe(3);
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
    second.destroy();
    expect(textures.list.get(first.key)).toBe(first);
    expect(textures.list.get(third.key)).toBe(third);
    first.destroy();
    third.destroy();
    expect(textures.list.size).toBe(0);
  });
  it('keeps named asset duplicate errors and skip-cache semantics', () => {
    const textures = manager();
    installSeedSafeCanvasTextures(textures);
    textures.addCanvas('portrait', {});
    expect(() => textures.addCanvas('portrait', {})).toThrow('Duplicate texture');
    textures.addCanvas(uuid, {});
    expect(textures.addCanvas(uuid, {}, true).key).toBe(uuid);
    expect(textures.list.size).toBe(2);
  });
  it('installs once per manager and avoids existing suffixes', () => {
    const textures = manager();
    installSeedSafeCanvasTextures(textures);
    const wrapped = textures.addCanvas;
    installSeedSafeCanvasTextures(textures);
    expect(textures.addCanvas).toBe(wrapped);
    textures.addCanvas(uuid, {});
    textures.addCanvas(`${uuid}:text-1`, {});
    expect(textures.addCanvas(uuid, {}).key).toBe(`${uuid}:text-2`);
  });
});
