export type Verdict = 'pending' | 'satisfied' | 'violated' | 'unknown' | 'retracted';

export type EvidenceClass =
  | 'externally_observed'
  | 'configured_verifier'
  | 'manual_attestation'
  | 'self_attestation';

export interface FileVerifier {
  kind: 'file';
  path: string;
  check:
    | { op: 'exists' }
    | { op: 'not_exists' }
    | { op: 'sha256'; equals: string }
    | { op: 'contains'; text: string }
    | { op: 'json_equals'; pointer: string; value: unknown }
    | { op: 'min_size'; bytes: number }
    | { op: 'max_size'; bytes: number };
}

export interface HttpVerifier {
  kind: 'http';
  url: string;
  timeoutMs?: number;
  check:
    | { op: 'status'; equals: number }
    | { op: 'contains'; text: string }
    | { op: 'json_equals'; pointer: string; value: unknown };
}

export interface GitVerifier {
  kind: 'git';
  cwd: string;
  check:
    | { op: 'branch'; equals: string }
    | { op: 'clean'; equals?: boolean }
    | { op: 'head'; equals: string }
    | { op: 'tag_exists'; tag: string }
    | { op: 'remote_contains'; commit: string; remote?: string };
}

export interface NpmVerifier {
  kind: 'npm';
  package: string;
  registry?: string;
  check:
    | { op: 'version_exists'; version: string }
    | { op: 'dist_tag'; tag: string; equals: string };
}

export interface ManualVerifier {
  kind: 'manual';
  instructions: string;
}

export type Verifier = FileVerifier | HttpVerifier | GitVerifier | NpmVerifier | ManualVerifier;

export interface DefineContractInput {
  statement: string;
  subject?: string;
  verifier: Verifier;
  deadline?: string;
  metadata?: Record<string, unknown>;
}

export interface Contract extends DefineContractInput {
  id: string;
  state: Verdict;
  createdAt: string;
  updatedAt: string;
  retractedAt: string | null;
  retractionReason: string | null;
}

export interface Observation {
  id: string;
  contractId: string;
  verdict: Exclude<Verdict, 'pending' | 'retracted'>;
  evidenceClass: EvidenceClass;
  summary: string;
  evidence: Record<string, unknown>;
  evidenceHash: string;
  observedAt: string;
  previousHash: string | null;
  receiptHash: string;
}

export interface CheckResult {
  verdict: Observation['verdict'];
  evidenceClass: EvidenceClass;
  summary: string;
  evidence: Record<string, unknown>;
}

export interface AttestationInput {
  verdict: Observation['verdict'];
  summary: string;
  evidence?: Record<string, unknown>;
  source?: 'human' | 'agent';
}

export interface ListContractsOptions {
  state?: Verdict;
  limit?: number;
}

export interface LedgerVerification {
  valid: boolean;
  checked: number;
  firstInvalidId: string | null;
}
