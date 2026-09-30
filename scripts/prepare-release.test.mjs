import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { prepareRelease } from './prepare-release.mjs';

const payload = await readFile(new URL('../src-tauri/tests/fixtures/updater-payload.txt', import.meta.url));
const signature = await readFile(new URL('../src-tauri/tests/fixtures/updater-payload.txt.sig', import.meta.url), 'utf8');

async function fixtures(t) {
  const root = await mkdtemp(join(tmpdir(), 'foxbeat-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const artifacts = join(root, 'artifacts');
  const files = ['windows-x64/FoxBeat.exe', 'macos-arm64/macos/FoxBeat.app.tar.gz', 'macos-x64/macos/FoxBeat.app.tar.gz'];
  for (const file of files) {
    const path = join(artifacts, file);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, payload);
    await writeFile(`${path}.sig`, signature);
  }
  for (const arch of ['arm64', 'x64']) {
    const dir = join(artifacts, `macos-${arch}`, 'dmg');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'FoxBeat.dmg'), payload);
  }
  return { artifacts, output: join(root, 'output'), tag: 'v0.1.2', notes: '更新说明', date: '2026-10-01T00:00:00Z' };
}

test('packages actual CI artifact layouts with all three OTA targets and complete checksums', async t => {
  const options = await fixtures(t);
  const manifest = await prepareRelease(options);
  assert.equal(manifest.version, '0.1.2');
  assert.equal(manifest.notes, options.notes);
  assert.equal(manifest.pub_date, options.date);
  assert.deepEqual(Object.keys(manifest.platforms).sort(), ['darwin-aarch64', 'darwin-x86_64', 'windows-x86_64']);
  for (const platform of Object.values(manifest.platforms)) {
    const name = new URL(platform.url).pathname.split('/').pop();
    assert.ok(platform.url.startsWith('https://github.com/manyou116/FoxBeat/releases/download/v0.1.2/'));
    assert.deepEqual(await readFile(join(options.output, name)), payload);
    assert.equal((await readFile(join(options.output, `${name}.sig`), 'utf8')).trim(), platform.signature);
  }
  assert.deepEqual(JSON.parse(await readFile(join(options.output, 'latest.json'), 'utf8')), manifest);
  const sums = (await readFile(join(options.output, 'SHA256SUMS'), 'utf8')).trim().split('\n');
  assert.equal(sums.length, (await readdir(options.output)).length - 1);
  for (const line of sums) {
    const [hash, name] = line.split('  ');
    assert.equal(createHash('sha256').update(await readFile(join(options.output, name))).digest('hex'), hash);
  }
});

test('refuses to prepare OTA manifest when a platform signature is missing', async t => {
  const options = await fixtures(t);
  await rm(join(options.artifacts, 'macos-x64/macos/FoxBeat.app.tar.gz.sig'));
  await assert.rejects(prepareRelease(options), /ENOENT/);
  assert.ok(!(await readdir(options.output)).includes('latest.json'));
});

test('refuses a signature bound to a different release version', async t => {
  const options = await fixtures(t);
  await assert.rejects(prepareRelease({ ...options, tag: 'v0.1.3' }), /mismatched signed version/);
});

test('refuses ambiguous packages and stale output files', async t => {
  const options = await fixtures(t);
  await writeFile(join(options.artifacts, 'windows-x64/extra.exe'), payload);
  await assert.rejects(prepareRelease(options), /Expected one/);
  await writeFile(join(options.output, 'stale.txt'), 'stale');
  await assert.rejects(prepareRelease(options), /must be empty/);
});
