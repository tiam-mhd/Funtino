import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MigrationCommandError,
  WORKERS,
  migrationCommandEnvironment,
  redactMigrationOutput,
  runPrismaCommand,
  runStartupMigrations,
  startBehindMigrationGate,
  validateMigrationEnvironment,
} from './worker-startup.mjs';

function environmentFor(service) {
  const { schema, runtimeUrlKey, migrationUrlKey } = WORKERS[service];
  return {
    [runtimeUrlKey]: `postgresql://runtime:runtime-test-password@runtime-db:5432/funtino_test?schema=${schema}`,
    [migrationUrlKey]: `postgresql://migration:migration-test-password@ddl-db:5432/funtino_test?schema=${schema}`,
  };
}

test('validates the database and owner schema for each of the five workers', () => {
  for (const [service, config] of Object.entries(WORKERS)) {
    const result = validateMigrationEnvironment(service, environmentFor(service));
    assert.equal(result.schema, config.schema);
    assert.equal(result.runtimeUrlKey, config.runtimeUrlKey);
    assert.equal(result.migrationUrlKey, config.migrationUrlKey);
  }
});

test('fails with the exact missing variable name without exposing a connection URL', () => {
  assert.throws(
    () => validateMigrationEnvironment('identity-access', {}),
    (error) => {
      assert.equal(error.code, 'DATABASE_URL_REQUIRED');
      assert.match(error.message, /IDENTITY_ACCESS_DATABASE_URL/);
      assert.doesNotMatch(error.message, /postgres(?:ql)?:\/\//);
      return true;
    },
  );
});

test('fails closed if runtime and migration URLs target different databases or schemas', () => {
  const differentDatabase = environmentFor('wallet');
  differentDatabase.WALLET_MIGRATION_DATABASE_URL =
    'postgresql://migration:secret@ddl-db:5432/other_db?schema=wallet';
  assert.throws(() => validateMigrationEnvironment('wallet', differentDatabase), {
    code: 'DATABASE_TARGET_MISMATCH',
  });

  const wrongSchema = environmentFor('analytics-read-model');
  wrongSchema.ANALYTICS_MIGRATION_DATABASE_URL =
    'postgresql://migration:secret@ddl-db:5432/funtino_test?schema=public';
  assert.throws(() => validateMigrationEnvironment('analytics-read-model', wrongSchema), {
    code: 'DATABASE_SCHEMA_MISMATCH',
  });
});

test('uses the existing public schema for bootstrap without changing the database target', () => {
  const env = environmentFor('wallet');
  env.WALLET_MIGRATION_DATABASE_URL += '&connect_timeout=0&application_name=funtino-test';

  const commandEnv = migrationCommandEnvironment('wallet', env, {
    phase: 'create_schema',
    socketTimeoutSeconds: 30,
  });
  const original = new URL(env.WALLET_MIGRATION_DATABASE_URL);
  const bounded = new URL(commandEnv.WALLET_MIGRATION_DATABASE_URL);

  assert.equal(commandEnv.WALLET_DATABASE_URL, env.WALLET_DATABASE_URL);
  assert.equal(bounded.hostname, original.hostname);
  assert.equal(bounded.port, original.port);
  assert.equal(bounded.pathname, original.pathname);
  assert.equal(bounded.searchParams.get('schema'), 'public');
  assert.equal(bounded.searchParams.get('application_name'), 'funtino-test');
  assert.equal(bounded.searchParams.get('connect_timeout'), '5');
  assert.equal(bounded.searchParams.get('socket_timeout'), '30');
  assert.equal(bounded.password, original.password);

  const migrationEnv = migrationCommandEnvironment('wallet', env, {
    phase: 'apply_pending_migrations',
  });
  const migrationUrl = new URL(migrationEnv.WALLET_MIGRATION_DATABASE_URL);
  assert.equal(migrationUrl.searchParams.get('schema'), 'wallet');
  assert.equal(migrationUrl.searchParams.get('connect_timeout'), '5');
  assert.equal(migrationUrl.searchParams.has('socket_timeout'), false);
});

test('configures public as the bootstrap schema for every startup-migrated worker', () => {
  for (const service of Object.keys(WORKERS)) {
    const env = environmentFor(service);
    const { migrationUrlKey } = WORKERS[service];
    const original = new URL(env[migrationUrlKey]);
    const bootstrap = new URL(
      migrationCommandEnvironment(service, env, { phase: 'create_schema' })[migrationUrlKey],
    );

    assert.equal(bootstrap.searchParams.get('schema'), 'public');
    assert.equal(bootstrap.hostname, original.hostname);
    assert.equal(bootstrap.port, original.port);
    assert.equal(bootstrap.pathname, original.pathname);
    assert.equal(bootstrap.username, original.username);
    assert.equal(bootstrap.password, original.password);
  }
});

test('redacts database URLs and configured secrets but preserves Prisma and PostgreSQL codes', () => {
  const env = {
    WALLET_DATABASE_URL:
      'postgresql://runtime:private-db-password@db.internal:5432/funtino?schema=wallet',
    WALLET_SERVICE_TOKEN: 'wallet-service-token-test-value',
  };
  const output = redactMigrationOutput(
    'P2010 SQLSTATE 42P01 relation missing; connect postgresql://runtime:private-db-password@db.internal:5432/funtino; token=wallet-service-token-test-value',
    env,
  );

  assert.match(output, /P2010/);
  assert.match(output, /42P01/);
  assert.doesNotMatch(
    output,
    /private-db-password|db\.internal|wallet-service-token-test-value|postgresql:\/\//,
  );
  assert.match(output, /URL_REDACTED/);
});

test('runs only idempotent schema bootstrap and pending versioned migrations, in order', async () => {
  const calls = [];
  const events = [];
  const env = environmentFor('wallet');
  const runCommand = async (args, options) => {
    calls.push({ args, options });
    return { exitCode: 0, signal: null };
  };
  const writeEvent = (event, fields) => events.push({ event, ...fields });

  await runStartupMigrations('wallet', { env, runCommand, writeEvent });
  await runStartupMigrations('wallet', { env, runCommand, writeEvent });

  assert.equal(calls.length, 4);
  assert.deepEqual(calls[0].args, [
    'exec',
    'prisma',
    'db',
    'execute',
    '--schema',
    'prisma/bootstrap.prisma',
    '--file',
    'prisma/bootstrap.sql',
  ]);
  assert.deepEqual(calls[1].args, [
    'exec',
    'prisma',
    'migrate',
    'deploy',
    '--schema',
    'prisma/schema.prisma',
  ]);
  assert.equal(calls[0].options.timeoutMs, 30_000);
  assert.equal(
    new URL(calls[0].options.env.WALLET_MIGRATION_DATABASE_URL).searchParams.get('schema'),
    'public',
  );
  assert.equal(
    calls[0].options.env.WALLET_MIGRATION_DATABASE_URL.includes('socket_timeout=20'),
    true,
  );
  assert.equal(calls[1].options.timeoutMs, 120_000);
  assert.equal(
    new URL(calls[1].options.env.WALLET_MIGRATION_DATABASE_URL).searchParams.get('schema'),
    'wallet',
  );
  assert.equal(
    calls[1].options.env.WALLET_MIGRATION_DATABASE_URL.includes('socket_timeout'),
    false,
  );
  assert.ok(calls.flatMap(({ args }) => args).every((arg) => arg !== 'reset' && arg !== 'push'));
  assert.equal(events.filter(({ event }) => event === 'service.migration.completed').length, 4);
});

test('bootstrap-only command prepares the owner schema without running migrations', async () => {
  const calls = [];
  await runStartupMigrations('wallet', {
    env: environmentFor('wallet'),
    bootstrapOnly: true,
    runCommand: async (args, options) => {
      calls.push({ args, options });
      return { exitCode: 0, signal: null };
    },
    writeEvent: () => {},
  });

  assert.equal(calls.length, 1);
  assert.ok(calls[0].args.includes('prisma/bootstrap.prisma'));
  assert.equal(
    new URL(calls[0].options.env.WALLET_MIGRATION_DATABASE_URL).searchParams.get('schema'),
    'public',
  );
});

test('stops before the second migration or application start when the first command fails', async () => {
  const calls = [];
  let applicationStarted = false;

  await assert.rejects(
    startBehindMigrationGate({
      service: 'customer-household',
      env: environmentFor('customer-household'),
      migrate: () =>
        runStartupMigrations('customer-household', {
          env: environmentFor('customer-household'),
          runCommand: async (args) => {
            calls.push(args);
            return { exitCode: 1, signal: null };
          },
          writeEvent: () => undefined,
        }),
      startApplication: () => {
        applicationStarted = true;
      },
    }),
    (error) => error instanceof MigrationCommandError && error.phase === 'create_schema',
  );

  assert.equal(calls.length, 1);
  assert.equal(applicationStarted, false);
});

test('reports a bounded command timeout and fails closed before application start', async () => {
  const events = [];
  await assert.rejects(
    runStartupMigrations('identity-access', {
      env: environmentFor('identity-access'),
      runCommand: async (_args, { timeoutMs }) => ({
        exitCode: null,
        signal: 'SIGTERM',
        timedOut: true,
        timeoutMs,
        elapsedMs: timeoutMs,
      }),
      writeEvent: (event, fields) => events.push({ event, ...fields }),
    }),
    (error) => {
      assert.equal(error.code, 'MIGRATION_COMMAND_TIMEOUT');
      assert.equal(error.phase, 'create_schema');
      assert.match(error.message, /30000 ms deadline/);
      return true;
    },
  );

  assert.deepEqual(
    events.filter(({ event }) => event === 'service.migration.failed'),
    [
      {
        event: 'service.migration.failed',
        service: 'identity-access',
        phase: 'create_schema',
        causeCode: 'MIGRATION_COMMAND_TIMEOUT',
        signal: 'SIGTERM',
        elapsedMs: 30_000,
        timeoutMs: 30_000,
      },
    ],
  );
});

test('terminates and reports a Prisma command that does not complete before its deadline', async () => {
  const events = [];
  const result = await runPrismaCommand(['-e', 'setInterval(() => {}, 1000)'], {
    command: process.execPath,
    env: process.env,
    service: 'test-worker',
    phase: 'create_schema',
    timeoutMs: 250,
    writeEvent: (event, fields) => events.push({ event, ...fields }),
  });

  assert.equal(result.timedOut, true);
  assert.equal(result.timeoutMs, 250);
  assert.ok(result.elapsedMs >= 200);
  assert.ok(events.some(({ event }) => event === 'service.migration.process.started'));
  assert.ok(events.some(({ event }) => event === 'service.migration.process.timed_out'));
});

test('starts the application only after both migration phases succeed', async () => {
  const order = [];
  await startBehindMigrationGate({
    service: 'organization-branch',
    env: environmentFor('organization-branch'),
    migrate: async () => order.push('migrations-complete'),
    startApplication: () => order.push('application-started'),
  });

  assert.deepEqual(order, ['migrations-complete', 'application-started']);
});
