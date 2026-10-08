import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { selectMockPlaylist } from './drivePlaylistFixture.mjs';

const url = process.env.RHYTHM_FIGHTER_TEST_URL || process.env.AUDIOSTRIKE_TEST_URL || 'http://localhost:80/';

function tone(hz) {
  const rate = 8000, wav = Buffer.alloc(44 + rate * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(rate * 2, 40);
  for (let i = 0; i < rate; i++) wav.writeInt16LE(Math.round(Math.sin(i / rate * Math.PI * 2 * hz) * 14000), 44 + i * 2);
  return wav;
}

test('boss blast and safe-lane laser damage through temporary invulnerability', { timeout: 60000 }, async () => {
  const executablePath = process.env.CHROMIUM_PATH || execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim();
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install();
    await page.addInitScript(() => {
      window.__RHYTHM_FIGHTER_TEST_MODE__ = true;
      Math.random = () => .7;
    });
    const files = [
      { name: 'boss-damage-bass.mp3', buffer: tone(271) },
      { name: 'boss-damage-bright.mp3', buffer: tone(1413) },
    ];
    await page.goto(url);
    await selectMockPlaylist(page, files);
    await page.getByTestId('button-analyze').click();
    await page.waitForFunction(() => window.__AUDIOSTRIKE_TEST__?.snapshot().state === 'PLAYING');
    const snapshot = () => page.evaluate(() => window.__AUDIOSTRIKE_TEST__.snapshot());

    await page.clock.fastForward(30100);
    await page.clock.runFor(5200);
    await page.waitForFunction(() => window.__AUDIOSTRIKE_TEST__.snapshot().state === 'BOSS');
    await page.clock.runFor(3000);
    const boss = (await snapshot()).bosses[0];
    assert.equal(boss.phase, 'PHASE1');

    await page.evaluate(id => {
      const api = window.__AUDIOSTRIKE_TEST__;
      api.setBossHealth(id, 100000);
      api.clearArena();
      api.setPlayer({ x: 210, y: 760, vx: 0, vy: 0, health: 100, invincible: 1e9 });
      api.castSecondary(id, 'BLAST');
    }, boss.id);
    await page.clock.runFor(80);
    let state = await snapshot();
    const blast = state.blasts.find(item => item.kind === 'BLAST' && !item.detonated);
    assert.ok(blast, 'the boss creates a delayed blast');
    await page.clock.runFor(Math.max(0, (blast.explodeAt - state.now + .12) * 1000));
    assert.equal((await snapshot()).playerHealth, 82, 'the blast damages the player despite hit-invulnerability');

    await page.evaluate(id => {
      const api = window.__AUDIOSTRIKE_TEST__;
      api.clearArena();
      api.setPlayer({ x: 0, y: 760, vx: 0, vy: 0, health: 100, invincible: 1e9 });
      api.castSecondary(id, 'SWEEP');
    }, boss.id);
    await page.clock.runFor(80);
    state = await snapshot();
    assert.equal(state.bossBeams.length, 1, 'the boss creates its safe-lane laser');
    const beam = state.bossBeams[0];
    const progressAtPlayer = Math.max(0, Math.min(1, (760 - beam.startY) / (beam.endY - beam.startY)));
    const playerCrossingAt = beam.activeAt + progressAtPlayer * (beam.endsAt - beam.activeAt);
    await page.clock.runFor(Math.max(0, (playerCrossingAt - state.now + .18) * 1000));
    assert.equal((await snapshot()).playerHealth, 84, 'the beam damages outside its safe lane despite hit-invulnerability');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
