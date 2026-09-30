import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { BOSS_ARRIVAL_SECONDS, STAGE_LEVEL_SECONDS } from '../src/gameRules.ts';

const url = process.env.AUDIOSTRIKE_TEST_URL || 'http://localhost:80/';

function toneWav(hz) {
  const sampleRate = 8000;
  const samples = sampleRate;
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
  for (let index = 0; index < samples; index += 1) {
    const envelope = index % 2000 < 1100 ? 0.35 : 0.08;
    wav.writeInt16LE(Math.round(Math.sin(index / sampleRate * Math.PI * 2 * hz) * 32767 * envelope), 44 + index * 2);
  }
  return wav;
}

test('continuous stages keep stars moving, reuse both tracks, and scale the next boss', { timeout: 45000 }, async () => {
  const executablePath = process.env.CHROMIUM_PATH || execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim();
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install();
    await page.addInitScript(() => { window.__AUDIOSTRIKE_TEST_MODE__ = true; });
    assert.equal((await page.goto(url))?.status(), 200);
    await page.getByTestId('input-stage-file').setInputFiles({ name: 'stage.wav', mimeType: 'audio/wav', buffer: toneWav(110) });
    await page.getByTestId('input-boss-file').setInputFiles({ name: 'boss.wav', mimeType: 'audio/wav', buffer: toneWav(1100) });
    await page.getByTestId('button-analyze').click();
    await page.waitForFunction(() => window.__AUDIOSTRIKE_TEST__?.snapshot().state === 'PLAYING');
    const snapshot = () => page.evaluate(() => window.__AUDIOSTRIKE_TEST__.snapshot());
    const firstStage = await snapshot();
    assert.equal(firstStage.level, 1);
    assert.equal(firstStage.stageAudioPaused, false);
    assert.equal(firstStage.bossAudioPaused, true);

    await page.clock.fastForward((STAGE_LEVEL_SECONDS + 0.1) * 1000);
    await page.waitForFunction(() => window.__AUDIOSTRIKE_TEST__?.snapshot().state === 'BOSS_INTRO');
    const transition = await snapshot();
    assert.equal(transition.bossAudioPaused, false);
    assert.equal(transition.stageAudioPaused, false);
    await page.clock.runFor(2000);
    const midTransition = await snapshot();
    assert.equal(midTransition.state, 'BOSS_INTRO');
    assert.equal(midTransition.spawnIndex, transition.spawnIndex, 'the five-second transition adds no stage enemies');
    assert.notEqual(midTransition.starY, transition.starY, 'stars move during the transition');
    await page.clock.runFor((BOSS_ARRIVAL_SECONDS - 2) * 1000 + 200);
    await page.waitForFunction(() => window.__AUDIOSTRIKE_TEST__?.snapshot().state === 'BOSS');
    const firstBoss = await snapshot();
    assert.ok(firstBoss.bossY + firstBoss.bossRadius > 0 && firstBoss.bossY < 120, 'boss is visible at the five-second arrival');
    assert.ok(firstBoss.bossMaxHealth >= 1050 && firstBoss.bossMaxHealth <= 1300, 'first boss has half the old health baseline');
    assert.equal(firstBoss.stageAudioPaused, true);
    assert.equal(firstBoss.bossAudioPaused, false);
    await page.evaluate(() => window.__AUDIOSTRIKE_TEST__.spawnSubBoss());
    assert.ok((await snapshot()).subBossCount >= 1, 'boss has independently tracked sub-bosses');

    await page.evaluate(() => window.__AUDIOSTRIKE_TEST__.finishBoss());
    const healthOnKill = (await snapshot()).playerHealth;
    await page.clock.runFor(600);
    const dying = await snapshot();
    assert.equal(dying.state, 'BOSS');
    assert.equal(dying.subBossCount, 0, 'sub-bosses stop attacking on the killing blow');
    assert.equal(dying.hostileShots, 0, 'incoming shots clear on the killing blow');
    assert.equal(dying.playerHealth, healthOnKill, 'the player cannot lose during boss death');
    await page.clock.runFor(2000);
    await page.waitForFunction(() => window.__AUDIOSTRIKE_TEST__?.snapshot().level === 2);
    const secondStage = await snapshot();
    assert.equal(secondStage.state, 'PLAYING');
    assert.equal(secondStage.subBossCount, 0, 'sub-bosses are cleared at level change');
    assert.equal(secondStage.stageAudioSrc, firstStage.stageAudioSrc, 'the first song is reused');
    assert.equal(secondStage.bossAudioSrc, firstStage.bossAudioSrc, 'the second song is reused');
    assert.equal(secondStage.stageAudioPaused, false);
    assert.equal(secondStage.bossAudioPaused, true);
    assert.ok(secondStage.stageTime < 1, 'the stage timer restarts');
    assert.ok(secondStage.playerHealth > 0, 'the player survives the level change');
    assert.notEqual(secondStage.starY, firstBoss.starY, 'the starfield continues across levels');
    assert.match(await page.getByTestId('text-level').innerText(), /Level\s*2/i);

    await page.clock.fastForward((STAGE_LEVEL_SECONDS + 0.1) * 1000);
    await page.waitForFunction(() => window.__AUDIOSTRIKE_TEST__?.snapshot().state === 'BOSS_INTRO');
    await page.clock.runFor(BOSS_ARRIVAL_SECONDS * 1000 + 100);
    await page.waitForFunction(() => window.__AUDIOSTRIKE_TEST__?.snapshot().state === 'BOSS');
    const secondBoss = await snapshot();
    assert.ok(secondBoss.bossMaxHealth > firstBoss.bossMaxHealth, 'later bosses are harder');
    assert.deepEqual(errors, [], `browser errors: ${errors.join(', ')}`);
  } finally {
    await browser.close();
  }
});