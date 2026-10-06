// The headless play CLI (tools/play/cliMain.js): each call rebuilds the session from
// its log, so most of these drive it as an agent does, one process per call. The
// failure paths (a view that fails after a command, an engine fault, a held lock,
// two writers, an interrupted save) are driven directly.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import * as fs from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli, EXIT } from '../../tools/play/cliMain.js';
import { acquireLock, writeFileAtomic } from '../../tools/play/store.js';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'tools', 'play', 'cli.js');
let root;

function play(session, ...args) {
  const out = spawnSync(process.execPath, [CLI, ...args, '--session', join(root, session)], {
    encoding: 'utf8',
    env: { ...process.env, PLAY_LOCK_WAIT_MS: '300' },
  });
  return { code: out.status, out: out.stdout + out.stderr };
}

function playAsync(session, ...args) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [CLI, ...args, '--session', join(root, session)], {
      env: { ...process.env, PLAY_LOCK_WAIT_MS: '60000' },
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => done({ code, out }));
  });
}

async function playHere(session, args, onSession = null, inject = null) {
  const printed = [];
  const code = await runCli([...args, '--session', join(root, session)], {
    print: (text) => printed.push(String(text)),
    onSession,
    inject,
  });
  return { code, out: printed.join('\n') };
}

const file = (session, name) => join(root, session, name);
const record = (session) => JSON.parse(readFileSync(file(session, 'session.json'), 'utf8'));
const journal = (session) =>
  readFileSync(file(session, 'journal.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));

describe('play CLI', () => {
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'play-cli-'));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('plays, refuses, notes and forks, journaling what it printed', () => {
    const made = play('a', 'new', '--seed', '3', '--agent', 'pilot agent, notes on');
    expect(made.code).toBe(0);
    expect(made.out).toMatch(/BLESSING/);
    expect(play('a', 'new').code).toBe(EXIT.refused); // never replaces a session without --force
    const manifest = JSON.parse(readFileSync(file('a', 'manifest.json'), 'utf8'));
    expect(manifest.options.seed).toBe(3);
    expect(manifest.agent).toEqual({ description: 'pilot agent, notes on' });
    expect(manifest.data).toMatch(/^[0-9a-f]{16}$/);
    expect(manifest.unsupported.map((u) => u.id)).toContain('ballista');

    const turn = play('a', 'bless skip; go act1_0_2; start', '--note', 'opening');
    expect(turn.code).toBe(0);
    expect(turn.out).toMatch(/Formation set/);
    expect(turn.out).toMatch(/== BATTLE/);
    expect(turn.out).toMatch(/\(rev 3\)/);
    expect(record('a').log.map((e) => e.cmd)).toEqual(['bless skip', 'go act1_0_2', 'start']);
    expect(record('a').revision).toBe(3);
    // --note belongs to the first command that changes the game.
    expect(record('a').log.map((e) => e.note ?? null)).toEqual(['opening', null, null]);

    const refused = play('a', 'move P1 99,99 wait');
    expect(refused.code).toBe(EXIT.refused);
    expect(refused.out).toMatch(/REFUSED/);
    expect(record('a').log).toHaveLength(3);

    // A refusal mid-chain, even a query's, keeps what ran before it and names what did not.
    const chain = play('a', 'move P1 stay wait; forecast P1 0,0 E9; move P2 stay wait');
    expect(chain.code).toBe(EXIT.refused);
    expect(chain.out).toMatch(/Not run: move P2 stay wait/);
    expect(record('a').log.at(-1).cmd).toBe('move P1 stay wait');
    expect(record('a').log).toHaveLength(4);

    const asked = play('a', 'options P2');
    expect(asked.code).toBe(0);
    expect(play('a', 'note', 'the right flank is open').code).toBe(0);

    // The journal holds what was shown, not only what was typed: every query's answer
    // and the view after each call that changed the game, exactly as printed.
    const entries = journal('a');
    const query = entries.find((e) => e.type === 'query');
    expect(query.cmd).toBe('options P2');
    expect(asked.out).toContain(query.out);
    expect(query.out).toMatch(/Reachable tiles/);
    const views = entries.filter((e) => e.type === 'view');
    expect(views).toHaveLength(3); // after new, after the opening chain, after the partial chain
    expect(turn.out).toContain(views[1].out);
    const cmds = entries.filter((e) => e.type === 'cmd');
    expect(cmds.map((e) => e.cmd)).toEqual(record('a').log.map((e) => e.cmd));
    expect(cmds.map((e) => e.digest)).toEqual(record('a').log.map((e) => e.digest));
    expect(entries.filter((e) => e.type === 'refused').map((e) => e.cmd)).toEqual([
      'move P1 99,99 wait',
      'forecast P1 0,0 E9',
    ]);
    expect(entries.at(-1)).toMatchObject({ type: 'note', note: 'the right flank is open' });

    expect(play('a', 'fork', join(root, 'b'), '--at', '2').code).toBe(0);
    expect(record('a').log).toHaveLength(4);
    expect(record('b').log.map((e) => e.cmd)).toEqual(['bless skip', 'go act1_0_2']);
    expect(JSON.parse(readFileSync(file('b', 'manifest.json'), 'utf8')).forkedFrom).toMatchObject({
      at: 2,
      revision: 4,
    });
    expect(play('b', 'look', '--brief').out).toMatch(/FORMATION/);
  });

  it('stops on a changed log and rebases into a new session, leaving the original whole', () => {
    expect(play('r', 'new', '--seed', '3').code).toBe(0);
    expect(play('r', 'bless skip; go act1_0_2').code).toBe(0);
    const tampered = record('r');
    tampered.log[0].digest = 'ffffffffffffffff';
    writeFileSync(file('r', 'session.json'), JSON.stringify(tampered));
    const original = readFileSync(file('r', 'session.json'), 'utf8');

    const diverged = play('r', 'look');
    expect(diverged.code).toBe(EXIT.replay);
    expect(diverged.out).toMatch(/diverged at command 1/);
    // The old in-place re-stamp is gone.
    expect(play('r', 'look', '--rebase').code).toBe(EXIT.refused);

    const rebased = play('r', 'rebase', join(root, 'r2'));
    expect(rebased.code).toBe(0);
    expect(rebased.out).toMatch(/1 digest\(s\) changed, first at command 1/);
    expect(readFileSync(file('r', 'session.json'), 'utf8')).toBe(original);
    const derived = record('r2');
    expect(derived.provenance).toMatchObject({ commands: 2, changed: [1], sourceRevision: 2 });
    expect(derived.log[1].digest).toBe(tampered.log[1].digest);
    expect(derived.log[0].digest).not.toBe('ffffffffffffffff');
    expect(JSON.parse(readFileSync(file('r2', 'manifest.json'), 'utf8')).rebasedFrom.revision).toBe(
      2,
    );
    expect(play('r2', 'look', '--brief').code).toBe(0);
  });

  it('runs a call with an id at most once, and refuses a stale revision', () => {
    expect(play('i', 'new', '--seed', '3').code).toBe(0);
    expect(play('i', 'bless skip', '--id', 'k1').code).toBe(0);
    const again = play('i', 'bless skip', '--id', 'k1');
    expect(again.code).toBe(0);
    expect(again.out).toMatch(/already applied/);
    expect(record('i').log.map((e) => e.cmd)).toEqual(['bless skip']);
    expect(record('i').log[0].call).toBe('k1');

    const stale = play('i', 'store Edric Steel Sword', '--expect-rev', '0');
    expect(stale.code).toBe(EXIT.busy);
    expect(stale.out).toMatch(/Expected session revision 0, but it is at 1/);
    expect(record('i').log).toHaveLength(1);
    expect(play('i', 'store Edric Steel Sword', '--expect-rev', '1').code).toBe(0);
    expect(record('i').revision).toBe(2);
  });

  it('concludes a run on request: queries still answer, commands are refused', () => {
    expect(play('s', 'new', '--seed', '3').code).toBe(0);
    expect(play('s', 'stop', 'sideways', 'why').code).toBe(EXIT.refused);
    expect(play('s', 'stop', 'voluntary', 'out of time budget').code).toBe(0);
    expect(record('s').outcome).toMatchObject({ kind: 'voluntary', reason: 'out of time budget' });
    expect(play('s', 'look', '--brief').code).toBe(0);
    const after = play('s', 'bless skip');
    expect(after.code).toBe(EXIT.refused);
    expect(after.out).toMatch(/concluded \(voluntary\)/);
    expect(journal('s').some((e) => e.type === 'outcome' && e.kind === 'voluntary')).toBe(true);
  });

  it('keeps a command whose view then fails to render, and says so', async () => {
    expect((await playHere('v', ['new', '--seed', '3'])).code).toBe(0);
    const failed = await playHere('v', ['bless skip'], (session) => {
      session.view = () => {
        throw new Error('view broke');
      };
    });
    expect(failed.code).toBe(EXIT.observation);
    expect(failed.out).toMatch(/saved, but the view after them failed to render/);
    // Committed and durable: the next call finds it in the log.
    expect(record('v').log.map((e) => e.cmd)).toEqual(['bless skip']);
    expect(journal('v').some((e) => e.type === 'observationFault')).toBe(true);
    const next = await playHere('v', ['look']);
    expect(next.code).toBe(0);
    expect(next.out).toMatch(/Army:/);
  });

  it('rolls back an engine fault, keeps what ran before it, and reports it apart from refusals', async () => {
    expect((await playHere('f', ['new', '--seed', '3'])).code).toBe(0);
    const faulted = await playHere('f', ['bless skip; store Edric Steel Sword'], (session) => {
      const game = session.game;
      const exec = game.exec.bind(game);
      game.exec = async (line) => {
        if (!line.startsWith('store')) return exec(line);
        game.rm.gold += 999; // a change made before the fault
        throw new TypeError('engine exploded');
      };
    });
    expect(faulted.code).toBe(EXIT.fault);
    expect(faulted.out).toMatch(/ENGINE FAULT: TypeError: engine exploded/);
    expect(record('f').log.map((e) => e.cmd)).toEqual(['bless skip']);
    const fault = journal('f').find((e) => e.type === 'fault');
    expect(fault).toMatchObject({ cmd: 'store Edric Steel Sword', error: 'engine exploded' });
    expect(fault.stack).toMatch(/TypeError/);
    const look = await playHere('f', ['roster']);
    expect(look.out).toMatch(/Steel Sword/);
    expect(look.out).not.toMatch(/999/);
  });

  it('--json gives each step and the state as data; --same-turn stops at the turn', async () => {
    expect((await playHere('j', ['new', '--seed', '3'])).code).toBe(0);
    const call = await playHere('j', [
      'bless skip; go act1_0_2; start; move P1 99,99 wait; look',
      '--json',
    ]);
    expect(call.code).toBe(EXIT.refused);
    const out = JSON.parse(call.out);
    expect(out.results.map((r) => [r.cmd, r.kind])).toEqual([
      ['bless skip', 'played'],
      ['go act1_0_2', 'played'],
      ['start', 'played'],
      ['move P1 99,99 wait', 'refused'],
      ['look', 'not run'],
    ]);
    expect(out.rev).toBe(3);
    expect(out.observation.phase).toBe('battle');
    expect(out.observation.battle.turn).toBe(1);
    const army = out.observation.battle.army;
    expect(army.map((u) => u.id)).toEqual(['P1', 'P2', 'P3']);
    expect(army[0].reachable).toContain(`${army[0].col},${army[0].row}`);

    // Three waits end turn 1 by themselves; --same-turn keeps the fourth order for turn 1 only.
    const chain = await playHere('j', [
      'move P1 stay wait; move P2 stay wait; move P3 stay wait; move P1 stay wait',
      '--same-turn',
    ]);
    expect(chain.code).toBe(EXIT.ok);
    expect(chain.out).toMatch(
      /The turn or phase moved on \(--same-turn\)\. Not run: move P1 stay wait/,
    );
    expect(
      record('j')
        .log.map((e) => e.cmd)
        .slice(-3),
    ).toEqual(['move P1 stay wait', 'move P2 stay wait', 'move P3 stay wait']);
  });

  it('notices an unmodelled mechanic in reach once, journals it and prints it', async () => {
    expect((await playHere('u', ['new', '--seed', '3'])).code).toBe(0);
    const staff = (session) => {
      const sera = session.game.rm.roster.find((u) => u.name === 'Sera');
      sera.inventory.push(
        structuredClone(session.gameData.weapons.find((w) => w.name === 'Rescue Staff')),
      );
    };
    const first = await playHere('u', ['bless skip'], staff);
    expect(first.out).toMatch(
      /\(Not modelled: Sera carries Rescue Staff: relocation staves are not modelled headless\.\)/,
    );
    const notices = journal('u').filter((e) => e.type === 'unsupported');
    expect(notices).toEqual([
      expect.objectContaining({ id: 'relocation-staves', key: 'relocate:Sera:Rescue Staff' }),
    ]);
    expect(record('u').noticed).toEqual(['relocate:Sera:Rescue Staff']);
    // Noticed once: the next command with the staff still carried says nothing more.
    const second = await playHere('u', ['store Edric Steel Sword'], staff);
    expect(second.out).not.toMatch(/Not modelled/);
    expect(journal('u').filter((e) => e.type === 'unsupported')).toHaveLength(1);
  });

  it('waits for a held lock, takes over a dead one, and serialises two writers', async () => {
    expect(play('l', 'new', '--seed', '3').code).toBe(0);
    expect(play('l', 'bless skip').code).toBe(0);
    const release = acquireLock(join(root, 'l'));
    const busy = play('l', 'store Edric Steel Sword');
    expect(busy.code).toBe(EXIT.busy);
    expect(busy.out).toMatch(/is busy/);
    expect(record('l').log).toHaveLength(1);
    release();

    // A lock whose process is gone is stale.
    writeFileSync(
      file('l', 'session.lock'),
      JSON.stringify({ pid: 2 ** 22 + 12345, host: hostname(), at: 'then' }),
    );
    expect(play('l', 'look', '--brief').code).toBe(0);
    expect(existsSync(file('l', 'session.lock'))).toBe(false);

    // Two calls at once: both commands land, one after the other.
    const [a, b] = await Promise.all([
      playAsync('l', 'store Edric Steel Sword'),
      playAsync('l', 'store Gaspar Iron Sword'),
    ]);
    expect([a.code, b.code]).toEqual([0, 0]);
    const log = record('l').log.map((e) => e.cmd);
    expect(log).toHaveLength(3);
    expect(log.slice(1).sort()).toEqual(['store Edric Steel Sword', 'store Gaspar Iron Sword']);
    expect(record('l').revision).toBe(3);
  });

  // --- what a failure after the game ran says happened ---

  /** A session in battle on turn 1 (orders there carry diagnostics). */
  async function inBattle(name) {
    expect((await playHere(name, ['new', '--seed', '3'])).code).toBe(0);
    expect((await playHere(name, ['bless skip; go act1_0_2; start'])).code).toBe(0);
    return record(name).log.length;
  }
  const failAt =
    (point, when = () => true) =>
    (p, detail) => {
      if (p === point && when(detail)) throw new Error(`injected ${point} failure`);
    };

  it('a diagnostics write that fails after the save: the command stands and says so', async () => {
    const before = await inBattle('d');
    const call = await playHere('d', ['move P1 stay wait'], null, failAt('diagnostics'));
    expect(call.code).toBe(EXIT.afterSave);
    expect(call.out).toMatch(new RegExp(`Saved at rev ${before + 1} and its report journaled`));
    expect(call.out).not.toMatch(/rolled back/);
    // A new call finds it played, journaled with what was shown.
    expect(
      record('d')
        .log.map((e) => e.cmd)
        .at(-1),
    ).toBe('move P1 stay wait');
    expect(
      journal('d')
        .filter((e) => e.type === 'cmd')
        .at(-1),
    ).toMatchObject({
      cmd: 'move P1 stay wait',
      rev: before + 1,
    });
    expect((await playHere('d', ['look'])).out).toMatch(/P1 .*\[done\]/);
  });

  it('a journal write that fails after the save: saved, and its report withheld', async () => {
    const before = await inBattle('w');
    const call = await playHere(
      'w',
      ['move P1 stay wait; move P2 stay wait'],
      null,
      failAt('journal', (e) => e.type === 'cmd'),
    );
    expect(call.code).toBe(EXIT.afterSave);
    expect(call.out).toMatch(
      new RegExp(`SAVED at rev ${before + 1}, but its report could not be journaled`),
    );
    expect(call.out).toMatch(/Not run: move P2 stay wait/);
    expect(
      record('w')
        .log.map((e) => e.cmd)
        .slice(before),
    ).toEqual(['move P1 stay wait']);
  });

  it('a save that fails: the command does not count and nothing it did is shown', async () => {
    const before = await inBattle('n');
    const view = await playHere('n', ['look']);
    const call = await playHere(
      'n',
      ['move P1 stay wait; move P2 stay wait'],
      null,
      failAt('save'),
    );
    expect(call.code).toBe(EXIT.notSaved);
    expect(call.out).toMatch(
      new RegExp(`NOT SAVED: injected save failure.*still at rev ${before}`, 's'),
    );
    expect(call.out).not.toMatch(/== BATTLE/); // no view of a game the disk does not hold
    expect(call.out).not.toMatch(/Edric/); // not even the command's own report
    expect(record('n').log).toHaveLength(before);
    expect(journal('n').at(-1)).toMatchObject({
      type: 'notSaved',
      rev: before,
      cmd: 'move P1 stay wait',
    });
    // The next call plays from the disk, as if the failed command had never run.
    expect((await playHere('n', ['look'])).out).toBe(view.out);
  });

  it('a fault whose rollback fails: nothing is saved and nothing more runs or shows', async () => {
    const before = await inBattle('rb');
    const call = await playHere('rb', ['move P1 stay wait; look'], (session) => {
      session.game.exec = async () => {
        session.game.rm.gold += 5;
        throw new TypeError('engine exploded');
      };
      session._rebuild = async () => {
        throw new Error('rebuild failed too');
      };
    });
    expect(call.code).toBe(EXIT.fault);
    expect(call.out).toMatch(/could not be restored in memory \(rebuild failed too\)/);
    expect(call.out).not.toMatch(/rolled back \(/);
    expect(call.out).toMatch(/Not run: look/);
    expect(record('rb').log).toHaveLength(before);
    expect(journal('rb').find((e) => e.type === 'fault')).toMatchObject({ rollback: 'failed' });
  });

  it('a fork whose target appears before it is locked never overwrites it', async () => {
    expect((await playHere('src', ['new', '--seed', '3'])).code).toBe(0);
    expect((await playHere('other', ['new', '--seed', '5'])).code).toBe(0);
    const theirs = record('other');
    // Another call creates the target between this one's decision and its lock.
    const call = await playHere('src', ['fork', join(root, 'tgt')], null, (point, target) => {
      if (point === 'claim') fs.cpSync(join(root, 'other'), target, { recursive: true });
    });
    expect(call.code).toBe(EXIT.refused);
    expect(call.out).toMatch(/exists\. Use --force/);
    expect(JSON.parse(readFileSync(join(root, 'tgt', 'session.json'), 'utf8'))).toEqual(theirs);
  });

  // --- the report ---

  it('the report verifies the replay: a changed digest is refused, as look refuses it', async () => {
    expect((await playHere('rp', ['new', '--seed', '3'])).code).toBe(0);
    expect((await playHere('rp', ['bless skip; go act1_0_2'])).code).toBe(0);
    expect((await playHere('rp', ['report'])).code).toBe(EXIT.ok);
    const verified = readFileSync(file('rp', 'report.json'), 'utf8');
    expect(JSON.parse(verified).verification).toMatchObject({ verified: true, divergedAt: [] });
    const rec = record('rp');
    rec.log[1].digest = '0000000000000000';
    writeFileSync(file('rp', 'session.json'), JSON.stringify(rec));
    expect((await playHere('rp', ['look'])).code).toBe(EXIT.replay);
    const report = await playHere('rp', ['report']);
    expect(report.code).toBe(EXIT.replay);
    expect(report.out).toMatch(/command 2/);
    expect(readFileSync(file('rp', 'report.json'), 'utf8')).toBe(verified);
    // Asked for, an unverified reconstruction is labelled and kept apart.
    const loose = await playHere('rp', ['report', '--unverified']);
    expect(loose.code).toBe(EXIT.ok);
    expect(loose.out).toMatch(/UNVERIFIED reconstruction.*1 diverged, first at command 2/);
    const written = JSON.parse(readFileSync(file('rp', 'report.unverified.json'), 'utf8'));
    expect(written.verification).toMatchObject({ verified: false, divergedAt: [2] });
    expect(written.verification.reconstruction).toMatchObject({ reportVersion: 2 });
    expect(readFileSync(file('rp', 'report.json'), 'utf8')).toBe(verified);
  });

  // --- --json: one response object for every outcome ---

  it('--json answers every outcome with one versioned object, journaled as printed', async () => {
    const json = async (session, args, ...rest) => {
      const r = await playHere(session, [...args, '--json'], ...rest);
      const parsed = JSON.parse(r.out); // the whole output is one object
      expect(parsed.response).toBe(1);
      expect(parsed.exit).toBe(r.code);
      return parsed;
    };
    const lastResponse = (session) =>
      journal(session)
        .filter((e) => e.type === 'response')
        .at(-1);

    expect((await json('k', ['new', '--seed', '3'])).observation.phase).toBe('blessing');
    // A query-only call and a call that changes the game: each journaled exactly.
    const query = await json('k', ['look']);
    expect(query.status).toBe('ok');
    expect(lastResponse('k').response).toEqual(query);
    const played = await json('k', ['bless skip; go act1_0_2'], null, null);
    expect(played.results.map((r) => r.kind)).toEqual(['played', 'played']);
    expect(lastResponse('k').response).toEqual(played);
    expect(lastResponse('k').rev).toBe(played.rev);

    expect((await json('k', ['move P1 99,99 wait'])).status).toBe('refused');
    expect((await json('k', ['start', '--id', 'x1'])).status).toBe('ok');
    const dup = await json('k', ['start', '--id', 'x1']);
    expect(dup).toMatchObject({ status: 'duplicate', call: 'x1' });
    expect(dup.observation.phase).toBe('battle');
    expect((await json('k', ['look', '--expect-rev', '0'])).status).toBe('revisionMismatch');
    const release = acquireLock(join(root, 'k'));
    const wait = process.env.PLAY_LOCK_WAIT_MS;
    process.env.PLAY_LOCK_WAIT_MS = '100';
    try {
      expect((await json('k', ['look'], null, null)).status).toBe('busy');
    } finally {
      process.env.PLAY_LOCK_WAIT_MS = wait;
      if (wait === undefined) delete process.env.PLAY_LOCK_WAIT_MS;
      release();
    }
    const fault = await json('k', ['move P1 stay wait'], (session) => {
      session.game.exec = async () => {
        throw new TypeError('engine exploded');
      };
    });
    expect(fault).toMatchObject({
      status: 'fault',
      results: [{ kind: 'fault', rollback: 'verified' }],
    });
    const unsaved = await json('k', ['move P1 stay wait'], null, failAt('save'));
    expect(unsaved).toMatchObject({ status: 'notSaved', observation: null });
    const after = await json('k', ['move P1 stay wait'], null, failAt('diagnostics'));
    expect(after.status).toBe('savedButUnreported');
    expect(after.results[0].recordError).toMatch(/injected diagnostics failure/);
    expect((await json('k', ['fork', join(root, 'k2')])).status).toBe('ok');
    expect((await json('k', ['log'])).log.length).toBe(record('k').log.length);
    expect((await json('k', ['report'])).report.reportVersion).toBe(2);
    expect((await json('nobody', ['look'])).status).toBe('refused');
    // A response that cannot be journaled is withheld, saying what was saved.
    const blind = await json(
      'k',
      ['move P2 stay wait'],
      null,
      failAt('journal', (e) => e.type === 'response'),
    );
    expect(blind).toMatchObject({ status: 'savedButUnreported', observation: null });
    expect(blind.error.message).toMatch(/1 command\(s\) were saved/);
    const rec = record('k');
    rec.log[0].digest = '0000000000000000';
    writeFileSync(file('k', 'session.json'), JSON.stringify(rec));
    expect((await json('k', ['look'])).status).toBe('replayFailed');
  }, 60000);
});

describe('writeFileAtomic', () => {
  const failing = (step) => ({
    ...fs,
    writeSync: (...args) => {
      if (step === 'write') throw new Error('disk full');
      return fs.writeSync(...args);
    },
    renameSync: (...args) => {
      if (step === 'rename') throw new Error('killed');
      return fs.renameSync(...args);
    },
  });

  it('leaves the old file whole when a write or the rename fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'play-atomic-'));
    try {
      const target = join(dir, 'session.json');
      writeFileSync(target, '{"old":true}');
      for (const step of ['write', 'rename']) {
        expect(() => writeFileAtomic(target, '{"new":true}', failing(step))).toThrow();
        expect(readFileSync(target, 'utf8')).toBe('{"old":true}');
        expect(readdirSync(dir)).toEqual(['session.json']);
      }
      writeFileAtomic(target, '{"new":true}');
      expect(readFileSync(target, 'utf8')).toBe('{"new":true}');
      expect(readdirSync(dir)).toEqual(['session.json']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
