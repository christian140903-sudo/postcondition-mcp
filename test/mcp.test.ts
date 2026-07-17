import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const entry = fileURLToPath(new URL('../src/index.js', import.meta.url));

function cleanEnv(extra: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries({ ...process.env, ...extra }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

test('MCP server exposes tools, resources, prompt, and a working verification flow', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'postcondition-mcp-'));
  const marker = join(dir, 'marker.txt');
  await writeFile(marker, 'ready');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry, 'serve'],
    env: cleanEnv({ POSTCONDITION_DB: join(dir, 'mcp.db') }),
  });
  const client = new Client({ name: 'postcondition-tests', version: '1.0.0' });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name).sort(),
      [
        'postcondition_attest',
        'postcondition_check',
        'postcondition_define',
        'postcondition_get',
        'postcondition_list',
        'postcondition_retract',
        'postcondition_verify_ledger',
      ],
    );
    const resources = await client.listResources();
    assert.deepEqual(resources.resources.map((resource) => resource.uri).sort(), [
      'postcondition://contracts',
      'postcondition://receipts',
      'postcondition://status',
    ]);
    const prompts = await client.listPrompts();
    assert.equal(prompts.prompts[0]?.name, 'verify-before-done');

    const defined = await client.callTool({
      name: 'postcondition_define',
      arguments: {
        statement: 'The MCP fixture marker exists',
        verifier: { kind: 'file', path: marker, check: { op: 'exists' } },
      },
    });
    const text = (defined as { content: Array<{ type: string; text?: string }> }).content[0];
    assert.equal(text?.type, 'text');
    if (!text || text.type !== 'text' || typeof text.text !== 'string') throw new Error('Expected text tool response.');
    const id = (JSON.parse(text.text) as { contract: { id: string } }).contract.id;
    const checked = await client.callTool({ name: 'postcondition_check', arguments: { id } });
    const checkText = (checked as { content: Array<{ type: string; text?: string }> }).content[0];
    if (!checkText || checkText.type !== 'text' || typeof checkText.text !== 'string') throw new Error('Expected text tool response.');
    assert.equal((JSON.parse(checkText.text) as { observation: { verdict: string } }).observation.verdict, 'satisfied');

    const status = await client.readResource({ uri: 'postcondition://status' });
    const statusContent = status.contents[0];
    assert.equal(statusContent?.mimeType, 'application/json');
    if (!statusContent || !('text' in statusContent)) throw new Error('Expected text resource.');
    assert.equal((JSON.parse(statusContent.text) as { ledger: { valid: boolean } }).ledger.valid, true);
  } finally {
    await client.close();
  }
});
