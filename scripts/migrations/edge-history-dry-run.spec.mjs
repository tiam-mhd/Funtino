import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('./edge-history-dry-run.mjs', import.meta.url));

test('migration dry-run reports mapped, duplicate, unmapped, and unreconciled rows without database writes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'funtino-edge-dry-run-'));
  try {
    const sourcePath = join(directory, 'source.json');
    const mappingPath = join(directory, 'mapping.json');
    const base = {
      sourceInstanceId: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
      legacyCardId: 'legacy-card-a',
      legacyBranchId: 'legacy-branch-a',
      legacyDeviceId: 'legacy-device-a',
      transactionKind: 'spend',
      amountRial: -9000,
      currencyCode: 'IRR',
      grossAmountRial: 10000,
      discountAmountRial: 1000,
      netAmountRial: 9000,
      occurredAt: '2026-10-01T10:00:00.000Z',
    };
    await writeFile(
      sourcePath,
      JSON.stringify({
        transactions: [
          { ...base, localTransactionId: 'local-1', legacyEventId: 'legacy-1' },
          { ...base, localTransactionId: 'local-1', legacyEventId: 'legacy-duplicate' },
          {
            ...base,
            localTransactionId: 'local-2',
            legacyEventId: 'legacy-unmapped',
            legacyCardId: 'unknown-card',
          },
          {
            ...base,
            localTransactionId: 'local-3',
            legacyEventId: 'legacy-reconcile',
            discountAmountRial: undefined,
          },
        ],
      }),
      'utf8',
    );
    await writeFile(
      mappingPath,
      JSON.stringify({
        cards: {
          'legacy-card-a': {
            cardId: '33333333-3333-4333-8333-333333333333',
            householdId: '44444444-4444-4444-8444-444444444444',
            memberId: null,
          },
        },
        branches: { 'legacy-branch-a': '55555555-5555-4555-8555-555555555555' },
        devices: { 'legacy-device-a': '66666666-6666-4666-8666-666666666666' },
      }),
      'utf8',
    );

    const result = spawnSync(
      process.execPath,
      [script, '--source', sourcePath, '--mapping', mappingPath],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report.counts, {
      read: 4,
      imported: 1,
      duplicates: 1,
      unmapped: 1,
      rejected: 0,
      needsReconciliation: 1,
    });
    assert.equal(report.databaseWritten, false);
    assert.match(report.checksum, /^[a-f0-9]{64}$/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
