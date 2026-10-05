// A headless play session on disk (tools/play): play-sessions/<name>/.
//
//   session.json   the record: options, the command log with a digest per command,
//                  its revision and, for a derived session, where it came from
//   manifest.json  what made it: code commit, data fingerprint, adapter versions,
//                  the capabilities the adapter lacks, the agent's configuration
//   journal.jsonl  everything shown and done, one JSON object per line
//   diagnostics.jsonl  each battle command's events as they really were, fog or no
//                  fog: for analysis after a run, never for the agent playing it
//   session.lock   held while a call runs (one writer at a time)
//
// The record is replaced atomically (a temporary file renamed over it), so a call
// killed mid-save leaves the previous record whole. Calls on one session queue on
// the lock rather than overwrite each other.

import * as nodeFs from 'node:fs';
import { createHash } from 'node:crypto';
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

/**
 * Takes the session's lock, waiting up to `waitMs` for another call to finish. A lock
 * left by a process that no longer runs on this host is taken over. Returns release().
 */
export function acquireLock(dir, { waitMs = 30000, fs = nodeFs } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const file = join(dir, LOCK_FILE);
  const me = { pid: process.pid, host: hostname(), at: new Date().toISOString() };
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      const fd = fs.openSync(file, 'wx');
      fs.writeSync(fd, JSON.stringify(me));
      fs.closeSync(fd);
      return () => {
        try {
          const holder = JSON.parse(fs.readFileSync(file, 'utf8'));
          if (holder.pid === me.pid && holder.at === me.at) fs.unlinkSync(file);
        } catch {
          // Already released (or taken over as stale): nothing of ours to remove.
        }
      };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    let holder = null;
    try {
      holder = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      // Being written or removed right now: look again.
    }
    if (holder && holder.host === me.host && !alive(holder.pid)) {
      try {
        fs.unlinkSync(file);
      } catch {
        // Someone else took it over first.
      }
      continue;
    }
    if (Date.now() >= deadline) throw new SessionBusy(dir, holder);
    sleepSync(50);
  }
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
