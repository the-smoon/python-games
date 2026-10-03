import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
const output = new URL('./.compiled-playlists.test.mjs', import.meta.url);
try {
  await build({ entryPoints: [new URL('./playlists.test.ts', import.meta.url).pathname],
    outfile: output.pathname, platform: 'node', bundle: true, format: 'esm',
    external: ['express', 'cors', 'pino', 'pino-http'] });
  const result = spawnSync(process.execPath, ['--test', output.pathname], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally { await rm(output, { force: true }); }