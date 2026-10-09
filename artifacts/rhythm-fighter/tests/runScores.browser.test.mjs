import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { selectMockPlaylist } from './drivePlaylistFixture.mjs';

const url = process.env.RHYTHM_FIGHTER_TEST_URL || process.env.AUDIOSTRIKE_TEST_URL || 'http://localhost:80/';

function toneWav(hz) {
  const sampleRate = 8000;
  const wav = Buffer.alloc(44 + sampleRate * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(sampleRate * 2, 40);
  for (let index = 0; index < sampleRate; index += 1) {
    wav.writeInt16LE(Math.round(Math.sin(index / sampleRate * Math.PI * 2 * hz) * 18000), 44 + index * 2);
  }
  return wav;
}

test('game over allows replay without saving and retains a bounded callsign for retry', { timeout: 45000 }, async () => {
  const executablePath = process.env.CHROMIUM_PATH || execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim();
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 402, height: 874 } });
    const errors = [];
    const submissions = [];
    let responses = 0;
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install();
    await page.addInitScript(() => { window.__RHYTHM_FIGHTER_TEST_MODE__ = true; });
    await page.route('**/api/run-scores', async (route) => {
      const input = route.request().postDataJSON();
      submissions.push(input);
      responses += 1;
      if (responses === 1) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Run score could not be saved. Try again."}' });
        return;
      }
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 1, ...input, createdAt: '2026-10-04T12:00:00.000Z' }),
      });
    });

    assert.equal((await page.goto(url))?.status(), 200);
    await selectMockPlaylist(page, [{ name: 'stage.mp3', buffer: toneWav(110) }, { name: 'boss.mp3', buffer: toneWav(880) }]);
    await page.getByTestId('input-playlist-name').fill('Flight mix');
    await page.getByTestId('button-analyze').click();
    await page.waitForFunction(() => window.__AUDIOSTRIKE_TEST__?.snapshot().state === 'PLAYING');

    await page.evaluate(() => {
      window.__AUDIOSTRIKE_TEST__.setScore(12345);
      window.__AUDIOSTRIKE_TEST__.endRun();
    });
    await page.getByTestId('overlay-game-over').waitFor();
    assert.equal((await page.getByTestId('text-final-run-score').innerText()).toLowerCase(), 'final score 12345');
    assert.match(await page.getByTestId('text-run-progress').innerText(), /Level reached 1.*No boss reached/i);
    assert.equal(await page.getByTestId('button-save-run-score').isDisabled(), false,
      'the generated callsign makes the voluntary save control available immediately');
    const firstSuggestion = page.getByTestId('input-run-score-name');
    assert.match(await firstSuggestion.inputValue(), /^[A-Z]+-\d{2}$/);
    await page.getByTestId('button-clear-run-score-name').click();
    assert.equal(await firstSuggestion.inputValue(), '');
    assert.equal(submissions.length, 0, 'game over does not save a score or playlist details on its own');

    await page.getByTestId('button-replay-game-over').click();
    await page.clock.runFor(4000);
    await page.waitForFunction(() => window.__AUDIOSTRIKE_TEST__?.snapshot().state === 'PLAYING');
    assert.equal(submissions.length, 0, 'replaying does not submit the previous run');
    assert.deepEqual((await page.evaluate(() => window.__AUDIOSTRIKE_TEST__.snapshot())).runProgress, {
      levelReached: 1,
      bossLevelReached: null,
    });

    await page.evaluate(() => {
      window.__AUDIOSTRIKE_TEST__.setScore(98765);
      window.__AUDIOSTRIKE_TEST__.endRun();
    });
    await page.getByTestId('overlay-game-over').waitFor();
    const name = page.getByTestId('input-run-score-name');
    assert.equal(await name.getAttribute('maxlength'), '24');
    assert.match(await name.inputValue(), /^[A-Z]+-\d{2}$/);
    await page.getByTestId('button-clear-run-score-name').click();
    assert.equal(await name.inputValue(), '');
    await name.fill('  NEON PILOT  ');
    assert.equal(await name.inputValue(), '  NEON PILOT  ');
    await page.getByTestId('button-save-run-score').click();
    await page.getByTestId('status-run-score').getByText('Could not save this run. Check your connection and retry.').waitFor();
    assert.equal(await name.inputValue(), '  NEON PILOT  ', 'the callsign stays available after a failed save');
    await page.getByTestId('button-save-run-score').click();
    await page.getByTestId('status-run-score').getByText('Run score saved').waitFor();

    assert.equal(submissions.length, 2, 'retry resubmits exactly once after the initial failure');
    assert.deepEqual(submissions[0], submissions[1], 'retry uses the same idempotency key and score data');
    assert.match(submissions[0].runId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.deepEqual({
      name: submissions[0].name,
      score: submissions[0].score,
      levelReached: submissions[0].levelReached,
      bossLevelReached: submissions[0].bossLevelReached,
      playlistMetadata: submissions[0].playlistMetadata,
    }, {
      name: 'NEON PILOT',
      score: 98765,
      levelReached: 1,
      bossLevelReached: null,
      playlistMetadata: {
        playlistName: 'Flight mix',
        intendedTrackOrder: [
          { trackId: 'fixture-0', title: 'stage.mp3' },
          { trackId: 'fixture-1', title: 'boss.mp3' },
        ],
        tracksPlayed: [
          { trackId: 'fixture-0', title: 'stage.mp3', startSeconds: 0, endSeconds: 1 },
        ],
      },
    });
    assert.equal(await page.getByTestId('button-save-run-score').count(), 0, 'a saved run cannot be submitted again from the UI');
    await page.getByTestId('button-return-main-menu').click();
    await page.getByTestId('panel-upload').waitFor();
    assert.equal((await page.evaluate(() => window.__AUDIOSTRIKE_TEST__.snapshot())).state, 'UPLOAD');
    assert.equal(await page.locator('[data-testid="playlist-tracks"] li').count(), 2, 'main menu keeps the selected playlist after game over');
    assert.deepEqual(errors, [], `browser errors: ${errors.join(', ')}`);
  } finally {
    await browser.close();
  }
});