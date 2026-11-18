import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

async function main(args) {
  const sourcePath = argument(args, '--source');
  const mappingPath = argument(args, '--mapping');
  if (!sourcePath || !mappingPath) {
    throw new Error('Usage: node scripts/migrations/edge-history-dry-run.mjs --source <operational-export.json> --mapping <explicit-mappings.json>');
  }

  const source = JSON.parse(await readFile(sourcePath, 'utf8'));
  const mappings = JSON.parse(await readFile(mappingPath, 'utf8'));
  if (!Array.isArray(source.transactions)) throw new Error('Source export must contain a transactions array.');
  for (const key of ['cards', 'branches', 'devices']) {
    if (!isRecord(mappings[key])) throw new Error(`Mapping file must contain an explicit ${key} object.`);
  }

  const counters = { read: 0, imported: 0, duplicates: 0, unmapped: 0, rejected: 0, needsReconciliation: 0 };
  const totals = { inputAmountRial: 0n, importableNetRial: 0n, importableGrossRial: 0n, importableDiscountRial: 0n };
  const seen = new Set();
  const plan = [];
  const rejectionCodes = new Map();

  for (const row of source.transactions) {
    counters.read += 1;
    const invalidCode = validateRow(row);
    if (invalidCode) {
      count(rejectionCodes, invalidCode);
      counters.rejected += 1;
      continue;
    }
    totals.inputAmountRial += BigInt(row.amountRial);
    const duplicateKey = `${row.sourceInstanceId}\u0000${row.localTransactionId}`;
    if (seen.has(duplicateKey)) {
      counters.duplicates += 1;
      continue;
    }
    seen.add(duplicateKey);

    const card = mappings.cards[row.legacyCardId];
    const branchId = mappings.branches[row.legacyBranchId];
    const deviceId = mappings.devices[row.legacyDeviceId];
    if (!isRecord(card) || !isUuid(card.cardId) || !isUuid(card.householdId) ||
      !(card.memberId === null || card.memberId === undefined || isUuid(card.memberId)) ||
      !isUuid(branchId) || !isUuid(deviceId)) {
      counters.unmapped += 1;
      continue;
    }

    const hasBreakdown = Number.isSafeInteger(row.grossAmountRial) && row.grossAmountRial >= 0 &&
      Number.isSafeInteger(row.discountAmountRial) && row.discountAmountRial >= 0 &&
      Number.isSafeInteger(row.netAmountRial) && row.netAmountRial >= 0 &&
      row.grossAmountRial - row.discountAmountRial === row.netAmountRial;
    if (!hasBreakdown || row.currencyCode !== 'IRR') {
      counters.needsReconciliation += 1;
      continue;
    }

    counters.imported += 1;
    totals.importableGrossRial += BigInt(row.grossAmountRial);
    totals.importableDiscountRial += BigInt(row.discountAmountRial);
    totals.importableNetRial += BigInt(row.netAmountRial);
    plan.push({
      source: 'legacy',
      sourceInstanceId: row.sourceInstanceId,
      localTransactionId: row.localTransactionId,
      legacyEventId: row.legacyEventId,
      organizationId: row.organizationId,
      branchId,
      deviceId,
      cardId: card.cardId,
      householdId: card.householdId,
      memberId: card.memberId ?? null,
      transactionKind: row.transactionKind,
      amountRial: row.amountRial,
      currencyCode: 'IRR',
      grossAmountRial: row.grossAmountRial,
      discountAmountRial: row.discountAmountRial,
      netAmountRial: row.netAmountRial,
      occurredAt: new Date(row.occurredAt).toISOString(),
    });
  }

  const checksum = createHash('sha256').update(canonical(plan)).digest('hex');
  console.log(JSON.stringify({
    mode: 'dry-run',
    source: 'operational-export',
    databaseWritten: false,
    counts: counters,
    totalsRial: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, value.toString()])),
    rejectionCodes: Object.fromEntries([...rejectionCodes.entries()].sort(([a], [b]) => a.localeCompare(b))),
    checksum,
  }, null, 2));
}

function validateRow(row) {
  if (!isRecord(row)) return 'ROW_NOT_OBJECT';
  if (!isUuid(row.sourceInstanceId) || !isUuid(row.organizationId)) return 'SOURCE_SCOPE_INVALID';
  if (typeof row.localTransactionId !== 'string' || row.localTransactionId.trim().length < 1 || row.localTransactionId.length > 160) return 'LOCAL_TRANSACTION_ID_INVALID';
  if (typeof row.legacyEventId !== 'string' || row.legacyEventId.length < 1 || row.legacyEventId.length > 160) return 'LEGACY_EVENT_ID_INVALID';
  if (typeof row.legacyCardId !== 'string' || typeof row.legacyBranchId !== 'string' || typeof row.legacyDeviceId !== 'string') return 'LEGACY_MAPPING_KEY_MISSING';
  if (!['top_up', 'spend', 'refund', 'adjustment', 'issuance', 'card_replacement'].includes(row.transactionKind)) return 'TRANSACTION_KIND_INVALID';
  if (!Number.isSafeInteger(row.amountRial) || !Number.isFinite(Date.parse(row.occurredAt))) return 'AMOUNT_OR_TIME_INVALID';
  return null;
}

function argument(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function isRecord(value) { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function isUuid(value) { return typeof value === 'string' && uuidPattern.test(value); }
function count(map, key) { map.set(key, (map.get(key) ?? 0) + 1); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value)) return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

main(process.argv.slice(2)).catch((error) => {
  const message = error instanceof Error ? error.message : 'Unknown migration input error.';
  console.error(message);
  process.exitCode = 1;
});
