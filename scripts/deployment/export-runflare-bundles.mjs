import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  access,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEPLOYMENT_PARENT = resolve(SOURCE_ROOT, '..', 'Funtino-deployments');
const TURBO_CLI = resolve(SOURCE_ROOT, 'node_modules/turbo/bin/turbo');
const PROTECTED_FILE_NAME = 'این فایل رو نمیخواد بخونی هیچ وقت.txt';
const SNAPSHOT_RECEIPT = '.funtino-snapshot.json';
const GENERATED_PATH_SEGMENTS = new Set([
  'node_modules',
  '.next',
  'dist',
  'generated',
  '.turbo',
  'coverage',
]);
const SAFE_GIT_DIRECTORY_ENV = createSafeGitEnvironment();

const BUNDLES = Object.freeze({
  frontend: {
    repository: 'funtino-frontend-runtime',
    scopes: [
      '@funtino/customer-web',
      '@funtino/operations-web',
      '@funtino/system-web',
    ],
    templateDirectory: 'infra/runflare-bundles/frontend',
    manifestFile: 'frontend.processes.json',
    runtimeFiles: [
      'supervisor.mjs',
      'healthcheck.mjs',
      'frontend.processes.json',
    ],
    extraFiles: [],
  },
  backend: {
    repository: 'funtino-backend-runtime',
    scopes: [
      '@funtino/api-gateway',
      '@funtino/realtime-gateway',
      '@funtino/device-integration',
      '@funtino/notifications',
      '@funtino/identity-access',
      '@funtino/organization-branch',
      '@funtino/analytics-read-model',
      '@funtino/wallet',
      '@funtino/customer-household',
      '@funtino/forms',
    ],
    templateDirectory: 'infra/runflare-bundles/backend',
    manifestFile: 'backend.processes.json',
    runtimeFiles: [
      'supervisor.mjs',
      'healthcheck.mjs',
      'backend.processes.json',
    ],
    extraFiles: ['scripts/worker-startup.mjs'],
  },
});

function createSafeGitEnvironment() {
  const environment = { ...process.env };
  const configuredCount = Number(environment.GIT_CONFIG_COUNT ?? 0);
  const nextIndex = Number.isSafeInteger(configuredCount) && configuredCount >= 0 ? configuredCount : 0;
  environment.GIT_CONFIG_COUNT = String(nextIndex + 1);
  environment[`GIT_CONFIG_KEY_${nextIndex}`] = 'safe.directory';
  environment[`GIT_CONFIG_VALUE_${nextIndex}`] = SOURCE_ROOT;
  return environment;
}

function createSafeGitEnvironmentFor(directory) {
  const environment = { ...SAFE_GIT_DIRECTORY_ENV };
  const configuredCount = Number(environment.GIT_CONFIG_COUNT ?? 0);
  const nextIndex = Number.isSafeInteger(configuredCount) && configuredCount >= 0 ? configuredCount : 0;
  environment.GIT_CONFIG_COUNT = String(nextIndex + 1);
  environment[`GIT_CONFIG_KEY_${nextIndex}`] = 'safe.directory';
  environment[`GIT_CONFIG_VALUE_${nextIndex}`] = directory;
  return environment;
}

function isWithin(parent, candidate) {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent === '' ||
    (!pathFromParent.startsWith(`..${sep}`) && pathFromParent !== '..' && !isAbsolute(pathFromParent))
  );
}

