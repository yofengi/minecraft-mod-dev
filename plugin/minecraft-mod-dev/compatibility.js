import {
  accessSync, closeSync, constants, copyFileSync, existsSync, mkdirSync,
  openSync, readFileSync, readdirSync, readSync, statSync,
} from 'node:fs';
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const METADATA_NAMES = new Set(['META-INF/MANIFEST.MF', 'META-INF/mods.toml', 'META-INF/neoforge.mods.toml']);

function jarMetadata(jarPath) {
  const size = statSync(jarPath).size;
  const fd = openSync(jarPath, 'r');
  const read = (offset, length) => {
    if (offset < 0 || length < 0 || offset + length > size) throw new Error('Invalid jar ZIP bounds');
    const buffer = Buffer.alloc(length);
    if (readSync(fd, buffer, 0, length, offset) !== length) throw new Error('Truncated jar ZIP');
    return buffer;
  };
  try {
    const tail = read(Math.max(0, size - 65557), Math.min(size, 65557));
    let end = tail.length - 22;
    while (end >= 0 && (tail.readUInt32LE(end) !== 0x06054b50 || end + 22 + tail.readUInt16LE(end + 20) !== tail.length)) end--;
    if (end < 0) throw new Error('Invalid jar ZIP directory');
    if (tail.readUInt32LE(end + 4) !== 0 || tail.readUInt16LE(end + 8) !== tail.readUInt16LE(end + 10)) throw new Error('Unsupported multipart jar ZIP');
    const count = tail.readUInt16LE(end + 10);
    const length = tail.readUInt32LE(end + 12);
    if (count === 65535 || length > 16 * 1024 * 1024) throw new Error('Unsupported jar ZIP directory size');
    const directory = read(tail.readUInt32LE(end + 16), length);
    const metadata = {};
    let offset = 0;
    for (let i = 0; i < count; i++) {
      if (offset + 46 > directory.length || directory.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid jar ZIP entry');
      const nameLength = directory.readUInt16LE(offset + 28);
      const next = offset + 46 + nameLength + directory.readUInt16LE(offset + 30) + directory.readUInt16LE(offset + 32);
      if (next > directory.length) throw new Error('Truncated jar ZIP entry');
      const name = directory.toString('utf8', offset + 46, offset + 46 + nameLength);
      if (METADATA_NAMES.has(name)) {
        if (Object.hasOwn(metadata, name)) throw new Error(`Duplicate jar metadata: ${name}`);
        const method = directory.readUInt16LE(offset + 10);
        const compressedSize = directory.readUInt32LE(offset + 20);
        const plainSize = directory.readUInt32LE(offset + 24);
        if ((directory.readUInt16LE(offset + 8) & 1) || ![0, 8].includes(method)) throw new Error('Unsupported jar metadata encoding');
        if (plainSize > 1024 * 1024 || compressedSize > 1024 * 1024) throw new Error('Jar metadata exceeds 1 MiB');
        const localOffset = directory.readUInt32LE(offset + 42);
        const local = read(localOffset, 30);
        if (local.readUInt32LE(0) !== 0x04034b50) throw new Error('Invalid jar ZIP local entry');
        const data = read(localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28), compressedSize);
        const content = method === 8 ? inflateRawSync(data, { maxOutputLength: 1024 * 1024 }) : data;
        if (content.length !== plainSize) throw new Error('Invalid jar metadata size');
        metadata[name] = content.toString('utf8');
      }
      offset = next;
    }
    return metadata;
  } finally {
    closeSync(fd);
  }
}

function manifestAttributes(text = '') {
  const attributes = {};
  const main = text.replace(/\r\n/g, '\n').replace(/\n /g, '').split('\n\n')[0];
  for (const line of main.split('\n')) {
    const match = /^([^:]+):\s*(.*)$/.exec(line);
    if (match) attributes[match[1].toLowerCase()] = match[2].trim();
  }
  return attributes;
}

