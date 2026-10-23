import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditSourceFileSet, verifySourcePackage } from './verify-source-package.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputName = process.argv[2] ?? 'submission-package';
if (!/^submission-package(?:-[a-z0-9-]+)?$/.test(outputName)) throw new Error('Output must be a safe submission-package directory name');
const outputRoot = resolve(repoRoot, outputName);
if (!outputRoot.startsWith(`${repoRoot}${sep}`)) throw new Error('Package output escaped the authorized workspace');
const allowlist = JSON.parse(await readFile(join(repoRoot, 'scripts', 'package-allowlist.json'), 'utf8'));
if (!Array.isArray(allowlist) || allowlist.some(path => typeof path !== 'string')) throw new Error('Invalid package allowlist');
const paths = [...allowlist].sort();
if (new Set(paths).size !== paths.length || paths.join('\0') !== allowlist.join('\0')) throw new Error('Package allowlist must be unique and sorted');
await auditSourceFileSet(repoRoot, paths);

const packageJson = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
const coreDependency = packageJson.dependencies?.['@starcoach/core-llm'];
if (coreDependency !== 'file:vendor/starcoach-core-llm-0.5.0.tgz') throw new Error('Expected the pinned @starcoach/core-llm v0.5.0 vendored dependency');
const coreTarball = coreDependency.slice('file:'.length);
if (!paths.includes(coreTarball)) throw new Error('Pinned offline dependency is absent from package allowlist');
const lock = JSON.parse(await readFile(join(repoRoot, 'package-lock.json'), 'utf8'));
const lockedCore = lock.packages?.['node_modules/@starcoach/core-llm'];
if (lock.packages?.['']?.dependencies?.['@starcoach/core-llm'] !== coreDependency
  || lockedCore?.version !== '0.5.0' || lockedCore?.resolved !== coreDependency) throw new Error('package-lock.json does not match the pinned @starcoach/core-llm dependency');
const coreIntegrity = `sha512-${createHash('sha512').update(await readFile(join(repoRoot, coreTarball))).digest('base64')}`;
if (lockedCore.integrity !== coreIntegrity) throw new Error('Vendored @starcoach/core-llm tarball does not match package-lock.json integrity');

try { await lstat(outputRoot); throw new Error(`Refusing to overwrite existing package directory: ${outputRoot}`); }
catch (error) { if (error.code !== 'ENOENT') throw error; }

await mkdir(outputRoot);
const entries = [];
for (const path of paths) {
  const source = join(repoRoot, ...path.split('/'));
  const destination = join(outputRoot, ...path.split('/'));
  const before = await lstat(source);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error(`Source path is not a regular file: ${path}`);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination, constants.COPYFILE_EXCL);
  const bytes = await readFile(destination);
  if (bytes.byteLength !== before.size) throw new Error(`Copied file size mismatch: ${path}`);
  entries.push({ path, size: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const manifest = { schemaVersion: 1, files: entries };
await writeFile(join(outputRoot, 'CONTENT_MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
const verification = await verifySourcePackage(outputRoot);
process.stdout.write(`Created and verified ${relative(repoRoot, outputRoot)} with ${verification.files} allowlisted files.\n`);
process.stdout.write(`CONTENT_MANIFEST.json SHA-256 ${verification.manifestSha256}\n`);
process.stdout.write('The output directory is ignored by Git; this script will not overwrite existing packages.\n');
