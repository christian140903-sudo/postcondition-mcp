import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { CheckResult, FileVerifier } from '../types.js';
import { canonicalJson, parseJsonPointer } from '../util.js';

const MAX_INSPECT_BYTES = 16 * 1024 * 1024;

async function fileHash(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export async function verifyFile(verifier: FileVerifier): Promise<CheckResult> {
  const path = resolve(verifier.path);
  let details;
  try {
    details = await stat(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      const satisfied = verifier.check.op === 'not_exists';
      return {
        verdict: satisfied ? 'satisfied' : 'violated',
        evidenceClass: 'configured_verifier',
        summary: satisfied ? 'The path does not exist, as required.' : 'The required path does not exist.',
        evidence: { kind: 'file', path, exists: false },
      };
    }
    return {
      verdict: 'unknown',
      evidenceClass: 'configured_verifier',
      summary: `The path could not be inspected: ${code ?? 'filesystem error'}.`,
      evidence: { kind: 'file', path, error: code ?? 'filesystem_error' },
    };
  }

  const baseEvidence = {
    kind: 'file',
    path,
    exists: true,
    type: details.isFile() ? 'file' : details.isDirectory() ? 'directory' : 'other',
    size: details.size,
    modifiedAt: details.mtime.toISOString(),
  };

  switch (verifier.check.op) {
    case 'exists':
      return { verdict: 'satisfied', evidenceClass: 'configured_verifier', summary: 'The path exists.', evidence: baseEvidence };
    case 'not_exists':
      return { verdict: 'violated', evidenceClass: 'configured_verifier', summary: 'The path exists but should not.', evidence: baseEvidence };
    case 'min_size': {
      const satisfied = details.size >= verifier.check.bytes;
      return {
        verdict: satisfied ? 'satisfied' : 'violated',
        evidenceClass: 'configured_verifier',
        summary: `Observed ${details.size} bytes; required at least ${verifier.check.bytes}.`,
        evidence: { ...baseEvidence, expectedMinimum: verifier.check.bytes },
      };
    }
    case 'max_size': {
      const satisfied = details.size <= verifier.check.bytes;
      return {
        verdict: satisfied ? 'satisfied' : 'violated',
        evidenceClass: 'configured_verifier',
        summary: `Observed ${details.size} bytes; allowed at most ${verifier.check.bytes}.`,
        evidence: { ...baseEvidence, expectedMaximum: verifier.check.bytes },
      };
    }
    case 'sha256': {
      if (!details.isFile()) return notAFile(baseEvidence);
      const actual = await fileHash(path);
      const expected = verifier.check.equals.toLowerCase();
      return {
        verdict: actual === expected ? 'satisfied' : 'violated',
        evidenceClass: 'configured_verifier',
        summary: actual === expected ? 'The SHA-256 digest matches.' : 'The SHA-256 digest does not match.',
        evidence: { ...baseEvidence, sha256: actual, expectedSha256: expected },
      };
    }
    case 'contains': {
      if (!details.isFile()) return notAFile(baseEvidence);
      if (details.size > MAX_INSPECT_BYTES) return tooLarge(baseEvidence);
      const content = await readFile(path, 'utf8');
      const satisfied = content.includes(verifier.check.text);
      return {
        verdict: satisfied ? 'satisfied' : 'violated',
        evidenceClass: 'configured_verifier',
        summary: satisfied ? 'The file contains the required text.' : 'The file does not contain the required text.',
        evidence: { ...baseEvidence, contains: satisfied, expectedTextSha256: createHash('sha256').update(verifier.check.text).digest('hex') },
      };
    }
    case 'json_equals': {
      if (!details.isFile()) return notAFile(baseEvidence);
      if (details.size > MAX_INSPECT_BYTES) return tooLarge(baseEvidence);
      try {
        const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
        const actual = parseJsonPointer(parsed, verifier.check.pointer);
        const found = actual !== undefined;
        const satisfied = found && canonicalJson(actual) === canonicalJson(verifier.check.value);
        return {
          verdict: satisfied ? 'satisfied' : 'violated',
          evidenceClass: 'configured_verifier',
          summary: satisfied ? 'The JSON value matches.' : 'The JSON value does not match.',
          evidence: { ...baseEvidence, pointer: verifier.check.pointer, found, actual: actual ?? null, expected: verifier.check.value },
        };
      } catch (error) {
        return {
          verdict: 'unknown',
          evidenceClass: 'configured_verifier',
          summary: 'The file could not be parsed as JSON.',
          evidence: { ...baseEvidence, error: error instanceof Error ? error.name : 'json_error' },
        };
      }
    }
  }
}

function notAFile(evidence: Record<string, unknown>): CheckResult {
  return {
    verdict: 'unknown',
    evidenceClass: 'configured_verifier',
    summary: 'This check requires a regular file.',
    evidence: { ...evidence, error: 'not_a_regular_file' },
  };
}

function tooLarge(evidence: Record<string, unknown>): CheckResult {
  return {
    verdict: 'unknown',
    evidenceClass: 'configured_verifier',
    summary: `Content inspection is limited to ${MAX_INSPECT_BYTES} bytes. Use a digest check for larger files.`,
    evidence: { ...evidence, error: 'inspection_limit', inspectionLimit: MAX_INSPECT_BYTES },
  };
}
