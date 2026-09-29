export const STAGE_LEVEL_SECONDS = 30;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function stageProgress(songTime: number) {
  return {
    secondsLeft: Math.ceil(clamp(STAGE_LEVEL_SECONDS - songTime, 0, STAGE_LEVEL_SECONDS)),
    progress: clamp(songTime / STAGE_LEVEL_SECONDS, 0, 1),
    finished: songTime >= STAGE_LEVEL_SECONDS,
  };
}

export function spawnPressure(progress: number, intensity: number, onset: number, high: number) {
  return {
    count: Math.min(5, 1 + Math.floor(progress * 2.5 + intensity * 1.5 + (onset > .8 ? 1 : 0))),
    cooldown: clamp(84 - progress * 51 - intensity * 15 - high * 5, 24, 84),
  };
}

export type BossPhase = 'INTRO' | 'PHASE1' | 'PHASE2' | 'PHASE3' | 'DYING';
export type BossMotion = { x: number; y: number; radius: number; vx: number; phaseFrame: number; phase: BossPhase };
export type BossHealth = { health: number; maxHealth: number; phase: BossPhase; dyingTimer: number };

export function bossPhase(health: number, maxHealth: number): BossPhase {
  const ratio = health / maxHealth;
  return ratio > .66 ? 'PHASE1' : ratio > .33 ? 'PHASE2' : 'PHASE3';
}

export function moveBoss(
  boss: BossMotion,
  player: { x: number; y: number },
  live: { low: number; mid: number; high: number },
  delta: number,
  width: number,
  height: number,
) {
  if (boss.phase === 'PHASE1') {
    const orbit = boss.phaseFrame * .017 + Math.sin(boss.phaseFrame * .04) * live.high * .2;
    boss.x = width / 2 + Math.sin(orbit) * (230 + live.low * 40);
    boss.y = 132 + Math.cos(orbit) * (32 + live.mid * 22);
  } else if (boss.phase === 'PHASE2') {
    boss.x += boss.vx * (3.8 + live.high * 2.4) * delta;
    if (boss.x <= boss.radius + 20 || boss.x >= width - boss.radius - 20) {
      boss.x = clamp(boss.x, boss.radius + 20, width - boss.radius - 20);
      boss.vx *= -1;
    }
    boss.y = 132 + Math.sin(boss.phaseFrame * (.045 + live.mid * .02)) * (42 + live.low * 25);
  } else if (boss.phase === 'PHASE3') {
    boss.x = clamp(boss.x + (player.x - boss.x) * (.012 + live.mid * .012) * delta, boss.radius, width - boss.radius);
    boss.y = clamp(boss.y + (Math.min(player.y - 120, 200) - boss.y) * (.008 + live.low * .012) * delta, boss.radius, height - boss.radius);
  }
}

export function damageBoss(boss: BossHealth) {
  if (boss.phase === 'DYING') return false;
  boss.health = Math.max(0, boss.health - 1);
  if (boss.health === 0) {
    boss.phase = 'DYING';
    boss.dyingTimer = 0;
  }
  return true;
}

export function advanceBossDeath(boss: BossHealth, delta: number) {
  boss.dyingTimer += delta;
  return boss.dyingTimer >= 150;
}

export function advanceProjectiles(
  playerBullets: { x: number; y: number; vy: number; alive: boolean }[],
  enemyBullets: { x: number; y: number; vx: number; vy: number; alive: boolean }[],
  delta: number,
  width: number,
  height: number,
) {
  for (const bullet of playerBullets) {
    bullet.y += bullet.vy * delta * .22;
    if (bullet.y < -20) bullet.alive = false;
  }
  for (const bullet of enemyBullets) {
    bullet.x += bullet.vx * delta * .26;
    bullet.y += bullet.vy * delta * .26;
    if (bullet.y > height + 20 || bullet.y < -20 || bullet.x < -20 || bullet.x > width + 20) bullet.alive = false;
  }
}

export function playerShotHitsTarget(bullet: { x: number; y: number }, target: { x: number; y: number; radius: number }) {
  return Math.hypot(bullet.x - target.x, bullet.y - target.y) <= target.radius + 4;
}

export function enemyShotHitsPlayer(bullet: { x: number; y: number; radius?: number }, player: { x: number; y: number }, playerWidth: number, playerHeight: number) {
  const radius = bullet.radius ?? 4;
  return !(bullet.x + radius < player.x - playerWidth / 2 ||
    bullet.x - radius > player.x + playerWidth / 2 ||
    bullet.y + radius < player.y - playerHeight / 2 ||
    bullet.y - radius > player.y + playerHeight / 2);
}

export function configureGameplayAudio(stage: { loop: boolean }, boss: { loop: boolean }) {
  stage.loop = true;
  boss.loop = true;
}