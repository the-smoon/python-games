import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { ReplitConnectors } from '@replit/connectors-sdk';

// Opt-in only: writes a temporary shared playlist to the connected library.
// Secrets are consumed by the test runtime, never printed or saved to traces.
test('live Drive shared save/load and anonymous upload rejection', {
  skip: process.env.AUDIOSTRIKE_LIVE_TEST !== '1', timeout: 180_000,
}, async () => {
  const executablePath = process.env.CHROMIUM_PATH || execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim();
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  const created = [], connectors = new ReplitConnectors();
  const unique = `Rhythm Fighter verification ${randomUUID()}`;
  try {
    const context = await browser.newContext({ viewport: { width: 402, height: 874 } });
    context.setDefaultTimeout(15_000);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.AUDIOSTRIKE_TEST_URL || 'http://localhost:80/audiostrike-legacy/');
    assert.equal(await page.getByTestId('button-analyze').isDisabled(), true);
    assert.equal(await page.getByTestId('input-owner-upload').count(), 0);
    assert.equal(await page.getByTestId('input-owner-password').count(), 0);
    const ownerSignIn = page.getByTestId('button-owner-signin');
    if (await ownerSignIn.count()) {
      assert.equal(new URL(await ownerSignIn.getAttribute('href'), page.url()).searchParams.get('returnTo'), '/audiostrike-legacy/');
    }
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
    await player.goto(process.env.AUDIOSTRIKE_TEST_URL || 'http://localhost:80/');
    await player.getByTestId('select-saved-playlist').selectOption(summary.id);
    await player.getByTestId('button-load-playlist').click();
    await player.waitForFunction(() => document.querySelector('[data-testid=playlist-status]')?.textContent.startsWith('Loaded'), null, { timeout: 60_000 });
    assert.equal(await player.getByTestId('button-analyze').isEnabled(), true);
    const forbidden = await player.request.post(new URL('/api/playlists/upload', player.url()).href, {
      headers: { 'Content-Type': 'audio/mpeg', 'X-Filename': 'blocked.mp3' }, data: Buffer.from('invalid'),
    });
    assert.equal(forbidden.status(), 403);
    console.log('Live verification: second player loaded playlist; anonymous upload rejected');

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