function toPosixPath(path) {
  return path.split(sep).join('/');
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function assertNotProtectedPath(path) {
  if (path.split(/[\\/]/u).at(-1) === PROTECTED_FILE_NAME) {
    throw new Error('Snapshot operation refused a protected local file path.');
  }
}

function isGeneratedSnapshotPath(relativePath) {
  const parts = toPosixPath(relativePath).split('/');
  return parts.some((part) => GENERATED_PATH_SEGMENTS.has(part));
}

function assertSafeSnapshotPath(relativePath) {
  assertNotProtectedPath(relativePath);
  const normalized = toPosixPath(relativePath);
  const parts = normalized.split('/');
  if (parts.includes('.git') || isGeneratedSnapshotPath(normalized)) {
    throw new Error(`Snapshot contains a generated or local-only path: ${normalized}.`);
  }

  const name = parts.at(-1);
  if (name === '.env' || (name.startsWith('.env.') && name !== '.env.example')) {
    throw new Error(`Snapshot contains a non-example environment file: ${normalized}.`);
  }
}

async function copyTree(sourceDirectory, destinationDirectory, relativeDirectory = '') {
  const entries = await readdir(sourceDirectory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    assertNotProtectedPath(entry.name);
    // Exclude Turbo's transient cache from runtime snapshots.
    if (entry.name === '.git' || entry.name === '.turbo') {
      continue;
    }

    const sourcePath = join(sourceDirectory, entry.name);
    const destinationPath = join(destinationDirectory, entry.name);
    const relativePath = relativeDirectory ? join(relativeDirectory, entry.name) : entry.name;
    assertSafeSnapshotPath(relativePath);

    if (entry.isSymbolicLink()) {
      throw new Error(`Snapshot source contains a symbolic link: ${toPosixPath(relativePath)}.`);
    }

    if (entry.isDirectory()) {
      await mkdir(destinationPath, { recursive: true });
      await copyTree(sourcePath, destinationPath, relativePath);
      continue;
    }

    if (!entry.isFile()) {
      throw new Error(`Snapshot source contains an unsupported filesystem entry: ${toPosixPath(relativePath)}.`);
    }

    await mkdir(dirname(destinationPath), { recursive: true });
    await copyFile(sourcePath, destinationPath);
  }
}

async function collectFileHashes(
  directory,
  { ignoreGit = false, ignoreReceipt = false, ignoreGeneratedPaths = false } = {},
) {
  const files = [];

  async function visit(currentDirectory, relativeDirectory = '') {
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      assertNotProtectedPath(entry.name);
      const relativePath = relativeDirectory ? join(relativeDirectory, entry.name) : entry.name;

      if (ignoreGit && relativePath === '.git') {
        continue;
      }
      if (ignoreReceipt && relativePath === SNAPSHOT_RECEIPT) {
        continue;
      }
      if (ignoreGeneratedPaths && isGeneratedSnapshotPath(relativePath)) {
        continue;
      }

      assertSafeSnapshotPath(relativePath);
      const absolutePath = join(currentDirectory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Snapshot contains a symbolic link: ${toPosixPath(relativePath)}.`);
      }

      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath);
      } else if (entry.isFile()) {
        const contents = await readFile(absolutePath);
        files.push({
          path: toPosixPath(relativePath),
          sha256: createHash('sha256').update(contents).digest('hex'),
        });
      } else {
        throw new Error(`Snapshot contains an unsupported filesystem entry: ${toPosixPath(relativePath)}.`);
      }
    }
  }

  await visit(directory);
  files.sort((left, right) => left.path.localeCompare(right.path));
  return files;
}

async function readSourceRevision() {
  const head = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd: SOURCE_ROOT,
    env: SAFE_GIT_DIRECTORY_ENV,
    encoding: 'utf8',
  });
  if (head.status !== 0) {
    return null;
  }

  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: SOURCE_ROOT,
    env: SAFE_GIT_DIRECTORY_ENV,
    encoding: 'utf8',
  });
  if (status.status !== 0 || status.stdout.trim() !== '') {
    return null;
  }

  return head.stdout.trim() || null;
}

function runTurboPrune(bundle, outputDirectory) {
  const args = [
    'prune',
    ...bundle.scopes,
    '--docker',
    '--out-dir',
    outputDirectory,
    '--use-gitignore',
  ];
  const result = spawnSync(process.execPath, [TURBO_CLI, ...args], {
    cwd: SOURCE_ROOT,
    env: SAFE_GIT_DIRECTORY_ENV,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Turbo prune failed for ${bundle.repository} with exit code ${result.status}.`);
  }
}

async function ensurePrunedWorkspace(prunedDirectory, snapshotDirectory) {
  const fullDirectory = join(prunedDirectory, 'full');
  if (!(await pathExists(fullDirectory))) {
    throw new Error('Turbo prune did not create the expected full workspace directory.');
  }

  await copyTree(fullDirectory, snapshotDirectory);

  const requiredFiles = [
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'turbo.json',
    'tsconfig.base.json',
  ];
  const fallbackFiles = {
    'pnpm-lock.yaml': join(prunedDirectory, 'pnpm-lock.yaml'),
    'pnpm-workspace.yaml': join(prunedDirectory, 'pnpm-workspace.yaml'),
    'turbo.json': join(SOURCE_ROOT, 'turbo.json'),
    'tsconfig.base.json': join(SOURCE_ROOT, 'tsconfig.base.json'),
  };

  for (const file of requiredFiles) {
    const destination = join(snapshotDirectory, file);
    if (await pathExists(destination)) {
      continue;
    }

    const fallback = fallbackFiles[file];
    if (!fallback || !(await pathExists(fallback))) {
      throw new Error(`Pruned workspace is missing required root file ${file}.`);
    }
    await copyFile(fallback, destination);
  }

  const prunedLockfile = join(prunedDirectory, 'pnpm-lock.yaml');
  if (await pathExists(prunedLockfile)) {
    await copyFile(prunedLockfile, join(snapshotDirectory, 'pnpm-lock.yaml'));
  }
}

async function writeRuntimeFiles(bundle, snapshotDirectory) {
  const runtimeDirectory = join(snapshotDirectory, 'runtime');
  await mkdir(runtimeDirectory, { recursive: true });

  for (const file of bundle.runtimeFiles) {
    const sourcePath = join(SOURCE_ROOT, 'scripts/runtime-bundle', file);
    const destinationPath = join(runtimeDirectory, file);
    await copyFile(sourcePath, destinationPath);
  }

  for (const file of bundle.extraFiles) {
    const sourcePath = join(SOURCE_ROOT, file);
    const destinationPath = join(snapshotDirectory, file);
    await mkdir(dirname(destinationPath), { recursive: true });
    await copyFile(sourcePath, destinationPath);
  }
}

async function updateRootPackage(bundle, snapshotDirectory) {
  const packagePath = join(snapshotDirectory, 'package.json');
  const packageManifest = JSON.parse(await readFile(packagePath, 'utf8'));
  packageManifest.private = true;
  packageManifest.scripts ??= {};
  packageManifest.scripts['runtime:start'] =
    `node runtime/supervisor.mjs runtime/${bundle.manifestFile}`;
  packageManifest.scripts['runtime:health'] =
    `node runtime/healthcheck.mjs runtime/${bundle.manifestFile}`;

  await writeFile(packagePath, `${JSON.stringify(packageManifest, null, 2)}\n`, 'utf8');
}

async function writeDeploymentFiles(bundle, snapshotDirectory) {
  const templateDirectory = join(SOURCE_ROOT, bundle.templateDirectory);
  await copyTree(templateDirectory, snapshotDirectory);

  await writeRuntimeFiles(bundle, snapshotDirectory);
  await updateRootPackage(bundle, snapshotDirectory);

  const deploymentGitignore = [
    'node_modules/',
    '**/node_modules/',
    '.next/',
    '**/.next/',
    'dist/',
    '**/dist/',
    'generated/',
    '**/generated/',
    '.turbo/',
    '.env',
    '.env.*',
    '!.env.example',
    '**/.env',
    '**/.env.*',
    '!**/.env.example',
    '*.log',
    '',
  ].join('\n');
  await writeFile(join(snapshotDirectory, '.gitignore'), deploymentGitignore, 'utf8');
}

async function createSnapshot(bundleName, bundle, temporaryRoot, sourceRevision) {
  const prunedDirectory = join(temporaryRoot, `pruned-${bundleName}`);
  const snapshotDirectory = join(temporaryRoot, `snapshot-${bundleName}`);
  await mkdir(snapshotDirectory, { recursive: true });

  runTurboPrune(bundle, prunedDirectory);
  await ensurePrunedWorkspace(prunedDirectory, snapshotDirectory);
  await writeDeploymentFiles(bundle, snapshotDirectory);

  const files = await collectFileHashes(snapshotDirectory);
  const fingerprint = createHash('sha256').update(JSON.stringify(files)).digest('hex');
  const receipt = {
    formatVersion: 1,
    bundle: bundleName,
    sourceRevision,
    fingerprint,
    files,
  };
  await writeFile(
    join(snapshotDirectory, SNAPSHOT_RECEIPT),
    `${JSON.stringify(receipt, null, 2)}\n`,
    'utf8',
  );

  return { snapshotDirectory, receipt };
}

async function inspectExistingDestination(bundleName, destinationDirectory, releaseRequested) {
  const entries = await readdir(destinationDirectory, { withFileTypes: true });
  const hasReceipt = entries.some((entry) => entry.name === SNAPSHOT_RECEIPT);
  const gitPath = join(destinationDirectory, '.git');
  const hasGit = await pathExists(gitPath);
  const existingFiles = await collectFileHashes(destinationDirectory, {
    ignoreGit: true,
    ignoreReceipt: true,
    ignoreGeneratedPaths: true,
  });

  if (!hasReceipt) {
    if (existingFiles.length > 0) {
      throw new Error(
        `Refusing to replace ${destinationDirectory}: it has files but no Funtino snapshot receipt.`,
      );
    }
    return [];
  }

  const receiptPath = join(destinationDirectory, SNAPSHOT_RECEIPT);
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  if (receipt.formatVersion !== 1 || receipt.bundle !== bundleName || !Array.isArray(receipt.files)) {
    throw new Error(`Snapshot receipt is invalid in ${destinationDirectory}.`);
  }

  const expected = [...receipt.files].sort((left, right) => left.path.localeCompare(right.path));
  const expectedFingerprint = createHash('sha256').update(JSON.stringify(expected)).digest('hex');
  if (receipt.fingerprint !== expectedFingerprint) {
    throw new Error(`Snapshot receipt fingerprint is invalid in ${destinationDirectory}.`);
  }
  let snapshotMatches = JSON.stringify(existingFiles) === JSON.stringify(expected);
  if (!snapshotMatches && hasGit) {
    const gitEnvironment = createSafeGitEnvironmentFor(destinationDirectory);
    const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
      cwd: destinationDirectory,
      env: gitEnvironment,
      encoding: 'utf8',
    });
    if (status.status !== 0 || status.stdout.trim()) {
      throw new Error(`Refusing to compare snapshot files in a non-clean clone: ${destinationDirectory}.`);
    }

    const samePaths =
      existingFiles.length === expected.length &&
      expected.every((file, index) => existingFiles[index].path === file.path);
    if (samePaths) {
      snapshotMatches = true;
      for (let index = 0; index < expected.length; index += 1) {
        const expectedFile = expected[index];
        if (existingFiles[index].sha256 === expectedFile.sha256) {
          continue;
        }

        assertSafeSnapshotPath(expectedFile.path);
        const committedPath = resolve(destinationDirectory, expectedFile.path);
        if (!isWithin(destinationDirectory, committedPath) || committedPath === destinationDirectory) {
          throw new Error('Snapshot receipt contains an unsafe file path.');
        }

        const committedFile = spawnSync('git', ['cat-file', 'blob', `HEAD:${expectedFile.path}`], {
          cwd: destinationDirectory,
          env: gitEnvironment,
          maxBuffer: 256 * 1024 * 1024,
        });
        if (committedFile.error) {
          throw committedFile.error;
        }
        if (
          committedFile.status !== 0 ||
          createHash('sha256').update(committedFile.stdout).digest('hex') !== expectedFile.sha256
        ) {
          snapshotMatches = false;
          break;
        }
      }
    }
  }
  if (!snapshotMatches) {
    throw new Error(
      `Refusing to replace ${destinationDirectory}: snapshot files changed since the last export.`,
    );
  }

  if (hasGit) {
    const gitEnvironment = createSafeGitEnvironmentFor(destinationDirectory);
    const staged = spawnSync('git', ['diff', '--cached', '--quiet'], {
      cwd: destinationDirectory,
      env: gitEnvironment,
      encoding: 'utf8',
    });
    if (staged.status !== 0) {
      throw new Error(`Refusing to replace staged changes in ${destinationDirectory}.`);
    }

    const remotes = spawnSync('git', ['remote'], {
      cwd: destinationDirectory,
      env: gitEnvironment,
      encoding: 'utf8',
    });
    if (remotes.status !== 0) {
      throw new Error(`Could not inspect Git remotes in ${destinationDirectory}.`);
    }

    if (remotes.stdout.trim()) {
      if (!releaseRequested) {
        throw new Error(
          `Refusing to refresh remote-connected repository ${destinationDirectory} without --release.`,
        );
      }
      if (!remotes.stdout.split(/\r?\n/u).includes('origin')) {
        throw new Error(`Release preflight requires origin in ${destinationDirectory}.`);
      }

      const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
        cwd: destinationDirectory,
        env: gitEnvironment,
        encoding: 'utf8',
      });
      if (status.status !== 0 || status.stdout.trim()) {
        throw new Error(`Release preflight requires a clean clone: ${destinationDirectory}.`);
      }

      const fetch = spawnSync('git', ['fetch', 'origin', 'main'], {
        cwd: destinationDirectory,
        env: gitEnvironment,
        encoding: 'utf8',
        stdio: 'inherit',
      });
      if (fetch.error) {
        throw fetch.error;
      }
      if (fetch.status !== 0) {
        throw new Error(`git fetch origin main failed in ${destinationDirectory}.`);
      }

      const divergence = spawnSync('git', ['rev-list', '--left-right', '--count', 'HEAD...origin/main'], {
        cwd: destinationDirectory,
        env: gitEnvironment,
        encoding: 'utf8',
      });
      if (divergence.status !== 0 || divergence.stdout.trim().split(/\s+/u).join(' ') !== '0 0') {
        throw new Error(`Release preflight requires 0 0 divergence in ${destinationDirectory}.`);
      }
    }
  }

  return expected;
}

