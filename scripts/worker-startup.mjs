import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const WORKERS = Object.freeze({
  'identity-access': {
    schema: 'identity_access',
    runtimeUrlKey: 'IDENTITY_ACCESS_DATABASE_URL',
    migrationUrlKey: 'IDENTITY_ACCESS_MIGRATION_DATABASE_URL',
  },
  'organization-branch': {
    schema: 'organization_branch',
    runtimeUrlKey: 'ORGANIZATION_BRANCH_DATABASE_URL',
    migrationUrlKey: 'ORGANIZATION_BRANCH_MIGRATION_DATABASE_URL',
  },
  'customer-household': {
    schema: 'customer_household',
    runtimeUrlKey: 'CUSTOMER_HOUSEHOLD_DATABASE_URL',
    migrationUrlKey: 'CUSTOMER_HOUSEHOLD_MIGRATION_DATABASE_URL',
  },
  wallet: {
    schema: 'wallet',
    runtimeUrlKey: 'WALLET_DATABASE_URL',
    migrationUrlKey: 'WALLET_MIGRATION_DATABASE_URL',
  },
  'analytics-read-model': {
    schema: 'analytics_read_model',
    runtimeUrlKey: 'ANALYTICS_DATABASE_URL',
    migrationUrlKey: 'ANALYTICS_MIGRATION_DATABASE_URL',
  },
});

const MIGRATION_STEPS = [
  {
    phase: 'create_schema',
    timeoutMs: 30_000,
    socketTimeoutSeconds: 20,
    args: [
      'exec',
      'prisma',
      'db',
      'execute',
      '--schema',
      'prisma/schema.prisma',
      '--file',
      'prisma/bootstrap.sql',
    ],
  },
  {
    phase: 'apply_pending_migrations',
    timeoutMs: 120_000,
    socketTimeoutSeconds: undefined,
    args: ['exec', 'prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
  },
];

const DATABASE_CONNECT_TIMEOUT_SECONDS = 5;
const MIGRATION_PROGRESS_INTERVAL_MS = 15_000;

export class WorkerStartupError extends Error {
  constructor(code, stage, message) {
    super(message);
    this.name = 'WorkerStartupError';
    this.code = code;
    this.stage = stage;
  }
}

export class MigrationCommandError extends Error {
  constructor(phase, result) {
    super(
      result.timedOut
        ? `Prisma migration phase "${phase}" exceeded its ${result.timeoutMs} ms deadline.`
        : `Prisma migration phase "${phase}" did not complete successfully.`,
    );
    this.name = 'MigrationCommandError';
    this.code = result.timedOut ? 'MIGRATION_COMMAND_TIMEOUT' : 'MIGRATION_COMMAND_FAILED';
    this.phase = phase;
    this.result = result;
  }
}

export function getWorkerConfig(service) {
  return WORKERS[service];
}

export function validateMigrationEnvironment(service, env = process.env) {
  const config = getWorkerConfig(service);
  if (!config) {
    throw new WorkerStartupError(
      'UNKNOWN_WORKER',
      'resolve_worker',
      'Worker name is not supported.',
    );
  }

  const runtimeUrl = parseDatabaseUrl(
    config.runtimeUrlKey,
    config.schema,
    env[config.runtimeUrlKey],
  );
  const migrationUrl = parseDatabaseUrl(
    config.migrationUrlKey,
    config.schema,
    env[config.migrationUrlKey],
  );

  if (databaseName(runtimeUrl) !== databaseName(migrationUrl)) {
    throw new WorkerStartupError(
      'DATABASE_TARGET_MISMATCH',
      'validate_database_configuration',
      `${config.runtimeUrlKey} and ${config.migrationUrlKey} must point to the same database.`,
    );
  }

  return {
    schema: config.schema,
    runtimeUrlKey: config.runtimeUrlKey,
    migrationUrlKey: config.migrationUrlKey,
  };
}

export function migrationCommandEnvironment(service, env = process.env, step) {
  const config = getWorkerConfig(service);
  if (!config) {
    throw new WorkerStartupError(
      'UNKNOWN_WORKER',
      'resolve_worker',
      'Worker name is not supported.',
    );
  }

  const migrationUrl = parseDatabaseUrl(
    config.migrationUrlKey,
    config.schema,
    env[config.migrationUrlKey],
  );
  migrationUrl.searchParams.set('connect_timeout', String(DATABASE_CONNECT_TIMEOUT_SECONDS));
  if (step.socketTimeoutSeconds) {
    migrationUrl.searchParams.set('socket_timeout', String(step.socketTimeoutSeconds));
  }

  return { ...env, [config.migrationUrlKey]: migrationUrl.toString() };
}

function parseDatabaseUrl(key, expectedSchema, value) {
  if (!value) {
    throw new WorkerStartupError(
      'DATABASE_URL_REQUIRED',
      'validate_database_configuration',
      `${key} is required before the worker can start.`,
    );
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new WorkerStartupError(
      'DATABASE_URL_INVALID',
      'validate_database_configuration',
      `${key} must be a valid PostgreSQL connection URL.`,
    );
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new WorkerStartupError(
      'DATABASE_URL_PROTOCOL_INVALID',
      'validate_database_configuration',
      `${key} must use the PostgreSQL protocol.`,
    );
  }

  if (!url.hostname || !databaseName(url)) {
    throw new WorkerStartupError(
      'DATABASE_URL_TARGET_INCOMPLETE',
      'validate_database_configuration',
      `${key} must include a PostgreSQL host and database name.`,
    );
  }

  if (url.searchParams.get('schema') !== expectedSchema) {
    throw new WorkerStartupError(
      'DATABASE_SCHEMA_MISMATCH',
      'validate_database_configuration',
      `${key} must set the schema query parameter to "${expectedSchema}".`,
    );
  }

  return url;
}

function databaseName(url) {
  try {
    return decodeURIComponent(url.pathname.replace(/^\/+/, '')) || undefined;
  } catch {
    return undefined;
  }
}

export function redactMigrationOutput(value, env = process.env) {
  let safeValue = value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
  const secrets = Object.entries(env)
    .filter(
      ([key, secret]) =>
        typeof secret === 'string' &&
        secret.length >= 4 &&
        /(?:URL|TOKEN|SECRET|PASSWORD|KEYS?)$/i.test(key),
    )
    .map(([, secret]) => secret)
    .sort((left, right) => right.length - left.length);

  for (const secret of secrets) safeValue = safeValue.split(secret).join('[REDACTED]');

  return safeValue
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, '[URL_REDACTED]')
    .replace(/\b(bearer|basic)\s+\S+/gi, '$1 [REDACTED]')
    .replace(/\b(password|token|secret|authorization)\s*[:=]\s*[^,\s;]+/gi, '$1=[REDACTED]');
}

