// The headless play CLI's calls (tools/play/README.md); cli.js runs one from the shell.
//
// Each call takes the session's lock, rebuilds the session from its log
// (play-sessions/<name>/session.json), runs the command(s), saves the record after
// every command that changed the game, and journals everything it printed.
//
// Exit codes: 0 done · 1 usage or internal error · 2 refused (nothing changed by the
// refused command) · 3 the replay diverged or failed · 4 engine fault (that command
// was rolled back; earlier ones in the call stay played) · 5 committed, but the view
// after it failed to render · 6 busy, or not at the expected revision.

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
import { buildReport, reportText } from './report.js';

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
  observation: 5,
  busy: 6,
});

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
  npm run play -- report [--json]      what the run amounts to (battles, spoils, buys), to report.json
  --expect-rev N    refuse unless the session is at revision N (printed after each call)
  --same-turn       stop a chain once the turn or phase moves on (a plan for this turn only)
  --json            one JSON object: each command's result, then the state as data
  --id KEY          run this call at most once: a retry with the same KEY changes nothing

Session NAME defaults to $PLAY_SESSION or "default" (play-sessions/NAME/).
Exit codes: 0 ok, 2 refused, 3 replay diverged, 4 engine fault, 5 view failed after
the command was saved, 6 busy or not at the expected revision.`;

function parseArgs(argv) {
  const flags = {};
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (
      ['--force', '--brief', '--rebase', '--adapt', '--json', '--same-turn', '--compact'].includes(
        a,
      )
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
 * Runs one CLI call. Returns its exit code; never exits the process. `print` receives
 * everything a call prints; `onSession(session)` sees the session once it is rebuilt
 * (tests use it to make a view fail).
 */
export async function runCli(argv, { print = console.log, onSession = null } = {}) {
  const io = { log: print, error: print };
  try {
    return await main(argv, io, onSession);
  } catch (err) {
    if (err instanceof PlayError) {
      io.error(`REFUSED: ${err.message}`);
      return EXIT.refused;
    }
    if (err instanceof SessionBusy || err instanceof RevisionMismatch) {
      io.error(err.message);
      return EXIT.busy;
    }
    if (
      err instanceof ReplayDivergence ||
      err instanceof DigestVersionMismatch ||
      /^Replay failed/.test(err?.message || '')
    ) {
      io.error(err.message);
      return EXIT.replay;
    }
    io.error(err?.stack || String(err));
    return EXIT.error;
  }
}

async function main(argv, io, onSession) {
  const { flags, words } = parseArgs(argv);
  const verb = (words[0] || '').toLowerCase();
  if (!verb || verb === '--help') {
    io.log(USAGE);
    return EXIT.ok;
  }
  if (flags.rebase)
    throw new PlayError(
      '--rebase no longer rewrites a session in place. Derive a re-stamped copy instead: "rebase NEW" (the original stays as it was).',
    );
  const dir = sessionDir(flags.session);
  const gameData = loadGameData();

  // A read of the log needs no lock: the record is replaced atomically.
  if (verb === 'log') {
    const record = load(dir);
    record.log.forEach((e, i) =>
      io.log(`${String(i + 1).padStart(4)}. ${e.cmd}${e.note ? `   # ${e.note}` : ''}`),
    );
    io.log(
      `${record.log.length} command(s), revision ${record.revision ?? record.log.length}. Options: ${JSON.stringify(record.options)}${record.outcome ? `. Concluded: ${record.outcome.kind}${record.outcome.reason ? ` (${record.outcome.reason})` : ''}` : ''}`,
    );
    return EXIT.ok;
  }

  // The report replays the record and writes report.json beside it (atomically).
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
    const report = await buildReport(gameData, record, { journal, manifest: readManifest(dir) });
    writeFileAtomic(join(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    io.log(
      flags.json ? JSON.stringify(report, null, 2) : `${reportText(report)}\n(report.json written)`,
    );
    return EXIT.ok;
  }

  const release = acquireLock(dir, { waitMs: lockWaitMs() });
  try {
    return await locked(dir, verb, words, flags, gameData, io, onSession);
  } finally {
    release();
  }
}

async function locked(dir, verb, words, flags, gameData, io, onSession) {
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
    writeRecord(dir, session.toRecord());
    writeManifest(dir, manifest);
    resetLogs(dir);
    appendJournal(dir, { type: 'new', rev: session.revision, manifest });
    const text = `Session ${dir}\n${session.startLines.join('\n')}\n\n${session.view()}\n\n${session.game.help()}`;
    appendJournal(dir, { type: 'view', rev: session.revision, out: text });
    io.log(`${text}\n(rev ${session.revision})`);
    return EXIT.ok;
  }

  const record = load(dir);
  const rev = Number.isInteger(record.revision) ? record.revision : record.log.length;
  if (flags['expect-rev'] != null && Number(flags['expect-rev']) !== rev)
    throw new RevisionMismatch(Number(flags['expect-rev']), rev);

  if (verb === 'note') {
    const text = words.slice(1).join(' ');
    appendJournal(dir, { type: 'note', rev, at: record.log.length, note: text });
    io.log('Noted.');
    return EXIT.ok;
  }
  if (verb === 'fork') {
    if (!words[1]) throw new PlayError('fork NEW [--at N]');
    const target = sessionDir(words[1]);
    if (existsSync(join(target, RECORD_FILE)) && !flags.force)
      throw new PlayError(`${target} exists. Use --force to replace it.`);
    const upTo = flags.at != null ? Number(flags.at) : null;
    const session = await PlaySession.fromRecord(gameData, record, { upTo });
    session.revision = 0;
    const releaseTarget = acquireLock(target, { waitMs: lockWaitMs() });
    try {
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
    } finally {
      releaseTarget();
    }
    io.log(`Forked ${session.log.length} command(s) to ${target}.\n\n${session.view()}`);
    return EXIT.ok;
  }
  if (verb === 'rebase') {
    if (!words[1]) throw new PlayError('rebase NEW');
    const target = sessionDir(words[1]);
    if (existsSync(join(target, RECORD_FILE)) && !flags.force)
      throw new PlayError(`${target} exists. Use --force to replace it.`);
    const session = await PlaySession.rebase(gameData, record, {
      from: shown(dir),
      adapt: flags.adapt === true,
    });
    const releaseTarget = acquireLock(target, { waitMs: lockWaitMs() });
    try {
      const manifest = manifestFor(session, gameData, {
        agent: readManifest(dir)?.agent ?? null,
        rebasedFrom: { session: shown(dir), revision: rev, manifest: readManifest(dir) },
      });
      writeRecord(target, session.toRecord());
      writeManifest(target, manifest);
      resetLogs(target);
      appendJournal(target, { type: 'rebase', rev: 0, provenance: session.provenance, manifest });
    } finally {
      releaseTarget();
    }
    const p = session.provenance;
    io.log(
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
    writeRecord(dir, next);
  };

  if (verb === 'stop') {
    const kind = String(words[1] || '').toLowerCase();
    if (!STOP_KINDS.includes(kind)) throw new PlayError(`stop ${STOP_KINDS.join('|')} "<why>"`);
    if (record.outcome) throw new PlayError(`Already concluded: ${record.outcome.kind}.`);
    record.outcome = { kind, reason: words.slice(2).join(' ') || null, at: session.log.length };
    save();
    appendJournal(dir, { type: 'outcome', rev: session.revision, ...record.outcome });
    io.log(`Concluded: ${kind}. Fork the session to play on from here.`);
    return EXIT.ok;
  }

  // A call with an id runs at most once: its commands carry the id in the log.
  if (flags.id != null && session.log.some((e) => e.call === String(flags.id))) {
    const done = session.log.filter((e) => e.call === String(flags.id)).map((e) => e.cmd);
    io.log(
      `Call ${flags.id} was already applied (${done.join('; ')}); nothing was run again. (rev ${session.revision})`,
    );
    appendJournal(dir, { type: 'duplicate', rev: session.revision, call: String(flags.id) });
    return EXIT.ok;
  }

  const commands = splitCommands(words.join(' '));
  let status = EXIT.ok;
  let changed = false;
  // --json: one JSON object for the whole call (each step's result, then the
  // observation as data) in place of the text.
  const results = [];
  const say = flags.json ? () => {} : (text) => io.log(text);
  // --same-turn: a chain planned for this turn stops when the turn or phase moves on.
  const moment = () =>
    `${session.game.phase}:${session.game.battle?.battle?.turnManager?.turnNumber ?? ''}:${session.game.rm?.currentNodeId ?? ''}`;
  const startMoment = moment();
  let note = flags.note || null; // --note belongs to the first command that changes the game
  for (const [n, cmd] of commands.entries()) {
    const head = cmd.split(/\s+/)[0].toLowerCase();
    if (head === 'note') {
      const text = cmd
        .slice(4)
        .trim()
        .replace(/^"(.*)"$/s, '$1');
      appendJournal(dir, {
        type: 'note',
        rev: session.revision,
        at: session.log.length,
        note: text,
      });
      say('Noted.');
      results.push({ cmd, kind: 'note' });
      continue;
    }
    const notRun = (why = null) => {
      const rest = commands.slice(n + 1);
      if (rest.length) say(`(${why ? `${why} ` : ''}Not run: ${rest.join('; ')})`);
      for (const r of rest) results.push({ cmd: r, kind: 'not run', why });
    };
    try {
      if (PlaySession.isQuery(cmd)) {
        const text = await session.query(cmd);
        appendJournal(dir, { type: 'query', rev: session.revision, cmd, out: text });
        say(text);
        results.push({ cmd, kind: 'query', out: text });
        continue;
      }
      if (record.outcome)
        throw new PlayError(
          `This session was concluded (${record.outcome.kind}). Fork it to play on from here.`,
        );
      const { lines, entry, diagnostics } = await session.exec(cmd, {
        note,
        call: flags.id ?? null,
      });
      changed = true;
      // Saved before anything is announced: a command that printed is a command kept.
      const fresh = session.game.peek(() => newNotices(session.game, noticed));
      for (const notice of fresh) noticed.add(notice.key);
      if (session.over && !record.outcome)
        record.outcome = { kind: session.game.rm.status, at: session.log.length };
      save();
      appendJournal(dir, {
        type: 'cmd',
        rev: session.revision,
        at: session.log.length,
        cmd,
        digest: entry.digest,
        note,
        call: flags.id ?? null,
        out: lines,
      });
      if (diagnostics)
        appendDiagnostics(dir, {
          rev: session.revision,
          at: session.log.length,
          cmd,
          lines: diagnostics,
        });
      for (const notice of fresh)
        appendJournal(dir, { type: 'unsupported', rev: session.revision, ...notice });
      if (session.over)
        appendJournal(dir, { type: 'outcome', rev: session.revision, ...record.outcome });
      note = null;
      say(`> ${cmd}\n${lines.join('\n')}`);
      for (const notice of fresh) say(noticeLine(notice));
      results.push({
        cmd,
        kind: 'played',
        lines,
        unsupported: fresh.map((f) => f.line),
        rev: session.revision,
      });
    } catch (err) {
      if (err instanceof PlayError) {
        appendJournal(dir, { type: 'refused', rev: session.revision, cmd, error: err.message });
        say(`> ${cmd}\nREFUSED: ${err.message}`);
        results.push({ cmd, kind: 'refused', error: err.message });
        notRun();
        status = EXIT.refused;
        break;
      }
      // Anything else is a fault in the game or the adapter, never a move to retry.
      appendJournal(dir, {
        type: 'fault',
        rev: session.revision,
        cmd,
        error: String(err?.message || err),
        stack: err?.stack || null,
      });
      say(
        `> ${cmd}\nENGINE FAULT: ${err?.stack || err}\nThe command was rolled back; anything before it in this call stays played. This is a bug in the game or the adapter (not a refusal): report it with this session.`,
      );
      results.push({ cmd, kind: 'fault', error: String(err?.message || err), stack: err?.stack });
      notRun();
      status = EXIT.fault;
      break;
    }
    if (session.over) break;
    if (flags['same-turn'] && moment() !== startMoment && n < commands.length - 1) {
      notRun('The turn or phase moved on (--same-turn).');
      break;
    }
  }

  if (flags.json) {
    let observation;
    try {
      observation = session.observe();
    } catch (err) {
      observation = { error: String(err?.message || err) };
      if (status === EXIT.ok && changed) status = EXIT.observation;
    }
    io.log(
      JSON.stringify(
        { rev: session.revision, status, over: session.over, results, observation },
        null,
        flags.compact ? 0 : 1,
      ),
    );
    return status;
  }

  if (changed && !flags.brief) {
    try {
      const text = session.view();
      appendJournal(dir, { type: 'view', rev: session.revision, out: text });
      io.log(`\n${text}`);
    } catch (err) {
      appendJournal(dir, {
        type: 'observationFault',
        rev: session.revision,
        error: String(err?.message || err),
        stack: err?.stack || null,
      });
      io.log(
        `\nThe command(s) above were saved, but the view after them failed to render: ${err?.stack || err}`,
      );
      if (status === EXIT.ok) status = EXIT.observation;
    }
  }
  if (session.over) io.log(`\nThe run is over (${session.game.rm.status}).`);
  io.log(`(rev ${session.revision})`);
  return status;
}