async function initializeGitRepository(destinationDirectory) {
  const gitPath = join(destinationDirectory, '.git');
  if (await pathExists(gitPath)) {
    const info = await lstat(gitPath);
    if (!info.isDirectory() && !info.isFile()) {
      throw new Error(`Unsupported .git filesystem entry in ${destinationDirectory}.`);
    }
    return;
  }

  const result = spawnSync(
    'git',
    ['init', '--initial-branch=main', destinationDirectory],
    {
      cwd: DEPLOYMENT_PARENT,
      env: SAFE_GIT_DIRECTORY_ENV,
      encoding: 'utf8',
      stdio: 'inherit',
    },
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`git init failed for ${destinationDirectory}.`);
  }
}

async function syncSnapshot(bundleName, bundle, snapshot, releaseRequested) {
  const destinationDirectory = resolve(DEPLOYMENT_PARENT, bundle.repository);
  if (!isWithin(DEPLOYMENT_PARENT, destinationDirectory)) {
    throw new Error('Deployment destination escaped the approved sibling folder.');
  }

  const parentInfo = await lstat(DEPLOYMENT_PARENT);
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) {
    throw new Error('Deployment sibling path must be a real directory.');
  }

  if (!(await pathExists(destinationDirectory))) {
    await mkdir(destinationDirectory);
  } else {
    const targetInfo = await lstat(destinationDirectory);
    if (!targetInfo.isDirectory() || targetInfo.isSymbolicLink()) {
      throw new Error(`Deployment destination is not a regular directory: ${destinationDirectory}.`);
    }
  }

  const oldFiles = await inspectExistingDestination(bundleName, destinationDirectory, releaseRequested);
  for (const file of oldFiles) {
    const oldPath = resolve(destinationDirectory, file.path);
    if (!isWithin(destinationDirectory, oldPath)) {
      throw new Error('Snapshot receipt contains an unsafe file path.');
    }
    await unlink(oldPath);
  }

  const oldReceipt = join(destinationDirectory, SNAPSHOT_RECEIPT);
  if (await pathExists(oldReceipt)) {
    await unlink(oldReceipt);
  }

  await initializeGitRepository(destinationDirectory);
  await copyTree(snapshot.snapshotDirectory, destinationDirectory);

  const copiedFiles = await collectFileHashes(destinationDirectory, {
    ignoreGit: true,
    ignoreReceipt: true,
    ignoreGeneratedPaths: true,
  });
  if (JSON.stringify(copiedFiles) !== JSON.stringify(snapshot.receipt.files)) {
    throw new Error(`Snapshot copy verification failed for ${bundleName}.`);
  }

  await copyFile(
    join(snapshot.snapshotDirectory, SNAPSHOT_RECEIPT),
    join(destinationDirectory, SNAPSHOT_RECEIPT),
  );

  process.stdout.write(
    `${JSON.stringify({
      event: 'runtime.snapshot.exported',
      bundle: bundleName,
      repository: bundle.repository,
      destination: destinationDirectory,
      sourceRevision: snapshot.receipt.sourceRevision,
      fingerprint: snapshot.receipt.fingerprint,
      fileCount: snapshot.receipt.files.length,
      remoteConfigured: false,
      committed: false,
    })}\n`,
  );
}

