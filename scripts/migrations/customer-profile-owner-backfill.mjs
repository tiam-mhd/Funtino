import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function buildProfilePlan(sourceRows, destinationRows) {
  const destination = new Map(destinationRows.map((row) => [row.userId.toLowerCase(), row]));
  const destinationEmails = new Map(
    destinationRows
      .filter((row) => row.email)
      .map((row) => [row.email.toLowerCase(), row.userId.toLowerCase()]),
  );
  const sourceUsers = new Map();
  const plannedEmails = new Map();
  const plan = [];
  const counts = { read: 0, imported: 0, duplicates: 0, unmapped: 0, rejected: 0 };
  const rejectedCodes = new Map();
  for (const row of sourceRows) {
    counts.read += 1;
    if (!row || typeof row.id !== 'string' || !uuidPattern.test(row.id)) {
      counts.unmapped += 1;
      continue;
    }
    const normalized = normalizeProfile(row);
    if (!normalized) {
      counts.rejected += 1;
      increment(rejectedCodes, 'PROFILE_INVALID');
      continue;
    }
    const sourceExisting = sourceUsers.get(row.id.toLowerCase());
    if (sourceExisting) {
      if (canonicalComparable(sourceExisting) === canonicalComparable(normalized))
        counts.duplicates += 1;
      else {
        counts.rejected += 1;
        increment(rejectedCodes, 'SOURCE_PROFILE_CONFLICT');
      }
      continue;
    }
    sourceUsers.set(row.id.toLowerCase(), normalized);
    const current = destination.get(row.id.toLowerCase());
    if (current) {
      if (canonicalComparable(current) === canonicalComparable(normalized)) counts.duplicates += 1;
      else {
        counts.rejected += 1;
        increment(rejectedCodes, 'OWNER_PROFILE_CONFLICT');
      }
      continue;
    }
    const emailKey = normalized.email?.toLowerCase();
    const destinationEmailOwner = emailKey ? destinationEmails.get(emailKey) : undefined;
    const plannedEmailOwner = emailKey ? plannedEmails.get(emailKey) : undefined;
    if (
      (destinationEmailOwner && destinationEmailOwner !== row.id.toLowerCase()) ||
      (plannedEmailOwner && plannedEmailOwner !== row.id.toLowerCase())
    ) {
      counts.rejected += 1;
      increment(rejectedCodes, 'EMAIL_IN_USE');
      continue;
    }
    if (emailKey) plannedEmails.set(emailKey, row.id.toLowerCase());
    plan.push(normalized);
    counts.imported += 1;
  }
  plan.sort((a, b) => a.userId.localeCompare(b.userId));
  const checksumMaterial = plan.map((row) => ({
    ...row,
    avatarData: row.avatarData ? createHash('sha256').update(row.avatarData).digest('hex') : null,
  }));
  return {
    plan,
    counts,
    rejectedCodes: Object.fromEntries(
      [...rejectedCodes.entries()].sort(([a], [b]) => a.localeCompare(b)),
    ),
    checksum: createHash('sha256').update(canonical(checksumMaterial)).digest('hex'),
  };
}

async function main(args) {
  const apply = args.includes('--apply');
  const targetEnvironment = argument(args, '--target-environment');
  if (apply && !['development', 'test', 'staging', 'production'].includes(targetEnvironment)) {
    throw new Error('Apply requires --target-environment development|test|staging|production.');
  }
  if (apply && targetEnvironment === 'production') {
    if (!args.includes('--allow-production'))
      throw new Error(
        'Production apply requires --allow-production after the change review is approved.',
      );
    if (process.env.FUNTINO_ONE_SHOT_MIGRATION !== 'true')
      throw new Error(
        'Production apply requires FUNTINO_ONE_SHOT_MIGRATION=true in a one-shot migration environment.',
      );
  }
  const expectedChecksum = argument(args, '--confirm-checksum');
  if (apply && (!expectedChecksum || !/^[a-f0-9]{64}$/u.test(expectedChecksum))) {
    throw new Error('--confirm-checksum must be a SHA-256 hex value from the reviewed dry-run.');
  }

  const gatewayModule = await import('../../apps/api-gateway/generated/prisma/index.js');
  const householdModule = await import(
    '../../services/customer-household/generated/prisma/index.js'
  );
  const source = new gatewayModule.PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  const target = new householdModule.PrismaClient({
    datasourceUrl: process.env.CUSTOMER_HOUSEHOLD_MIGRATION_DATABASE_URL,
  });
  try {
    const sourceRows = await source.user.findMany({
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        birthDate: true,
        gender: true,
        city: true,
        avatarPreset: true,
        profileCompletedAt: true,
        avatar: { select: { mimeType: true, data: true, updatedAt: true } },
      },
      orderBy: { id: 'asc' },
    });
    const destinationRows = await target.customerProfile.findMany();
    const result = buildProfilePlan(sourceRows, destinationRows);
    if (expectedChecksum && expectedChecksum !== result.checksum) {
      throw new Error('Dry-run checksum changed; no rows were written.');
    }
    if (apply && result.counts.rejected > 0) {
      throw new Error(
        'Conflicting or invalid rows exist; resolve them before applying the backfill.',
      );
    }
    let inserted = 0;
    if (apply) {
      const batchSize = 250;
      for (let offset = 0; offset < result.plan.length; offset += batchSize) {
        const written = await target.customerProfile.createMany({
          data: result.plan.slice(offset, offset + batchSize),
          skipDuplicates: true,
        });
        inserted += written.count;
      }
    }
    const counts = { ...result.counts };
    if (apply) {
      counts.duplicates += counts.imported - inserted;
      counts.imported = inserted;
    }
    console.log(
      JSON.stringify(
        {
          mode: apply ? 'apply' : 'dry-run',
          targetEnvironment: targetEnvironment ?? null,
          databaseWritten: apply,
          counts,
          rejectedCodes: result.rejectedCodes,
          checksum: result.checksum,
        },
        null,
        2,
      ),
    );
  } finally {
    await Promise.all([source.$disconnect(), target.$disconnect()]);
  }
}

function normalizeProfile(row) {
  const gender = ['female', 'male', 'other', 'prefer_not_to_say'].includes(row.gender)
    ? row.gender
    : null;
  if (row.gender !== null && row.gender !== undefined && gender === null) return null;
  const avatar = row.avatar ?? null;
  return {
    userId: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    birthDate: row.birthDate,
    gender,
    city: row.city,
    avatarPreset: row.avatarPreset,
    avatarData: avatar?.data ?? null,
    avatarMimeType: avatar?.mimeType ?? null,
    avatarUpdatedAt: avatar?.updatedAt ?? null,
    profileCompletedAt: row.profileCompletedAt,
    version: 1,
  };
}

function canonicalComparable(row) {
  return canonical({
    userId: row.userId,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    birthDate: row.birthDate,
    gender: row.gender,
    city: row.city,
    avatarPreset: row.avatarPreset,
    avatarData: row.avatarData ? createHash('sha256').update(row.avatarData).digest('hex') : null,
    avatarMimeType: row.avatarMimeType,
    avatarUpdatedAt: row.avatarUpdatedAt,
    profileCompletedAt: row.profileCompletedAt,
  });
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value instanceof Uint8Array) return JSON.stringify(Buffer.from(value).toString('base64'));
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function increment(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}
function argument(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : 'Customer profile backfill failed.');
    process.exitCode = 1;
  });
}
