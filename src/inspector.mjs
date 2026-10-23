import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

const MAX_METADATA_BYTES = 256 * 1024;
const MAX_EVIDENCE_KEY_CHARS = 80;

function sanitizeConfigKey(key) {
  const safe = Array.from(key, char => /[\p{Cc}\p{Cf}\p{Cs}]/u.test(char) ? '\uFFFD' : char).join('');
  const chars = Array.from(safe);
  return chars.length > MAX_EVIDENCE_KEY_CHARS
    ? `${chars.slice(0, MAX_EVIDENCE_KEY_CHARS).join('')}…`
    : (safe || '<empty>');
}

function withinRoot(root, candidate) {
  const rel = relative(root, candidate);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function readMetadata(root, name) {
  const path = join(root, name);
  const before = await lstat(path);
  if (before.isSymbolicLink() || !before.isFile()) {
    const error = new Error('Metadata path is not a regular file');
    error.code = 'EINVAL';
    throw error;
  }
  if (before.size > MAX_METADATA_BYTES) {
    const error = new Error('Metadata file exceeds the size limit');
    error.code = 'EFBIG';
    throw error;
  }

  const noFollow = constants.O_NOFOLLOW ?? 0;
  const handle = await open(path, constants.O_RDONLY | noFollow);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      const error = new Error('Metadata file changed while opening');
      error.code = 'EINVAL';
      throw error;
    }
    const resolvedPath = await realpath(path);
    if (!withinRoot(root, resolvedPath)) {
      const error = new Error('Metadata file resolves outside the project root');
      error.code = 'EINVAL';
      throw error;
    }
    const buffer = Buffer.alloc(MAX_METADATA_BYTES + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const { bytesRead: count } = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (count === 0) break;
      bytesRead += count;
    }
    if (bytesRead > MAX_METADATA_BYTES) {
      const error = new Error('Metadata file exceeds the size limit');
      error.code = 'EFBIG';
      throw error;
    }
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

// Static-only inspection: never imports or executes application files.
// The preparation scaffold intentionally understands only liara.json's port field.
export async function inspectRepository(root) {
  const findings = [];
  const add = (code, evidence, message) => findings.push({ code, severity: 'error', evidence, message });
  let authorizedRoot;
  try {
    authorizedRoot = await realpath(root);
  } catch {
    authorizedRoot = root;
  }

  let pkg;
  try {
    pkg = JSON.parse(await readMetadata(authorizedRoot, 'package.json'));
  } catch (error) {
    if (error.code === 'ENOENT') add('PACKAGE_JSON_MISSING', 'package.json', 'Required package.json was not found.');
    else if (error instanceof SyntaxError) add('PACKAGE_JSON_INVALID', 'package.json', 'package.json is not valid JSON.');
    else add('PACKAGE_JSON_UNREADABLE', 'package.json', `package.json could not be read (${error.code ?? 'unknown error'}).`);
  }

  if (pkg !== undefined) {
    if (!isRecord(pkg)) {
      add('PACKAGE_JSON_INVALID_STRUCTURE', 'package.json', 'package.json must contain a JSON object.');
      pkg = undefined;
    } else if (pkg.scripts !== undefined && !isRecord(pkg.scripts)) {
      add('PACKAGE_SCRIPTS_INVALID', 'package.json:scripts', 'package.json scripts must be an object.');
    } else if (pkg.scripts?.start !== undefined && (typeof pkg.scripts.start !== 'string' || !pkg.scripts.start.trim())) {
      add('PACKAGE_START_INVALID', 'package.json:scripts.start', 'scripts.start must be a non-empty string.');
    } else if (!pkg.scripts?.start) {
      findings.push({ code: 'NODE_START_MISSING', severity: 'error', evidence: 'package.json:scripts.start' });
    }
  }

  let liara;
  try {
    liara = JSON.parse(await readMetadata(authorizedRoot, 'liara.json'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      const syntax = error instanceof SyntaxError;
      add(syntax ? 'LIARA_JSON_INVALID' : 'LIARA_JSON_UNREADABLE', 'liara.json',
        syntax ? 'liara.json is not valid JSON.' : `liara.json could not be read (${error.code ?? 'unknown error'}).`);
    }
  }

  if (liara !== undefined) {
    if (!isRecord(liara)) {
      add('LIARA_CONFIG_INVALID', 'liara.json', 'liara.json must contain a JSON object.');
    } else {
      if (!Object.hasOwn(liara, 'port')) add('LIARA_CONFIG_INVALID', 'liara.json:port', 'The supported Liara config subset requires a port field.');
      for (const key of Object.keys(liara)) {
        if (key !== 'port') {
          const safeKey = sanitizeConfigKey(key);
          add('LIARA_CONFIG_UNSUPPORTED', `liara.json:${safeKey}`, `Liara setting "${safeKey}" is outside the verified inspection subset.`);
        }
      }
      if ('port' in liara && (!Number.isInteger(liara.port) || liara.port < 1 || liara.port > 65535)) {
        add('LIARA_PORT_INVALID', 'liara.json:port', 'Liara port must be an integer from 1 through 65535.');
      }
    }
  }

  if (isRecord(liara) && Number.isInteger(liara.port) && isRecord(pkg) && Number.isInteger(pkg.config?.port) && liara.port !== pkg.config.port) {
    findings.push({ code: 'PORT_CONFIG_MISMATCH', severity: 'warning', evidence: 'liara.json:port; package.json:config.port' });
  }
  return findings;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
