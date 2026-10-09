import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { chromium } from 'playwright-core';

const url = process.env.RHYTHM_FIGHTER_TEST_URL || 'http://localhost:80/';

test('owner uploads stay hidden until the server confirms Google owner sign-in', { timeout: 30000 }, async () => {
  const executablePath = process.env.CHROMIUM_PATH || execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim();
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/playlists**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/owner')) { await route.fulfill({ json: { owner: false, configured: true } }); return; }
      if (path.endsWith('/library')) { await route.fulfill({ json: [] }); return; }
      await route.fulfill({ json: [] });
    });
    await page.goto(url);
    await page.getByTestId('owner-panel').waitFor();
    assert.equal(await page.getByTestId('input-owner-password').count(), 0, 'password sign-in must not render');
    assert.equal(await page.getByTestId('input-owner-upload').count(), 0, 'anonymous visitors must not see upload controls');
    assert.equal(await page.getByTestId('button-owner-signout').count(), 0);
    const signIn = page.getByTestId('button-owner-signin');
    const link = new URL(await signIn.getAttribute('href'), page.url());
    assert.equal(link.pathname, '/api/playlists/owner/google');
    assert.equal(link.searchParams.get('returnTo'), new URL(url).pathname);
    assert.equal(link.searchParams.has('client_secret'), false);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
