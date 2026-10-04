import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidReadinessPath, probeHttpReadiness } from './healthcheck.mjs';

const RUNTIME_ROOT = resolve(process.cwd());
const SYSTEM_ENV_KEYS = [
  'PATH',
  'HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'TZ',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
];
const ENV_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const SUPPORTED_SIGNALS = ['SIGINT', 'SIGTERM'];

function timestamp() {
  return new Date().toISOString();
}

function logEvent(event, fields = {}, stream = process.stdout) {
  stream.write(`${JSON.stringify({ timestamp: timestamp(), event, ...fields })}\n`);
}

function isWithinRoot(candidate) {
  const pathFromRoot = relative(RUNTIME_ROOT, candidate);
  return (
    pathFromRoot === '' ||
    (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot))
  );
}

function assertEnvironmentKeys(keys, context) {
  if (
    !Array.isArray(keys) ||
    keys.some((key) => typeof key !== 'string' || !ENV_KEY_PATTERN.test(key))
  ) {
    throw new Error(`Invalid environment allow-list for ${context}.`);
  }
}

async function readManifest(manifestArgument) {
  if (!manifestArgument) {
    throw new Error('Pass the runtime process manifest path.');
  }

  const manifestPath = resolve(RUNTIME_ROOT, manifestArgument);
  if (!isWithinRoot(manifestPath)) {
    throw new Error('Runtime manifest must be inside the deployment root.');
  }

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 1 || !['frontend', 'backend'].includes(manifest.bundle)) {
    throw new Error('Runtime manifest schema or bundle name is not supported.');
  }
  if (!Array.isArray(manifest.processes) || manifest.processes.length === 0) {
    throw new Error('Runtime manifest must define at least one process.');
  }
  if (!Number.isInteger(manifest.shutdownTimeoutMs) || manifest.shutdownTimeoutMs < 1000) {
    throw new Error('Runtime manifest shutdownTimeoutMs must be an integer of at least 1000.');
  }
  if (
    !manifest.health ||
    typeof manifest.health.host !== 'string' ||
    manifest.health.host.length === 0 ||
    !Number.isInteger(manifest.health.connectionTimeoutMs) ||
    manifest.health.connectionTimeoutMs < 100 ||
    !Number.isInteger(manifest.health.startupTimeoutMs) ||
    manifest.health.startupTimeoutMs < 1000 ||
    !Number.isInteger(manifest.health.retryIntervalMs) ||
    manifest.health.retryIntervalMs < 100
  ) {
    throw new Error('Runtime manifest health readiness settings are invalid.');
  }
  assertEnvironmentKeys(manifest.commonEnv ?? [], 'bundle');

  const ports = new Set();
  for (const entry of manifest.processes) {
    if (
      !entry ||
      typeof entry.name !== 'string' ||
      typeof entry.cwd !== 'string' ||
      !Array.isArray(entry.args) ||
      entry.args.length === 0 ||
      entry.args.some((argument) => typeof argument !== 'string') ||
      !Number.isInteger(entry.port) ||
      entry.port < 1 ||
      entry.port > 65535
    ) {
      throw new Error('Runtime manifest contains an invalid process definition.');
    }
    if (!isValidReadinessPath(entry.readinessPath)) {
      throw new Error(`Runtime manifest has an invalid readiness path for ${entry.name}.`);
    }
    if (
      entry.startupTimeoutMs !== undefined &&
      (!Number.isInteger(entry.startupTimeoutMs) || entry.startupTimeoutMs < 1000)
    ) {
      throw new Error(`Runtime manifest has an invalid startup timeout for ${entry.name}.`);
    }
    if (ports.has(entry.port)) {
      throw new Error(`Runtime manifest contains duplicate port ${entry.port}.`);
    }
    ports.add(entry.port);
    assertEnvironmentKeys(entry.env ?? [], entry.name);
    if (entry.portEnv !== undefined && !ENV_KEY_PATTERN.test(entry.portEnv)) {
      throw new Error(`Runtime manifest has an invalid port environment key for ${entry.name}.`);
    }

    const workingDirectory = resolve(RUNTIME_ROOT, entry.cwd);
    if (!isWithinRoot(workingDirectory)) {
      throw new Error(`Process working directory escapes the deployment root: ${entry.name}.`);
    }
  }

  return manifest;
}