export async function runStartupMigrations(service, options = {}) {
  const runCommand = options.runCommand ?? runPrismaCommand;
  const writeEvent = options.writeEvent ?? logEvent;
  const env = options.env ?? process.env;

  for (const step of MIGRATION_STEPS) {
    const { phase, args, timeoutMs } = step;
    const commandEnv = migrationCommandEnvironment(service, env, step);
    writeEvent('service.migration.started', { service, phase, timeoutMs });
    const result = await runCommand(args, {
      service,
      phase,
      env: commandEnv,
      timeoutMs,
      writeEvent,
    });

    if (result.exitCode !== 0 || result.signal || result.spawnErrorCode) {
      writeEvent('service.migration.failed', {
        service,
        phase,
        ...(result.timedOut ? { causeCode: 'MIGRATION_COMMAND_TIMEOUT' } : {}),
        ...(result.exitCode !== null ? { exitCode: result.exitCode } : {}),
        ...(result.signal ? { signal: result.signal } : {}),
        ...(result.spawnErrorCode ? { causeCode: result.spawnErrorCode } : {}),
        ...(result.elapsedMs !== undefined ? { elapsedMs: result.elapsedMs } : {}),
        ...(result.timeoutMs !== undefined ? { timeoutMs: result.timeoutMs } : {}),
      });
      throw new MigrationCommandError(phase, result);
    }

    writeEvent('service.migration.completed', { service, phase });
  }
}

export async function startBehindMigrationGate({ service, env, migrate, startApplication }) {
  validateMigrationEnvironment(service, env);
  await migrate();
  return startApplication();
}

export function runPrismaCommand(args, options = {}) {
  const {
    service = process.env.FUNTINO_WORKER_NAME ?? 'unknown',
    phase = 'unknown',
    env = process.env,
    timeoutMs = 45_000,
    writeEvent = logEvent,
    command = 'pnpm',
  } = options;

  return new Promise((resolveResult) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const removeSignalHandlers = forwardParentSignals(child);
    let timedOut = false;
    let timeoutHandle;
    let forceKillHandle;
    const progressHandle = setInterval(() => {
      writeEvent('service.migration.process.waiting', {
        service,
        phase,
        elapsedMs: Date.now() - startedAt,
        timeoutMs,
      });
    }, MIGRATION_PROGRESS_INTERVAL_MS);

    const forward = (stream, target) => {
      const lines = createInterface({ input: stream, crlfDelay: Infinity });
      lines.on('line', (line) => target.write(`${redactMigrationOutput(line, env)}\n`));
    };

    if (child.stdout) forward(child.stdout, process.stdout);
    if (child.stderr) forward(child.stderr, process.stderr);

    timeoutHandle = setTimeout(() => {
      timedOut = true;
      writeEvent('service.migration.process.timed_out', {
        service,
        phase,
        elapsedMs: Date.now() - startedAt,
        timeoutMs,
      });
      signalProcessTree(child, 'SIGTERM');
      forceKillHandle = setTimeout(() => signalProcessTree(child, 'SIGKILL'), 5_000);
    }, timeoutMs);

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearInterval(progressHandle);
      clearTimeout(timeoutHandle);
      clearTimeout(forceKillHandle);
      removeSignalHandlers();
      resolveResult({
        ...result,
        elapsedMs: Date.now() - startedAt,
        ...(timedOut ? { timedOut: true, timeoutMs } : {}),
      });
    };

    child.once('spawn', () => {
      writeEvent('service.migration.process.started', {
        service,
        phase,
        processId: child.pid,
        timeoutMs,
      });
    });

    child.once('error', (error) => {
      finish({
        exitCode: null,
        signal: null,
        ...(error.code ? { spawnErrorCode: error.code } : {}),
      });
    });
    child.once('close', (exitCode, signal) => finish({ exitCode, signal }));
  });
}

