import assert from 'node:assert/strict';
import test from 'node:test';
import { advancePickup, bombDamage, clearLaserHits, collectPickup, companionPositions, enemyDropChance,
  absorbShieldHit, convertWeaponPickupsAtMaxRank, expireShield, fireWeapon, freezeSplash, hasActiveShield,
  insideForwardShieldCone, laserHitsTarget, newWeaponState, pickDrop, slowScale, tickFrozenBullet,
  weaponStats, WEAPON_BALANCE } from '../src/weaponRules.ts';
import { advanceProjectiles, damageBoss } from '../src/gameRules.ts';

const player = { x: 210, y: 450, vx: 0, vy: 0 };
test('weapons rank to seven; switching preserves rank and locks weapon pickups for thirty seconds', () => {
  const w = newWeaponState();
  for (let i = 0; i < WEAPON_BALANCE.maxRank - 1; i++) collectPickup(w, 'TWIN', 100, i);
  assert.equal(w.rank, 7);
  assert.deepEqual(w.companions, [WEAPON_BALANCE.companionHP, WEAPON_BALANCE.companionHP]);
  const result = collectPickup(w, 'SPREAD', 30, 10);
  assert.equal(w.type, 'SPREAD'); assert.equal(w.rank, 7); assert.equal(result.health, 30);
  assert.equal(w.weaponSwitchUntil, 40);
  assert.deepEqual(w.companions, [0, 0]);
  const blockedWeapon = { type: 'LASER', x: player.x, y: player.y, expiresAt: 50, alive: true };
  assert.equal(advancePickup(blockedWeapon, player, 20, 0, 900, 20 >= w.weaponSwitchUntil), false);
  assert.equal(blockedWeapon.alive, true);
  const unrelated = { type: 'REPAIR', x: player.x, y: player.y, expiresAt: 50, alive: true };
  assert.equal(advancePickup(unrelated, player, 20, 0, 900), true);
  assert.equal(collectPickup(w, 'LASER', 70, 40).health, 70);
  assert.equal(w.rank, 7);
  assert.equal(w.weaponSwitchUntil, 70);
});
test('rank-seven twin pickups restore destroyed companions without replacing damaged ones', () => {
  const w = newWeaponState(); w.rank = 7; w.companions = [0, 7];
  collectPickup(w, 'TWIN', 100, 0);
  assert.deepEqual(w.companions, [WEAPON_BALANCE.companionHP, 7]);
  assert.equal(fireWeapon(w, player, 0).shots.length, 6);
  w.companions[0] = 0;
  assert.equal(fireWeapon(w, player, 1).shots.length, 5);
  assert.ok(companionPositions({ x: 22, y: 450 }, w).every((c) => c.x >= 10));
});
test('spread starts with a useful wider volley, scales to seventeen pellets, and freezes more often at rank seven', () => {
  const w = newWeaponState(); collectPickup(w, 'SPREAD', 100, 0);
  for (let i = 1; i <= 10; i++) {
    const volley = fireWeapon(w, player, i);
    assert.equal(volley.shots.length, 7);
    assert.ok(volley.shots[0].vx < 0 && volley.shots.at(-1).vx > 0);
    assert.ok(volley.shots.every((s) => s.damage > 1 && s.freeze === (i === 10)));
  }
  w.rank = 7;
  assert.equal(fireWeapon(w, player, 11).shots.length, 17);
  assert.ok(weaponStats('SPREAD', 7).interval > weaponStats('TWIN', 7).interval);
  assert.ok(weaponStats('SPREAD', 7).damage > weaponStats('SPREAD', 5).damage * 2);
});
test('boosts refresh rather than stack and repair caps at max hull', () => {
  const w = newWeaponState();
  collectPickup(w, 'RAPID', 100, 1); collectPickup(w, 'RAPID', 100, 2);
  assert.equal(w.rapidUntil, 12);
  collectPickup(w, 'SHIELD', 100, 4); assert.equal(w.shieldUntil, 14);
  assert.equal(w.shieldHP, WEAPON_BALANCE.shieldTierHP[1]);
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
    { x: 210, y: 100, radius: 4, alive: true, indestructible: true },
  ];
  const cleared = clearLaserHits(beam, bullets);
  assert.deepEqual(cleared, [bullets[0]]);
  assert.deepEqual(bullets.map((bullet) => bullet.alive), [false, true, true, false, true]);
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
test('all nine drop types are weighted and collectible once, or expire', () => {
  assert.equal(new Set(Array.from({ length: 100 }, (_, i) => pickDrop(i / 100))).size, 9);
  const drop = { type: 'REPAIR', x: 210, y: 450, expiresAt: 12, alive: true };
  assert.equal(advancePickup(drop, player, 0, .016, 900), true);
  assert.equal(advancePickup(drop, player, 0, .016, 900), false);
  const expired = { ...drop, alive: true };
  assert.equal(advancePickup(expired, player, 12, 0, 900), false);
  assert.equal(expired.alive, false);
  assert.equal(collectPickup(newWeaponState(), 'BOMB', 100, 0).bomb, true);
});
test('rank-seven weapon drops become distinct mini-health pickups worth ten hull', () => {
  const w = newWeaponState();
  const drops = [
    { type: 'TWIN', x: 1, y: 1, expiresAt: 10, alive: true },
    { type: 'REPAIR', x: 2, y: 2, expiresAt: 10, alive: true },
  ];
  convertWeaponPickupsAtMaxRank(drops, w);
  assert.equal(drops[0].type, 'TWIN');
  w.rank = 7;
  convertWeaponPickupsAtMaxRank(drops, w);
  assert.equal(drops[0].type, 'MINI_REPAIR');
  assert.equal(drops[1].type, 'REPAIR');
  assert.equal(collectPickup(w, 'MINI_REPAIR', 40, 0).health, 50);
  assert.equal(collectPickup(w, 'REPAIR', 40, 0).health, 65);
});
test('shield pickups repair, replace, expire into one shot per remaining HP, and break into a cone', () => {
  const w = newWeaponState();
  collectPickup(w, 'SHIELD', 100, 0);
  assert.deepEqual([w.shieldTier, w.shieldHP, w.shieldMaxHP, w.shieldUntil], [1, 20, 20, 10]);
  assert.equal(hasActiveShield(w, 9.99), true);
  collectPickup(w, 'SHIELD_3', 100, 1);
  assert.deepEqual([w.shieldTier, w.shieldHP, w.shieldMaxHP, w.shieldUntil], [3, 55, 55, 11]);
  absorbShieldHit(w, 10, 2);
  collectPickup(w, 'SHIELD_3', 100, 2);
  assert.deepEqual([w.shieldTier, w.shieldHP, w.shieldMaxHP, w.shieldUntil], [3, 55, 55, 12],
    'a same-tier pickup fully repairs and refreshes the shield');
  absorbShieldHit(w, 19, 3);
  assert.equal(w.shieldHP, 36);
  collectPickup(w, 'SHIELD_2', 100, 4);
  assert.deepEqual([w.shieldTier, w.shieldHP, w.shieldMaxHP], [3, 55, 55], 'a lower tier repairs when remaining HP is above its full HP');
  absorbShieldHit(w, 35, 5);
  assert.equal(w.shieldHP, 20);
  collectPickup(w, 'SHIELD', 100, 6);
  assert.deepEqual([w.shieldTier, w.shieldHP, w.shieldMaxHP], [1, 20, 20], 'otherwise the lower tier replaces it at full HP');
  absorbShieldHit(w, 17, 7);
  assert.equal(expireShield(w, 15.99), 0);
  assert.equal(expireShield(w, 16), 3);
  assert.deepEqual([w.shieldTier, w.shieldHP, w.shieldMaxHP, w.shieldUntil], [0, 0, 0, 0]);
  assert.equal(expireShield(w, 16), 0, 'expiry emits the remaining-health volley only once');
  collectPickup(w, 'SHIELD_2', 100, 20);
  const broken = absorbShieldHit(w, WEAPON_BALANCE.shieldTierHP[2], 21);
  assert.deepEqual(broken, { absorbed: true, destroyed: true, remainingHP: 0 });
  assert.equal(hasActiveShield(w, 21), false);
  assert.equal(insideForwardShieldCone({ x: 100, y: 100 }, { x: 100, y: 20, radius: 8 }), true);
  assert.equal(insideForwardShieldCone({ x: 100, y: 100 }, { x: 200, y: 20, radius: 8 }), false);
  assert.equal(insideForwardShieldCone({ x: 100, y: 100 }, { x: 100, y: 220, radius: 8 }), false);
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