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

test('cached analysis survives reload; boss damage, buffs and death effects work in portrait', { timeout: 90000 }, async () => {
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
    assert.equal(first.playerHealth, 200, 'the base hull is 200');
    assert.equal(first.weapon.type, 'LASER', 'the deterministic starting-weapon roll selects laser');
    assert.match(first.stageAnalysis.songKey, /^[a-f0-9]{64}$/);
    assert.notEqual(first.stageAnalysis.songKey, first.bossAnalysis.songKey);
    assert.notDeepEqual(first.stageAnalysis.design.colors, first.bossAnalysis.design.colors);
    for (const hash of [first.stageAnalysis.songKey, first.bossAnalysis.songKey]) {
      const result = await page.request.get(`${url}api/song-analysis/${hash}`);
      assert.equal(result.status(), 200, 'analysis persisted in the shared database');
      const document = await result.json();
      assert.equal(document.version, 3); assert.equal(document.motifs.length, 8);
      assert.equal('audio' in document, false);
    }
    await selectMockPlaylist(page, files); cacheCalls.length = 0;
    await start();
    assert.ok(cacheCalls.filter(c => c.method === 'GET' && c.status === 200).length >= 1,
      'the reload reuses persisted analysis from the browser or shared cache');
    assert.equal(cacheCalls.filter(c => c.method === 'PUT').length, 0, 'a fresh page reuses analysis without decoding and resaving');
    assert.deepEqual((await snap()).stageAnalysis.design, first.stageAnalysis.design);
    await page.evaluate(() => window.__AUDIOSTRIKE_TEST__.setPlayer({ health: 100000 }));
    await page.clock.fastForward(30100);
    await page.clock.runFor(5200);
    await page.waitForFunction(() => window.__AUDIOSTRIKE_TEST__.snapshot().state === 'BOSS');
    await page.clock.runFor(3000);
    assert.equal((await snap()).bosses[0].phase, 'PHASE1');
    let boss = (await snap()).bosses[0];
    await page.evaluate(id => {
      const api = window.__AUDIOSTRIKE_TEST__;
      api.setBossHealth(id, 100000); api.clearArena();
      api.setPlayer({ x: 210, y: 760, vx: 0, vy: 0, health: 100 });
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
    assert.ok((await snap()).playerHealth <= 82, 'a completed boss blast damages hull without a shield');
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
      api.setPlayer({ x: 0, y: 760, vx: 0, vy: 0, health: 100 });
      api.castSecondary(id, 'SWEEP');
    }, boss.id);
    await page.clock.runFor(80);
    const sweepSetup = await snap();
    assert.equal(sweepSetup.bossBeams.length, 1, 'the boss creates its moving-safe-lane laser');
    const sweep = sweepSetup.bossBeams[0];
    const progressAtPlayer = Math.max(0, Math.min(1, (760 - sweep.startY) / (sweep.endY - sweep.startY)));
    const playerCrossingAt = sweep.activeAt + progressAtPlayer * (sweep.endsAt - sweep.activeAt);
    await page.clock.runFor(Math.max(0, (playerCrossingAt - sweepSetup.now + .18) * 1000));
    assert.equal((await snap()).playerHealth, 84, 'the boss beam damages hull outside its safe lane');
    await page.evaluate(id => {
      const api = window.__AUDIOSTRIKE_TEST__;
      api.clearArena(); api.setPlayer({ health: 100000 });
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

test('combat progression, shield expiry, hostile shots and collisions follow the new rules', { timeout: 90000 }, async () => {
  const executablePath = process.env.CHROMIUM_PATH || execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim();
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install();
    await page.addInitScript(() => { window.__RHYTHM_FIGHTER_TEST_MODE__ = true; Math.random = () => .7; });
    await page.goto(url);
    await selectMockPlaylist(page, [
      { name: 'combat-stage.mp3', buffer: tone(271) },
      { name: 'combat-boss.mp3', buffer: tone(1413) },
    ]);
    await page.getByTestId('button-analyze').click();
    await page.waitForFunction(() => window.__AUDIOSTRIKE_TEST__?.snapshot().state === 'PLAYING');
    const run = (fn, arg) => page.evaluate(fn, arg);
    const tick = (ms = 40) => page.clock.runFor(ms);
    const snap = () => page.evaluate(() => window.__AUDIOSTRIKE_TEST__.snapshot());
    const pickup = async (type) => {
      await run(t => window.__AUDIOSTRIKE_TEST__.drop(t), type);
      await tick(50);
    };
    await run(() => {
      const api = window.__AUDIOSTRIKE_TEST__;
      api.clearArena();
      api.setPlayer({ x: 210, y: 760, vx: 0, vy: 0, health: 50 });
    });

    // Switching keeps rank and hull, then shadows only weapon drops for ten seconds.
    await pickup('SPREAD');
    let state = await snap();
    assert.equal(state.weapon.type, 'SPREAD');
    assert.equal(state.weapon.rank, 1);
    assert.equal(state.playerHealth, 50);
    assert.ok(state.weapon.weaponSwitchUntil - state.now > 9);
    assert.match(await page.getByTestId('hud-weapon').innerText(), /Weapon lock/);
    await pickup('TWIN');
    state = await snap();
    assert.equal(state.weapon.rank, 1, 'a weapon drop cannot rank up during the switch lock');
    assert.ok(state.drops.some(drop => drop.type === 'TWIN' && drop.alive), 'the blocked pickup remains on screen');
    await pickup('REPAIR');
    assert.equal((await snap()).playerHealth, 75, 'non-weapon pickups remain available during the lock');

    // Higher shields replace at full HP. Expiry emits exactly one projectile per remaining shield HP.
    await pickup('SHIELD');
    assert.equal((await snap()).weapon.shieldHP, 100);
    await pickup('SHIELD_2');
    state = await snap();
    assert.deepEqual([state.weapon.shieldTier, state.weapon.shieldHP, state.weapon.shieldMaxHP], [2, 200, 200]);
    assert.ok(Math.abs(state.weapon.shieldUntil - state.now - 10) < .2);
    assert.equal(await page.getByTestId('hud-shield').isVisible(), true);
    await run(() => {
      const api = window.__AUDIOSTRIKE_TEST__, p = api.snapshot().player;
      api.enemyShot(p.x, p.y, 5);
    });
    await tick(40);
    assert.equal((await snap()).playerHealth, 75);
    assert.equal((await snap()).weapon.shieldHP, 195);
    const expiryAt = (await snap()).now + .12;
    await run(until => {
      const api = window.__AUDIOSTRIKE_TEST__;
      api.clearArena();
      api.setWeapon({ shieldTier: 2, shieldHP: 3, shieldMaxHP: 200, shieldUntil: until });
    }, expiryAt);
    await tick(220);
    state = await snap();
    assert.equal(state.weapon.shieldHP, 0);
    assert.equal(state.shots.filter(shot => shot.shieldBurst).length, 3);
    assert.equal(await page.getByTestId('hud-shield').count(), 0);

    // Legacy invincibility state must not protect hull from consecutive connected hits.
    await run(() => {
      const api = window.__AUDIOSTRIKE_TEST__, p = api.snapshot().player;
      api.setPlayer({ health: 100, invincible: 1e9 });
      api.enemyShot(p.x, p.y, 5);
    });
    await tick(40);
    assert.equal((await snap()).playerHealth, 95);
    await run(() => {
      const api = window.__AUDIOSTRIKE_TEST__, p = api.snapshot().player;
      api.enemyShot(p.x, p.y, 5);
    });
    await tick(40);
    assert.equal((await snap()).playerHealth, 90);

    // Standard weapon shots remove ordinary bullets but leave marked boss hazards intact.
    await run(() => {
      const api = window.__AUDIOSTRIKE_TEST__, p = api.snapshot().player;
      api.clearArena();
      api.setWeapon({
        type: 'SPREAD', rank: 1, nextFireAt: 0, volley: 0,
        chargeStartedAt: null, cooldownUntil: 0,
      });
      api.enemyShot(p.x - 7, p.y - 42, 3, false);
      api.enemyShot(p.x + 7, p.y - 42, 3, true);
    });
    await tick(900);
    state = await snap();
    assert.equal(state.enemyShots.filter(shot => shot.alive && !shot.indestructible).length, 0);
    assert.equal(state.enemyShots.filter(shot => shot.alive && shot.indestructible).length, 1);
    await run(() => window.__AUDIOSTRIKE_TEST__.drop('BOMB'));
    await tick(60);
    assert.equal((await snap()).enemyShots.filter(shot => shot.alive && shot.indestructible).length, 1,
      'the bomb also leaves a special boss projectile intact');

    // Let the switch timer end, then rank the held weapon all the way to seven.
    await run(() => window.__AUDIOSTRIKE_TEST__.setPlayer({ health: 100000 }));
    await page.clock.fastForward(30100);
    await page.clock.runFor(5200);
    await page.waitForFunction(() => window.__AUDIOSTRIKE_TEST__?.snapshot().state === 'BOSS');
    state = await snap();
    assert.ok(state.weapon.weaponSwitchUntil <= state.now, JSON.stringify({
      state: state.state, now: state.now, weaponSwitchUntil: state.weapon.weaponSwitchUntil,
    }));
    for (let rank = 2; rank <= 7; rank += 1) {
      await pickup('SPREAD');
      state = await snap();
      assert.equal(state.weapon.rank, rank, JSON.stringify({
        state: state.state, now: state.now, weaponSwitchUntil: state.weapon.weaponSwitchUntil,
        drops: state.drops,
      }));
    }
    assert.equal(state.weapon.rank, 7);
    assert.equal(state.weapon.type, 'SPREAD');
    await run(() => {
      const api = window.__AUDIOSTRIKE_TEST__;
      api.setPlayer({ health: 50 });
      api.drop('TWIN');
    });
    await tick(50);
    assert.equal((await snap()).playerHealth, 60, 'weapon drops convert to +10 mini-health at rank seven');
    await pickup('REPAIR');
    assert.equal((await snap()).playerHealth, 85, 'regular repair remains +25');

    // Common-enemy rams are severe; a shield both absorbs the collision and destroys the enemy.
    await run(() => {
      const api = window.__AUDIOSTRIKE_TEST__, p = api.snapshot().player;
      api.clearArena();
      api.setBossFireTimer(api.snapshot().bosses[0].id, 1e9);
      api.setBossPosition(api.snapshot().bosses[0].id, 35, 100);
      api.setWeapon({ type: 'LASER', cooldownUntil: api.snapshot().now + 1000, chargeStartedAt: null });
      api.setPlayer({ x: 210, y: 760, vx: 0, vy: 0, health: 100, invincible: 1e9 });
      api.spawnTarget(210, 760, 100);
    });
    await tick(40);
    assert.equal((await snap()).playerHealth, 64, 'unshielded enemy ramming removes 36 hull');

    await run(() => {
      const api = window.__AUDIOSTRIKE_TEST__;
      api.clearArena();
      api.setWeapon({ type: 'LASER', cooldownUntil: api.snapshot().now + 1000, chargeStartedAt: null });
      api.setPlayer({ x: 210, y: 760, vx: 0, vy: 0, health: 100 });
      api.drop('SHIELD');
    });
    await tick(50);
    await run(() => window.__AUDIOSTRIKE_TEST__.spawnTarget(210, 760, 40));
    await tick(40);
    state = await snap();
    assert.equal(state.playerHealth, 100, 'the active shield absorbs ramming damage');
    assert.equal(state.weapon.shieldHP, 64, 'the fresh 100-HP shield loses 36 HP to the ram');
    assert.equal(state.enemies.length, 0, 'shielded ramming destroys a common enemy');

    // Breaking a shield triggers the short forward cone; it can hit enemies ahead, not bosses.
    await run(() => {
      const api = window.__AUDIOSTRIKE_TEST__, p = api.snapshot().player;
      api.setWeapon({ type: 'LASER', cooldownUntil: api.snapshot().now + 1000, chargeStartedAt: null });
      api.drop('SHIELD');
      api.spawnTarget(p.x, p.y - 80, 40);
    });
    await tick(50);
    await run(() => {
      const api = window.__AUDIOSTRIKE_TEST__, p = api.snapshot().player;
      api.setWeapon({ shieldTier: 1, shieldHP: 3, shieldMaxHP: 100, shieldUntil: api.snapshot().now + 10 });
      api.enemyShot(p.x, p.y, 25);
    });
    await tick(50);
    assert.equal((await snap()).enemies.length, 0);
    assert.ok((await snap()).shieldBlastUntil > (await snap()).now);

    // Bosses hurt on contact, but player ramming never reduces boss health.
    await run(() => {
      const api = window.__AUDIOSTRIKE_TEST__, boss = api.snapshot().bosses[0];
      api.clearArena();
      api.setBossFireTimer(boss.id, 1e9);
      api.setBossPhase(boss.id, 'PHASE1');
      api.setWeapon({ type: 'LASER', cooldownUntil: api.snapshot().now + 1000, chargeStartedAt: null });
      api.setPlayer({ x: boss.x, y: boss.y, vx: 0, vy: 0, health: 100 });
      api.setBossHealth(boss.id, 100000);
    });
    await tick(40);
    assert.equal((await snap()).playerHealth, 55, 'boss collision severely damages hull');
    await run(() => {
      const api = window.__AUDIOSTRIKE_TEST__, boss = api.snapshot().bosses[0];
      api.setBossPosition(boss.id, 35, 100);
      api.setBossPhase(boss.id, 'PHASE1');
      api.setBossHealth(boss.id, 100000);
      api.setWeapon({ type: 'LASER', cooldownUntil: api.snapshot().now + 1000, chargeStartedAt: null });
      api.setPlayer({ x: 210, y: 760, vx: 0, vy: 0, health: 100 });
      api.drop('SHIELD');
    });
    await tick(50);
    await run(() => {
      const api = window.__AUDIOSTRIKE_TEST__, boss = api.snapshot().bosses[0];
      api.setBossPhase(boss.id, 'PHASE1');
      api.setPlayer({ x: boss.x, y: boss.y, vx: 0, vy: 0, health: 100 });
      api.setBossPosition(boss.id, boss.x, boss.y);
    });
    await tick(40);
    state = await snap();
    assert.equal(state.playerHealth, 100);
    assert.equal(state.bosses[0].health, 100000, 'player ram does not damage a boss');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});