// The headless play session lock (tools/play/store.js acquireLock): one writer at a
// time, a dead writer's lock reclaimed, and never a live lock removed on the strength
// of an observation that has gone stale. Interleavings are driven through the `fs`
// seam: one caller's step runs another caller to completion at the exact point a race
// would need.

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, utimesSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOCK_FILE, LOCK_GRACE_MS, SessionBusy, acquireLock } from '../../tools/play/store.js';

const DEAD_PID = 2 ** 22 + 12345; // above Linux's pid_max: never a live process
const lockOf = (dir) => JSON.parse(readFileSync(join(dir, LOCK_FILE), 'utf8'));
const identity = (dir) => {
  const st = fs.statSync(join(dir, LOCK_FILE), { bigint: true });
  return `${st.ino}-${st.mtimeNs}`;
};
const dead = () => ({ pid: DEAD_PID, host: hostname(), at: 'then', nonce: 'dead' });

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'play-lock-'));
});

describe('session lock', () => {
  it('a caller whose sight of a dead lock went stale never removes the lock that replaced it', () => {
    writeFileSync(join(dir, LOCK_FILE), JSON.stringify(dead()));
    let other = null;
    // A saw the dead lock; before it acts on that, B reclaims it and takes the lock.
    const racing = {
      ...fs,
      writeFileSync: (path, ...rest) => {
        if (!other && String(path).includes('.reclaim-')) other = acquireLock(dir);
        return fs.writeFileSync(path, ...rest);
      },
    };
    const b = () => lockOf(dir);
    expect(() => acquireLock(dir, { fs: racing, waitMs: 150 })).toThrow(SessionBusy);
    expect(other).not.toBeNull();
    const held = b();
    expect(held.pid).toBe(process.pid);
    // The lock standing is B's, and B can still release it.
    other();
    expect(existsSync(join(dir, LOCK_FILE))).toBe(false);
    expect(held.nonce).not.toBe('dead');
  });

  it('two callers that saw the same dead lock: only one may remove it', () => {
    writeFileSync(join(dir, LOCK_FILE), JSON.stringify(dead()));
    const file = join(dir, LOCK_FILE);
    let looks = 0;
    let other = 'not run';
    // A looks at the lock a second time (its check before removing). Right then, B,
    // which saw the same dead lock, tries to reclaim it too.
    const racing = {
      ...fs,
      openSync: (path, flags, ...rest) => {
        if (path === file && flags === 'r' && ++looks === 2) {
          try {
            other = acquireLock(dir, { waitMs: 100 });
          } catch (err) {
            other = err;
          }
        }
        return fs.openSync(path, flags, ...rest);
      },
    };
    const release = acquireLock(dir, { fs: racing, waitMs: 100 });
    // B could not remove the lock while A's claim stood, so it never held it.
    expect(other).toBeInstanceOf(SessionBusy);
    expect(lockOf(dir).pid).toBe(process.pid);
    release();
    expect(existsSync(file)).toBe(false);
  });

  it('takes over a lock left empty by a caller killed while writing it, once it is old', () => {
    const file = join(dir, LOCK_FILE);
    writeFileSync(file, '');
    // Fresh: it may still be being written, so the caller waits.
    expect(() => acquireLock(dir, { waitMs: 100 })).toThrow(SessionBusy);
    const old = (Date.now() - LOCK_GRACE_MS - 1000) / 1000;
    utimesSync(file, old, old);
    const release = acquireLock(dir, { waitMs: 100 });
    expect(lockOf(dir).pid).toBe(process.pid);
    release();
  });

  it('passes a removal claimed by a caller that died, and tidies what dead callers left', () => {
    writeFileSync(join(dir, LOCK_FILE), JSON.stringify(dead()));
    // A claimant died holding the claim on this very lock file, and another died
    // between writing its record and linking it.
    writeFileSync(join(dir, `${LOCK_FILE}.reclaim-${identity(dir)}`), JSON.stringify(dead()));
    writeFileSync(join(dir, `${LOCK_FILE}.dead.tmp`), JSON.stringify(dead()));
    const release = acquireLock(dir, { waitMs: 100 });
    expect(lockOf(dir).pid).toBe(process.pid);
    expect(fs.readdirSync(dir).sort()).toEqual([LOCK_FILE]);
    release();
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('a live holder keeps its lock; a release removes only its own', () => {
    const first = acquireLock(dir);
    expect(() => acquireLock(dir, { waitMs: 100 })).toThrow(SessionBusy);
    const mine = lockOf(dir);
    first();
    const second = acquireLock(dir);
    first(); // a second release of the first lock must not free the second
    expect(lockOf(dir).nonce).not.toBe(mine.nonce);
    expect(existsSync(join(dir, LOCK_FILE))).toBe(true);
    second();
  });
});
