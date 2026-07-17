import type { CheckResult, HttpVerifier } from '../types.js';
import { canonicalJson, parseJsonPointer, safeUrl } from '../util.js';
import { fetchSafe } from './network.js';

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export async function verifyHttp(verifier: HttpVerifier): Promise<CheckResult> {
  const timeoutMs = Math.min(Math.max(verifier.timeoutMs ?? 10_000, 100), 30_000);
  try {
    const response = await fetchSafe(verifier.url, timeoutMs);
    const contentLength = Number(response.headers.get('content-length') ?? '0');
    const baseEvidence = {
      kind: 'http',
      url: safeUrl(response.url || verifier.url),
      status: response.status,
      contentType: response.headers.get('content-type'),
      observedAt: new Date().toISOString(),
    };

    if (verifier.check.op === 'status') {
      const satisfied = response.status === verifier.check.equals;
      await response.body?.cancel();
      return {
        verdict: satisfied ? 'satisfied' : 'violated',
        evidenceClass: 'externally_observed',
        summary: `Observed HTTP ${response.status}; expected ${verifier.check.equals}.`,
        evidence: { ...baseEvidence, expectedStatus: verifier.check.equals },
      };
    }

    if (contentLength > MAX_RESPONSE_BYTES) {
      await response.body?.cancel();
      return {
        verdict: 'unknown',
        evidenceClass: 'externally_observed',
        summary: 'The response is larger than the safe inspection limit.',
        evidence: { ...baseEvidence, error: 'response_too_large', inspectionLimit: MAX_RESPONSE_BYTES },
      };
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_RESPONSE_BYTES) {
      return {
        verdict: 'unknown',
        evidenceClass: 'externally_observed',
        summary: 'The response is larger than the safe inspection limit.',
        evidence: { ...baseEvidence, error: 'response_too_large', inspectionLimit: MAX_RESPONSE_BYTES },
      };
    }
    const text = new TextDecoder().decode(bytes);

    if (verifier.check.op === 'contains') {
      const satisfied = text.includes(verifier.check.text);
      return {
        verdict: satisfied ? 'satisfied' : 'violated',
        evidenceClass: 'externally_observed',
        summary: satisfied ? 'The response contains the required text.' : 'The response does not contain the required text.',
        evidence: { ...baseEvidence, contains: satisfied },
      };
    }

    try {
      const json = JSON.parse(text) as unknown;
      const actual = parseJsonPointer(json, verifier.check.pointer);
      const found = actual !== undefined;
      const satisfied = found && canonicalJson(actual) === canonicalJson(verifier.check.value);
      return {
        verdict: satisfied ? 'satisfied' : 'violated',
        evidenceClass: 'externally_observed',
        summary: satisfied ? 'The remote JSON value matches.' : 'The remote JSON value does not match.',
        evidence: { ...baseEvidence, pointer: verifier.check.pointer, found, actual: actual ?? null, expected: verifier.check.value },
      };
    } catch (error) {
      return {
        verdict: 'unknown',
        evidenceClass: 'externally_observed',
        summary: 'The response could not be evaluated as JSON.',
        evidence: { ...baseEvidence, error: error instanceof Error ? error.name : 'json_error' },
      };
    }
  } catch (error) {
    return {
      verdict: 'unknown',
      evidenceClass: 'externally_observed',
      summary: error instanceof Error ? error.message : 'The HTTP observation failed.',
      evidence: { kind: 'http', url: safeUrl(verifier.url), error: error instanceof Error ? error.name : 'network_error' },
    };
  }
}
