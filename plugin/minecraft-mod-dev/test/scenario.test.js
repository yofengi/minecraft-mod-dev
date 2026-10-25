import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') {
      return { url: 'data:text/javascript,export const defineTool = (tool) => tool;', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { apply } = await import('../index.js');
const tools = new Map();
apply({ tools: { register: (tool) => tools.set(tool.name, tool) } });
const scenario = async (args) => JSON.parse((await tools.get('mcdev_scenario').execute(args)).text);

function cardFile(t, values) {
  const dir = mkdtempSync(join(tmpdir(), 'mcdev-scenario-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'card.yml');
  const lines = Object.entries(values).map(([key, value]) => Array.isArray(value)
    ? `${key}:\n${value.map((item) => `  - ${JSON.stringify(item)}`).join('\n')}`
    : `${key}: ${JSON.stringify(value)}`);
  writeFileSync(path, lines.join('\n'));
  return path;
}

function stubProbe(t, version = '26.1.2') {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (input, options = {}) => {
    const url = new URL(input);
    calls.push({ url, options });
    const data = url.pathname === '/status' ? { side: 'server', version }
      : url.pathname === '/item' ? { visible: true, width: 8, color: 65280 }
        : { result: 0 };
    return new Response(JSON.stringify({ ok: true, data }), { status: 200 });
  });
  return calls;
}

test('legacy dryRun keeps NBT on give without select and never queries a probe', async (t) => {
  const calls = stubProbe(t);
  const card = cardFile(t, { actions: [{ give: { item: 'minecraft:stick', nbt: 'Energy:7', count: 2 } }] });
  const result = await scenario({ card, dryRun: true });
  assert.equal(result.minecraftVersion, '1.20.1');
  assert.equal(result.steps[0].cmd, 'give Dev minecraft:stick{Energy:7} 2');
  assert.equal(calls.length, 0);
});

test('modern give and select translate legacy NBT to custom_data', async (t) => {
  const card = cardFile(t, {
    minecraftVersion: '26.1.2',
    actions: [
      { give: { item: 'minecraft:stick', nbt: 'Energy:7', select: true, count: 2 } },
      { select_item: { item: 'minecraft:stick', nbt: '{Energy:9}' } },
    ],
  });
  const result = await scenario({ card, dryRun: true });
  assert.deepEqual(result.steps.map((step) => step.cmd), [
    'give Dev minecraft:stick[minecraft:custom_data={Energy:7}] 2',
    'item replace entity Dev weapon.mainhand with minecraft:stick[minecraft:custom_data={Energy:7}] 2',
    'item replace entity Dev weapon.mainhand with minecraft:stick[minecraft:custom_data={Energy:9}] 1',
  ]);
});

test('modern card supports native components with optional outer brackets', async (t) => {
  const card = cardFile(t, {
    actions: [
      { give: { item: 'minecraft:diamond_sword', components: '[minecraft:damage=3]', select: true } },
      { select_item: { item: 'minecraft:diamond_sword', components: 'minecraft:damage=4' } },
    ],
  });
  const result = await scenario({ card, dryRun: true, minecraftVersion: '26.1.2' });
  assert.deepEqual(result.steps.map((step) => step.cmd), [
    'give Dev minecraft:diamond_sword[minecraft:damage=3] 1',
    'item replace entity Dev weapon.mainhand with minecraft:diamond_sword[minecraft:damage=3] 1',
    'item replace entity Dev weapon.mainhand with minecraft:diamond_sword[minecraft:damage=4] 1',
  ]);
});

test('explicit Minecraft version takes priority over card version', async (t) => {
  const card = cardFile(t, {
    minecraftVersion: '26.1.2',
    actions: [{ select_item: { item: 'minecraft:stick', nbt: 'Energy:9' } }],
  });
  const result = await scenario({ card, dryRun: true, minecraftVersion: '1.20.1' });
  assert.equal(result.steps[0].cmd, 'item replace entity Dev weapon.mainhand with minecraft:stick{Energy:9} 1');
  assert.equal(result.minecraftVersion, '1.20.1');
});

for (const action of ['give', 'select_item']) {
  test(`legacy ${action} rejects unsupported components`, async (t) => {
    const card = cardFile(t, {
      actions: [{ [action]: { item: 'minecraft:diamond_sword', components: 'minecraft:damage=3' } }],
    });
    await assert.rejects(scenario({ card, dryRun: true, minecraftVersion: '1.20.1' }), /components.*1\.20\.1|1\.20\.1.*components/i);
  });
}

test('legacy direct item step rejects components before earlier commands execute', async (t) => {
  const calls = stubProbe(t);
  await assert.rejects(scenario({
    minecraftVersion: '1.20.1',
    steps: [
      { type: 'command', cmd: 'time set day' },
      { type: 'item', item: 'minecraft:diamond_sword', components: 'minecraft:damage=3' },
    ],
  }), /components.*1\.20\.1|1\.20\.1.*components/i);
  assert.equal(calls.length, 0);
});

test('modern direct item step forwards normalized components and NBT', async (t) => {
  const calls = stubProbe(t);
  const result = await scenario({
    minecraftVersion: '26.1.2',
    steps: [{ type: 'item', item: 'minecraft:diamond_sword', components: '[minecraft:damage=3]', nbt: 'Energy:7' }],
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, '/item');
  assert.equal(calls[0].url.searchParams.get('components'), 'minecraft:damage=3');
  assert.equal(calls[0].url.searchParams.get('nbt'), 'Energy:7');
});

test('item_bar card assertion forwards components to the item probe', async (t) => {
  const calls = stubProbe(t);
  const card = cardFile(t, {
    minecraftVersion: '26.1.2',
    assert: [{ item_bar: { item: 'minecraft:diamond_sword', components: 'minecraft:damage=3', visible: true, width: 8 } }],
  });
  const result = await scenario({ card });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.searchParams.get('components'), 'minecraft:damage=3');
});

test('modern commands combine native components with custom NBT data', async (t) => {
  const card = cardFile(t, {
    actions: [{ give: { item: 'minecraft:diamond_sword', nbt: 'Energy:7', components: 'minecraft:damage=3' } }],
  });
  const result = await scenario({ card, dryRun: true, minecraftVersion: '26.1.2' });
  assert.equal(result.steps[0].cmd, 'give Dev minecraft:diamond_sword[minecraft:damage=3,minecraft:custom_data={Energy:7}] 1');
});

for (const components of ['minecraft:custom_data={A:1}', 'custom_data={A:1}']) {
  test(`rejects ambiguous NBT with ${components}`, async (t) => {
    const card = cardFile(t, { actions: [{ give: { item: 'minecraft:stick', nbt: 'B:2', components } }] });
    await assert.rejects(scenario({ card, dryRun: true, minecraftVersion: '26.1.2' }), /nbt.*custom_data|custom_data.*nbt/i);
    await assert.rejects(scenario({
      minecraftVersion: '26.1.2', dryRun: true,
      steps: [{ type: 'item', item: 'minecraft:stick', nbt: 'B:2', components }],
    }), /nbt.*custom_data|custom_data.*nbt/i);
  });
}

for (const slashCount of [2, 4]) {
  test(`rejects duplicate custom_data after a quote preceded by ${slashCount} backslashes`, async (t) => {
    const components = `minecraft:custom_name="${'\\'.repeat(slashCount)}",minecraft:custom_data={A:1}`;
    await assert.rejects(scenario({
      minecraftVersion: '26.1.2', dryRun: true,
      steps: [{ type: 'item', item: 'minecraft:stick', nbt: 'B:2', components }],
    }), /nbt.*custom_data|custom_data.*nbt/i);
    const card = cardFile(t, { actions: [{ give: { item: 'minecraft:stick', nbt: 'B:2', components } }] });
    await assert.rejects(scenario({ card, dryRun: true, minecraftVersion: '26.1.2' }), /nbt.*custom_data|custom_data.*nbt/i);
  });
}

test('escaped quotes keep component-like text inside the quoted value', async () => {
  const components = String.raw`minecraft:custom_name="text\",minecraft:custom_data={A:1}"`;
  const result = await scenario({
    minecraftVersion: '26.1.2', dryRun: true,
    steps: [{ type: 'item', item: 'minecraft:stick', nbt: 'B:2', components }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.steps[0].components, components);
});

test('live card infers Minecraft version from server status when not supplied', async (t) => {
  const calls = stubProbe(t);
  const card = cardFile(t, { actions: [{ give: { item: 'minecraft:stick', nbt: 'Energy:7' } }] });
  const result = await scenario({ card });
  assert.equal(result.ok, true);
  assert.equal(calls[0].url.pathname, '/status');
  assert.equal(JSON.parse(calls[1].options.body).cmd, 'give Dev minecraft:stick[minecraft:custom_data={Energy:7}] 1');
});

test('explicit version avoids inference and command result zero remains valid', async (t) => {
  const calls = stubProbe(t);
  const result = await scenario({ minecraftVersion: '26.1.2', steps: [{ type: 'command', cmd: 'time query daytime' }] });
  assert.equal(result.ok, true);
  assert.equal(result.steps[0].data.data.result, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, '/command');
});
