import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_NAME = 'CONTENT_MANIFEST.json';
const SAFE_SEGMENT = /^[A-Za-z0-9._@+-]+$/;

function normalizePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.startsWith('/') || value.includes('\0')) throw new Error('Unsafe package path');
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || !SAFE_SEGMENT.test(part))) throw new Error('Unsafe package path');
  return parts.join('/');
}

function assertSafeFile(rel, bytes) {
  const base = rel.split('/').at(-1).toLowerCase();
  if ((base === '.env' || base === '.liara-readonly.json' || /(?:^|[._-])(credentials?|secrets?|private-key)(?:[._-]|$)/i.test(base))
    && !['.env.example', '.liara-readonly.example.json'].includes(base)) throw new Error(`Private file rejected: ${rel}`);
  if (rel.endsWith('.tgz') || /\.(?:woff2?|png|jpe?g|gif|ico|pdf|zip)$/i.test(rel)) return;
  const content = bytes.toString('utf8');
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)
    || /\b(?:sk-[A-Za-z0-9]{24,}|liara_[A-Za-z0-9_-]{24,}|Bearer\s+[A-Za-z0-9._~-]{32,})/.test(content)
    || /\b(?:LIARA_READONLY_TOKEN|LIARA_LLM_API_KEY|BOXAPI_API_KEY|OPENROUTER_API_KEY)\s*[:=]\s*["']?(?!<|your|replace|placeholder|example|test|dummy|xxx|\$\{)[A-Za-z0-9._~+/-]{16,}/i.test(content)) {
    throw new Error(`Credential-like content rejected: ${rel}`);
  }
  const absoluteSibling = /(?:[A-Za-z]:[\\/]|\/)[^\r\n"'<>`]*?apps[\\/]([A-Za-z0-9._-]+)[\\/]/gi;
  for (const match of content.matchAll(absoluteSibling)) {
    if (match[1].toLowerCase() !== 'opsdocktor') throw new Error(`Sibling application dependency rejected: ${rel}`);
  }
}

function markdownTargets(content) {
  const targets = [];
  const link = /!?\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of content.matchAll(link)) {
    let target = match[1].trim();
    if (target.startsWith('<')) target = target.slice(1, target.indexOf('>'));
    else target = target.split(/\s+/, 1)[0];
    targets.push(target);
  }
  return targets;
}

async function assertNoSymlinkPath(root, rel) {
  let current = root;
  for (const segment of rel.split('/')) {
    current = join(current, segment);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error(`Symlink rejected: ${rel}`);
    if (current !== join(root, rel) && !info.isDirectory()) throw new Error(`Unsafe path component: ${rel}`);
  }
  const info = await lstat(current);
  if (!info.isFile()) throw new Error(`Non-regular file rejected: ${rel}`);
  return info;
}

export async function auditSourceFileSet(root, inputPaths) {
  const paths = inputPaths.map(normalizePath);
  if (new Set(paths).size !== paths.length) throw new Error('Duplicate allowlisted path');
  const allowed = new Set(paths);
  for (const rel of paths) {
    const info = await assertNoSymlinkPath(root, rel);
    const bytes = await readFile(join(root, ...rel.split('/')));
    if (bytes.byteLength !== info.size) throw new Error(`File changed while being read: ${rel}`);
    assertSafeFile(rel, bytes);
    if (!/\.md$/i.test(rel)) continue;
    const content = bytes.toString('utf8');
    for (const rawTarget of markdownTargets(content)) {
      if (!rawTarget || /^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/\/|#)/.test(rawTarget)) continue;
      let decoded;
      try { decoded = decodeURIComponent(rawTarget.split('#', 1)[0].split('?', 1)[0]); }
      catch { throw new Error(`Invalid Markdown link encoding: ${rel}`); }
      if (!decoded) continue;
      const targetRel = relative(root, resolve(root, dirname(rel), decoded)).split(sep).join('/');
      if (targetRel.startsWith('../') || targetRel === '..') throw new Error(`Markdown link escapes package: ${rel}`);
      const target = targetRel ? normalizePath(targetRel) : '';
      let allowedTarget = target ? allowed.has(target) : false;
      if (!allowedTarget) allowedTarget = [...allowed].some(candidate => candidate.startsWith(`${target ? `${target}/` : ''}`));
      if (!allowedTarget) throw new Error(`Missing or non-allowlisted Markdown link target: ${rel} -> ${decoded}`);
    }
  }
  return paths;
}

async function listFiles(root, directory = root) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    const rel = relative(root, full).split(sep).join('/');
    if (entry.isSymbolicLink()) throw new Error(`Symlink rejected: ${rel}`);
    if (entry.isDirectory()) found.push(...await listFiles(root, full));
    else if (entry.isFile()) found.push(rel);
    else throw new Error(`Non-regular package entry rejected: ${rel}`);
  }
  return found.sort();
}

export async function verifySourcePackage(packageRoot) {
  const root = resolve(packageRoot);
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Package root must be a regular directory');
  const allowlist = JSON.parse(await readFile(join(root, 'scripts', 'package-allowlist.json'), 'utf8'));
  if (!Array.isArray(allowlist) || allowlist.some(path => typeof path !== 'string')) throw new Error('Invalid package allowlist');
  const paths = allowlist.map(normalizePath);
  if (new Set(paths).size !== paths.length || paths.join('\0') !== [...paths].sort().join('\0')) throw new Error('Package allowlist must be unique and sorted');
  if (!paths.includes('scripts/package-allowlist.json') || !paths.includes('scripts/verify-source-package.mjs')) throw new Error('Verifier files are not in the package allowlist');
  const expected = [...paths, MANIFEST_NAME].sort();
  const actual = await listFiles(root);
  if (actual.join('\0') !== expected.join('\0')) throw new Error('Package files do not exactly match the allowlist and manifest');
  await auditSourceFileSet(root, paths);
  const manifestBytes = await readFile(join(root, MANIFEST_NAME));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)) throw new Error('Invalid content manifest');
  if (manifest.files.length !== paths.length || manifest.files.map(item => item.path).join('\0') !== paths.join('\0')) throw new Error('Manifest paths do not match the sorted allowlist');
  for (const item of manifest.files) {
    if (!item || !Number.isSafeInteger(item.size) || item.size < 0 || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('Malformed content manifest entry');
    const bytes = await readFile(join(root, ...item.path.split('/')));
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (bytes.byteLength !== item.size || digest !== item.sha256) throw new Error(`Manifest hash or size mismatch: ${item.path}`);
  }
  return { files: paths.length, manifestSha256: createHash('sha256').update(manifestBytes).digest('hex') };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const packageRoot = resolve(process.argv[2] ?? '.');
  const result = await verifySourcePackage(packageRoot);
  process.stdout.write(`Verified ${result.files} allowlisted files; CONTENT_MANIFEST.json SHA-256 ${result.manifestSha256}\n`);
}
