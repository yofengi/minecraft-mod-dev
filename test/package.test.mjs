import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = resolve('plugins/minecraft-mod-dev');
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));

test('marketplace package references are portable and have matching compatibility metadata', () => {
  const catalog = json('.agents/plugins/marketplace.json');
  assert.equal(resolve(catalog.plugins[0].source.path), root);
  const portable = json(join(root, 'plugin.json'));
  const legacy = json(join(root, '.codex-plugin/plugin.json'));
  assert.equal(portable.name, legacy.name);
  assert.equal(portable.version, json('package.json').version);
  assert.equal(legacy.version, portable.version);
  assert.equal(legacy.requires_local_executor, true);
  const { $schema, ...mcp } = json(join(root, 'mcp.json'));
  assert.deepEqual(mcp, json(join(root, '.mcp.json')));
  assert.ok(mcp.mcpServers.minecraft.tool_timeout_sec >= 900);
  for (const relative of [legacy.mcpServers, legacy.interface.composerIcon, `${legacy.skills}/minecraft-mod-dev/SKILL.md`]) {
    assert.ok(relative.startsWith('./') && !relative.includes('..'));
    assert.ok(existsSync(join(root, relative)), relative);
  }
});

test('copied release bundle starts outside repository without node_modules', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mcdev-package-'));
  const copy = join(dir, 'minecraft-mod-dev');
  cpSync(root, copy, { recursive: true });
  assert.equal(existsSync(join(dir, 'node_modules')), false);
  const config = json(join(copy, '.mcp.json')).mcpServers.minecraft;
  const args = config.args.map((value) => value.replaceAll('${PLUGIN_ROOT}', copy));
  const transport = new StdioClientTransport({ command: process.execPath, args, cwd: copy, stderr: 'pipe' });
  const client = new Client({ name: 'release-test', version: '1.0.0' });
  t.after(async () => {
    await client.close();
    rmSync(dir, { recursive: true, force: true });
  });
  let stderr = '';
  transport.stderr.on('data', (chunk) => { stderr += chunk; });
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 14);
  const result = await client.callTool({ name: 'mcdev_launch_status', arguments: {} });
  assert.deepEqual(result.structuredContent.processes, []);
  const stopped = await client.callTool({ name: 'mcdev_stop', arguments: { side: 'all' } });
  assert.ok(stopped.structuredContent.results.every((item) => item.reason === 'not tracked'));
  assert.equal(stderr, '');
});

test('stdio server exits normally on stdin EOF without games', async () => {
  const child = spawn(process.execPath, [join(root, 'server.cjs')], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exit = once(child, 'exit');
  const timer = setTimeout(() => child.kill(), 5000);
  child.stdin.end();
  const [code, signal] = await exit;
  clearTimeout(timer);
  assert.equal(signal, null);
  assert.equal(code, 0, stderr);
  assert.equal(stderr, '');
});

test('stdio server exits when the transport closes an oversized input buffer', async () => {
  const child = spawn(process.execPath, [join(root, 'server.cjs')], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  child.stdin.on('error', () => {});
  const exit = once(child, 'exit');
  const timer = setTimeout(() => child.kill(), 5000);
  child.stdin.write('x'.repeat(5 * 1024 * 1024));
  const [code, signal] = await exit;
  clearTimeout(timer);
  assert.equal(signal, null);
  assert.equal(code, 0);
});
