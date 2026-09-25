// DOM portraits reuse the downloaded file (object URL) instead of re-encoding
// the decoded image with canvas.toDataURL, which blocked the main thread for
// 128-462 ms per 1254px portrait.

import { describe, it, expect, vi } from 'vitest';
import {
  retainPortraitDownloads,
  textureImageSource,
  isPortraitTextureKey,
} from '../src/ui/textureImageSource.js';

function fakeLoader() {
  const handlers = [];
  return { on: vi.fn((event, fn) => event === 'load' && handlers.push(fn)), handlers };
}

describe('textureImageSource', () => {
  it('serves a retained portrait download without re-encoding it', () => {
    const loader = fakeLoader();
    retainPortraitDownloads(loader);
    retainPortraitDownloads(loader); // idempotent per loader
    expect(loader.on).toHaveBeenCalledTimes(1);
    const blob = new Blob(['png-bytes'], { type: 'image/png' });
    loader.handlers[0]({
      type: 'image',
      key: 'rebuilt-portrait-lord_edric',
      xhrLoader: { response: blob },
    });
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:edric');
    const createElement = vi.fn();
    vi.stubGlobal('document', { createElement });
    const source = {};
    const texture = { key: 'rebuilt-portrait-lord_edric', getSourceImage: () => source };

    expect(textureImageSource(texture)).toBe('blob:edric');
    expect(textureImageSource(texture)).toBe('blob:edric');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(createElement).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    createObjectURL.mockRestore();
  });

  it('only retains portrait images', () => {
    expect(isPortraitTextureKey('portrait_lord_edric')).toBe(true);
    expect(isPortraitTextureKey('rebuilt-portrait-generic_mage')).toBe(true);
    expect(isPortraitTextureKey('rebuilt-lord_edric')).toBe(false);
    expect(isPortraitTextureKey('tileset')).toBe(false);
  });
});
