import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyGit } from '../src/verifiers/git.js';

let repo: string;
let head: string;

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

before(async () => {
  repo = await mkdtemp(join(tmpdir(), 'postcondition-git-'));
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'tests@example.invalid']);
  git(['config', 'user.name', 'Postcondition Tests']);
  await writeFile(join(repo, 'README.md'), '# fixture\n');
  git(['add', 'README.md']);
  git(['commit', '-m', 'fixture']);
  git(['tag', 'v1.0.0']);
  git(['remote', 'add', 'origin', '.']);
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  head = git(['rev-parse', 'HEAD']);
});

test('git branch check observes the current branch', async () => {
  assert.equal((await verifyGit({ kind: 'git', cwd: repo, check: { op: 'branch', equals: 'main' } })).verdict, 'satisfied');
  assert.equal((await verifyGit({ kind: 'git', cwd: repo, check: { op: 'branch', equals: 'other' } })).verdict, 'violated');
});

test('git clean check detects working-tree changes without exposing content', async () => {
  assert.equal((await verifyGit({ kind: 'git', cwd: repo, check: { op: 'clean' } })).verdict, 'satisfied');
  await writeFile(join(repo, 'untracked.txt'), 'private test content');
  const dirty = await verifyGit({ kind: 'git', cwd: repo, check: { op: 'clean' } });
  assert.equal(dirty.verdict, 'violated');
  assert.equal(JSON.stringify(dirty.evidence).includes('private test content'), false);
  assert.equal((await verifyGit({ kind: 'git', cwd: repo, check: { op: 'clean', equals: false } })).verdict, 'satisfied');
});

test('git head check resolves symbolic or abbreviated expectations', async () => {
  assert.equal((await verifyGit({ kind: 'git', cwd: repo, check: { op: 'head', equals: head.slice(0, 10) } })).verdict, 'satisfied');
});

test('git tag check resolves an annotated target commit', async () => {
  const result = await verifyGit({ kind: 'git', cwd: repo, check: { op: 'tag_exists', tag: 'v1.0.0' } });
  assert.equal(result.verdict, 'satisfied');
  assert.equal(result.evidence.commit, head);
});

test('missing git tags produce unknown because observation failed', async () => {
  const result = await verifyGit({ kind: 'git', cwd: repo, check: { op: 'tag_exists', tag: 'missing' } });
  assert.equal(result.verdict, 'unknown');
});

test('remote_contains checks local remote-tracking refs without a network call', async () => {
  const result = await verifyGit({ kind: 'git', cwd: repo, check: { op: 'remote_contains', commit: head, remote: 'origin' } });
  assert.equal(result.verdict, 'satisfied');
  assert.match(String(result.evidence.note), /does not contact/);
});

test('non-repositories produce unknown rather than false evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'postcondition-not-git-'));
  const result = await verifyGit({ kind: 'git', cwd: dir, check: { op: 'clean' } });
  assert.equal(result.verdict, 'unknown');
});
