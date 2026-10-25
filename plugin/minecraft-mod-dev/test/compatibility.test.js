import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
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
const execute = async (name, args) => JSON.parse((await tools.get(name).execute(args)).text);

function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), 'mcdev-compat-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function zip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name);
    const content = Buffer.from(text);
    const compressed = deflateRawSync(content);
    let crc = 0xffffffff;
    for (const byte of content) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(content.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50);
    record.writeUInt16LE(20, 6);
    header.copy(record, 8, 6, 26);
    record.writeUInt16LE(nameBytes.length, 28);
    record.writeUInt32LE(offset, 42);
    local.push(header, nameBytes, compressed);
    central.push(record, nameBytes);
    offset += header.length + nameBytes.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

function probeJar(dir, { loader = 'neoforge', version = '26.1.2', legacy = false, manifest, descriptor, filename } = {}) {
  const name = filename ?? (legacy ? 'mcdev_probe-0.1.0-dev.jar' : `mcdev_probe-${loader}-${version}-0.2.0.jar`);
  const metadata = manifest ?? (legacy
    ? 'Manifest-Version: 1.0\r\nMixinConfigs: mcdev_probe.mixins.json\r\n'
    : `Manifest-Version: 1.0\r\nMcdev-Loader: ${loader}\r\nMcdev-Minecraft-Version: ${version}\r\nMcdev-Mappings: official\r\n`);
  const path = join(dir, name);
  writeFileSync(path, zip({
    'META-INF/MANIFEST.MF': metadata,
    [`META-INF/${loader === 'neoforge' && !legacy ? 'neoforge.mods.toml' : 'mods.toml'}`]: descriptor ?? 'modLoader="javafml"\n[[mods]]\nmodId="mcdev_probe"\nversion="0.2.0"\n',
  }));
  return path;
}

function instance(dir, name, loader, version = '26.1.2') {
  const runDir = join(dir, name);
  mkdirSync(runDir);
  const coordinate = loader === 'neoforge' ? 'net.neoforged:neoforge:26.1.2.114' : 'net.minecraftforge:forge:26.1.2-64.1.5';
  writeFileSync(join(runDir, `${name}.json`), JSON.stringify({
    id: name, inheritsFrom: version, libraries: [{ name: coordinate }],
  }));
  writeFileSync(join(runDir, 'launcher_accounts.json'), 'not launcher version metadata');
  return runDir;
}

test('legacy Forge dev jar keeps MixinConfigs validation', async (t) => {
  const dir = sandbox(t);
  const valid = probeJar(dir, { legacy: true });
  const result = await execute('mcdev_install_probe', { probeJar: valid, runDirs: [join(dir, 'legacy')] });
  assert.equal(result.hasMixinConfigs, true);
  const invalid = probeJar(dir, { legacy: true, manifest: 'Manifest-Version: 1.0\n' });
  await assert.rejects(execute('mcdev_install_probe', { probeJar: invalid, runDirs: [join(dir, 'invalid')] }), /MixinConfigs/);
  assert.equal(existsSync(join(dir, 'invalid', 'mods')), false);
});

for (const loader of ['forge', 'neoforge']) {
  test(`installs official-mapped ${loader} 26.1.2 jar`, async (t) => {
    const dir = sandbox(t);
    const jar = probeJar(dir, { loader });
    const result = await execute('mcdev_install_probe', { probeJar: jar, runDirs: [join(dir, 'run')], loader, minecraftVersion: '26.1.2' });
    assert.equal(result.loader, loader);
    assert.equal(result.minecraftVersion, '26.1.2');
    assert.equal(result.manifestChecked, true);
    assert.deepEqual(readFileSync(result.targets[0].dest), readFileSync(jar));
  });
}

test('rejects normal legacy reobfuscated jars', async (t) => {
  const dir = sandbox(t);
  const jar = probeJar(dir, { legacy: true, filename: 'mcdev_probe-0.1.0.jar' });
  await assert.rejects(execute('mcdev_install_probe', { probeJar: jar, runDirs: [join(dir, 'run')] }), /dev.jar/);
});

