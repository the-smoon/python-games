import type { EnemyEntity, PlayerEntity } from './gameRuntimeTypes';
import { audioIntensity, type AttackPattern, type ShapeIdentity } from './encounterRules.ts';
import type { LiveFeatures, ProjectileKind, ActiveBoss, Behavior, EnemyBulletEntity } from './gameRuntimeTypes';
import { slowScale } from './weaponRules.ts';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function chooseBehavior(features: LiveFeatures): Behavior {
  if (features.onset > .78 && features.high > .42) return 'DIVE';
  if (features.onset > .58) return 'SWARM';
  if (features.low > .62) return 'TANK';
  if (features.mid > .52 && features.rms > .3) return 'SHOOTER';
  if (features.centroid > .56) return 'ZIGZAG';
  if (features.rms > .28 && features.flatness < .38) return 'FORMATION';
  return 'PATROL';
}

export function chooseEnemyShape(features: LiveFeatures, serial: number, musicalIdentity?: ShapeIdentity): ShapeIdentity {
  const shapes: ShapeIdentity[] = ['CIRCLE', 'SQUARE', 'TRIANGLE', 'RECTANGLE', 'OVAL', 'ELBOW', 'CAPSULE', 'DIAMOND', 'HEX', 'RING'];
  if (musicalIdentity && Math.abs(Math.trunc(serial)) % 3 === 0) return musicalIdentity;
  return shapes[(serial + Math.floor(features.centroid * 5 + features.low * 3)) % shapes.length];
}

export function chooseProjectile(features: LiveFeatures, behavior: Behavior | 'BOSS'): ProjectileKind {
  if (features.high > .68 && features.centroid > .5) return 'SHARD';
  if (features.low > .68 && (behavior === 'TANK' || behavior === 'BOSS')) return 'RING';
  if (features.mid > .5) return 'BOLT';
  return 'ORB';
}

export function createEnemyProjectile(
  x: number, y: number, vx: number, vy: number, damage: number, kind: ProjectileKind,
): EnemyBulletEntity {
  const speedScale: Record<ProjectileKind, number> = { ORB: 1, BOLT: 1.12, SHARD: 1.28, RING: .78 };
  const radius: Record<ProjectileKind, number> = { ORB: 4, BOLT: 3, SHARD: 4, RING: 6 };
  return {
    x, y, vx: vx * speedScale[kind], vy: vy * speedScale[kind], damage,
    alive: true, kind, radius: radius[kind], spin: Math.atan2(vy, vx),
  };
}

export function firePattern(
  bullets: EnemyBulletEntity[], x: number, y: number, player: Pick<PlayerEntity, 'x' | 'y'>,
  pattern: AttackPattern, kind: ProjectileKind, speed: number, damage: number, serial: number, ownerId?: number,
) {
  if (bullets.length >= 260) return;
  const aim = Math.atan2(player.y - y, player.x - x);
  const shot = (angle: number, speedScale = 1) => {
    if (bullets.length < 260) {
      bullets.push({
        ...createEnemyProjectile(x, y, Math.cos(angle) * speed * speedScale,
          Math.sin(angle) * speed * speedScale, damage, kind),
        ownerId,
      });
    }
  };
  if (pattern === 'TRACK') shot(aim);
  else if (pattern === 'BURST') for (let index = -2; index <= 2; index += 1) shot(aim + index * .15);
  else if (pattern === 'RADIAL') for (let index = 0; index < 10; index += 1) shot(index * Math.PI / 5 + serial * .08, .8);
  else if (pattern === 'SPIRAL') for (let index = 0; index < 4; index += 1) shot(aim + index * Math.PI / 2 + serial * .13, .9);
  else for (let index = -2; index <= 2; index += 1) shot(Math.PI / 2 + index * .24 + Math.sin(serial * .15) * .12);
}

