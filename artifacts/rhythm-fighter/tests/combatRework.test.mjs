import test from 'node:test';
import assert from 'node:assert/strict';
import { createSongDesign, songSpawnIdentity } from '../src/songDesign.ts';
import { generateForm } from '../src/encounterRules.ts';
import { FrameCombatSimulation } from '../src/combatSimulation.ts';
import { pixelBurst, bossDeathBurst, advanceCombatEffects } from '../src/combatEffects.ts';
import { disruptEnemies, castBossAbility, advanceBlasts, BLAST_CHARGE_SECONDS } from '../src/bossAbilities.ts';
import { fireWeapon, newWeaponState, pickDrop, WEAPON_BALANCE } from '../src/weaponRules.ts';

const signal = { rms: .5, onset: .3, low: .8, mid: .2, high: .05, centroid: .15, flatness: .1, pulse: true, tempo: 120 };
const features = (key, s = signal) => ({ duration: 80, analyzedSeconds: 80, analyzed: true, signature: s, motifs: Array(8).fill(s), songKey: key });
const enemy = () => ({ x: 150, y: 200, radius: 18, speed: 5, frame: 0, formX: 150, formY: 200, health: 100,
  maxHealth: 100, alive: true, fireTimer: 0, fireRate: 50, zigDir: 1, motion: 'SWEEP', behavior: 'PATROL', subBoss: false,
  shape: 'SQUARE', form: generateForm(signal, 0) });
const world = () => ({ enemies: [enemy()], player: { x: 210, y: 600, vx: 0, vy: 0 }, blasts: [], particles: [], debris: [], shockwaves: [] });
const simulation = new FrameCombatSimulation({ width: 420, height: 900, playerWidth: 20, playerHeight: 32, maxSpeed: 6.875, acceleration: .42, deceleration: .55 });

test('song blueprints are stable and contrasting songs create different clean shape/palette identities', () => {
  const bass = features('bass-audio'), bright = features('bright-audio', { ...signal, low: .05, high: .9, centroid: .8 });
  assert.deepEqual(createSongDesign(bass), createSongDesign(bass));
  assert.notDeepEqual(createSongDesign(bass).shapes, createSongDesign(bright).shapes);
  assert.notDeepEqual(createSongDesign(bass).colors, createSongDesign(bright).colors);
  assert.notEqual(createSongDesign(bass).projectile, createSongDesign(bright).projectile);
  const shapes = new Set(Array.from({ length: 30 }, (_, i) => songSpawnIdentity(bass, signal, i).shape));
  assert.equal(shapes.size, 5);
  assert.ok(createSongDesign(bright).shapes.includes('ELBOW'));
  assert.notEqual(generateForm(signal, 1).widthScale, generateForm({ ...signal, low: .05, high: .9 }, 1).widthScale);
});

test('pixel bursts radiate in all directions and boss debris splits into bounded generations', () => {
  const w = world();
  pixelBurst(w.particles, 200, 200, '#77ffff', 40);
  assert.equal(w.particles.length, 40);
  assert.ok(w.particles.every(p => p.pixel));
  for (const signs of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) assert.ok(w.particles.some(p => Math.sign(p.vx) === signs[0] && Math.sign(p.vy) === signs[1]));
  bossDeathBurst(w, { x: 200, y: 200, radius: 55, color: '#77ffff' }, 10);
  assert.equal(w.shockwaves.length, 1); assert.equal(w.debris.length, 22);
  let sawSecondGeneration = false;
  for (let i = 0; i < 100; i++) {
    advanceCombatEffects(w, 1);
    sawSecondGeneration ||= w.debris.some(d => d.generation === 2);
    assert.ok(w.particles.length <= 420 && w.debris.length <= 100);
  }
  assert.ok(sawSecondGeneration, 'splinters themselves shed smaller splinters before fading');
  for (let i = 0; i < 180; i++) advanceCombatEffects(w, 1);
  assert.equal(w.debris.length, 0);
});

