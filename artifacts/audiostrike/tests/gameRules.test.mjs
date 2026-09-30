import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceBossDeath, advanceProjectiles, bossPhase, configureGameplayAudio,
  damageBoss, enemyShotHitsPlayer, moveBoss, playerShotHitsTarget,
  spawnPressure, stageProgress, STAGE_LEVEL_SECONDS, BOSS_ARRIVAL_SECONDS,
} from '../src/gameRules.ts';

test('stage runs for 30 seconds regardless of track duration, then exits', () => {
  assert.equal(STAGE_LEVEL_SECONDS, 30);
  assert.equal(BOSS_ARRIVAL_SECONDS, 5);
  for (const songTime of [0, 12, 29.999]) assert.equal(stageProgress(songTime).finished, false);
  assert.deepEqual(stageProgress(30), { secondsLeft: 0, progress: 1, finished: true });
  assert.equal(stageProgress(35).finished, true);
  assert.equal(stageProgress(12).secondsLeft, 18);
});

test('quiet-track waves become larger and more frequent from early to late stage', () => {
  const early = spawnPressure(stageProgress(0).progress, 0, 0, 0);
  const late = spawnPressure(stageProgress(29).progress, 0, 0, 0);
  assert.equal(early.count, 1);
  assert.equal(early.cooldown, 84);
  assert.ok(late.count >= 3, `late quiet wave should have at least three enemies: ${late.count}`);
  assert.ok(late.cooldown < early.cooldown, 'quiet waves must become more frequent');
  assert.ok(late.cooldown >= 24, 'cooldown cannot fall below its floor');
});

test('both uploaded tracks loop when shorter than their encounters', () => {
  const stage = { loop: false };
  const boss = { loop: false };
  configureGameplayAudio(stage, boss);
  assert.equal(stage.loop, true);
  assert.equal(boss.loop, true);
});

test('boss phases change at the exact health thresholds', () => {
  assert.equal(bossPhase(100, 100), 'PHASE1');
  assert.equal(bossPhase(66.01, 100), 'PHASE1');
  assert.equal(bossPhase(66, 100), 'PHASE2');
  assert.equal(bossPhase(33.01, 100), 'PHASE2');
  assert.equal(bossPhase(33, 100), 'PHASE3');
});

test('boss orbit, sweeps, and pursuit remain inside the arena', () => {
  for (const phase of ['PHASE1', 'PHASE2', 'PHASE3']) {
    const boss = { x: 400, y: 130, radius: 55, vx: 1, phaseFrame: 0, phase };
    const live = { low: 1, mid: 1, high: 1 };
    for (let i = 0; i < 1000; i++) {
      boss.phaseFrame++;
      moveBoss(boss, { x: i % 2 ? 22 : 778, y: i % 2 ? 28 : 572 }, live, 2.2, 800, 600);
      assert.ok(boss.x >= boss.radius && boss.x <= 800 - boss.radius, `${phase} x=${boss.x}`);
      assert.ok(boss.y >= boss.radius && boss.y <= 600 - boss.radius, `${phase} y=${boss.y}`);
    }
  }
});

test('opposing projectiles cross without cancelling; only targets receive hits', () => {
  const friendly = [{ x: 400, y: 300, vy: -10, alive: true }];
  const hostile = [{ x: 400, y: 294.8, vx: 0, vy: 10, alive: true }];
  advanceProjectiles(friendly, hostile, 1, 800, 600);
  assert.equal(friendly[0].alive, true);
  assert.equal(hostile[0].alive, true);
  assert.equal(playerShotHitsTarget(friendly[0], { x: 400, y: 297.8, radius: 5 }), true);
  assert.equal(enemyShotHitsPlayer(hostile[0], { x: 400, y: 297.4 }, 20, 32), true);
  assert.equal(playerShotHitsTarget(friendly[0], { x: 500, y: 300, radius: 5 }), false);
  assert.equal(enemyShotHitsPlayer(hostile[0], { x: 500, y: 300 }, 20, 32), false);
  assert.equal(enemyShotHitsPlayer({ x: 416, y: 300, radius: 6 }, { x: 400, y: 300 }, 20, 32), true);
});

test('final boss hit enters death sequence before the next level begins', () => {
  const boss = { health: 2, maxHealth: 2, phase: 'PHASE3', dyingTimer: 0 };
  assert.equal(damageBoss(boss), true);
  assert.equal(boss.health, 1);
  assert.equal(damageBoss(boss), true);
  assert.equal(boss.health, 0);
  assert.equal(boss.phase, 'DYING');
  assert.equal(damageBoss(boss), false);
  assert.equal(advanceBossDeath(boss, 149), false);
  assert.equal(advanceBossDeath(boss, 1), true);
});