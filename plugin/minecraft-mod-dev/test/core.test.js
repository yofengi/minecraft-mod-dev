import assert from 'node:assert/strict';
import childProcess, { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const execute = async (runtime, name, args = {}) => runtime.tools.find((tool) => tool.name === name).execute(args);

async function probeServer(t, responder) {
  const calls = [];
  const server = createServer((request, response) => {
    calls.push({ path: request.url, token: request.headers['x-mcdev-token'] });
    if (responder) return responder(request, response);
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ ok: true, data: { side: 'server' } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { port: server.address().port, calls };
}

async function waitUntil(check, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('condition did not become true');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function fixtureProject(t, { port, side = 'server', ready = true, stop = true, stopDelay = 25, loadingChecks = 0, loadingScreen = 'LevelLoadingScreen' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mcdev-core-'));
  const pidFile = join(dir, 'fixture.pid');
  const callsFile = join(dir, 'calls.jsonl');
  const config = JSON.stringify({ port, side, ready, stop, stopDelay, loadingChecks, loadingScreen, pidFile, callsFile });
  writeFileSync(join(dir, 'fixture.cjs'), `
const fs = require('node:fs');
const http = require('node:http');
const config = ${config};
fs.writeFileSync(config.pidFile, String(process.pid));
fs.writeFileSync(config.pidFile + '.args', JSON.stringify(process.argv.slice(2)));
setTimeout(() => process.exit(0), 30000).unref();
if (process.argv[2] === 'build') {
  setInterval(() => {}, 1000);
} else {
  let checks = 0;
  const server = http.createServer((request, response) => {
    fs.appendFileSync(config.callsFile, JSON.stringify({path:request.url,token:request.headers['x-mcdev-token']}) + '\\n');
    response.writeHead(config.ready || request.url !== '/status' ? 200 : 503, {'Content-Type':'application/json'});
    const screen = request.url === '/status' && ++checks <= config.loadingChecks ? config.loadingScreen : 'TitleScreen';
    response.end(JSON.stringify({ok:config.ready,data:{side:config.side,screen,player:{name:'Dev'}}}));
    if (config.stop && (request.url === '/quit' || request.url === '/command')) setTimeout(() => {
      fs.writeFileSync(config.pidFile + '.saved', 'saved');
      process.exit(0);
    }, config.stopDelay);
  });
  server.listen(config.port, '127.0.0.1');
}
`);
  writeFileSync(join(dir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'), process.platform === 'win32'
    ? `@echo off\r\n"${process.execPath}" "%~dp0fixture.cjs" %*\r\n`
    : `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' ./fixture.cjs "$@"\n`, { mode: 0o755 });
  t.after(async () => {
    if (existsSync(pidFile)) {
      const pid = Number(readFileSync(pidFile, 'utf8'));
      if (alive(pid)) {
        if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
        else process.kill(pid, 'SIGKILL');
      }
      await waitUntil(() => !alive(pid));
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, pidFile, callsFile };
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('core imports without a DSH host and provides the 14 executable tools', async () => {
  let core;
  await assert.doesNotReject(async () => { core = await import('../core.js'); });
  assert.equal(typeof core.createRuntime, 'function');
  const runtime = core.createRuntime();
  assert.deepEqual(runtime.tools.map((tool) => tool.name), [
    'mcdev_prepare', 'mcdev_stop', 'mcdev_launch_status', 'mcdev_status',
    'mcdev_command', 'mcdev_ui', 'mcdev_click', 'mcdev_screenshot',
    'mcdev_run_dump', 'mcdev_install_probe', 'mcdev_use', 'mcdev_scenario',
    'mcdev_build', 'mcdev_gametest',
  ]);
  for (const tool of runtime.tools) {
    assert.equal(typeof tool.description, 'string');
    assert.equal(typeof tool.parameters, 'object');
    assert.equal(typeof tool.execute, 'function');
    assert.equal(tool.output, undefined);
  }
  const status = runtime.tools.find((tool) => tool.name === 'mcdev_launch_status');
  assert.deepEqual(JSON.parse((await status.execute({})).text), { processes: [] });
  await runtime.close();
});

test('runtime options route requests independently and preserve per-call port overrides', async (t) => {
  const { createRuntime } = await import('../core.js');
  const server = await probeServer(t);
  const client = await probeServer(t);
  const first = createRuntime({ serverPort: server.port, clientPort: client.port, token: 'first-secret' });
  const second = createRuntime({ serverPort: client.port, clientPort: server.port, token: 'second-secret' });
  await execute(first, 'mcdev_status', { side: 'server' });
  await execute(first, 'mcdev_ui');
  await execute(second, 'mcdev_status', { side: 'server' });
  await execute(second, 'mcdev_status', { side: 'client', port: client.port });
  assert.deepEqual(server.calls, [{ path: '/status', token: 'first-secret' }]);
  assert.deepEqual(client.calls, [
    { path: '/ui/snapshot', token: 'first-secret' },
    { path: '/status', token: 'second-secret' },
    { path: '/status', token: 'second-secret' },
  ]);
  await first.close();
  await execute(second, 'mcdev_status', { side: 'server' });
  await second.close();
});

test('runtime validates configured ports and tokens without exposing token values', async () => {
  const { createRuntime } = await import('../core.js');
  for (const port of [0, -1, 65536, 39001.5, '39001', NaN]) {
    assert.throws(() => createRuntime({ serverPort: port }), /serverPort/);
    assert.throws(() => createRuntime({ clientPort: port }), /clientPort/);
  }
  for (const token of ['', 'secret\r\ninjected', 12]) {
    assert.throws(() => createRuntime({ token }), (error) => {
      assert.match(error.message, /token/);
      if (typeof token === 'string' && token) assert.ok(!error.message.includes(token));
      return true;
    });
  }
});

test('probe rejects redirects before sending authentication to another listener', async (t) => {
  const { createRuntime } = await import('../core.js');
  const target = await probeServer(t);
  const redirect = await probeServer(t, (_request, response) => {
    response.writeHead(302, { Location: `http://127.0.0.1:${target.port}/status` });
    response.end();
  });
  const runtime = createRuntime({ serverPort: redirect.port, token: 'redirect-secret' });
  await assert.rejects(execute(runtime, 'mcdev_status', { side: 'server' }));
  assert.equal(redirect.calls.length, 1);
  assert.equal(target.calls.length, 0);
  await runtime.close();
});

test('probe error responses cannot echo the configured token', async (t) => {
  const { createRuntime } = await import('../core.js');
  const server = await probeServer(t, (request, response) => {
    response.writeHead(401);
    response.end(`rejected ${request.headers['x-mcdev-token']}`);
  });
  const runtime = createRuntime({ serverPort: server.port, token: 'private-secret' });
  await assert.rejects(execute(runtime, 'mcdev_status', { side: 'server' }), (error) => {
    assert.match(error.message, /HTTP 401/);
    assert.ok(!error.message.includes('private-secret'));
    return true;
  });
  await runtime.close();
});

test('stopping an untracked process and closing an unused runtime send no probe requests', async (t) => {
  const { createRuntime } = await import('../core.js');
  const server = await probeServer(t);
  const runtime = createRuntime({ serverPort: server.port, clientPort: server.port });
  const result = JSON.parse((await execute(runtime, 'mcdev_stop', { side: 'all' })).text);
  assert.deepEqual(result.results.map(({ stopped, reason }) => ({ stopped, reason })), [
    { stopped: false, reason: 'not tracked' }, { stopped: false, reason: 'not tracked' },
  ]);
  await runtime.close();
  await runtime.close();
  assert.equal(server.calls.length, 0);
  await assert.rejects(execute(runtime, 'mcdev_status', { side: 'server' }), /closed/i);
});

test('process ownership is isolated and close terminates the owned process tree', async (t) => {
  const { createRuntime } = await import('../core.js');
  const port = await availablePort();
  const project = fixtureProject(t, { port });
  const owner = createRuntime({ serverPort: port, token: 'owner-secret' });
  const other = createRuntime({ serverPort: port });
  t.after(() => owner.close());
  const prepared = JSON.parse((await execute(owner, 'mcdev_prepare', { projectDir: project.dir, kind: 'server', timeoutMs: 5000 })).text);
  assert.equal(prepared.results[0].alreadyRunning, false);
  assert.equal(prepared.results[0].port, port);
  assert.ok(JSON.parse(readFileSync(project.pidFile + '.args', 'utf8')).includes('--no-daemon'));
  const pid = Number(readFileSync(project.pidFile, 'utf8'));
  assert.equal(alive(pid), true);
  const status = JSON.parse((await execute(other, 'mcdev_launch_status')).text);
  assert.deepEqual(status.processes, []);
  const stop = JSON.parse((await execute(other, 'mcdev_stop', { side: 'server' })).text);
  assert.equal(stop.results[0].stopped, false);
  await other.close();
  assert.equal(alive(pid), true);
  assert.ok(readFileSync(project.callsFile, 'utf8').trim().split('\n').every((line) => JSON.parse(line).token === 'owner-secret'));
  await Promise.all([owner.close(), owner.close()]);
  await waitUntil(() => !alive(pid), 1000);
  assert.equal(readFileSync(project.callsFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line)).filter(({ path }) => path === '/command').length, 1);
});

test('an already-running manual probe remains unowned after prepare and close', async (t) => {
  const { createRuntime } = await import('../core.js');
  const server = await probeServer(t);
  const project = fixtureProject(t);
  const runtime = createRuntime({ serverPort: server.port });
  const result = JSON.parse((await execute(runtime, 'mcdev_prepare', { projectDir: project.dir, kind: 'server', timeoutMs: 5000 })).text);
  assert.equal(result.results[0].alreadyRunning, true);
  assert.equal(existsSync(project.pidFile), false);
  const stopped = JSON.parse((await execute(runtime, 'mcdev_stop', { side: 'server' })).text);
  assert.equal(stopped.results[0].stopped, false);
  await runtime.close();
  assert.deepEqual(server.calls.map(({ path }) => path), ['/status']);
});

test('close cancels an active owned build and its descendants', async (t) => {
  const { createRuntime } = await import('../core.js');
  const project = fixtureProject(t);
  const runtime = createRuntime();
  const build = execute(runtime, 'mcdev_build', { projectDir: project.dir });
  const result = build.then(() => 'completed', (error) => error.message);
  await waitUntil(() => existsSync(project.pidFile));
  const pid = Number(readFileSync(project.pidFile, 'utf8'));
  await runtime.close();
  await waitUntil(() => !alive(pid), 1000);
  assert.match(await result, /closed/i);
});

test('closing during the initial status request prevents a later process launch', async (t) => {
  const { createRuntime } = await import('../core.js');
  let respond;
  const server = await probeServer(t, (_request, response) => { respond = () => { response.writeHead(503); response.end(); }; });
  const project = fixtureProject(t, { port: server.port });
  const runtime = createRuntime({ serverPort: server.port });
  const preparing = execute(runtime, 'mcdev_prepare', { projectDir: project.dir, kind: 'server', timeoutMs: 5000 });
  const rejected = assert.rejects(preparing, /closed/i);
  await waitUntil(() => respond);
  await runtime.close();
  respond();
  await rejected;
  assert.equal(existsSync(project.pidFile), false);
});

test('closing during readiness waits for the owned game to save before exiting', async (t) => {
  const { createRuntime } = await import('../core.js');
  const port = await availablePort();
  const project = fixtureProject(t, { port, ready: false, stopDelay: 250 });
  const runtime = createRuntime({ serverPort: port });
  const preparing = execute(runtime, 'mcdev_prepare', { projectDir: project.dir, kind: 'server', timeoutMs: 5000 });
  const rejected = assert.rejects(preparing, /closed/i);
  await waitUntil(() => existsSync(project.callsFile));
  await runtime.close();
  await rejected;
  assert.equal(existsSync(project.pidFile + '.saved'), true);
  assert.ok(readFileSync(project.callsFile, 'utf8').includes('/command'));
  assert.equal(alive(Number(readFileSync(project.pidFile, 'utf8'))), false);
});

test('concurrent prepares for the same side cannot create competing owned processes', async (t) => {
  const { createRuntime } = await import('../core.js');
  let respond;
  const server = await probeServer(t, (_request, response) => {
    respond = () => response.end(JSON.stringify({ ok: true, data: { side: 'server' } }));
  });
  const project = fixtureProject(t);
  const runtime = createRuntime({ serverPort: server.port });
  const first = execute(runtime, 'mcdev_prepare', { projectDir: project.dir, kind: 'server' });
  await waitUntil(() => respond);
  await assert.rejects(execute(runtime, 'mcdev_prepare', { projectDir: project.dir, kind: 'server' }), /already.*progress/i);
  respond();
  await first;
  await runtime.close();
});

test('readiness timeout terminates the owned process tree and removes its launch entry', async (t) => {
  const { createRuntime } = await import('../core.js');
  const port = await availablePort();
  const project = fixtureProject(t, { port, ready: false });
  const runtime = createRuntime({ serverPort: port });
  await assert.rejects(execute(runtime, 'mcdev_prepare', { projectDir: project.dir, kind: 'server', timeoutMs: 5000 }), /did not become ready/);
  const pid = Number(readFileSync(project.pidFile, 'utf8'));
  assert.equal(alive(pid), false);
  assert.deepEqual(JSON.parse((await execute(runtime, 'mcdev_launch_status')).text).processes, []);
  await runtime.close();
});

test('client prepare uses the configured connection for readiness, join, and stop', async (t) => {
  const { createRuntime } = await import('../core.js');
  const port = await availablePort();
  const project = fixtureProject(t, { port, side: 'client' });
  const runtime = createRuntime({ clientPort: port, token: 'client-secret' });
  const result = JSON.parse((await execute(runtime, 'mcdev_prepare', { projectDir: project.dir, kind: 'client', timeoutMs: 5000 })).text);
  assert.equal(result.results[0].joined, true);
  const stopped = JSON.parse((await execute(runtime, 'mcdev_stop', { side: 'client' })).text);
  assert.equal(stopped.results[0].stopped, true);
  const calls = readFileSync(project.callsFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.ok(calls.some(({ path }) => path === '/connect?host=127.0.0.1&port=25566'));
  assert.ok(calls.some(({ path }) => path === '/quit'));
  assert.ok(calls.every(({ token }) => token === 'client-secret'));
  await runtime.close();
});

for (const loadingScreen of ['LevelLoadingScreen', 'ProgressScreen']) {
  test(`client prepare waits while a player exists on ${loadingScreen}`, async (t) => {
    const { createRuntime } = await import('../core.js');
    const port = await availablePort();
    const project = fixtureProject(t, { port, side: 'client', loadingChecks: 3, loadingScreen });
    const runtime = createRuntime({ clientPort: port });
    try {
      const result = JSON.parse((await execute(runtime, 'mcdev_prepare', { projectDir: project.dir, kind: 'client', timeoutMs: 5000 })).text);
      assert.equal(result.results[0].joined, true);
      assert.equal(result.results[0].lastScreen, 'TitleScreen');
    } finally {
      await runtime.close();
    }
  });
}

test('close interrupts an in-flight scenario wait before the next action', async (t) => {
  const { createRuntime } = await import('../core.js');
  const server = await probeServer(t);
  const runtime = createRuntime({ serverPort: server.port });
  const scenario = execute(runtime, 'mcdev_scenario', { steps: [
    { type: 'wait', ms: 1000 }, { type: 'command', cmd: 'say should-not-run' },
  ] });
  await runtime.close();
  const result = await Promise.race([
    scenario.then((value) => value, (error) => ({ text: JSON.stringify({ ok: false, error: error.message }) })),
    new Promise((resolve) => setTimeout(() => resolve({ text: '{"ok":true}' }), 200)),
  ]);
  assert.equal(JSON.parse(result.text).ok, false);
  assert.equal(server.calls.length, 0);
});

test('scenario preflights every step before any earlier command can run', async (t) => {
  const { createRuntime } = await import('../core.js');
  const server = await probeServer(t);
  const runtime = createRuntime({ serverPort: server.port });
  for (const invalid of [
    { type: 'command' }, { type: 'command', cmd: '   ' },
    { type: 'unknown' }, { type: 'status', port: 65536 },
    { type: 'status', side: 'remote' }, { type: 'item' },
    { type: 'recipe' }, { type: 'craft', id: '' }, { type: 'loot' },
    { type: 'use', x: 0, y: 64 }, { type: 'block', x: '0' },
    { type: 'assert', op: 'invalid' }, { type: 'assert', step: 1 },
  ]) {
    await assert.rejects(execute(runtime, 'mcdev_scenario', { minecraftVersion: '1.20.1', steps: [
      { type: 'command', cmd: 'say should-not-run' }, invalid,
    ] }), /step/i);
  }
  assert.equal(server.calls.length, 0);
  await runtime.close();
});

test('DSH adapter retains its rendering contract and registers runtime cleanup', async (t) => {
  const hook = registerHooks({ resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') return { url: 'data:text/javascript,export const defineTool = (tool) => tool;', shortCircuit: true };
    return nextResolve(specifier, context);
  } });
  t.after(() => hook.deregister());
  const { apply, name, inject } = await import('../index.js');
  const tools = [];
  let cleanup;
  apply({ tools: { register: (tool) => tools.push(tool) }, effect: (setup) => { cleanup = setup(); } });
  assert.equal(name, 'mcdev');
  assert.deepEqual(inject, ['tools']);
  assert.equal(tools.length, 14);
  assert.deepEqual(tools[0].output.render({}, { text: 'hello' }), [{ type: 'text', text: 'hello' }]);
  assert.equal(tools[0].output.schema.properties.text.required, true);
  await cleanup();
  await assert.rejects(tools.find(({ name }) => name === 'mcdev_launch_status').execute({}), /closed/i);
});

test('semantic failure payloads redact tokens while successful payloads remain unchanged', async (t) => {
  const { createRuntime } = await import('../core.js');
  const token = 'payload-secret';
  const payload = { ok: true, results: [
    { ok: false, error: `rejected ${token}` },
    { exitCode: 1, tail: `failure ${token}` },
    { ok: true, data: { name: token } },
  ] };
  const server = await probeServer(t, (_request, response) => response.end(JSON.stringify(payload)));
  const runtime = createRuntime({ serverPort: server.port, token });
  const result = JSON.parse((await execute(runtime, 'mcdev_status', { side: 'server' })).text);
  assert.ok(!result.results[0].error.includes(token));
  assert.ok(!result.results[1].tail.includes(token));
  assert.equal(result.results[2].data.name, token);
  await runtime.close();
});

test('failed tree termination returns a semantic failure and can be retried during close', async (t) => {
  const { createRuntime } = await import('../core.js');
  const port = await availablePort();
  const project = fixtureProject(t, { port, stop: false });
  const runtime = createRuntime({ serverPort: port });
  await execute(runtime, 'mcdev_prepare', { projectDir: project.dir, kind: 'server', timeoutMs: 5000 });
  const original = childProcess.spawnSync;
  const kill = t.mock.method(childProcess, 'spawnSync', (...args) => args[0] === 'taskkill'
    ? { status: 1, stderr: 'denied' } : original(...args));
  syncBuiltinESMExports();
  try {
    if (process.platform === 'win32') {
      const stopped = JSON.parse((await execute(runtime, 'mcdev_stop', { side: 'server' })).text);
      assert.equal(stopped.ok, false);
      assert.equal(stopped.results[0].ok, false);
      assert.equal(stopped.results[0].stopped, false);
    }
  } finally {
    kill.mock.restore();
    syncBuiltinESMExports();
    await runtime.close();
  }
});

test('a build timeout rejects after terminating its owned descendants', async (t) => {
  const { createRuntime } = await import('../core.js');
  const project = fixtureProject(t);
  const runtime = createRuntime();
  const timer = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, ms, ...args) => timer(callback, ms === 900000 ? 300 : ms, ...args));
  await assert.rejects(execute(runtime, 'mcdev_build', { projectDir: project.dir }), /timed out/);
  assert.equal(alive(Number(readFileSync(project.pidFile, 'utf8'))), false);
  await runtime.close();
});

test('a root null build exit code redacts failure output without changing nested launch status', async (t) => {
  const { createRuntime } = await import('../core.js');
  const token = 'signal-secret';
  let payload = { exitCode: null, tail: `interrupted ${token}` };
  const server = await probeServer(t, (_request, response) => response.end(JSON.stringify(payload)));
  const runtime = createRuntime({ serverPort: server.port, token });
  const failed = JSON.parse((await execute(runtime, 'mcdev_status', { side: 'server' })).text);
  assert.ok(!failed.tail.includes(token));
  payload = { processes: [{ exitCode: null, label: token }] };
  const running = JSON.parse((await execute(runtime, 'mcdev_status', { side: 'server' })).text);
  assert.equal(running.processes[0].label, token);
  await runtime.close();
});
