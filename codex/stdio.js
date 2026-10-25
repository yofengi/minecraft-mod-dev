import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createRuntime } from '../plugin/minecraft-mod-dev/core.js';
import { createMcpServer, runtimeOptionsFromEnv } from './server.js';

let runtime;
let server;
let closing;

function shutdown() {
  closing ??= (async () => {
    await runtime?.close();
    await server?.close();
  })().catch((error) => {
    process.stderr.write(`Minecraft MCP shutdown failed: ${error.message}\n`);
    process.exitCode = 1;
  });
  return closing;
}

async function main() {
  runtime = createRuntime(runtimeOptionsFromEnv(process.env));
  server = createMcpServer(runtime);
  server.onclose = shutdown;
  process.stdin.once('end', shutdown);
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  await server.connect(new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 4 * 1024 * 1024 }));
}

main().catch(async (error) => {
  process.stderr.write(`Minecraft MCP startup failed: ${error.message}\n`);
  process.exitCode = 1;
  await shutdown();
});
