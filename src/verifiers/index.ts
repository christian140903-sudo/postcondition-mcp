import type { CheckResult, Verifier } from '../types.js';
import { verifyFile } from './file.js';
import { verifyGit } from './git.js';
import { verifyHttp } from './http.js';
import { verifyNpm } from './npm.js';

export async function runVerifier(verifier: Verifier): Promise<CheckResult> {
  switch (verifier.kind) {
    case 'file': return verifyFile(verifier);
    case 'http': return verifyHttp(verifier);
    case 'git': return verifyGit(verifier);
    case 'npm': return verifyNpm(verifier);
    case 'manual':
      return {
        verdict: 'unknown',
        evidenceClass: 'manual_attestation',
        summary: 'This postcondition requires an explicit manual attestation.',
        evidence: { kind: 'manual', instructions: verifier.instructions },
      };
  }
}