function signalProcessTree(child, signal) {
  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch (error) {
      if (error.code === 'ESRCH') return false;
    }
  }

  try {
    return child.kill(signal);
  } catch {
    return false;
  }
}

function forwardParentSignals(child) {
  const signals = ['SIGINT', 'SIGTERM'];
  const handlers = new Map();

  for (const signal of signals) {
    const handler = () => signalProcessTree(child, signal);
    handlers.set(signal, handler);
    process.on(signal, handler);
  }

  return () => {
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
  };
}

function logEvent(event, fields) {
  process.stdout.write(
    `${JSON.stringify({ timestamp: new Date().toISOString(), event, ...fields })}\n`,
  );
}

function reportFailure(service, error) {
  const candidate = error instanceof Error ? error : new Error('Unknown worker startup failure.');
  const migrationError = error instanceof MigrationCommandError ? error : undefined;
  const startupError = error instanceof WorkerStartupError ? error : undefined;
  const stage = startupError?.stage ?? migrationError?.phase ?? 'start_application';

  process.stderr.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'fatal',
      event: 'service.startup_failed',
      service,
      stage,
      error: {
        name: candidate.name,
        code: startupError?.code ?? migrationError?.code ?? 'APPLICATION_START_FAILED',
        ...(migrationError?.result.exitCode !== null &&
        migrationError?.result.exitCode !== undefined
          ? { exitCode: migrationError.result.exitCode }
          : {}),
        ...(migrationError?.result.signal ? { signal: migrationError.result.signal } : {}),
        ...(migrationError?.result.timedOut ? { timeoutMs: migrationError.result.timeoutMs } : {}),
        ...(migrationError?.result.elapsedMs !== undefined
          ? { elapsedMs: migrationError.result.elapsedMs }
          : {}),
        ...(migrationError?.result.spawnErrorCode
          ? { causeCode: migrationError.result.spawnErrorCode }
          : migrationError?.result.timedOut
            ? { causeCode: 'MIGRATION_COMMAND_TIMEOUT' }
            : {}),
        message: redactMigrationOutput(candidate.message),
      },
    })}\n`,
  );
}

function launchApplication(args) {
  return new Promise((resolveApplication, rejectApplication) => {
    const child = spawn(process.execPath, args.length ? args : ['dist/main.js'], {
      cwd: process.cwd(),
      env: process.env,
      detached: process.platform !== 'win32',
      stdio: 'inherit',
    });
    const removeSignalHandlers = forwardParentSignals(child);
    child.once('spawn', () =>
      logEvent('service.application.started', { service: process.env.FUNTINO_WORKER_NAME }),
    );
    child.once('error', (error) => {
      removeSignalHandlers();
      rejectApplication(
        new WorkerStartupError(
          'APPLICATION_START_FAILED',
          'start_application',
          `Application process could not start${error.code ? ` (${error.code})` : ''}.`,
        ),
      );
    });
    child.once('close', (exitCode) => {
      removeSignalHandlers();
      process.exitCode = exitCode ?? 1;
      resolveApplication();
    });
  });
}

async function main() {
  const [service, ...applicationArgs] = process.argv.slice(2);
  if (!getWorkerConfig(service)) {
    reportFailure(
      'unknown',
      new WorkerStartupError('UNKNOWN_WORKER', 'resolve_worker', 'Pass one supported worker name.'),
    );
    process.exitCode = 1;
    return;
  }

  process.env.FUNTINO_WORKER_NAME = service;
  try {
    process.chdir(resolve(REPOSITORY_ROOT, 'services', service));
    logEvent('service.startup.started', { service });
    await startBehindMigrationGate({
      service,
      env: process.env,
      migrate: () => runStartupMigrations(service),
      startApplication: () => launchApplication(applicationArgs),
    });
  } catch (error) {
    reportFailure(service, error);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
