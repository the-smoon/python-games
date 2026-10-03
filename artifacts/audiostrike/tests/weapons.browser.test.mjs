import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { chromium } from 'playwright-core';

const url = process.env.AUDIOSTRIKE_TEST_URL || 'http://localhost:80/';
function silentWav() {
  const wav = Buffer.alloc(16044);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16000, 40);
  return wav;
}
test('real pickups drive ranked weapons, shield, companions, freeze, piercing laser, bombs and replay', { timeout: 60000 }, async () => {
  const executablePath = process.env.CHROMIUM_PATH || execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim();
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install();
    await page.addInitScript(() => { window.__AUDIOSTRIKE_TEST_MODE__ = true; });
    assert.equal((await page.goto(url))?.status(), 200);
    for (const kind of ['stage', 'boss']) {
      await page.getByTestId(`input-${kind}-file`).setInputFiles({ name: `${kind}.wav`, mimeType: 'audio/wav', buffer: silentWav() });
    }
    await page.getByTestId('button-analyze').click();
    await page.waitForFunction(() => window.__AUDIOSTRIKE_TEST__?.snapshot().state === 'PLAYING');
    const snap = () => page.evaluate(() => window.__AUDIOSTRIKE_TEST__.snapshot());
    const preMatch = await snap();
    assert.equal(preMatch.stageAnalysis.analyzed, true, 'stage song was decoded before the match');
    assert.equal(preMatch.bossAnalysis.analyzed, true, 'boss song was decoded before the match');
    assert.equal(preMatch.stageAnalysis.motifCount, 8);
    assert.equal(preMatch.bossAnalysis.motifCount, 8);
    const run = (fn, arg) => page.evaluate(fn, arg);
    const tick = (ms = 40) => page.clock.runFor(ms);
    const pickup = async (type) => {
      await run((t) => window.__AUDIOSTRIKE_TEST__.drop(t), type); await tick();
    };
    await run(() => window.__AUDIOSTRIKE_TEST__.clearArena());
    assert.equal((await snap()).weapon.rank, 1);
    for (let i = 0; i < 5; i++) await pickup('TWIN');
    assert.equal((await snap()).weapon.rank, 5);
    assert.deepEqual((await snap()).weapon.companions, [20, 20]);
    assert.match(await page.getByTestId('hud-weapon').innerText(), /Wingmen\s*2\/2/);
    await run(() => {
      const api = window.__AUDIOSTRIKE_TEST__, p = api.snapshot().player;
      api.enemyShot(p.x - 33, p.y + 8, 25);
    }); await tick();
    assert.equal((await snap()).weapon.companions[0], 0, 'enemy shot destroys wingman');
    await pickup('TWIN');
    assert.deepEqual((await snap()).weapon.companions, [20, 20]);
    await run(() => window.__AUDIOSTRIKE_TEST__.setPlayer({ health: 30, invincible: 0 }));
    await pickup('SPREAD');
    assert.equal((await snap()).playerHealth, 70, 'lost ranks become hull repair');
    assert.deepEqual((await snap()).weapon.companions, [0, 0]);
    assert.equal((await snap()).weapon.rank, 1);
    await pickup('REPAIR'); assert.equal((await snap()).playerHealth, 95);
    await pickup('REPAIR'); assert.equal((await snap()).playerHealth, 100);
    await pickup('RAPID'); await pickup('SHIELD');
    const shieldUntil = (await snap()).weapon.shieldUntil;
    await run(() => {
      const api = window.__AUDIOSTRIKE_TEST__, p = api.snapshot().player;
      api.enemyShot(p.x, p.y, 40);
    }); await tick();
    assert.equal((await snap()).playerHealth, 100, 'shield blocks incoming damage');
    await tick(6100);
    assert.ok((await snap()).now >= shieldUntil);
    assert.doesNotMatch(await page.getByTestId('hud-weapon').innerText(), /Shield/);
    await run(() => {
      const api = window.__AUDIOSTRIKE_TEST__, p = api.snapshot().player;
      api.enemyShot(p.x, p.y, 5);
    }); await tick();
    assert.equal((await snap()).playerHealth, 95, 'damage resumes after shield expiry');
    await tick(4000);
    assert.doesNotMatch(await page.getByTestId('hud-weapon').innerText(), /Rapid/);

    // Collecting a same-type drop refreshes the firing schedule; set the next volley to tenth.
    await pickup('SPREAD');
    await run(() => {
      const api = window.__AUDIOSTRIKE_TEST__;
      api.clearArena(); api.setVolley(9);
      const p = api.snapshot().player;
      api.spawnTarget(p.x, p.y - 85, 1000);
      api.enemyShot(p.x + 15, p.y - 85, 3);
      api.enemyShot(p.x + 145, p.y - 85, 3);
    });
    await tick(500);
    const frozen = await snap();
    assert.ok(frozen.enemyShots.some((s) => s.frozenUntil > frozen.now), 'tenth spread volley freezes a local bullet');
    assert.ok(frozen.enemyShots.some((s) => !s.frozenUntil), 'distant bullet is unaffected');
    assert.ok(frozen.enemies[0].frozenUntil > frozen.now, 'enemy within splash is slowed');
    const frozenShot = frozen.enemyShots.find((s) => s.frozenUntil);
    // Move to a different weapon to prevent another tenth freeze from refreshing this fixture.
    await pickup('TWIN');
    await tick(2000);
    const held = (await snap()).enemyShots.find((s) => s.frozenUntil);
    assert.equal(held.x, frozenShot.x); assert.equal(held.y, frozenShot.y);
    await tick(1200);
    assert.equal((await snap()).enemyShots.filter((s) => s.frozenUntil).length, 0, 'frozen bullets pop into dust');
    assert.ok((await snap()).enemies[0].frozenUntil <= (await snap()).now);

    await run(() => window.__AUDIOSTRIKE_TEST__.clearArena());
    await pickup('LASER');
    await tick(180);
    assert.ok((await snap()).weapon.chargeStartedAt !== null);
    // Actual touch steering cancels an in-progress charge.
    const canvas = await page.getByTestId('canvas-game').boundingBox();
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height * .6);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width / 2 + 70, canvas.y + canvas.height * .6);
    await tick(100);
    assert.equal((await snap()).weapon.chargeStartedAt, null);
    assert.equal((await snap()).weapon.cooldownUntil, 0);
    await page.mouse.up(); await tick(250);
    await run(() => {
      const api = window.__AUDIOSTRIKE_TEST__, p = api.snapshot().player;
      api.clearArena(); api.spawnTarget(p.x, 200, 1000); api.spawnTarget(p.x, 300, 1000);
      api.spawnTarget(p.x - 80, 250, 1000);
      api.enemyShot(p.x + 4, 100, 3);
      api.enemyShot(p.x + 20, 100, 3);
    });
    await tick(550);
    const lased = await snap();
    assert.equal(lased.enemies[0].health, 905); assert.equal(lased.enemies[1].health, 905);
    assert.equal(lased.enemies[2].health, 1000);
    assert.equal(lased.hostileShots, 1, 'laser clears the aligned hostile bullet and leaves the off-axis bullet');
    const cooling = lased.weapon.cooldownUntil;
    assert.ok(cooling > lased.now);
    await tick(100);
    assert.equal((await snap()).enemies[0].health, 905, 'fading beam does not repeat damage');
    await pickup('LASER');
    assert.equal((await snap()).weapon.rank, 2);
    await page.screenshot({ path: '/tmp/audiostrike-weapons-portrait.png' });
    const hud = await page.getByTestId('hud-weapon').boundingBox();
    assert.ok(hud.x >= 0 && hud.x + hud.width <= 412);

    await run(() => {
      const api = window.__AUDIOSTRIKE_TEST__, p = api.snapshot().player;
      api.clearArena(); api.spawnTarget(50, 200, 5); api.spawnTarget(90, 250, 50, true);
      api.enemyShot(50, 400, 5);
    });
    await pickup('BOMB');
    const bombed = await snap();
    assert.equal(bombed.hostileShots, 0);
    assert.equal(bombed.enemies.length, 1); assert.equal(bombed.enemies[0].health, 25);
    assert.equal(bombed.drops.length, 0, 'bomb kills do not generate a pickup chain');
    await run(() => window.__AUDIOSTRIKE_TEST__.clearArena());
    await pickup('SHIELD');
    const carryWeapon = (await snap()).weapon;
    await page.clock.fastForward(31000);
    await page.waitForFunction(() => window.__AUDIOSTRIKE_TEST__?.snapshot().state === 'BOSS_INTRO');
    await tick(5200);
    await page.waitForFunction(() => window.__AUDIOSTRIKE_TEST__?.snapshot().state === 'BOSS');
    assert.equal((await snap()).weapon.type, carryWeapon.type);
    const bossBefore = (await snap()).bossHealth;
    await pickup('BOMB');
    assert.equal((await snap()).bossHealth, bossBefore - 180);
    await run(() => window.__AUDIOSTRIKE_TEST__.finishBoss());
    await tick(2600);
    assert.equal((await snap()).level, 2);
    assert.equal((await snap()).weapon.rank, 2, 'weapon ranks carry into next level');
    await run(() => window.__AUDIOSTRIKE_TEST__.endRun());
    await page.getByTestId('button-replay-game-over').click();
    const reset = await snap();
    assert.equal(reset.weapon.type, 'TWIN'); assert.equal(reset.weapon.rank, 1);
    assert.deepEqual(reset.weapon.companions, [0, 0]); assert.equal(reset.weapon.volley, 0);
    assert.equal(reset.weapon.shieldUntil, 0); assert.equal(reset.weapon.rapidUntil, 0);
    assert.equal(reset.weapon.cooldownUntil, 0); assert.equal(reset.weapon.chargeStartedAt, null);
    assert.equal(reset.drops.length, 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});