function childEnvironment(manifest, entry) {
  const allowedKeys = new Set([
    ...SYSTEM_ENV_KEYS,
    ...(manifest.commonEnv ?? []),
    ...(entry.env ?? []),
  ]);
  const childEnv = {};

  for (const key of allowedKeys) {
    if (typeof process.env[key] === 'string') {
      childEnv[key] = process.env[key];
    }
  }

  childEnv.NODE_ENV ??= 'production';
  childEnv.APP_VERSION ??= 'unknown';
  childEnv.FUNTINO_RUNTIME_PROCESS = entry.name;

  if (entry.portEnv) {
    childEnv[entry.portEnv] = String(entry.port);
  }

  return childEnv;
}

function signalProcessTree(child, signal) {
  if (child.pid === undefined) {
    return;
  }

  if (process.platform !== 'win32') {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch (error) {
      if (error.code !== 'ESRCH') {
        logEvent(
          'runtime.child_signal_failed',
          {
            process: child.runtimeName,
            signal,
            causeCode: error.code ?? 'UNKNOWN',
          },
          process.stderr,
        );
      }
    }
  }

  try {
    child.kill(signal);
  } catch (error) {
    if (error.code !== 'ESRCH') {
      logEvent(
        'runtime.child_signal_failed',
        {
          process: child.runtimeName,
          signal,
          causeCode: error.code ?? 'UNKNOWN',
        },
        process.stderr,
      );
    }
  }
}

