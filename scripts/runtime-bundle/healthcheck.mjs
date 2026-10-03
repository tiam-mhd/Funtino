import { connect } from 'node:net';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const ROOT = resolve(process.cwd());

function isWithinRoot(candidate) {
  const pathFromRoot = relative(ROOT, candidate);
  return pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot));
}

function checkPort(host, port, timeoutMs) {
  return new Promise((resolveResult) => {
    const socket = connect({ host, port });
    let settled = false;
    const finish = (healthy) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      resolveResult(healthy);
    };
    const timeout = setTimeout(() => finish(false), timeoutMs);

    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function main() {
  const manifestArgument = process.argv[2];
  if (!manifestArgument) {
    throw new Error('Pass the runtime process manifest path.');
  }

  const manifestPath = resolve(ROOT, manifestArgument);
  if (!isWithinRoot(manifestPath)) {
    throw new Error('Runtime manifest must be inside the deployment root.');
  }

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!Array.isArray(manifest.processes) || manifest.processes.length === 0) {
    throw new Error('Runtime manifest contains no process ports.');
  }

  const host = manifest.health?.host ?? '127.0.0.1';
  const timeoutMs = manifest.health?.connectionTimeoutMs ?? 1000;
  const results = await Promise.all(
    manifest.processes.map(async (entry) => ({
      name: entry.name,
      port: entry.port,
      healthy: await checkPort(host, entry.port, timeoutMs),
    })),
  );
  const unavailable = results.filter(({ healthy }) => !healthy);

  if (unavailable.length > 0) {
    process.stderr.write(
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        event: 'runtime.healthcheck_failed',
        bundle: manifest.bundle,
        unavailable: unavailable.map(({ name, port }) => ({ process: name, port })),
      })}\n`,
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      event: 'runtime.healthcheck_passed',
      bundle: manifest.bundle,
      processCount: results.length,
    })}\n`,
  );
}

void main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      event: 'runtime.healthcheck_configuration_failed',
      message: error instanceof Error ? error.message : 'Unknown healthcheck error.',
    })}\n`,
  );
  process.exitCode = 1;
});
