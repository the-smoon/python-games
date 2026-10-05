import assert from 'node:assert/strict';
import test from 'node:test';
import { advancePickup, bombDamage, clearLaserHits, collectPickup, companionPositions, enemyDropChance,
  fireWeapon, freezeSplash, laserHitsTarget, newWeaponState, pickDrop, slowScale, tickFrozenBullet,
  weaponStats, WEAPON_BALANCE } from '../src/weaponRules.ts';
import { advanceProjectiles, damageBoss } from '../src/gameRules.ts';

const player = { x: 210, y: 450, vx: 0, vy: 0 };
test('same pickups rank up and cap; switching replaces rank and repairs only lost ranks', () => {
  const w = newWeaponState();
  for (let i = 0; i < 8; i++) collectPickup(w, 'TWIN', 100, i);
  assert.equal(w.rank, 5);
  assert.deepEqual(w.companions, [WEAPON_BALANCE.companionHP, WEAPON_BALANCE.companionHP]);
  const result = collectPickup(w, 'SPREAD', 30, 10);
  assert.equal(w.type, 'SPREAD'); assert.equal(w.rank, 1); assert.equal(result.health, 70);
  assert.deepEqual(w.companions, [0, 0]);
  assert.equal(collectPickup(w, 'LASER', 70, 11).health, 70);
  w.rank = 5;
  assert.equal(collectPickup(w, 'TWIN', 90, 12).health, 100);
});
test('max-rank twin pickup restores destroyed companions, not healthy or partially damaged ones', () => {
  const w = newWeaponState(); w.rank = 5; w.companions = [0, 7];
  collectPickup(w, 'TWIN', 100, 0);
  assert.deepEqual(w.companions, [WEAPON_BALANCE.companionHP, 7]);
  assert.equal(fireWeapon(w, player, 0).shots.length, 6);
  w.companions[0] = 0;
  assert.equal(fireWeapon(w, player, 1).shots.length, 5);
  assert.ok(companionPositions({ x: 22, y: 450 }, w).every((c) => c.x >= 10));
});
test('spread has five angled stronger pellets, scales count, and freezes every tenth volley', () => {
  const w = newWeaponState(); collectPickup(w, 'SPREAD', 100, 0);
  for (let i = 1; i <= 10; i++) {
    const volley = fireWeapon(w, player, i);
    assert.equal(volley.shots.length, 5);
    assert.ok(volley.shots[0].vx < 0 && volley.shots[4].vx > 0);
    assert.ok(volley.shots.every((s) => s.damage > 1 && s.freeze === (i === 10)));
  }
  w.rank = 5;
  assert.equal(fireWeapon(w, player, 11).shots.length, 13);
  assert.ok(weaponStats('SPREAD', 5).interval > weaponStats('TWIN', 5).interval);
});
test('boosts refresh rather than stack and repair caps at max hull', () => {
  const w = newWeaponState();
  collectPickup(w, 'RAPID', 100, 1); collectPickup(w, 'RAPID', 100, 2);
  assert.equal(w.rapidUntil, 12);
  collectPickup(w, 'SHIELD', 100, 4); assert.equal(w.shieldUntil, 10);
  assert.equal(collectPickup(w, 'REPAIR', 90, 0).health, 100);
  const a = newWeaponState(), b = newWeaponState(); b.rapidUntil = 10;
  fireWeapon(a, player, 0); fireWeapon(b, player, 0);
  assert.ok(b.nextFireAt < a.nextFireAt);
});
test('laser requires physical rest, cancels charge without spending cooldown, and cannot bypass cooldown', () => {
  const w = newWeaponState(); collectPickup(w, 'LASER', 100, 0);
  assert.equal(fireWeapon(w, { ...player, vx: .2 }, 0).beam, null);
  assert.equal(w.chargeStartedAt, null);
  fireWeapon(w, player, 1);
  fireWeapon(w, { ...player, vy: 1 }, 1.4);
  assert.equal(w.chargeStartedAt, null); assert.equal(w.cooldownUntil, 0);
  fireWeapon(w, player, 1.5);
  assert.equal(fireWeapon(w, player, 2).beam, null);
  const result = fireWeapon(w, player, 2.15);
  assert.ok(result.beam); const cooldown = w.cooldownUntil;
  fireWeapon(w, { ...player, vx: 2 }, 2.2); fireWeapon(w, player, 2.3);
  assert.equal(w.cooldownUntil, cooldown); assert.equal(w.chargeStartedAt, null);
  assert.ok(weaponStats('LASER', 5).laserWidth > result.beam.width);
  assert.ok(weaponStats('LASER', 5).laserCharge < weaponStats('LASER', 1).laserCharge);
  assert.ok(weaponStats('LASER', 5).laserCooldown < weaponStats('LASER', 1).laserCooldown);
});
test('laser line intersects all aligned targets, not targets beside or below it', () => {
  const beam = { x: 210, y: 432, width: 6, damage: 95, until: 1 };
  assert.equal(laserHitsTarget(beam, { x: 210, y: 100, radius: 18 }), true);
  assert.equal(laserHitsTarget(beam, { x: 225, y: 300, radius: 18 }), true);
  assert.equal(laserHitsTarget(beam, { x: 240, y: 300, radius: 18 }), false);
  assert.equal(laserHitsTarget(beam, { x: 210, y: 470, radius: 18 }), false);
});
test('laser sweeps clear only live hostile bullets that cross the beam', () => {
  const beam = { x: 210, y: 432, width: 6, damage: 95, until: 1 };
  const bullets = [
    { x: 214, y: 100, radius: 4, alive: true },
    { x: 218, y: 100, radius: 4, alive: true },
    { x: 210, y: 439, radius: 4, alive: true },
    { x: 210, y: 200, radius: 4, alive: false },
  ];
  const cleared = clearLaserHits(beam, bullets);
  assert.deepEqual(cleared, [bullets[0]]);
  assert.deepEqual(bullets.map((bullet) => bullet.alive), [false, true, true, false]);
});
test('freeze stays local for exactly three seconds; bullets pop, enemies recover without changing base stats', () => {
  const enemies = [{ x: 100, y: 100, radius: 10, speed: 4 }, { x: 200, y: 100, radius: 10, speed: 4 }];
  const shots = [{ x: 100, y: 110, vx: 10, vy: 10, radius: 4, alive: true },
    { x: 200, y: 110, vx: 10, vy: 10, radius: 4, alive: true }];
  freezeSplash(100, 100, enemies, shots, 5);
  assert.equal(enemies[0].frozenUntil, 8); assert.equal(enemies[1].frozenUntil, undefined);
  assert.equal(slowScale(enemies[0], 7.999), .4); assert.equal(slowScale(enemies[0], 8), 1);
  advanceProjectiles([], shots, 1, 420, 900);
  assert.equal(shots[0].x, 100); assert.ok(shots[1].x > 200);
  assert.equal(tickFrozenBullet(shots[0], 7.999), true); assert.equal(shots[0].alive, true);
  tickFrozenBullet(shots[0], 8); assert.equal(shots[0].alive, false);
  assert.equal(enemies[0].speed, 4);
  freezeSplash(100, 100, enemies, [], 9);
  freezeSplash(100, 100, enemies, [], 10);
  assert.equal(enemies[0].frozenUntil, 13); assert.equal(slowScale(enemies[0], 11), .4);
});
test('angled shots move horizontally and expire outside the arena', () => {
  const bullets = fireWeapon({ ...newWeaponState(), type: 'SPREAD' }, player, 0).shots;
  const start = bullets[0].x;
  advanceProjectiles(bullets, [], 1, 420, 900);
  assert.ok(bullets[0].x < start);
  bullets[0].x = -30; advanceProjectiles(bullets, [], 1, 420, 900);
  assert.equal(bullets[0].alive, false);
});
test('all seven drops are weighted and collectible once, or expire', () => {
  assert.equal(new Set(Array.from({ length: 100 }, (_, i) => pickDrop(i / 100))).size, 7);
  const drop = { type: 'REPAIR', x: 210, y: 450, expiresAt: 12, alive: true };
  assert.equal(advancePickup(drop, player, 0, .016, 900), true);
  assert.equal(advancePickup(drop, player, 0, .016, 900), false);
  const expired = { ...drop, alive: true };
  assert.equal(advancePickup(expired, player, 12, 0, 900), false);
  assert.equal(expired.alive, false);
  assert.equal(collectPickup(newWeaponState(), 'BOMB', 100, 0).bomb, true);
});
test('weapon and bomb boss damage use the same guarded death transition', () => {
  const boss = { health: 200, maxHealth: 200, phase: 'PHASE1', dyingTimer: 0 };
  damageBoss(boss, WEAPON_BALANCE.bombBossDamage); assert.equal(boss.health, 20);
  damageBoss(boss, 95); assert.equal(boss.phase, 'DYING'); assert.equal(boss.health, 0);
  assert.equal(damageBoss(boss, 95), false);
});
test('bomb destroys weak regular enemies but a healthy tougher enemy survives', () => {
  assert.equal(bombDamage({ maxHealth: 5, subBoss: false }), 5);
  const tougher = { maxHealth: 22, subBoss: false };
  assert.ok(bombDamage(tougher) < tougher.maxHealth);
  assert.equal(bombDamage({ maxHealth: 50, subBoss: true }), 25);
});
test('ordinary item drops are much rarer, scale with enemy strength, and pity no longer restores the old rate', () => {
  const weak = enemyDropChance({ maxHealth: 1, subBoss: false });
  const strong = enemyDropChance({ maxHealth: 22, subBoss: false });
  assert.ok(weak > 0 && weak < strong);
  assert.ok(Math.abs(strong - .11) < 1e-12);
  assert.equal(enemyDropChance({ maxHealth: 22, subBoss: true }), .25);
  assert.equal(WEAPON_BALANCE.bossDropChance, .5);
  const effectiveRate = (chance, failures) =>
    chance / (1 - (1 - chance) ** (failures + 1));
  const formerEffectiveRate = effectiveRate(.24, 8);
  const tunedEffectiveRate = effectiveRate(strong, WEAPON_BALANCE.dropPity);
  assert.ok(tunedEffectiveRate <= formerEffectiveRate / 2,
    'even the strongest ordinary enemies produce at most half the former effective drop rate');
});