// PlaySession: a headless run an agent plays one command at a time (tools/play).
//
// A session is its options plus the log of the commands that changed the game. The
// state is never saved: it is rebuilt by replaying the log from the seed, so a
// session can be resumed in a new process, forked at any command, and audited. Each
// logged command carries a digest of the state after it; a replay that reaches a
// different state stops with an error rather than playing on in a different game.
//
// The digest covers the whole game state (snapshot.js), so a replay that differs
// anywhere a later command could notice is caught at the command that caused it.
//
// Commands are atomic: one that is refused (PlayError) or fails leaves the session
// exactly as it was; the log only ever holds commands that completed. A refusal can
// come after a command has begun to change things, so the whole-state digest is
// taken before each command: a refusal that left it different, or any other failure,
// rebuilds the game from the log.

import { Game, normalizeOptions } from './game.js';
import { PlayError, tokenize } from './parse.js';
import { SNAPSHOT_VERSION, snapshotDigest } from './snapshot.js';

/** 2: digests are canonical snapshots (snapshot.js) and the record carries their version. */
export const SESSION_FORMAT = 2;
const READABLE_FORMATS = new Set([1, 2]);

/** Commands that only read the game (never logged, never change state). */
const QUERY_VERBS = new Set([
  'look',
  'help',
  'roster',
  'map',
  'options',
  'forecast',
  'threat',
  'unit',
  '',
]);

export function digestOf(game) {
  return snapshotDigest(game);
}

/** The snapshot version a record's digests were made with (format 1 had no field: 1). */
export function digestVersionOf(record) {
  return Number.isInteger(record?.digestVersion) ? record.digestVersion : 1;
}

export class ReplayDivergence extends Error {
  constructor(index, cmd, expected, actual) {
    super(
      `Replay diverged at command ${index + 1} ("${cmd}"): logged state ${expected}, replayed ${actual}. The game or adapter changed since this session was played. Fork it before that command ("fork NEW --at ${index}"), or derive a re-stamped copy ("rebase NEW") to keep playing; the original stays as it was.`,
    );
    this.name = 'ReplayDivergence';
    this.index = index;
  }
}

/** The record's digests were made by another snapshot version: none of them can match. */
export class DigestVersionMismatch extends Error {
  constructor(recorded) {
    super(
      `This session's digests were made by snapshot version ${recorded}; the adapter now makes version ${SNAPSHOT_VERSION}, so none can be checked. Derive a re-stamped copy with "rebase NEW" (the original stays as it was).`,
    );
    this.name = 'DigestVersionMismatch';
    this.recorded = recorded;
  }
}

export class PlaySession {
  constructor(gameData, options) {
    this.gameData = gameData;
    this.options = normalizeOptions(options);
    this.log = [];
    this.game = null;
    this.startLines = [];
    /** Counts committed commands over the session's life (the record's revision). */
    this.revision = 0;
    /** Where a derived session came from (rebase), carried in its record. */
    this.provenance = null;
  }

  /** A new session at the start of its run. */
  static async create(gameData, options = {}) {
    const session = new PlaySession(gameData, options);
    await session._fresh();
    return session;
  }

