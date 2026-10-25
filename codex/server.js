import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import Ajv from 'ajv';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import metadata from '../package.json' with { type: 'json' };

const readOnlyTools = new Set(['mcdev_status', 'mcdev_ui', 'mcdev_launch_status']);
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const maxImageBytes = 16 * 1024 * 1024;

function parameterSchema(parameters) {
  const properties = {};
  const required = [];
  for (const [name, definition] of Object.entries(parameters)) {
    const { required: mandatory, ...schema } = definition;
    if (mandatory) required.push(name);
    if (schema.properties) {
      Object.assign(schema, parameterSchema(schema.properties), { additionalProperties: schema.additionalProperties ?? false });
    }
    if (schema.items?.properties) {
      schema.items = { ...schema.items, ...parameterSchema(schema.items.properties), additionalProperties: schema.items.additionalProperties ?? false };
    }
    if (name === 'port' || name === 'joinPort') Object.assign(schema, { minimum: 1, maximum: 65535 });
    properties[name] = schema;
  }
  return { type: 'object', properties, required, additionalProperties: false };
}

function failed(value, root = true) {
  if (!value || typeof value !== 'object') return false;
  if (value.ok === false || (root && Object.hasOwn(value, 'exitCode') && value.exitCode !== 0)) return true;
  if (value.kind === 'client' && value.joined === false) return true;
  return Object.values(value).some((child) => child && typeof child === 'object' && failed(child, false));
}

async function screenshotImage(data) {
  if (!data?.exists || typeof data.path !== 'string' || !isAbsolute(data.path)) {
    throw new Error('Screenshot was not saved to an absolute local path');
  }
  const file = await open(data.path, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maxImageBytes || stat.size < pngSignature.length) {
      throw new Error('Screenshot must be a PNG file smaller than 16 MiB');
    }
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) throw new Error('Screenshot file is incomplete');
      offset += bytesRead;
    }
    if (!bytes.subarray(0, pngSignature.length).equals(pngSignature)) {
      throw new Error('Screenshot file is not a PNG');
    }
    return { type: 'image', mimeType: 'image/png', data: bytes.toString('base64') };
  } finally {
    await file.close();
  }
}

export function runtimeOptionsFromEnv(env) {
  const options = {};
  for (const [key, option] of [['MCDEV_SERVER_PORT', 'serverPort'], ['MCDEV_CLIENT_PORT', 'clientPort']]) {
    if (env[key] === undefined) continue;
    if (!/^\d+$/.test(env[key]) || Number(env[key]) < 1 || Number(env[key]) > 65535) {
      throw new Error(`${key} must be an integer from 1 to 65535`);
    }
    options[option] = Number(env[key]);
  }
  if (env.MCDEV_TOKEN !== undefined) {
    if (!env.MCDEV_TOKEN) throw new Error('MCDEV_TOKEN must not be empty');
    options.token = env.MCDEV_TOKEN;
  }
  return options;
}

export function createMcpServer(runtime) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const tools = runtime.tools.map((tool) => {
    const inputSchema = parameterSchema(tool.parameters);
    return { ...tool, inputSchema, validate: ajv.compile(inputSchema) };
  });
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const server = new Server({ name: 'minecraft-mod-dev', version: metadata.version }, {
    capabilities: { tools: {} },
    instructions: 'Local Minecraft Forge/NeoForge tools. Read status before launching. A launcher instance is not a Gradle project. Use the installed minecraft-mod-dev skill for setup and verification.',
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(({ name, description, inputSchema }) => ({
      name, description, inputSchema,
      annotations: {
        readOnlyHint: readOnlyTools.has(name),
        destructiveHint: !readOnlyTools.has(name),
        idempotentHint: readOnlyTools.has(name),
        openWorldHint: false,
      },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    try {
      const tool = byName.get(params.name);
      if (!tool) throw new Error(`Unknown tool: ${params.name}`);
      const args = params.arguments ?? {};
      if (!tool.validate(args)) throw new Error(`Invalid arguments: ${ajv.errorsText(tool.validate.errors)}`);
      const { text } = await tool.execute(args);
      const result = { content: [{ type: 'text', text }] };
      let data;
      try { data = JSON.parse(text); } catch { /* Preserve non-JSON output. */ }
      if (data && typeof data === 'object' && !Array.isArray(data)) result.structuredContent = data;
      if (failed(data)) result.isError = true;
      if (params.name === 'mcdev_screenshot' && !result.isError) {
        result.content.push(await screenshotImage(data?.data));
      }
      return result;
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: String(error?.message ?? error) }] };
    }
  });
  return server;
}
