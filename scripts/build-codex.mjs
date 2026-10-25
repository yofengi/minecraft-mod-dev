import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'plugins/minecraft-mod-dev');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const manifest = readJson(join(dest, 'plugin.json'));
manifest.version = readJson(join(root, 'package.json')).version;
writeJson(join(dest, 'plugin.json'), manifest);
mkdirSync(join(dest, '.codex-plugin'), { recursive: true });
writeJson(join(dest, '.codex-plugin/plugin.json'), {
  name: manifest.name, version: manifest.version, description: manifest.description,
  author: manifest.author, repository: manifest.repository, license: manifest.license,
  skills: './skills/', mcpServers: './.mcp.json',
  ...manifest.extensions['com.openai'],
});
const { $schema, ...mcp } = readJson(join(dest, 'mcp.json'));
writeJson(join(dest, '.mcp.json'), mcp);
mkdirSync(join(dest, 'assets'), { recursive: true });
copyFileSync(join(root, 'plugin/minecraft-mod-dev/icon.svg'), join(dest, 'assets/icon.svg'));
copyFileSync(join(root, 'LICENSE'), join(dest, 'LICENSE'));
if (existsSync(join(root, 'docs/CODEX.md'))) copyFileSync(join(root, 'docs/CODEX.md'), join(dest, 'README.md'));
const result = await build({
  absWorkingDir: root, entryPoints: ['codex/stdio.js'], outfile: join(dest, 'server.cjs'),
  bundle: true, platform: 'node', format: 'cjs', target: 'node22',
  minify: true, legalComments: 'linked', metafile: true,
});
const packages = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  if (!input.includes('node_modules/')) continue;
  let folder = dirname(resolve(root, input));
  while (folder !== root) {
    if (existsSync(join(folder, 'package.json')) && readJson(join(folder, 'package.json')).name) break;
    folder = dirname(folder);
  }
  if (folder !== root) packages.add(folder);
}
const licenses = [];
for (const folder of [...packages].sort()) {
  const pkg = readJson(join(folder, 'package.json'));
  const text = readdirSync(folder).filter((name) => /^licen[cs]e(?:[.-].*)?$/i.test(name))
    .map((name) => readFileSync(join(folder, name), 'utf8')).join('\n');
  if (!text) throw new Error(`Missing bundled license for ${pkg.name}`);
  licenses.push(`${pkg.name} ${pkg.version}\n${'='.repeat(60)}\n${text}`);
}
writeFileSync(join(dest, 'THIRD_PARTY_LICENSES.txt'), licenses.join('\n\n'));
console.log(`Built ${manifest.name} ${manifest.version}; ${packages.size} dependency license files included.`);
