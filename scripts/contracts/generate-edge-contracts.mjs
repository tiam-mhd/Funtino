import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const sourcePath = resolve(root, 'contracts/events/device/windows-edge-contract.v1.schema.json');
const outputPath = resolve(
  root,
  'packages/event-contracts/src/generated/windows-edge-contract.v1.ts',
);
const checkOnly = process.argv.includes('--check');
const source = JSON.parse(await readFile(sourcePath, 'utf8'));
const defs = source.$defs;
if (!defs || typeof defs !== 'object' || Array.isArray(defs))
  throw new Error('Edge contract $defs are missing.');

const definitionNames = Object.keys(defs);
const exportNames = new Map(
  definitionNames.map((name) => [name, `${name[0].toLowerCase()}${name.slice(1)}Schema`]),
);

function literal(value) {
  return JSON.stringify(value);
}

function expression(schema) {
  if ('$ref' in schema) {
    const match = /^#\/\$defs\/([A-Za-z0-9]+)$/.exec(schema.$ref);
    if (!match || !exportNames.has(match[1]))
      throw new Error(`Unsupported Edge schema reference: ${schema.$ref}`);
    return exportNames.get(match[1]);
  }
  if (Array.isArray(schema.oneOf)) return `z.union([${schema.oneOf.map(expression).join(', ')}])`;
  if (Array.isArray(schema.anyOf)) return `z.union([${schema.anyOf.map(expression).join(', ')}])`;

  if (Object.hasOwn(schema, 'const')) return `z.literal(${literal(schema.const)})`;
  if (Array.isArray(schema.enum)) {
    if (schema.enum.includes(null)) {
      const values = schema.enum.filter((value) => value !== null);
      if (!values.every((value) => typeof value === 'string'))
        throw new Error('Only nullable string enums are supported.');
      return `z.enum([${values.map(literal).join(', ')}]).nullable()`;
    }
    if (schema.enum.length === 1) return `z.literal(${literal(schema.enum[0])})`;
    if (!schema.enum.every((value) => typeof value === 'string'))
      throw new Error('Only string enums are supported.');
    return `z.enum([${schema.enum.map(literal).join(', ')}])`;
  }

  let base;
  const type = Array.isArray(schema.type)
    ? schema.type.filter((item) => item !== 'null')
    : schema.type;
  const nullable = Array.isArray(schema.type) && schema.type.includes('null');
  const oneType = Array.isArray(type) ? (type.length === 1 ? type[0] : undefined) : type;
  if (oneType === 'object') {
    const properties = schema.properties ?? {};
    const required = new Set(schema.required ?? []);
    const entries = Object.entries(properties).map(([key, value]) => {
      const property = `${literal(key)}: ${expression(value)}${required.has(key) ? '' : '.optional()'}`;
      return property;
    });
    if (
      Object.keys(properties).length === 0 &&
      schema.additionalProperties &&
      typeof schema.additionalProperties === 'object'
    ) {
      base = `z.record(z.string(), ${expression(schema.additionalProperties)})`;
    } else if (Object.keys(properties).length === 0 && schema.additionalProperties === true) {
      base = 'z.record(z.string(), z.unknown())';
    } else {
      base = `z.object({ ${entries.join(', ')} })`;
      if (schema.additionalProperties === false) base += '.strict()';
      else if (schema.additionalProperties === true) base += '.passthrough()';
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object')
        base += `.catchall(${expression(schema.additionalProperties)})`;
      if (Number.isSafeInteger(schema.minProperties)) {
        base += `.refine((value) => Object.keys(value).length >= ${schema.minProperties})`;
      }
    }
  } else if (oneType === 'array') {
    base = `z.array(${schema.items ? expression(schema.items) : 'z.unknown()'})`;
    if (Number.isSafeInteger(schema.minItems)) base += `.min(${schema.minItems})`;
    if (Number.isSafeInteger(schema.maxItems)) base += `.max(${schema.maxItems})`;
  } else if (oneType === 'string') {
    if (schema.format === 'uuid') base = 'z.string().uuid()';
    else if (schema.format === 'date-time') base = 'z.string().datetime({ offset: true })';
    else if (schema.format === 'date') base = 'z.string().date()';
    else base = 'z.string()';
    if (schema.pattern) base += `.regex(new RegExp(${literal(schema.pattern)}))`;
    if (Number.isSafeInteger(schema.minLength)) base += `.min(${schema.minLength})`;
    if (Number.isSafeInteger(schema.maxLength)) base += `.max(${schema.maxLength})`;
  } else if (oneType === 'integer') {
    base = 'z.number().int().safe()';
    if (schema.minimum === 0) base += '.nonnegative()';
    else if (schema.minimum === 1) base += '.positive()';
    else if (Number.isSafeInteger(schema.minimum)) base += `.min(${schema.minimum})`;
    if (Number.isSafeInteger(schema.maximum)) base += `.max(${schema.maximum})`;
  } else if (oneType === 'number') {
    base = 'z.number()';
  } else if (oneType === 'boolean') {
    base = 'z.boolean()';
  } else if (oneType === undefined) {
    base = 'z.unknown()';
  } else {
    throw new Error(`Unsupported Edge schema type: ${oneType}`);
  }
  return nullable ? `${base}.nullable()` : base;
}

const lines = [
  '/* Generated from contracts/events/device/windows-edge-contract.v1.schema.json. Do not edit by hand. */',
  "import { z } from 'zod';",
  '',
];
for (const name of definitionNames) {
  lines.push(`export const ${exportNames.get(name)} = ${expression(defs[name])};`);
  lines.push(`export type ${name} = z.infer<typeof ${exportNames.get(name)}>;`);
  lines.push('');
}
const generated = await prettier.format(`${lines.join('\n').trimEnd()}\n`, {
  parser: 'typescript',
});
if (checkOnly) {
  let current = '';
  try {
    current = await readFile(outputPath, 'utf8');
  } catch {}
  if (current !== generated) {
    console.error(
      'Generated Windows Edge contract is stale. Run node scripts/contracts/generate-edge-contracts.mjs.',
    );
    process.exitCode = 1;
  }
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, generated, 'utf8');
}
