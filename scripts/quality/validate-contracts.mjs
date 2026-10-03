import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const contractsRoot = path.resolve(root, 'contracts');
let yaml;
try {
  yaml = (await import('js-yaml')).default;
} catch {
  const localStore = path.join(
    root,
    'node_modules/.pnpm/js-yaml@4.3.2/node_modules/js-yaml/index.js',
  );
  yaml = (await import(pathToFileURL(localStore).href)).default;
}
const failures = [];
const documents = new Map();
const eventSchemaFiles = walk(path.join(contractsRoot, 'events')).filter((file) =>
  /\.schema\.json$/i.test(file),
);
const schemaIdFiles = new Map();
const methods = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function parseDocument(file) {
  const absolute = path.resolve(file);
  if (documents.has(absolute)) return documents.get(absolute);
  const source = fs.readFileSync(absolute, 'utf8');
  const value = absolute.endsWith('.json') ? JSON.parse(source) : yaml.load(source);
  documents.set(absolute, value);
  return value;
}

for (const file of eventSchemaFiles) {
  try {
    const schema = parseDocument(file);
    if (typeof schema?.$id === 'string') schemaIdFiles.set(schema.$id, file);
  } catch (error) {
    failures.push(file + ': cannot parse JSON Schema (' + error.message + ')');
  }
}

function pointerValue(document, fragment) {
  if (!fragment || fragment === '#') return document;
  if (!fragment.startsWith('#/')) return undefined;
  return fragment
    .slice(2)
    .split('/')
    .map((part) => decodeURIComponent(part).replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce((value, part) => (value == null ? undefined : value[part]), document);
}

function validateRefs(value, file, location = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateRefs(item, file, location + '[' + index + ']'));
    return;
  }
  if (!value || typeof value !== 'object') return;

  if (typeof value.$ref === 'string') {
    const [refFile, ...fragmentParts] = value.$ref.split('#');
    let targetFile;
    if (/^[a-z][a-z\d+.-]*:/i.test(refFile ?? '')) {
      const canonical = schemaIdFiles.get(refFile);
      if (!canonical) {
        failures.push(
          file +
            ' ' +
            location +
            ': external $ref is not an owned versioned contract: ' +
            value.$ref,
        );
      } else {
        targetFile = canonical;
      }
    } else {
      targetFile = refFile ? path.resolve(path.dirname(file), decodeURIComponent(refFile)) : file;
    }
    if (targetFile) {
      const relative = path.relative(contractsRoot, targetFile);
      if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(targetFile)) {
        failures.push(file + ' ' + location + ': unresolved or out-of-contract $ref ' + value.$ref);
      } else {
        try {
          const targetDocument = parseDocument(targetFile);
          const fragment = fragmentParts.length ? '#' + fragmentParts.join('#') : '';
          if (pointerValue(targetDocument, fragment) === undefined) {
            failures.push(
              file + ' ' + location + ': unresolved JSON pointer in $ref ' + value.$ref,
            );
          }
        } catch (error) {
          failures.push(targetFile + ': cannot parse referenced contract (' + error.message + ')');
        }
      }
    }
  }

  for (const [key, child] of Object.entries(value)) {
    validateRefs(child, file, location + '.' + key);
  }
}

const openApiFiles = walk(path.join(contractsRoot, 'openapi')).filter((file) =>
  /\.ya?ml$/i.test(file),
);
if (openApiFiles.length === 0) failures.push('No OpenAPI YAML files were found.');

for (const file of openApiFiles) {
  try {
    const document = parseDocument(file);
    if (!/^3\.\d+\.\d+$/.test(String(document?.openapi ?? ''))) {
      failures.push(file + ': OpenAPI version must be an explicit 3.x.y version.');
    }
    if (!document?.info?.title || !document?.info?.version || !document?.paths) {
      failures.push(file + ': info.title, info.version and paths are required.');
    }
    const operationIds = new Set();
    for (const [route, pathItem] of Object.entries(document?.paths ?? {})) {
      for (const [method, operation] of Object.entries(pathItem ?? {})) {
        if (!methods.has(method.toLowerCase())) continue;
        if (typeof operation?.operationId !== 'string' || !operation.operationId.trim()) {
          failures.push(
            file + ' ' + method.toUpperCase() + ' ' + route + ': operationId is required.',
          );
        } else if (operationIds.has(operation.operationId)) {
          failures.push(file + ': duplicate operationId ' + operation.operationId);
        } else {
          operationIds.add(operation.operationId);
        }
        if (!operation?.responses || Object.keys(operation.responses).length === 0) {
          failures.push(
            file + ' ' + method.toUpperCase() + ' ' + route + ': responses are required.',
          );
        }
      }
    }
    validateRefs(document, file);
  } catch (error) {
    failures.push(file + ': cannot parse OpenAPI document (' + error.message + ')');
  }
}

const eventSchemas = eventSchemaFiles;
if (eventSchemas.length === 0) failures.push('No versioned event JSON Schemas were found.');
for (const file of eventSchemas) {
  try {
    const schema = parseDocument(file);
    if (typeof schema?.$schema !== 'string' || !schema.$schema.includes('json-schema.org')) {
      failures.push(file + ': a JSON Schema dialect is required.');
    }
    if (typeof schema?.$id !== 'string' || !schema.$id) {
      failures.push(file + ': a stable $id is required.');
    }
    validateRefs(schema, file);
  } catch (error) {
    failures.push(file + ': cannot parse JSON Schema (' + error.message + ')');
  }
}

const asyncApiFiles = walk(path.join(contractsRoot, 'asyncapi')).filter((file) =>
  /\.ya?ml$/i.test(file),
);
for (const file of asyncApiFiles) {
  try {
    const document = parseDocument(file);
    if (!document?.asyncapi || !document?.info?.title || !document?.channels) {
      failures.push(file + ': AsyncAPI version, info.title and channels are required.');
    }
    validateRefs(document, file);
  } catch (error) {
    failures.push(file + ': cannot parse AsyncAPI document (' + error.message + ')');
  }
}

if (failures.length) {
  process.stderr.write('Contract validation failed (' + failures.length + ' issue(s)):\n');
  for (const failure of failures) process.stderr.write('- ' + failure + '\n');
  process.exitCode = 1;
} else {
  process.stdout.write(
    'Contracts valid: ' +
      openApiFiles.length +
      ' OpenAPI, ' +
      eventSchemas.length +
      ' event schemas, ' +
      asyncApiFiles.length +
      ' AsyncAPI documents.\n',
  );
}
