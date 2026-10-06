// The headless play CLI's calls (tools/play/README.md); cli.js runs one from the shell.
//
// Each call takes the session's lock, rebuilds the session from its log
// (play-sessions/<name>/session.json), runs the command(s), saves the record after
// every command that changed the game, and journals everything it shows before it
// shows it.
//
// A command that changes the game passes three boundaries, and a failure says which
// it reached:
//   run      the game ran it. A refusal or a fault here leaves the game as it was
//            (checked against the digest taken before), so nothing is saved.
//   saved    the record holding it is on disk: from here the command counts. A failed
//            save means it does not, and nothing it did is shown.
//   reported its report is journaled, then printed; then diagnostics and the view. A
//            failure here leaves the command saved, and says so.
//
// Exit codes: 0 done · 1 usage or internal error · 2 refused (nothing changed by the
// refused command) · 3 the replay diverged or failed · 4 engine fault (that command
// was rolled back, or, if even that failed, nothing was saved and the call stopped;
// earlier ones in the call stay played) · 5 saved, but what follows the save (the
// journal, diagnostics or the view) failed · 6 busy, or not at the expected revision
// · 7 not saved: the command ran but its record could not be written, so it does not
// count.
//
// --json: every call, whatever its outcome, prints one JSON object (RESPONSE_VERSION),
// and a call that reached the session journals that object as it was printed.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGameData } from '../../tests/testData.js';
import { DigestVersionMismatch, PlaySession, ReplayDivergence, SESSION_FORMAT } from './session.js';
import { SNAPSHOT_VERSION } from './snapshot.js';
import { PlayError } from './parse.js';
import {
  ADAPTER_VERSION,
  DIAGNOSTICS_FILE,
  JOURNAL_FILE,
  RECORD_FILE,
  RevisionMismatch,
  SessionBusy,
  acquireLock,
  appendDiagnostics,
  appendJournal,
  codeVersion,
  dataFingerprint,
  readManifest,
  readRecord,
  writeFileAtomic,
  writeManifest,
  writeRecord,
} from './store.js';
import { UNSUPPORTED, newNotices, noticeLine } from './capabilities.js';
import { REPORT_VERSION, buildReport, reportText } from './report.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SESSIONS = join(ROOT, 'play-sessions');

function lockWaitMs() {
  const ms = Number(process.env.PLAY_LOCK_WAIT_MS);
  return Number.isFinite(ms) && ms >= 0 ? ms : 30000;
}

export const EXIT = Object.freeze({
  ok: 0,
  error: 1,
  refused: 2,
  replay: 3,
  fault: 4,
  afterSave: 5,
  observation: 5, // the view after a saved command is one of the things after the save
  busy: 6,
  notSaved: 7,
});

/** The version of the --json response object. */
export const RESPONSE_VERSION = 1;

const STATUS = {
  [EXIT.ok]: 'ok',
  [EXIT.error]: 'error',
  [EXIT.refused]: 'refused',
  [EXIT.replay]: 'replayFailed',
  [EXIT.fault]: 'fault',
  [EXIT.afterSave]: 'savedButUnreported',
  [EXIT.busy]: 'busy',
  [EXIT.notSaved]: 'notSaved',
};

const STOP_KINDS = ['voluntary', 'timeout', 'blocked'];

const USAGE = `Headless play — tools/play/README.md

  npm run play -- new [--seed N] [--difficulty normal|dusk|hard|lunatic] [--meta none|max]
                      [--commander NAME --partner NAME] [--agent "model, prompt, budget"]
                      [--session NAME] [--force]
  npm run play -- <command> [--note "why"] [--brief] [--session NAME]
  npm run play -- "<command>; <command>; ..."    several commands in one call
  npm run play -- look | help | roster | map | options P1 | forecast P1 3,4 E2 | threat 3,4 | unit E2
  npm run play -- note "<thought>"     write a note to the journal (no game change)
  npm run play -- log                  the commands played so far
  npm run play -- fork NEW [--at N]    copy this session (its first N commands) to NEW
  npm run play -- rebase NEW [--adapt] replay without checking digests into NEW, re-stamped;
                                       --adapt inserts "canto stay" where the session predates Canto
  npm run play -- stop voluntary|timeout|blocked "<why>"   conclude the run here
  npm run play -- report [--json]      what the run amounts to (battles, spoils, buys), to
                                       report.json; the replay is verified against the log
  npm run play -- report --unverified  rebuild a record the current code no longer reproduces,
                                       labelled as such, to report.unverified.json
  --expect-rev N    refuse unless the session is at revision N (printed after each call)
  --same-turn       stop a chain once the turn or phase moves on (a plan for this turn only)
  --json            one JSON object for any outcome: each command's result, then the state
  --id KEY          run this call at most once: a retry with the same KEY changes nothing

Session NAME defaults to $PLAY_SESSION or "default" (play-sessions/NAME/).
Exit codes: 0 ok, 2 refused, 3 replay diverged, 4 engine fault (rolled back), 5 saved but
not fully reported, 6 busy or not at the expected revision, 7 not saved.`;

