import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isLikelyStaleChunkError, tryStaleChunkReload } from '../src/utils/sceneLoader.js';

describe('isLikelyStaleChunkError', () => {
  it('returns true for TypeError with dynamic import message', () => {
    expect(
      isLikelyStaleChunkError(new TypeError('Failed to fetch dynamically imported module')),
    ).toBe(true);
  });

  it('returns true for SyntaxError with unexpected token (HTML served as JS)', () => {
    expect(isLikelyStaleChunkError(new SyntaxError('Unexpected token <'))).toBe(true);
  });

  it('returns true for message containing "loading chunk"', () => {
    expect(isLikelyStaleChunkError(new Error('Loading chunk 42 failed'))).toBe(true);
  });

  it('returns true for message containing "failed to load module"', () => {
    expect(isLikelyStaleChunkError(new Error('Failed to load module script'))).toBe(true);
  });

  it('returns true for message containing "mime type"', () => {
    expect(isLikelyStaleChunkError(new Error('MIME type mismatch'))).toBe(true);
  });

  it('returns false for "failed to load" without "module" (too broad)', () => {
    expect(isLikelyStaleChunkError(new Error('failed to load config'))).toBe(false);
  });

  it('returns false for "chunk" without "loading" prefix (too broad)', () => {
    expect(isLikelyStaleChunkError(new Error('invalid chunk encoding'))).toBe(false);
  });

  it('returns false for "MIME" without "type" suffix (too broad)', () => {
    expect(isLikelyStaleChunkError(new Error('MIME actor timed out'))).toBe(false);
  });

  it('returns true for message containing "failed to fetch"', () => {
    expect(isLikelyStaleChunkError(new Error('Failed to fetch'))).toBe(true);
  });

  it('returns false for generic TypeError without matching message', () => {
    expect(isLikelyStaleChunkError(new TypeError('Cannot read properties of undefined'))).toBe(
      false,
    );
  });

  it('returns false for generic SyntaxError without unexpected token', () => {
    expect(isLikelyStaleChunkError(new SyntaxError('missing ) after argument list'))).toBe(false);
  });

  it('returns false for generic Error without matching message', () => {
    expect(isLikelyStaleChunkError(new Error('Something unrelated happened'))).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isLikelyStaleChunkError(null)).toBe(false);
    expect(isLikelyStaleChunkError(undefined)).toBe(false);
  });
});

describe('tryStaleChunkReload', () => {
  let originalSessionStorage;
  let originalLocation;
  let mockStorage;

  beforeEach(() => {
    mockStorage = {};
    originalSessionStorage = globalThis.sessionStorage;
    originalLocation = globalThis.location;

    Object.defineProperty(globalThis, 'sessionStorage', {
      value: {
        getItem: vi.fn((key) => mockStorage[key] ?? null),
        setItem: vi.fn((key, val) => {
          mockStorage[key] = val;
        }),
        removeItem: vi.fn((key) => {
          delete mockStorage[key];
        }),
      },
      configurable: true,
      writable: true,
    });

    Object.defineProperty(globalThis, 'location', {
      value: { reload: vi.fn() },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: originalSessionStorage,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'location', {
      value: originalLocation,
      configurable: true,
      writable: true,
    });
  });

  it('returns false for non-stale-chunk errors', () => {
    expect(tryStaleChunkReload(new Error('unrelated'))).toBe(false);
    expect(globalThis.location.reload).not.toHaveBeenCalled();
  });

  it('triggers reload on first stale chunk error and stores count', () => {
    const result = tryStaleChunkReload(
      new TypeError('Failed to fetch dynamically imported module'),
    );
    expect(result).toBe(true);
    expect(globalThis.sessionStorage.setItem).toHaveBeenCalledWith('__er_chunk_reload', '1');
    expect(globalThis.location.reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload if already reloaded once this session', () => {
    mockStorage['__er_chunk_reload'] = '1';

    const result = tryStaleChunkReload(
      new TypeError('Failed to fetch dynamically imported module'),
    );
    expect(result).toBe(false);
    expect(globalThis.location.reload).not.toHaveBeenCalled();
  });

  it('does not reload on second stale error even after delay', () => {
    // First reload happened
    mockStorage['__er_chunk_reload'] = '1';

    // Even with time passing, count-based guard prevents reload
    const result = tryStaleChunkReload(new Error('Loading chunk 42 failed'));
    expect(result).toBe(false);
    expect(globalThis.location.reload).not.toHaveBeenCalled();
  });

  it('returns false when location.reload is unavailable', () => {
    Object.defineProperty(globalThis, 'location', {
      value: {},
      configurable: true,
      writable: true,
    });

    const result = tryStaleChunkReload(
      new TypeError('Failed to fetch dynamically imported module'),
    );
    expect(result).toBe(false);
    expect(globalThis.sessionStorage.setItem).not.toHaveBeenCalled();
  });

  it('returns false when sessionStorage.setItem is missing (partial impl)', () => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: {
        getItem: vi.fn(() => null),
        // setItem intentionally missing
      },
      configurable: true,
      writable: true,
    });

    const result = tryStaleChunkReload(
      new TypeError('Failed to fetch dynamically imported module'),
    );
    expect(result).toBe(false);
    expect(globalThis.location.reload).not.toHaveBeenCalled();
  });

  it('returns false if sessionStorage throws', () => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: {
        getItem: () => {
          throw new Error('SecurityError');
        },
        setItem: () => {
          throw new Error('SecurityError');
        },
        removeItem: () => {
          throw new Error('SecurityError');
        },
      },
      configurable: true,
      writable: true,
    });

    const result = tryStaleChunkReload(
      new TypeError('Failed to fetch dynamically imported module'),
    );
    expect(result).toBe(false);
  });
});
