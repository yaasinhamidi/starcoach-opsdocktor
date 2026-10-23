import { FakeCodingAgentAdapter, validateRepairTask } from './coding-agent.mjs';

const MAX_INPUT_BYTES = 16 * 1024;

function respond(value) {
  process.stdout.write(`${JSON.stringify({ ...value, worker: { pid: process.pid, ppid: process.ppid } })}\n`);
}

let input = '';
let invalid = false;
for await (const chunk of process.stdin) {
  input += chunk.toString('utf8');
  if (Buffer.byteLength(input) > MAX_INPUT_BYTES) {
    invalid = true;
    break;
  }
}

try {
  if (invalid) throw new Error('INVALID_REQUEST');
  const jsonText = input.endsWith('\r\n') ? input.slice(0, -2) : input.endsWith('\n') ? input.slice(0, -1) : input;
  if (!jsonText || /[\r\n]/.test(jsonText) || jsonText.trim() !== jsonText) throw new Error('INVALID_REQUEST');
  const request = JSON.parse(jsonText);
  validateRepairTask(request);
  const proposal = await new FakeCodingAgentAdapter().proposeRepair(request);
  respond({ ok: true, proposal });
} catch {
  respond({ ok: false, error: { code: 'INVALID_REQUEST' } });
  process.exitCode = 0;
}