for (const [label, change, expected] of [
  ['missing mapping metadata', { manifest: 'Mcdev-Loader: neoforge\nMcdev-Minecraft-Version: 26.1.2\n' }, /official/],
  ['wrong mod identity', { descriptor: '[[mods]]\nmodId="another_mod"\n' }, /mcdev_probe/],
  ['comment-only mod identity', { descriptor: '# modId="mcdev_probe"\n[[mods]]\nmodId="another_mod"\n' }, /mcdev_probe/],
  ['filename and manifest disagreement', { manifest: 'Mcdev-Loader: forge\nMcdev-Minecraft-Version: 26.1.2\nMcdev-Mappings: official\n' }, /loader|filename/],
]) {
  test(`rejects ${label}`, async (t) => {
    const dir = sandbox(t);
    const jar = probeJar(dir, change);
    await assert.rejects(execute('mcdev_install_probe', { probeJar: jar, runDirs: [join(dir, 'run')] }), expected);
    assert.equal(existsSync(join(dir, 'run')), false);
  });
}

test('rejects malformed jar without a metadata bypass', async (t) => {
  const dir = sandbox(t);
  const jar = join(dir, 'mcdev_probe-invalid-dev.jar');
  writeFileSync(jar, 'not a jar');
  await assert.rejects(execute('mcdev_install_probe', { probeJar: jar, runDirs: [join(dir, 'run')] }), /jar|ZIP/i);
  assert.equal(existsSync(join(dir, 'run')), false);
});

test('rejects explicit loader and version mismatches before copying', async (t) => {
  const dir = sandbox(t);
  const jar = probeJar(dir);
  for (const target of [{ loader: 'forge' }, { minecraftVersion: '1.20.1' }]) {
    await assert.rejects(execute('mcdev_install_probe', { probeJar: jar, runDirs: [join(dir, 'run')], ...target }), /mismatch/i);
  }
  assert.equal(existsSync(join(dir, 'run')), false);
});

test('preflights all PCL instance base JSON files before any copy', async (t) => {
  const dir = sandbox(t);
  const jar = probeJar(dir);
  const valid = instance(dir, 'custom-neoforge', 'neoforge');
  const invalid = instance(dir, 'custom-forge', 'forge');
  await assert.rejects(execute('mcdev_install_probe', { probeJar: jar, runDirs: [valid, invalid] }), /loader.*mismatch/i);
  assert.equal(existsSync(join(valid, 'mods')), false);
  const result = await execute('mcdev_install_probe', { probeJar: jar, runDirs: [valid] });
  assert.equal(result.targets.length, 1);
});

test('explicit values cannot override incompatible inferred PCL metadata', async (t) => {
  const dir = sandbox(t);
  const jar = probeJar(dir);
  const runDir = instance(dir, 'old-neoforge', 'neoforge', '1.21.1');
  await assert.rejects(execute('mcdev_install_probe', { probeJar: jar, runDirs: [runDir], minecraftVersion: '26.1.2' }), /version.*mismatch/i);
  assert.equal(existsSync(join(runDir, 'mods')), false);
});

test('recognizes modern PCL main class and version id without Minecraft libraries', async (t) => {
  const dir = sandbox(t);
  const runDir = join(dir, '26.1.2-NeoForge_26.1.2.114');
  mkdirSync(runDir);
  writeFileSync(join(runDir, `${basename(runDir)}.json`), JSON.stringify({
    id: basename(runDir), inheritsFrom: null,
    mainClass: 'net.neoforged.fml.startup.Client',
    libraries: [{ name: 'net.neoforged.fancymodloader:loader:11.0.15' }],
  }));
  const neoJar = probeJar(dir);
  const result = await execute('mcdev_install_probe', { probeJar: neoJar, runDirs: [runDir] });
  assert.deepEqual(result.warnings, []);
  const forgeJar = probeJar(dir, { loader: 'forge' });
  await assert.rejects(execute('mcdev_install_probe', { probeJar: forgeJar, runDirs: [runDir] }), /loader.*mismatch/i);
});

test('PCL game Minecraft version overrides explicit caller expectations', async (t) => {
  const dir = sandbox(t);
  const runDir = join(dir, 'custom-pack');
  mkdirSync(runDir);
  writeFileSync(join(runDir, 'custom-pack.json'), JSON.stringify({
    id: 'custom-pack', mainClass: 'net.neoforged.fml.startup.Client',
    arguments: { game: ['--fml.mcVersion', '1.21.1', '--fml.neoForgeVersion', '21.1.200'] },
  }));
  const jar = probeJar(dir);
  await assert.rejects(execute('mcdev_install_probe', {
    probeJar: jar, runDirs: [runDir], loader: 'neoforge', minecraftVersion: '26.1.2',
  }), /version.*mismatch.*1\.21\.1/i);
  assert.equal(existsSync(join(runDir, 'mods')), false);
});

