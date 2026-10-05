import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceBossDeath, advanceProjectiles, attackInterval, attackVectors, bossPhase, BOSS_TRANSITION_SECONDS, configureGameplayAudio, detachSubBoss, encounterSignature, nextLevel,
  damageBoss, enemyShotHitsPlayer, moveBoss, playerShotHitsTarget,
  spawnPressure, stageProgress, STAGE_LEVEL_SECONDS, BOSS_ARRIVAL_SECONDS,
  BOSS_ENCOUNTER_SECONDS, advanceEncounter, encounterProgress, newestLivingBoss, separateBossPositions,
} from '../src/gameRules.ts';
import { bossHealth } from '../src/encounterRules.ts';

test('encounters advance exactly once on early defeat or exact gameplay timeout', () => {
  assert.equal(BOSS_ENCOUNTER_SECONDS, 30);
  const early = { id: 1, startedAt: 5000, advanced: false };
  assert.equal(advanceEncounter(early, 10000, 99), false, 'older deaths cannot advance');
  assert.equal(advanceEncounter(early, 10000, 1), true);
  assert.equal(advanceEncounter(early, 35000, 1), false, 'timeout and defeat cannot advance twice');
  const timeout = { id: 2, startedAt: 60000, advanced: false };
  assert.deepEqual(encounterProgress(timeout, 60000), { secondsLeft: 30, finished: false });
  assert.equal(advanceEncounter(timeout, 89999), false);
  assert.equal(advanceEncounter(timeout, 90000), true);
  assert.equal(advanceEncounter(timeout, 90000, 2), false);
  const next = { id: 3, startedAt: 100000, advanced: false };
  assert.equal(advanceEncounter(next, 100001, 2), false, 'late carry-over death does not skip a level');
});

test('soundtrack priority follows newest living boss, not scheduling or death animations', () => {
  const bosses = [1, 2, 3, 4].map((id) => ({ id, health: 100, phase: 'PHASE1' }));
  assert.equal(newestLivingBoss(bosses).id, 4);
  bosses[3].phase = 'DYING'; bosses[3].health = 0;
  assert.equal(newestLivingBoss(bosses).id, 3);
  bosses[1].health = 0;
  assert.equal(newestLivingBoss(bosses).id, 3);
  bosses[2].health = 0;
  assert.equal(newestLivingBoss(bosses).id, 1);
  bosses[0].health = 0;
  assert.equal(newestLivingBoss(bosses), undefined);
});

test('stacked bosses separate visibly without moving incoming or dying bosses', () => {
  const bosses = Array.from({ length: 3 }, () => ({ x: 210, y: 120, radius: 55, phase: 'PHASE1' }));
  const arrival = { x: 210, y: -35, radius: 55, phase: 'INTRO' };
  const dying = { x: 210, y: 120, radius: 55, phase: 'DYING' };
  bosses.push(arrival, dying);
  separateBossPositions(bosses, 420);
  assert.equal(bosses.length, 5);
  for (let i = 0; i < 3; i++) {
    assert.ok(bosses[i].x >= 70 && bosses[i].x <= 350);
    assert.ok(bosses[i].y >= 75 && bosses[i].y <= 320);
    for (let j = i + 1; j < 3; j++) assert.ok(Math.hypot(bosses[i].x - bosses[j].x, bosses[i].y - bosses[j].y) > 108);
  }
  assert.equal(arrival.y, -35);
  assert.deepEqual(dying, { x: 210, y: 120, radius: 55, phase: 'DYING' });
});

test('stage runs for 30 seconds regardless of track duration, followed by five seconds before entry', () => {
  assert.equal(STAGE_LEVEL_SECONDS, 30);
  assert.equal(BOSS_TRANSITION_SECONDS, 5);
  assert.equal(BOSS_ARRIVAL_SECONDS, BOSS_TRANSITION_SECONDS);
  for (const songTime of [0, 12, 29.999]) assert.equal(stageProgress(songTime).finished, false);
  assert.deepEqual(stageProgress(30), { secondsLeft: 0, progress: 1, finished: true });
  assert.equal(stageProgress(35).finished, true);
  assert.equal(stageProgress(12).secondsLeft, 18);
});

