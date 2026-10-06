// A headless play session on disk (tools/play): play-sessions/<name>/.
//
//   session.json   the record: options, the command log with a digest per command,
//                  its revision and, for a derived session, where it came from
//   manifest.json  what made it: code commit, data fingerprint, adapter versions,
//                  the capabilities the adapter lacks, the agent's configuration
//   journal.jsonl  everything shown and done, one JSON object per line
//   diagnostics.jsonl  each battle command's events as they really were, fog or no
//                  fog: for analysis after a run, never for the agent playing it
//   session.lock   held while a call runs (one writer at a time; see acquireLock)
//
// The record is replaced atomically (a temporary file renamed over it), so a call
// killed mid-save leaves the previous record whole. Calls on one session queue on
// the lock rather than overwrite each other.

import * as nodeFs from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { hostname } from 'node:os';
import { join } from 'node:path';

export const RECORD_FILE = 'session.json';
export const MANIFEST_FILE = 'manifest.json';
export const JOURNAL_FILE = 'journal.jsonl';
export const LOCK_FILE = 'session.lock';
export const DIAGNOSTICS_FILE = 'diagnostics.jsonl';

/** The session is held by another call longer than we are willing to wait. */
export class SessionBusy extends Error {
  constructor(dir, holder) {
    super(
      `Session ${dir} is busy (held by ${holder ? `pid ${holder.pid} since ${holder.at}` : 'another call'}). Calls on one session run one at a time; try again when it finishes.`,
    );
    this.name = 'SessionBusy';
  }
}

/** The caller expected another revision (--expect-rev): someone else played in between. */
export class RevisionMismatch extends Error {
  constructor(expected, actual) {
    super(
      `Expected session revision ${expected}, but it is at ${actual}: another call changed it. Look again before you act.`,
    );
    this.name = 'RevisionMismatch';
  }
}

/** Writes `text` to `file` so that a reader sees the old file or the new one, never half. */
export function writeFileAtomic(file, text, fs = nodeFs) {
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, text);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // The temporary file was never made or is already gone; the first error matters.
    }
    throw err;
  }
}

export function readRecord(dir, fs = nodeFs) {
  return JSON.parse(fs.readFileSync(join(dir, RECORD_FILE), 'utf8'));
}

export function writeRecord(dir, record, fs = nodeFs) {
  fs.mkdirSync(dir, { recursive: true });
  writeFileAtomic(join(dir, RECORD_FILE), JSON.stringify(record, null, 1) + '\n', fs);
}

export function writeManifest(dir, manifest, fs = nodeFs) {
  fs.mkdirSync(dir, { recursive: true });
  writeFileAtomic(join(dir, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + '\n', fs);
}

export function readManifest(dir, fs = nodeFs) {
  const file = join(dir, MANIFEST_FILE);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

export function appendJournal(dir, entry, fs = nodeFs) {
  appendLine(dir, JOURNAL_FILE, entry, fs);
}

export function appendDiagnostics(dir, entry, fs = nodeFs) {
  appendLine(dir, DIAGNOSTICS_FILE, entry, fs);
}

function appendLine(dir, name, entry, fs) {
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(
    join(dir, name),
    JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n',
  );
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/** An unreadable lock or marker younger than this may still be being written. */
export const LOCK_GRACE_MS = 2000;

/**
 * What stands at `file` now: its identity (inode and change time, read through one
 * descriptor so they belong to the content read), its owner record (null when it is
 * unreadable) and its age. Null when nothing is there.
 */
function inspect(fs, file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  try {
    const st = fs.fstatSync(fd, { bigint: true });
    let holder = null;
    try {
      holder = JSON.parse(fs.readFileSync(fd, 'utf8'));
      // A record names its process (older adapters wrote no nonce).
      if (!holder || typeof holder !== 'object' || !Number.isInteger(holder.pid)) holder = null;
    } catch {
      holder = null;
    }
    return {
      identity: `${st.ino}-${st.mtimeNs}`,
      holder,
      ageMs: Date.now() - Number(st.mtimeNs / 1000000n),
    };
  } finally {
    fs.closeSync(fd);
  }
}

/** A lock (or marker) whose writer is gone: dead on this host, or unreadable and old. */
function abandoned(seen, host) {
  if (!seen) return false;
  if (!seen.holder) return seen.ageMs >= LOCK_GRACE_MS;
  return seen.holder.host === host && !alive(seen.holder.pid);
}

/**
 * Removes the abandoned lock `seen` if it still stands at `file`. Removal is claimed
 * with a marker named for that exact file: creating it is atomic, so of several
 * callers that saw the same abandoned lock one removes it, after looking again under
 * the claim (only a claimant may remove an abandoned lock, and nobody can replace it
 * while it stands, so the second look cannot be outdated). A marker left by a
 * claimant that died is passed by at the next level. Returns false only while
 * another caller holds the claim (wait for it); true when the lock was removed, or
 * is gone or changed already (look again now).
 */
function reclaim(fs, dir, file, seen, me) {
  for (let level = 0; level < 16; level++) {
    const marker = join(dir, `${LOCK_FILE}.reclaim-${seen.identity}${level ? `.${level}` : ''}`);
    try {
      fs.writeFileSync(marker, JSON.stringify(me), { flag: 'wx' });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (abandoned(inspect(fs, marker), me.host)) continue;
      return false; // another caller is removing it
    }
    try {
      const now = inspect(fs, file);
      if (now && now.identity === seen.identity) fs.unlinkSync(file);
      return true;
    } finally {
      try {
        fs.unlinkSync(marker);
      } catch {
        // Gone already: nothing to tidy.
      }
    }
  }
  return false;
}

/** Leftovers of callers that died: private lock files and removal markers. */
function tidy(fs, dir, host) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.startsWith(`${LOCK_FILE}.`)) continue;
    const path = join(dir, name);
    try {
      if (abandoned(inspect(fs, path), host)) fs.unlinkSync(path);
    } catch {
      // Taken by another caller's tidy, or not ours to judge: leave it.
    }
  }
}

