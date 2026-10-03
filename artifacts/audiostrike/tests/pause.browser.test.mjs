import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { BOSS_ARRIVAL_SECONDS, STAGE_LEVEL_SECONDS } from '../src/gameRules.ts';

function toneWav() {
  const sampleRate = 8000;
  const samples = sampleRate * 8;
  const wav = Buffer.alloc(44 + samples * 2);
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
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    wav.writeInt16LE(Math.round(Math.sin(i / sampleRate * Math.PI * 220) * 8000), 44 + i * 2);
  }
  return wav;
}

test('touch and keyboard pause preserve stage, crossfade, boss, and weapon timing', { timeout: 60000 }, async () => {
  const executablePath = process.env.CHROMIUM_PATH || execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim();
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 402, height: 874 }, hasTouch: true, isMobile: true });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install();
    await page.addInitScript(() => { window.__AUDIOSTRIKE_TEST_MODE__ = true; });
    await page.goto(process.env.AUDIOSTRIKE_TEST_URL || 'http://localhost:80/');
    for (const kind of ['stage', 'boss']) {
      await page.getByTestId(`input-${kind}-file`).setInputFiles({
        name: `${kind}.wav`, mimeType: 'audio/wav', buffer: toneWav(),
      });
    }
    await page.getByTestId('button-analyze').tap();
    await page.waitForFunction(() => window.__AUDIOSTRIKE_TEST__?.snapshot().state === 'PLAYING');
    const snapshot = () => page.evaluate(() => window.__AUDIOSTRIKE_TEST__.snapshot());
    await page.evaluate(() => {
      const api = window.__AUDIOSTRIKE_TEST__;
      api.clearArena();
      api.setPlayer({ invincible: 1e9 });
      api.drop('RAPID');
    });
    await page.clock.runFor(50);
    await page.evaluate(() => window.__AUDIOSTRIKE_TEST__.drop('SHIELD', 40, 100));

    const pause = page.getByTestId('button-pause');
    const buttonBox = await pause.boundingBox();
    const hudBox = await page.locator('.hud-top').boundingBox();
    const weaponBox = await page.getByTestId('hud-weapon').boundingBox();
    assert.ok(buttonBox.height >= 44, 'touch target is at least 44px tall');
    assert.ok(buttonBox.y >= hudBox.y + hudBox.height, 'pause is below top HUD');
    assert.ok(buttonBox.x >= weaponBox.x + weaponBox.width, 'pause does not overlap weapon HUD');

    async function assertFrozen() {
      const frozen = await snapshot();
      const timer = await page.getByTestId('text-stage-time').allTextContents();
      assert.equal(frozen.paused, true);
      assert.equal(frozen.stageAudioPaused, true);
      assert.equal(frozen.bossAudioPaused, true);
      await page.clock.fastForward(120000);
      assert.deepEqual(await snapshot(), frozen, 'all captured combat and audio state stays unchanged during a long pause');
      assert.deepEqual(await page.getByTestId('text-stage-time').allTextContents(), timer);
      return frozen;
    }

    await pause.tap();
    const stagePaused = await assertFrozen();
    await page.getByTestId('button-resume').tap();
    await page.waitForFunction(() => !window.__AUDIOSTRIKE_TEST__.snapshot().stageAudioPaused);
    const stageResumed = await snapshot();
    assert.equal(stageResumed.paused, false);
    assert.ok(stageResumed.stageTime - stagePaused.stageTime < .25, 'stage does not catch up after pause');
    assert.equal(stageResumed.weapon.rapidUntil, stagePaused.weapon.rapidUntil);
    assert.ok(stageResumed.weapon.rapidUntil > stageResumed.now, 'rapid fire retains its remaining duration');
    assert.equal(stageResumed.drops.length, 1, 'uncollected pickup survives long pause');
    assert.ok(stageResumed.drops[0].expiresAt > stageResumed.now);
    await page.clock.runFor(100);
    assert.ok((await snapshot()).stageTime > stageResumed.stageTime, 'stage advances after resume');

    // Keyboard pauses use the same preserved clock and cannot be toggled by key repeats.
    await page.keyboard.press('KeyP');
    await assertFrozen();
    await page.keyboard.press('Escape');
    await page.clock.fastForward(STAGE_LEVEL_SECONDS * 1000);
    await page.waitForFunction(() => window.__AUDIOSTRIKE_TEST__.snapshot().state === 'BOSS_INTRO');
    await page.getByTestId('button-pause').tap();
    await assertFrozen();
    await page.getByTestId('button-resume').tap();
    await page.waitForFunction(() => {
      const s = window.__AUDIOSTRIKE_TEST__.snapshot();
      return !s.stageAudioPaused && s.bossAudioPaused;
    });
    await page.clock.runFor(BOSS_ARRIVAL_SECONDS * 1000 + 100);
    await page.waitForFunction(() => window.__AUDIOSTRIKE_TEST__.snapshot().state === 'BOSS');
    await page.getByTestId('button-pause').tap();
    const bossPaused = await assertFrozen();
    await page.getByTestId('button-resume').tap();
    await page.waitForFunction(() => !window.__AUDIOSTRIKE_TEST__.snapshot().bossAudioPaused);
    const bossResumed = await snapshot();
    assert.equal(bossResumed.stageAudioPaused, true, 'boss resume does not restart stage track');
    assert.equal(bossResumed.bossHealth, bossPaused.bossHealth);
    assert.ok(Math.abs(bossResumed.bossAudioTime - bossPaused.bossAudioTime) < .25, 'boss track resumes without seeking or restarting');
    await page.clock.runFor(100);
    assert.notEqual((await snapshot()).bossY, bossPaused.bossY, 'boss moves after resume');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});