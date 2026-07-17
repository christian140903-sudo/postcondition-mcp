import type {
  AttestationInput,
  Contract,
  DefineContractInput,
  LedgerVerification,
  ListContractsOptions,
  Observation,
} from './types.js';
import { PostconditionStore } from './store.js';
import { attestationSchema, defineContractSchema } from './schemas.js';
import { runVerifier } from './verifiers/index.js';
import { getDefaultDbPath } from './util.js';

export class PostconditionRuntime {
  readonly store: PostconditionStore;

  constructor(options: { dbPath?: string } = {}) {
    this.store = new PostconditionStore(options.dbPath ?? getDefaultDbPath());
  }

  define(input: DefineContractInput): Contract {
    const parsed = defineContractSchema.parse(input) as DefineContractInput;
    return this.store.createContract(parsed);
  }

  async check(id: string): Promise<Observation> {
    const contract = this.store.getContract(id);
    if (!contract) throw new Error(`Unknown postcondition: ${id}`);
    if (contract.state === 'retracted') throw new Error(`Postcondition ${id} is retracted.`);
    const result = await runVerifier(contract.verifier);
    const deadlinePassed = contract.deadline ? Date.now() > Date.parse(contract.deadline) : false;
    return this.store.addObservation(id, {
      ...result,
      evidence: { ...result.evidence, deadline: contract.deadline ?? null, deadlinePassed },
      summary: deadlinePassed && result.verdict !== 'satisfied'
        ? `${result.summary} The declared deadline has passed.`
        : result.summary,
    });
  }

  attest(id: string, input: AttestationInput): Observation {
    const parsed = attestationSchema.parse(input) as AttestationInput;
    return this.store.addObservation(id, {
      verdict: parsed.verdict,
      evidenceClass: parsed.source === 'agent' ? 'self_attestation' : 'manual_attestation',
      summary: parsed.summary,
      evidence: {
        kind: 'attestation',
        source: parsed.source ?? 'human',
        ...(parsed.evidence ?? {}),
      },
    });
  }

  get(id: string): { contract: Contract; observations: Observation[] } | null {
    const contract = this.store.getContract(id);
    return contract ? { contract, observations: this.store.listObservations(id, 100) } : null;
  }

  list(options: ListContractsOptions = {}): Contract[] {
    return this.store.listContracts(options);
  }

  receipts(limit = 100): Observation[] {
    return this.store.listObservations(undefined, limit);
  }

  retract(id: string, reason: string): Contract {
    if (reason.trim().length < 3) throw new Error('A retraction reason of at least 3 characters is required.');
    return this.store.retractContract(id, reason.trim());
  }

  verifyLedger(): LedgerVerification {
    return this.store.verifyLedger();
  }

  status(): Record<string, unknown> {
    return this.store.getStatus();
  }

  close(): void {
    this.store.close();
  }
}
