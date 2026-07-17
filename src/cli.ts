import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { PostconditionRuntime } from './runtime.js';
import { POSTCONDITION_VERSION } from './server.js';
import type { AttestationInput, DefineContractInput, Verdict } from './types.js';

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

Run with POSTCONDITION_DB=/path/to/postcondition.db to choose the local database.
Private and local HTTP targets are blocked unless POSTCONDITION_ALLOW_PRIVATE=1.
`;

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function jsonInput(values: { json?: string; file?: string }): Promise<unknown> {
  if (values.json && values.file) throw new Error('Choose either --json or --file, not both.');
  const raw = values.json ?? (values.file ? await readFile(values.file, 'utf8') : null);
  if (!raw) throw new Error('Provide --json or --file.');
  return JSON.parse(raw) as unknown;
}

export async function runCli(argv: string[]): Promise<void> {
  const command = argv[0] ?? 'help';
  if (['help', '--help', '-h'].includes(command)) {
    process.stdout.write(HELP);
    return;
  }
  if (command === '--version' || command === '-v' || command === 'version') {
    process.stdout.write(`${POSTCONDITION_VERSION}\n`);
    return;
  }

  const runtime = new PostconditionRuntime();
  try {
    switch (command) {
      case 'status': print(runtime.status()); break;
      case 'verify-ledger': print(runtime.verifyLedger()); break;
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
}