async function main() {
  let manifest;
  try {
    manifest = await readManifest(process.argv[2]);
  } catch (error) {
    logEvent(
      'runtime.supervisor_configuration_failed',
      {
        message: error instanceof Error ? error.message : 'Unknown configuration error.',
      },
      process.stderr,
    );
    process.exitCode = 1;
    return;
  }

  let shutdownStarted = false;
  let shutdownReason;
  let supervisorExitCode = 1;
  let forceKillTimer;
  const children = [];
  const closePromises = [];
  const shutdownTimeoutMs = manifest.shutdownTimeoutMs;
  const startupStartedAt = Date.now();

  const beginShutdown = (exitCode, reason) => {
    if (shutdownStarted) {
      return;
    }

    shutdownStarted = true;
    shutdownReason = reason;
    supervisorExitCode = exitCode;
    logEvent('runtime.supervisor_stopping', { reason, exitCode: supervisorExitCode });

    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        signalProcessTree(child, 'SIGTERM');
      }
    }

    forceKillTimer = setTimeout(() => {
      for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) {
          signalProcessTree(child, 'SIGKILL');
        }
      }
    }, shutdownTimeoutMs);
    forceKillTimer.unref();
  };

  const signalHandlers = new Map();
  for (const signal of SUPPORTED_SIGNALS) {
    const handler = () => {
      beginShutdown(signal === 'SIGTERM' ? 143 : 130, `parent_${signal.toLowerCase()}`);
    };
    signalHandlers.set(signal, handler);
    process.on(signal, handler);
  }

  const startChild = (entry, startupIndex) => {
    const workingDirectory = resolve(RUNTIME_ROOT, entry.cwd);
    const child = spawn(process.execPath, entry.args, {
      cwd: workingDirectory,
      env: childEnvironment(manifest, entry),
      detached: process.platform !== 'win32',
      stdio: 'inherit',
    });
    child.runtimeName = entry.name;
    children.push(child);

    let resolveSpawn;
    let rejectSpawn;
    const spawnPromise = new Promise((resolveSpawned, rejectSpawned) => {
      resolveSpawn = resolveSpawned;
      rejectSpawn = rejectSpawned;
    });

    closePromises.push(
      new Promise((resolveClose) => {
        let settled = false;
        const close = (exitCode, signal) => {
          if (settled) {
            return;
          }
          settled = true;
          logEvent('runtime.child_exited', {
            process: entry.name,
            pid: child.pid,
            exitCode,
            signal,
          });

          if (!shutdownStarted) {
            beginShutdown(exitCode === 0 ? 1 : (exitCode ?? 1), `unexpected_exit:${entry.name}`);
          }
          resolveClose();
        };

        child.once('spawn', () => {
          logEvent('runtime.child_started', {
            process: entry.name,
            pid: child.pid,
            port: entry.port,
            startupIndex,
          });
          if (shutdownStarted) signalProcessTree(child, 'SIGTERM');
          resolveSpawn();
        });
        child.once('error', (error) => {
          logEvent(
            'runtime.child_spawn_failed',
            {
              process: entry.name,
              causeCode: error.code ?? 'UNKNOWN',
            },
            process.stderr,
          );
          beginShutdown(1, `spawn_failed:${entry.name}`);
          rejectSpawn(error);
        });
        child.once('close', close);
      }),
    );

    return { child, spawnPromise };
  };

  const waitForChildReadiness = async (child, entry, startupIndex) => {
    const {
      host,
      connectionTimeoutMs,
      startupTimeoutMs: defaultStartupTimeoutMs,
      retryIntervalMs,
    } = manifest.health;
    const startupTimeoutMs = entry.startupTimeoutMs ?? defaultStartupTimeoutMs;
    const deadline = Date.now() + startupTimeoutMs;
    let lastProbe;

    logEvent('runtime.child_readiness_wait_started', {
      process: entry.name,
      port: entry.port,
      path: entry.readinessPath,
      startupIndex,
      timeoutMs: startupTimeoutMs,
    });

    while (!shutdownStarted) {
      if (child.exitCode !== null || child.signalCode !== null) {
        logEvent(
          'runtime.child_readiness_failed',
          {
            process: entry.name,
            port: entry.port,
            path: entry.readinessPath,
            reason: 'process_exited_before_ready',
            exitCode: child.exitCode,
            signal: child.signalCode,
          },
          process.stderr,
        );
        throw new Error(`Process ${entry.name} exited before readiness.`);
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;

      lastProbe = await probeHttpReadiness({
        host,
        port: entry.port,
        path: entry.readinessPath,
        timeoutMs: Math.max(1, Math.min(connectionTimeoutMs, remainingMs)),
      });

      if (lastProbe.healthy) {
        logEvent('runtime.child_ready', {
          process: entry.name,
          port: entry.port,
          path: entry.readinessPath,
          statusCode: lastProbe.statusCode,
          startupIndex,
          elapsedMs: Date.now() - (deadline - startupTimeoutMs),
        });
        return;
      }

      const waitMs = Math.min(retryIntervalMs, Math.max(0, deadline - Date.now()));
      if (waitMs > 0) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, waitMs));
      }
    }

    if (shutdownStarted) {
      throw new Error(`Readiness wait for ${entry.name} was cancelled during shutdown.`);
    }

    logEvent(
      'runtime.child_readiness_failed',
      {
        process: entry.name,
        port: entry.port,
        path: entry.readinessPath,
        reason: 'timeout',
        timeoutMs: startupTimeoutMs,
        ...(lastProbe?.statusCode === undefined ? {} : { lastStatusCode: lastProbe.statusCode }),
        ...(lastProbe?.causeCode ? { causeCode: lastProbe.causeCode } : {}),
      },
      process.stderr,
    );
    const error = new Error(
      `Process ${entry.name} did not become ready within ${startupTimeoutMs} ms.`,
    );
    error.code = 'PROCESS_READINESS_TIMEOUT';
    throw error;
  };

  logEvent('runtime.supervisor_startup_started', {
    bundle: manifest.bundle,
    processCount: manifest.processes.length,
    startupTimeoutMs: manifest.health.startupTimeoutMs,
  });

  let startupCompleted = false;
  let startupFailureLogged = false;
  for (const [index, entry] of manifest.processes.entries()) {
    if (shutdownStarted) break;

    const startupIndex = index + 1;
    const { child, spawnPromise } = startChild(entry, startupIndex);
    try {
      await spawnPromise;
      if (shutdownStarted) break;
      await waitForChildReadiness(child, entry, startupIndex);
    } catch (error) {
      if (!shutdownReason?.startsWith('parent_') && !startupFailureLogged) {
        logEvent(
          'runtime.supervisor_startup_failed',
          {
            bundle: manifest.bundle,
            process: entry.name,
            startupIndex,
            causeCode: error?.code ?? 'PROCESS_STARTUP_FAILED',
          },
          process.stderr,
        );
        startupFailureLogged = true;
      }
      if (!shutdownStarted) {
        beginShutdown(1, `startup_failed:${entry.name}`);
      }
      break;
    }
  }

  if (!shutdownStarted && children.length === manifest.processes.length) {
    startupCompleted = true;
    logEvent('runtime.supervisor_started', {
      bundle: manifest.bundle,
      processCount: manifest.processes.length,
      ports: manifest.processes.map(({ port }) => port),
      startupOrder: manifest.processes.map(({ name }) => name),
      startupElapsedMs: Date.now() - startupStartedAt,
    });
  }

  await Promise.all(closePromises);
  clearTimeout(forceKillTimer);

  for (const [signal, handler] of signalHandlers) {
    process.removeListener(signal, handler);
  }

  logEvent('runtime.supervisor_stopped', {
    exitCode: supervisorExitCode,
    startupCompleted,
    ...(shutdownReason ? { reason: shutdownReason } : {}),
  });
  process.exitCode = supervisorExitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  void main().catch((error) => {
    logEvent(
      'runtime.supervisor_failed',
      {
        message: error instanceof Error ? error.message : 'Unknown supervisor failure.',
      },
      process.stderr,
    );
    process.exitCode = 1;
  });
}