test('PCL game arguments take priority over a stale instance id', async (t) => {
  const dir = sandbox(t);
  const runDir = join(dir, '1.21.1-old-name');
  mkdirSync(runDir);
  writeFileSync(join(runDir, `${basename(runDir)}.json`), JSON.stringify({
    id: basename(runDir), mainClass: 'net.neoforged.fml.startup.Client',
    arguments: { game: ['--fml.mcVersion', '26.1.2', '--fml.neoForgeVersion', '26.1.2.114'] },
  }));
  const jar = probeJar(dir);
  const result = await execute('mcdev_install_probe', { probeJar: jar, runDirs: [runDir] });
  assert.deepEqual(result.warnings, []);
});

test('PCL NeoForge game argument identifies the loader without loader libraries', async (t) => {
  const dir = sandbox(t);
  const runDir = join(dir, 'bootstrap-pack');
  mkdirSync(runDir);
  writeFileSync(join(runDir, 'bootstrap-pack.json'), JSON.stringify({
    id: 'bootstrap-pack', mainClass: 'cpw.mods.bootstraplauncher.BootstrapLauncher',
    arguments: { game: ['--fml.mcVersion=26.1.2', '--fml.neoForgeVersion=26.1.2.114'] },
  }));
  const jar = probeJar(dir, { loader: 'forge' });
  await assert.rejects(execute('mcdev_install_probe', {
    probeJar: jar, runDirs: [runDir], loader: 'forge', minecraftVersion: '26.1.2',
  }), /loader.*mismatch.*neoforge/i);
  assert.equal(existsSync(join(runDir, 'mods')), false);
});

test('rejects invalid instance metadata with an actionable error', async (t) => {
  const dir = sandbox(t);
  const runDir = join(dir, 'broken');
  mkdirSync(runDir);
  writeFileSync(join(runDir, 'broken.json'), 'null');
  const jar = probeJar(dir);
  await assert.rejects(execute('mcdev_install_probe', { probeJar: jar, runDirs: [runDir] }), /instance version JSON/i);
  assert.equal(existsSync(join(runDir, 'mods')), false);
});

test('detects a renamed probe by mod descriptor before copying', async (t) => {
  const dir = sandbox(t);
  const jar = probeJar(dir);
  const runDir = join(dir, 'run');
  mkdirSync(join(runDir, 'mods'), { recursive: true });
  writeFileSync(join(runDir, 'mods', 'renamed.jar'), readFileSync(jar));
  await assert.rejects(execute('mcdev_install_probe', { probeJar: jar, runDirs: [runDir] }), /Existing probe.*renamed/);
  assert.equal(existsSync(join(runDir, 'mods', basename(jar))), false);
});

test('warns when target metadata is unknown', async (t) => {
  const dir = sandbox(t);
  const jar = probeJar(dir);
  const result = await execute('mcdev_install_probe', { probeJar: jar, runDirs: [join(dir, 'run')] });
  assert.match(result.warnings.join('\n'), /specify loader and minecraftVersion/);
});

test('refuses different probe versions and preserves unrelated mods', async (t) => {
  const dir = sandbox(t);
  const jar = probeJar(dir);
  const runDir = join(dir, 'run');
  mkdirSync(join(runDir, 'mods'), { recursive: true });
  const old = join(runDir, 'mods', 'mcdev_probe-0.1.0-dev.jar');
  writeFileSync(old, 'existing probe');
  const other = join(runDir, 'mods', 'other.jar');
  writeFileSync(other, 'unrelated');
  await assert.rejects(execute('mcdev_install_probe', { probeJar: jar, runDirs: [runDir] }), /existing|already|remove/i);
  assert.equal(readFileSync(old, 'utf8'), 'existing probe');
  assert.equal(readFileSync(other, 'utf8'), 'unrelated');
  assert.equal(existsSync(join(runDir, 'mods', basename(jar))), false);
});

test('permits replacement of the same probe filename', async (t) => {
  const dir = sandbox(t);
  const jar = probeJar(dir);
  const runDir = join(dir, 'run');
  mkdirSync(join(runDir, 'mods'), { recursive: true });
  writeFileSync(join(runDir, 'mods', basename(jar)), 'old contents');
  await execute('mcdev_install_probe', { probeJar: jar, runDirs: [runDir] });
  assert.deepEqual(readFileSync(join(runDir, 'mods', basename(jar))), readFileSync(jar));
});

