/** Decide whether an HTTP mutation response still belongs to the visible workflow. */
export function shouldApplyWorkflowResponse(current, incoming, sequence, lastAppliedSequence) {
  if (!Number.isSafeInteger(sequence) || !Number.isSafeInteger(lastAppliedSequence) || sequence < lastAppliedSequence) return false;
  if (!incoming || typeof incoming.serverInstanceId !== 'string' || !Number.isSafeInteger(incoming.generation) || typeof incoming.runId !== 'string') return false;
  if (!current) return true;
  if (incoming.serverInstanceId !== current.serverInstanceId) return false;
  if (incoming.generation < current.generation) return false;
  if (incoming.generation === current.generation && incoming.runId !== current.runId) return false;
  return true;
}
