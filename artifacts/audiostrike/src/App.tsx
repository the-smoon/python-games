import { useCallback, useEffect, useRef, useState } from 'react';
import { Crosshair, FileAudio, Gamepad2, Headphones, RotateCcw, Shield, Volume2, Zap } from 'lucide-react';
import { advanceBossDeath, advanceProjectiles, bossPhase, configureGameplayAudio, damageBoss, enemyShotHitsPlayer, playerShotHitsTarget, stageProgress as getStageProgress, STAGE_LEVEL_SECONDS, BOSS_ARRIVAL_SECONDS } from './gameRules';
import { getControllerStatus, mapGamepadInput, neutralControllerVector, selectActiveGamepad } from './gamepadControls';
import { audioIntensity, bossHealth, chooseAttack, chooseMotion, generateForm, spawnProfile, type AttackPattern, type FormProfile, type MotionPattern } from './encounterRules';
import { advancePickup, bombDamage, collectPickup, companionPositions, fireWeapon, freezeSplash, laserHitsTarget, newWeaponState, pickDrop, slowScale, tickFrozenBullet, WEAPON_BALANCE, type LaserBeam, type Pickup, type PickupType, type PlayerShot } from './weaponRules';
import WeaponHUD from './WeaponHUD';
import { drawFrozenHalo, drawWeaponEffects } from './weaponVisuals';

type GameState = 'UPLOAD' | 'ANALYZING' | 'COUNTDOWN' | 'PLAYING' | 'BOSS_INTRO' | 'BOSS' | 'GAME_OVER';
type Behavior = 'PATROL' | 'ZIGZAG' | 'FORMATION' | 'SWARM' | 'DIVE' | 'SHOOTER' | 'TANK';
type FeatureSet = {
  duration: number;
};
type LiveFeatures = {
  rms: number;
  onset: number;
  low: number;
  mid: number;
  high: number;
  centroid: number;
  flatness: number;
  pulse: boolean;
  tempo: number;
};
type EnemyShape = 'CIRCLE' | 'DIAMOND' | 'TRIANGLE' | 'HEX' | 'RING';
type ProjectileKind = 'ORB' | 'BOLT' | 'SHARD' | 'RING';
type AudioReactiveTrack = {
  element: HTMLAudioElement;
  analyser: AnalyserNode;
  source: MediaElementAudioSourceNode;
  frequencies: Uint8Array<ArrayBuffer>;
  waveform: Uint8Array<ArrayBuffer>;
  previousSpectrum: Float32Array<ArrayBuffer>;
  energyBaseline: number;
  lastTime: number;
  lastPulseAt: number;
  lastFeatures: LiveFeatures;
};
type EnemyEntity = {
  x: number; y: number; radius: number; health: number; maxHealth: number; speed: number;
  behavior: Behavior; fireRate: number; fireTimer: number; frame: number; zigDir: number;
  formX: number; formY: number; diving: boolean; dvx: number; dvy: number; shape: EnemyShape; projectile: ProjectileKind; exiting: boolean; alive: boolean;
  form: FormProfile; motion: MotionPattern; pattern: AttackPattern; subBoss: boolean; frozenUntil?: number;
};
type BulletEntity = PlayerShot;
type EnemyBulletEntity = { x: number; y: number; vx: number; vy: number; damage: number; alive: boolean; kind?: ProjectileKind; radius: number; spin?: number; frozenUntil?: number };
type ParticleEntity = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string };
type DebrisEntity = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; size: number; angle: number; spin: number };
type BossEntity = { x: number; y: number; radius: number; health: number; maxHealth: number; shape: EnemyShape; projectile: ProjectileKind; pattern: AttackPattern; motion: MotionPattern; form: FormProfile; phase: 'INTRO' | 'PHASE1' | 'PHASE2' | 'PHASE3' | 'DYING'; frame: number; phaseFrame: number; vx: number; fireTimer: number; dyingTimer: number; subBossTimer: number; revision: number; frozenUntil?: number };

const W = 420;
const H = 900;
const PLAYER_MAX_HEALTH = 100;
const ENEMY_MOTION_TIME_SCALE = 0.18;
const PLAYER_MAX_SPEED = 6.875;
const PLAYER_ACCELERATION = .42;
const PLAYER_DECELERATION = .55;
const JOYSTICK_RADIUS = 62;
const PLAYER_W = 20;
const PLAYER_H = 32;
const COLORS: Record<string, string> = {
  PATROL: '#4488ff', ZIGZAG: '#00ccff', FORMATION: '#44ff88', SWARM: '#ffff44',
  DIVE: '#ff8800', SHOOTER: '#ff4444', TANK: '#cc44ff',
};
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const random = (min: number, max: number) => min + Math.random() * (max - min);
const randomInt = (min: number, max: number) => Math.floor(random(min, max + 1));

async function inspectAudio(file: File, progress: (value: number) => void): Promise<FeatureSet> {
  progress(8);
  const url = URL.createObjectURL(file);
  const element = new Audio(url);
  element.preload = 'metadata';
  const duration = await new Promise<number>((resolve) => {
    const finish = () => resolve(Number.isFinite(element.duration) ? element.duration : 42);
    element.addEventListener('loadedmetadata', finish, { once: true });
    window.setTimeout(finish, 1800);
  });
  progress(30);
  URL.revokeObjectURL(url);
  progress(72);
  const features = { duration: clamp(duration || 42, 18, 180) };
  progress(100);
  return features;
}

const blankLiveFeatures = (): LiveFeatures => ({ rms: 0, onset: 0, low: 0, mid: 0, high: 0, centroid: 0, flatness: 0, pulse: false, tempo: 0 });

function createReactiveTrack(context: AudioContext, element: HTMLAudioElement): AudioReactiveTrack {
  const source = context.createMediaElementSource(element);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = .58;
  source.connect(analyser);
  analyser.connect(context.destination);
  return {
    element,
    analyser,
    source,
    frequencies: new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount)),
    waveform: new Uint8Array(new ArrayBuffer(analyser.fftSize)),
    previousSpectrum: new Float32Array(new ArrayBuffer(analyser.frequencyBinCount * Float32Array.BYTES_PER_ELEMENT)),
    energyBaseline: .02,
    lastTime: -1,
    lastPulseAt: -10,
    lastFeatures: blankLiveFeatures(),
  };
}

function resetReactiveTrack(track: AudioReactiveTrack | null) {
  if (!track) return;
  track.previousSpectrum.fill(0);
  track.energyBaseline = .02;
  track.lastTime = -1;
  track.lastPulseAt = -10;
  track.lastFeatures = blankLiveFeatures();
}

function readReactiveTrack(track: AudioReactiveTrack | null): LiveFeatures {
  if (!track) return blankLiveFeatures();
  track.analyser.getByteFrequencyData(track.frequencies);
  track.analyser.getByteTimeDomainData(track.waveform);
  const sampleRate = track.analyser.context.sampleRate;
  const binWidth = sampleRate / track.analyser.fftSize;
  const band = (minHz: number, maxHz: number) => {
    const first = clamp(Math.floor(minHz / binWidth), 0, track.frequencies.length - 1);
    const last = clamp(Math.ceil(maxHz / binWidth), first + 1, track.frequencies.length);
    let total = 0;
    for (let index = first; index < last; index += 1) total += track.frequencies[index] / 255;
    return total / Math.max(1, last - first);
  };
  let waveformEnergy = 0;
  for (const sample of track.waveform) {
    const centered = (sample - 128) / 128;
    waveformEnergy += centered * centered;
  }
  const rms = clamp(Math.sqrt(waveformEnergy / track.waveform.length) * 2.2, 0, 1);
  const low = clamp(band(35, 180) * 1.35, 0, 1);
  const mid = clamp(band(180, 2200) * 1.55, 0, 1);
  const high = clamp(band(2200, Math.min(10000, sampleRate / 2)) * 1.9, 0, 1);
  let flux = 0;
  let weightedFrequency = 0;
  let totalMagnitude = 0;
  let logMagnitude = 0;
  let magnitudeTotal = 0;
  for (let index = 1; index < track.frequencies.length; index += 1) {
    const magnitude = track.frequencies[index] / 255;
    flux += Math.max(0, magnitude - track.previousSpectrum[index]);
    const frequency = index * binWidth;
    weightedFrequency += frequency * magnitude;
    totalMagnitude += magnitude;
    if (magnitude > .001) {
      logMagnitude += Math.log(magnitude);
      magnitudeTotal += 1;
    }
    track.previousSpectrum[index] = magnitude;
  }
  const centroid = clamp(totalMagnitude ? weightedFrequency / totalMagnitude / (sampleRate / 2) : 0, 0, 1);
  const flatness = clamp(magnitudeTotal ? Math.exp(logMagnitude / magnitudeTotal) / Math.max(.001, totalMagnitude / Math.max(1, track.frequencies.length - 1)) : 0, 0, 1);
  const normalizedFlux = clamp(flux / Math.max(1, track.frequencies.length - 1) * 8, 0, 1);
  const onset = clamp((normalizedFlux - track.energyBaseline) * 7 + normalizedFlux * .28, 0, 1);
  track.energyBaseline = track.energyBaseline * .94 + normalizedFlux * .06;
  const now = track.element.currentTime;
  if (now < track.lastTime) track.lastPulseAt = -10;
  const pulse = track.lastTime >= 0 && onset > .38 && now - track.lastPulseAt > .2;
  let tempo = track.lastFeatures.tempo * .995;
  if (pulse && track.lastPulseAt >= 0) {
    const interval = now - track.lastPulseAt;
    if (interval >= .2 && interval <= 2) tempo = tempo * .68 + clamp(60 / interval, 0, 180) * .32;
  }
  if (pulse) track.lastPulseAt = now;
  track.lastTime = now;
  track.lastFeatures = { rms, onset, low, mid, high, centroid, flatness, pulse, tempo };
  return track.lastFeatures;
}

function chooseBehavior(features: LiveFeatures): Behavior {
  if (features.onset > .78 && features.high > .42) return 'DIVE';
  if (features.onset > .58) return 'SWARM';
  if (features.low > .62) return 'TANK';
  if (features.mid > .52 && features.rms > .3) return 'SHOOTER';
  if (features.centroid > .56) return 'ZIGZAG';
  if (features.rms > .28 && features.flatness < .38) return 'FORMATION';
  return 'PATROL';
}

function chooseEnemyShape(features: LiveFeatures, serial: number): EnemyShape {
  const shapes: EnemyShape[] = ['CIRCLE', 'DIAMOND', 'TRIANGLE', 'HEX', 'RING'];
  return shapes[(serial + Math.floor(features.centroid * 5 + features.low * 3)) % shapes.length];
}

