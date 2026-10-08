import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { createSongDesignPreview } from '../src/songDesign.ts';

const url = process.env.RHYTHM_FIGHTER_TEST_URL || process.env.AUDIOSTRIKE_TEST_URL || 'http://localhost:80/';
function tone(hz) {
  const rate = 8000, wav = Buffer.alloc(44 + rate * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(rate * 2, 40);
  for (let i = 0; i < rate; i++) wav.writeInt16LE(Math.round(Math.sin(i / rate * Math.PI * 2 * hz) * 9000), 44 + i * 2);
  return wav;
}

test('playlist previews refresh from saved song analyses and do not change the run analysis', { timeout: 90000 }, async () => {
  const executablePath = process.env.CHROMIUM_PATH || execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim();
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
    const songs = [
      { id: 'A', title: 'Bass track', bytes: tone(180), signature: { rms: .5, onset: .28, low: .86, mid: .22, high: .06, centroid: .16, flatness: .12, pulse: true, tempo: 124 } },
      { id: 'B', title: 'Bright track', bytes: tone(1700), signature: { rms: .46, onset: .82, low: .08, mid: .29, high: .9, centroid: .86, flatness: .62, pulse: true, tempo: 154 } },
    ].map((song) => {
      const hash = createHash('sha256').update(song.bytes).digest('hex');
      const document = {
        version: 1, duration: 2, analyzedSeconds: 2, signature: song.signature,
        motifs: Array.from({ length: 8 }, (_, i) => ({ ...song.signature, centroid: Math.max(0, Math.min(1, song.signature.centroid + i * .005)) })),
      };
      return { ...song, hash, document };
    });
    const library = songs.map(({ id, title, bytes }) => ({ id, title, size: bytes.length }));
    const cacheRequests = [];
    page.on('pageerror', (error) => assert.fail(error.message));
    await page.clock.install();
    await page.addInitScript(() => { window.__AUDIOSTRIKE_TEST_MODE__ = true; Math.random = () => .7; });
    await page.route('**/api/playlists**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/owner')) { await route.fulfill({ json: { owner: false, configured: false } }); return; }
      if (path.endsWith('/library')) { await route.fulfill({ json: library }); return; }
      if (path.includes('/audio/')) {
        const song = songs.find((item) => item.id === path.split('/').pop());
        await route.fulfill({ status: 200, contentType: 'audio/mpeg', headers: { 'content-length': String(song.bytes.length) }, body: song.bytes });
        return;
      }
      await route.fulfill({ json: [] });
    });
    await page.route('**/api/song-analysis/**', async (route) => {
      const request = route.request();
      const hash = new URL(request.url()).pathname.split('/').pop();
      const song = songs.find((item) => item.hash === hash);
      cacheRequests.push(request.method());
      if (request.method() === 'GET' && song) {
        await route.fulfill({ status: 200, json: song.document });
      } else {
        await route.fulfill({ status: 500, json: { error: 'Unexpected analysis request' } });
      }
    });

    await page.goto(url);
    await page.getByTestId('button-add-A').click();
    await page.getByTestId('button-remove-A').waitFor();
    await page.waitForFunction(() => {
      const canvas = document.querySelector('[data-testid="song-style-preview-canvas"]');
      return canvas?.getAttribute('data-enemy-shape') && canvas?.getAttribute('data-boss-shape');
    });
    const preview = page.getByTestId('song-style-preview-canvas');
    const firstExpected = createSongDesignPreview({ ...songs[0].document, analyzed: true, songKey: songs[0].hash });
    assert.equal(await preview.getAttribute('data-enemy-shape'), firstExpected.enemy.shape);
    assert.equal(await preview.getAttribute('data-boss-shape'), firstExpected.boss.shape);
    assert.equal(await page.getByTestId('panel-game').count(), 0, 'previewing does not start gameplay');

    await page.getByTestId('button-add-B').click();
    await page.getByTestId('button-remove-B').waitFor();
    await page.getByTestId('button-preview-B').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="song-style-preview"]')?.textContent.includes('Bright track') &&
      Boolean(document.querySelector('[data-testid="song-style-preview-canvas"]')?.getAttribute('data-enemy-shape')));
    const secondExpected = createSongDesignPreview({ ...songs[1].document, analyzed: true, songKey: songs[1].hash });
    assert.equal(await preview.getAttribute('data-enemy-shape'), secondExpected.enemy.shape);
    assert.equal(await preview.getAttribute('data-boss-shape'), secondExpected.boss.shape);
    assert.notDeepEqual(firstExpected, secondExpected);
    assert.deepEqual(cacheRequests, ['GET', 'GET'], 'each selected song loads its saved full-track analysis');

    await page.getByTestId('button-analyze').click();
    await page.waitForFunction(() => window.__AUDIOSTRIKE_TEST__?.snapshot().state === 'PLAYING');
    const run = await page.evaluate(() => window.__AUDIOSTRIKE_TEST__.snapshot());
    assert.equal(run.stageAnalysis.songKey, songs[0].hash);
    assert.deepEqual(cacheRequests, ['GET', 'GET'], 'the match reuses prepared analyses instead of changing or re-fetching them');
  } finally {
    await browser.close();
  }
});
