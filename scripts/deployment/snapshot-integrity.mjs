export function committedBlobMatchesSourceRevision({
  sourceRevision,
  committedBlobHash,
  sourceRevisionBlobHash,
}) {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(sourceRevision ?? '')) return false;
  return Boolean(
    committedBlobHash && sourceRevisionBlobHash && committedBlobHash === sourceRevisionBlobHash,
  );
}
