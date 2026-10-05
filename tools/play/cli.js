#!/usr/bin/env node
// Headless play from a shell: `npm run play -- <command> [options]` (tools/play/README.md).
//
// Each call rebuilds the session from its log (play-sessions/<name>/session.json),
// runs the command(s), saves the log and appends everything to journal.jsonl.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGameData } from '../../tests/testData.js';
import { PlaySession, ReplayDivergence } from './session.js';
import { PlayError } from './parse.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SESSIONS = join(ROOT, 'play-sessions');

const USAGE = `Headless play — tools/play/README.md

  npm run play -- new [--seed N] [--difficulty normal|dusk|hard|lunatic] [--meta none|max]
                      [--commander NAME --partner NAME] [--session NAME] [--force]
  npm run play -- <command> [--note "why"] [--brief] [--session NAME]
  npm run play -- "<command>; <command>; ..."    several commands in one call
  npm run play -- look | help | roster | map | options P1 | forecast P1 3,4 E2 | threat 3,4 | unit E2
  npm run play -- note "<thought>"     write a note to the journal (no game change)
  npm run play -- log                  the commands played so far
  npm run play -- fork NEW [--at N]    copy this session (its first N commands) to NEW
  --rebase                             replay without checking logged states, then re-stamp them

Session NAME defaults to $PLAY_SESSION or "default" (play-sessions/NAME/).`;

function parseArgs(argv) {
  const flags = {};
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force' || a === '--brief' || a === '--rebase') flags[a.slice(2)] = true;
    else if (a.startsWith('--')) flags[a.slice(2)] = argv[++i];
    else words.push(a);
  }
  return { flags, words };
}

function sessionDir(name) {
  const n = name || process.env.PLAY_SESSION || 'default';
  return isAbsolute(n) || n.includes('/') ? resolve(n) : join(SESSIONS, n);
}

function load(dir) {
  const file = join(dir, 'session.json');
  if (!existsSync(file)) throw new PlayError(`No session at ${dir}. Start one with "new".`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

function save(dir, session) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'session.json'), JSON.stringify(session.toRecord(), null, 1) + '\n');
}

function journal(dir, entry) {
  mkdirSync(dir, { recursive: true });
  appendFileSync(
    join(dir, 'journal.jsonl'),
    JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n',
  );
}

async function main(argv) {
  const { flags, words } = parseArgs(argv);
  const verb = (words[0] || '').toLowerCase();
  if (!verb || verb === '--help') {
    console.log(USAGE);
    return 0;
  }
  const dir = sessionDir(flags.session);
  const gameData = loadGameData();

  if (verb === 'new') {
    if (existsSync(join(dir, 'session.json')) && !flags.force)
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
    save(dir, session);
    writeFileSync(join(dir, 'journal.jsonl'), '');
    journal(dir, { type: 'new', options: session.options });
    console.log(
      `Session ${dir}\n${session.startLines.join('\n')}\n\n${session.view()}\n\n${session.game.help()}`,
    );
    return 0;
  }

  const record = load(dir);
  if (verb === 'log') {
    record.log.forEach((e, i) =>
      console.log(`${String(i + 1).padStart(4)}. ${e.cmd}${e.note ? `   # ${e.note}` : ''}`),
    );
    console.log(`${record.log.length} command(s). Options: ${JSON.stringify(record.options)}`);
    return 0;
  }
  if (verb === 'note') {
    const text = words.slice(1).join(' ');
    journal(dir, { type: 'note', at: record.log.length, note: text });
    console.log('Noted.');
    return 0;
  }
  if (verb === 'fork') {
    const target = sessionDir(words[1]);
    if (!words[1]) throw new PlayError('fork NEW [--at N]');
    if (existsSync(join(target, 'session.json')) && !flags.force)
      throw new PlayError(`${target} exists. Use --force to replace it.`);
    const upTo = flags.at != null ? Number(flags.at) : null;
    const session = await PlaySession.fromRecord(gameData, record, { upTo });
    save(target, session);
    writeFileSync(join(target, 'journal.jsonl'), '');
    journal(target, { type: 'fork', from: dir, at: session.log.length });
    console.log(`Forked ${session.log.length} command(s) to ${target}.\n\n${session.view()}`);
    return 0;
  }

  // --rebase: replay without checking the logged digests and write fresh ones (after
  // a change to the adapter's digest, not to the game; a game change would differ).
  const session = await PlaySession.fromRecord(gameData, record, { verify: !flags.rebase });
  if (flags.rebase) {
    save(dir, session);
    journal(dir, { type: 'rebase', at: session.log.length });
  }
  const line = words.join(' ');
  const commands = line
    .split(';')
    .map((c) => c.trim())
    .filter(Boolean);
  let status = 0;
  let changed = false;
  for (const cmd of commands) {
    if (PlaySession.isQuery(cmd)) {
      const text = await session.query(cmd);
      journal(dir, { type: 'query', at: session.log.length, cmd });
      console.log(text);
      continue;
    }
    try {
      const { lines } = await session.exec(cmd, { note: flags.note || null });
      changed = true;
      journal(dir, {
        type: 'cmd',
        at: session.log.length,
        cmd,
        note: flags.note || null,
        out: lines,
      });
      console.log(`> ${cmd}\n${lines.join('\n')}`);
    } catch (err) {
      if (!(err instanceof PlayError)) throw err;
      journal(dir, { type: 'refused', at: session.log.length, cmd, error: err.message });
      console.log(`> ${cmd}\nREFUSED: ${err.message}`);
      status = 2;
      break;
    }
    if (session.over) break;
  }
  if (changed) save(dir, session);
  if (changed && !flags.brief) console.log(`\n${session.view()}`);
  if (session.over) console.log('\nThe run is over.');
  return status;
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    if (err instanceof PlayError) {
      console.error(`REFUSED: ${err.message}`);
      process.exit(2);
    }
    if (err instanceof ReplayDivergence) {
      console.error(`${err.message}\n(If only the adapter changed, --rebase re-stamps the log.)`);
      process.exit(3);
    }
    console.error(err?.stack || String(err));
    process.exit(1);
  });
