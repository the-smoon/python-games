import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { BOSS_ARRIVAL_SECONDS, STAGE_LEVEL_SECONDS } from '../src/gameRules.ts';

const url = process.env.AUDIOSTRIKE_TEST_URL || 'http://localhost:80/';
function tone(hz) {
  const rate = 8000, wav = Buffer.alloc(44 + rate * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(rate * 2, 40);
  for (let i = 0; i < rate; i++) wav.writeInt16LE(Math.round(Math.sin(i / rate * Math.PI * 2 * hz) * 9000), 44 + i * 2);
  return wav;
}
test('playlist recovery, reordering, once-only shuffle, odd wrap, level analysis and replay', { timeout: 90000 }, async () => {
  const executablePath = process.env.CHROMIUM_PATH || execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim();
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  try {
    for (const mode of ['manual', 'random', 'single']) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.clock.install();
      await page.addInitScript(() => { window.__AUDIOSTRIKE_TEST_MODE__ = true; Math.random = () => 0; });
      const id = '11111111-1111-4111-8111-111111111111';
      const titles = mode === 'single' ? ['A'] : ['A', 'B', 'C'];
      let behavior = 'invalid', deleted = 0, gets = 0;
      const job = (state) => ({ id, state, message: state === 'downloading' ? 'Downloading tracks' : 'Ready',
        completed: state === 'downloading' ? 0 : titles.length, total: titles.length,
        manifest: state === 'ready' ? { version: 1, skipped: 0, tracks: titles.map((title, i) => ({ id: String(i), title, url: `/api/playlists/${id}/tracks/${i}` })) } : undefined });
      await page.route('**/api/playlists**', async (route) => {
        const req = route.request(), path = new URL(req.url()).pathname;
        if (req.method() === 'DELETE') { deleted++; await route.fulfill({ status: 204 }); return; }
        if (req.method() === 'POST') {
          gets = 0;
          if (behavior === 'invalid') { await route.fulfill({ status: 400, json: { error: 'Use a public playlist URL' } }); return; }
          await route.fulfill({ status: 202, json: job('downloading') }); return;
        }
        if (path.includes('/tracks/')) {
          const i = Number(path.split('/').pop());
          const wav = tone([110, 1100, 3200][i]);
          await route.fulfill({ status: 200, contentType: 'audio/mpeg',
            headers: { 'content-length': String(behavior === 'oversized' ? 25 * 1024 * 1024 : wav.length) }, body: wav });
          return;
        }
        gets++;
        await route.fulfill({ status: 200, json: job(behavior === 'cancel' || gets === 1 ? 'downloading' : 'ready') });
      });
      await page.goto(url);
      await page.getByTestId('button-source-playlist').click();
      await page.getByTestId('input-playlist-url').fill('https://music.youtube.com/playlist?list=PL_Test');
      await page.getByTestId('button-download-playlist').click();
      await page.getByTestId('playlist-error').waitFor();
      assert.match(await page.getByTestId('playlist-error').innerText(), /public/);
      behavior = 'oversized';
      await page.getByTestId('button-download-playlist').click();
      await page.clock.runFor(2500);
      await page.waitForFunction(() => document.querySelector('[data-testid=playlist-error]')?.textContent.includes('size limit'));
      behavior = 'cancel';
      await page.getByTestId('button-download-playlist').click();
      await page.getByRole('button', { name: 'Cancel download' }).click();
      await page.waitForFunction(() => !document.querySelector('[data-testid=button-download-playlist]').disabled);
      behavior = 'success';
      await page.getByTestId('button-download-playlist').click();
      await page.clock.runFor(2500);
      await page.getByTestId('playlist-tracks').waitFor();
      if (mode === 'manual') {
        await page.getByRole('button', { name: 'Move C up', exact: true }).click();
        await page.getByRole('button', { name: 'Move C up', exact: true }).click();
      }
      if (mode === 'random') await page.getByTestId('input-shuffle-playlist').check();
      await page.getByTestId('button-analyze').click();
      await page.waitForFunction(() => window.__AUDIOSTRIKE_TEST__?.snapshot().state === 'PLAYING');
      const snap = () => page.evaluate(() => window.__AUDIOSTRIKE_TEST__.snapshot());
      const order = mode === 'manual' ? ['C', 'A', 'B'] : mode === 'random' ? ['B', 'C', 'A'] : ['A'];
      const first = await snap();
      assert.deepEqual(first.trackOrder, order);
      assert.equal(first.stageTrackTitle, order[0]);
      assert.equal(first.bossTrackTitle, order[1] ?? order[0]);
      assert.equal(first.stageAnalysis.analyzed, true);
      assert.equal(first.bossAnalysis.analyzed, true);
      for (let level = 2; level <= 4; level++) {
        await page.clock.fastForward((STAGE_LEVEL_SECONDS + 0.1) * 1000);
        await page.clock.runFor(BOSS_ARRIVAL_SECONDS * 1000 + 200);
        await page.waitForFunction(() => window.__AUDIOSTRIKE_TEST__?.snapshot().state === 'BOSS');
        assert.equal((await snap()).bossAudioPaused, false);
        await page.evaluate(() => window.__AUDIOSTRIKE_TEST__.finishBoss());
        await page.clock.runFor(2600);
        await page.waitForFunction((level) => window.__AUDIOSTRIKE_TEST__?.snapshot().level === level, level);
        const next = await snap();
        assert.equal(next.stageTrackTitle, order[(level - 1) * 2 % order.length]);
        assert.equal(next.bossTrackTitle, order[((level - 1) * 2 + 1) % order.length]);
        assert.equal(next.stageAudioPaused, false);
        assert.equal(next.bossAudioPaused, true);
        assert.deepEqual(next.trackOrder, order, 'never reshuffle between levels');
        if (level === 2 && mode !== 'single') {
          assert.notEqual(next.stageAudioSrc, first.stageAudioSrc);
          assert.notEqual(next.stageAnalysis.centroid, first.stageAnalysis.centroid, 'encounter design uses the next song');
        }
      }
      await page.evaluate(() => window.__AUDIOSTRIKE_TEST__.endRun());
      await page.getByTestId('button-replay-game-over').click();
      await page.waitForFunction(() => window.__AUDIOSTRIKE_TEST__?.snapshot().state === 'PLAYING');
      assert.equal((await snap()).stageTrackTitle, order[0]);
      assert.deepEqual((await snap()).trackOrder, order);
      assert.ok(deleted >= 3, 'temporary files are removed for oversized, cancelled and successful downloads');
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});