import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
// Stage separate standard Supabase CLI project layouts. Nothing is deployed here.
for (const [project, fn, implementation] of [
  ['china', 'activate-license', 'activate-license.ts'],
  ['business', 'chatgpt-proxy', 'chatgpt-proxy.ts'],
]) {
  const target = path.join(root, 'dist', project, 'supabase');
  await mkdir(path.join(target, 'functions', fn), { recursive: true });
  await mkdir(path.join(target, 'functions', '_shared'), { recursive: true });
  for (const file of ['index.ts', implementation]) {
    const source = await readFile(path.join(root, project, 'functions', fn, file), 'utf8');
    await writeFile(path.join(target, 'functions', fn, file), source.replaceAll('../../../shared/http.js', '../_shared/http.js'));
  }
  await copyFile(path.join(root, 'shared', 'http.js'), path.join(target, 'functions', '_shared', 'http.js'));
  const config = await readFile(path.join(root, project, 'config.toml'), 'utf8');
  await writeFile(path.join(target, 'config.toml'), `project_id = "license-${project}"

${config}`);
  await copyFile(path.join(root, 'deno.lock'), path.join(target, 'functions', fn, 'deno.lock'));
}
console.log('Staged China and Business CLI projects in dist/. No remote changes performed.');
