import { createHash } from 'node:crypto';

const sha = value => createHash('sha256').update(value).digest('hex');
const MAX_LINES = 20;
const MAX_LINE_BYTES = 4096;

function categoryOf(message) {
  if (/Cannot find module\s+['"](?:\/?app\/)?missing\.mjs['"]/i.test(message)) return 'STARTUP_ENTRYPOINT_MISSING';
  if (portContractMismatch(message)) return 'PORT_CONFIGURATION_MISMATCH';
  if (/\bEADDRINUSE\b/i.test(message)) return 'PORT_BIND_CONFLICT';
  if (/^Missing required configuration:\s*APP_PUBLIC_ORIGIN\s*$/i.test(message)) return 'REQUIRED_CONFIG_MISSING';
  if (/^\s*code:\s*MODULE_NOT_FOUND\s*$/i.test(message)) return 'STARTUP_COMPANION';
  return null;
}

function portContractMismatch(message) {
  const match = /^Deployment contract mismatch: package\.json config\.port=(\d{1,5}); liara\.json port=(\d{1,5})$/i.exec(message);
  if (!match) return null;
  const applicationPort = Number(match[1]);
  const deploymentPort = Number(match[2]);
  if (!validPort(applicationPort) || !validPort(deploymentPort) || applicationPort === deploymentPort) return null;
  return { applicationPort, deploymentPort };
}

function validPort(value) { return Number.isInteger(value) && value >= 1 && value <= 65535; }

function safeSummary(category, details) {
  if (category === 'STARTUP_ENTRYPOINT_MISSING') return 'Startup entrypoint missing: missing.mjs';
  if (category === 'STARTUP_COMPANION') return 'MODULE_NOT_FOUND signal for the startup failure.';
  if (category === 'PORT_BIND_CONFLICT') return 'Synthetic service reported EADDRINUSE on port 3000.';
  if (category === 'PORT_CONFIGURATION_MISMATCH') return `Explicit port contract mismatch: application ${details.applicationPort}, deployment ${details.deploymentPort}.`;
  if (category === 'REQUIRED_CONFIG_MISSING') return 'Synthetic required setting APP_PUBLIC_ORIGIN was reported missing.';
  return 'Unclassified evidence was withheld.';
}

/** Classifies only bounded, release-correlated synthetic evidence; never returns raw log text. */
export function classifyReplayIncident(replayLogs, replayReleases) {
  const sourceValid = replayLogs?.source === 'REPLAY' && Array.isArray(replayLogs.lines) && replayLogs.lines.length > 0 && replayLogs.lines.length <= MAX_LINES;
  const release = replayReleases?.releases?.find(item => item.id === replayLogs?.releaseId) ?? null;
  if (!sourceValid) return { code: 'INSUFFICIENT_EVIDENCE', correlation: 'UNCONFIRMED', release, evidenceIds: [], logs: [], category: null, uncertainty: 'HIGH' };

  const classified = [];
  let malformed = false;
  for (const line of replayLogs.lines) {
    const message = line?.message;
    if (typeof message !== 'string' || Buffer.byteLength(message) > MAX_LINE_BYTES
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(message)
      || /ignore\s+(?:all\s+)?(?:previous|prior|system)|system\s+prompt|assistant\s*[:>]|<\|(?:system|assistant|tool)/i.test(message)) {
      malformed = true;
      continue;
    }
    const category = categoryOf(message);
    if (category) classified.push({ line, category, details: category === 'PORT_CONFIGURATION_MISMATCH'
      ? portContractMismatch(message) : category === 'STARTUP_ENTRYPOINT_MISSING' ? { missingEntrypoint: 'missing.mjs' } : null });
    else if (line.level === 'error' || /MODULE_NOT_FOUND|EADDRINUSE|configuration|config/i.test(message)) malformed = true;
  }

  const incidents = classified.filter(item => item.category !== 'STARTUP_COMPANION');
  const incidentCategories = [...new Set(incidents.map(item => item.category))];
  const detailSignatures = [...new Set(incidents.filter(item => item.category === 'PORT_CONFIGURATION_MISMATCH').map(item => JSON.stringify(item.details)))];
  const mixed = incidentCategories.length > 1 || detailSignatures.length > 1;
  const signalsCorrelated = Boolean(release && release.state === 'FAILED'
    && classified.every(item => item.line.releaseId === release.id)
    && replayLogs.lines.every(line => line.releaseId === release.id));
  const correlation = !malformed && !mixed && signalsCorrelated ? 'CONFIRMED' : 'UNCONFIRMED';
  const category = correlation === 'CONFIRMED' ? incidentCategories[0] ?? null : null;
  const evidenceItems = category ? incidents.map(({ line, category: itemCategory, details }) => ({
    id: `ev_${sha(`${release.id}\0${line.timestamp ?? ''}\0${itemCategory}\0${details ? JSON.stringify(details) : ''}`).slice(0, 16)}`,
    type: itemCategory,
    details,
  })) : [];
  const evidenceIds = evidenceItems.map(item => item.id);
  const logs = replayLogs.lines.map(line => {
    const item = classified.find(candidate => candidate.line === line);
    return {
      source: 'REPLAY', releaseId: correlation === 'CONFIRMED' ? release.id : null,
      timestamp: typeof line.timestamp === 'string' && line.timestamp.length <= 40 ? line.timestamp : null,
      category: item?.category ?? 'UNCLASSIFIED', message: safeSummary(item?.category, item?.details),
      file: ['package.json', 'server.mjs'].includes(line.file) ? line.file : null,
      line: Number.isSafeInteger(line.line) && line.line > 0 && line.line <= 100_000 ? line.line : null,
    };
  });
  return {
    code: mixed || malformed || (category && correlation !== 'CONFIRMED') ? 'AMBIGUOUS_EVIDENCE' : category ?? 'INSUFFICIENT_EVIDENCE',
    category, correlation, release, evidenceIds: [...new Set(evidenceIds)], evidenceItems, logs,
    uncertainty: category && correlation === 'CONFIRMED' ? 'LOW' : 'HIGH',
  };
}

