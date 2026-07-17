import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  Contract,
  DefineContractInput,
  LedgerVerification,
  ListContractsOptions,
  Observation,
  CheckResult,
} from './types.js';
import { canonicalJson, newId, nowIso, sha256 } from './util.js';

interface ContractRow {
  id: string;
  statement: string;
  subject: string | null;
  verifier_json: string;
  deadline: string | null;
  metadata_json: string;
  state: Contract['state'];
  created_at: string;
  updated_at: string;
  retracted_at: string | null;
  retraction_reason: string | null;
}

interface ObservationRow {
  id: string;
  contract_id: string;
  verdict: Observation['verdict'];
  evidence_class: Observation['evidenceClass'];
  summary: string;
  evidence_json: string;
  evidence_hash: string;
  observed_at: string;
  previous_hash: string | null;
  receipt_hash: string;
}

function receiptPayload(observation: Omit<Observation, 'receiptHash'>): Record<string, unknown> {
  return {
    id: observation.id,
    contractId: observation.contractId,
    verdict: observation.verdict,
    evidenceClass: observation.evidenceClass,
    summary: observation.summary,
    evidence: observation.evidence,
    evidenceHash: observation.evidenceHash,
    observedAt: observation.observedAt,
    previousHash: observation.previousHash,
  };
}

export class PostconditionStore {
  readonly db: Database.Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS contracts (
        id TEXT PRIMARY KEY,
        statement TEXT NOT NULL,
        subject TEXT,
        verifier_json TEXT NOT NULL,
        deadline TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        state TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        retracted_at TEXT,
        retraction_reason TEXT,
        CHECK (state IN ('pending','satisfied','violated','unknown','retracted'))
      );

      CREATE TABLE IF NOT EXISTS observations (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        contract_id TEXT NOT NULL REFERENCES contracts(id),
        verdict TEXT NOT NULL,
        evidence_class TEXT NOT NULL,
        summary TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        evidence_hash TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        previous_hash TEXT,
        receipt_hash TEXT NOT NULL UNIQUE,
        CHECK (verdict IN ('satisfied','violated','unknown')),
        CHECK (evidence_class IN ('externally_observed','configured_verifier','manual_attestation','self_attestation'))
      );

