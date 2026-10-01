import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify, parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const run = promisify(execFile);

export async function verifyMacosApp(app, { identifier, version }) {
  await access(join(app, 'Contents', '_CodeSignature', 'CodeResources'));
  await run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  const { stdout: plist } = await run('plutil', ['-convert', 'json', '-o', '-', join(app, 'Contents', 'Info.plist')]);
  const info = JSON.parse(plist);
  if (info.CFBundleIdentifier !== identifier || info.CFBundleShortVersionString !== version) {
    throw new Error(`Application identity or version mismatch: ${app}`);
  }
  const { stdout: attributes } = await run('xattr', ['-rs', app]);
  if (attributes.split('\n').some(line => line.endsWith(': com.apple.quarantine'))) {
    throw new Error(`Application contains quarantine attributes: ${app}`);
  }
}

async function packageFiles(directory, suffix, required) {
  let entries;
  try {
    entries = await readdir(directory);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    entries = [];
  }
  const files = entries.filter(name => name.endsWith(suffix));
  if (files.length > 1 || (required && files.length !== 1)) {
    throw new Error(`Expected one ${suffix} in ${directory}`);
  }
  return files.map(name => join(directory, name));
}

export async function verifyMacosPackages(bundle, expected, { requireUpdater = false, requireDmg = false } = {}) {
  if (process.platform !== 'darwin') throw new Error('macOS package verification requires macOS');
  const appName = `${expected.productName}.app`;
  await verifyMacosApp(join(bundle, 'macos', appName), expected);
  const archives = await packageFiles(join(bundle, 'macos'), '.app.tar.gz', requireUpdater);
  for (const archive of archives) {
    const temporary = await mkdtemp(join(tmpdir(), 'foxbeat-verify-archive-'));
    try {
      await run('tar', ['-xzf', archive, '-C', temporary]);
      const entries = await readdir(temporary);
      if (entries.length !== 1 || entries[0] !== appName) throw new Error(`Unexpected application archive layout: ${archive}`);
      await verifyMacosApp(join(temporary, appName), expected);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
  const dmgs = await packageFiles(join(bundle, 'dmg'), '.dmg', requireDmg);
  for (const dmg of dmgs) {
    const temporary = await mkdtemp(join(tmpdir(), 'foxbeat-verify-dmg-'));
    const mount = join(temporary, 'mount');
    let attached = false;
    try {
      await run('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, dmg]);
      attached = true;
      await verifyMacosApp(join(mount, appName), expected);
    } finally {
      // If detaching fails, leave the mount alone instead of traversing it with rm.
      if (attached) await run('hdiutil', ['detach', mount]);
      await rm(temporary, { recursive: true, force: true });
    }
  }
  return { apps: 1, archives: archives.length, dmgs: dmgs.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values, positionals } = parseArgs({
    options: { 'require-updater': { type: 'boolean' }, 'require-dmg': { type: 'boolean' } },
    allowPositionals: true,
  });
  if (positionals.length > 1) throw new Error('Expected a single bundle directory');
  const config = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  const result = await verifyMacosPackages(resolve(positionals[0] ?? 'src-tauri/target/release/bundle'), {
    productName: config.productName, identifier: config.identifier, version: config.version,
  }, { requireUpdater: values['require-updater'], requireDmg: values['require-dmg'] });
  console.log(`Verified macOS application, ${result.archives} archive(s), ${result.dmgs} DMG(s): sealed signatures, matching identity/version, no quarantine`);
}
