// PlaySession: a headless run an agent plays one command at a time (tools/play).
//
// A session is its options plus the log of the commands that changed the game. The
// state is never saved: it is rebuilt by replaying the log from the seed, so a
// session can be resumed in a new process, forked at any command, and audited. Each
// logged command carries a digest of the state after it; a replay that reaches a
// different state stops with an error rather than playing on in a different game.
//
// Commands are atomic: one that is refused (PlayError) or fails leaves the session
// exactly as it was (the game is rebuilt from the log when the failure may have
// touched it).

import { createHash } from 'node:crypto';
import { Game, normalizeOptions } from './game.js';
import { PlayError, tokenize } from './parse.js';

export const SESSION_FORMAT = 1;

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
  return createHash('sha256').update(JSON.stringify(game.digest())).digest('hex').slice(0, 16);
}

export class ReplayDivergence extends Error {
  constructor(index, cmd, expected, actual) {
    super(
      `Replay diverged at command ${index + 1} ("${cmd}"): logged state ${expected}, replayed ${actual}. The game code changed since this session was played; fork it before that command or start anew.`,
    );
    this.name = 'ReplayDivergence';
    this.index = index;
  }
}

export class PlaySession {
  constructor(gameData, options) {
    this.gameData = gameData;
    this.options = normalizeOptions(options);
    this.log = [];
    this.game = null;
    this.startLines = [];
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
  static async fromRecord(gameData, record, { upTo = null, verify = true } = {}) {
    if (record?.format !== SESSION_FORMAT)
      throw new Error(`Unsupported session format ${record?.format} (expected ${SESSION_FORMAT}).`);
    const session = new PlaySession(gameData, record.options);
    await session._fresh();
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
      session.log.push({ ...entry, digest });
    }
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
   * Run one command that changes the game. Returns { lines, view }. A refusal throws
   * a PlayError and changes nothing; so does any other failure (the game is rebuilt
   * from the log first).
   */
  async exec(line, { note = null } = {}) {
    const cmd = String(line).trim().replace(/\s+/g, ' ');
    if (!cmd) throw new PlayError('Empty command.');
    if (PlaySession.isQuery(cmd)) throw new PlayError(`"${cmd}" is a query: ask it with query().`);
    if (this.over) throw new PlayError('The run is over.');
    const before = digestOf(this.game);
    let lines;
    try {
      lines = await this.game.run(() => this.game.exec(cmd));
    } catch (err) {
      // A refusal is raised before anything moves; anything else may have moved
      // something the digest does not cover. Rebuild unless both say nothing changed.
      if (!(err instanceof PlayError) || digestOf(this.game) !== before) await this._rebuild();
      throw err;
    }
    const entry = { cmd, digest: digestOf(this.game) };
    if (note) entry.note = String(note);
    this.log.push(entry);
    return { lines, view: this.view() };
  }

  async _rebuild() {
    const replay = await PlaySession.fromRecord(this.gameData, this.toRecord());
    this.game = replay.game;
    this.log = replay.log;
  }

  toRecord() {
    return { format: SESSION_FORMAT, options: this.options, log: this.log.map((e) => ({ ...e })) };
  }

  digest() {
    return digestOf(this.game);
  }
}
