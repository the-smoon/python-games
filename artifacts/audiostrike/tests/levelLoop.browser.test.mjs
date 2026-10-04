import assert from 'node:assert/strict';
import { selectMockPlaylist } from './drivePlaylistFixture.mjs';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { BOSS_ARRIVAL_SECONDS, STAGE_LEVEL_SECONDS } from '../src/gameRules.ts';
import { audioIntensity, chooseAttack } from '../src/encounterRules.ts';

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
    await selectMockPlaylist(page, [{ name: 'stage.mp3', buffer: toneWav(110) }, { name: 'boss.mp3', buffer: toneWav(1100) }]);
    await page.getByTestId('button-analyze').click();
    await page.waitForFunction(() => window.__AUDIOSTRIKE_TEST__?.snapshot().state === 'PLAYING');
    const snapshot = () => page.evaluate(() => window.__AUDIOSTRIKE_TEST__.snapshot());
    const firstStage = await snapshot();
    assert.equal(firstStage.level, 1);
    assert.equal(firstStage.stageAudioPaused, false);
    assert.equal(firstStage.bossAudioPaused, true);

    await page.evaluate(() => {
      window.__AUDIOSTRIKE_TEST__.setPlayer({ invincible: 1e9 });
      window.__AUDIOSTRIKE_TEST__.spawnTarget(80, 150, 1e9, false, .001, 30);
    });
    const survivor = (state) => state.enemies.find((enemy) => !enemy.subBoss && enemy.health > 1e8);
    await page.clock.fastForward((STAGE_LEVEL_SECONDS + 0.1) * 1000);
    await page.waitForFunction(() => window.__AUDIOSTRIKE_TEST__?.snapshot().state === 'BOSS_INTRO');
    const transition = await snapshot();
    assert.equal(transition.bossAudioPaused, true, 'incoming boss is not audible until combat begins');
    assert.equal(transition.stageAudioPaused, false);
    assert.equal(survivor(transition)?.exiting, false, 'stage end does not force existing enemies to flee');
    assert.equal(survivor(transition)?.fireRate, 30, 'stage end preserves existing enemy attacks');
    await page.clock.runFor(2000);
    const midTransition = await snapshot();
    assert.equal(midTransition.state, 'BOSS_INTRO');
    assert.equal(midTransition.spawnIndex, transition.spawnIndex, 'the five-second transition adds no stage enemies');
    assert.notEqual(midTransition.starY, transition.starY, 'stars move during the transition');
    assert.ok(survivor(midTransition), 'regular enemies remain during the boss transition');
    await page.clock.runFor((BOSS_ARRIVAL_SECONDS - 2) * 1000 + 200);
    await page.waitForFunction(() => window.__AUDIOSTRIKE_TEST__?.snapshot().state === 'BOSS');
    const firstBoss = await snapshot();
    assert.ok(firstBoss.bossY + firstBoss.bossRadius > 0 && firstBoss.bossY < 120, 'boss is visible at the five-second arrival');
    assert.ok(firstBoss.bossMaxHealth >= 1050 && firstBoss.bossMaxHealth <= 1300, 'first boss has half the old health baseline');
    assert.equal(firstBoss.stageAudioPaused, true);
    assert.equal(firstBoss.bossAudioPaused, false);
    assert.ok(survivor(firstBoss), 'boss arrival does not clear existing regular enemies');
    await page.clock.runFor(1000);
    const duringBoss = await snapshot();
    assert.ok(survivor(duringBoss), 'regular enemies keep fighting alongside the boss');
    assert.equal(duringBoss.spawnIndex, firstBoss.spawnIndex, 'regular spawning remains paused during the boss fight');
    await page.evaluate(() => window.__AUDIOSTRIKE_TEST__.spawnSubBoss());
    assert.ok((await snapshot()).subBossCount >= 1, 'boss has independently tracked sub-bosses');

    await page.evaluate(() => window.__AUDIOSTRIKE_TEST__.finishBoss());
    const healthOnKill = (await snapshot()).playerHealth;
    await page.clock.runFor(600);
    const dying = await snapshot();
    assert.equal(dying.state, 'PLAYING', 'early defeat starts the next stage immediately');
    assert.equal(dying.subBossCount, 0, 'sub-bosses stop attacking on the killing blow');
    assert.equal(dying.damageProtected, true, 'death animation retains damage protection while enemies resume');
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
    assert.ok(secondStage.stageTime < 3, 'the stage timer restarts on the killing blow, not animation completion');
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