function parseArgs(argv) {
  const flags = {};
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (
      [
        '--force',
        '--brief',
        '--rebase',
        '--adapt',
        '--json',
        '--same-turn',
        '--compact',
        '--unverified',
      ].includes(a)
    )
      flags[a.slice(2)] = true;
    else if (a.startsWith('--')) flags[a.slice(2)] = argv[++i];
    else words.push(a);
  }
  return { flags, words };
}

/** Splits "a; b; note \"x; y\"" at semicolons outside double quotes. */
function splitCommands(line) {
  const out = [];
  let current = '';
  let quoted = false;
  for (const ch of String(line)) {
    if (ch === '"') quoted = !quoted;
    if (ch === ';' && !quoted) {
      out.push(current);
      current = '';
    } else current += ch;
  }
  out.push(current);
  return out.map((c) => c.trim()).filter(Boolean);
}

/** A session's path as records name it: relative to the repository when inside it. */
function shown(dir) {
  const rel = relative(ROOT, dir);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : dir;
}

function sessionDir(name) {
  const n = name || process.env.PLAY_SESSION || 'default';
  return isAbsolute(n) || n.includes('/') ? resolve(n) : join(SESSIONS, n);
}

function load(dir) {
  if (!existsSync(join(dir, RECORD_FILE)))
    throw new PlayError(`No session at ${dir}. Start one with "new".`);
  return readRecord(dir);
}

/** Who and what made this session: the evidence a playtest's conclusions rest on. */
function manifestFor(session, gameData, extra = {}) {
  return {
    created: new Date().toISOString(),
    adapter: {
      version: ADAPTER_VERSION,
      sessionFormat: SESSION_FORMAT,
      snapshotVersion: SNAPSHOT_VERSION,
    },
    code: codeVersion(ROOT),
    data: dataFingerprint(gameData),
    options: session.options,
    unsupported: UNSUPPORTED.map(({ id, what }) => ({ id, what })),
    ...extra,
  };
}

/** A new session's logs start empty (a --force replacement leaves nothing behind). */
function resetLogs(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, JOURNAL_FILE), '');
  writeFileSync(join(dir, DIAGNOSTICS_FILE), '');
}

function agentConfig(flags) {
  if (flags['agent-file']) return JSON.parse(readFileSync(resolve(flags['agent-file']), 'utf8'));
  return flags.agent ? { description: flags.agent } : null;
}

/**
 * What a call prints. In text mode each line goes out as it is made; with --json it
 * is gathered, with the call's fields, into one response object printed at the end.
 */
class Output {
  constructor({ json, compact, print }) {
    this.json = json;
    this.compact = compact;
    this.print = print;
    this.text = [];
    this.fields = {};
    this.status = null; // a finer status than the exit code's (duplicate, revisionMismatch)
    this.error = null;
    this.emitted = false;
  }

  log(text) {
    if (this.json) this.text.push(String(text));
    else this.print(text);
  }

  set(fields) {
    Object.assign(this.fields, fields);
  }

  /** The exit code for a failure that ended the call, said the way it happened. */
  fail(err) {
    if (err instanceof PlayError) {
      this.error = { kind: 'refused', message: err.message };
      this.log(`REFUSED: ${err.message}`);
      return EXIT.refused;
    }
    if (err instanceof SessionBusy || err instanceof RevisionMismatch) {
      this.status = err instanceof RevisionMismatch ? 'revisionMismatch' : 'busy';
      this.error = { kind: this.status, message: err.message };
      this.log(err.message);
      return EXIT.busy;
    }
    if (
      err instanceof ReplayDivergence ||
      err instanceof DigestVersionMismatch ||
      /^Replay failed/.test(err?.message || '')
    ) {
      this.error = { kind: 'replay', message: err.message };
      this.log(err.message);
      return EXIT.replay;
    }
    this.error = { kind: 'error', message: String(err?.message || err), stack: err?.stack };
    this.log(err?.stack || String(err));
    return EXIT.error;
  }

