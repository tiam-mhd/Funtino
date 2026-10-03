import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

function connectionFromEnvironment(name) {
  const raw = process.env[name];
  if (!raw) throw new Error(name + ' must be set explicitly.');
  const url = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error(name + ' must be a PostgreSQL URL.');
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database) throw new Error(name + ' must identify a database.');
  const env = {};
  for (const key of [
    'PATH',
    'Path',
    'PATHEXT',
    'SystemRoot',
    'WINDIR',
    'HOME',
    'USERPROFILE',
    'TMP',
    'TEMP',
    'LANG',
    'LC_ALL',
  ]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  Object.assign(env, {
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: database,
  });
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode) env.PGSSLMODE = sslmode;
  else delete env.PGSSLMODE;
  return { database, env };
}

function run(program, args, env, label) {
  const result = spawnSync(program, args, {
    env,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(label + ' failed (exit ' + String(result.status ?? 'unknown') + ').');
  }
  return result.stdout.trim();
}

function relationCounts(connection) {
  const query =
    "SELECT (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%'), (SELECT count(*) FROM pg_catalog.pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema') AND nspname NOT LIKE 'pg_toast%' AND nspname NOT LIKE 'pg_temp_%');";
  const output = run(
    'psql',
    ['-X', '-A', '-t', '-F', ',', '-c', query],
    connection.env,
    'PostgreSQL inspection',
  );
  const [relations, schemas] = output.split(',').map(Number);
  if (!Number.isInteger(relations) || !Number.isInteger(schemas)) {
    throw new Error('PostgreSQL inspection returned an invalid result.');
  }
  return { relations, schemas };
}

const source = connectionFromEnvironment('SOURCE_DATABASE_URL');
const target = connectionFromEnvironment('RESTORE_DATABASE_URL');
if (source.database === target.database) {
  throw new Error('Source and restore target database names must be different.');
}
if (!/^funtino_(?:restore|scratch|test|ci)(?:_|$)/i.test(target.database)) {
  throw new Error(
    'Restore target database name must start with funtino_restore, funtino_scratch, funtino_test or funtino_ci.',
  );
}

let workDirectory;
try {
  const initialTarget = relationCounts(target);
  if (initialTarget.relations !== 0 || initialTarget.schemas > 1) {
    throw new Error(
      'Restore target must be a fresh database with no user relations or custom schemas.',
    );
  }
  const before = relationCounts(source);
  workDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'funtino-backup-restore-'));
  const archive = path.join(workDirectory, 'database.dump');
  run(
    'pg_dump',
    ['--format=custom', '--no-owner', '--no-privileges', '--file', archive],
    source.env,
    'PostgreSQL backup',
  );
  run(
    'pg_restore',
    ['--exit-on-error', '--no-owner', '--no-privileges', '--dbname', target.database, archive],
    target.env,
    'PostgreSQL restore',
  );
  const after = relationCounts(target);
  if (before.relations !== after.relations || before.schemas !== after.schemas) {
    throw new Error(
      'Restore verification mismatch: source=' +
        before.relations +
        ' relations/' +
        before.schemas +
        ' schemas, target=' +
        after.relations +
        ' relations/' +
        after.schemas +
        ' schemas.',
    );
  }
  process.stdout.write(
    JSON.stringify({
      status: 'passed',
      sourceDatabase: source.database,
      restoreDatabase: target.database,
      relationsVerified: after.relations,
      schemasVerified: after.schemas,
    }) + '\n',
  );
} finally {
  if (workDirectory) {
    const exactTemporaryDirectory = path.resolve(workDirectory);
    if (
      path.dirname(exactTemporaryDirectory) === path.resolve(os.tmpdir()) &&
      path.basename(exactTemporaryDirectory).startsWith('funtino-backup-restore-')
    ) {
      await fs.rm(exactTemporaryDirectory, { recursive: true, force: true });
    }
  }
}
