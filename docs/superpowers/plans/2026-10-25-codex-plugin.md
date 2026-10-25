# Codex Plugin Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for isolated implementation and review tasks.

**Goal:** Publish a working local Codex plugin while retaining the DSH adapter and existing Minecraft probes.

**Architecture:** One shared runtime serves DSH and an MCP adapter. The Codex bundle contains an SDK-based stdio server and a focused skill; repository marketplace metadata points to that self-contained bundle.

**Tech Stack:** Node.js 22.16+, MCP TypeScript SDK, Ajv, esbuild, Node test runner.

## Tasks

- [x] Extract `plugin/minecraft-mod-dev/core.js` with `createRuntime(options)` returning `{ tools, close }`. Tool `execute(args)` retains `{ text }`; descriptors retain `name`, `description`, and property-based `parameters`. Write failing host-independent import, instance isolation, and custom connection tests first. Keep all 48 DSH tests passing through the adapter.
- [x] Implement `codex/server.js` and `codex/stdio.js`. Test with the official SDK client over stdio. Verify all 14 tools, standard required fields, invalid-call rejection, HTTP and semantic failures, structured JSON, screenshot image bytes, and EOF shutdown. Use `npm test` for both adapter suites.
- [x] Bundle the server with `node scripts/build-codex.mjs`, add portable and Codex compatibility manifests, repository marketplace, and the `minecraft-mod-dev` skill. Validate metadata and behavior on setup and debugging scenarios; ensure generated files stay inside the package.
- [x] Package using `python scripts/package-release.py`, extract to a fresh directory, and exercise the packaged server without repository imports or node_modules. Run live status, command, UI, screenshot, and scenario calls against disposable 26.1.2 game processes.
- [x] Update README, installation instructions, changelog, licenses, and CI. Review spec coverage and implementation quality.

## Publication checks

Commit, push fork main without force, publish v0.7.0, and verify remote asset hashes and CI status. Publication evidence is recorded on the GitHub release and workflow run.
