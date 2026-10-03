import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import prettier from 'prettier';

const root = process.cwd();
const supported = new Set([
  '.css',
  '.html',
  '.js',
  '.jsx',
  '.json',
  '.md',
  '.mdx',
  '.mjs',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);

function git(args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error('Git diff is unavailable; run this gate from a source checkout.');
  }
  return result.stdout
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean);
}

function changedFiles() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const event =
    eventPath && fs.existsSync(eventPath) ? JSON.parse(fs.readFileSync(eventPath, 'utf8')) : {};
  const baseRef = process.env.GITHUB_BASE_REF;
  const eventBefore = event.before;

  if (baseRef) return git(['diff', '--name-only', 'origin/' + baseRef + '...HEAD', '--']);
  if (eventBefore && !/^0+$/.test(eventBefore)) {
    return git(['diff', '--name-only', eventBefore, process.env.GITHUB_SHA ?? 'HEAD', '--']);
  }
  if (process.env.GITHUB_ACTIONS === 'true') {
    const commit = process.env.GITHUB_SHA ?? 'HEAD';
    const parent = spawnSync('git', ['rev-parse', '--verify', commit + '^'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    });
    if (parent.status === 0)
      return git(['diff', '--name-only', parent.stdout.trim(), commit, '--']);
    return git(['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', commit]);
  }

  const tracked = git(['diff', '--name-only', 'HEAD', '--']);
  const untracked = git(['ls-files', '--others', '--exclude-standard']);
  return [...new Set([...tracked, ...untracked])];
}

const candidates = [...new Set(changedFiles())].filter((file) => {
  const extension = path.extname(file).toLowerCase();
  return supported.has(extension) && fs.existsSync(path.resolve(root, file));
});

const failures = [];
for (const file of candidates) {
  const info = await prettier.getFileInfo(path.resolve(root, file), {
    ignorePath: path.join(root, '.prettierignore'),
  });
  if (info.ignored || !info.inferredParser) continue;
  const source = fs.readFileSync(path.resolve(root, file), 'utf8');
  const config = (await prettier.resolveConfig(path.resolve(root, file))) ?? {};
  if (!(await prettier.check(source, { ...config, filepath: path.resolve(root, file) }))) {
    failures.push(file);
  }
}

if (failures.length) {
  process.stderr.write(
    'Changed files are not formatted:\n' + failures.map((file) => '- ' + file).join('\n') + '\n',
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    'Changed-file formatting passed (' + candidates.length + ' supported file(s)).\n',
  );
}