test('timed encounters stack, preserve playlist ownership, pause, pickups, and independent deaths', { timeout: 90000 }, async () => {
  const executablePath = process.env.CHROMIUM_PATH || execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim();
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install();
    await page.addInitScript(() => { window.__AUDIOSTRIKE_TEST_MODE__ = true; Math.random = () => .7; });
    const titles = ['A', 'B', 'C'];
    await page.goto(url);
    await selectMockPlaylist(page, titles.map((name, i) => ({ name, buffer: toneWav([110, 1100, 3200][i]) })));
    await page.getByTestId('button-analyze').click();
    await page.waitForFunction(() => window.__AUDIOSTRIKE_TEST__?.snapshot().state === 'PLAYING');
    const snapshot = () => page.evaluate(() => window.__AUDIOSTRIKE_TEST__.snapshot());
    await page.evaluate(() => window.__AUDIOSTRIKE_TEST__.setPlayer({ invincible: 1e9 }));
    async function arrive() {
      await page.clock.fastForward(30100);
      assert.equal((await snapshot()).state, 'BOSS_INTRO');
      await page.clock.runFor(5100);
      assert.equal((await snapshot()).state, 'BOSS');
      const boss = (await snapshot()).bosses.at(-1);
      await page.evaluate((id) => window.__AUDIOSTRIKE_TEST__.setBossHealth(id, 1e6), boss.id);
      return boss;
    }
    async function timeout() {
      await page.evaluate(() => window.__AUDIOSTRIKE_TEST__.setEncounterElapsed(29.98));
      await page.clock.runFor(10);
      assert.equal((await snapshot()).state, 'BOSS', 'does not expire before exact deadline');
      await page.clock.runFor(30);
      assert.equal((await snapshot()).state, 'PLAYING');
    }
    const first = await arrive();
    assert.equal((await snapshot()).encounter.secondsLeft, 30, 'timer begins after arrival');
    assert.match(await page.getByTestId('text-boss-time').innerText(), /30s/);
    await page.getByTestId('button-pause').click();
    const frozen = await snapshot();
    await page.clock.fastForward(90000);
    assert.deepEqual(await snapshot(), frozen, 'pause freezes boss deadline and all entities');
    await page.getByTestId('button-resume').click();
    await page.clock.runFor(40);
    await page.evaluate((id) => window.__AUDIOSTRIKE_TEST__.setAudioSpectrum(id, 'bass'), first.id);
    await timeout();
    const secondStage = await snapshot();
    assert.equal(secondStage.level, 2);
    assert.equal(secondStage.bosses.length, 1, 'timeout does not despawn boss');
    assert.equal(secondStage.audibleBossId, first.id);
    assert.equal(secondStage.audibleSrc, first.src, 'carried boss keeps its original song');
    assert.equal(secondStage.stageTrackTitle, 'C'); assert.equal(secondStage.bossTrackTitle, 'A');
    assert.ok(secondStage.enemies.some((enemy) => !enemy.subBoss), 'regular enemies spawn immediately');
    assert.ok(secondStage.stageTime < .1);
    await page.clock.runFor(100);
    const bassEnemies = await snapshot();
    assert.ok(bassEnemies.audibleFeatures.low > bassEnemies.audibleFeatures.high);
    for (const enemy of bassEnemies.enemies.filter((enemy) => !enemy.subBoss)) {
      assert.equal(enemy.pattern, chooseAttack(bassEnemies.audibleFeatures, Math.floor(enemy.frame)));
    }
    assert.ok(bassEnemies.bosses[0].x !== secondStage.bosses[0].x || bassEnemies.bosses[0].y !== secondStage.bosses[0].y, 'carried boss continues moving');
    await page.evaluate(() => window.__AUDIOSTRIKE_TEST__.spawnTarget(80, 350, 12345, false, 8, 30));
    const beforeMotion = (await snapshot()).enemies.find((enemy) => enemy.health === 12345);
    await page.clock.runFor(20);
    const moved = await snapshot(), afterMotion = moved.enemies.find((enemy) => enemy.health === 12345);
    const expectedMovement = 8 * (afterMotion.frame - beforeMotion.frame) * .18 * (1 + audioIntensity(moved.audibleFeatures) * .3) * 2.3;
    assert.ok(Math.abs(afterMotion.x - beforeMotion.x - expectedMovement) < .01, 'regular-enemy movement uses audible boss energy, not muted stage audio');
    assert.equal(afterMotion.pattern, 'RADIAL', 'bass boss song selects radial regular-enemy fire');
    assert.ok(moved.enemyShots.filter((shot) => !shot.ownerId && shot.kind === 'ORB').length >= 10, 'regular enemy actually emits the audible-song-selected radial volley');
    const second = await arrive();
    await page.evaluate((id) => window.__AUDIOSTRIKE_TEST__.setAudioSpectrum(id, 'bright'), second.id);
    await page.clock.runFor(80);
    const both = await snapshot();
    assert.equal(both.bosses.length, 2);
    assert.equal(both.audibleBossId, second.id);
    assert.equal(both.bosses[0].paused, true); assert.equal(both.bosses[1].paused, false);
    assert.ok(both.audibleFeatures.high > both.audibleFeatures.low);
    // Defeating the current encounter advances immediately, before its death animation.
    await page.evaluate((id) => window.__AUDIOSTRIKE_TEST__.finishBoss(id), second.id);
    const early = await snapshot();
    assert.equal(early.level, 3); assert.equal(early.state, 'PLAYING');
    assert.equal(early.audibleBossId, first.id, 'older song resumes as newest living boss');
    assert.equal(early.stageTrackTitle, 'B'); assert.equal(early.bossTrackTitle, 'C');
    assert.equal(early.damageProtected, true);
    await page.evaluate(() => {
      const api = window.__AUDIOSTRIKE_TEST__;
      api.setPlayer({ health: 50, invincible: 0 });
      api.drop('REPAIR');
      const p = api.snapshot().player;
      api.enemyShot(p.x, p.y, 50);
    });
    await page.clock.runFor(40);
    assert.equal((await snapshot()).playerHealth, 75, 'repair collects while death animation protects from damage');
    const oldHealth = (await snapshot()).bosses[0].health;
    await page.evaluate(() => window.__AUDIOSTRIKE_TEST__.drop('BOMB'));
    await page.clock.runFor(40);
    assert.equal((await snapshot()).bosses[0].health, oldHealth - 180, 'bomb damages living carried boss during another death');
    assert.equal((await snapshot()).level, 3);
    assert.equal((await snapshot()).damageProtected, true, 'bomb does not cancel transition protection');
    for (const type of ['SHIELD', 'RAPID', 'SPREAD', 'SPREAD', 'LASER', 'TWIN']) {
      await page.evaluate((type) => window.__AUDIOSTRIKE_TEST__.drop(type), type);
      await page.clock.runFor(40);
      assert.equal((await snapshot()).drops.length, 0, `${type} pickup collects during death animation`);
    }
    assert.equal((await snapshot()).weapon.type, 'TWIN');
    assert.ok((await snapshot()).weapon.shieldUntil > (await snapshot()).now);
    assert.ok((await snapshot()).weapon.rapidUntil > (await snapshot()).now);
    assert.ok((await snapshot()).bosses.some((boss) => boss.id === second.id && boss.phase === 'DYING'));
    await page.clock.runFor(2600);
    assert.equal((await snapshot()).bosses.length, 1, 'only the individually finished death is removed');
    assert.equal((await snapshot()).level, 3, 'animation completion cannot advance again');
    await page.evaluate(() => window.__AUDIOSTRIKE_TEST__.setPlayer({ invincible: 1e9 }));
    const third = await arrive();
    await timeout();
    assert.equal((await snapshot()).level, 4);
    const fourth = await arrive();
    await page.clock.runFor(3000);
    assert.equal((await snapshot()).bosses.length, 3, 'survival supports more than two simultaneous bosses');
    assert.equal((await snapshot()).audibleBossId, fourth.id);
    const visibleBosses = (await snapshot()).bosses;
    for (let i = 0; i < visibleBosses.length; i++) for (let j = i + 1; j < visibleBosses.length; j++) {
      assert.ok(Math.hypot(visibleBosses[i].x - visibleBosses[j].x, visibleBosses[i].y - visibleBosses[j].y) > 100, 'stacked bosses remain individually visible');
    }
    const hud = await page.getByTestId('hud-bosses').boundingBox();
    assert.ok(hud.x >= 0 && hud.x + hud.width <= 412, 'multi-boss HUD fits portrait viewport');
    await page.screenshot({ path: '/tmp/audiostrike-stacked-bosses-portrait.png' });
    await page.evaluate((id) => window.__AUDIOSTRIKE_TEST__.finishBoss(id), first.id);
    assert.equal((await snapshot()).level, 4, 'older carry-over defeat never advances current encounter');
    assert.equal((await snapshot()).audibleBossId, fourth.id);
    await page.clock.runFor(2600);
    assert.deepEqual((await snapshot()).bosses.map((boss) => boss.id), [third.id, fourth.id]);
    await page.evaluate((id) => {
      window.__AUDIOSTRIKE_TEST__.setEncounterElapsed(30);
      window.__AUDIOSTRIKE_TEST__.finishBoss(id);
    }, fourth.id);
    await page.clock.runFor(40);
    assert.equal((await snapshot()).level, 5, 'defeat exactly at timeout advances only once');
    assert.equal((await snapshot()).audibleBossId, third.id);
    await page.evaluate((id) => window.__AUDIOSTRIKE_TEST__.finishBoss(id), third.id);
    assert.equal((await snapshot()).level, 5);
    assert.equal((await snapshot()).audibleBossId, null);
    assert.equal((await snapshot()).stageAudioPaused, false, 'stage song resumes once no living bosses remain');
    await page.evaluate(() => window.__AUDIOSTRIKE_TEST__.endRun());
    await page.getByTestId('button-replay-game-over').click();
    const replay = await snapshot();
    assert.equal(replay.level, 1); assert.deepEqual(replay.bosses, []); assert.equal(replay.encounter, null);
    assert.deepEqual(replay.trackOrder, titles);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});