/**
 * Takes the session's lock, waiting up to `waitMs` for another call to finish.
 * Returns release().
 *
 * The owner record is written to a private file first and hard-linked to
 * session.lock: link() fails when the lock exists, so one caller takes it, and the
 * lock never exists half-written. A lock left by a process that no longer runs on
 * this host, or an unreadable one older than LOCK_GRACE_MS (from a caller killed
 * while writing it under an older adapter), is reclaimed through `reclaim`. Release
 * removes the lock only while it still holds this caller's record.
 */
export function acquireLock(dir, { waitMs = 30000, fs = nodeFs, identity = null } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const file = join(dir, LOCK_FILE);
  const me = identity || {
    pid: process.pid,
    host: hostname(),
    at: new Date().toISOString(),
    nonce: randomBytes(8).toString('hex'),
  };
  const mine = join(dir, `${LOCK_FILE}.${me.nonce}.tmp`);
  fs.writeFileSync(mine, JSON.stringify(me));
  const deadline = Date.now() + waitMs;
  let holder;
  try {
    for (;;) {
      try {
        fs.linkSync(mine, file);
        break;
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
      }
      const seen = inspect(fs, file);
      if (!seen) continue; // released just now: try again
      holder = seen.holder;
      // Removed or changed: look again at once. Claimed by another: wait.
      if (abandoned(seen, me.host) && reclaim(fs, dir, file, seen, me)) continue;
      if (Date.now() >= deadline) throw new SessionBusy(dir, holder);
      sleepSync(50);
    }
  } finally {
    try {
      fs.unlinkSync(mine); // the lock, if taken, is another name for the same file
    } catch {
      // Already gone.
    }
  }
  tidy(fs, dir, me.host);
  return () => {
    try {
      const now = inspect(fs, file);
      if (now?.holder?.nonce === me.nonce) fs.unlinkSync(file);
    } catch {
      // Already released: nothing of ours to remove.
    }
  };
}

// --- provenance ---

export const ADAPTER_VERSION = 2;

/** SHA-256 (16 hex digits) of the game data as loaded: any data change shows here. */
export function dataFingerprint(gameData) {
  return createHash('sha256').update(JSON.stringify(gameData)).digest('hex').slice(0, 16);
}

/** The checked-out commit and whether game, data or adapter files differ from it. */
export function codeVersion(root) {
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    const commit = git('rev-parse', 'HEAD').trim();
    const dirty =
      git('status', '--porcelain', '--', 'src', 'data', 'tools/play', 'tests/harness', 'sim/lib')
        .trim()
        .split('\n')
        .filter(Boolean).length > 0;
    return { commit, dirty };
  } catch {
    return { commit: null, dirty: null };
  }
}
