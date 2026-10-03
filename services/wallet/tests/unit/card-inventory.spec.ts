import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isCardStatusTransitionAllowed,
  cardAuditSnapshot,
  maskExternalCardId,
  normalizeExternalCardId,
  toCardInventoryView,
  type CardInventoryRecord,
} from '../../src/domain/card-inventory/card-inventory.js';

test('card identifiers are trimmed, normalized without case folding, and reject control characters', () => {
  assert.equal(normalizeExternalCardId('  CARD-A9  '), 'CARD-A9');
  assert.equal(normalizeExternalCardId('card-a9'), 'card-a9');
  assert.throws(() => normalizeExternalCardId('CARD\nA9'), /CARD_IDENTIFIER_INVALID/);
  assert.throws(() => normalizeExternalCardId('x'.repeat(161)), /CARD_IDENTIFIER_INVALID/);
});

test('card identifier masking never reveals identifiers shorter than four characters', () => {
  assert.equal(maskExternalCardId('123'), '••••');
  assert.equal(maskExternalCardId('1234'), '••••');
  assert.equal(maskExternalCardId('CARD-4821'), '•••• 4821');
});

test('card DTO and audit snapshot never include the physical identifier', () => {
  const record: CardInventoryRecord = {
    id: '11111111-1111-4111-8111-111111111111',
    organizationId: '22222222-2222-4222-8222-222222222222',
    branchId: '33333333-3333-4333-8333-333333333333',
    externalCardId: 'PRIVATE-CARD-4821',
    status: 'in_stock',
    verificationStatus: 'unknown',
    version: 1,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
  };
  assert.equal(JSON.stringify(toCardInventoryView(record)).includes(record.externalCardId), false);
  assert.equal(JSON.stringify(cardAuditSnapshot(record)).includes(record.externalCardId), false);
});

test('inventory lifecycle only permits unblock before retirement', () => {
  assert.equal(isCardStatusTransitionAllowed('in_stock', 'blocked'), true);
  assert.equal(isCardStatusTransitionAllowed('in_stock', 'retired'), true);
  assert.equal(isCardStatusTransitionAllowed('blocked', 'in_stock'), true);
  assert.equal(isCardStatusTransitionAllowed('blocked', 'retired'), true);
  assert.equal(isCardStatusTransitionAllowed('retired', 'in_stock'), false);
  assert.equal(isCardStatusTransitionAllowed('retired', 'blocked'), false);
});