function chooseProjectile(features: LiveFeatures, behavior: Behavior | 'BOSS'): ProjectileKind {
  if (features.high > .68 && features.centroid > .5) return 'SHARD';
  if (features.low > .68 && (behavior === 'TANK' || behavior === 'BOSS')) return 'RING';
  if (features.mid > .5) return 'BOLT';
  return 'ORB';
}

function chooseBossShape(features: LiveFeatures): EnemyShape {
  if (features.low > .65) return 'HEX';
  if (features.high > .62) return 'TRIANGLE';
  if (features.flatness < .3) return 'DIAMOND';
  return 'RING';
}

function createEnemyProjectile(x: number, y: number, vx: number, vy: number, damage: number, kind: ProjectileKind): EnemyBulletEntity {
  const speedScale: Record<ProjectileKind, number> = { ORB: 1, BOLT: 1.12, SHARD: 1.28, RING: .78 };
  const radius: Record<ProjectileKind, number> = { ORB: 4, BOLT: 3, SHARD: 4, RING: 6 };
  return { x, y, vx: vx * speedScale[kind], vy: vy * speedScale[kind], damage, alive: true, kind, radius: radius[kind], spin: Math.atan2(vy, vx) };
}

function firePattern(
  bullets: EnemyBulletEntity[], x: number, y: number, player: { x: number; y: number },
  pattern: AttackPattern, kind: ProjectileKind, speed: number, damage: number, serial: number,
) {
  if (bullets.length >= 260) return;
  const aim = Math.atan2(player.y - y, player.x - x);
  const shot = (angle: number, speedScale = 1) => {
    if (bullets.length < 260) bullets.push(createEnemyProjectile(x, y, Math.cos(angle) * speed * speedScale, Math.sin(angle) * speed * speedScale, damage, kind));
  };
  if (pattern === 'TRACK') shot(aim);
  else if (pattern === 'BURST') for (let i = -2; i <= 2; i += 1) shot(aim + i * .15);
  else if (pattern === 'RADIAL') for (let i = 0; i < 10; i += 1) shot(i * Math.PI / 5 + serial * .08, .8);
  else if (pattern === 'SPIRAL') for (let i = 0; i < 4; i += 1) shot(aim + i * Math.PI / 2 + serial * .13, .9);
  else for (let i = -2; i <= 2; i += 1) shot(Math.PI / 2 + i * .24 + Math.sin(serial * .15) * .12);
}

function moveDynamicBoss(boss: BossEntity, player: { x: number; y: number }, live: LiveFeatures, delta: number) {
  const energy = audioIntensity(live);
  const speed = 1 + energy * 1.6 + live.tempo / 240;
  const time = boss.phaseFrame * .015 * speed;
  if (boss.motion === 'ORBIT') {
    const targetX = W / 2 + Math.sin(time) * (W / 2 - boss.radius - 24);
    const targetY = 142 + Math.cos(time * 1.3) * (22 + live.mid * 30);
    boss.x += (targetX - boss.x) * Math.min(.08 * delta, .2);
    boss.y += (targetY - boss.y) * Math.min(.08 * delta, .2);
  } else if (boss.motion === 'SWEEP') {
    boss.x += boss.vx * (3 + speed * 2.5) * delta;
    boss.y = 135 + Math.sin(time * .8) * 38;
    if (boss.x < boss.radius + 18 || boss.x > W - boss.radius - 18) boss.vx *= -1;
  } else if (boss.motion === 'CHASE') {
    boss.x += (player.x - boss.x) * (.008 + energy * .018) * delta;
    boss.y += (clamp(player.y - 280, 110, 225) - boss.y) * .02 * delta;
  } else if (boss.motion === 'DASH') {
    boss.x += (player.x - boss.x) * (.009 + (Math.sin(time * 2) > .72 ? .1 : 0)) * delta;
    boss.y = 142 + Math.sin(time) * 40;
  } else {
    boss.x += boss.vx * (3 + speed * 1.8) * delta;
    boss.y = 138 + Math.sin(time * 2.3) * 55;
    if (boss.x < boss.radius + 18 || boss.x > W - boss.radius - 18) boss.vx *= -1;
  }
  boss.x = clamp(boss.x, boss.radius + 15, W - boss.radius - 15);
  boss.y = clamp(boss.y, boss.radius + 20, 245);
}

function shapePath(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, shape: EnemyShape) {
  ctx.beginPath();
  if (shape === 'DIAMOND') {
    ctx.moveTo(x, y - radius); ctx.lineTo(x + radius, y); ctx.lineTo(x, y + radius); ctx.lineTo(x - radius, y);
  } else if (shape === 'TRIANGLE') {
    ctx.moveTo(x, y - radius); ctx.lineTo(x + radius * .92, y + radius * .72); ctx.lineTo(x - radius * .92, y + radius * .72);
  } else if (shape === 'HEX') {
    for (let side = 0; side < 6; side += 1) {
      const angle = side / 6 * Math.PI * 2 - Math.PI / 2;
      const pointX = x + Math.cos(angle) * radius;
      const pointY = y + Math.sin(angle) * radius;
      if (side === 0) ctx.moveTo(pointX, pointY); else ctx.lineTo(pointX, pointY);
    }
  } else {
    ctx.arc(x, y, radius, 0, Math.PI * 2);
  }
  ctx.closePath();
}

function drawGeneratedForm(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, form: FormProfile, color: string, frame: number) {
  const points = Math.max(24, form.sides * 4);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(form.rotation + Math.sin(frame * .013) * .08);
  ctx.fillStyle = color;
  ctx.strokeStyle = '#d6fff9';
  ctx.lineWidth = Math.max(1.5, radius * .045);
  ctx.beginPath();
  for (let point = 0; point <= points; point += 1) {
    const angle = point / points * Math.PI * 2;
    const faceted = Math.cos(angle * form.sides) * .065;
    const lobed = Math.sin(angle * form.lobes) * .09;
    const spike = form.spikes ? Math.pow(Math.max(0, Math.cos(angle * form.spikes)), 8) * .18 : 0;
    const r = radius * (0.8 + faceted + lobed + spike);
    if (point === 0) ctx.moveTo(Math.cos(angle) * r, Math.sin(angle) * r);
    else ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#0b1930';
  ctx.beginPath();
  ctx.arc(0, 0, radius * form.innerRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, radius * .08);
  ctx.stroke();
  ctx.restore();
}

function drawEnemyDamage(ctx: CanvasRenderingContext2D, enemy: EnemyEntity) {
  if (enemy.health >= enemy.maxHealth || enemy.health <= 0) return;
  const damage = 1 - enemy.health / enemy.maxHealth;
  ctx.save();
  shapePath(ctx, enemy.x, enemy.y, enemy.radius, enemy.shape);
  ctx.clip();
  ctx.lineWidth = Math.max(1.5, enemy.radius * .075);
  ctx.strokeStyle = 'rgba(8, 14, 27, .88)';
  const cracks = Math.max(1, Math.ceil(damage * 4));
  for (let i = 0; i < cracks; i += 1) {
    const angle = i * 2.4 + enemy.formX * .017;
    const r = enemy.radius;
    ctx.beginPath();
    ctx.moveTo(enemy.x + Math.cos(angle) * r * .12, enemy.y + Math.sin(angle) * r * .12);
    ctx.lineTo(enemy.x + Math.cos(angle + .2) * r * .48, enemy.y + Math.sin(angle + .2) * r * .48);
    ctx.lineTo(enemy.x + Math.cos(angle - .12) * r * .85, enemy.y + Math.sin(angle - .12) * r * .85);
    ctx.stroke();
  }
  ctx.fillStyle = `rgba(12, 17, 31, ${damage * .68})`;
  ctx.fillRect(enemy.x - enemy.radius * .5, enemy.y + enemy.radius * .18, enemy.radius * .9, enemy.radius * .16);
  ctx.restore();
}

function drawEnemyProjectile(ctx: CanvasRenderingContext2D, bullet: EnemyBulletEntity) {
  const kind = bullet.kind ?? 'ORB';
  const radius = bullet.radius ?? 4;
  const color = kind === 'SHARD' ? '#ffcc33' : kind === 'BOLT' ? '#ff5577' : kind === 'RING' ? '#ff8844' : '#ff3333';
  ctx.save();
  ctx.translate(bullet.x, bullet.y);
  ctx.rotate((bullet.spin ?? 0) + (bullet.frozenUntil ? 0 : performance.now() * .002));
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  if (kind === 'BOLT') {
    ctx.fillRect(-radius * .6, -radius * 1.8, radius * 1.2, radius * 3.6);
  } else if (kind === 'SHARD') {
    ctx.beginPath();
    ctx.moveTo(0, -radius * 1.5); ctx.lineTo(radius, 0); ctx.lineTo(0, radius * 1.5); ctx.lineTo(-radius, 0);
    ctx.closePath(); ctx.fill();
  } else if (kind === 'RING') {
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, radius * .32, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function spawnParticles(list: ParticleEntity[], x: number, y: number, color: string, count: number, speedMin = 2, speedMax = 8) {
  for (let index = 0; index < count; index += 1) {
    const angle = random(0, Math.PI * 2);
    const speed = random(speedMin, speedMax);
    const life = randomInt(18, 52);
    list.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life, maxLife: life, color });
  }
  if (list.length > 280) list.splice(0, list.length - 280);
}

function spawnImpactDust(list: ParticleEntity[], x: number, y: number, color: string) {
  for (let i = 0; i < 11; i += 1) {
    const angle = random(0, Math.PI * 2);
    const speed = random(25, 70);
    const life = randomInt(10, 20);
    list.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life, maxLife: life, color: i % 3 === 0 ? '#eafff9' : color });
  }
  if (list.length > 280) list.splice(0, list.length - 280);
}

function spawnDeathDebris(list: DebrisEntity[], x: number, y: number, radius: number, color: string) {
  const count = Math.min(18, Math.max(8, Math.round(radius * .42)));
  for (let i = 0; i < count; i += 1) {
    const angle = i * Math.PI * 2 / count + random(-.2, .2);
    const speed = random(2.5, 7);
    const life = randomInt(16, 30);
    list.push({ x: x + Math.cos(angle) * radius * .27, y: y + Math.sin(angle) * radius * .27,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life, maxLife: life,
      color, size: random(2, Math.max(4, radius * .22)), angle: random(0, Math.PI * 2), spin: random(-.2, .2) });
  }
  if (list.length > 120) list.splice(0, list.length - 120);
}

