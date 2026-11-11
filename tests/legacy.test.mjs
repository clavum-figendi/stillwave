import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'acorn';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = new URL('../web/', import.meta.url);
test('distributed bootstrap parses on the factory Chromium 61 ES2017 parser', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const script = html.match(/<script\b([^>]*)src="([^"]+)"[^>]*><\/script>/);
  assert.ok(script, 'the document has a local bootstrap');
  const source = await readFile(new URL(script[2], root), 'utf8');
  // Chrome 61 supports ES2017, not dynamic import, import.meta, optional
  // chaining, nullish coalescing or top-level await. Keep object spread lowered
  // as well so all distributed executable scripts share this strict baseline.
  parse(source, { ecmaVersion: 2017, sourceType: /type="module"/.test(script[1]) ? 'module' : 'script' });
  assert.match(script[1], /\bdefer\b/, 'classic bootstrap must wait for the DOM');
  assert.doesNotMatch(script[1], /type="module"/, 'no module loader is required at runtime');
});
test('the distributed service worker also parses as ES2017', async () => {
  parse(await readFile(new URL('sw.js', root), 'utf8'), { ecmaVersion: 2017, sourceType: 'script' });
});
test('the committed bundle matches source regardless of build working directory', async () => {
  await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./build-web.mjs', import.meta.url)), '--check'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
  });
});