test('invalid later runDir cannot cause a partial installation', async (t) => {
  const dir = sandbox(t);
  const jar = probeJar(dir, { legacy: true });
  await assert.rejects(execute('mcdev_install_probe', { probeJar: jar, runDirs: [join(dir, 'run'), ''] }), /runDir/i);
  assert.equal(existsSync(join(dir, 'run')), false);
});

test('a file ancestor in a later runDir cannot cause a partial installation', async (t) => {
  const dir = sandbox(t);
  const jar = probeJar(dir);
  const first = join(dir, 'first-run');
  const blocked = join(dir, 'existing-file');
  writeFileSync(blocked, 'keep this file');
  await assert.rejects(execute('mcdev_install_probe', {
    probeJar: jar, runDirs: [first, join(blocked, 'child', 'run')],
  }));
  assert.equal(existsSync(first), false);
  assert.equal(readFileSync(blocked, 'utf8'), 'keep this file');
});

test('a file occupying later mods directory is rejected before any copy', async (t) => {
  const dir = sandbox(t);
  const jar = probeJar(dir);
  const first = join(dir, 'first-run');
  const second = join(dir, 'second-run');
  mkdirSync(second);
  writeFileSync(join(second, 'mods'), 'keep this file');
  await assert.rejects(execute('mcdev_install_probe', {
    probeJar: jar, runDirs: [first, second],
  }), /mods.*not a directory/i);
  assert.equal(existsSync(first), false);
  assert.equal(readFileSync(join(second, 'mods'), 'utf8'), 'keep this file');
});

function gradleProject(dir) {
  const projectDir = join(dir, 'project with spaces');
  mkdirSync(projectDir);
  writeFileSync(join(projectDir, 'environment.cjs'), 'console.log(JSON.stringify({javaHome:process.env.JAVA_HOME,path:process.env.PATH ?? process.env.Path}));');
  writeFileSync(join(projectDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'), process.platform === 'win32'
    ? `@echo off\r\n"${process.execPath}" "%~dp0environment.cjs"\r\n`
    : `#!/bin/sh\n'${process.execPath.replaceAll("'", "'\\''")}' ./environment.cjs\n`, { mode: 0o755 });
  return projectDir;
}

for (const tool of ['mcdev_build', 'mcdev_gametest']) {
  test(`${tool} applies javaHome only to its spawned process`, async (t) => {
    const dir = sandbox(t);
    const projectDir = gradleProject(dir);
    const javaHome = join(dir, 'jdk with spaces');
    mkdirSync(join(javaHome, 'bin'), { recursive: true });
    for (const exe of ['java', 'javac']) writeFileSync(join(javaHome, 'bin', `${exe}${process.platform === 'win32' ? '.exe' : ''}`), '', { mode: 0o755 });
    const before = { ...process.env };
    const result = await execute(tool, { projectDir, javaHome });
    assert.equal(result.exitCode, 0);
    const environment = JSON.parse(result.tail.trim());
    assert.equal(environment.javaHome, javaHome);
    assert.ok(environment.path.startsWith(join(javaHome, 'bin')));
    assert.deepEqual({ ...process.env }, before);
  });
}

for (const tool of ['mcdev_build', 'mcdev_gametest', 'mcdev_prepare']) {
  test(`${tool} rejects invalid Java executable paths before launch`, async (t) => {
    const dir = sandbox(t);
    const projectDir = gradleProject(dir);
    const javaHome = join(dir, 'missing-jdk');
    assert.equal(tools.get(tool).parameters.javaHome?.type, 'string');
    await assert.rejects(execute(tool, { projectDir, javaHome, kind: 'server', timeoutMs: 5000 }), /javaHome|java.*not found/i);
  });
}

test('build retains inherited Java settings when javaHome is omitted', async (t) => {
  const dir = sandbox(t);
  const result = await execute('mcdev_build', { projectDir: gradleProject(dir) });
  assert.equal(result.exitCode, 0);
  const environment = JSON.parse(result.tail.trim());
  assert.equal(environment.javaHome, process.env.JAVA_HOME);
  assert.equal(environment.path, process.env.PATH ?? process.env.Path);
});

test('build validates Gradle wrapper and JDK compiler files', async (t) => {
  const dir = sandbox(t);
  await assert.rejects(execute('mcdev_build', { projectDir: dir }), /Gradle executable not found/);
  const projectDir = gradleProject(dir);
  const javaHome = join(dir, 'jre-only');
  mkdirSync(join(javaHome, 'bin'), { recursive: true });
  writeFileSync(join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'), '', { mode: 0o755 });
  await assert.rejects(execute('mcdev_build', { projectDir, javaHome }), /javac/);
});