async function exportBundle(bundleName, releaseRequested) {
  const bundle = BUNDLES[bundleName];
  if (!bundle) {
    throw new Error(`Unknown runtime bundle: ${bundleName}.`);
  }

  const deploymentParent = resolve(DEPLOYMENT_PARENT);
  const expectedParent = resolve(SOURCE_ROOT, '..', 'Funtino-deployments');
  if (deploymentParent.toLowerCase() !== expectedParent.toLowerCase()) {
    throw new Error('Deployment repository parent is outside the expected sibling path.');
  }

  await mkdir(deploymentParent, { recursive: true });
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'funtino-runflare-bundle-'));
  const resolvedTempRoot = resolve(temporaryRoot);
  if (!isWithin(resolve(tmpdir()), resolvedTempRoot)) {
    throw new Error('Temporary snapshot path escaped the temporary directory.');
  }

  try {
    const sourceRevision = await readSourceRevision();
    const snapshot = await createSnapshot(bundleName, bundle, temporaryRoot, sourceRevision);
    await syncSnapshot(bundleName, bundle, snapshot, releaseRequested);
  } finally {
    if (
      isWithin(resolve(tmpdir()), resolve(temporaryRoot)) &&
      basename(temporaryRoot).startsWith('funtino-runflare-bundle-')
    ) {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }
}

async function main() {
  const argumentsList = process.argv.slice(2);
  const releaseRequested = argumentsList.includes('--release');
  const requestedArguments = argumentsList.filter((argument) => argument !== '--release');
  if (requestedArguments.length !== 1) {
    throw new Error('Usage: node scripts/deployment/export-runflare-bundles.mjs <frontend|backend|all> [--release]');
  }

  const requested = requestedArguments[0];
  const bundleNames = requested === 'all' ? Object.keys(BUNDLES) : [requested];

  if (!requested || bundleNames.some((bundleName) => !BUNDLES[bundleName])) {
    throw new Error('Usage: node scripts/deployment/export-runflare-bundles.mjs <frontend|backend|all>');
  }

  for (const bundleName of bundleNames) {
    await exportBundle(bundleName, releaseRequested);
  }
}

void main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({
      event: 'runtime.snapshot.export_failed',
      message: error instanceof Error ? error.message : 'Unknown export failure.',
    })}\n`,
  );
  process.exitCode = 1;
});