      CREATE INDEX IF NOT EXISTS idx_contracts_state ON contracts(state, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_observations_contract ON observations(contract_id, sequence DESC);
    `);
  }

  createContract(input: DefineContractInput): Contract {
    const timestamp = nowIso();
    const contract: Contract = {
      ...input,
      id: newId('pc'),
      state: 'pending',
      createdAt: timestamp,
      updatedAt: timestamp,
      retractedAt: null,
      retractionReason: null,
    };
    this.db.prepare(`
      INSERT INTO contracts (
        id, statement, subject, verifier_json, deadline, metadata_json,
        state, created_at, updated_at, retracted_at, retraction_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
    `).run(
      contract.id,
      contract.statement,
      contract.subject ?? null,
      canonicalJson(contract.verifier),
      contract.deadline ?? null,
      canonicalJson(contract.metadata ?? {}),
      contract.state,
      contract.createdAt,
      contract.updatedAt,
    );
    return contract;
  }

  getContract(id: string): Contract | null {
    const row = this.db.prepare('SELECT * FROM contracts WHERE id = ?').get(id) as ContractRow | undefined;
    return row ? this.mapContract(row) : null;
  }

  listContracts(options: ListContractsOptions = {}): Contract[] {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
    const rows = options.state
      ? this.db.prepare('SELECT * FROM contracts WHERE state = ? ORDER BY updated_at DESC LIMIT ?').all(options.state, limit)
      : this.db.prepare('SELECT * FROM contracts ORDER BY updated_at DESC LIMIT ?').all(limit);
    return (rows as ContractRow[]).map((row) => this.mapContract(row));
  }

  addObservation(contractId: string, result: CheckResult): Observation {
    const contract = this.getContract(contractId);
    if (!contract) throw new Error(`Unknown postcondition: ${contractId}`);
    if (contract.state === 'retracted') throw new Error(`Postcondition ${contractId} is retracted.`);

    return this.db.transaction(() => {
      const previous = this.db
        .prepare('SELECT receipt_hash FROM observations ORDER BY sequence DESC LIMIT 1')
        .get() as { receipt_hash: string } | undefined;
      const evidenceHash = sha256(canonicalJson(result.evidence));
      const unsigned: Omit<Observation, 'receiptHash'> = {
        id: newId('obs'),
        contractId,
        verdict: result.verdict,
        evidenceClass: result.evidenceClass,
        summary: result.summary,
        evidence: result.evidence,
        evidenceHash,
        observedAt: nowIso(),
        previousHash: previous?.receipt_hash ?? null,
      };
      const observation: Observation = {
        ...unsigned,
        receiptHash: sha256(canonicalJson(receiptPayload(unsigned))),
      };

      this.db.prepare(`
        INSERT INTO observations (
          id, contract_id, verdict, evidence_class, summary, evidence_json,
          evidence_hash, observed_at, previous_hash, receipt_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        observation.id,
        observation.contractId,
        observation.verdict,
        observation.evidenceClass,
        observation.summary,
        canonicalJson(observation.evidence),
        observation.evidenceHash,
        observation.observedAt,
        observation.previousHash,
        observation.receiptHash,
      );
      this.db.prepare('UPDATE contracts SET state = ?, updated_at = ? WHERE id = ?')
        .run(observation.verdict, observation.observedAt, contractId);
      return observation;
    })();
  }

  listObservations(contractId?: string, limit = 100): Observation[] {
    const safeLimit = Math.min(Math.max(limit, 1), 1000);
    const rows = contractId
      ? this.db.prepare('SELECT * FROM observations WHERE contract_id = ? ORDER BY sequence DESC LIMIT ?').all(contractId, safeLimit)
      : this.db.prepare('SELECT * FROM observations ORDER BY sequence DESC LIMIT ?').all(safeLimit);
    return (rows as ObservationRow[]).map((row) => this.mapObservation(row));
  }

  retractContract(id: string, reason: string): Contract {
    const contract = this.getContract(id);
    if (!contract) throw new Error(`Unknown postcondition: ${id}`);
    if (contract.state === 'retracted') return contract;
    const timestamp = nowIso();
    this.db.prepare(`
      UPDATE contracts
      SET state = 'retracted', updated_at = ?, retracted_at = ?, retraction_reason = ?
      WHERE id = ?
    `).run(timestamp, timestamp, reason, id);
    return this.getContract(id)!;
  }

  verifyLedger(): LedgerVerification {
    const rows = this.db.prepare('SELECT * FROM observations ORDER BY sequence ASC').all() as ObservationRow[];
    let previousHash: string | null = null;
    for (const row of rows) {
      const observation = this.mapObservation(row);
      const evidenceHash = sha256(canonicalJson(observation.evidence));
      const unsigned: Omit<Observation, 'receiptHash'> = {
        id: observation.id,
        contractId: observation.contractId,
        verdict: observation.verdict,
        evidenceClass: observation.evidenceClass,
        summary: observation.summary,
        evidence: observation.evidence,
        evidenceHash: observation.evidenceHash,
        observedAt: observation.observedAt,
        previousHash: observation.previousHash,
      };
      const receiptHash = sha256(canonicalJson(receiptPayload(unsigned)));
      if (
        observation.previousHash !== previousHash ||
        observation.evidenceHash !== evidenceHash ||
        observation.receiptHash !== receiptHash
      ) {
        return { valid: false, checked: rows.indexOf(row), firstInvalidId: observation.id };
      }
      previousHash = observation.receiptHash;
    }
    return { valid: true, checked: rows.length, firstInvalidId: null };
  }

  getStatus(): Record<string, unknown> {
    const states = this.db.prepare('SELECT state, COUNT(*) AS count FROM contracts GROUP BY state').all() as Array<{state: string; count: number}>;
    const observations = this.db.prepare('SELECT COUNT(*) AS count FROM observations').get() as { count: number };
    return {
      contracts: Object.fromEntries(states.map((row) => [row.state, row.count])),
      observations: observations.count,
      ledger: this.verifyLedger(),
    };
  }

  close(): void {
    this.db.close();
  }

  private mapContract(row: ContractRow): Contract {
    return {
      id: row.id,
      statement: row.statement,
      subject: row.subject ?? undefined,
      verifier: JSON.parse(row.verifier_json) as Contract['verifier'],
      deadline: row.deadline ?? undefined,
      metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
      state: row.state,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      retractedAt: row.retracted_at,
      retractionReason: row.retraction_reason,
    };
  }

  private mapObservation(row: ObservationRow): Observation {
    return {
      id: row.id,
      contractId: row.contract_id,
      verdict: row.verdict,
      evidenceClass: row.evidence_class,
      summary: row.summary,
      evidence: JSON.parse(row.evidence_json) as Record<string, unknown>,
      evidenceHash: row.evidence_hash,
      observedAt: row.observed_at,
      previousHash: row.previous_hash,
      receiptHash: row.receipt_hash,
    };
  }
}
