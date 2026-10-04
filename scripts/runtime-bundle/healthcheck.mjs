import { readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(process.cwd());

function isWithinRoot(candidate) {
  const pathFromRoot = relative(ROOT, candidate);
  return (
    pathFromRoot === '' ||
    (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot))
  );
}

export function isValidReadinessPath(path) {
  return (
    typeof path === 'string' &&
    path.startsWith('/') &&
    !path.startsWith('//') &&
    !/[?#\\\r\n]/.test(path)
  );
}

export function probeHttpReadiness({ host, port, path, timeoutMs }) {
  return new Promise((resolveProbe) => {
    let settled = false;
    let statusCode = null;
    let timeoutHandle;

    const finish = (healthy, causeCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      resolveProbe({
        healthy,
        ...(statusCode === null ? {} : { statusCode }),
        ...(causeCode ? { causeCode } : {}),
      });
    };

    const request = httpRequest(
      {
        hostname: host,
        port,
        path,
        method: 'GET',
        headers: { connection: 'close' },
      },
      (response) => {
        statusCode = response.statusCode ?? null;
        response.once('aborted', () => finish(false, 'HTTP_RESPONSE_ABORTED'));
        response.once('error', (error) => finish(false, error.code ?? 'HTTP_RESPONSE_FAILED'));
        response.once('end', () => {
          const healthy = statusCode !== null && statusCode >= 200 && statusCode < 400;
          finish(healthy, healthy ? undefined : 'HTTP_STATUS_NOT_READY');
        });
        response.resume();
      },
    );

    timeoutHandle = setTimeout(() => {
      const error = new Error('HTTP readiness probe exceeded its deadline.');
      error.code = 'ETIMEDOUT';
      request.destroy(error);
    }, timeoutMs);

    request.once('error', (error) => finish(false, error.code ?? 'HTTP_REQUEST_FAILED'));
    request.end();
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
  if (
    !manifest.health ||
    typeof manifest.health.host !== 'string' ||
    manifest.health.host.length === 0 ||
    !Number.isInteger(manifest.health.connectionTimeoutMs) ||
    manifest.health.connectionTimeoutMs < 100
  ) {
    throw new Error('Runtime manifest health readiness settings are invalid.');
  }
  for (const entry of manifest.processes) {
    if (!Number.isInteger(entry.port) || !isValidReadinessPath(entry.readinessPath)) {
      throw new Error(
        `Runtime manifest contains an invalid readiness definition for ${entry.name}.`,
      );
    }
  }

  const host = manifest.health?.host ?? '127.0.0.1';
  const timeoutMs = manifest.health.connectionTimeoutMs;
  const results = await Promise.all(
    manifest.processes.map(async (entry) => {
      const probe = await probeHttpReadiness({
        host,
        port: entry.port,
        path: entry.readinessPath,
        timeoutMs,
      });
      return {
        name: entry.name,
        port: entry.port,
        path: entry.readinessPath,
        ...probe,
      };
    }),
  );
  const unavailable = results.filter(({ healthy }) => !healthy);

  if (unavailable.length > 0) {
    process.stderr.write(
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        event: 'runtime.healthcheck_failed',
        bundle: manifest.bundle,
        unavailable: unavailable.map(({ name, port, path, statusCode, causeCode }) => ({
          process: name,
          port,
          path,
          ...(statusCode === undefined ? {} : { statusCode }),
          ...(causeCode ? { causeCode } : {}),
        })),
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

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
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
}
