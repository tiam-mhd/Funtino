import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const SOURCE_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const SUPERVISOR_PATH = join(SOURCE_ROOT, 'scripts/runtime-bundle/supervisor.mjs');
const HEALTHCHECK_PATH = join(SOURCE_ROOT, 'scripts/runtime-bundle/healthcheck.mjs');

const readinessServer = `
const http = require('node:http');
const readyAt = Date.now() + (process.env.FUNTINO_RUNTIME_PROCESS === 'first' ? 350 : 0);
const server = http.createServer((request, response) => {
  if (request.url !== '/health/ready') {
    response.statusCode = 404;
    response.end();
    return;
  }
  if (Date.now() < readyAt) {
    response.statusCode = 503;
    response.end('starting');
    return;
  }
  response.statusCode = 200;
  response.end('ready');
});
server.listen(Number(process.env.FUNTINO_TEST_PORT), '0.0.0.0');
setTimeout(() => process.exit(0), 1800);
`;

async function getFreePort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const port = server.address().port;
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
  return port;
}

function parseEvents(output) {
  return output.split(/\r?\n/).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

async function waitForEvent(run, eventName, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = parseEvents(run.output);
    if (events.some(({ event }) => event === eventName)) return events;
    if (run.child.exitCode !== null) {
      throw new Error(`Supervisor exited before ${eventName}:\n${run.output}`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  }
  throw new Error(`Timed out waiting for ${eventName}:\n${run.output}`);
}

async function createSupervisorRun(t, manifest) {
  const temporaryDirectory = await mkdtemp(join(SOURCE_ROOT, '.runtime-supervisor-test-'));
  const relativeDirectory = relative(SOURCE_ROOT, temporaryDirectory);
  if (
    !relativeDirectory ||
    relativeDirectory === '..' ||
    relativeDirectory.startsWith(`..${sep}`) ||
    isAbsolute(relativeDirectory)
  ) {
    throw new Error('Supervisor test directory must stay inside the source repository.');
  }

  const manifestPath = join(temporaryDirectory, 'processes.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const manifestArgument = relative(SOURCE_ROOT, manifestPath);
  const child = spawn(process.execPath, [SUPERVISOR_PATH, manifestArgument], {
    cwd: SOURCE_ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const run = { child, output: '', manifestArgument };
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    run.output += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk) => {
    run.output += chunk;
  });

  t.after(async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([
        once(child, 'close'),
        new Promise((resolveDelay) => setTimeout(resolveDelay, 5000)),
      ]);
      if (child.exitCode === null) child.kill();
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  return run;
}

function manifestFor(processes, startupTimeoutMs) {
  return {
    schemaVersion: 1,
    bundle: 'backend',
    shutdownTimeoutMs: 2000,
    health: {
      host: '127.0.0.1',
      connectionTimeoutMs: 100,
      startupTimeoutMs,
      retryIntervalMs: 100,
    },
    commonEnv: ['NODE_ENV'],
    processes,
  };
}

function testProcess(name, port, args, readinessPath = '/health/ready') {
  return {
    name,
    cwd: '.',
    args,
    port,
    portEnv: 'FUNTINO_TEST_PORT',
    readinessPath,
    env: [],
  };
}

test('starts the next child only after the previous HTTP readiness check succeeds', async (t) => {
  const ports = [await getFreePort(), await getFreePort()];
  const run = await createSupervisorRun(
    t,
    manifestFor(
      [
        testProcess('first', ports[0], ['-e', readinessServer]),
        testProcess('second', ports[1], ['-e', readinessServer]),
      ],
      3000,
    ),
  );

  const events = await waitForEvent(run, 'runtime.supervisor_started', 10000);
  const firstReadyIndex = events.findIndex(
    ({ event, process: processName }) => event === 'runtime.child_ready' && processName === 'first',
  );
  const secondStartedIndex = events.findIndex(
    ({ event, process: processName }) =>
      event === 'runtime.child_started' && processName === 'second',
  );

  assert.notEqual(firstReadyIndex, -1);
  assert.notEqual(secondStartedIndex, -1);
  assert.ok(
    firstReadyIndex < secondStartedIndex,
    'second child started before first child readiness',
  );
  assert.equal(events.filter(({ event }) => event === 'runtime.child_ready').length, 2);

  const healthcheck = spawnSync(process.execPath, [HEALTHCHECK_PATH, run.manifestArgument], {
    cwd: SOURCE_ROOT,
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(healthcheck.status, 0, `${healthcheck.stdout}\n${healthcheck.stderr}`);
  assert.match(healthcheck.stdout, /runtime\.healthcheck_passed/);

  await once(run.child, 'close');
  assert.equal(run.child.exitCode, 1, 'an unexpected child exit must fail the complete bundle');
});

test('fails startup and does not spawn later children when readiness times out', async (t) => {
  const ports = [await getFreePort(), await getFreePort()];
  const run = await createSupervisorRun(
    t,
    manifestFor(
      [
        testProcess('never-ready', ports[0], ['-e', 'setInterval(() => {}, 1000)']),
        testProcess('must-not-start', ports[1], ['-e', readinessServer]),
      ],
      1500,
    ),
  );

  await once(run.child, 'close');
  const events = parseEvents(run.output);
  assert.equal(run.child.exitCode, 1);
  assert.ok(
    events.some(
      ({ event, process: processName, reason }) =>
        event === 'runtime.child_readiness_failed' &&
        processName === 'never-ready' &&
        reason === 'timeout',
    ),
  );
  assert.ok(
    !events.some(
      ({ event, process: processName }) =>
        event === 'runtime.child_started' && processName === 'must-not-start',
    ),
  );
});