function moveDynamicBoss(
  boss: ActiveBoss, player: Pick<PlayerEntity, 'x' | 'y'>, live: LiveFeatures, delta: number, width: number,
) {
  const energy = audioIntensity(live);
  const speed = 1 + energy * 1.6 + live.tempo / 240;
  const time = (boss.phaseFrame + (boss.id - 1) * 71) * .015 * speed;
  if (boss.motion === 'ORBIT') {
    const targetX = width / 2 + Math.sin(time) * (width / 2 - boss.radius - 24);
    const targetY = 142 + Math.cos(time * 1.3) * (22 + live.mid * 30);
    boss.x += (targetX - boss.x) * Math.min(.08 * delta, .2);
    boss.y += (targetY - boss.y) * Math.min(.08 * delta, .2);
  } else if (boss.motion === 'SWEEP') {
    boss.x += boss.vx * (3 + speed * 2.5) * delta;
    boss.y = 135 + Math.sin(time * .8) * 38;
    if (boss.x < boss.radius + 18 || boss.x > width - boss.radius - 18) boss.vx *= -1;
  } else if (boss.motion === 'CHASE') {
    boss.x += (player.x - boss.x) * (.008 + energy * .018) * delta;
    boss.y += (clamp(player.y - 280, 110, 225) - boss.y) * .02 * delta;
  } else if (boss.motion === 'DASH') {
    boss.x += (player.x - boss.x) * (.009 + (Math.sin(time * 2) > .72 ? .1 : 0)) * delta;
    boss.y = 142 + Math.sin(time) * 40;
  } else {
    boss.x += boss.vx * (3 + speed * 1.8) * delta;
    boss.y = 138 + Math.sin(time * 2.3) * 55;
    if (boss.x < boss.radius + 18 || boss.x > width - boss.radius - 18) boss.vx *= -1;
  }
  boss.x = clamp(boss.x, boss.radius + 15, width - boss.radius - 15);
  boss.y = clamp(boss.y, boss.radius + 20, 245);
}

/** Advance one enemy's live-audio-driven movement and return its scaled combat delta. */
function moveEnemy(
  enemy: EnemyEntity, player: Pick<PlayerEntity, 'x' | 'y'>, live: LiveFeatures,
  delta: number, width: number, now: number,
) {
  if ((enemy.stunnedUntil ?? 0) > now) return 0;
  const confused = (enemy.confusedUntil ?? 0) > now;
  const buffed = (enemy.buffUntil ?? 0) > now;
  const enemyDelta = delta * slowScale(enemy, now) * (confused ? .28 : buffed ? 1.35 : 1);
  enemy.frame += enemyDelta;
  const movement = enemy.speed * enemyDelta * .18 * (1 + audioIntensity(live) * .3);
  if (enemy.exiting) {
    enemy.fireRate = 0;
    enemy.y += (12 + enemy.speed * 2.2) * delta;
  } else if (confused) {
    enemy.x += Math.sin(enemy.frame * .18 + enemy.formX) * movement * 2.8;
    enemy.y += (Math.cos(enemy.frame * .15 + enemy.formX * .1) * 1.8 + .15) * movement;
  } else if (enemy.motion === 'ORBIT') {
    enemy.formY += movement * .65;
    enemy.y += (enemy.formY + Math.cos(enemy.frame * .06) * 15 - enemy.y) * .08 * enemyDelta;
    enemy.x += (enemy.formX + Math.sin(enemy.frame * .045) * (enemy.subBoss ? 75 : 30) - enemy.x) * .08 * enemyDelta;
  } else if (enemy.motion === 'SWEEP') {
    enemy.y += movement * .5;
    enemy.x += enemy.zigDir * movement * 2.3;
    if (enemy.x <= enemy.radius || enemy.x >= width - enemy.radius) enemy.zigDir *= -1;
  } else if (enemy.motion === 'CHASE') {
    enemy.y += movement * .55;
    enemy.x += (player.x - enemy.x) * .018 * enemyDelta;
  } else if (enemy.motion === 'DASH') {
    if (!enemy.diving && enemy.y > 85 && (live.pulse || enemy.frame > 75)) {
      enemy.diving = true;
      const angle = Math.atan2(player.y - enemy.y, player.x - enemy.x);
      enemy.dvx = Math.cos(angle) * enemy.speed * 2;
      enemy.dvy = Math.sin(angle) * enemy.speed * 2;
    }
    if (enemy.diving) {
      enemy.x += enemy.dvx * enemyDelta * .18;
      enemy.y += enemy.dvy * enemyDelta * .18;
    } else enemy.y += movement * .7;
  } else {
    enemy.y += movement * .7;
    enemy.x += Math.sin(enemy.frame * .09) * movement * 1.5;
  }
  enemy.x = clamp(enemy.x, enemy.radius, width - enemy.radius);
  if (enemy.subBoss && !enemy.exiting) enemy.y = clamp(enemy.y, enemy.radius + 40, 325);
  return enemyDelta;
}

