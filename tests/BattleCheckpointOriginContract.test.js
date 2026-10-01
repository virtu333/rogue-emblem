import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Linter } from 'eslint';

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith('.js') ? [path] : [];
  });
}
function visit(node, callback) {
  if (!node || typeof node !== 'object') return;
  if (node.type) callback(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent' || key === 'tokens' || key === 'comments') continue;
    if (Array.isArray(value)) value.forEach((child) => visit(child, callback));
    else if (value && typeof value === 'object') visit(value, callback);
  }
}
function missingOrigins(source) {
  if (!source.includes('_captureSuspendCheckpoint')) return [];
  const parser = new Linter();
  const errors = parser.verify(source, {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: {},
  });
  expect(errors.filter((error) => error.fatal)).toEqual([]);
  const calls = [];
  visit(parser.getSourceCode().ast, (node) => {
    if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression') return;
    const property = node.callee.property;
    const name = node.callee.computed ? property.value : property.name;
    if (name !== '_captureSuspendCheckpoint') return;
    const options = node.arguments[0];
    const origin =
      options?.type === 'ObjectExpression'
        ? options.properties.find(
            (property) =>
              property.type === 'Property' &&
              (property.key.name || property.key.value) === 'session',
          )
        : null;
    // Require the operation's explicit variable; sampling the current scene
    // here would let a continuation from the old battle save into its restart.
    const valid = origin?.value.type === 'Identifier' && origin.value.name !== 'undefined';
    calls.push({ line: node.loc.start.line, valid });
  });
  return calls;
}

describe('production checkpoint origins', () => {
  it('every production capture call carries an explicit originating session', () => {
    const files = sourceFiles(new URL('../src', import.meta.url).pathname);
    const calls = files.flatMap((file) =>
      missingOrigins(readFileSync(file, 'utf8')).map((call) => ({
        file: relative(process.cwd(), file),
        ...call,
      })),
    );
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.filter((call) => !call.valid)).toEqual([]);
  });
  it('detects omitted, empty, undefined and freshly sampled origins, including optional calls', () => {
    expect(
      missingOrigins(`
      scene._captureSuspendCheckpoint();
      scene._captureSuspendCheckpoint?.({});
      scene._captureSuspendCheckpoint({ session: undefined });
      scene['_captureSuspendCheckpoint']({ session: scene._battleSession });
      scene._captureSuspendCheckpoint?.({ preserveRng: true, session });
    `).map((call) => call.valid),
    ).toEqual([false, false, false, false, true]);
  });
});
