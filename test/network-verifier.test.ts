import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { assertSafeRemoteUrl, fetchSafe } from '../src/verifiers/network.js';
import { verifyHttp } from '../src/verifiers/http.js';
import { verifyNpm } from '../src/verifiers/npm.js';

let server: Server;
let baseUrl: string;

before(async () => {
  server = createServer((request, response) => {
    if (request.url === '/redirect') {
      response.writeHead(302, { location: '/json' });
      response.end();
      return;
    }
    if (request.url?.startsWith('/text')) {
      response.writeHead(201, { 'content-type': 'text/plain' });
      response.end('observable world state');
      return;
    }
    if (request.url === '/json') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ release: { version: '4.0.1', ready: true } }));
      return;
    }
    if (request.url === '/demo-package') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ versions: { '1.0.0': {}, '1.1.0': {} }, 'dist-tags': { latest: '1.1.0' } }));
      return;
    }
    if (request.url === '/missing-package') {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end('{}');
      return;
    }
    response.writeHead(404);
    response.end('missing');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind.');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  delete process.env.POSTCONDITION_ALLOW_PRIVATE;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test('network guard blocks loopback, localhost, and private IPv4 by default', async () => {
  delete process.env.POSTCONDITION_ALLOW_PRIVATE;
  await assert.rejects(assertSafeRemoteUrl('http://127.0.0.1:1234'), /blocked/);
  await assert.rejects(assertSafeRemoteUrl('http://localhost:1234'), /blocked/);
  await assert.rejects(assertSafeRemoteUrl('http://10.0.0.4'), /blocked/);
  await assert.rejects(assertSafeRemoteUrl('http://192.168.1.1'), /blocked/);
});

test('network guard rejects credentials and non-http protocols', async () => {
  await assert.rejects(assertSafeRemoteUrl('https://user:secret@example.com'), /Credentials/);
  await assert.rejects(assertSafeRemoteUrl('file:///etc/passwd'), /Only http and https/);
});

test('private targets require explicit opt-in', async () => {
  process.env.POSTCONDITION_ALLOW_PRIVATE = '1';
  const response = await fetchSafe(`${baseUrl}/text`, 2_000);
  assert.equal(response.status, 201);
  await response.body?.cancel();
});

test('HTTP status check observes the returned status', async () => {
  process.env.POSTCONDITION_ALLOW_PRIVATE = '1';
  const result = await verifyHttp({ kind: 'http', url: `${baseUrl}/text?secret=yes`, check: { op: 'status', equals: 201 } });
  assert.equal(result.verdict, 'satisfied');
  assert.equal(result.evidenceClass, 'externally_observed');
  assert.equal(String(result.evidence.url).includes('secret'), false);
});

test('HTTP contains check distinguishes matching and absent text', async () => {
  process.env.POSTCONDITION_ALLOW_PRIVATE = '1';
  assert.equal((await verifyHttp({ kind: 'http', url: `${baseUrl}/text`, check: { op: 'contains', text: 'world state' } })).verdict, 'satisfied');
  assert.equal((await verifyHttp({ kind: 'http', url: `${baseUrl}/text`, check: { op: 'contains', text: 'not there' } })).verdict, 'violated');
});

test('HTTP JSON pointer check follows safe redirects', async () => {
  process.env.POSTCONDITION_ALLOW_PRIVATE = '1';
  const result = await verifyHttp({ kind: 'http', url: `${baseUrl}/redirect`, check: { op: 'json_equals', pointer: '/release/version', value: '4.0.1' } });
  assert.equal(result.verdict, 'satisfied');
});

test('blocked HTTP observations return unknown, not violated', async () => {
  delete process.env.POSTCONDITION_ALLOW_PRIVATE;
  const result = await verifyHttp({ kind: 'http', url: `${baseUrl}/text`, check: { op: 'status', equals: 201 } });
  assert.equal(result.verdict, 'unknown');
  assert.match(result.summary, /blocked/);
});

test('npm verifier observes versions and dist-tags', async () => {
  process.env.POSTCONDITION_ALLOW_PRIVATE = '1';
  const version = await verifyNpm({ kind: 'npm', package: 'demo-package', registry: baseUrl, check: { op: 'version_exists', version: '1.0.0' } });
  const missing = await verifyNpm({ kind: 'npm', package: 'demo-package', registry: baseUrl, check: { op: 'version_exists', version: '9.0.0' } });
  const tag = await verifyNpm({ kind: 'npm', package: 'demo-package', registry: baseUrl, check: { op: 'dist_tag', tag: 'latest', equals: '1.1.0' } });
  assert.equal(version.verdict, 'satisfied');
  assert.equal(missing.verdict, 'violated');
  assert.equal(tag.verdict, 'satisfied');
});

test('npm 404 is an observed violation', async () => {
  process.env.POSTCONDITION_ALLOW_PRIVATE = '1';
  const result = await verifyNpm({ kind: 'npm', package: 'missing-package', registry: baseUrl, check: { op: 'version_exists', version: '1.0.0' } });
  assert.equal(result.verdict, 'violated');
  assert.equal(result.evidence.status, 404);
});