export type CombatInput = Readonly<{ x: number; y: number; active: boolean }>;
export type PlayerField = Readonly<{ speedScale?: number; pullX?: number; pullY?: number }>;
export type ArenaBounds = Readonly<{
  width: number;
  height: number;
  playerWidth: number;
  playerHeight: number;
  maxSpeed: number;
  acceleration: number;
  deceleration: number;
}>;

export interface CombatSimulation {
  movePlayer(player: PlayerEntity, input: CombatInput, delta: number, bossEncounter: boolean, now?: number, field?: PlayerField): void;
  moveBoss(boss: ActiveBoss, player: Pick<PlayerEntity, 'x' | 'y'>, live: LiveFeatures, delta: number): void;
  moveEnemy(
    enemy: EnemyEntity, player: Pick<PlayerEntity, 'x' | 'y'>, live: LiveFeatures,
    delta: number, now: number,
  ): number;
  enemyHitsPlayer(enemy: Pick<EnemyEntity, 'x' | 'y' | 'radius'>, player: Pick<PlayerEntity, 'x' | 'y'>): boolean;
}

/** Deterministic player motion and contact geometry shared by the live combat loop. */
export class FrameCombatSimulation implements CombatSimulation {
  private readonly bounds: ArenaBounds;
  constructor(bounds: ArenaBounds) { this.bounds = bounds; }

  movePlayer(player: PlayerEntity, input: CombatInput, delta: number, bossEncounter: boolean, now = 0, field: PlayerField = {}) {
    const { width, height, maxSpeed, acceleration, deceleration } = this.bounds;
    let x = input.x;
    let y = input.y;
    if (![player.x, player.y, player.vx, player.vy, x, y].every(Number.isFinite)) {
      player.x = width / 2;
      player.y = height / 2;
      player.vx = 0;
      player.vy = 0;
      x = 0;
      y = 0;
    }
    const speedScale = ((player.debuffUntil ?? 0) > now ? .65 : 1) *
      Math.max(.4, Math.min(1, Number.isFinite(field.speedScale) ? field.speedScale! : 1));
    const targetVx = x * maxSpeed * speedScale;
    const targetVy = y * maxSpeed * speedScale;
    const changeX = targetVx - player.vx;
    const changeY = targetVy - player.vy;
    const distance = Math.hypot(changeX, changeY);
    const velocityStep = (input.active ? acceleration : deceleration) * delta;
    if (distance <= velocityStep) {
      player.vx = targetVx;
      player.vy = targetVy;
    } else {
      player.vx += changeX / distance * velocityStep;
      player.vy += changeY / distance * velocityStep;
    }
    player.vx += (Number.isFinite(field.pullX) ? field.pullX! : 0) * delta;
    player.vy += (Number.isFinite(field.pullY) ? field.pullY! : 0) * delta;
    const minX = 22;
    const maxX = width - 22;
    const minY = 90;
    const maxY = bossEncounter ? height - 150 : height - 100;
    player.x = Math.max(minX, Math.min(maxX, player.x + player.vx * delta));
    player.y = Math.max(minY, Math.min(maxY, player.y + player.vy * delta));
    if ((player.x === minX && player.vx < 0) || (player.x === maxX && player.vx > 0)) player.vx = 0;
    if ((player.y === minY && player.vy < 0) || (player.y === maxY && player.vy > 0)) player.vy = 0;
    player.frame += 1;
  }

  moveBoss(boss: ActiveBoss, player: Pick<PlayerEntity, 'x' | 'y'>, live: LiveFeatures, delta: number) {
    moveDynamicBoss(boss, player, live, delta, this.bounds.width);
  }

  moveEnemy(
    enemy: EnemyEntity, player: Pick<PlayerEntity, 'x' | 'y'>, live: LiveFeatures, delta: number, now: number,
  ) {
    return moveEnemy(enemy, player, live, delta, this.bounds.width, now);
  }

  enemyHitsPlayer(enemy: Pick<EnemyEntity, 'x' | 'y' | 'radius'>, player: Pick<PlayerEntity, 'x' | 'y'>) {
    const { playerWidth, playerHeight } = this.bounds;
    const nearestX = Math.max(player.x - playerWidth / 2, Math.min(enemy.x, player.x + playerWidth / 2));
    const nearestY = Math.max(player.y - playerHeight / 2, Math.min(enemy.y, player.y + playerHeight / 2));
    return (enemy.x - nearestX) ** 2 + (enemy.y - nearestY) ** 2 <= enemy.radius ** 2;
  }
}