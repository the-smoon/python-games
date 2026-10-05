import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { ReplitConnectors } from '@replit/connectors-sdk';

// Opt-in only: writes a temporary playlist and MP3 to the connected library.
// Secrets are consumed by the test runtime, never printed or saved to traces.
test('live Drive shared save/load and owner-only MP3 upload', {
  skip: process.env.RHYTHM_FIGHTER_LIVE_TEST !== '1' && process.env.AUDIOSTRIKE_LIVE_TEST !== '1', timeout: 180_000,
}, async () => {
  assert.ok(process.env.AUDIOSTRIKE_OWNER_PASSWORD, 'Owner password must be configured');
  const executablePath = process.env.CHROMIUM_PATH || execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim();
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  const created = [], connectors = new ReplitConnectors();
  const unique = `Rhythm Fighter verification ${randomUUID()}`;
  try {
    const context = await browser.newContext({ viewport: { width: 402, height: 874 } });
    context.setDefaultTimeout(15_000);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.RHYTHM_FIGHTER_TEST_URL || process.env.AUDIOSTRIKE_TEST_URL || 'http://localhost:80/');
    assert.equal(await page.getByTestId('button-analyze').isDisabled(), true);
    assert.equal(await page.getByTestId('input-owner-upload').count(), 0);
    const add = page.getByTestId('library-tracks').getByRole('button', { name: 'Add', exact: true }).first();
    await add.waitFor();
    await add.click();
    await page.getByTestId('input-playlist-name').waitFor({ timeout: 60_000 });
    await page.getByTestId('input-playlist-name').fill(unique);
    const savedResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/playlists' && response.request().method() === 'POST');
    await page.getByTestId('button-save-playlist').click();
    const saved = await savedResponse;
    assert.equal(saved.status(), 201);
    const summary = await saved.json();
    created.push(summary.id);
    console.log('Live verification: shared playlist saved');
    await page.waitForFunction(() => document.querySelector('[data-testid=playlist-status]')?.textContent.startsWith('Saved'));

    const playerContext = await browser.newContext();
    const player = await playerContext.newPage();
    await player.goto(process.env.RHYTHM_FIGHTER_TEST_URL || process.env.AUDIOSTRIKE_TEST_URL || 'http://localhost:80/');
    await player.getByTestId('select-saved-playlist').selectOption(summary.id);
    await player.getByTestId('button-load-playlist').click();
    await player.waitForFunction(() => document.querySelector('[data-testid=playlist-status]')?.textContent.startsWith('Loaded'), null, { timeout: 60_000 });
    assert.equal(await player.getByTestId('button-analyze').isEnabled(), true);
    const forbidden = await player.request.post(new URL('/api/playlists/upload', player.url()).href, {
      headers: { 'Content-Type': 'audio/mpeg', 'X-Filename': 'blocked.mp3' }, data: Buffer.from('invalid'),
    });
    assert.equal(forbidden.status(), 403);
    console.log('Live verification: second player loaded playlist; anonymous upload rejected');

    await page.getByTestId('input-owner-password').fill(process.env.AUDIOSTRIKE_OWNER_PASSWORD);
    await page.getByTestId('button-owner-signin').click();
    await page.getByTestId('input-owner-upload').waitFor();
    console.log('Live verification: owner signed in');
    const uploadResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/playlists/upload');
    await page.getByTestId('input-owner-upload').setInputFiles({
      name: `${unique}.mp3`, mimeType: 'audio/mpeg',
      buffer: await readFile(new URL('../../api-server/tests/fixtures/tone.mp3', import.meta.url)),
    });
    const upload = await uploadResponse;
    assert.equal(upload.status(), 201);
    // Chromium may discard Network.getResponseBody for file-input uploads.
    // Verify the actual persisted library entry through a fresh API request.
    const libraryResponse = await context.request.get(new URL('/api/playlists/library', page.url()).href);
    assert.equal(libraryResponse.status(), 200);
    const track = (await libraryResponse.json()).find(track => track.title === `${unique}.mp3`);
    assert.ok(track, 'Uploaded MP3 must appear in a fresh library request');
    created.push(track.id);
    console.log('Live verification: owner MP3 upload accepted');
    await page.getByTestId(`button-add-${track.id}`).waitFor({ state: 'attached' });
    console.log('Live verification: uploaded MP3 appears in library');
    await page.getByTestId('button-owner-signout').click();
    await page.getByTestId('input-owner-password').waitFor();
    assert.equal(await page.getByTestId('input-owner-upload').count(), 0);
    console.log('Live verification: owner signed out');
    assert.deepEqual(errors, []);
    await playerContext.close();
  } finally {
    await browser.close();
    // Only trash exact IDs this test created. Never touch the user's existing songs.
    for (const id of created) {
      const response = await connectors.createProxyFetch('google-drive')(`/drive/v3/files/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }), signal: AbortSignal.timeout(15_000),
      });
      assert.equal(response.ok, true, 'Temporary verification file cleanup failed');
    }
    console.log('Live verification: temporary Drive files cleaned up');
  }
});