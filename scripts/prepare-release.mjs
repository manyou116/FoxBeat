import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, copyFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const configurations = [
  { dir: 'windows-x64', folder: '', extension: '.exe', platform: 'windows-x86_64', suffix: 'windows_x64_setup.exe' },
  { dir: 'macos-arm64', folder: 'macos', extension: '.app.tar.gz', platform: 'darwin-aarch64', suffix: 'macos_arm64.app.tar.gz', dmg: 'macos_arm64.dmg' },
  { dir: 'macos-x64', folder: 'macos', extension: '.app.tar.gz', platform: 'darwin-x86_64', suffix: 'macos_x64.app.tar.gz', dmg: 'macos_x64.dmg' },
];

async function singleFile(directory, extension) {
  const files = (await readdir(directory)).filter(file => file.endsWith(extension));
  if (files.length !== 1) throw new Error(`Expected one ${extension} in ${directory}`);
  return join(directory, files[0]);
}

function checkSignature(signature, version, platform) {
  const decoded = Buffer.from(signature, 'base64');
  if (decoded.toString('base64') !== signature) throw new Error(`Invalid updater signature: ${platform}`);
  const lines = decoded.toString('utf8').trimEnd().split('\n');
  const signedVersion = lines[2]?.replace(/^trusted comment: /, '').split('\t').find(field => field.startsWith('version:'))?.slice(8);
  if (lines.length !== 4 || !lines[0].startsWith('untrusted comment: ') ||
      !lines[2].startsWith('trusted comment: ') ||
      Buffer.from(lines[1], 'base64').length !== 74 || Buffer.from(lines[3], 'base64').length !== 64 ||
      signedVersion !== version) throw new Error(`Missing or mismatched signed version: ${platform}`);
}

export async function prepareRelease({ artifacts, output, tag, notes = '', date = new Date().toISOString() }) {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) throw new Error('Invalid release tag');
  await mkdir(output, { recursive: true });
  if ((await readdir(output)).length) throw new Error('Release output directory must be empty');
  const platforms = {};
  for (const config of configurations) {
    const source = await singleFile(join(artifacts, config.dir, config.folder), config.extension);
    const signature = (await readFile(`${source}.sig`, 'utf8')).trim();
    checkSignature(signature, tag.slice(1), config.platform);
    const name = `FoxBeat_${tag}_${config.suffix}`;
    await copyFile(source, join(output, name));
    await writeFile(join(output, `${name}.sig`), `${signature}\n`);
    platforms[config.platform] = { signature, url: `https://github.com/manyou116/FoxBeat/releases/download/${tag}/${name}` };
    if (config.dmg) {
      const dmg = await singleFile(join(artifacts, config.dir, 'dmg'), '.dmg');
      await copyFile(dmg, join(output, `FoxBeat_${tag}_${config.dmg}`));
    }
  }
  const manifest = { version: tag.slice(1), notes, pub_date: date, platforms };
  await writeFile(join(output, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const names = (await readdir(output)).filter(name => name !== 'SHA256SUMS').sort();
  const checksums = await Promise.all(names.map(async name => {
    const digest = createHash('sha256').update(await readFile(join(output, name))).digest('hex');
    return `${digest}  ${name}`;
  }));
  await writeFile(join(output, 'SHA256SUMS'), `${checksums.join('\n')}\n`);
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [artifacts = 'artifacts', output = 'release-assets', tag = process.env.GITHUB_REF_NAME, notesFile] = process.argv.slice(2);
  await prepareRelease({ artifacts, output, tag, notes: notesFile ? await readFile(notesFile, 'utf8') : '' });
  console.log(`Prepared signed release assets for ${tag}`);
}
