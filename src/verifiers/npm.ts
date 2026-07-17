import type { CheckResult, NpmVerifier } from '../types.js';
import { fetchSafe } from './network.js';
import { safeUrl } from '../util.js';

function encodePackage(name: string): string {
  return name.startsWith('@') ? name.replace('/', '%2f') : encodeURIComponent(name);
}

export async function verifyNpm(verifier: NpmVerifier): Promise<CheckResult> {
  const registry = (verifier.registry ?? 'https://registry.npmjs.org').replace(/\/$/, '');
  const url = `${registry}/${encodePackage(verifier.package)}`;
  const base = { kind: 'npm', package: verifier.package, registry: safeUrl(registry) };
  try {
    const response = await fetchSafe(url, 15_000);
    if (response.status === 404) {
      await response.body?.cancel();
      return {
        verdict: 'violated',
        evidenceClass: 'externally_observed',
        summary: `Package ${verifier.package} is not published in the registry.`,
        evidence: { ...base, status: 404 },
      };
    }
    if (!response.ok) {
      await response.body?.cancel();
      return {
        verdict: 'unknown',
        evidenceClass: 'externally_observed',
        summary: `The npm registry returned HTTP ${response.status}.`,
        evidence: { ...base, status: response.status },
      };
    }
    const data = await response.json() as { versions?: Record<string, unknown>; 'dist-tags'?: Record<string, string> };
    if (verifier.check.op === 'version_exists') {
      const exists = Object.hasOwn(data.versions ?? {}, verifier.check.version);
      return {
        verdict: exists ? 'satisfied' : 'violated',
        evidenceClass: 'externally_observed',
        summary: exists ? `Version ${verifier.check.version} is published.` : `Version ${verifier.check.version} is not published.`,
        evidence: { ...base, version: verifier.check.version, exists },
      };
    }
    const actual = data['dist-tags']?.[verifier.check.tag];
    const satisfied = actual === verifier.check.equals;
    return {
      verdict: satisfied ? 'satisfied' : 'violated',
      evidenceClass: 'externally_observed',
      summary: `Dist-tag ${verifier.check.tag} points to ${actual ?? '(missing)'}; expected ${verifier.check.equals}.`,
      evidence: { ...base, tag: verifier.check.tag, actual: actual ?? null, expected: verifier.check.equals },
    };
  } catch (error) {
    return {
      verdict: 'unknown',
      evidenceClass: 'externally_observed',
      summary: error instanceof Error ? error.message : 'The npm observation failed.',
      evidence: { ...base, error: error instanceof Error ? error.name : 'registry_error' },
    };
  }
}
