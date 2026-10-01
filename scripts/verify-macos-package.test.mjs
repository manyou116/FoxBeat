import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { verifyMacosApp, verifyMacosPackages } from './verify-macos-package.mjs';

const run = promisify(execFile);
const macos = { skip: process.platform !== 'darwin' };
const expected = { productName: 'FoxBeat', identifier: 'com.foxbeat.desktop', version: '0.1.2' };

async function fixture(t, { sign = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'foxbeat-signature-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = join(root, 'macos', 'FoxBeat.app');
  const contents = join(app, 'Contents');
  await mkdir(join(contents, 'MacOS'), { recursive: true });
  await mkdir(join(contents, 'Resources'));
  await writeFile(join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>foxbeat</string>
<key>CFBundleIdentifier</key><string>${expected.identifier}</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${expected.version}</string>
<key>CFBundleVersion</key><string>${expected.version}</string>
</dict></plist>`);
  const resource = join(contents, 'Resources', 'example.txt');
  await writeFile(resource, 'sealed resource');
  const executable = join(contents, 'MacOS', 'foxbeat');
  await copyFile('/usr/bin/true', executable);
  if (sign) await run('codesign', ['--force', '--sign', '-', '--timestamp=none', app]);
  return { root, app, executable, resource };
}

async function archive({ root }) {
  const path = join(root, 'macos', 'FoxBeat.app.tar.gz');
  await run('tar', ['-czf', path, '-C', join(root, 'macos'), 'FoxBeat.app'], {
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  });
}

test('accepts complete ad-hoc signatures in the app, OTA archive and mounted DMG', macos, async t => {
  const files = await fixture(t);
  await mkdir(join(files.root, 'dmg'));
  await run('hdiutil', ['create', '-srcfolder', join(files.root, 'macos'), '-volname', 'FoxBeat Test',
    '-format', 'UDZO', join(files.root, 'dmg', 'FoxBeat.dmg')]);
  await archive(files);
  assert.deepEqual(await verifyMacosPackages(files.root, expected, { requireUpdater: true, requireDmg: true }), {
    apps: 1, archives: 1, dmgs: 1,
  });
});

test('rejects a binary-only signature without a sealed application bundle', macos, async t => {
  const files = await fixture(t, { sign: false });
  const standalone = join(files.root, 'standalone');
  await copyFile(files.executable, standalone);
  await run('codesign', ['--force', '--sign', '-', '--timestamp=none', standalone]);
  await copyFile(standalone, files.executable);
  await assert.rejects(verifyMacosApp(files.app, expected), { code: 'ENOENT' });
});

test('rejects resource tampering after signing', macos, async t => {
  const files = await fixture(t);
  await writeFile(files.resource, 'modified after signing');
  await assert.rejects(verifyMacosApp(files.app, expected), /codesign/);
});

test('rejects quarantine attributes on nested files even when the signature is intact', macos, async t => {
  const files = await fixture(t);
  await run('xattr', ['-w', 'com.apple.quarantine', '0083;00000000;FoxBeatTest;', files.resource]);
  await assert.rejects(verifyMacosApp(files.app, expected), /quarantine attributes/);
});

test('rejects signed bundles with a mismatched release version or identifier', macos, async t => {
  const files = await fixture(t);
  await assert.rejects(verifyMacosApp(files.app, { ...expected, version: '0.1.3' }), /identity or version mismatch/);
  await assert.rejects(verifyMacosApp(files.app, { ...expected, identifier: 'com.example.other' }), /identity or version mismatch/);
});

test('rejects missing required OTA or DMG artifacts', macos, async t => {
  const files = await fixture(t);
  await assert.rejects(verifyMacosPackages(files.root, expected, { requireUpdater: true }), /Expected one .app.tar.gz/);
  await assert.rejects(verifyMacosPackages(files.root, expected, { requireDmg: true }), /Expected one .dmg/);
});

test('verifies the archived copy instead of trusting the signed source app', macos, async t => {
  const files = await fixture(t);
  await writeFile(files.resource, 'tampered archived resource');
  await archive(files);
  await run('codesign', ['--force', '--sign', '-', '--timestamp=none', files.app]);
  await verifyMacosApp(files.app, expected);
  await assert.rejects(verifyMacosPackages(files.root, expected, { requireUpdater: true }), /codesign/);
});
