import { describe, it, expect } from 'vitest';
import { deploymentFrame } from '../src/utils/deploymentCamera.js';
const options = { width: 600, height: 480, tileSize: 32, cssHeight: 375, minZoom: 0.8, maxZoom: 3 };
describe('deployment camera composition', () => {
  it('frames both ends of a compact deployment with breathing room', () => {
    const points = [
      { x: 64, y: 64 },
      { x: 128, y: 256 },
    ];
    const f = deploymentFrame(points, options);
    expect(f.wholeParty).toBe(true);
    for (const p of points) {
      expect(Math.abs(p.x - f.x) + 64).toBeLessThanOrEqual(options.width / f.zoom / 2);
      expect(Math.abs(p.y - f.y) + 64).toBeLessThanOrEqual(options.height / f.zoom / 2);
    }
    expect((f.zoom * 32 * 375) / 480).toBeGreaterThanOrEqual(30);
  });
  it('keeps a dispersed deployment readable and prioritizes its leader', () => {
    const f = deploymentFrame(
      [
        { x: 32, y: 32 },
        { x: 544, y: 384 },
      ],
      options,
    );
    expect(f).toMatchObject({ x: 32, y: 32, wholeParty: false });
    expect((f.zoom * 32 * 375) / 480).toBeCloseTo(34);
  });
  it('handles no surviving allies and respects zoom limits', () => {
    expect(deploymentFrame([], options)).toBeNull();
    expect(deploymentFrame([{ x: 0, y: 0 }], { ...options, minZoom: 2, maxZoom: 2 }).zoom).toBe(2);
  });
});
