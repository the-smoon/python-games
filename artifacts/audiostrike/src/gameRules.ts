export const STAGE_LEVEL_SECONDS = 30;

export const BOSS_TRANSITION_SECONDS = 5;
export const BOSS_ARRIVAL_SECONDS = 5;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function stageProgress(songTime: number) {
  return {
    secondsLeft: Math.ceil(clamp(STAGE_LEVEL_SECONDS - songTime, 0, STAGE_LEVEL_SECONDS)),
    progress: clamp(songTime / STAGE_LEVEL_SECONDS, 0, 1),
    finished: songTime >= STAGE_LEVEL_SECONDS,
  };
}

export function spawnPressure(progress: number, intensity: number, onset: number, high: number, level = 1) {
  const difficulty = Math.min(8, Math.max(0, level - 1));
  return {
    count: Math.min(6, 1 + Math.floor(progress * 1.5 + intensity * 2 + (onset > .55 ? 1 : 0) + difficulty * .32)),
    cooldown: clamp(90 - progress * 22 - intensity * 32 - onset * 12 - high * 7 - difficulty * 3, 23, 90),
  };
}

export type MusicSignal = { rms: number; onset: number; low: number; mid: number; high: number; centroid: number; flatness: number; pulse: boolean };
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
    boss.x = width / 2 + Math.sin(orbit) * Math.min(230 + live.low * 40, width / 2 - boss.radius - 20);
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

export function damageBoss(boss: BossHealth, amount = 1) {
  if (boss.phase === 'DYING') return false;
  boss.health = Math.max(0, boss.health - Math.max(0, amount));
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
  playerBullets: { x: number; y: number; vx?: number; vy: number; alive: boolean }[],
  enemyBullets: { x: number; y: number; vx: number; vy: number; alive: boolean; frozenUntil?: number }[],
  delta: number,
  width: number,
  height: number,
) {
  for (const bullet of playerBullets) {
    bullet.x += (bullet.vx ?? 0) * delta * .22;
    bullet.y += bullet.vy * delta * .22;
    if (bullet.y < -20 || bullet.x < -20 || bullet.x > width + 20) bullet.alive = false;
  }
  for (const bullet of enemyBullets) {
    if (bullet.frozenUntil) continue;
    bullet.x += bullet.vx * delta * .26;
    bullet.y += bullet.vy * delta * .26;
    if (bullet.y > height + 20 || bullet.y < -20 || bullet.x < -20 || bullet.x > width + 20) bullet.alive = false;
  }
}

export function playerShotHitsTarget(bullet: { x: number; y: number; radius?: number }, target: { x: number; y: number; radius: number }) {
  return Math.hypot(bullet.x - target.x, bullet.y - target.y) <= target.radius + (bullet.radius ?? 4);
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

export function attackVectors(pattern: AttackPattern, dx: number, dy: number, phase: number, high: number) {
  const angle = Math.atan2(dy, dx);
  const count = pattern === 'RADIAL' ? 8 : pattern === 'BURST' ? (high > .6 ? 5 : 3) : 1;
  return Array.from({ length: count }, (_, index) => {
    const a = pattern === 'RADIAL' ? phase + index * Math.PI * 2 / count : angle + (index - (count - 1) / 2) * .2;
    return { x: Math.cos(a), y: Math.sin(a) };
  });
}

export function encounterSignature(signal: MusicSignal) {
  const shape = signal.low > signal.high * 1.2 ? 'HEX' : signal.high > signal.mid * 1.18 ? 'TRIANGLE' : signal.flatness < .3 ? 'DIAMOND' : 'RING';
  const motion: MotionStyle = signal.low > signal.high * 1.2 ? 'SWEEP' : signal.high > signal.low * 1.2 ? 'HUNT' : 'ORBIT';
  const attack: AttackPattern = signal.low > signal.high * 1.2 ? 'RADIAL' : signal.high > signal.low * 1.2 ? 'BURST' : 'TRACK';
  const projectile = signal.high > signal.low * 1.2 ? 'SHARD' : signal.low > signal.mid * 1.2 ? 'RING' : signal.mid > .3 ? 'BOLT' : 'ORB';
  return { shape, motion, attack, projectile };
}

export function nextLevel(level: number) { return level + 1; }

export type MotionStyle = 'ORBIT' | 'SWEEP' | 'HUNT';

export function detachSubBoss(parts: number, active: number, level: number) {
  if (parts <= 0 || active >= 4) return null;
  return {
    remaining: parts - 1,
    health: Math.round(30 * (1 + Math.min(8, Math.max(0, level - 1)) * .2)),
  };
}

export function attackInterval(signal: MusicSignal, level = 1, boss = false) {
  return clamp((boss ? 105 : 130) - signal.rms * (boss ? 42 : 29) - signal.onset * 20 - signal.mid * 14 -
    (signal.pulse ? 9 : 0) - Math.min(8, level - 1) * (boss ? 4 : 5), boss ? 26 : 38, boss ? 110 : 150);
}

export type AttackPattern = 'TRACK' | 'BURST' | 'RADIAL';