function containsProbe(descriptor = '') {
  let inMods = false;
  for (const line of descriptor.split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) inMods = /^\s*\[\[mods\]\]\s*(?:#.*)?$/.test(line);
    if (inMods && /^\s*modId\s*=\s*(["'])mcdev_probe\1\s*(?:#.*)?$/.test(line)) return true;
  }
  return false;
}

function inspectProbe(jarPath) {
  const name = basename(jarPath);
  const modern = /^mcdev_probe-(forge|neoforge)-(26\.1\.2)-[^/]+\.jar$/i.exec(name);
  const legacy = /-dev\.jar$/i.test(name);
  if (!modern && !legacy) throw new Error('Legacy Forge probe jar must be a *-dev.jar; modern probes need a loader/version filename');
  const entries = jarMetadata(jarPath);
  const manifest = manifestAttributes(entries['META-INF/MANIFEST.MF']);
  if (!entries['META-INF/MANIFEST.MF']) throw new Error('Probe jar MANIFEST.MF missing');
  const hasMixinConfigs = (manifest.mixinconfigs ?? '').split(',').some((value) => value.trim() === 'mcdev_probe.mixins.json');
  if (modern) {
    const loader = manifest['mcdev-loader'];
    const minecraftVersion = manifest['mcdev-minecraft-version'];
    if (loader !== modern[1].toLowerCase()) throw new Error('Probe loader metadata and filename mismatch');
    if (minecraftVersion !== modern[2]) throw new Error('Probe Minecraft version metadata and filename mismatch');
    if (manifest['mcdev-mappings'] !== 'official') throw new Error('Modern probe Mcdev-Mappings must be official');
    const descriptor = loader === 'neoforge' ? 'META-INF/neoforge.mods.toml' : 'META-INF/mods.toml';
    if (!containsProbe(entries[descriptor])) throw new Error(`${descriptor} must declare modId="mcdev_probe"`);
    return { loader, minecraftVersion, mappings: 'official', hasMixinConfigs };
  }
  if (!hasMixinConfigs) throw new Error('Legacy probe MANIFEST.MF missing "MixinConfigs: mcdev_probe.mixins.json"');
  if (manifest['mcdev-loader'] && manifest['mcdev-loader'] !== 'forge') throw new Error('Legacy probe loader mismatch: expected forge');
  if (manifest['mcdev-minecraft-version'] && manifest['mcdev-minecraft-version'] !== '1.20.1') throw new Error('Legacy probe Minecraft version mismatch: expected 1.20.1');
  return { loader: 'forge', minecraftVersion: '1.20.1', mappings: 'dev', hasMixinConfigs };
}

function gameArgument(args, name) {
  if (!Array.isArray(args)) return undefined;
  for (let i = 0; i < args.length; i++) {
    const argument = args[i];
    if (typeof argument !== 'string') continue;
    const value = argument === name ? args[i + 1]
      : argument.startsWith(`${name}=`) ? argument.slice(name.length + 1) : undefined;
    if (typeof value === 'string' && value.trim() && !value.startsWith('--')) return value.trim();
  }
  return undefined;
}

function inferTarget(runDir) {
  const jsonPath = join(runDir, `${basename(runDir)}.json`);
  if (!existsSync(jsonPath)) return {};
  if (!statSync(jsonPath).isFile() || statSync(jsonPath).size > 8 * 1024 * 1024) throw new Error(`Invalid instance version JSON: ${jsonPath}`);
  let version;
  try {
    version = JSON.parse(readFileSync(jsonPath, 'utf8'));
    if (!version || typeof version !== 'object' || Array.isArray(version)) throw new Error('Invalid version object');
  } catch {
    throw new Error(`Invalid instance version JSON: ${jsonPath}`);
  }
  const libraries = Array.isArray(version.libraries) ? version.libraries.map((lib) => lib?.name).filter((name) => typeof name === 'string') : [];
  const mainClass = typeof version.mainClass === 'string' ? version.mainClass : '';
  const gameMinecraftVersion = gameArgument(version.arguments?.game, '--fml.mcVersion');
  const gameNeoForgeVersion = gameArgument(version.arguments?.game, '--fml.neoForgeVersion');
  let loader;
  if (gameNeoForgeVersion || libraries.some((name) => /^net\.neoforged:neoforge:|^net\.neoforged\.fancymodloader:/.test(name)) || /^net\.neoforged\./.test(mainClass)) loader = 'neoforge';
  else if (libraries.some((name) => /^net\.minecraftforge:/.test(name)) || /^net\.minecraftforge\./.test(mainClass)) loader = 'forge';
  else if (libraries.some((name) => /^net\.fabricmc:/.test(name))) loader = 'fabric';
  else if (libraries.some((name) => /^org\.quiltmc:/.test(name))) loader = 'quilt';
  else if (mainClass === 'net.minecraft.client.main.Main') loader = 'vanilla';
  const mcLibrary = libraries.find((name) => /^net\.minecraft:client:/.test(name));
  const forgeLibrary = libraries.find((name) => /^net\.minecraftforge:forge:\d/.test(name));
  const candidates = [version.inheritsFrom, mcLibrary?.split(':')[2], forgeLibrary?.split(':')[2], version.id];
  const minecraftVersion = gameMinecraftVersion ?? candidates.filter((value) => typeof value === 'string').map((value) => /^(\d+\.\d+(?:\.\d+)?)(?:$|[-_])/.exec(value)?.[1]).find(Boolean);
  return { loader, minecraftVersion };
}

function validateTarget(probe, target, label) {
  if (target.loader !== undefined && target.loader !== probe.loader) throw new Error(`Loader mismatch for ${label}: probe=${probe.loader}, target=${target.loader}`);
  if (target.minecraftVersion !== undefined && target.minecraftVersion !== probe.minecraftVersion) throw new Error(`Minecraft version mismatch for ${label}: probe=${probe.minecraftVersion}, target=${target.minecraftVersion}`);
}

function validateDirectoryPath(path, label) {
  let ancestor = path;
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) throw new Error(`${label} ancestor not found: ${ancestor}`);
    ancestor = parent;
  }
  if (!statSync(ancestor).isDirectory()) throw new Error(`${label} path is not a directory: ${ancestor}`);
}

export function installProbe({ probeJar, runDirs, loader, minecraftVersion }) {
  if (typeof probeJar !== 'string' || !isAbsolute(probeJar) || !existsSync(probeJar) || !statSync(probeJar).isFile()) throw new Error(`Probe jar not found at an absolute file path: ${probeJar}`);
  if (!Array.isArray(runDirs) || runDirs.length === 0) throw new Error('runDirs must be a non-empty array');
  const metadata = inspectProbe(probeJar);
  validateTarget(metadata, { loader, minecraftVersion }, 'explicit target');
  const name = basename(probeJar);
  const targets = [];
  const warnings = [];
  for (const input of runDirs) {
    if (typeof input !== 'string' || !isAbsolute(input)) throw new Error('Every runDir must be a non-empty absolute directory path');
    const runDir = resolve(input);
    validateDirectoryPath(runDir, 'runDir');
    const inferred = inferTarget(runDir);
    validateTarget(metadata, inferred, runDir);
    if (!(loader ?? inferred.loader) || !(minecraftVersion ?? inferred.minecraftVersion)) warnings.push(`Target loader/version not fully known for ${runDir}; specify loader and minecraftVersion to verify compatibility`);
    const modsDir = join(runDir, 'mods');
    validateDirectoryPath(modsDir, 'mods');
    if (existsSync(modsDir)) {
      for (const entry of readdirSync(modsDir, { withFileTypes: true })) {
        if (!/\.jar$/i.test(entry.name) || entry.name === name) continue;
        let isProbe = /^mcdev[_-]probe(?:[-_.]|$)/i.test(entry.name);
        if (!isProbe && entry.isFile()) {
          try {
            const existing = jarMetadata(join(modsDir, entry.name));
            isProbe = containsProbe(existing['META-INF/mods.toml']) || containsProbe(existing['META-INF/neoforge.mods.toml']);
          } catch {
            // Ignore unrelated unreadable jars.
          }
        }
        if (isProbe) throw new Error(`Existing probe ${join(modsDir, entry.name)} would duplicate ${name}; remove it manually or choose another runDir`);
      }
    }
    const dest = join(modsDir, name);
    if (existsSync(dest) && !statSync(dest).isFile()) throw new Error(`Probe destination is not a file: ${dest}`);
    targets.push({ runDir, dest });
  }
  for (const { dest } of targets) {
    mkdirSync(dirname(dest), { recursive: true });
    if (resolve(probeJar) !== resolve(dest)) copyFileSync(probeJar, dest);
  }
  return { probeJar, size: statSync(probeJar).size, manifestChecked: true, ...metadata, targets, warnings };
}

export function gradleInvocation(projectDir, task, javaHome) {
  if (typeof projectDir !== 'string' || !isAbsolute(projectDir) || !existsSync(projectDir) || !statSync(projectDir).isDirectory()) throw new Error(`projectDir not found at an absolute directory path: ${projectDir}`);
  if (!['build', 'runGameTestServer', 'runServer', 'runClient'].includes(task)) throw new Error(`Unsupported Gradle task: ${task}`);
  const win = process.platform === 'win32';
  const wrapper = join(projectDir, win ? 'gradlew.bat' : 'gradlew');
  if (!existsSync(wrapper) || !statSync(wrapper).isFile()) throw new Error(`Gradle executable not found: ${wrapper}`);
  if (!win) accessSync(wrapper, constants.X_OK);
  const env = { ...process.env };
  if (javaHome !== undefined) {
    if (typeof javaHome !== 'string' || !isAbsolute(javaHome)) throw new Error('javaHome must be an absolute JDK directory');
    for (const executable of ['java', 'javac']) {
      const path = join(javaHome, 'bin', `${executable}${win ? '.exe' : ''}`);
      if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`javaHome executable not found: ${path}`);
      if (!win) accessSync(path, constants.X_OK);
    }
    const pathKey = Object.keys(env).find((key) => win ? key.toUpperCase() === 'PATH' : key === 'PATH') ?? 'PATH';
    const oldPath = env[pathKey] ?? '';
    if (win) for (const key of Object.keys(env)) if (/^(PATH|JAVA_HOME)$/i.test(key)) delete env[key];
    env.JAVA_HOME = javaHome;
    env[pathKey] = `${join(javaHome, 'bin')}${oldPath ? delimiter + oldPath : ''}`;
  }
  return {
    command: win ? `gradlew.bat ${task} --console=plain` : './gradlew',
    args: win ? [] : [task, '--console=plain'],
    options: { cwd: projectDir, env, shell: win, windowsHide: true },
  };
}
