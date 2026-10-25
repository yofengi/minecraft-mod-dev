import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const [projectDir, javaHome, joinPort = '25566'] = process.argv.slice(2);
if (!projectDir || !javaHome) throw new Error('Usage: node lab/tools/smoke_mcp.mjs <disposable Gradle project> <JDK home> [game port]');
const client = new Client({ name: 'mcdev-live-smoke', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath, args: [resolve(process.env.MCDEV_MCP_ENTRY ?? 'plugins/minecraft-mod-dev/server.cjs')],
  env: { ...process.env }, stderr: 'pipe',
});
transport.stderr.on('data', (chunk) => process.stderr.write(chunk));
async function call(name, args = {}) {
  const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 1_200_000 });
  assert.notEqual(response.isError, true, JSON.stringify(response.content));
  return response;
}

await client.connect(transport);
try {
  assert.equal((await client.listTools()).tools.length, 14);
  assert.equal((await call('mcdev_build', { projectDir: resolve(projectDir), javaHome })).structuredContent.exitCode, 0);
  console.log('MCP build passed');
  const launch = (await call('mcdev_prepare', { projectDir: resolve(projectDir), javaHome, kind: 'both', joinPort: Number(joinPort) })).structuredContent;
  assert.ok(launch.results.find((item) => item.kind === 'client').joined);
  const status = (await call('mcdev_status', { side: 'client' })).structuredContent.data;
  assert.equal(status.version, '26.1.2');
  assert.doesNotMatch(status.screen ?? '', /ConnectScreen|DisconnectedScreen|ReceivingLevelScreen|LevelLoadingScreen|ProgressScreen/);
  const state = (await call('mcdev_launch_status')).structuredContent;
  assert.equal(state.processes.filter((item) => item.running).length, 2);
  const scenario = (await call('mcdev_scenario', {
    minecraftVersion: '26.1.2',
    steps: [
      { type: 'command', cmd: `clear ${status.player}` },
      { type: 'command', cmd: `give ${status.player} minecraft:oak_log 1` },
      { type: 'craft', id: 'minecraft:oak_planks', player: status.player },
      { type: 'assert', path: 'data.crafted', value: 'true' },
      { type: 'assert', path: 'data.result.count', value: '4' },
    ],
  })).structuredContent;
  assert.equal(scenario.ok, true);
  assert.deepEqual(scenario.warnings, []);
  await call('mcdev_ui');
  const screenshot = await call('mcdev_screenshot');
  assert.ok(screenshot.content.some((part) => part.type === 'image' && part.mimeType === 'image/png'));
  await call('mcdev_run_dump', { side: 'server', n: 5 });
  console.log(JSON.stringify({ ok: true, loader: status.loader, version: status.version, player: status.player, screenshot: screenshot.structuredContent.data.path }));
} finally {
  try {
    await call('mcdev_stop', { side: 'all' });
    assert.deepEqual((await call('mcdev_launch_status')).structuredContent.processes, []);
  } finally {
    await client.close();
  }
}