function drawPlayer(ctx: CanvasRenderingContext2D, x: number, y: number, frame: number, visible: boolean, health: number) {
  if (!visible) return;
  const halfW = PLAYER_W / 2;
  const halfH = PLAYER_H / 2;
  ctx.fillStyle = '#00ff88';
  ctx.beginPath();
  ctx.roundRect(x - halfW, y - halfH, PLAYER_W, PLAYER_H, 4);
  ctx.fill();
  ctx.fillStyle = '#00ffff';
  ctx.beginPath();
  ctx.roundRect(x - 5, y - halfH + 5, 10, 13, 2);
  ctx.fill();
  ctx.fillStyle = '#00cc66';
  ctx.beginPath();
  ctx.moveTo(x - halfW, y + 4); ctx.lineTo(x - halfW - 12, y + 20); ctx.lineTo(x - halfW, y + 20); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x + halfW, y + 4); ctx.lineTo(x + halfW + 12, y + 20); ctx.lineTo(x + halfW, y + 20); ctx.fill();
  // Wing-mounted weapon pods
  ctx.fillStyle = '#7dffcf';
  ctx.fillRect(x - halfW - 4, y - 8, 6, 12);
  ctx.fillRect(x + halfW - 2, y - 8, 6, 12);
  ctx.fillStyle = '#00ffff';
  ctx.fillRect(x - halfW - 3, y - 9, 4, 5);
  ctx.fillRect(x + halfW - 1, y - 9, 4, 5);
  const exhaust = 10 + Math.floor((frame % 14) * .8);
  ctx.fillStyle = '#ff8800';
  ctx.beginPath(); ctx.roundRect(x - 5, y + halfH, 10, exhaust, 3); ctx.fill();
  ctx.fillStyle = '#ffff00';
  ctx.beginPath(); ctx.roundRect(x - 3, y + halfH, 6, Math.floor(exhaust / 2), 3); ctx.fill();
  const damage = 1 - health / PLAYER_MAX_HEALTH;
  if (damage > .2) {
    ctx.save();
    ctx.strokeStyle = '#102f30';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - 8, y - 10); ctx.lineTo(x - 3, y - 4); ctx.lineTo(x - 7, y + 2); ctx.stroke();
    ctx.fillStyle = '#164e4e'; ctx.fillRect(x - 18, y + 13, 7, 4);
    if (damage > .45) {
      ctx.strokeStyle = '#10433d';
      ctx.beginPath(); ctx.moveTo(x + 8, y + 1); ctx.lineTo(x + 3, y + 8); ctx.lineTo(x + 9, y + 13); ctx.stroke();
      ctx.fillStyle = '#ff9a38'; ctx.fillRect(x + 12, y + 15, 4, 3);
    }
    if (damage > .7) {
      ctx.fillStyle = '#3c2b2c'; ctx.fillRect(x - 8, y + 7, 8, 5);
      ctx.fillStyle = '#ff6849';
      if (frame % 16 < 9) ctx.fillRect(x - 7, y + 6, 3, 3);
      ctx.strokeStyle = '#153332';
      ctx.beginPath(); ctx.moveTo(x + 3, y - 12); ctx.lineTo(x - 1, y - 6); ctx.lineTo(x + 3, y); ctx.stroke();
    }
    ctx.restore();
  }
}

type Joystick = { pointerId: number | null; x: number; y: number; dx: number; dy: number };
const neutralJoystick = (): Joystick => ({ pointerId: null, x: 0, y: 0, dx: 0, dy: 0 });

function drawJoystick(ctx: CanvasRenderingContext2D, joystick: Joystick) {
  if (joystick.pointerId === null) return;
  const { x, y, dx, dy } = joystick;
  ctx.save();
  ctx.fillStyle = 'rgba(0, 229, 255, .12)';
  ctx.strokeStyle = 'rgba(125, 255, 207, .65)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(x, y, JOYSTICK_RADIUS, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = 'rgba(0, 229, 255, .4)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx * JOYSTICK_RADIUS, y + dy * JOYSTICK_RADIUS); ctx.stroke();
  ctx.fillStyle = 'rgba(0, 229, 255, .52)';
  ctx.strokeStyle = 'rgba(205, 255, 245, .95)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(x + dx * JOYSTICK_RADIUS, y + dy * JOYSTICK_RADIUS, 18, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.restore();
}

