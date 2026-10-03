import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  return pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot));
}

function assertEnvironmentKeys(keys, context) {
  if (!Array.isArray(keys) || keys.some((key) => typeof key !== 'string' || !ENV_KEY_PATTERN.test(key))) {
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
        logEvent('runtime.child_signal_failed', {
          process: child.runtimeName,
          signal,
          causeCode: error.code ?? 'UNKNOWN',
        }, process.stderr);
      }
    }
  }

  try {
    child.kill(signal);
  } catch (error) {
    if (error.code !== 'ESRCH') {
      logEvent('runtime.child_signal_failed', {
        process: child.runtimeName,
        signal,
        causeCode: error.code ?? 'UNKNOWN',
      }, process.stderr);
    }
  }
}

async function main() {
  let manifest;
  try {
    manifest = await readManifest(process.argv[2]);
  } catch (error) {
    logEvent('runtime.supervisor_configuration_failed', {
      message: error instanceof Error ? error.message : 'Unknown configuration error.',
    }, process.stderr);
    process.exitCode = 1;
    return;
  }

  let shutdownStarted = false;
  let supervisorExitCode = 1;
  let forceKillTimer;
  const children = [];
  const closePromises = [];
  const shutdownTimeoutMs = manifest.shutdownTimeoutMs;

  const beginShutdown = (exitCode, reason) => {
    if (shutdownStarted) {
      return;
    }

    shutdownStarted = true;
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

  for (const entry of manifest.processes) {
    const workingDirectory = resolve(RUNTIME_ROOT, entry.cwd);
    const child = spawn(process.execPath, entry.args, {
      cwd: workingDirectory,
      env: childEnvironment(manifest, entry),
      detached: process.platform !== 'win32',
      stdio: 'inherit',
    });
    child.runtimeName = entry.name;
    children.push(child);

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
            beginShutdown(exitCode === 0 ? 1 : exitCode ?? 1, `unexpected_exit:${entry.name}`);
          }
          resolveClose();
        };

        child.once('spawn', () => {
          logEvent('runtime.child_started', {
            process: entry.name,
            pid: child.pid,
            port: entry.port,
          });
        });
        child.once('error', (error) => {
          logEvent('runtime.child_spawn_failed', {
            process: entry.name,
            causeCode: error.code ?? 'UNKNOWN',
          }, process.stderr);
          beginShutdown(1, `spawn_failed:${entry.name}`);
        });
        child.once('close', close);
      }),
    );
  }

  logEvent('runtime.supervisor_started', {
    bundle: manifest.bundle,
    processCount: manifest.processes.length,
    ports: manifest.processes.map(({ port }) => port),
  });

  await Promise.all(closePromises);
  clearTimeout(forceKillTimer);

  for (const [signal, handler] of signalHandlers) {
    process.removeListener(signal, handler);
  }

  logEvent('runtime.supervisor_stopped', { exitCode: supervisorExitCode });
  process.exitCode = supervisorExitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  void main().catch((error) => {
    logEvent('runtime.supervisor_failed', {
      message: error instanceof Error ? error.message : 'Unknown supervisor failure.',
    }, process.stderr);
    process.exitCode = 1;
  });
}
