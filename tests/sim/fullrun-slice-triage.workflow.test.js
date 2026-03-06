import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ok = (stdout = '') => ({
  status: 0,
  stdout,
  stderr: '',
});

describe('fullrun-slice-triage workflow', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    process.exitCode = undefined;
  });

  it('walks commits, stops at first failure, and prints attribution contract', async () => {
    const fromSha = '1111111111111111111111111111111111111111';
    const midSha = '2222222222222222222222222222222222222222';
    const badSha = '3333333333333333333333333333333333333333';
    const laterSha = '4444444444444444444444444444444444444444';

    let checkedOutSha = null;

    const spawnSyncMock = vi.fn((command, args) => {
      if (command === 'git' && args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
        return ok('C:/repo\n');
      }
      if (command === 'git' && args[0] === 'rev-parse' && args[1] === '--verify') {
        if (args[2] === 'goodRef^{commit}') return ok(`${fromSha}\n`);
        if (args[2] === 'badRef^{commit}') return ok(`${laterSha}\n`);
        if (args[2] === `${badSha}^`) return ok(`${midSha}\n`);
      }
      if (command === 'git' && args[0] === 'merge-base' && args[1] === '--is-ancestor') {
        return ok('');
      }
      if (command === 'git' && args[0] === 'rev-list') {
        return ok(`${midSha}\n${badSha}\n${laterSha}\n`);
      }
      if (command === 'git' && args[0] === 'worktree' && args[1] === 'add') {
        return ok('');
      }
      if (command === 'git' && args[0] === 'checkout') {
        checkedOutSha = args[2];
        return ok('');
      }
      if (command === process.execPath && String(args[0]).includes('fullrun-slice-runner.js')) {
        if (checkedOutSha === badSha) {
          return {
            status: 1,
            stdout: '--- Threshold Breaches ---\navg_gold=12000.00 > threshold=11000.00\n',
            stderr: '',
          };
        }
        return ok('--- Summary ---\n');
      }
      if (command === 'git' && args[0] === 'diff' && args[1] === '--name-only') {
        return ok('tests/sim/fullrun-slices.js\ndocs/harness-thresholds.md\n');
      }
      if (command === 'git' && args[0] === 'worktree' && args[1] === 'remove') {
        return ok('');
      }
      throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
    });

    const mkdtempSyncMock = vi.fn(() => '/tmp/fullrun-slice-triage-test-worktree');
    const rmSyncMock = vi.fn();

    vi.doMock('child_process', () => ({ spawnSync: spawnSyncMock }));
    vi.doMock('fs', () => ({
      mkdtempSync: mkdtempSyncMock,
      rmSync: rmSyncMock,
    }));
    vi.doMock('os', () => ({
      tmpdir: () => '/tmp',
    }));

    const logLines = [];
    vi.spyOn(console, 'log').mockImplementation((...parts) => {
      logLines.push(parts.join(' '));
    });

    const { main } = await import('./fullrun-slice-triage.js');
    await main(['--slice', 'progression_invincible', '--from', 'goodRef', '--to', 'badRef']);

    const checkoutCommits = spawnSyncMock.mock.calls
      .filter(([command, args]) => command === 'git' && args[0] === 'checkout')
      .map(([, args]) => args[2]);
    expect(checkoutCommits).toEqual([fromSha, midSha, badSha]);

    const runnerCalls = spawnSyncMock.mock.calls.filter(
      ([command, args]) =>
        command === process.execPath && String(args[0]).includes('fullrun-slice-runner.js'),
    );
    expect(runnerCalls.length).toBe(3);
    expect(checkoutCommits.includes(laterSha)).toBe(false);

    expect(logLines.some((line) => line.includes(`first_bad_sha=${badSha}`))).toBe(true);
    expect(logLines.some((line) => line.includes(`parent_sha=${midSha}`))).toBe(true);
    expect(logLines.some((line) => line.includes('- avg_gold=12000.00 > threshold=11000.00'))).toBe(
      true,
    );
    expect(logLines.some((line) => line.includes('- tests/sim/fullrun-slices.js'))).toBe(true);

    expect(mkdtempSyncMock).toHaveBeenCalledTimes(1);
    expect(rmSyncMock).toHaveBeenCalledTimes(1);
  });
});
