import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { PostconditionRuntime } from './runtime.js';
import { attestationSchema, defineContractSchema, verdictSchema } from './schemas.js';
import type { DefineContractInput } from './types.js';

export const POSTCONDITION_VERSION = '0.1.0';

function jsonResult(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

export function createPostconditionServer(runtime = new PostconditionRuntime()): McpServer {
  const server = new McpServer(
    { name: 'postcondition', version: POSTCONDITION_VERSION },
    {
      instructions:
        'Postcondition verifies outcomes; it does not execute the action itself. ' +
        'Before a consequential action, call postcondition_define with a concrete, independently observable result. ' +
        'After acting, call postcondition_check. Never represent pending, unknown, manual, or self-attested evidence as external proof. ' +
        'Use postcondition_retract when a contract was wrong rather than rewriting its history.',
    },
  );

  server.registerTool(
    'postcondition_define',
    {
      title: 'Define Postcondition',
      description: 'Declare a testable world-state outcome before or after an action. This records intent but does not execute the action.',
      inputSchema: defineContractSchema,
    },
    async (input) => jsonResult({ contract: runtime.define(input as DefineContractInput) }),
  );

  server.registerTool(
    'postcondition_check',
    {
      title: 'Check Postcondition',
      description: 'Run the configured constrained verifier, append its evidence, and return an honest satisfied/violated/unknown verdict.',
      inputSchema: z.object({ id: z.string().min(1) }),
    },
    async ({ id }) => jsonResult({ observation: await runtime.check(id), contract: runtime.get(id)?.contract }),
  );

  server.registerTool(
    'postcondition_get',
    {
      title: 'Get Postcondition',
      description: 'Read a postcondition and its observation history.',
      inputSchema: z.object({ id: z.string().min(1) }),
    },
    async ({ id }) => jsonResult(runtime.get(id) ?? { error: 'not_found', id }),
  );

  server.registerTool(
    'postcondition_list',
    {
      title: 'List Postconditions',
      description: 'List recent postconditions, optionally filtered by current verdict.',
      inputSchema: z.object({ state: verdictSchema.optional(), limit: z.number().int().min(1).max(500).optional() }),
    },
    async ({ state, limit }) => jsonResult({ contracts: runtime.list({ state, limit }) }),
  );

  server.registerTool(
    'postcondition_attest',
    {
      title: 'Attest Manually',
      description: 'Record a human or agent attestation. It remains explicitly labelled and is never upgraded to external proof.',
      inputSchema: z.object({ id: z.string().min(1), ...attestationSchema.shape }),
    },
    async ({ id, ...input }) => jsonResult({ observation: runtime.attest(id, input) }),
  );

  server.registerTool(
    'postcondition_retract',
    {
      title: 'Retract Postcondition',
      description: 'Retract an invalid or obsolete postcondition without deleting its history.',
      inputSchema: z.object({ id: z.string().min(1), reason: z.string().trim().min(3).max(20_000) }),
    },
    async ({ id, reason }) => jsonResult({ contract: runtime.retract(id, reason) }),
  );

  server.registerTool(
    'postcondition_verify_ledger',
    {
      title: 'Verify Receipt Ledger',
      description: 'Recompute the local hash chain and evidence digests to detect modified observation receipts.',
      inputSchema: z.object({}),
    },
    async () => jsonResult(runtime.verifyLedger()),
  );

  const resource = (name: string, uri: string, description: string, fetch: () => unknown) => {
    server.registerResource(name, uri, { description, mimeType: 'application/json' }, async () => ({
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(fetch(), null, 2) }],
    }));
  };
  resource('status', 'postcondition://status', 'Contract counts and receipt-ledger integrity', () => runtime.status());
  resource('contracts', 'postcondition://contracts', 'The 100 most recent postconditions', () => runtime.list({ limit: 100 }));
  resource('receipts', 'postcondition://receipts', 'The 100 most recent observation receipts', () => runtime.receipts(100));

  server.registerResource(
    'postcondition',
    new ResourceTemplate('postcondition://contract/{id}', { list: undefined }),
    { description: 'A postcondition with its observation history', mimeType: 'application/json' },
    async (uri, { id }) => ({
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(runtime.get(String(id)), null, 2) }],
    }),
  );

  server.registerPrompt(
    'verify-before-done',
    { description: 'Turn a completion claim into an independently checked postcondition' },
    async () => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text:
            'Before saying this task is done, state the externally observable result. Define it with ' +
            'postcondition_define using the narrowest safe verifier, then run postcondition_check. ' +
            'Report satisfied, violated, or unknown exactly as returned. A manual or self-attested receipt is not external proof.',
        },
      }],
    }),
  );

  return server;
}