function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageInputRef = useRef<HTMLInputElement>(null);
  const bossInputRef = useRef<HTMLInputElement>(null);
  const stageAudioRef = useRef<HTMLAudioElement | null>(null);
  const bossAudioRef = useRef<HTMLAudioElement | null>(null);
  const joystickRef = useRef<Joystick>(neutralJoystick());
  const starsRef = useRef<{ x: number; y: number; size: number; brightness: number; speed: number }[]>([]);
  const gameRef = useRef({ state: 'UPLOAD' as GameState, level: 1, stageFeatures: null as FeatureSet | null, bossFeatures: null as FeatureSet | null, audioContext: null as AudioContext | null, stageReactive: null as AudioReactiveTrack | null, bossReactive: null as AudioReactiveTrack | null, player: { x: W / 2, y: H / 2, vx: 0, vy: 0, health: PLAYER_MAX_HEALTH, invincible: 0, fireTimer: 0, frame: 0 }, enemies: [] as EnemyEntity[], bullets: [] as BulletEntity[], enemyBullets: [] as EnemyBulletEntity[], particles: [] as ParticleEntity[], debris: [] as DebrisEntity[], boss: null as BossEntity | null, score: 0, frame: 0, songStart: 0, bossStart: 0, beatIndex: 0, spawnIndex: 0, spawnCooldown: 0, stageDone: false, bossArrivalAt: 0, introTimer: 0, countdown: 3, countdownTimer: 0, currentBehavior: '' });
  const arsenalRef = useRef({
    weapon: newWeaponState(), drops: [] as Pickup[], beam: null as LaserBeam | null,
    splashes: [] as { x: number; y: number; until: number }[],
    bombUntil: 0, message: '', messageUntil: 0, dropMisses: 0,
  });
  const [combatHud, setCombatHud] = useState({ weapon: newWeaponState(), now: 0, message: '', messageUntil: 0 });
  const [state, setState] = useState<GameState>('UPLOAD');
  const [stageFile, setStageFile] = useState<File | null>(null);
  const [bossFile, setBossFile] = useState<File | null>(null);
  const [stageProgress, setStageProgress] = useState(0);
  const [bossProgress, setBossProgress] = useState(0);
  const [analysisMessage, setAnalysisMessage] = useState('Waiting for stage track');
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [hud, setHud] = useState({ level: 1, score: 0, health: PLAYER_MAX_HEALTH, behavior: 'SCANNING', phase: '', bossHealth: 0, bossMaxHealth: 1, stageSecondsLeft: STAGE_LEVEL_SECONDS });
  const [audioError, setAudioError] = useState('');
  const [controllerStatus, setControllerStatus] = useState('Checking for controller…');
  const controllerStatusRef = useRef('Checking for controller…');

  const syncState = useCallback((next: GameState) => {
    gameRef.current.state = next;
    setState(next);
  }, []);

  const resetAudio = useCallback(() => {
    stageAudioRef.current?.pause();
    bossAudioRef.current?.pause();
    gameRef.current.stageReactive?.source.disconnect();
    gameRef.current.bossReactive?.source.disconnect();
    gameRef.current.stageReactive?.analyser.disconnect();
    gameRef.current.bossReactive?.analyser.disconnect();
    if (gameRef.current.audioContext) void gameRef.current.audioContext.close();
    if (stageAudioRef.current) URL.revokeObjectURL(stageAudioRef.current.src);
    if (bossAudioRef.current) URL.revokeObjectURL(bossAudioRef.current.src);
    stageAudioRef.current = null;
    bossAudioRef.current = null;
    gameRef.current.audioContext = null;
    gameRef.current.stageReactive = null;
    gameRef.current.bossReactive = null;
  }, []);

  const playTrack = useCallback((element: HTMLAudioElement, name: string) => {
    void element.play().then(() => {
      setAudioError(gameRef.current.audioContext?.state === 'suspended'
        ? 'Sound is blocked by the browser. Tap Retry audio.' : '');
    }).catch(() => {
      setAudioError(`${name} could not play. Tap Retry audio to enable sound.`);
    });
  }, []);
  const resumeAudio = useCallback(() => {
    void gameRef.current.audioContext?.resume().catch(() => {
      setAudioError('Sound is blocked by the browser. Tap Retry audio.');
    });
  }, []);

  const startAnalysis = useCallback(async () => {
    if (!stageFile || !bossFile) return;
    syncState('ANALYZING');
    setAnalysisProgress(2);
    setAnalysisMessage('Reading stage metadata');
    try {
      const stageFeatures = await inspectAudio(stageFile, (value) => {
        setStageProgress(value);
        setAnalysisProgress(Math.round(value * .43));
        setAnalysisMessage(value < 35 ? 'Reading stage metadata' : value < 75 ? 'Mapping stage energy' : 'Building enemy patterns');
      });
      setAnalysisMessage('Reading boss metadata');
      const bossFeatures = await inspectAudio(bossFile, (value) => {
        setBossProgress(value);
        setAnalysisProgress(43 + Math.round(value * .57));
        setAnalysisMessage(value < 35 ? 'Reading boss metadata' : value < 75 ? 'Mapping boss energy' : 'Tuning phase patterns');
      });
      const game = gameRef.current;
      game.stageFeatures = stageFeatures;
      game.bossFeatures = bossFeatures;
      resetAudio();
      const AudioContextConstructor = window.AudioContext;
      if (!AudioContextConstructor) throw new Error('Web Audio is not supported');
      const audioContext = new AudioContextConstructor();
      stageAudioRef.current = new Audio(URL.createObjectURL(stageFile));
      bossAudioRef.current = new Audio(URL.createObjectURL(bossFile));
      stageAudioRef.current.preload = 'auto';
      bossAudioRef.current.preload = 'auto';
      configureGameplayAudio(stageAudioRef.current, bossAudioRef.current);
      stageAudioRef.current.volume = .72;
      bossAudioRef.current.volume = .72;
      game.audioContext = audioContext;
      game.stageReactive = createReactiveTrack(audioContext, stageAudioRef.current);
      game.bossReactive = createReactiveTrack(audioContext, bossAudioRef.current);
      await audioContext.resume();
      beginCountdown();
    } catch {
      setAnalysisMessage('Live audio scan unavailable — using safe fallback');
      const game = gameRef.current;
      game.stageFeatures = { duration: 42 };
      game.bossFeatures = { duration: 28 };
      resetAudio();
      stageAudioRef.current = new Audio(URL.createObjectURL(stageFile));
      bossAudioRef.current = new Audio(URL.createObjectURL(bossFile));
      configureGameplayAudio(stageAudioRef.current, bossAudioRef.current);
      beginCountdown();
    }
  }, [bossFile, resetAudio, stageFile, syncState]);

  const beginCountdown = useCallback(() => {
    const game = gameRef.current;
    game.level = 1;
    arsenalRef.current = { weapon: newWeaponState(), drops: [], beam: null, splashes: [],
      bombUntil: 0, message: '', messageUntil: 0, dropMisses: 0 };
    setCombatHud({ weapon: newWeaponState(), now: 0, message: '', messageUntil: 0 });
    game.player = { x: W / 2, y: H / 2, vx: 0, vy: 0, health: PLAYER_MAX_HEALTH, invincible: 0, fireTimer: 0, frame: 0 };
    game.enemies = []; game.bullets = []; game.enemyBullets = []; game.particles = []; game.debris = []; game.boss = null;
      game.score = 0; game.frame = 0; game.beatIndex = 0; game.spawnIndex = 0; game.spawnCooldown = 0; game.stageDone = false; game.bossArrivalAt = 0; game.introTimer = 0;
    resetReactiveTrack(game.stageReactive);
    resetReactiveTrack(game.bossReactive);
    game.countdown = 3; game.countdownTimer = 58; game.currentBehavior = 'SCANNING';
    joystickRef.current = neutralJoystick();
    setCountdown(3);
    setHud({ level: 1, score: 0, health: PLAYER_MAX_HEALTH, behavior: 'SCANNING', phase: '', bossHealth: 0, bossMaxHealth: 1, stageSecondsLeft: STAGE_LEVEL_SECONDS });
    setAudioError('');
    bossAudioRef.current?.pause();
    if (stageAudioRef.current) {
      stageAudioRef.current.pause();
      stageAudioRef.current.currentTime = 0;
      stageAudioRef.current.volume = 0;
      // Start from the replay button's user gesture, then seek back at the end of the countdown.
      resumeAudio();
      playTrack(stageAudioRef.current, 'Stage track');
    }
    syncState('COUNTDOWN');
  }, [playTrack, resumeAudio, syncState]);

  useEffect(() => {
    const stageInput = stageInputRef.current;
    const bossInput = bossInputRef.current;
    if (!stageInput || !bossInput) return;
    const onStage = () => setStageFile(stageInput.files?.[0] ?? null);
    const onBoss = () => setBossFile(bossInput.files?.[0] ?? null);
    stageInput.addEventListener('change', onStage);
    bossInput.addEventListener('change', onBoss);
    return () => { stageInput.removeEventListener('change', onStage); bossInput.removeEventListener('change', onBoss); };
  }, []);

  useEffect(() => {
    const updateControllerStatus = () => {
      const apiAvailable = typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function';
      let gamepad: ReturnType<typeof selectActiveGamepad> = null;
      if (apiAvailable) {
        try {
          gamepad = selectActiveGamepad(Array.from(navigator.getGamepads()));
        } catch {
          gamepad = null;
        }
      }
      const nextStatus = getControllerStatus(gamepad, apiAvailable);
      if (nextStatus !== controllerStatusRef.current) {
        controllerStatusRef.current = nextStatus;
        setControllerStatus(nextStatus);
      }
    };
    window.addEventListener('gamepadconnected', updateControllerStatus);
    window.addEventListener('gamepaddisconnected', updateControllerStatus);
    const poll = window.setInterval(updateControllerStatus, 350);
    updateControllerStatus();
    return () => {
      window.clearInterval(poll);
      window.removeEventListener('gamepadconnected', updateControllerStatus);
      window.removeEventListener('gamepaddisconnected', updateControllerStatus);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = W; canvas.height = H;
      if (!starsRef.current.length) starsRef.current = Array.from({ length: 180 }, (_, index) => ({ x: random(0, W), y: random(0, H), size: 1, brightness: random(.28, .9), speed: .55 + (index % 4) * .22 }));
      const stars = starsRef.current;
    let raf = 0;
    let last = performance.now();
    const getGameTime = () => {
      const game = gameRef.current;
      const audio = game.state === 'BOSS' ? bossAudioRef.current : stageAudioRef.current;
      if (game.state === 'BOSS' && audio && Number.isFinite(audio.currentTime) && audio.currentTime > 0) return audio.currentTime;
      return game.state === 'BOSS' ? (performance.now() - game.bossStart) / 1000 : (performance.now() - game.songStart) / 1000;
    };
    const enemyHitsPlayer = (enemy: EnemyEntity, player: { x: number; y: number }) => {
      const nx = clamp(enemy.x, player.x - PLAYER_W / 2, player.x + PLAYER_W / 2);
      const ny = clamp(enemy.y, player.y - PLAYER_H / 2, player.y + PLAYER_H / 2);
      return (enemy.x - nx) ** 2 + (enemy.y - ny) ** 2 <= enemy.radius ** 2;
    };
    const beginPlaying = () => {
      const game = gameRef.current;
      syncState('PLAYING');
      resetReactiveTrack(game.stageReactive);
      if (stageAudioRef.current) {
        stageAudioRef.current.currentTime = 0;
        stageAudioRef.current.volume = .72;
        resumeAudio();
        playTrack(stageAudioRef.current, 'Stage track');
      }
      game.songStart = performance.now();
    };
    const beginBossIntro = () => {
      const game = gameRef.current;
      game.state = 'BOSS_INTRO'; game.bossArrivalAt = performance.now() + BOSS_ARRIVAL_SECONDS * 1000; game.introTimer = BOSS_ARRIVAL_SECONDS * 60; game.enemyBullets = [];
      for (const enemy of game.enemies) { enemy.exiting = true; enemy.fireRate = 0; }
      setAudioError('');
      if (bossAudioRef.current) {
        bossAudioRef.current.currentTime = 0;
        bossAudioRef.current.volume = 0;
        resumeAudio();
        playTrack(bossAudioRef.current, 'Boss track');
      }
      syncState('BOSS_INTRO');
    };
    const beginBoss = () => {
      const game = gameRef.current;
      const features = game.bossFeatures ?? { duration: 28 };
      const live = readReactiveTrack(game.bossReactive);
      const hp = bossHealth(features.duration, game.level);
      game.player.y = clamp(game.player.y, 90, H - 150);
      game.boss = { x: W / 2, y: -35, radius: 55, health: hp, maxHealth: hp, shape: chooseBossShape(live), projectile: chooseProjectile(live, 'BOSS'), pattern: chooseAttack(live, game.level), motion: chooseMotion(live, game.level), form: generateForm(live, game.level * 37), phase: 'INTRO', frame: 0, phaseFrame: 0, vx: 1, fireTimer: 0, dyingTimer: 0, subBossTimer: 0, revision: 0 };
      game.enemies = []; game.bullets = []; game.enemyBullets = []; game.beatIndex = 0;
      game.state = 'BOSS'; game.bossStart = performance.now();
      stageAudioRef.current?.pause();
      if (bossAudioRef.current) bossAudioRef.current.volume = .72;
      resumeAudio();
      syncState('BOSS');
    };
    const spawnSubBoss = (live: LiveFeatures) => {
      const game = gameRef.current;
      const boss = game.boss;
      if (!boss || game.enemies.filter((enemy) => enemy.subBoss && enemy.alive).length >= 3) return;
      const serial = game.spawnIndex++ + game.level * 29;
      const radius = 22 + live.low * 8;
      const x = clamp(boss.x + (serial % 2 ? 1 : -1) * (boss.radius + 16), radius, W - radius);
      const health = Math.round(clamp(12 + game.level * 3 + live.low * 8, 12, 65));
      game.enemies.push({
        x, y: boss.y, radius, health, maxHealth: health, speed: 3.5 + audioIntensity(live) * 4 + Math.min(3, game.level * .35),
        behavior: 'SHOOTER', fireRate: clamp(85 - audioIntensity(live) * 40 - game.level * 2, 24, 90),
        fireTimer: 38, frame: 0, zigDir: serial % 2 ? 1 : -1, formX: x, formY: boss.y,
        diving: false, dvx: 0, dvy: 0, shape: chooseEnemyShape(live, serial),
        projectile: chooseProjectile(live, 'BOSS'), form: generateForm(live, serial, 1.1),
        motion: chooseMotion(live, serial), pattern: chooseAttack(live, serial),
        subBoss: true, exiting: false, alive: true,
      });
    };
    const clearHostilesOnBossDeath = () => {
      const game = gameRef.current;
      for (const enemy of game.enemies) {
        if (enemy.subBoss) spawnParticles(game.particles, enemy.x, enemy.y, '#ffb347', 10, 2, 7);
      }
      game.enemies = [];
      game.enemyBullets = [];
      game.bullets = [];
      arsenalRef.current.beam = null;
      arsenalRef.current.weapon.chargeStartedAt = null;
    };
    const addDrop = (type: PickupType, x: number, y: number) => {
      const arsenal = arsenalRef.current;
      if (arsenal.drops.length >= WEAPON_BALANCE.maxDrops) return;
      arsenal.drops.push({ type, x: clamp(x, 22, W - 22), y: clamp(y, 80, H - 130),
        expiresAt: performance.now() / 1000 + WEAPON_BALANCE.dropSeconds, alive: true });
    };
    const killEnemy = (enemy: EnemyEntity, allowDrop = true) => {
      if (!enemy.alive) return;
      const game = gameRef.current;
      enemy.alive = false;
      game.score += 100 + enemy.maxHealth * 20;
      spawnDeathDebris(game.debris, enemy.x, enemy.y, enemy.radius, COLORS[enemy.behavior]);
      if (allowDrop && !enemy.exiting) {
        const arsenal = arsenalRef.current;
        arsenal.dropMisses += 1;
        if (Math.random() < (enemy.subBoss ? WEAPON_BALANCE.subBossDropChance : WEAPON_BALANCE.dropChance) ||
          arsenal.dropMisses >= WEAPON_BALANCE.dropPity) {
          addDrop(pickDrop(Math.random()), enemy.x, enemy.y);
          arsenal.dropMisses = 0;
        }
      }
    };
    const hitBoss = (amount: number) => {
      const game = gameRef.current;
      const boss = game.boss;
      if (game.state !== 'BOSS' || !boss || boss.phase === 'DYING') return;
      if (damageBoss(boss, amount)) game.score += 40;
      if (boss.health === 0) {
        addDrop(pickDrop(Math.random() * .54), boss.x, boss.y);
        clearHostilesOnBossDeath();
      }
    };
    const splash = (x: number, y: number) => {
      const game = gameRef.current;
      const now = performance.now() / 1000;
      const targets = game.boss && game.boss.phase !== 'DYING' ? [...game.enemies, game.boss] : game.enemies;
      freezeSplash(x, y, targets, game.enemyBullets, now);
      const splashes = arsenalRef.current.splashes;
      if (splashes.length < 24) splashes.push({ x, y, until: now + .4 });
    };
    const triggerBomb = () => {
      const game = gameRef.current;
      if (game.state === 'GAME_OVER' || game.boss?.phase === 'DYING') return;
      for (const shot of game.enemyBullets) spawnParticles(game.particles, shot.x, shot.y, '#ffb2cc', 2);
      game.enemyBullets = [];
      for (const enemy of game.enemies) {
        if (!enemy.alive || enemy.y + enemy.radius < 0 || enemy.y - enemy.radius > H) continue;
        enemy.health = Math.max(0, enemy.health - bombDamage(enemy));
        // Bomb kills score normally, but never generate another pickup chain.
        if (enemy.health === 0) killEnemy(enemy, false);
      }
      hitBoss(WEAPON_BALANCE.bombBossDamage);
      arsenalRef.current.bombUntil = performance.now() / 1000 + .45;
    };
    const receivePickup = (type: PickupType) => {
      const game = gameRef.current;
      if (game.state === 'GAME_OVER' || game.boss?.phase === 'DYING') return;
      const arsenal = arsenalRef.current;
      const now = performance.now() / 1000;
      const result = collectPickup(arsenal.weapon, type, game.player.health, now);
      game.player.health = result.health;
      arsenal.beam = null;
      arsenal.message = result.message; arsenal.messageUntil = now + 2.5;
      spawnParticles(game.particles, game.player.x, game.player.y, '#c5fff2', 10, 2, 7);
      if (result.bomb) triggerBomb();
    };
    const beginNextLevel = () => {
      const game = gameRef.current;
      game.level += 1;
      game.stageDone = false;
      game.spawnCooldown = 0;
      game.enemies = []; game.enemyBullets = []; game.bullets = []; game.boss = null;
      arsenalRef.current.beam = null;
      arsenalRef.current.weapon.chargeStartedAt = null;
      game.player.vx = 0; game.player.vy = 0;
      joystickRef.current = neutralJoystick();
      bossAudioRef.current?.pause();
      resetReactiveTrack(game.stageReactive);
      if (stageAudioRef.current) {
        stageAudioRef.current.currentTime = 0;
        stageAudioRef.current.volume = .72;
        resumeAudio();
        playTrack(stageAudioRef.current, 'Stage track');
      }
      game.songStart = performance.now();
      syncState('PLAYING');
      setHud((previous) => ({ ...previous, level: game.level, stageSecondsLeft: STAGE_LEVEL_SECONDS, phase: '' }));
    };
    const gameOver = () => {
      joystickRef.current = neutralJoystick();
      arsenalRef.current.beam = null;
      arsenalRef.current.weapon.chargeStartedAt = null;
      gameRef.current.bullets = [];
      stageAudioRef.current?.pause(); bossAudioRef.current?.pause();
      syncState('GAME_OVER');
    };
    const canAttack = () => gameRef.current.state !== 'GAME_OVER' && gameRef.current.boss?.phase !== 'DYING';
    const update = (delta: number) => {
      const game = gameRef.current;
      game.frame += 1;
       for (const star of stars) { star.y += star.speed * delta * .35; if (star.y > H) { star.y = 0; star.x = random(0, W); } }
      for (const particle of game.particles) { particle.x += particle.vx * delta * .06; particle.y += particle.vy * delta * .06; particle.vy += .07 * delta; particle.life -= delta; }
      game.particles = game.particles.filter((particle) => particle.life > 0);
      for (const chunk of game.debris) { chunk.x += chunk.vx * delta; chunk.y += chunk.vy * delta; chunk.vy += .045 * delta; chunk.angle += chunk.spin * delta; chunk.life -= delta; }
      game.debris = game.debris.filter((chunk) => chunk.life > 0);
      if (game.state === 'COUNTDOWN') {
        game.countdownTimer -= delta;
        if (game.countdownTimer <= 0) {
          game.countdown -= 1;
          if (game.countdown <= 0) beginPlaying();
          else { game.countdownTimer = 58; setCountdown(game.countdown); }
        }
        return;
      }
      if (game.state === 'BOSS_INTRO') {
        game.introTimer = Math.max(0, (game.bossArrivalAt - performance.now()) / 1000 * 60);
        const introProgress = clamp(1 - game.introTimer / (BOSS_ARRIVAL_SECONDS * 60), 0, 1);
        if (stageAudioRef.current) stageAudioRef.current.volume = .72 * (1 - introProgress);
        if (bossAudioRef.current) bossAudioRef.current.volume = .72 * introProgress;
        if (game.introTimer <= 0) beginBoss();
      }
      if (game.state !== 'PLAYING' && game.state !== 'BOSS' && game.state !== 'BOSS_INTRO') return;
      const arsenal = arsenalRef.current;
      const now = performance.now() / 1000;
      arsenal.splashes = arsenal.splashes.filter((effect) => effect.until > now);
      if (arsenal.beam && arsenal.beam.until <= now) arsenal.beam = null;
      let stageSecondsLeft = 0;
      const player = game.player;
      let joystick = joystickRef.current;
      let controllerInput = neutralControllerVector();
      if (typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function') {
        try {
          const gamepad = selectActiveGamepad(Array.from(navigator.getGamepads()));
          if (gamepad) controllerInput = mapGamepadInput(gamepad);
        } catch {
          controllerInput = neutralControllerVector();
        }
      }
      const gamepadActive = Math.hypot(controllerInput.x, controllerInput.y) > 0.01;
      if (gamepadActive) joystick = { ...joystick, dx: controllerInput.x, dy: controllerInput.y };
      const isSteering = gamepadActive || joystick.pointerId !== null;
      if (![player.x, player.y, player.vx, player.vy, joystick.dx, joystick.dy].every(Number.isFinite)) {
        player.x = W / 2; player.y = H / 2; player.vx = 0; player.vy = 0;
        joystick = joystickRef.current = neutralJoystick();
      }
      const targetVx = joystick.dx * PLAYER_MAX_SPEED;
      const targetVy = joystick.dy * PLAYER_MAX_SPEED;
      const changeX = targetVx - player.vx;
      const changeY = targetVy - player.vy;
      const distance = Math.hypot(changeX, changeY);
      const velocityStep = (isSteering ? PLAYER_ACCELERATION : PLAYER_DECELERATION) * delta;
      if (distance <= velocityStep) {
        player.vx = targetVx; player.vy = targetVy;
      } else {
        player.vx += changeX / distance * velocityStep;
        player.vy += changeY / distance * velocityStep;
      }
      player.x = clamp(player.x + player.vx * delta, 22, W - 22);
      const bottomLimit = game.state === 'BOSS' ? H - 150 : H - 100;
      player.y = clamp(player.y + player.vy * delta, 90, bottomLimit);
      if ((player.x === 22 && player.vx < 0) || (player.x === W - 22 && player.vx > 0)) player.vx = 0;
      if ((player.y === 90 && player.vy < 0) || (player.y === bottomLimit && player.vy > 0)) player.vy = 0;
      player.frame += 1;
      player.invincible = Math.max(0, player.invincible - delta);
      const volley = game.boss?.phase === 'DYING' ? { shots: [], beam: null } : fireWeapon(arsenal.weapon, player, now);
      game.bullets.push(...volley.shots.slice(0, Math.max(0, WEAPON_BALANCE.maxBullets - game.bullets.length)));
      if (volley.beam) arsenal.beam = volley.beam;
      let live = blankLiveFeatures();
      if (game.state === 'PLAYING') {
        live = readReactiveTrack(game.stageReactive);
        const songTime = getGameTime();
        const stage = getStageProgress(songTime);
        stageSecondsLeft = stage.secondsLeft;
        const progress = stage.progress;
        game.spawnCooldown -= delta;
        game.currentBehavior = chooseBehavior(live);
        if (!game.stageDone && stage.finished) {
          game.stageDone = true;
          beginBossIntro();
          return;
        }
        const pressure = spawnProfile(live, game.level, progress);
        if ((game.spawnCooldown <= 0 || (live.pulse && game.spawnCooldown <= 10)) && game.enemies.length < pressure.maxEnemies) {
          const behavior = chooseBehavior(live);
          const count = pressure.count;
          const spawnSerial = game.spawnIndex;
          game.spawnIndex += count;
          for (let enemyIndex = 0; enemyIndex < count && game.enemies.length < pressure.maxEnemies; enemyIndex += 1) {
            const serial = spawnSerial + enemyIndex + game.level * 17;
            const variation = (Math.sin(serial * 2.17 + live.centroid * 8) + 1) / 2;
            const radius = clamp(9 + live.low * 17 + variation * 10 + live.high * 5, 9, 42);
            const x = behavior === 'FORMATION' ? (W / (count + 1)) * (enemyIndex + 1) : random(radius + 18, W - radius - 18);
            const health = clamp(1 + Math.round(live.low * 3 + progress * 3 + (game.level - 1) * 1.2), 1, 22);
            const shape = chooseEnemyShape(live, serial);
            const projectile = chooseProjectile(live, behavior);
            const motion = chooseMotion(live, serial);
            const pattern = chooseAttack(live, serial);
            game.enemies.push({ x, y: -radius - 12, radius, health, maxHealth: health, speed: (2.4 + live.high * 6.2 + progress * 2.4) * pressure.speedScale, behavior, fireRate: clamp((112 - live.mid * 42) / pressure.fireScale, 28, 140), fireTimer: randomInt(20, 80), frame: 0, zigDir: Math.random() > .5 ? 1 : -1, formX: x, formY: -radius - 12, diving: false, dvx: 0, dvy: 0, shape, projectile, form: generateForm(live, serial, .8), motion, pattern, subBoss: false, exiting: false, alive: true });
          }
          game.spawnCooldown = pressure.cooldown;
        }
      } else if (game.state === 'BOSS' && game.boss) {
        const boss = game.boss;
        boss.frame += delta;
        live = readReactiveTrack(game.bossReactive);
        if (boss.phase === 'INTRO') {
          boss.y += (120 - boss.y) * .035 * delta * slowScale(boss, now);
          if (boss.y >= 117) { boss.phase = bossPhase(boss.health, boss.maxHealth); boss.phaseFrame = 0; boss.subBossTimer = 180; }
        } else if (boss.phase === 'DYING') {
          if (game.enemies.length || game.enemyBullets.length) clearHostilesOnBossDeath();
          const deathComplete = advanceBossDeath(boss, delta);
          if (game.frame % 4 === 0) spawnParticles(game.particles, boss.x + random(-boss.radius, boss.radius), boss.y + random(-boss.radius, boss.radius), ['#ff4444', '#ff8800', '#ffff00', '#ffffff'][randomInt(0, 3)], 12, 2, 9);
          if (deathComplete) { beginNextLevel(); return; }
        } else {
          const nextPhase = bossPhase(boss.health, boss.maxHealth);
          if (boss.phase !== nextPhase) {
            boss.phase = nextPhase;
            boss.phaseFrame = 0;
            boss.revision += 1;
            boss.vx = boss.x > W / 2 ? -1 : 1;
            spawnSubBoss(live);
          }
          const bossDelta = delta * slowScale(boss, now);
          boss.phaseFrame += bossDelta;
          if ((boss.phaseFrame > 160 && live.pulse) || boss.phaseFrame > 260) {
            boss.revision += 1;
            boss.phaseFrame = 0;
          }
          if (boss.phaseFrame < delta * 2) {
            const serial = boss.revision + game.level * 37;
            boss.form = generateForm(live, serial);
            boss.motion = chooseMotion(live, serial);
            boss.pattern = chooseAttack(live, serial);
            boss.shape = chooseBossShape(live);
          }
          boss.projectile = chooseProjectile(live, 'BOSS');
          game.currentBehavior = `BOSS ${boss.pattern}`;
          boss.subBossTimer -= bossDelta;
          if (boss.subBossTimer <= 0 && (live.pulse || audioIntensity(live) > .55 || boss.subBossTimer <= -150)) {
            spawnSubBoss(live);
            boss.subBossTimer = clamp(680 - audioIntensity(live) * 350 - game.level * 15, 240, 680);
          }
          moveDynamicBoss(boss, player, live, bossDelta);
          boss.fireTimer -= bossDelta * (1 + audioIntensity(live) * .45);
          if (boss.fireTimer <= 0) {
            firePattern(game.enemyBullets, boss.x, boss.y + boss.radius * .3, player, boss.pattern, boss.projectile, 7.4 + Math.min(2, game.level * .18), boss.pattern === 'TRACK' ? 8 : 4, game.frame);
            boss.fireTimer = clamp(64 - audioIntensity(live) * 39 - live.tempo * .06 - game.level * 2, 17, 65);
          }
        }
      } else if (game.state === 'BOSS_INTRO') {
        live = readReactiveTrack(game.stageReactive);
      }
      for (const enemy of game.enemies) {
        if (!canAttack()) break;
        if (!enemy.alive) continue;
        const enemyDelta = delta * slowScale(enemy, now);
        enemy.frame += enemyDelta;
        const movement = enemy.speed * enemyDelta * ENEMY_MOTION_TIME_SCALE * (1 + audioIntensity(live) * .3);
        if (enemy.exiting) {
          enemy.fireRate = 0;
          enemy.y += (12 + enemy.speed * 2.2) * delta;
        } else if (enemy.motion === 'ORBIT') {
          enemy.formY += movement * .65;
          enemy.y += (enemy.formY + Math.cos(enemy.frame * .06) * 15 - enemy.y) * .08 * enemyDelta;
          enemy.x += (enemy.formX + Math.sin(enemy.frame * .045) * (enemy.subBoss ? 75 : 30) - enemy.x) * .08 * enemyDelta;
        } else if (enemy.motion === 'SWEEP') {
          enemy.y += movement * .5;
          enemy.x += enemy.zigDir * movement * 2.3;
          if (enemy.x <= enemy.radius || enemy.x >= W - enemy.radius) enemy.zigDir *= -1;
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
          if (enemy.diving) { enemy.x += enemy.dvx * enemyDelta * ENEMY_MOTION_TIME_SCALE; enemy.y += enemy.dvy * enemyDelta * ENEMY_MOTION_TIME_SCALE; }
          else enemy.y += movement * .7;
        } else {
          enemy.y += movement * .7;
          enemy.x += Math.sin(enemy.frame * .09) * movement * 1.5;
        }
        enemy.x = clamp(enemy.x, enemy.radius, W - enemy.radius);
        if (enemy.subBoss && !enemy.exiting) enemy.y = clamp(enemy.y, enemy.radius + 40, 325);
        if (!enemy.exiting && enemy.fireRate > 0) {
          enemy.fireTimer -= enemyDelta * (1 + audioIntensity(live) * .7);
          if (enemy.fireTimer <= 0) {
            firePattern(game.enemyBullets, enemy.x, enemy.y, player, enemy.pattern, enemy.projectile, 7 + Math.min(2, game.level * .12), enemy.subBoss ? 5 : 3, Math.round(enemy.frame));
            enemy.fireTimer = enemy.fireRate;
          }
        }
        if (enemy.y > H + 70) enemy.alive = false;
        const enemyOnScreen = enemy.y + enemy.radius >= 0 && enemy.y - enemy.radius <= H;
        for (const companion of companionPositions(player, arsenal.weapon)) {
          if (enemy.alive && companion.health > 0 && !enemy.exiting &&
            enemyShotHitsPlayer(enemy, companion, 14, 20)) {
            arsenal.weapon.companions[companion.index] = Math.max(0, companion.health - 14);
            killEnemy(enemy, false);
            spawnParticles(game.particles, companion.x, companion.y, '#ffe45e', 8);
          }
        }
        if (enemy.alive && !enemy.exiting && enemyOnScreen && enemyHitsPlayer(enemy, player)) {
          enemy.alive = false;
          spawnDeathDebris(game.debris, enemy.x, enemy.y, enemy.radius, COLORS[enemy.behavior]);
          if (player.invincible <= 0 && arsenal.weapon.shieldUntil <= now) {
            player.health = Math.max(0, player.health - (enemy.subBoss ? 22 : enemy.behavior === 'TANK' ? 25 : 14));
            player.invincible = 90;
            spawnParticles(game.particles, player.x, player.y, '#ff3333', 14);
            if (player.health <= 0) gameOver();
          }
        }
      }
      game.enemies = game.enemies.filter((enemy) => enemy.alive);
      // A beam is resolved only on its firing frame; the fading visual never repeats damage.
      if (volley.beam && canAttack()) {
        for (const enemy of game.enemies) {
          if (enemy.alive && laserHitsTarget(volley.beam, enemy)) {
            enemy.health -= volley.beam.damage;
            spawnImpactDust(game.particles, enemy.x, enemy.y, '#ee8cff');
            if (enemy.health <= 0) killEnemy(enemy);
          }
        }
        if (game.boss && laserHitsTarget(volley.beam, game.boss)) hitBoss(volley.beam.damage);
      }
      for (const bullet of game.enemyBullets) {
        if (tickFrozenBullet(bullet, now) && !bullet.alive) spawnParticles(game.particles, bullet.x, bullet.y, '#b8f6ff', 5);
      }
      game.enemyBullets = game.enemyBullets.filter((bullet) => bullet.alive);
      advanceProjectiles(game.bullets, game.enemyBullets, delta, W, H);
      for (const bullet of game.bullets) {
        if (!canAttack()) break;
        if (!bullet.alive) continue;
        if (bullet.freeze) {
          const hitShot = game.enemyBullets.find((shot) => shot.alive && !shot.frozenUntil &&
            Math.hypot(shot.x - bullet.x, shot.y - bullet.y) < shot.radius + bullet.radius);
          if (hitShot) { splash(bullet.x, bullet.y); bullet.alive = false; continue; }
        }
        for (const enemy of game.enemies) {
          if (!enemy.alive) continue;
          if (playerShotHitsTarget(bullet, enemy)) {
            bullet.alive = false; enemy.health -= bullet.damage;
            if (bullet.freeze) splash(bullet.x, bullet.y);
            spawnImpactDust(game.particles, bullet.x, bullet.y, COLORS[enemy.behavior]);
            if (enemy.health <= 0) killEnemy(enemy);
            break;
          }
        }
        if (!bullet.alive) continue;
        const boss = game.boss;
        if (game.state === 'BOSS' && boss && boss.phase !== 'DYING' && playerShotHitsTarget(bullet, boss)) {
          bullet.alive = false;
          if (bullet.freeze) splash(bullet.x, bullet.y);
          hitBoss(bullet.damage);
          spawnParticles(game.particles, bullet.x, bullet.y, '#ffaa00', 5, 2, 6);
        }
      }
      for (const bullet of game.enemyBullets) {
        if (!canAttack()) break;
        if (!bullet.alive || bullet.frozenUntil) continue;
        for (const companion of companionPositions(player, arsenal.weapon)) {
          if (bullet.alive && companion.health > 0 && enemyShotHitsPlayer(bullet, companion, 14, 20)) {
            bullet.alive = false;
            arsenal.weapon.companions[companion.index] = Math.max(0, companion.health - bullet.damage);
            spawnParticles(game.particles, companion.x, companion.y, '#ffe45e', 5);
          }
        }
        if (bullet.alive && enemyShotHitsPlayer(bullet, player, PLAYER_W, PLAYER_H)) {
          bullet.alive = false;
          if (player.invincible <= 0 && arsenal.weapon.shieldUntil <= now) {
            player.health = Math.max(0, player.health - bullet.damage); player.invincible = 90;
            spawnParticles(game.particles, player.x, player.y, '#ff3333', 14);
            if (player.health <= 0) gameOver();
          }
        }
      }
      if (canAttack()) {
        for (const pickup of arsenal.drops) {
          if (advancePickup(pickup, player, now, delta / 60, H)) receivePickup(pickup.type);
          if (!canAttack()) break;
        }
      }
      arsenal.drops = arsenal.drops.filter((drop) => drop.alive && drop.expiresAt > now);
      game.enemies = game.enemies.filter((enemy) => enemy.alive);
      game.bullets = game.bullets.filter((bullet) => bullet.alive);
      game.enemyBullets = game.enemyBullets.filter((bullet) => bullet.alive);
      setCombatHud({ weapon: { ...arsenal.weapon, companions: [...arsenal.weapon.companions] }, now,
        message: arsenal.message, messageUntil: arsenal.messageUntil });
       setHud({ level: game.level, score: game.score, health: player.health, behavior: game.currentBehavior || 'SCANNING', phase: game.boss?.phase ?? '', bossHealth: game.boss?.health ?? 0, bossMaxHealth: game.boss?.maxHealth ?? 1, stageSecondsLeft: game.state === 'BOSS_INTRO' ? Math.ceil(Math.max(0, game.introTimer) / 60) : stageSecondsLeft });
    };
    const draw = () => {
      const game = gameRef.current;
      ctx.fillStyle = '#07080f';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#081225';
      ctx.fillRect(0, 0, W, H);
      for (const star of stars) { ctx.globalAlpha = star.brightness; ctx.fillStyle = star.size > 2 ? '#00e5ff' : '#9ed9ff'; ctx.fillRect(star.x, star.y, star.size, star.size); }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(0,229,255,.06)';
      ctx.lineWidth = 1;
      for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      for (const particle of game.particles) { ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife); ctx.fillStyle = particle.color; ctx.fillRect(particle.x - 2, particle.y - 2, 4, 4); }
      ctx.globalAlpha = 1;
      for (const chunk of game.debris) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, chunk.life / Math.min(12, chunk.maxLife));
        ctx.translate(chunk.x, chunk.y);
        ctx.rotate(chunk.angle);
        ctx.fillStyle = chunk.color;
        ctx.beginPath();
        ctx.moveTo(-chunk.size, -chunk.size * .5);
        ctx.lineTo(chunk.size * .75, -chunk.size);
        ctx.lineTo(chunk.size, chunk.size * .55);
        ctx.lineTo(-chunk.size * .45, chunk.size);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
       for (const bullet of game.enemyBullets) {
         drawEnemyProjectile(ctx, bullet);
         if ((bullet.frozenUntil ?? 0) > performance.now() / 1000) drawFrozenHalo(ctx, bullet.x, bullet.y, bullet.radius);
       }
       for (const enemy of game.enemies) {
         const color = COLORS[enemy.behavior];
         ctx.globalAlpha = .85;
          drawGeneratedForm(ctx, enemy.x, enemy.y, enemy.radius, enemy.form, color, enemy.frame);
          if (enemy.subBoss) { ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(enemy.x, enemy.y, enemy.radius + 7, 0, Math.PI * 2); ctx.stroke(); }
         ctx.globalAlpha = 1;
          drawEnemyDamage(ctx, enemy);
          if (slowScale(enemy, performance.now() / 1000) < 1) drawFrozenHalo(ctx, enemy.x, enemy.y, enemy.radius);
       }
       if (game.boss) {
         const boss = game.boss;
         const color = boss.phase === 'PHASE3' ? '#ff2244' : boss.phase === 'PHASE2' ? '#ff8800' : '#4488ff';
         const gradient = ctx.createRadialGradient(boss.x, boss.y, 0, boss.x, boss.y, boss.radius * 2.2);
         gradient.addColorStop(0, `${color}55`); gradient.addColorStop(1, 'transparent');
         ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(boss.x, boss.y, boss.radius * 2.2, 0, Math.PI * 2); ctx.fill();
         ctx.globalAlpha = .9;
          drawGeneratedForm(ctx, boss.x, boss.y, boss.radius, boss.form, color, boss.frame);
         ctx.globalAlpha = 1;
         for (let ring = 1; ring <= 2; ring += 1) { ctx.strokeStyle = color; ctx.globalAlpha = .32 / ring; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(boss.x, boss.y, boss.radius + ring * 14, 0, Math.PI * 2); ctx.stroke(); }
         ctx.globalAlpha = 1;
         if (slowScale(boss, performance.now() / 1000) < 1) drawFrozenHalo(ctx, boss.x, boss.y, boss.radius);
       }
       const showPlayer = game.state === 'PLAYING' || game.state === 'BOSS_INTRO' || game.state === 'BOSS' || game.state === 'COUNTDOWN';
        drawPlayer(ctx, game.player.x, game.player.y, game.player.frame, showPlayer, game.player.health);
        const arsenal = arsenalRef.current;
        if (showPlayer) drawWeaponEffects(ctx, arsenal.weapon, game.player, game.bullets, arsenal.beam,
          arsenal.drops, performance.now() / 1000, arsenal.bombUntil, arsenal.splashes);
       if (showPlayer && game.player.invincible > 0) {
         ctx.save();
         ctx.strokeStyle = `rgba(0, 255, 200, ${.45 + .22 * Math.sin(game.frame * .24)})`;
         ctx.lineWidth = 2;
         ctx.beginPath();
         ctx.ellipse(game.player.x, game.player.y, 25, 33, 0, 0, Math.PI * 2);
         ctx.stroke();
         ctx.restore();
       }
        if (game.state === 'PLAYING' || game.state === 'BOSS' || game.state === 'BOSS_INTRO') drawJoystick(ctx, joystickRef.current);
    };
    const testWindow = window as Window & { __AUDIOSTRIKE_TEST_MODE__?: boolean; __AUDIOSTRIKE_TEST__?: {
      snapshot: () => object; finishBoss: () => void; spawnSubBoss: () => void;
      drop: (type: PickupType, x?: number, y?: number) => void;
      setPlayer: (values: Partial<typeof gameRef.current.player>) => void;
      clearArena: () => void; spawnTarget: (x: number, y: number, health: number, subBoss?: boolean) => void;
      enemyShot: (x: number, y: number, damage?: number) => void;
      freezeAt: (x: number, y: number) => void; setVolley: (value: number) => void; endRun: () => void;
    } };
    if (import.meta.env.DEV && testWindow.__AUDIOSTRIKE_TEST_MODE__) {
      testWindow.__AUDIOSTRIKE_TEST__ = {
        snapshot: () => {
          const game = gameRef.current;
          return {
            state: game.state, level: game.level, spawnIndex: game.spawnIndex,
            enemyCount: game.enemies.length, subBossCount: game.enemies.filter((enemy) => enemy.subBoss).length, hostileShots: game.enemyBullets.length,
            bossHealth: game.boss?.health, bossMaxHealth: game.boss?.maxHealth, bossX: game.boss?.x, bossY: game.boss?.y, bossRadius: game.boss?.radius,
            stageTime: (performance.now() - game.songStart) / 1000,
            stageAudioTime: stageAudioRef.current?.currentTime, stageAudioPaused: stageAudioRef.current?.paused, stageAudioSrc: stageAudioRef.current?.src,
            bossAudioTime: bossAudioRef.current?.currentTime, bossAudioPaused: bossAudioRef.current?.paused, bossAudioSrc: bossAudioRef.current?.src,
            starY: stars[0]?.y, playerHealth: game.player.health,
            player: { ...game.player }, now: performance.now() / 1000,
            weapon: { ...arsenalRef.current.weapon, companions: [...arsenalRef.current.weapon.companions] },
            drops: arsenalRef.current.drops.map((drop) => ({ ...drop })),
            shots: game.bullets.map((shot) => ({ ...shot })), beam: arsenalRef.current.beam,
            enemies: game.enemies.map((enemy) => ({ x: enemy.x, y: enemy.y, health: enemy.health,
              frozenUntil: enemy.frozenUntil, fireTimer: enemy.fireTimer, alive: enemy.alive })),
            enemyShots: game.enemyBullets.map((shot) => ({ ...shot })),
          };
        },
        finishBoss: () => {
          const boss = gameRef.current.boss;
          if (!boss) throw new Error('No boss to finish');
          boss.health = 0;
          boss.phase = 'DYING';
          boss.dyingTimer = 0;
        },
        spawnSubBoss: () => spawnSubBoss(readReactiveTrack(gameRef.current.bossReactive)),
        drop: (type, x = gameRef.current.player.x, y = gameRef.current.player.y) => addDrop(type, x, y),
        setPlayer: (values) => Object.assign(gameRef.current.player, values),
        clearArena: () => {
          const game = gameRef.current;
          game.enemies = []; game.bullets = []; game.enemyBullets = []; game.spawnCooldown = 1e9;
          arsenalRef.current.drops = [];
        },
        spawnTarget: (x, y, health, subBoss = false) => {
          gameRef.current.enemies.push({ x, y, radius: 18, health, maxHealth: health, speed: 0,
            behavior: 'PATROL', fireRate: 0, fireTimer: 0, frame: 0, zigDir: 1,
            formX: x, formY: y, diving: false, dvx: 0, dvy: 0, shape: 'CIRCLE',
            projectile: 'ORB', exiting: false, alive: true, subBoss,
            form: generateForm(blankLiveFeatures(), 1), motion: 'SWEEP', pattern: 'TRACK' });
        },
        enemyShot: (x, y, damage = 5) => { gameRef.current.enemyBullets.push(createEnemyProjectile(x, y, 0, 0, damage, 'ORB')); },
        freezeAt: (x, y) => splash(x, y),
        setVolley: (value) => { arsenalRef.current.weapon.volley = value; },
        endRun: () => gameOver(),
      };
    }
    const loop = (now: number) => {
      const delta = Math.min(2.2, (now - last) / 16.67);
      last = now;
      update(delta);
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      if (import.meta.env.DEV) delete testWindow.__AUDIOSTRIKE_TEST__;
    };
  }, [playTrack, resumeAudio, state, syncState]);

  useEffect(() => () => resetAudio(), [resetAudio]);

  const pointerPosition = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;
    return { x: (event.clientX - rect.left) * W / rect.width, y: (event.clientY - rect.top) * H / rect.height };
  };
  const onJoystickDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if ((gameRef.current.state !== 'PLAYING' && gameRef.current.state !== 'BOSS' && gameRef.current.state !== 'BOSS_INTRO') || joystickRef.current.pointerId !== null) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    const position = pointerPosition(event);
    if (!position) return;
    const { x, y } = position;
    joystickRef.current = { pointerId: event.pointerId, x, y, dx: 0, dy: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onJoystickMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const joystick = joystickRef.current;
    if (joystick.pointerId !== event.pointerId) return;
    event.preventDefault();
    const position = pointerPosition(event);
    if (!position) return;
    const { x, y } = position;
    const offsetX = x - joystick.x;
    const offsetY = y - joystick.y;
    const scale = Math.max(JOYSTICK_RADIUS, Math.hypot(offsetX, offsetY));
    joystick.dx = offsetX / scale;
    joystick.dy = offsetY / scale;
  };
  const onJoystickRelease = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (joystickRef.current.pointerId !== event.pointerId) return;
    joystickRef.current = neutralJoystick();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const fileLabel = (file: File | null) => file ? `${file.name} · ${(file.size / 1048576).toFixed(1)} MB` : 'No track selected';
  const retryAudio = () => {
    const game = gameRef.current;
    const bossTrack = game.state === 'BOSS' || game.state === 'BOSS_INTRO';
    const audio = bossTrack ? bossAudioRef.current : stageAudioRef.current;
    if (!audio) return;
    if (!bossTrack && game.state === 'PLAYING' && Number.isFinite(audio.duration) && audio.duration > 0) {
      audio.currentTime = Math.min(audio.duration - .01, ((performance.now() - game.songStart) / 1000) % audio.duration);
    }
    audio.volume = game.state === 'COUNTDOWN' ? 0 : .72;
    resumeAudio();
    playTrack(audio, bossTrack ? 'Boss track' : 'Stage track');
  };
  const canStart = Boolean(stageFile && bossFile);
  const isGame = state === 'COUNTDOWN' || state === 'PLAYING' || state === 'BOSS_INTRO' || state === 'BOSS' || state === 'GAME_OVER';

  return (
    <main className="arcade-app" data-testid="page-audiostrike">
      <div className="scanline" aria-hidden="true" />
      {!isGame && (
        <section className="upload-shell arcade-grid flex min-h-[100dvh] items-center justify-center px-4 py-10" data-testid="panel-upload">
          <div className="w-full max-w-[560px]">
            <div className="mb-9 text-center">
              <div className="mb-3 flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-[.32em] text-cyan-300/60"><Zap className="h-3.5 w-3.5" /> Local signal combat</div>
              <h1 className="title-mark text-5xl font-extrabold sm:text-7xl" data-testid="text-title">AUDIOSTRIKE</h1>
              <p className="mt-3 font-mono text-[11px] uppercase tracking-[.22em] text-slate-500">Music-driven aerial combat</p>
            </div>
            {state === 'ANALYZING' ? (
              <div className="hud-panel rounded-xl p-7 sm:p-9" data-testid="panel-analyzing">
                <div className="mb-6 flex items-center gap-3"><Headphones className="h-5 w-5 text-cyan-300" /><div><p className="font-mono text-xs uppercase tracking-[.18em] text-cyan-300">Analyzing music</p><p className="mt-1 text-sm text-slate-500">{analysisMessage}</p></div></div>
                <div className="h-3 overflow-hidden rounded-full bg-slate-900"><div className="h-full rounded-full bg-cyan-300 transition-[width] duration-300" style={{ width: `${analysisProgress}%` }} /></div>
                <div className="mt-3 flex justify-between font-mono text-[10px] uppercase text-slate-500"><span>Stage {stageProgress}%</span><span data-testid="text-analysis-progress">{analysisProgress}%</span><span>Boss {bossProgress}%</span></div>
                <p className="mt-8 text-center font-mono text-[10px] uppercase tracking-[.14em] text-slate-600">Features stay in your browser. No upload.</p>
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  <label className="file-drop block cursor-pointer rounded-xl border border-slate-800 bg-slate-950/70 p-5" data-testid="label-stage-file">
                    <div className="flex items-start gap-4"><div className="grid h-10 w-10 shrink-0 place-items-center border border-cyan-300/30 bg-cyan-300/10 text-cyan-300"><FileAudio className="h-5 w-5" /></div><div className="min-w-0"><span className="font-mono text-[11px] font-bold uppercase tracking-[.18em] text-cyan-300">Stage track</span><p className="mt-1 text-sm text-slate-400">Drives enemy count, speed, health, and patterns</p><p className="mt-3 truncate font-mono text-[10px] uppercase text-slate-500" data-testid="text-stage-file">{fileLabel(stageFile)}</p></div></div>
                    <input ref={stageInputRef} className="sr-only" type="file" accept=".mp3,.wav,.ogg,.flac,.m4a,.aac,.opus,audio/*" data-testid="input-stage-file" />
                  </label>
                  <label className="file-drop block cursor-pointer rounded-xl border border-slate-800 bg-slate-950/70 p-5" data-testid="label-boss-file">
                    <div className="flex items-start gap-4"><div className="grid h-10 w-10 shrink-0 place-items-center border border-orange-300/30 bg-orange-300/10 text-orange-300"><Shield className="h-5 w-5" /></div><div className="min-w-0"><span className="font-mono text-[11px] font-bold uppercase tracking-[.18em] text-orange-300">Boss track</span><p className="mt-1 text-sm text-slate-400">Plays through the full three-phase encounter</p><p className="mt-3 truncate font-mono text-[10px] uppercase text-slate-500" data-testid="text-boss-file">{fileLabel(bossFile)}</p></div></div>
                    <input ref={bossInputRef} className="sr-only" type="file" accept=".mp3,.wav,.ogg,.flac,.m4a,.aac,.opus,audio/*" data-testid="input-boss-file" />
                  </label>
                </div>
                <button onClick={startAnalysis} disabled={!canStart} className="action-button mt-5 flex w-full items-center justify-center gap-3 rounded-xl border border-cyan-300/50 bg-cyan-300/10 py-4 font-mono text-xs font-bold uppercase tracking-[.2em] text-cyan-200 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-slate-900/50 disabled:text-slate-600" data-testid="button-analyze"><Crosshair className="h-4 w-4" /> Analyze and play</button>
            <div className="mt-5 flex items-center justify-center gap-2 font-mono text-[10px] uppercase tracking-[.14em] text-slate-600"><Volume2 className="h-3 w-3" /> MP3 · WAV · OGG · FLAC · M4A · AAC</div>
                <p className="controller-status mt-2" data-testid="controller-status" aria-live="polite">{controllerStatus}</p>
              </>
            )}
            <div className="mt-10 grid grid-cols-3 gap-2 text-center font-mono text-[9px] uppercase tracking-[.12em] text-slate-600"><span className="border-t border-slate-800 pt-3">Touch, left stick, or D-pad to steer</span><span className="border-t border-slate-800 pt-3">Auto-fire</span><span className="border-t border-slate-800 pt-3">Three phases</span></div>
          </div>
        </section>
      )}
      {isGame && (
        <section className="game-shell" data-testid="panel-game">
          <div className="game-frame">
            <canvas ref={canvasRef} className="game-canvas" onPointerDown={onJoystickDown} onPointerMove={onJoystickMove} onPointerUp={onJoystickRelease} onPointerCancel={onJoystickRelease} onLostPointerCapture={onJoystickRelease} data-testid="canvas-game" aria-label="AudioStrike game field. Steer with touch or a game controller; weapons fire automatically." />
            <WeaponHUD {...combatHud} />
            <div className="hud-top">
              <div className="hud-chip"><div className="font-mono text-[8px] uppercase tracking-[.16em] text-slate-500">Score</div><div className="font-mono text-sm font-bold text-cyan-200" data-testid="text-score">{String(hud.score).padStart(6, '0')}</div></div>
              <div className="hud-chip font-mono" data-testid="text-level"><div className="text-[8px] uppercase tracking-[.16em] text-slate-500">Level</div><div className="text-sm font-bold text-cyan-200">{hud.level}</div></div>
              {(state === 'PLAYING' || state === 'BOSS_INTRO') && <div className="hud-stage-timer font-mono" role="timer" aria-label={`Boss arrives in ${hud.stageSecondsLeft} seconds`} data-testid="text-stage-time"><div className="text-[8px] uppercase tracking-[.12em] text-slate-400">Boss in</div><div className="text-sm font-bold tabular-nums text-cyan-200">{hud.stageSecondsLeft}s</div></div>}
              <div className="text-right"><div className="font-mono text-[8px] uppercase tracking-[.16em] text-slate-500">Threat</div><div className="font-mono text-xs font-bold text-orange-300" data-testid="text-behavior">{hud.behavior}</div></div>
            </div>
            <div className="hud-bottom">
              {state === 'BOSS' && <div className="mb-3"><div className="mb-1 flex justify-between font-mono text-[9px] uppercase tracking-[.12em] text-orange-200"><span>Enemy core · {hud.phase}</span><span data-testid="text-boss-health">{Math.ceil(hud.bossHealth)} / {hud.bossMaxHealth}</span></div><div className="boss-health"><div style={{ width: `${hud.bossMaxHealth ? hud.bossHealth / hud.bossMaxHealth * 100 : 0}%` }} /></div></div>}
              <p className="controller-status mb-2" data-testid="controller-status" aria-live="polite"><Gamepad2 className="h-3 w-3 shrink-0" />{controllerStatus}</p>
              <div className="flex items-end justify-between gap-2"><div className="hull-status"><div className="mb-1 font-mono text-[8px] uppercase tracking-[.16em] text-slate-400">Hull integrity</div><div className={`whitespace-nowrap font-mono text-2xl font-bold ${hud.health <= 25 ? 'text-red-300' : hud.health <= 50 ? 'text-orange-300' : 'text-green-300'}`} data-testid="status-health">{hud.health} <span className="text-xs font-normal text-slate-400">/ {PLAYER_MAX_HEALTH}</span></div></div><div className="steering-hint flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.14em] text-cyan-300/60"><Gamepad2 className="h-3 w-3" /> Touch, stick, or D-pad</div></div>
            </div>
            {audioError && <div className="audio-alert" role="alert"><span>{audioError}</span><button type="button" onClick={retryAudio} className="rounded border border-orange-300 px-2 py-1 font-bold text-orange-200">Retry audio</button></div>}
            {state === 'COUNTDOWN' && <div className="state-overlay" data-testid="overlay-countdown"><div><p className="font-mono text-[10px] uppercase tracking-[.28em] text-cyan-300">Get ready</p><div className="mt-2 text-8xl font-extrabold text-cyan-200" data-testid="text-countdown">{countdown}</div><p className="mt-1 font-mono text-[10px] uppercase tracking-[.18em] text-slate-500">Touch, left stick, or D-pad · weapons auto-fire</p></div></div>}
            {state === 'GAME_OVER' && <div className="state-overlay" data-testid="overlay-game-over"><div className="overlay-card"><p className="font-mono text-[10px] uppercase tracking-[.28em] text-red-300">Flight terminated</p><h2 className="mt-3 text-5xl font-extrabold tracking-[.08em] text-red-200">SYSTEM DOWN</h2><p className="mt-3 font-mono text-[10px] uppercase tracking-[.16em] text-slate-500">Final score {hud.score}. Tap replay to re-enter the mix.</p><button onClick={beginCountdown} className="action-button mt-7 inline-flex items-center gap-2 rounded-lg border border-cyan-300/50 bg-cyan-300/10 px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[.18em] text-cyan-200" data-testid="button-replay-game-over"><RotateCcw className="h-3.5 w-3.5" /> Replay mission</button></div></div>}
          </div>
        </section>
      )}
    </main>
  );
}

function App() {
  return <Home />;
}

export default App;
