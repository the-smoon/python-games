export type WeaponType = 'TWIN' | 'SPREAD' | 'LASER';
export type PickupType = WeaponType | 'RAPID' | 'SHIELD' | 'REPAIR' | 'BOMB';
export const WEAPON_BALANCE = {
  maxRank: 5, maxHealth: 100, switchRepairPerRank: 10, repairHP: 25,
  rapidSeconds: 10, shieldSeconds: 6, rapidMultiplier: 1.5,
  companionHP: 90, companionOffset: 33, companionDamageMultiplier: 2.5,
  freezeSeconds: 3, freezeRadius: 48, slowMultiplier: .4,
  stoppedSpeed: .08, maxBullets: 320,
  weakEnemyDropChance: .025, strongEnemyDropBonus: .085, subBossDropChance: .25,
  bossDropChance: .5, bossRepairChance: .12, maxEnemyHealthForDropScaling: 22, dropPity: 24,
  maxDrops: 10, dropSeconds: 12, dropSpeed: 55,
  bombWeakHealth: 8, bombEnemyDamage: 25, bombStrongHealthFraction: .55, bombBossDamage: 180,
};
export const PICKUP_INFO: Record<PickupType, { label: string; glyph: string; color: string }> = {
  TWIN: { label: 'Twin guns', glyph: 'II', color: '#ffe45e' },
  SPREAD: { label: 'Spread shot', glyph: 'W', color: '#ff9a52' },
  LASER: { label: 'Laser', glyph: 'L', color: '#ee8cff' },
  RAPID: { label: 'Rapid fire', glyph: 'RF', color: '#56e9ff' },
  SHIELD: { label: 'Energy shield', glyph: 'S', color: '#7cb8ff' },
  REPAIR: { label: 'Hull repair', glyph: '+', color: '#74ffb0' },
  BOMB: { label: 'Bomb', glyph: 'B', color: '#ff6286' },
};
export type WeaponState = {
  type: WeaponType; rank: number; nextFireAt: number; volley: number;
  chargeStartedAt: number | null; cooldownUntil: number;
  rapidUntil: number; shieldUntil: number; companions: number[];
};
export type PlayerShot = {
  x: number; y: number; vx: number; vy: number; alive: boolean;
  damage: number; radius: number; freeze: boolean; weapon: WeaponType;
};
export type LaserBeam = { x: number; y: number; width: number; damage: number; until: number };
export type Pickup = { type: PickupType; x: number; y: number; expiresAt: number; alive: boolean };
export type FreezeTarget = { x: number; y: number; radius: number; frozenUntil?: number; alive?: boolean };

