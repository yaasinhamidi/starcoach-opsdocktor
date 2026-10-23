import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRepairProposal, validateRepairTask } from './coding-agent.mjs';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const WORKER_SCRIPT = join(moduleDir, 'coding-agent-worker.mjs');
const MAX_INPUT_BYTES = 16 * 1024;
const MAX_OUTPUT_BYTES = 16 * 1024;
const MIN_TIMEOUT_MS = 25;
const MAX_TIMEOUT_MS = 10_000;
const CHILD_ENV_KEYS = ['SystemRoot', 'WINDIR', 'TEMP', 'TMP'];
const WORKER_ERROR_CODES = new Set(['INVALID_REQUEST']);

function minimalEnvironment() {
  const env = {};
  for (const key of CHILD_ENV_KEYS) {
    const value = process.env[key];
    if (typeof value === 'string' && value.length > 0 && value.length <= 2048) env[key] = value;
  }
  return env;
}

function protocolError(code) {
  const error = new Error(`PROCESS_FAKE_AGENT_${code}`);
  error.code = `PROCESS_FAKE_AGENT_${code}`;
  return error;
}

function parseResponse(stdout) {
  if (Buffer.byteLength(stdout) > MAX_OUTPUT_BYTES) throw protocolError('OUTPUT_TOO_LARGE');
  const jsonText = stdout.endsWith('\r\n') ? stdout.slice(0, -2) : stdout.endsWith('\n') ? stdout.slice(0, -1) : stdout;
  if (!jsonText || /[\r\n]/.test(jsonText) || jsonText.trim() !== jsonText) throw protocolError('INVALID_RESPONSE_COUNT');
  let response;
  try { response = JSON.parse(jsonText); } catch { throw protocolError('INVALID_JSON'); }
  if (!response || typeof response !== 'object' || Array.isArray(response) || Object.getPrototypeOf(response) !== Object.prototype) throw protocolError('INVALID_RESPONSE');
  if (!response.worker || Object.keys(response.worker).sort().join(',') !== 'pid,ppid'
    || !Number.isSafeInteger(response.worker.pid) || !Number.isSafeInteger(response.worker.ppid)
    || response.worker.pid === process.pid || response.worker.ppid !== process.pid) throw protocolError('WORKER_IDENTITY_MISMATCH');
  if (response.ok === true) {
    if (Object.keys(response).sort().join(',') !== 'ok,proposal,worker') throw protocolError('INVALID_RESPONSE');
    return response;
  }
  if (response.ok === false) {
    if (Object.keys(response).sort().join(',') !== 'error,ok,worker'
      || !response.error || !WORKER_ERROR_CODES.has(response.error.code)
      || Object.keys(response.error).join(',') !== 'code') throw protocolError('INVALID_ERROR_RESPONSE');
    throw protocolError(`REJECTED_${response.error.code}`);
  }
  throw protocolError('INVALID_RESPONSE');
}

/** Provider-neutral local bridge to one fixed, trusted worker; it never accepts a path or command. */
export class ProcessFakeCodingAgentAdapter {
  mode = 'PROCESS_FAKE_AGENT';
  inFlight = false;
  lastChildPid = null;

  constructor({ spawnImpl = spawn, timeoutMs = 2000 } = {}) {
    if (typeof spawnImpl !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
      throw new TypeError('Invalid process bridge configuration');
    }
    this.spawnImpl = spawnImpl;
    this.timeoutMs = timeoutMs;
  }

  async proposeRepair(request) {
    if (this.inFlight) throw protocolError('BUSY');
    validateRepairTask(request);
    const input = `${JSON.stringify(request)}\n`;
    if (Buffer.byteLength(input) > MAX_INPUT_BYTES) throw protocolError('INPUT_TOO_LARGE');
    this.inFlight = true;
    this.lastChildPid = null;
    try {
      const response = await this.#exchange(input);
      // The worker is an offline deterministic double. Its provenance is validated first,
      // then the parent records process transport as a separate, truthful fact.
      validateRepairProposal(request, response.proposal, 'FAKE_AGENT');
      this.lastChildPid = response.worker.pid;
      return { ...response.proposal, provenance: { ...response.proposal.provenance, backend: this.mode } };
    } finally {
      this.inFlight = false;
    }
  }

  #exchange(input) {
    return new Promise((resolve, reject) => {
      let child;
      let stdout = '';
      let stderrBytes = 0;
      let settled = false;
      let timedOut = false;
      let timer;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(value);
      };
      const kill = () => { try { child?.kill(); } catch { /* process may already have exited */ } };

      try {
        child = this.spawnImpl(process.execPath, [WORKER_SCRIPT], {
          cwd: moduleDir,
          env: minimalEnvironment(),
          shell: false,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch {
        finish(protocolError('SPAWN_FAILED'));
        return;
      }

      timer = setTimeout(() => {
        timedOut = true;
        finish(protocolError('TIMEOUT'));
        kill();
      }, this.timeoutMs);

      child.stdout?.on('data', chunk => {
        stdout += chunk.toString('utf8');
        if (Buffer.byteLength(stdout) > MAX_OUTPUT_BYTES) {
          finish(protocolError('OUTPUT_TOO_LARGE'));
          kill();
        }
      });
      child.stderr?.on('data', chunk => {
        stderrBytes += Buffer.byteLength(chunk);
        if (stderrBytes > MAX_OUTPUT_BYTES) {
          finish(protocolError('OUTPUT_TOO_LARGE'));
          kill();
        }
      });
      child.once('error', () => finish(protocolError('WORKER_CRASHED')));
      child.once('close', code => {
        if (settled) return;
        if (timedOut) return finish(protocolError('TIMEOUT'));
        if (code !== 0) return finish(protocolError('UNEXPECTED_EXIT'));
        if (stderrBytes !== 0) return finish(protocolError('UNEXPECTED_STDERR'));
        try { finish(null, parseResponse(stdout)); }
        catch (error) { finish(error); }
      });
      child.stdin?.once('error', () => {
        if (!settled) finish(protocolError('WORKER_CRASHED'));
      });
      try { child.stdin.end(input); }
      catch { finish(protocolError('WORKER_CRASHED')); kill(); }
    });
  }
}
