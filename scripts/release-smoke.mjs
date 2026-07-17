import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), 'postcondition-pack-'));
let tarball;

try {
  const { stdout } = await exec('npm', ['pack', '--json'], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
  const packed = JSON.parse(stdout)[0];
  if (!packed?.filename || !Array.isArray(packed.files)) throw new Error('npm pack did not return a package manifest.');
  const required = ['dist/src/index.js', 'dist/src/index.d.ts', 'README.md', 'LICENSE', 'server.json'];
  const names = new Set(packed.files.map((file) => file.path));
  for (const file of required) {
    if (!names.has(file)) throw new Error(`Packed artifact is missing ${file}.`);
  }
  tarball = join(root, packed.filename);
  const installDir = join(temp, 'consumer');
  await writeFile(join(temp, 'package.json'), '{}');
  await mkdir(installDir, { recursive: true });
  await writeFile(join(installDir, 'package.json'), JSON.stringify({ name: 'postcondition-smoke', private: true, type: 'module' }));
  await exec('npm', ['install', '--no-audit', '--no-fund', tarball], { cwd: installDir, maxBuffer: 20 * 1024 * 1024 });
  const entry = join(installDir, 'node_modules', 'postcondition-mcp', 'dist', 'src', 'index.js');
  const version = await exec(process.execPath, [entry, '--version'], { cwd: installDir });
  if (version.stdout.trim() !== '0.1.0') throw new Error(`Installed CLI returned ${version.stdout.trim()}.`);
  const sdk = await exec(process.execPath, ['--input-type=module', '--eval', "import { PostconditionRuntime } from 'postcondition-mcp'; if (typeof PostconditionRuntime !== 'function') process.exit(2);"], { cwd: installDir });
  if (sdk.stderr) process.stderr.write(sdk.stderr);
  const installedPackage = JSON.parse(await readFile(join(installDir, 'node_modules', 'postcondition-mcp', 'package.json'), 'utf8'));
  process.stdout.write(`release smoke passed: ${installedPackage.name}@${installedPackage.version} (${packed.size} bytes)\n`);
} finally {
  if (tarball) await rm(tarball, { force: true });
  await rm(temp, { recursive: true, force: true });
}
