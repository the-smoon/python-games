import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const playlistOutput = new URL('./.compiled-playlists.test.mjs', import.meta.url);
const scoresOutput = new URL('./.compiled-run-scores.test.mjs', import.meta.url);
try {
  await build({ entryPoints: [new URL('./playlists.test.ts', import.meta.url).pathname],
    outfile: playlistOutput.pathname, platform: 'node', bundle: true, format: 'esm',
    packages: 'external' });
  await build({ entryPoints: [new URL('./run-scores.test.ts', import.meta.url).pathname],
    outfile: scoresOutput.pathname, platform: 'node', bundle: true, format: 'esm',
    external: ['express', 'drizzle-orm', '@workspace/db'],
    alias: {
      '@workspace/api-zod': fileURLToPath(new URL('../../../lib/api-zod/src/index.ts', import.meta.url)),
    } });
  const result = spawnSync(process.execPath, ['--test', playlistOutput.pathname, scoresOutput.pathname], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally {
  await Promise.all([rm(playlistOutput, { force: true }), rm(scoresOutput, { force: true })]);
}