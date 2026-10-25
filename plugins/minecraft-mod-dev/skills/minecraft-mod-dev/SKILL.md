---
name: minecraft-mod-dev
description: Use when developing, building, debugging, or testing Minecraft mods for Forge 1.20.1 or Forge/NeoForge 26.1.2 with the local mcdev MCP plugin and game probes.
---

# Minecraft mod development

Use the local plugin's MCP tools with the existing game probes. Preserve the user's chosen project, launcher, loader, and task authorization; ordinary development does not require changing global Codex configuration.

## Identify the target

Distinguish the **Gradle project** (wrapper and build files) from the **game run directory** (mods, saves, launcher instance metadata). A launcher path alone is not a `projectDir`. Inspect available files and existing probes before requesting missing information.

| Target | JDK | Probe compatibility |
|---|---|---|
| Forge 1.20.1 | 17 | Legacy `*-dev.jar`, Forge development environment only |
| Forge 26.1.2 | 25 | Forge 26.1.2 probe |
| NeoForge 26.1.2 | 25 | NeoForge 26.1.2 probe |

Match both Minecraft version and loader. Install into the actual instance's `mods` directory, including launcher version isolation; keep one probe per instance. The 26.1.2 jars support normal launcher instances. Launch those through their launcher; `mcdev_prepare`, `mcdev_build`, and `mcdev_gametest` require a Gradle project. Their optional `javaHome` applies to the child process.

## Connect and choose tools

Discover available tools by `mcdev_` name or suffix, then call the exact exposed name, including any host prefix. Read its schema rather than inventing tools or arguments.

First call `mcdev_status` for the relevant sides and check version, loader, world/player, and screen. Reuse a matching running probe before launching another process. The server probe is available in a loaded singleplayer world as well as a dedicated server.

Default connections use loopback and token `mcdev`. Optional MCP settings must match the game's JVM properties:

| MCP environment | Game JVM property | Default |
|---|---|---|
| `MCDEV_TOKEN` | `mcdev.probe.token` | `mcdev` |
| `MCDEV_SERVER_PORT` | `mcdev.probe.port` | `39001` |
| `MCDEV_CLIENT_PORT` | `mcdev.probe.client.port` | `39002` |

MCP settings do not reconfigure a running game. Probe ports differ from the multiplayer port (`joinPort`, default `25566`). Avoid embedding personal paths or tokens in project files.

| Need | Tools and key arguments |
|---|---|
| Inspect | `mcdev_status(side)`, `mcdev_ui`, `mcdev_run_dump(side)` |
| Interact | `mcdev_command(side, cmd)` without leading slash; `mcdev_use(x,y,z)`; `mcdev_click(slot)` or GUI-scaled `x,y` |
| Capture | `mcdev_screenshot`: MCP returns an image plus metadata; inspect the image |
| Scenario | `mcdev_scenario(steps)` or `(card)`; `dryRun` translates without executing |
| Install | `mcdev_install_probe(probeJar, runDirs, loader, minecraftVersion)` |
| Build/test | `mcdev_build(projectDir)`, `mcdev_gametest(projectDir)` |
| Process | `mcdev_prepare(projectDir, kind)`, `mcdev_launch_status`, `mcdev_stop(side)` |

`mcdev_stop` manages processes launched by this runtime. UI tools target the client. Recipe, craft, block, and item operations are scenario step types, not separate tool names. For 26.1.2 scenarios set `minecraftVersion: "26.1.2"` explicitly, including dry runs; use native `components` for modern item properties, with legacy `nbt` mapped to custom data.

## Verify the requested behavior

Run destructive commands, mining, inventory changes, tick control, and smoke scenarios in a disposable test world. Continue within existing task authorization; this skill adds no blanket confirmation gate.

Inspect MCP errors, `exitCode`, nested `ok: false`, scenario assertions, and warnings. Minecraft command `result: 0` is not a process exit code or universal failure signal; interpret the command's semantics and resulting state. A successful request or scenario wrapper alone does not prove the feature works. Warnings can indicate skipped actions or assertions.

For example, follow a `craft` scenario step with an assertion on `data.crafted` equal to `"true"`, then verify the expected output and inventory changes. Use screen evidence for visual behavior. Report only the behavior actually exercised, with unresolved warnings and coverage gaps.

Run GameTest when the target mod registers relevant tests. Do not manufacture a passing claim from an empty run: the old Charger example and its 12 tests cover 1.20.1, not 26.1.2. Builds and probe smoke checks establish their own narrower evidence.
