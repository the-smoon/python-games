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
test('Drive picker recovery, shared save/load, ordering, one-time shuffle, odd wrap and replay', { timeout: 90000 }, async () => {
  const executablePath = process.env.CHROMIUM_PATH || execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim();
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  try {
    for (const mode of ['manual', 'random', 'single']) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.clock.install();
      await page.addInitScript(() => { window.__AUDIOSTRIKE_TEST_MODE__ = true; Math.random = () => 0; });
      const titles = mode === 'single' ? ['A'] : ['A', 'B', 'C'];
      let behavior = 'oversized';
      const library = titles.map((title, i) => ({ id: title, title, size: tone([110, 1100, 3200][i]).length }));
      const saved = new Map();
      await page.route('**/api/playlists**', async (route) => {
        const req = route.request(), path = new URL(req.url()).pathname;
        if (path.endsWith('/owner')) { await route.fulfill({ json: { owner: false, configured: false } }); return; }
        if (path.endsWith('/library')) { await route.fulfill({ json: library }); return; }
        if (req.method() === 'POST') {
          const input = req.postDataJSON();
          if ([...saved.values()].some(list => list.name === input.name)) {
            await route.fulfill({ status: 409, json: { error: 'A playlist with that name already exists' } }); return;
          }
          const id = `saved-${saved.size}`;
          const list = { id, name: input.name, tracks: input.trackIds.map(id => library.find(track => track.id === id)) };
          saved.set(id, list);
          await route.fulfill({ status: 201, json: { id, name: list.name } }); return;
        }
        if (path.includes('/audio/')) {
          const i = titles.indexOf(path.split('/').pop());
          const wav = tone([110, 1100, 3200][i]);
          await route.fulfill({ status: 200, contentType: 'audio/mpeg',
            headers: { 'content-length': String(behavior === 'oversized' ? 25 * 1024 * 1024 : wav.length) }, body: wav });
          return;
        }
        const last = path.split('/').pop();
        await route.fulfill({ json: saved.has(last) ? saved.get(last) : [...saved.values()].map(({id,name}) => ({id,name})) });
      });
      await page.goto(url);
      assert.equal(await page.getByTestId('button-analyze').isDisabled(), true);
      assert.equal(await page.getByTestId('input-stage-file').count(), 0);
      assert.equal(await page.getByTestId('input-owner-upload').count(), 0);
      await page.getByTestId('button-add-A').click();
      await page.waitForFunction(() => document.querySelector('[data-testid=playlist-error]')?.textContent.includes('24 MB'));
      behavior = 'success';
      for (const title of titles) {
        await page.getByTestId(`button-add-${title}`).click();
        await page.getByTestId(`button-remove-${title}`).waitFor();
      }
      await page.getByTestId('button-remove-A').click();
      if (mode === 'single') assert.equal(await page.getByTestId('button-analyze').isDisabled(), true);
      await page.getByTestId('button-add-A').click();
      await page.getByTestId('button-remove-A').waitFor();
      if (mode !== 'single') {
        await page.getByRole('button', { name: 'Move A up', exact: true }).click();
        await page.getByRole('button', { name: 'Move A up', exact: true }).click();
      }
      if (mode === 'manual') {
        await page.getByRole('button', { name: 'Move C up', exact: true }).click();
        await page.getByRole('button', { name: 'Move C up', exact: true }).click();
      }
      await page.getByTestId('input-playlist-name').fill('Browser test');
      await page.getByTestId('button-save-playlist').click();
      await page.waitForFunction(() => document.querySelector('[data-testid=playlist-status]')?.textContent.includes('Saved'));
      await page.getByTestId('button-save-playlist').click();
      await page.waitForFunction(() => document.querySelector('[data-testid=playlist-error]')?.textContent.includes('already exists'));
      await page.reload();
      await page.getByTestId('select-saved-playlist').selectOption('saved-0');
      await page.getByTestId('button-load-playlist').click();
      await page.waitForFunction(() => document.querySelector('[data-testid=playlist-status]')?.textContent.includes('Loaded'));
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
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});