test('quiet-track waves become larger and more frequent from early to late stage', () => {
  const early = spawnPressure(stageProgress(0).progress, 0, 0, 0);
  const late = spawnPressure(stageProgress(29).progress, 0, 0, 0);
  assert.equal(early.count, 1);
  assert.equal(early.cooldown, 90);
  assert.ok(late.count >= 2, `late quiet wave should have at least two enemies: ${late.count}`);
  assert.ok(late.cooldown < early.cooldown, 'quiet waves must become more frequent');
  assert.ok(late.cooldown >= 23, 'cooldown cannot fall below its floor');
});

const quiet = { rms: .02, onset: 0, low: .02, mid: .01, high: .01, centroid: .1, flatness: .2, pulse: false };
const bass = { rms: .72, onset: .7, low: .9, mid: .3, high: .1, centroid: .2, flatness: .55, pulse: true };
const bright = { rms: .7, onset: .75, low: .1, mid: .4, high: .88, centroid: .7, flatness: .7, pulse: true };

test('contrasting songs change form, movement, attacks and intensity while remaining bounded', () => {
  assert.notDeepEqual(encounterSignature(bass), encounterSignature(bright));
  assert.deepEqual(encounterSignature(bass), { shape: 'HEX', motion: 'SWEEP', attack: 'RADIAL', projectile: 'RING' });
  assert.deepEqual(encounterSignature(bright), { shape: 'TRIANGLE', motion: 'HUNT', attack: 'BURST', projectile: 'SHARD' });
  assert.ok(spawnPressure(.5, bright.rms, bright.onset, bright.high).cooldown < spawnPressure(.5, quiet.rms, quiet.onset, quiet.high).cooldown);
  assert.ok(attackInterval(bright, 1, true) < attackInterval(quiet, 1, true));
  assert.ok(attackInterval(bright, 20, true) >= 22);
  assert.ok(spawnPressure(1, 1, 1, 1, 30).count <= 6);
  assert.ok(spawnPressure(1, 1, 1, 1, 30).cooldown >= 23);
});

test('regular enemies, detached parts and bosses share bounded attack choices', () => {
  for (const pattern of ['TRACK', 'BURST', 'RADIAL']) {
    const vectors = attackVectors(pattern, 4, 8, 0, .9);
    assert.equal(vectors.length, pattern === 'RADIAL' ? 8 : pattern === 'BURST' ? 5 : 1);
    assert.ok(vectors.every(({ x, y }) => Math.abs(Math.hypot(x, y) - 1) < .00001));
  }
});

test('sub-bosses detach independently, scale with the level and cannot exceed the active cap', () => {
  const first = detachSubBoss(2, 0, 1);
  assert.deepEqual(first, { remaining: 1, health: 30 });
  assert.deepEqual(detachSubBoss(first.remaining, 1, 2), { remaining: 0, health: 36 });
  assert.equal(detachSubBoss(0, 0, 1), null);
  assert.equal(detachSubBoss(2, 4, 1), null);
});

test('first boss has half the 2100 baseline; later levels increase pressure without resetting', () => {
  assert.equal(bossHealth(0, 1), 1050);
  assert.ok(bossHealth(18, 2) > bossHealth(18, 1));
  assert.equal(nextLevel(1), 2);
  assert.equal(nextLevel(nextLevel(1)), 3);
  assert.ok(spawnPressure(.3, .5, .5, .5, 4).cooldown < spawnPressure(.3, .5, .5, .5, 1).cooldown);
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

test('final boss hit enters death sequence and is ready for next-level transition after delay', () => {
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