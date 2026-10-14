import assert from 'node:assert/strict';
import test from 'node:test';
import { committedBlobMatchesSourceRevision } from './snapshot-integrity.mjs';

test('accepts a clean committed file when it matches the receipt source revision', () => {
  const blobHash = 'a'.repeat(64);

  assert.equal(
    committedBlobMatchesSourceRevision({
      sourceRevision: 'b'.repeat(40),
      committedBlobHash: blobHash,
      sourceRevisionBlobHash: blobHash,
    }),
    true,
  );
});

test('rejects a committed destination change that differs from its source revision', () => {
  assert.equal(
    committedBlobMatchesSourceRevision({
      sourceRevision: 'b'.repeat(40),
      committedBlobHash: 'a'.repeat(64),
      sourceRevisionBlobHash: 'c'.repeat(64),
    }),
    false,
  );
});

test('rejects missing blob hashes and invalid source revisions', () => {
  assert.equal(
    committedBlobMatchesSourceRevision({
      sourceRevision: 'invalid',
      committedBlobHash: 'a'.repeat(64),
      sourceRevisionBlobHash: 'a'.repeat(64),
    }),
    false,
  );
  assert.equal(
    committedBlobMatchesSourceRevision({
      sourceRevision: 'b'.repeat(40),
      committedBlobHash: null,
      sourceRevisionBlobHash: 'a'.repeat(64),
    }),
    false,
  );
});
