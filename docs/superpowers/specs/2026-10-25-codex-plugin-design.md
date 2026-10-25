# Codex plugin for Minecraft mod development

The user approved a local Codex plugin backed by MCP, reusing the existing Forge/NeoForge probes and retaining DSH support, and requested publication to the fork.

## Design

- Extract the existing 14 tools into a host-independent JavaScript runtime. Each runtime owns its process registry and connection settings. DSH remains a thin registration adapter with its existing result shape.
- Add a local stdio MCP server using the official TypeScript SDK. Convert existing parameter definitions to JSON Schema, validate calls, expose structured results, and mark tool failures explicitly. Screenshot calls return a PNG image as well as the original metadata.
- Package a Codex plugin under `plugins/minecraft-mod-dev`, including the bundled server, skill, manifests, icon, and license notices. The distribution needs Node.js 22.16+ but no npm install. A repository marketplace makes the plugin discoverable.
- Keep Minecraft/JDK/project paths as call arguments. Optional environment settings configure probe token and server/client ports. Probe connection settings must match the running game's JVM properties; they do not reconfigure a game instance.
- Add a concise skill for setup, choosing the correct loader/JDK, distinguishing a launcher instance from a Gradle project, and checking game evidence. Existing Java jars remain unchanged.
- Publish v0.7.0 with separate Codex and DSH ZIPs plus the existing two probe jars. Local use is supported; no public plugin directory submission or global Codex configuration change is included.

## Operational constraints

MCP stdout contains protocol messages only. Errors must not expose the token. Shutdown stops only processes owned by that runtime. Existing manually launched games are never claimed as owned. Screenshot files are bounded and checked as PNGs before inclusion. Invalid parameters fail before commands or writes run.

## Verification

Preserve all DSH tests; add runtime isolation/configuration tests and real SDK client/server stdio tests. Exercise listing, argument failures, unavailable probes, semantic tool failures, status/command forwarding, scenario dry runs, screenshots, and shutdown. Build and validate the self-contained release archive in a separate directory. Run live MCP calls against a disposable NeoForge server/client. CI tests both adapters and continues building both Java probes.
