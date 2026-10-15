import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import Database from 'better-sqlite3';
import { PostconditionRuntime } from './runtime.js';
import { POSTCONDITION_VERSION } from './server.js';
import { getDefaultDbPath } from './util.js';
import type { AttestationInput, DefineContractInput, LedgerVerification, Verdict } from './types.js';

const HELP = `Postcondition ${POSTCONDITION_VERSION} — outcome verification for AI agents

Usage:
  postcondition serve
  postcondition define --json '<contract>'
  postcondition define --file contract.json
  postcondition check <id>
  postcondition get <id>
  postcondition list [--state pending|satisfied|violated|unknown|retracted] [--limit 50]
  postcondition attest <id> --json '<attestation>'
  postcondition retract <id> --reason '<reason>'
  postcondition status
  postcondition verify-ledger

verify-ledger exits 0 only for an intact chain. A broken chain, or a database
that is missing or cannot be read, exits 1.

Run with POSTCONDITION_DB=/path/to/postcondition.db to choose the local database.
Private and local HTTP targets are blocked unless POSTCONDITION_ALLOW_PRIVATE=1.
`;

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// verify-ledger must never pass on a ledger it did not read. Opening the store
// would create a missing database and migrate an empty file into an empty, valid
// ledger, so check read-only first that a Postcondition ledger is actually there.
function assertLedgerReadable(path: string): void {
  if (!existsSync(path)) {
    throw new Error(`No Postcondition database at ${path}. Set POSTCONDITION_DB to the ledger you want to verify.`);
  }
  let db: Database.Database | undefined;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'observations'").get();
    if (!table) throw new Error('it has no receipt ledger table');
  } catch (error) {
    throw new Error(`${path} is not a readable Postcondition database: ${errorMessage(error)}`);
  } finally {
    db?.close();
  }
}

function verifyLedger(runtime: PostconditionRuntime): LedgerVerification {
  try {
    return runtime.verifyLedger();
  } catch (error) {
    throw new Error(`Could not read every receipt in the ledger: ${errorMessage(error)}`);
  }
}

async function jsonInput(values: { json?: string; file?: string }): Promise<unknown> {
  if (values.json && values.file) throw new Error('Choose either --json or --file, not both.');
  const raw = values.json ?? (values.file ? await readFile(values.file, 'utf8') : null);
  if (!raw) throw new Error('Provide --json or --file.');
  return JSON.parse(raw) as unknown;
}

/** Runs one CLI command and resolves to the process exit code. */
export async function runCli(argv: string[]): Promise<number> {
  const command = argv[0] ?? 'help';
  if (['help', '--help', '-h'].includes(command)) {
    process.stdout.write(HELP);
    return 0;
  }
  if (command === '--version' || command === '-v' || command === 'version') {
    process.stdout.write(`${POSTCONDITION_VERSION}\n`);
    return 0;
  }
  if (command === 'verify-ledger') assertLedgerReadable(getDefaultDbPath());

  const runtime = new PostconditionRuntime();
  try {
    switch (command) {
      case 'status': print(runtime.status()); break;
      case 'verify-ledger': {
        const result = verifyLedger(runtime);
        print(result);
        return result.valid === true ? 0 : 1;
      }
      case 'get': {
        const id = argv[1];
        if (!id) throw new Error('Usage: postcondition get <id>');
        const result = runtime.get(id);
        if (!result) throw new Error(`Unknown postcondition: ${id}`);
        print(result);
        break;
      }
      case 'check': {
        const id = argv[1];
        if (!id) throw new Error('Usage: postcondition check <id>');
        print({ observation: await runtime.check(id), contract: runtime.get(id)?.contract });
        break;
      }
      case 'list': {
        const { values } = parseArgs({
          args: argv.slice(1),
          options: { state: { type: 'string' }, limit: { type: 'string' } },
          strict: true,
        });
        const limit = values.limit ? Number(values.limit) : undefined;
        if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 500)) throw new Error('--limit must be an integer from 1 to 500.');
        print({ contracts: runtime.list({ state: values.state as Verdict | undefined, limit }) });
        break;
      }
      case 'define': {
        const { values } = parseArgs({
          args: argv.slice(1),
          options: { json: { type: 'string' }, file: { type: 'string' } },
          strict: true,
        });
        print({ contract: runtime.define(await jsonInput(values) as DefineContractInput) });
        break;
      }
      case 'attest': {
        const id = argv[1];
        if (!id) throw new Error('Usage: postcondition attest <id> --json <attestation>');
        const { values } = parseArgs({
          args: argv.slice(2),
          options: { json: { type: 'string' }, file: { type: 'string' } },
          strict: true,
        });
        print({ observation: runtime.attest(id, await jsonInput(values) as AttestationInput) });
        break;
      }
      case 'retract': {
        const id = argv[1];
        if (!id) throw new Error('Usage: postcondition retract <id> --reason <reason>');
        const { values } = parseArgs({
          args: argv.slice(2),
          options: { reason: { type: 'string' } },
          strict: true,
        });
        if (!values.reason) throw new Error('--reason is required.');
        print({ contract: runtime.retract(id, values.reason) });
        break;
      }
      default:
        throw new Error(`Unknown command: ${command}\n\n${HELP}`);
    }
  } finally {
    runtime.close();
  }
  return 0;
}
