// The headless play CLI (tools/play/cli.js): each call rebuilds the session from its
// log, so these drive it as an agent does, one process per command.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'tools', 'play', 'cli.js');
let root;

function play(session, ...args) {
  const out = spawnSync(process.execPath, [CLI, ...args, '--session', join(root, session)], {
    encoding: 'utf8',
  });
  return { code: out.status, out: out.stdout + out.stderr };
}

const record = (session) => JSON.parse(readFileSync(join(root, session, 'session.json'), 'utf8'));
const journal = (session) =>
  readFileSync(join(root, session, 'journal.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));

describe('play CLI', () => {
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'play-cli-'));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('plays, refuses, notes, forks and catches a changed log', () => {
    const made = play('a', 'new', '--seed', '3');
    expect(made.code).toBe(0);
    expect(made.out).toMatch(/BLESSING/);
    expect(play('a', 'new').code).toBe(2); // never replaces a session without --force

    const turn = play('a', 'bless skip; go act1_0_2; start', '--note', 'opening');
    expect(turn.code).toBe(0);
    expect(turn.out).toMatch(/Formation set/);
    expect(turn.out).toMatch(/== BATTLE/);
    expect(record('a').log.map((e) => e.cmd)).toEqual(['bless skip', 'go act1_0_2', 'start']);
    // --note belongs to the first command that changes the game.
    expect(record('a').log.map((e) => e.note ?? null)).toEqual(['opening', null, null]);

    const refused = play('a', 'move P1 99,99 wait');
    expect(refused.code).toBe(2);
    expect(refused.out).toMatch(/REFUSED/);
    expect(record('a').log).toHaveLength(3);

    // A refusal mid-chain, even a query's, keeps what ran before it and names what did not.
    const chain = play('a', 'move P1 stay wait; forecast P1 0,0 E9; move P2 stay wait');
    expect(chain.code).toBe(2);
    expect(chain.out).toMatch(/Not run: move P2 stay wait/);
    expect(
      record('a')
        .log.map((e) => e.cmd)
        .at(-1),
    ).toBe('move P1 stay wait');
    expect(record('a').log).toHaveLength(4);

    expect(play('a', 'options P1').code).toBe(0);
    expect(play('a', 'note', 'the right flank is open').code).toBe(0);
    const kinds = journal('a').map((e) => e.type);
    expect(kinds).toEqual([
      'new',
      'cmd',
      'cmd',
      'cmd',
      'refused',
      'cmd',
      'refused',
      'query',
      'note',
    ]);
    expect(journal('a').at(-1).note).toBe('the right flank is open');

    expect(play('a', 'fork', join(root, 'b'), '--at', '2').code).toBe(0);
    expect(record('a').log).toHaveLength(4);
    expect(record('b').log.map((e) => e.cmd)).toEqual(['bless skip', 'go act1_0_2']);
    expect(play('b', 'look', '--brief').out).toMatch(/FORMATION/);

    const tampered = record('a');
    tampered.log[1].digest = 'ffffffffffffffff';
    writeFileSync(join(root, 'a', 'session.json'), JSON.stringify(tampered));
    const diverged = play('a', 'look');
    expect(diverged.code).toBe(3);
    expect(diverged.out).toMatch(/diverged at command 2/);
    expect(play('a', 'look', '--rebase', '--brief').code).toBe(0);
    expect(play('a', 'look').code).toBe(0);
  });
});