  /**
   * --json: prints the response once. With `journal`, it is journaled first, exactly
   * as printed; a response that cannot be journaled is not shown, only what became of
   * the call (its exit code then says so).
   */
  emit(code, journal = null) {
    if (!this.json || this.emitted) return code;
    this.emitted = true;
    let response = {
      response: RESPONSE_VERSION,
      status: this.status || STATUS[code],
      exit: code,
      ...this.fields,
      text: this.text.length ? this.text.join('\n') : null,
      error: this.error,
    };
    if (journal) {
      try {
        journal({
          type: 'response',
          rev: response.rev ?? null,
          call: response.call ?? null,
          response,
        });
      } catch (err) {
        const saved = (response.results || []).filter((r) => r.kind === 'played');
        code = saved.length ? EXIT.afterSave : EXIT.error;
        response = {
          response: RESPONSE_VERSION,
          status: STATUS[code],
          exit: code,
          session: response.session ?? null,
          call: response.call ?? null,
          rev: response.rev ?? null,
          // What was saved stands; what it showed could not be journaled, so it is not shown.
          results: (response.results || []).map(({ cmd, kind, rev }) => ({ cmd, kind, rev })),
          observation: null,
          text: null,
          error: {
            kind: 'journal',
            message: `The response could not be journaled (${err.message}), so it is withheld. ${saved.length ? `${saved.length} command(s) were saved; "look" shows the game.` : 'Nothing was saved.'}`,
          },
        };
      }
    }
    this.print(JSON.stringify(response, null, this.compact ? 0 : 1));
    return code;
  }
}

/**
 * Runs one CLI call. Returns its exit code; never exits the process. `print` receives
 * everything a call prints. Test seams: `onSession(session)` sees the session once it
 * is rebuilt; `inject(point, detail)` runs before each write ('save', 'journal',
 * 'diagnostics') and before a fork or rebase takes its target ('claim'), and may throw
 * to fail it.
 */
export async function runCli(argv, { print = console.log, onSession = null, inject = null } = {}) {
  const { flags } = parseArgs(argv);
  const out = new Output({ json: Boolean(flags.json), compact: Boolean(flags.compact), print });
  let code;
  try {
    code = await main(argv, out, { onSession, inject });
  } catch (err) {
    code = out.fail(err);
  }
  return out.emit(code);
}

