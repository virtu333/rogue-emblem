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
import { AmbiguousItem, EndAfterTurnEnded, PlayError, tokenize } from './parse.js';
import { SNAPSHOT_VERSION, snapshotDigest } from './snapshot.js';
import { observe } from './observe.js';
import { HEADLESS_STATES } from '../../tests/harness/HeadlessBattle.js';
import { DEFAULT_TIMELINE_LIMITS } from '../../src/engine/BattleTimeline.js';
import { rewindGranularityForRun } from '../../src/engine/RewindDestinations.js';

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
  'rewinds',
  '',
]);

const isRewind = (cmd) => /^rewind(\s|$)/i.test(String(cmd).trim());

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
    /**
     * For each logged command, the battle moment it left (a Vision destination), or
     * null: rebuilt with the log, never saved.
     */
    this.points = [];
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
  static async fromRecord(
    gameData,
    record,
    { upTo = null, verify = true, onEntry = null, adapt = null, rewrite = null } = {},
  ) {
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
      // A rebase may need commands the old rules never asked for (adapt).
      for (const extra of adapt?.(session, entry) || []) {
        await session.game.run(() => session.game.exec(extra));
        session.log.push({ cmd: extra, digest: digestOf(session.game), inserted: true });
        session.points.push(session._momentNow());
      }
      let played = entry;
      try {
        if (isRewind(entry.cmd)) await session._rewind(entry.cmd);
        else {
          const before = rewrite ? digestOf(session.game) : null;
          try {
            await session.game.run(() => session.game.exec(entry.cmd));
          } catch (err) {
            // A rebase may restate a command the current rules read differently.
            const cmd = rewrite?.(session, entry, err);
            if (!cmd || digestOf(session.game) !== before) throw err;
            await session.game.run(() => session.game.exec(cmd));
            played = { ...entry, cmd, rewrittenFrom: entry.cmd };
          }
        }
      } catch (err) {
        throw new Error(`Replay failed at command ${i + 1} ("${entry.cmd}"): ${err.message}`, {
          cause: err,
        });
      }
      const digest = digestOf(session.game);
      if (verify && entry.digest && entry.digest !== digest)
        throw new ReplayDivergence(i, entry.cmd, entry.digest, digest);
      onEntry?.(i, entry, digest, session);
      session.log.push({ ...played, digest });
      session.points.push(session._momentNow());
    }
    return session;
  }

  /**
   * A re-stamped copy of a record: its commands replayed without checking their
   * digests, each stamped with the digest it reaches now. The source is never
   * changed; the copy's provenance says where it came from and which commands no
   * longer reach the state they reached when they were played.
   */
  static async rebase(gameData, record, { from = null, adapt = false } = {}) {
    const changed = [];
    const inserted = [];
    const rewritten = [];
    const session = await PlaySession.fromRecord(gameData, record, {
      verify: false,
      onEntry: (i, entry, digest) => {
        if (entry.digest !== digest) changed.push(i + 1);
      },
      // --adapt: a unit that may now move on after acting (Canto, Measured Step, which
      // older sessions never had) stays where it acted, as the old rules left it.
      adapt: adapt
        ? (s, entry) => {
            const b = s.game.phase === 'battle' ? s.game.battle?.battle : null;
            if (b?.battleState !== HEADLESS_STATES.CANTO_MOVING) return [];
            if (/^(canto|end)\b/i.test(entry.cmd)) return [];
            inserted.push({
              before: s.log.length + 1,
              sourceCommand: entry.cmd,
              cmd: 'canto stay',
            });
            return ['canto stay'];
          }
        : null,
      // --adapt: a name that once took the first of several different items now
      // names that one by its #number, as the old rule read it.
      // An "end" played when "end" always ended the turn is an "end again" now.
      rewrite: adapt
        ? (s, entry, err) => {
            if (err instanceof EndAfterTurnEnded && /^end$/i.test(entry.cmd.trim())) {
              rewritten.push({ at: s.log.length + 1, from: entry.cmd, to: 'end again' });
              return 'end again';
            }
            if (!(err instanceof AmbiguousItem)) return null;
            const at = entry.cmd.toLowerCase().lastIndexOf(err.token.toLowerCase());
            if (at < 0) return null;
            const cmd = `${entry.cmd.slice(0, at)}#${err.choice}${entry.cmd.slice(at + err.token.length)}`;
            rewritten.push({ at: s.log.length + 1, from: entry.cmd, to: cmd });
            return cmd;
          }
        : null,
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
      // Commands an adapting rebase added (each before the source command it names),
      // and the ones it restated.
      inserted,
      rewritten,
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

  /** The current observation as data (observe.js), read in the sandbox. */
  observe() {
    return this.game.peek(() => observe(this));
  }

  /** True when `line` only reads the game. */
  static isQuery(line) {
    return QUERY_VERBS.has((tokenize(line)[0] || '').toLowerCase());
  }

  /** Answer a read-only command (look, help, roster, options, forecast, threat, unit). */
  async query(line) {
    if ((tokenize(line)[0] || '').toLowerCase() === 'rewinds') return this._rewindsText();
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
    if (this.broken)
      throw new Error('A fault left this session unrestored in memory; load it again from disk.');
    const before = digestOf(this.game);
    let lines;
    let digest;
    try {
      lines = isRewind(cmd)
        ? await this._rewind(cmd)
        : await this.game.run(() => this.game.exec(cmd));
      digest = digestOf(this.game);
    } catch (err) {
      // What a failure leaves: the game as it was (checked against the digest taken
      // before), or, when even the rebuild fails, a session that must not be used.
      let rollback = 'unchanged';
      if (!(err instanceof PlayError) || digestOf(this.game) !== before) {
        try {
          await this._rebuild();
          rollback = digestOf(this.game) === before ? 'verified' : 'failed';
        } catch (rebuildErr) {
          rollback = 'failed';
          err.rebuildError = rebuildErr;
        }
      }
      if (rollback === 'failed') this.broken = true;
      if (err && typeof err === 'object') err.rollback = rollback;
      throw err;
    }
    const entry = { cmd, digest };
    if (note) entry.note = String(note);
    if (call) entry.call = String(call);
    this.log.push(entry);
    this.points.push(this._momentNow());
    this.revision++;
    return { lines, entry, diagnostics: this.game.diagnostics ?? null };
  }

  async _rebuild() {
    const replay = await PlaySession.fromRecord(this.gameData, this.toRecord());
    this.game = replay.game;
    this.log = replay.log;
    this.points = replay.points;
  }

  // --- Vision rewinds ---

  /**
   * The battle moment the game is at, if it is one a Vision could return to later:
   * the player's phase, no unit mid-order (BattleCheckpointAdapter's 'destination').
   */
  _momentNow() {
    const g = this.game;
    if (g.phase !== 'battle' || !g.battle || g.battle.formation) return null;
    const b = g.battle.battle;
    if (b.result || b.battleState !== HEADLESS_STATES.PLAYER_IDLE) return null;
    if (b.turnManager?.currentPhase !== 'player') return null;
    return {
      battle: `${g.battle.node.id}:${g.rm.completedBattles}`,
      turn: b.turnManager.turnNumber,
      turnStart: b.playerUnits.every((u) => !u.hasActed && !u.hasMoved && !u._movementCommitted),
      // Every unit has acted: enemies move next, and under the fixed random rule a
      // return here would only replay the same enemy phase (RewindDestinations).
      enemiesActNext: b.playerUnits.every((u) => u.hasActed),
    };
  }

  /** The moments of this battle a Vision can return to now, newest first, with why not. */
  rewindDestinations() {
    const g = this.game;
    if ((g.phase !== 'battle' && g.phase !== 'fatal') || !g.battle) return [];
    const battle = `${g.battle.node.id}:${g.rm.completedBattles}`;
    const turn = g.battle.battle.turnManager.turnNumber;
    const granularity = rewindGranularityForRun(g.rm);
    const live = this.points.length;
    const rows = [];
    for (let k = 1; k <= this.points.length; k++) {
      const p = this.points[k - 1];
      if (!p || p.battle !== battle || k === live || p.enemiesActNext) continue;
      let reason = '';
      if (p.turn < turn - DEFAULT_TIMELINE_LIMITS.previousTurns)
        reason = 'Too far back. This moment is no longer stored.';
      else if (granularity === 'turn' && !p.turnStart)
        reason = 'Turn starts only on this difficulty.';
      rows.push({
        at: k,
        turn: p.turn,
        turnStart: p.turnStart,
        before: this.log[k]?.cmd || null,
        reason,
      });
    }
    return rows.reverse();
  }

  _rewindsText() {
    const g = this.game;
    const rows = this.rewindDestinations();
    const charges = g.rm?.visionChargesRemaining || 0;
    if (!rows.length)
      return `No moment of this battle to return to. (${charges} Vision charge(s) left.)`;
    return [
      `Vision: return to a moment of this battle (${charges} charge(s) left; one per rewind). The rolls from there are the same: only different choices change what follows.`,
      ...rows.map(
        (r) =>
          `  rewind ${r.at}: turn ${r.turn}${r.turnStart ? ' start' : ''}, before "${r.before}"${r.reason ? ` (unavailable: ${r.reason})` : ''}`,
      ),
    ].join('\n');
  }

  /**
   * rewind <n>: the game as it stood after command n, with one Vision charge spent
   * (VisionRewindController.executeRewind under the fixed random rule: the battle's
   * stream resumes where it stood, so the same orders roll the same). The commands
   * after n stay in the log as the history this rewind left behind.
   */
  async _rewind(cmd) {
    const g = this.game;
    const k = Number(tokenize(cmd)[1]);
    if (g.phase === 'battle') {
      const b = g.battle.battle;
      if (b.battleState !== HEADLESS_STATES.PLAYER_IDLE || b.turnManager?.currentPhase !== 'player')
        throw new PlayError('A Vision is used between orders in your phase.');
    } else if (g.phase !== 'fatal') throw new PlayError('A Vision rewinds a battle in progress.');
    const charges = g.rm.visionChargesRemaining || 0;
    if (charges <= 0) throw new PlayError('No Vision charges left this run.');
    const row = this.rewindDestinations().find((r) => r.at === k);
    if (!row)
      throw new PlayError(
        `No moment ${tokenize(cmd)[1] ?? ''} to return to: "rewinds" lists them.`,
      );
    if (row.reason) throw new PlayError(row.reason);
    const prefix = { ...this.toRecord(), log: this.log.slice(0, k) };
    const target = await PlaySession.fromRecord(this.gameData, prefix);
    const rm = target.game.rm;
    rm.visionChargesRemaining = charges - 1;
    rm.visionCount = (g.rm.visionCount || 0) + 1;
    // Item uids and run ids keep counting: nothing issued in the undone turns is reused.
    target.game.uidCounter = Math.max(target.game.uidCounter, g.uidCounter);
    target.game.uuidCounter = Math.max(target.game.uuidCounter, g.uuidCounter);
    this.game = target.game;
    // The line of play from that moment on is history now (BattleTimeline's branch):
    // neither it nor the moment itself (the game is there again) is a destination.
    for (let i = k - 1; i < this.points.length; i++) this.points[i] = null;
    return [
      `A Vision: back to turn ${row.turn}${row.turnStart ? ' start' : ''}, before "${row.before}". ${rm.visionChargesRemaining} charge(s) left. Ids may differ for enemies not yet seen at that moment.`,
    ];
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
