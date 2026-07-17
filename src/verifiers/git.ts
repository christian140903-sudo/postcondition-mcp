import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import type { CheckResult, GitVerifier } from '../types.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout: 15_000,
    maxBuffer: 2 * 1024 * 1024,
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LC_ALL: 'C' },
  });
  return stdout.trim();
}

export async function verifyGit(verifier: GitVerifier): Promise<CheckResult> {
  const cwd = resolve(verifier.cwd);
  const base = { kind: 'git', cwd };
  try {
    const repository = await git(cwd, ['rev-parse', '--show-toplevel']);
    const check = verifier.check;
    switch (check.op) {
      case 'branch': {
        const actual = await git(cwd, ['branch', '--show-current']);
        const satisfied = actual === check.equals;
        return result(satisfied, `Observed branch ${actual || '(detached)'}; expected ${check.equals}.`, { ...base, repository, branch: actual, expectedBranch: check.equals });
      }
      case 'clean': {
        const porcelain = await git(cwd, ['status', '--porcelain=v1', '--untracked-files=normal']);
        const clean = porcelain.length === 0;
        const expected = check.equals ?? true;
        return result(clean === expected, `The working tree is ${clean ? 'clean' : 'dirty'}; expected ${expected ? 'clean' : 'dirty'}.`, {
          ...base,
          repository,
          clean,
          expectedClean: expected,
          changedEntries: porcelain ? porcelain.split('\n').length : 0,
        });
      }
      case 'head': {
        const actual = await git(cwd, ['rev-parse', 'HEAD']);
        const expected = await git(cwd, ['rev-parse', `${check.equals}^{commit}`]);
        return result(actual === expected, actual === expected ? 'HEAD matches the required commit.' : 'HEAD does not match the required commit.', {
          ...base,
          repository,
          head: actual,
          expectedHead: expected,
        });
      }
      case 'tag_exists': {
        const commit = await git(cwd, ['rev-parse', `refs/tags/${check.tag}^{commit}`]);
        return result(true, `Tag ${check.tag} resolves to a commit.`, { ...base, repository, tag: check.tag, commit });
      }
      case 'remote_contains': {
        const remote = check.remote ?? 'origin';
        if (!/^[A-Za-z0-9._-]+$/.test(remote)) throw new Error('Invalid remote name.');
        const commit = await git(cwd, ['rev-parse', `${check.commit}^{commit}`]);
        const refs = await git(cwd, [
          'for-each-ref',
          '--format=%(refname:short)',
          `--contains=${commit}`,
          `refs/remotes/${remote}/`,
        ]);
        const branches = refs ? refs.split('\n').filter(Boolean) : [];
        return result(branches.length > 0, branches.length > 0 ? 'A local remote-tracking ref contains the commit.' : 'No local remote-tracking ref contains the commit.', {
          ...base,
          repository,
          remote,
          commit,
          containingRefs: branches,
          note: 'This check uses locally fetched remote-tracking refs and does not contact the remote.',
        });
      }
    }
  } catch (error) {
    return {
      verdict: 'unknown',
      evidenceClass: 'configured_verifier',
      summary: error instanceof Error ? error.message : 'Git observation failed.',
      evidence: { ...base, error: error instanceof Error ? error.name : 'git_error' },
    };
  }
}

function result(satisfied: boolean, summary: string, evidence: Record<string, unknown>): CheckResult {
  return {
    verdict: satisfied ? 'satisfied' : 'violated',
    evidenceClass: 'configured_verifier',
    summary,
    evidence,
  };
}