  /**
   * Rebuild a session from its record. `upTo` replays only the first n commands (a
   * fork); `verify` (default) checks each command's logged digest.
   */
  static async fromRecord(gameData, record, { upTo = null, verify = true, onEntry = null } = {}) {
    if (!READABLE_FORMATS.has(record?.format))
      throw new Error(`Unsupported session format ${record?.format} (expected ${SESSION_FORMAT}).`);
    if (verify && digestVersionOf(record) !== SNAPSHOT_VERSION && record.log.length)
      throw new DigestVersionMismatch(digestVersionOf(record));
    const session = new PlaySession(gameData, record.options);
    await session._fresh();
    session.revision = Number.isInteger(record.revision) ? record.revision : record.log.length;
    session.provenance = record.provenance ?? null;
    const entries = upTo == null ? record.log : record.log.slice(0, upTo);
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      try {
        await session.game.run(() => session.game.exec(entry.cmd));
      } catch (err) {
        throw new Error(`Replay failed at command ${i + 1} ("${entry.cmd}"): ${err.message}`, {
          cause: err,
        });
      }
      const digest = digestOf(session.game);
      if (verify && entry.digest && entry.digest !== digest)
        throw new ReplayDivergence(i, entry.cmd, entry.digest, digest);
      onEntry?.(i, entry, digest);
      session.log.push({ ...entry, digest });
    }
    return session;
  }

  /**
   * A re-stamped copy of a record: its commands replayed without checking their
   * digests, each stamped with the digest it reaches now. The source is never
   * changed; the copy's provenance says where it came from and which commands no
   * longer reach the state they reached when they were played.
   */
  static async rebase(gameData, record, { from = null } = {}) {
    const changed = [];
    const session = await PlaySession.fromRecord(gameData, record, {
      verify: false,
      onEntry: (i, entry, digest) => {
        if (entry.digest !== digest) changed.push(i + 1);
      },
    });
    const sameVersion = digestVersionOf(record) === SNAPSHOT_VERSION;
    session.revision = 0;
    session.provenance = {
      rebasedFrom: from,
      sourceRevision: Number.isInteger(record.revision) ? record.revision : record.log.length,
      sourceProvenance: record.provenance ?? null,
      commands: record.log.length,
      digestVersionFrom: digestVersionOf(record),
      digestVersionTo: SNAPSHOT_VERSION,
      // Across snapshot versions every digest differs, so none says where play changed.
      changed: sameVersion ? changed : [],
    };
    return session;
  }

  async _fresh() {
    this.game = new Game(this.gameData, this.options);
    this.startLines = await this.game.run(() => this.game.start());
  }

  get phase() {
    return this.game.phase;
  }

  get over() {
    return this.game.phase === 'ended';
  }

  /** The current observation. */
  view() {
    return this.game.peek(() => this.game.view());
  }

  /** True when `line` only reads the game. */
  static isQuery(line) {
    return QUERY_VERBS.has((tokenize(line)[0] || '').toLowerCase());
  }

  /** Answer a read-only command (look, help, roster, options, forecast, threat, unit). */
  async query(line) {
    const text = this.game.peek(() => this.game.query(line));
    if (text == null)
      throw new PlayError(`"${line}" is not something to look at here. Try "help".`);
    return text;
  }

  /**
   * Run one command that changes the game. Returns { lines, entry, diagnostics }: the
   * command's report as the player sees it, its log entry, and (for a battle command)
   * the same events told omnisciently, for diagnostics only. The command is committed (logged) when this returns;
   * the view is a separate observation (`view()`), so a failure to render it never
   * undoes or hides a committed command. A refusal throws a PlayError and changes
   * nothing; so does any other failure (the game is rebuilt from the log when the
   * failure was not a refusal, or the refusal came after something changed).
   */
  async exec(line, { note = null, call = null } = {}) {
    const cmd = String(line).trim().replace(/\s+/g, ' ');
    if (!cmd) throw new PlayError('Empty command.');
    if (PlaySession.isQuery(cmd)) throw new PlayError(`"${cmd}" is a query: ask it with query().`);
    if (this.over) throw new PlayError('The run is over.');
    const before = digestOf(this.game);
    let lines;
    let digest;
    try {
      lines = await this.game.run(() => this.game.exec(cmd));
      digest = digestOf(this.game);
    } catch (err) {
      if (!(err instanceof PlayError) || digestOf(this.game) !== before) await this._rebuild();
      throw err;
    }
    const entry = { cmd, digest };
    if (note) entry.note = String(note);
    if (call) entry.call = String(call);
    this.log.push(entry);
    this.revision++;
    return { lines, entry, diagnostics: this.game.diagnostics ?? null };
  }

  async _rebuild() {
    const replay = await PlaySession.fromRecord(this.gameData, this.toRecord());
    this.game = replay.game;
    this.log = replay.log;
  }

  toRecord() {
    const record = {
      format: SESSION_FORMAT,
      digestVersion: SNAPSHOT_VERSION,
      revision: this.revision,
      options: this.options,
      log: this.log.map((e) => ({ ...e })),
    };
    if (this.provenance) record.provenance = this.provenance;
    return record;
  }

  digest() {
    return digestOf(this.game);
  }
}