async function main(argv, out, hooks) {
  const { flags, words } = parseArgs(argv);
  const verb = (words[0] || '').toLowerCase();
  if (!verb || verb === '--help') {
    out.log(USAGE);
    return EXIT.ok;
  }
  if (flags.rebase)
    throw new PlayError(
      '--rebase no longer rewrites a session in place. Derive a re-stamped copy instead: "rebase NEW" (the original stays as it was).',
    );
  const dir = sessionDir(flags.session);
  out.set({ session: shown(dir), call: flags.id ?? null });
  const gameData = loadGameData();

  // A read of the log needs no lock: the record is replaced atomically.
  if (verb === 'log') {
    const record = load(dir);
    record.log.forEach((e, i) =>
      out.log(`${String(i + 1).padStart(4)}. ${e.cmd}${e.note ? `   # ${e.note}` : ''}`),
    );
    out.log(
      `${record.log.length} command(s), revision ${record.revision ?? record.log.length}. Options: ${JSON.stringify(record.options)}${record.outcome ? `. Concluded: ${record.outcome.kind}${record.outcome.reason ? ` (${record.outcome.reason})` : ''}` : ''}`,
    );
    out.set({
      rev: record.revision ?? record.log.length,
      log: record.log.map(({ cmd, note }) => ({ cmd, note: note ?? null })),
    });
    return EXIT.ok;
  }

  // The report replays the record (verified, unless asked otherwise) and writes it
  // beside the record: report.json, or report.unverified.json, never over a verified one.
  if (verb === 'report') {
    const record = load(dir);
    const journal = existsSync(join(dir, JOURNAL_FILE))
      ? readFileSync(join(dir, JOURNAL_FILE), 'utf8')
          .split('\n')
          .filter(Boolean)
          .flatMap((line) => {
            try {
              return [JSON.parse(line)];
            } catch {
              return []; // a line cut short by a killed call
            }
          })
      : [];
    const unverified = flags.unverified === true;
    const report = await buildReport(gameData, record, {
      journal,
      manifest: readManifest(dir),
      unverified,
      reconstruction: {
        code: codeVersion(ROOT),
        data: dataFingerprint(gameData),
        adapter: ADAPTER_VERSION,
        snapshotVersion: SNAPSHOT_VERSION,
        reportVersion: REPORT_VERSION,
      },
    });
    const name = unverified ? 'report.unverified.json' : 'report.json';
    writeFileAtomic(join(dir, name), JSON.stringify(report, null, 2) + '\n');
    if (out.json) out.set({ rev: report.revision, report });
    else out.log(`${reportText(report)}\n(${name} written)`);
    return EXIT.ok;
  }

  const release = acquireLock(dir, { waitMs: lockWaitMs() });
  try {
    let code;
    try {
      code = await locked(dir, verb, words, flags, gameData, out, hooks);
    } catch (err) {
      code = out.fail(err);
    }
    // The response is journaled under the lock, in order with the call's other entries.
    const journal = existsSync(join(dir, RECORD_FILE))
      ? (entry) => {
          hooks.inject?.('journal', entry);
          appendJournal(dir, entry);
        }
      : null;
    return out.emit(code, journal);
  } finally {
    release();
  }
}

/** A new session's files, or a fork's or rebase's, written under the target's lock. */
function claimTarget(target, source, flags, write, inject = null) {
  if (resolve(target) === resolve(source))
    throw new PlayError('The new session must be another one than this.');
  inject?.('claim', target); // another call may get there first
  const releaseTarget = acquireLock(target, { waitMs: lockWaitMs() });
  try {
    // Checked under the target's lock: two calls cannot both find it free.
    if (existsSync(join(target, RECORD_FILE)) && !flags.force)
      throw new PlayError(`${target} exists. Use --force to replace it.`);
    write();
  } finally {
    releaseTarget();
  }
}

async function locked(dir, verb, words, flags, gameData, out, hooks) {
  const { inject = null, onSession = null } = hooks;
  const journal = (entry) => {
    inject?.('journal', entry);
    appendJournal(dir, entry);
  };

  if (verb === 'new') {
    if (existsSync(join(dir, RECORD_FILE)) && !flags.force)
      throw new PlayError(
        `A session already exists at ${dir}. Use --force to replace it, or --session NAME.`,
      );
    const session = await PlaySession.create(gameData, {
      seed: flags.seed,
      difficulty: flags.difficulty,
      meta: flags.meta,
      commander: flags.commander,
      partner: flags.partner,
    });
    const manifest = manifestFor(session, gameData, { agent: agentConfig(flags) });
    inject?.('save');
    writeRecord(dir, session.toRecord());
    writeManifest(dir, manifest);
    resetLogs(dir);
    journal({ type: 'new', rev: session.revision, manifest });
    const text = `Session ${dir}\n${session.startLines.join('\n')}\n\n${session.view()}\n\n${session.game.help()}`;
    out.set({ rev: session.revision });
    if (out.json) out.set({ observation: session.observe() });
    else {
      journal({ type: 'view', rev: session.revision, out: text });
      out.log(`${text}\n(rev ${session.revision})`);
    }
    return EXIT.ok;
  }

  const record = load(dir);
  const rev = Number.isInteger(record.revision) ? record.revision : record.log.length;
  out.set({ rev });
  if (flags['expect-rev'] != null && Number(flags['expect-rev']) !== rev)
    throw new RevisionMismatch(Number(flags['expect-rev']), rev);

  if (verb === 'note') {
    const text = words.slice(1).join(' ');
    journal({ type: 'note', rev, at: record.log.length, note: text });
    out.log('Noted.');
    return EXIT.ok;
  }
  if (verb === 'fork') {
    if (!words[1]) throw new PlayError('fork NEW [--at N]');
    const target = sessionDir(words[1]);
    const upTo = flags.at != null ? Number(flags.at) : null;
    const session = await PlaySession.fromRecord(gameData, record, { upTo });
    session.revision = 0;
    claimTarget(
      target,
      dir,
      flags,
      () => {
        const manifest = manifestFor(session, gameData, {
          agent: agentConfig(flags) ?? readManifest(dir)?.agent ?? null,
          forkedFrom: { session: shown(dir), at: session.log.length, revision: rev },
        });
        writeRecord(target, session.toRecord());
        writeManifest(target, manifest);
        resetLogs(target);
        appendJournal(target, {
          type: 'fork',
          rev: 0,
          from: shown(dir),
          at: session.log.length,
          manifest,
        });
      },
      inject,
    );
    out.set({ target: shown(target), commands: session.log.length });
    out.log(`Forked ${session.log.length} command(s) to ${target}.\n\n${session.view()}`);
    return EXIT.ok;
  }
  if (verb === 'rebase') {
    if (!words[1]) throw new PlayError('rebase NEW');
    const target = sessionDir(words[1]);
    const session = await PlaySession.rebase(gameData, record, {
      from: shown(dir),
      adapt: flags.adapt === true,
    });
    claimTarget(
      target,
      dir,
      flags,
      () => {
        const manifest = manifestFor(session, gameData, {
          agent: readManifest(dir)?.agent ?? null,
          rebasedFrom: { session: shown(dir), revision: rev, manifest: readManifest(dir) },
        });
        writeRecord(target, session.toRecord());
        writeManifest(target, manifest);
        resetLogs(target);
        appendJournal(target, { type: 'rebase', rev: 0, provenance: session.provenance, manifest });
      },
      inject,
    );
    const p = session.provenance;
    out.set({ target: shown(target), provenance: p });
    out.log(
      `Rebased ${p.commands} command(s) from ${dir} into ${target}. ${
        p.digestVersionFrom !== p.digestVersionTo
          ? `Digests re-stamped from snapshot version ${p.digestVersionFrom} to ${p.digestVersionTo}.`
          : p.changed.length
            ? `${p.changed.length} digest(s) changed, first at command ${p.changed[0]}: the game played differently from there.`
            : 'Every digest matched.'
      }${
        p.inserted.length
          ? ` ${p.inserted.length} command(s) inserted for rules the session predates (${p.inserted
              .map((x) => `"${x.cmd}" at ${x.before}`)
              .slice(0, 5)
              .join(', ')}${p.inserted.length > 5 ? ', ...' : ''}).`
          : ''
      }${
        p.rewritten.length
          ? ` ${p.rewritten.length} command(s) restated as the old rules read them (${p.rewritten
              .map((x) => `"${x.from}" -> "${x.to}"`)
              .slice(0, 3)
              .join(', ')}${p.rewritten.length > 3 ? ', ...' : ''}).`
          : ''
      } The original is unchanged.`,
    );
    return EXIT.ok;
  }

  const session = await PlaySession.fromRecord(gameData, record);
  onSession?.(session);
  const noticed = new Set(record.noticed || []);
  const save = () => {
    const next = session.toRecord();
    if (record.outcome) next.outcome = record.outcome;
    if (noticed.size) next.noticed = [...noticed];
    inject?.('save');
    writeRecord(dir, next);
  };

  if (verb === 'stop') {
    const kind = String(words[1] || '').toLowerCase();
    if (!STOP_KINDS.includes(kind)) throw new PlayError(`stop ${STOP_KINDS.join('|')} "<why>"`);
    if (record.outcome) throw new PlayError(`Already concluded: ${record.outcome.kind}.`);
    record.outcome = { kind, reason: words.slice(2).join(' ') || null, at: session.log.length };
    save();
    journal({ type: 'outcome', rev: session.revision, ...record.outcome });
    out.set({ outcome: record.outcome });
    out.log(`Concluded: ${kind}. Fork the session to play on from here.`);
    return EXIT.ok;
  }

  // A call with an id runs at most once: its commands carry the id in the log.
  if (flags.id != null && session.log.some((e) => e.call === String(flags.id))) {
    const done = session.log.filter((e) => e.call === String(flags.id)).map((e) => e.cmd);
    out.status = 'duplicate';
    journal({ type: 'duplicate', rev: session.revision, call: String(flags.id) });
    out.set({
      results: done.map((cmd) => ({ cmd, kind: 'alreadyApplied' })),
      over: session.over,
    });
    if (out.json) out.set({ observation: session.observe() });
    out.log(
      `Call ${flags.id} was already applied (${done.join('; ')}); nothing was run again. (rev ${session.revision})`,
    );
    return EXIT.ok;
  }

  return playCommands(session, { dir, words, flags, out, record, noticed, save, journal, inject });
}

/** Runs a call's commands one at a time, each through run, save and report. */
async function playCommands(session, ctx) {
  const { dir, words, flags, out, record, noticed, save, journal, inject } = ctx;
  const commands = splitCommands(words.join(' '));
  let status = EXIT.ok;
  let durable = session.revision; // the revision on disk
  let changed = false;
  let stale = null; // why the game in memory no longer matches the disk
  const results = [];
  const say = (text) => (out.json ? null : out.log(text));
  // --same-turn: a chain planned for this turn stops when the turn or phase moves on.
  const moment = () =>
    `${session.game.phase}:${session.game.battle?.battle?.turnManager?.turnNumber ?? ''}:${session.game.rm?.currentNodeId ?? ''}`;
  const startMoment = moment();
  let note = flags.note || null; // --note belongs to the first command that changes the game
  const notRun = (n, why = null) => {
    const rest = commands.slice(n + 1);
    if (rest.length) say(`(${why ? `${why} ` : ''}Not run: ${rest.join('; ')})`);
    for (const r of rest) results.push({ cmd: r, kind: 'not run', why });
  };
  const refuse = (n, cmd, err) => {
    journal({ type: 'refused', rev: durable, cmd, error: err.message });
    say(`> ${cmd}\nREFUSED: ${err.message}`);
    results.push({ cmd, kind: 'refused', error: err.message });
    notRun(n);
    status = EXIT.refused;
  };

  for (const [n, cmd] of commands.entries()) {
    const head = cmd.split(/\s+/)[0].toLowerCase();
    if (head === 'note') {
      const text = cmd
        .slice(4)
        .trim()
        .replace(/^"(.*)"$/s, '$1');
      journal({ type: 'note', rev: durable, at: session.log.length, note: text });
      say('Noted.');
      results.push({ cmd, kind: 'note' });
      continue;
    }

    if (PlaySession.isQuery(cmd)) {
      let text;
      try {
        text = await session.query(cmd);
      } catch (err) {
        if (!(err instanceof PlayError)) throw err; // a query changes nothing to roll back
        refuse(n, cmd, err);
        break;
      }
      journal({ type: 'query', rev: durable, cmd, out: text });
      say(text);
      results.push({ cmd, kind: 'query', out: text });
      continue;
    }

    // 1. Run. A refusal or fault leaves the game as it was before the command.
    let ran;
    try {
      if (record.outcome)
        throw new PlayError(
          `This session was concluded (${record.outcome.kind}). Fork it to play on from here.`,
        );
      ran = await session.exec(cmd, { note, call: flags.id ?? null });
    } catch (err) {
      if (err instanceof PlayError) {
        refuse(n, cmd, err);
        break;
      }
      // Anything else is a fault in the game or the adapter, never a move to retry.
      const restored = err?.rollback === 'verified' || err?.rollback === 'unchanged';
      if (!restored) stale = 'a fault left the game in memory unrestored';
      journal({
        type: 'fault',
        rev: durable,
        cmd,
        rollback: err?.rollback ?? null,
        error: String(err?.message || err),
        stack: err?.stack || null,
        rebuildError: err?.rebuildError ? String(err.rebuildError.message) : null,
      });
      say(
        `> ${cmd}\nENGINE FAULT: ${err?.stack || err}\n${
          restored
            ? 'The command was rolled back (the game is as it was before it, checked against its digest); anything before it in this call stays played.'
            : `The command was not saved, so the session on disk is unchanged at rev ${durable}; but the game could not be restored in memory${err?.rebuildError ? ` (${err.rebuildError.message})` : ''}, so nothing more runs in this call.`
        } This is a bug in the game or the adapter (not a refusal): report it with this session.`,
      );
      results.push({
        cmd,
        kind: 'fault',
        rollback: err?.rollback ?? null,
        error: String(err?.message || err),
        stack: err?.stack,
      });
      notRun(n);
      status = EXIT.fault;
      break;
    }
    const { lines, entry, diagnostics } = ran;
    const fresh = session.game.peek(() => newNotices(session.game, noticed));
    for (const notice of fresh) noticed.add(notice.key);
    if (session.over && !record.outcome)
      record.outcome = { kind: session.game.rm.status, at: session.log.length };

    // 2. Save. From here the command counts; if this fails it does not, and nothing it
    // did is shown (the game in memory is now ahead of the disk).
    try {
      save();
    } catch (err) {
      stale = 'a command ran but could not be saved';
      try {
        journal({ type: 'notSaved', rev: durable, cmd, error: String(err?.message || err) });
      } catch {
        // The disk refuses writes; the response says what happened.
      }
      say(
        `> ${cmd}\nNOT SAVED: ${err?.message || err}. The command ran but its record could not be written, so it does not count: the session on disk is still at rev ${durable}, and nothing the command did is shown. Call again once the session can be written.`,
      );
      results.push({ cmd, kind: 'notSaved', error: String(err?.message || err), rev: durable });
      notRun(n, 'Not saved.');
      status = EXIT.notSaved;
      break;
    }
    durable = session.revision;
    changed = true;
    note = null;

    // 3. Report: journaled, then shown. A failure from here leaves the command saved.
    try {
      journal({
        type: 'cmd',
        rev: durable,
        at: session.log.length,
        cmd,
        digest: entry.digest,
        note: entry.note ?? null,
        call: flags.id ?? null,
        out: lines,
      });
    } catch (err) {
      say(
        `> ${cmd}\nSAVED at rev ${durable}, but its report could not be journaled (${err?.message || err}), so it is not shown here; "look" shows the game as it now stands.`,
      );
      results.push({ cmd, kind: 'played', rev: durable, withheld: String(err?.message || err) });
      notRun(n);
      status = EXIT.afterSave;
      break;
    }
    const shownNotices = [];
    let after = null;
    try {
      for (const notice of fresh) {
        journal({ type: 'unsupported', rev: durable, ...notice });
        shownNotices.push(notice);
      }
      if (session.over) journal({ type: 'outcome', rev: durable, ...record.outcome });
      if (diagnostics) {
        inject?.('diagnostics');
        appendDiagnostics(dir, { rev: durable, at: session.log.length, cmd, lines: diagnostics });
      }
    } catch (err) {
      after = String(err?.message || err);
    }
    say(`> ${cmd}\n${lines.join('\n')}`);
    for (const notice of shownNotices) say(noticeLine(notice));
    results.push({
      cmd,
      kind: 'played',
      rev: durable,
      lines,
      unsupported: shownNotices.map((f) => f.line),
      ...(after ? { recordError: after } : {}),
    });
    if (after) {
      say(
        `(Saved at rev ${durable} and its report journaled, but writing the rest of the record failed: ${after}. The command stands.)`,
      );
      notRun(n);
      status = EXIT.afterSave;
      break;
    }
    if (session.over) break;
    if (flags['same-turn'] && moment() !== startMoment && n < commands.length - 1) {
      notRun(n, 'The turn or phase moved on (--same-turn).');
      break;
    }
  }

  out.set({ rev: durable, results, over: session.over });
  if (stale) {
    // The game in memory is not the one on disk: show none of it.
    out.set({ observation: null, observationWithheld: stale });
    say(`(Nothing more is shown: ${stale}. The session on disk is at rev ${durable}.)`);
    return status;
  }

  if (out.json) {
    try {
      out.set({ observation: session.observe() });
    } catch (err) {
      out.set({ observation: null, observationError: String(err?.message || err) });
      if (status === EXIT.ok) status = changed ? EXIT.afterSave : EXIT.error;
    }
    return status;
  }

  if (changed && !flags.brief) {
    let text = null;
    try {
      text = session.view();
    } catch (err) {
      try {
        journal({
          type: 'observationFault',
          rev: durable,
          error: String(err?.message || err),
          stack: err?.stack || null,
        });
      } catch {
        // Reported below either way.
      }
      out.log(
        `\nThe command(s) above were saved, but the view after them failed to render: ${err?.stack || err}`,
      );
      if (status === EXIT.ok) status = EXIT.afterSave;
    }
    if (text != null) {
      try {
        journal({ type: 'view', rev: durable, out: text });
        out.log(`\n${text}`);
      } catch (err) {
        out.log(
          `\n(The view could not be journaled (${err?.message || err}), so it is not shown; the commands above are saved.)`,
        );
        if (status === EXIT.ok) status = EXIT.afterSave;
      }
    }
  }
  if (session.over) out.log(`\nThe run is over (${session.game.rm.status}).`);
  out.log(`(rev ${durable})`);
  return status;
}