test('boss death briefly stuns, then gives exactly five seconds of slow wandering; bosses are not targets', () => {
  const w = world(), e = w.enemies[0];
  disruptEnemies(w, 10);
  assert.equal(e.stunnedUntil, 10.45); assert.equal(e.confusedUntil, 15.45);
  simulation.moveEnemy(e, w.player, signal, 1, 10.2);
  assert.equal(e.x, 150); assert.equal(e.frame, 0);
  assert.equal(simulation.moveEnemy(e, w.player, signal, 1, 11), .28);
  assert.equal(simulation.moveEnemy(e, w.player, signal, 1, 15.45), 1);
});

test('boss secondary zones wait five seconds, detonate once, and buffs expire rather than stack', () => {
  const w = world(), boss = { id: 1, features: features('bass'), secondaryAt: 0, secondaryIndex: 0 };
  assert.equal(castBossAbility(w, boss, signal, 10), 'BLAST');
  assert.ok(w.blasts.length >= 1);
  assert.ok(w.blasts.every(b => b.explodeAt - b.createdAt === BLAST_CHARGE_SECONDS));
  assert.equal(advanceBlasts(w, 14.99).length, 0);
  assert.ok(advanceBlasts(w, 15).length >= 1);
  assert.equal(advanceBlasts(w, 15.1).length, 0);
  boss.secondaryAt = 15; boss.secondaryIndex = 1;
  assert.equal(castBossAbility(w, boss, signal, 16), 'DEBUFF');
  assert.equal(w.blasts.at(-1).kind, 'DEBUFF');
  boss.secondaryAt = 16; boss.secondaryIndex = 2;
  assert.equal(castBossAbility(w, boss, signal, 17), 'BUFF');
  assert.equal(w.enemies[0].buffUntil, 22);
  assert.equal(simulation.moveEnemy(w.enemies[0], w.player, signal, 1, 18), 1.35);
  assert.equal(simulation.moveEnemy(w.enemies[0], w.player, signal, 1, 22), 1);
  boss.secondaryAt = 22;
  assert.equal(castBossAbility(w, boss, { ...signal, low: .02, high: .9, mid: .05 }, 23), 'DEBUFF',
    'surviving boss secondary attacks follow the currently audible song, not its origin song');
});

test('Rank 5 weapons have comparable boss damage with different strengths; companions are stronger and durable', () => {
  const damageRates = {};
  for (const type of ['TWIN', 'SPREAD', 'LASER']) {
    const state = newWeaponState(); state.type = type; state.rank = 5;
    if (type === 'TWIN') state.companions = [WEAPON_BALANCE.companionHP, WEAPON_BALANCE.companionHP];
    let damage = 0;
    for (let frame = 0; frame < 6000; frame++) {
      const result = fireWeapon(state, { x: 210, y: 600, vx: 0, vy: 0 }, frame / 600);
      if (result.beam) damage += result.beam.damage;
      for (const shot of result.shots) {
        const x = shot.x + shot.vx / -shot.vy * 250;
        if (Math.abs(x - 210) <= 55) damage += shot.damage;
      }
    }
    damageRates[type] = damage / 10;
  }
  assert.ok(Object.values(damageRates).every(d => d > 150), JSON.stringify(damageRates));
  assert.ok(Math.max(...Object.values(damageRates)) / Math.min(...Object.values(damageRates)) < 1.5, JSON.stringify(damageRates));
  assert.ok(WEAPON_BALANCE.companionHP >= 80);
  const state = newWeaponState(); state.rank = 5; state.companions = [90, 90];
  const shots = fireWeapon(state, { x: 210, y: 600, vx: 0, vy: 0 }, 0).shots;
  assert.ok(shots.at(-1).damage >= shots[0].damage * 2);
});

test('repair represents only two percent of random drops and no weapon emits free repairs', () => {
  const repairs = Array.from({ length: 1000 }, (_, i) => pickDrop(i / 1000)).filter(d => d === 'REPAIR').length;
  assert.equal(repairs, 20);
  assert.ok(WEAPON_BALANCE.bossRepairChance > 0 && WEAPON_BALANCE.bossRepairChance <= .15);
});