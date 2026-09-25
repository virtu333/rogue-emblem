import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeDom } from './helpers/fakeDom.js';
import { projectedSpriteUnit, spriteElement, unitSpriteImage } from '../src/ui/growthSprites.js';

let dom;
let drawn;
beforeEach(() => {
  dom = installFakeDom(vi);
  drawn = [];
  const create = dom.doc.createElement.bind(dom.doc);
  dom.doc.createElement = (tag) => {
    const node = create(tag);
    if (tag === 'canvas') {
      node.getContext = () => ({ drawImage: (...args) => drawn.push(args) });
      node.toDataURL = () => `data:image/png;base64,${node.width}x${node.height}`;
    }
    return node;
  };
});
afterEach(() => vi.unstubAllGlobals());

function sceneWith(textures) {
  return {
    textures: {
      exists: (key) => key in textures,
      get: (key) => textures[key],
    },
  };
}

function texture(frames) {
  const source = { width: 576, height: 96 };
  return {
    has: (name) => name in frames,
    getFrameNames: () => Object.keys(frames),
    getSourceImage: () => source,
    get: (name) => ({ ...frames[name || '__BASE'], source: { image: source } }),
  };
}

describe('growth sprites (the map sprite as a DOM image)', () => {
  it('uses the battlefield lookup and the first idle frame of a traced strip', () => {
    // Without rebuilt/traced art the class sprite key is the lowercased class.
    const scene = sceneWith({
      swordmaster: texture({ idle0: { cutX: 96, cutY: 0, cutWidth: 96, cutHeight: 96 } }),
    });
    const unit = projectedSpriteUnit({ name: 'Ilse', faction: 'player' }, 'Swordmaster');
    expect(unit).toMatchObject({ className: 'Swordmaster', tier: 'promoted', faction: 'player' });
    const image = unitSpriteImage(scene, unit);
    expect(image).toMatchObject({ key: 'swordmaster', width: 96, height: 96 });
    expect(drawn[0].slice(1, 5)).toEqual([96, 0, 96, 96]);
    // Cached per texture/frame.
    unitSpriteImage(scene, unit);
    expect(drawn).toHaveLength(1);
    const img = spriteElement(image, 'gr-sprite--to');
    expect(img.className).toBe('gr-sprite gr-sprite--to');
    expect(img.getAttribute('aria-hidden')).toBe('true');
  });

  it('a missing texture drops the sprite cleanly', () => {
    expect(unitSpriteImage(sceneWith({}), { className: 'Paladin', faction: 'player' })).toBeNull();
    expect(unitSpriteImage(null, { className: 'Paladin' })).toBeNull();
    expect(spriteElement(null)).toBeNull();
  });

  it('projections never carry enemy affixes or foreign factions', () => {
    const enemy = projectedSpriteUnit({ name: 'X', faction: 'enemy', affixes: ['a'] }, 'Hero');
    expect(enemy.affixes).toEqual([]);
    expect(projectedSpriteUnit({ faction: 'npc' }, 'Hero').faction).toBe('npc');
    expect(projectedSpriteUnit({}, 'Hero').faction).toBe('player');
  });
});
