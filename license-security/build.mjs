import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Ship local JS only: MV3 does not permit executable code loaded from a CDN.
await build({
  absWorkingDir: fileURLToPath(new URL('.', import.meta.url)),
  entryPoints: ['frontend/license.js'], outfile: 'dist/license-client.js',
  bundle: true, platform: 'browser', format: 'esm', target: 'chrome120',
  legalComments: 'eof', sourcemap: false,
});
console.log('Built dist/license-client.js (public configuration supplied at initialization).');
