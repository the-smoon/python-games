import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { selectMockPlaylist } from './drivePlaylistFixture.mjs';
import { BLAST_CHARGE_SECONDS } from '../src/bossAbilities.ts';

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

test('cached analysis survives reload; fast zones, temporary buffs and boss-death pixels work in portrait', { timeout: 90000 }, async () => {
  const executablePath = process.env.CHROMIUM_PATH || execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim();
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
    const errors = [], cacheCalls = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.url().includes('/api/song-analysis/')) cacheCalls.push({ method: response.request().method(), status: response.status() });
    });
    await page.clock.install();
    await page.addInitScript(() => { window.__RHYTHM_FIGHTER_TEST_MODE__ = true; Math.random = () => .7; });
    const files = [{ name: 'rework-bass.mp3', buffer: tone(271) }, { name: 'rework-bright.mp3', buffer: tone(1413) }];
    await page.goto(url); await selectMockPlaylist(page, files);
    const start = async () => {
      await page.getByTestId('button-analyze').click();
      await page.waitForFunction(() => window.__AUDIOSTRIKE_TEST__?.snapshot().state === 'PLAYING');
    };
    await start();
    const snap = () => page.evaluate(() => window.__AUDIOSTRIKE_TEST__.snapshot());
    const first = await snap();
    assert.match(first.stageAnalysis.songKey, /^[a-f0-9]{64}$/);
    assert.notEqual(first.stageAnalysis.songKey, first.bossAnalysis.songKey);
    assert.notDeepEqual(first.stageAnalysis.design.colors, first.bossAnalysis.design.colors);
    for (const hash of [first.stageAnalysis.songKey, first.bossAnalysis.songKey]) {
      const result = await page.request.get(`${url}api/song-analysis/${hash}`);
      assert.equal(result.status(), 200, 'analysis persisted in the shared database');
      const document = await result.json();
      assert.equal(document.version, 1); assert.equal(document.motifs.length, 8);
      assert.equal('audio' in document, false);
    }
    await selectMockPlaylist(page, files); cacheCalls.length = 0;
    await start();
    assert.equal(cacheCalls.filter(c => c.method === 'GET' && c.status === 200).length, 2);
    assert.equal(cacheCalls.filter(c => c.method === 'PUT').length, 0, 'a fresh page reuses analysis without decoding and resaving');
    assert.deepEqual((await snap()).stageAnalysis.design, first.stageAnalysis.design);
    await page.evaluate(() => window.__AUDIOSTRIKE_TEST__.setPlayer({ invincible: 1e9 }));
    await page.clock.fastForward(30100);
    await page.clock.runFor(5200);
    await page.waitForFunction(() => window.__AUDIOSTRIKE_TEST__.snapshot().state === 'BOSS');
    await page.clock.runFor(3000);
    assert.equal((await snap()).bosses[0].phase, 'PHASE1');
    let boss = (await snap()).bosses[0];
    await page.evaluate(id => {
      const api = window.__AUDIOSTRIKE_TEST__;
      api.setBossHealth(id, 100000); api.clearArena();
      api.setPlayer({ x: 210, y: 760, vx: 0, vy: 0, invincible: 1e9, health: 100 });
      api.castSecondary(id, 'BLAST');
    }, boss.id);
    await page.clock.runFor(40);
    const charged = await snap();
    assert.ok(charged.blasts.some(b => b.kind === 'BLAST' && !b.detonated));
    assert.ok(charged.blasts.every(b => Math.abs(b.explodeAt - b.createdAt - BLAST_CHARGE_SECONDS) < 1e-9));
    assert.ok(BLAST_CHARGE_SECONDS < 1, 'boss blasts retain their fast warning');
    await page.clock.runFor((BLAST_CHARGE_SECONDS - .15) * 1000);
    assert.ok((await snap()).blasts.some(b => !b.detonated), 'zones remain telegraphed until detonation');
    assert.equal((await snap()).playerHealth, 100, 'the warning does not deal damage');
    await page.clock.runFor(200);
    assert.ok((await snap()).playerHealth <= 82, 'a completed boss blast pierces temporary invulnerability');
    await page.evaluate(id => {
      const api = window.__AUDIOSTRIKE_TEST__;
      api.clearArena(); api.castSecondary(id, 'DEBUFF');
    }, boss.id);
    await page.clock.runFor(4900);
    await page.evaluate(() => window.__AUDIOSTRIKE_TEST__.setPlayer({ invincible: 0, health: 100 }));
    await page.clock.runFor(180);
    const debuffed = await snap();
    assert.ok(debuffed.player.debuffUntil > debuffed.now);
    assert.ok(debuffed.player.debuffUntil - debuffed.now <= 5);
    await page.evaluate(id => {
      const api = window.__AUDIOSTRIKE_TEST__;
      api.clearArena();
      api.setPlayer({ x: 0, y: 760, vx: 0, vy: 0, invincible: 1e9, health: 100 });
      api.castSecondary(id, 'SWEEP');
    }, boss.id);
    await page.clock.runFor(80);
    const sweepSetup = await snap();
    assert.equal(sweepSetup.bossBeams.length, 1, 'the boss creates its moving-safe-lane laser');
    const sweep = sweepSetup.bossBeams[0];
    const progressAtPlayer = Math.max(0, Math.min(1, (760 - sweep.startY) / (sweep.endY - sweep.startY)));
    const playerCrossingAt = sweep.activeAt + progressAtPlayer * (sweep.endsAt - sweep.activeAt);
    await page.clock.runFor(Math.max(0, (playerCrossingAt - sweepSetup.now + .18) * 1000));
    assert.equal((await snap()).playerHealth, 84, 'the boss beam pierces temporary invulnerability outside its safe lane');
    await page.evaluate(id => {
      const api = window.__AUDIOSTRIKE_TEST__;
      api.clearArena(); api.setPlayer({ invincible: 1e9 });
      api.spawnTarget(80, 310, 1e8, false, .1, 40); api.castSecondary(id, 'BUFF');
    }, boss.id);
    await page.clock.runFor(40);
    assert.ok((await snap()).enemies[0].buffUntil > (await snap()).now);
    await page.clock.runFor(5100);
    const recovered = await snap();
    assert.ok(recovered.enemies[0].buffUntil < recovered.now);
    assert.ok(recovered.player.debuffUntil < recovered.now);
    await mkdir('screenshots', { recursive: true });
    await page.screenshot({ path: 'screenshots/rhythmfighter-geometric-boss.png' });
    await page.evaluate(id => {
      const api = window.__AUDIOSTRIKE_TEST__;
      api.setBossHealth(id, 1); api.drop('BOMB');
    }, boss.id);
    await page.clock.runFor(70);
    const death = await snap();
    assert.ok(death.pixelCount >= 60, 'boss death emits luminous radial pixels');
    assert.equal(death.shockwaves.length, 1);
    assert.ok(death.debris.length >= 20);
    const survivor = death.enemies.find(e => e.health > 1e7);
    assert.ok(survivor.stunnedUntil > death.now);
    assert.ok(survivor.confusedUntil > death.now + 5);
    assert.equal(death.blasts.filter(b => b.ownerId === boss.id).length, 0);
    await page.screenshot({ path: 'screenshots/rhythmfighter-boss-death.png' });
    await page.clock.runFor(700);
    assert.ok((await snap()).debris.some(d => d.generation > 0), 'large pieces shed smaller debris');
    await page.clock.runFor(5100);
    const afterDeath = await snap();
    assert.ok(afterDeath.enemies.filter(e => e.health > 1e7).every(e => e.confusedUntil < afterDeath.now));
    assert.equal(afterDeath.level, 2);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});