export function newWeaponState(): WeaponState {
  return { type: 'TWIN', rank: 1, nextFireAt: 0, volley: 0, chargeStartedAt: null,
    cooldownUntil: 0, rapidUntil: 0, shieldUntil: 0, companions: [0, 0] };
}
export function weaponStats(type: WeaponType, rank: number) {
  const r = Math.max(1, Math.min(WEAPON_BALANCE.maxRank, rank));
  return {
    interval: type === 'TWIN' ? (8 - (r - 1) * .7) / 60 : .42 - (r - 1) * .03,
    damage: type === 'TWIN' ? 1 + (r - 1) * .3 : 2.5 + (r - 1) * .875,
    pellets: 5 + (r - 1) * 2,
    laserWidth: 6 + (r - 1) * 5,
    laserDamage: 95 + (r - 1) * 38,
    laserCharge: .65 - (r - 1) * .1,
    laserCooldown: 1.6 - (r - 1) * .2,
    spreadArc: 1.1 - (r - 1) * .125,
    freezeEvery: r === 5 ? 8 : 10,
  };
}
export function collectPickup(state: WeaponState, type: PickupType, health: number, now: number) {
  let repair = 0;
  let message = PICKUP_INFO[type].label;
  if (type === 'REPAIR') repair = WEAPON_BALANCE.repairHP;
  else if (type === 'RAPID') state.rapidUntil = now + WEAPON_BALANCE.rapidSeconds;
  else if (type === 'SHIELD') state.shieldUntil = now + WEAPON_BALANCE.shieldSeconds;
  else if (type !== 'BOMB') {
    if (type === state.type) {
      state.rank = Math.min(WEAPON_BALANCE.maxRank, state.rank + 1);
    } else {
      repair = (state.rank - 1) * WEAPON_BALANCE.switchRepairPerRank;
      state.type = type; state.rank = 1; state.companions = [0, 0];
    }
    if (type === 'TWIN' && state.rank === WEAPON_BALANCE.maxRank) {
      state.companions = state.companions.map((hp) => hp <= 0 ? WEAPON_BALANCE.companionHP : hp);
    }
    state.nextFireAt = now; state.volley = 0;
    state.chargeStartedAt = null; state.cooldownUntil = 0;
    message += ` · Rank ${state.rank}`;
  }
  const nextHealth = Math.min(WEAPON_BALANCE.maxHealth, health + repair);
  if (nextHealth > health) message += ` · +${nextHealth - health} HP`;
  return { health: nextHealth, message, bomb: type === 'BOMB' };
}
export function companionPositions(player: { x: number; y: number }, state: WeaponState, width = 420) {
  return state.companions.map((health, index) => ({
    x: Math.max(10, Math.min(width - 10, player.x + (index === 0 ? -1 : 1) * WEAPON_BALANCE.companionOffset)),
    y: player.y + 8, health, index,
  }));
}
export function fireWeapon(state: WeaponState, player: { x: number; y: number; vx: number; vy: number; debuffUntil?: number }, now: number) {
  const shots: PlayerShot[] = [];
  const stats = weaponStats(state.type, state.rank);
  const boost = (state.rapidUntil > now ? WEAPON_BALANCE.rapidMultiplier : 1) * ((player.debuffUntil ?? 0) > now ? .65 : 1);
  if (state.type === 'LASER') {
    if (Math.hypot(player.vx, player.vy) > WEAPON_BALANCE.stoppedSpeed) {
      state.chargeStartedAt = null;
      return { shots, beam: null };
    }
    if (now < state.cooldownUntil) return { shots, beam: null };
    state.chargeStartedAt ??= now;
    if (now - state.chargeStartedAt + 1e-9 < stats.laserCharge / boost) return { shots, beam: null };
    state.chargeStartedAt = null; state.cooldownUntil = now + stats.laserCooldown / boost;
    return { shots, beam: { x: player.x, y: player.y - 18, width: stats.laserWidth, damage: stats.laserDamage, until: now + .16 } };
  }
  if (now < state.nextFireAt) return { shots, beam: null };
  state.nextFireAt = now + stats.interval / boost;
  state.volley += 1;
  const add = (x: number, y: number, vx: number, vy: number, freeze = false, damage = stats.damage) =>
    shots.push({ x, y, vx, vy, freeze, damage, alive: true, radius: state.type === 'SPREAD' ? 4 : 2, weapon: state.type });
  if (state.type === 'TWIN') {
    for (const offset of [-13, -7, 7, 13]) add(player.x + offset, player.y - 18, 0, -48);
    for (const companion of companionPositions(player, state)) {
      if (companion.health > 0) add(companion.x, companion.y - 12, 0, -48, false, stats.damage * WEAPON_BALANCE.companionDamageMultiplier);
    }
  } else {
    const freeze = state.volley % stats.freezeEvery === 0;
    for (let i = 0; i < stats.pellets; i++) {
      const angle = -Math.PI / 2 + (i / (stats.pellets - 1) - .5) * stats.spreadArc;
      add(player.x, player.y - 18, Math.cos(angle) * 34, Math.sin(angle) * 34, freeze);
    }
  }
  return { shots, beam: null };
}
export function laserHitsTarget(beam: LaserBeam, target: { x: number; y: number; radius: number }) {
  return target.y + target.radius >= 0 && target.y - target.radius <= beam.y &&
    Math.abs(target.x - beam.x) <= target.radius + beam.width / 2;
}
export function clearLaserHits<T extends { x: number; y: number; radius: number; alive: boolean }>(
  beam: LaserBeam, bullets: T[],
) {
  const cleared: T[] = [];
  for (const bullet of bullets) {
    if (bullet.alive && laserHitsTarget(beam, bullet)) {
      bullet.alive = false;
      cleared.push(bullet);
    }
  }
  return cleared;
}
export function freezeSplash(x: number, y: number, enemies: FreezeTarget[], bullets: FreezeTarget[], now: number) {
  for (const target of [...enemies, ...bullets]) {
    if (target.alive !== false && Math.hypot(target.x - x, target.y - y) <= WEAPON_BALANCE.freezeRadius + target.radius) {
      // Refresh to one bounded three-second window; never stack slow strength.
      target.frozenUntil = now + WEAPON_BALANCE.freezeSeconds;
    }
  }
}
export function slowScale(target: { frozenUntil?: number }, now: number) {
  return (target.frozenUntil ?? 0) > now ? WEAPON_BALANCE.slowMultiplier : 1;
}
export function bombDamage(target: { maxHealth: number; subBoss: boolean }) {
  return !target.subBoss && target.maxHealth <= WEAPON_BALANCE.bombWeakHealth
    ? target.maxHealth
    : Math.min(WEAPON_BALANCE.bombEnemyDamage, target.maxHealth * WEAPON_BALANCE.bombStrongHealthFraction);
}
export function tickFrozenBullet(bullet: { frozenUntil?: number; alive: boolean }, now: number) {
  if (!bullet.frozenUntil) return false;
  if (now >= bullet.frozenUntil) bullet.alive = false;
  return true;
}
export function pickDrop(roll: number): PickupType {
  const weighted: [PickupType, number][] = [
    ['TWIN', 22], ['SPREAD', 22], ['LASER', 22], ['REPAIR', 2], ['SHIELD', 14], ['RAPID', 12], ['BOMB', 6],
  ];
  let cursor = Math.max(0, Math.min(.999999, roll)) * 100;
  for (const [type, weight] of weighted) {
    cursor -= weight;
    if (cursor < 0) return type;
  }
  return 'BOMB';
}
export function enemyDropChance(enemy: { maxHealth: number; subBoss: boolean }) {
  if (enemy.subBoss) return WEAPON_BALANCE.subBossDropChance;
  const strength = Math.max(0, Math.min(1,
    (enemy.maxHealth - 1) / (WEAPON_BALANCE.maxEnemyHealthForDropScaling - 1)));
  return WEAPON_BALANCE.weakEnemyDropChance + WEAPON_BALANCE.strongEnemyDropBonus * strength;
}
export function advancePickup(pickup: Pickup, player: { x: number; y: number }, now: number, seconds: number, height: number) {
  if (!pickup.alive) return false;
  pickup.y += WEAPON_BALANCE.dropSpeed * seconds;
  if (now >= pickup.expiresAt || pickup.y > height + 25) { pickup.alive = false; return false; }
  if (Math.hypot(pickup.x - player.x, pickup.y - player.y) < 30) { pickup.alive = false; return true; }
  return false;
}