import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer, runtimeOptionsFromEnv } from '../codex/server.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');

async function fakeProbe(t, responder) {
  const calls = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    calls.push({ path: req.url, token: req.headers['x-mcdev-token'], body });
    const reply = responder(req, body);
    res.writeHead(reply.status ?? 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(reply.body));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { port: server.address().port, calls };
}

async function stdioClient(t, env = {}, entry = 'codex/stdio.js') {
  const transport = new StdioClientTransport({
    command: process.execPath, args: [resolve(entry)],
    env: { ...process.env, ...env }, stderr: 'pipe',
  });
  const client = new Client({ name: 'mcdev-test', version: '1.0.0' });
  let stderr = '';
  transport.stderr.on('data', (chunk) => { stderr += chunk; });
  t.after(() => client.close());
  await client.connect(transport);
  return { client, transport, stderr: () => stderr };
}

async function memoryClient(t, descriptors) {
  const runtime = { tools: descriptors, close: async () => {} };
  const server = createMcpServer(runtime);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'memory-test', version: '1.0.0' });
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

test('stdio lists 14 tools with standard JSON Schema and rejects invalid calls before I/O', async (t) => {
  const probe = await fakeProbe(t, () => ({ body: { ok: true } }));
  const { client, stderr } = await stdioClient(t, { MCDEV_SERVER_PORT: String(probe.port) });
  const { tools } = await client.listTools();
  assert.equal(tools.length, 14);
  const command = tools.find((tool) => tool.name === 'mcdev_command');
  assert.deepEqual(command.inputSchema.required.sort(), ['cmd', 'side']);
  assert.equal(command.inputSchema.properties.side.required, undefined);
  assert.equal(command.inputSchema.additionalProperties, false);
  for (const args of [{ cmd: 'say hi' }, { side: 'other', cmd: 'say hi' },
    { side: 'server', cmd: 'say hi', port: 0 }, { side: 'server', cmd: 'say hi', port: 65536 },
    { side: 'server', cmd: 'say hi', unexpected: true }]) {
    const result = await client.callTool({ name: 'mcdev_command', arguments: args });
    assert.equal(result.isError, true, JSON.stringify(result));
  }
  assert.equal(probe.calls.length, 0);
  assert.equal(stderr(), '');
});

test('stdio forwards configured ports/token and returns structured status and zero command result', async (t) => {
  const probe = await fakeProbe(t, (req) => ({ body: {
    ok: true, data: req.url === '/status'
      ? { side: 'server', version: '26.1.2', loader: 'neoforge' } : { result: 0 },
  } }));
  const { client } = await stdioClient(t, { MCDEV_SERVER_PORT: String(probe.port), MCDEV_TOKEN: 'test-secret' });
  const status = await client.callTool({ name: 'mcdev_status', arguments: { side: 'server' } });
  assert.equal(status.structuredContent.data.loader, 'neoforge');
  assert.notEqual(status.isError, true);
  const command = await client.callTool({ name: 'mcdev_command', arguments: { side: 'server', cmd: 'test command' } });
  assert.notEqual(command.isError, true);
  assert.equal(command.structuredContent.data.result, 0);
  assert.deepEqual(probe.calls.map((call) => call.token), ['test-secret', 'test-secret']);
  assert.deepEqual(JSON.parse(probe.calls[1].body), { cmd: 'test command' });
});

test('stdio reports probe HTTP errors as tool errors and remains usable', async (t) => {
  const probe = await fakeProbe(t, () => ({ status: 401, body: { ok: false, error: 'Unauthorized' } }));
  const { client } = await stdioClient(t, { MCDEV_SERVER_PORT: String(probe.port) });
  const result = await client.callTool({ name: 'mcdev_status', arguments: { side: 'server' } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /401/);
  assert.equal((await client.listTools()).tools.length, 14);
  const unknown = await client.callTool({ name: 'missing_tool', arguments: {} });
  assert.equal(unknown.isError, true);
});

test('semantic failures include nested probe errors, failed build and missing join', async (t) => {
  const cases = [
    { ok: false, error: 'assertion failed' },
    { exitCode: 2, tail: 'compile failed' },
    { exitCode: null, tail: 'terminated' },
    { ok: true, results: [{ kind: 'client', joined: false }] },
    { ok: true, steps: [{ data: { ok: false, error: 'craft failed' } }] },
  ];
  const client = await memoryClient(t, cases.map((body, index) => ({
    name: `failure_${index}`, description: 'failure', parameters: {},
    execute: async () => ({ text: JSON.stringify(body) }),
  })));
  for (let index = 0; index < cases.length; index++) {
    const result = await client.callTool({ name: `failure_${index}`, arguments: {} });
    assert.equal(result.isError, true, JSON.stringify(result));
    assert.deepEqual(result.structuredContent, cases[index]);
  }
});

test('screenshot returns PNG image and preserves metadata; rejects non-PNG files', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mcdev-image-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'shot.png');
  writeFileSync(path, png);
  const probe = await fakeProbe(t, () => ({ body: { ok: true, data: { path, exists: true, size: png.length } } }));
  const { client } = await stdioClient(t, { MCDEV_CLIENT_PORT: String(probe.port) });
  const result = await client.callTool({ name: 'mcdev_screenshot', arguments: {} });
  assert.equal(result.structuredContent.data.path, path);
  const img = result.content.find((part) => part.type === 'image');
  assert.equal(img.mimeType, 'image/png');
  assert.deepEqual(Buffer.from(img.data, 'base64'), png);
  writeFileSync(path, 'private text');
  const invalid = await client.callTool({ name: 'mcdev_screenshot', arguments: {} });
  assert.equal(invalid.isError, true);
  assert.ok(!JSON.stringify(invalid).includes('private text'));
});

test('launch status reports process exit fields as data rather than a failed call', async (t) => {
  const client = await memoryClient(t, [{
    name: 'mcdev_launch_status', description: 'status', parameters: {},
    execute: async () => ({ text: JSON.stringify({ processes: [{ running: true, exitCode: null }, { running: false, exitCode: 1 }] }) }),
  }]);
  const result = await client.callTool({ name: 'mcdev_launch_status', arguments: {} });
  assert.notEqual(result.isError, true);
  assert.equal(result.structuredContent.processes[0].running, true);
});

test('dry-run scenarios do not connect to the game', async (t) => {
  const { client } = await stdioClient(t);
  const result = await client.callTool({ name: 'mcdev_scenario', arguments: {
    minecraftVersion: '26.1.2', dryRun: true,
    steps: [{ type: 'command', side: 'server', cmd: 'say test' }],
  } });
  assert.notEqual(result.isError, true);
  assert.equal(result.structuredContent.dryRun, true);
});

test('connection environment validates ports without echoing secrets', () => {
  assert.deepEqual(runtimeOptionsFromEnv({}), {});
  assert.deepEqual(runtimeOptionsFromEnv({ MCDEV_SERVER_PORT: '39003', MCDEV_CLIENT_PORT: '39004', MCDEV_TOKEN: 'secret' }),
    { serverPort: 39003, clientPort: 39004, token: 'secret' });
  for (const bad of ['0', '65536', 'abc', '1.2', '-1', '']) {
    assert.throws(() => runtimeOptionsFromEnv({ MCDEV_SERVER_PORT: bad }), /MCDEV_SERVER_PORT/);
  }
});
