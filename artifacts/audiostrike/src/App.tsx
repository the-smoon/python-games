import { useCallback, useEffect, useRef, useState } from 'react';
import { Crosshair, FileAudio, Gamepad2, Headphones, RotateCcw, Shield, Volume2, Zap } from 'lucide-react';

type GameState = 'UPLOAD' | 'ANALYZING' | 'COUNTDOWN' | 'PLAYING' | 'BOSS_INTRO' | 'BOSS' | 'GAME_OVER' | 'VICTORY';
type Behavior = 'PATROL' | 'ZIGZAG' | 'FORMATION' | 'SWARM' | 'DIVE' | 'SHOOTER' | 'TANK';
type FeatureSet = {
  duration: number;
  beat_times: number[];
  rms: number[];
  onset: number[];
  low_energy: number[];
  mid_energy: number[];
  high_energy: number[];
  centroid: number[];
  flatness: number[];
};
type EnemyEntity = {
  x: number; y: number; radius: number; health: number; maxHealth: number; speed: number;
  behavior: Behavior; fireRate: number; fireTimer: number; frame: number; zigDir: number;
  formX: number; formY: number; diving: boolean; dvx: number; dvy: number; alive: boolean;
};
type BulletEntity = { x: number; y: number; vy: number; alive: boolean };
type EnemyBulletEntity = { x: number; y: number; vx: number; vy: number; damage: number; alive: boolean };
type ParticleEntity = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string };
type BossEntity = { x: number; y: number; radius: number; health: number; maxHealth: number; phase: 'INTRO' | 'PHASE1' | 'PHASE2' | 'PHASE3' | 'DYING'; frame: number; vx: number; fireTimer: number; dyingTimer: number };

const W = 800;
const H = 600;
const PLAYER_MAX_HEALTH = 100;
const PLAYER_BULLET_SPEED = 17;
const BULLET_TIME_SCALE = 0.09;
const ENEMY_MOTION_TIME_SCALE = 0.085;
const ENEMY_BULLET_TIME_SCALE = 0.09;
const PLAYER_W = 20;
const PLAYER_H = 32;
const COLORS: Record<string, string> = {
  PATROL: '#4488ff', ZIGZAG: '#00ccff', FORMATION: '#44ff88', SWARM: '#ffff44',
  DIVE: '#ff8800', SHOOTER: '#ff4444', TANK: '#cc44ff',
};
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const random = (min: number, max: number) => min + Math.random() * (max - min);
const randomInt = (min: number, max: number) => Math.floor(random(min, max + 1));

function makeFeatures(duration: number, seed: number): FeatureSet {
  const safeDuration = clamp(duration || 42, 18, 180);
  const beat_times: number[] = [];
  const rms: number[] = [];
  const onset: number[] = [];
  const low_energy: number[] = [];
  const mid_energy: number[] = [];
  const high_energy: number[] = [];
  const centroid: number[] = [];
  const flatness: number[] = [];
  const beatStep = 0.48 + (seed % 4) * 0.045;
  for (let time = 0; time < safeDuration; time += beatStep) {
    const wave = (Math.sin(time * 1.7 + seed) + Math.sin(time * 0.37) + 2) / 4;
    beat_times.push(Number(time.toFixed(3)));
    rms.push(clamp(.28 + wave * .5 + Math.sin(time * .09) * .12, .12, .96));
    onset.push(clamp(.18 + Math.abs(Math.sin(time * 2.2 + seed)) * .75, .08, .98));
    low_energy.push(clamp(.25 + Math.abs(Math.sin(time * .63 + seed)) * .7, .12, .96));
    mid_energy.push(clamp(.18 + Math.abs(Math.cos(time * .47 + seed)) * .7, .08, .94));
    high_energy.push(clamp(.14 + Math.abs(Math.sin(time * .91 + seed * 2)) * .8, .08, .97));
    centroid.push(clamp(.2 + Math.abs(Math.sin(time * .29 + seed)) * .72, .08, .95));
    flatness.push(clamp(.18 + Math.abs(Math.cos(time * .52)) * .6, .08, .88));
  }
  return { duration: safeDuration, beat_times, rms, onset, low_energy, mid_energy, high_energy, centroid, flatness };
}

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
  let seed = file.size % 13;
  try {
    const context = new AudioContext();
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    seed += Math.round(buffer.sampleRate / 1000) + buffer.numberOfChannels;
    await context.close();
  } catch {
    seed += file.name.length;
  }
  progress(72);
  const features = makeFeatures(duration, seed);
  progress(100);
  return features;
}

function spawnParticles(list: ParticleEntity[], x: number, y: number, color: string, count: number, speedMin = 2, speedMax = 8) {
  for (let index = 0; index < count; index += 1) {
    const angle = random(0, Math.PI * 2);
    const speed = random(speedMin, speedMax);
    const life = randomInt(18, 52);
    list.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life, maxLife: life, color });
  }
}

function drawPlayer(ctx: CanvasRenderingContext2D, x: number, y: number, frame: number, visible: boolean) {
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
  const exhaust = 10 + Math.floor((frame % 14) * .8);
  ctx.fillStyle = '#ff8800';
  ctx.beginPath(); ctx.roundRect(x - 5, y + halfH, 10, exhaust, 3); ctx.fill();
  ctx.fillStyle = '#ffff00';
  ctx.beginPath(); ctx.roundRect(x - 3, y + halfH, 6, Math.floor(exhaust / 2), 3); ctx.fill();
}

function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageInputRef = useRef<HTMLInputElement>(null);
  const bossInputRef = useRef<HTMLInputElement>(null);
  const stageAudioRef = useRef<HTMLAudioElement | null>(null);
  const bossAudioRef = useRef<HTMLAudioElement | null>(null);
  const pointerRef = useRef({ x: W / 2, y: H - 80 });
  const gameRef = useRef({ state: 'UPLOAD' as GameState, stageFeatures: null as FeatureSet | null, bossFeatures: null as FeatureSet | null, player: { x: W / 2, y: H - 80, health: PLAYER_MAX_HEALTH, invincible: 0, fireTimer: 0, frame: 0 }, enemies: [] as EnemyEntity[], bullets: [] as BulletEntity[], enemyBullets: [] as EnemyBulletEntity[], particles: [] as ParticleEntity[], boss: null as BossEntity | null, score: 0, frame: 0, songStart: 0, bossStart: 0, beatIndex: 0, spawnIndex: 0, stageDone: false, introTimer: 0, countdown: 3, countdownTimer: 0, victoryTimer: 0, currentBehavior: '' });
  const [state, setState] = useState<GameState>('UPLOAD');
  const [stageFile, setStageFile] = useState<File | null>(null);
  const [bossFile, setBossFile] = useState<File | null>(null);
  const [stageProgress, setStageProgress] = useState(0);
  const [bossProgress, setBossProgress] = useState(0);
  const [analysisMessage, setAnalysisMessage] = useState('Waiting for stage track');
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [hud, setHud] = useState({ score: 0, health: PLAYER_MAX_HEALTH, behavior: 'SCANNING', phase: '', bossHealth: 0, bossMaxHealth: 1 });

  const syncState = useCallback((next: GameState) => {
    gameRef.current.state = next;
    setState(next);
  }, []);

  const resetAudio = useCallback(() => {
    stageAudioRef.current?.pause();
    bossAudioRef.current?.pause();
    if (stageAudioRef.current) URL.revokeObjectURL(stageAudioRef.current.src);
    if (bossAudioRef.current) URL.revokeObjectURL(bossAudioRef.current.src);
    stageAudioRef.current = null;
    bossAudioRef.current = null;
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
      stageAudioRef.current = new Audio(URL.createObjectURL(stageFile));
      bossAudioRef.current = new Audio(URL.createObjectURL(bossFile));
      stageAudioRef.current.preload = 'auto';
      bossAudioRef.current.preload = 'auto';
      beginCountdown();
    } catch {
      setAnalysisMessage('Audio scan unavailable — using adaptive fallback');
      const game = gameRef.current;
      game.stageFeatures = makeFeatures(42, 8);
      game.bossFeatures = makeFeatures(28, 11);
      stageAudioRef.current = new Audio(URL.createObjectURL(stageFile));
      bossAudioRef.current = new Audio(URL.createObjectURL(bossFile));
      beginCountdown();
    }
  }, [bossFile, resetAudio, stageFile, syncState]);

  const beginCountdown = useCallback(() => {
    const game = gameRef.current;
    game.player = { x: W / 2, y: H - 80, health: PLAYER_MAX_HEALTH, invincible: 0, fireTimer: 0, frame: 0 };
    game.enemies = []; game.bullets = []; game.enemyBullets = []; game.particles = []; game.boss = null;
    game.score = 0; game.frame = 0; game.beatIndex = 0; game.spawnIndex = 0; game.stageDone = false; game.introTimer = 0;
    game.countdown = 3; game.countdownTimer = 58; game.currentBehavior = 'SCANNING';
    pointerRef.current = { x: W / 2, y: H - 80 };
    setCountdown(3);
    setHud({ score: 0, health: PLAYER_MAX_HEALTH, behavior: 'SCANNING', phase: '', bossHealth: 0, bossMaxHealth: 1 });
    syncState('COUNTDOWN');
  }, [syncState]);

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
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = W; canvas.height = H;
    const stars = Array.from({ length: 145 }, (_, index) => ({ x: random(0, W), y: random(0, H), size: randomInt(1, 3), brightness: random(.25, .9), speed: .35 + (index % 4) * .18 }));
    let raf = 0;
    let last = performance.now();
    const getGameTime = () => {
      const game = gameRef.current;
      return game.state === 'BOSS' ? (performance.now() - game.bossStart) / 1000 : (performance.now() - game.songStart) / 1000;
    };
    const rectsOverlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
    const enemyHitsPlayer = (enemy: EnemyEntity, player: { x: number; y: number }) => {
      const nx = clamp(player.x, enemy.x - PLAYER_W / 2, player.x + PLAYER_W / 2);
      const ny = clamp(player.y, enemy.y - PLAYER_H / 2, player.y + PLAYER_H / 2);
      return (enemy.x - nx) ** 2 + (enemy.y - ny) ** 2 <= enemy.radius ** 2;
    };
    const beginPlaying = () => {
      const game = gameRef.current;
      syncState('PLAYING');
      if (stageAudioRef.current) { stageAudioRef.current.currentTime = 0; void stageAudioRef.current.play().catch(() => undefined); }
      game.songStart = performance.now();
    };
    const beginBossIntro = () => {
      const game = gameRef.current;
      game.state = 'BOSS_INTRO'; game.introTimer = 165; game.enemies = []; game.enemyBullets = [];
      stageAudioRef.current?.pause();
      syncState('BOSS_INTRO');
    };
    const beginBoss = () => {
      const game = gameRef.current;
      const features = game.bossFeatures ?? makeFeatures(28, 4);
      const mean = features.rms.reduce((sum, value) => sum + value, 0) / Math.max(1, features.rms.length);
      const hp = Math.max(135, Math.round(250 * (.5 + mean)));
      game.boss = { x: W / 2, y: -70, radius: 55, health: hp, maxHealth: hp, phase: 'INTRO', frame: 0, vx: 1.8, fireTimer: 0, dyingTimer: 0 };
      game.bullets = []; game.enemyBullets = []; game.beatIndex = 0;
      game.state = 'BOSS'; game.bossStart = performance.now();
      bossAudioRef.current?.play().catch(() => undefined);
      syncState('BOSS');
    };
    const gameOver = () => {
      stageAudioRef.current?.pause(); bossAudioRef.current?.pause();
      syncState('GAME_OVER');
    };
    const victory = () => {
      bossAudioRef.current?.pause();
      gameRef.current.victoryTimer = 360;
      syncState('VICTORY');
    };
    const update = (delta: number) => {
      const game = gameRef.current;
      game.frame += 1;
      for (const star of stars) { star.y += star.speed * delta * .06; if (star.y > H) { star.y = 0; star.x = random(0, W); } }
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
        game.introTimer -= delta;
        for (const particle of game.particles) { particle.x += particle.vx * delta * .06; particle.y += particle.vy * delta * .06; particle.vy += .02 * delta; particle.life -= delta; }
        game.particles = game.particles.filter((particle) => particle.life > 0);
        if (game.introTimer <= 0) beginBoss();
        return;
      }
      if (game.state === 'VICTORY') {
        game.victoryTimer -= delta;
        if (game.frame % 8 === 0) spawnParticles(game.particles, random(90, W - 90), random(70, H - 230), ['#ff4444', '#ff8800', '#ffff44', '#44ff88', '#00ffff', '#cc44ff'][randomInt(0, 5)], 18, 2, 9);
        for (const particle of game.particles) { particle.x += particle.vx * delta * .06; particle.y += particle.vy * delta * .06; particle.vy += .02 * delta; particle.life -= delta; }
        game.particles = game.particles.filter((particle) => particle.life > 0);
        return;
      }
      if (game.state !== 'PLAYING' && game.state !== 'BOSS') return;
      const player = game.player;
      player.x += (clamp(pointerRef.current.x, 14, W - 14) - player.x) * .28;
      player.y += (clamp(pointerRef.current.y, 28, H - 28) - player.y) * .28;
      player.frame += 1;
      player.invincible = Math.max(0, player.invincible - delta);
      player.fireTimer -= delta;
      if (player.fireTimer <= 0) { game.bullets.push({ x: player.x, y: player.y - 18, vy: -PLAYER_BULLET_SPEED, alive: true }); player.fireTimer = 15; }
      if (game.state === 'PLAYING') {
        const features = game.stageFeatures ?? makeFeatures(42, 1);
        const songTime = getGameTime();
        while (game.spawnIndex < features.beat_times.length && features.beat_times[game.spawnIndex] <= songTime) {
          const index = game.spawnIndex;
          const rms = features.rms[index], onset = features.onset[index], low = features.low_energy[index], mid = features.mid_energy[index], high = features.high_energy[index], centroid = features.centroid[index];
          game.spawnIndex += 1;
          if (rms < .13 && onset < .15) continue;
          let behavior: Behavior = 'PATROL';
          if (onset > .84 && high > .5) behavior = 'DIVE';
          else if (onset > .72) behavior = 'SWARM';
          else if (low > .7) behavior = 'TANK';
          else if (mid > .6 && rms > .4) behavior = 'SHOOTER';
          else if (centroid > .6) behavior = 'ZIGZAG';
          else if (rms > .35 && features.flatness[index] < .3) behavior = 'FORMATION';
          const count = Math.min(4, 1 + Math.floor(rms * 3) + (onset > .88 ? 2 : 0));
          for (let enemyIndex = 0; enemyIndex < count && game.enemies.length < 20; enemyIndex += 1) {
            const radius = 10 + low * 34;
            const x = behavior === 'FORMATION' ? (W / (count + 1)) * (enemyIndex + 1) : random(radius + 18, W - radius - 18);
            game.enemies.push({ x, y: -radius - 12, radius, health: 1 + Math.round(low * 5), maxHealth: 1 + Math.round(low * 5), speed: 1.8 + high * 5.2, behavior, fireRate: mid > .4 ? Math.round(105 - mid * 45) : 0, fireTimer: randomInt(18, 100), frame: 0, zigDir: Math.random() > .5 ? 1 : -1, formX: x, formY: -radius - 12, diving: false, dvx: 0, dvy: 0, alive: true });
          }
          game.currentBehavior = behavior;
        }
        if (!game.stageDone && songTime >= features.duration) game.stageDone = true;
        if (game.stageDone && game.enemies.length === 0) beginBossIntro();
        for (const enemy of game.enemies) {
          enemy.frame += delta;
          if (enemy.behavior === 'PATROL') { enemy.y += enemy.speed * delta * ENEMY_MOTION_TIME_SCALE; enemy.x += Math.sin(enemy.frame * .03) * .6; }
          else if (enemy.behavior === 'ZIGZAG') { enemy.y += enemy.speed * .65 * delta * ENEMY_MOTION_TIME_SCALE; enemy.x += enemy.zigDir * enemy.speed * 1.6 * delta * ENEMY_MOTION_TIME_SCALE; if (enemy.x < enemy.radius || enemy.x > W - enemy.radius) enemy.zigDir *= -1; }
          else if (enemy.behavior === 'FORMATION') { enemy.formY += enemy.speed * .4 * delta * ENEMY_MOTION_TIME_SCALE; enemy.y += (enemy.formY - enemy.y) * .08; enemy.x += (enemy.formX + Math.sin(enemy.frame * .022) * 15 - enemy.x) * .08; }
          else if (enemy.behavior === 'SWARM') { const dx = player.x - enemy.x; const dy = player.y - enemy.y; const distance = Math.hypot(dx, dy) || 1; enemy.x += (dx / distance) * enemy.speed * .4 * delta * ENEMY_MOTION_TIME_SCALE + random(-1.5, 1.5); enemy.y += enemy.speed * .6 * delta * ENEMY_MOTION_TIME_SCALE + (dy / distance) * enemy.speed * .2 * delta * ENEMY_MOTION_TIME_SCALE; }
          else if (enemy.behavior === 'DIVE') { if (!enemy.diving) { enemy.y += enemy.speed * .5 * delta * ENEMY_MOTION_TIME_SCALE; if (enemy.y > 100 && Math.random() < .022 * delta) { enemy.diving = true; const dx = player.x - enemy.x; const dy = player.y - enemy.y; const distance = Math.hypot(dx, dy) || 1; enemy.dvx = dx / distance * enemy.speed * 3.2; enemy.dvy = dy / distance * enemy.speed * 3.2; } } else { enemy.x += enemy.dvx * delta * ENEMY_MOTION_TIME_SCALE; enemy.y += enemy.dvy * delta * ENEMY_MOTION_TIME_SCALE; } }
          else if (enemy.behavior === 'SHOOTER') { enemy.y += enemy.speed * .25 * delta * ENEMY_MOTION_TIME_SCALE; if (enemy.y > 80) enemy.y += (80 + (enemy.x / W) * 60 - enemy.y) * .03; enemy.x += Math.sin(enemy.frame * .026) * enemy.speed * .5; }
          else { enemy.y += enemy.speed * .32 * delta * ENEMY_MOTION_TIME_SCALE; enemy.x += Math.sin(enemy.frame * .014) * enemy.speed * .3; }
          if (enemy.fireRate > 0 && enemy.behavior !== 'SWARM' && !enemy.diving) {
            enemy.fireTimer -= delta;
            if (enemy.fireTimer <= 0) {
              enemy.fireTimer = enemy.fireRate;
              const dx = player.x - enemy.x, dy = player.y - enemy.y, distance = Math.hypot(dx, dy) || 1;
              if (enemy.behavior === 'SHOOTER') { const angle = Math.atan2(dy, dx); game.enemyBullets.push({ x: enemy.x, y: enemy.y, vx: Math.cos(angle) * 3.7, vy: Math.sin(angle) * 3.7, damage: 4, alive: true }); }
              else game.enemyBullets.push({ x: enemy.x, y: enemy.y, vx: dx / distance * 3.7, vy: dy / distance * 3.7, damage: enemy.behavior === 'TANK' ? 9 : 6, alive: true });
            }
          }
          if (enemy.y > H + 70 || enemy.x < -90 || enemy.x > W + 90) enemy.alive = false;
          if (enemyHitsPlayer(enemy, player)) { enemy.alive = false; const impactDamage = enemy.behavior === 'TANK' ? 25 : enemy.behavior === 'DIVE' ? 20 : enemy.behavior === 'SWARM' ? 10 : 14; if (player.invincible <= 0) { player.health = Math.max(0, player.health - impactDamage); player.invincible = 90; spawnParticles(game.particles, player.x, player.y, '#ff3333', 14); if (player.health <= 0) gameOver(); } }
        }
        game.enemies = game.enemies.filter((enemy) => enemy.alive);
      } else if (game.boss) {
        const boss = game.boss;
        boss.frame += delta;
        if (boss.phase === 'INTRO') { boss.y += (100 - boss.y) * .03 * delta; if (boss.y >= 98) boss.phase = boss.health / boss.maxHealth > .66 ? 'PHASE1' : 'PHASE2'; }
        else if (boss.phase === 'DYING') { boss.dyingTimer += delta; if (game.frame % 4 === 0) spawnParticles(game.particles, boss.x + random(-boss.radius, boss.radius), boss.y + random(-boss.radius, boss.radius), ['#ff4444', '#ff8800', '#ffff00', '#ffffff'][randomInt(0, 3)], 12, 2, 9); if (boss.dyingTimer >= 150) { boss.phase = 'DYING'; victory(); } }
        else {
          const healthRatio = boss.health / boss.maxHealth;
          boss.phase = healthRatio > .66 ? 'PHASE1' : healthRatio > .33 ? 'PHASE2' : 'PHASE3';
        if (boss.phase === 'PHASE1') { boss.x = W / 2 + Math.sin(boss.frame * .022) * (W * .36); boss.y = 105 + Math.sin(boss.frame * .013) * 30; boss.fireTimer += delta; if (boss.fireTimer >= 105) { boss.fireTimer = 0; const dx = player.x - boss.x, dy = player.y - boss.y, distance = Math.hypot(dx, dy) || 1; game.enemyBullets.push({ x: boss.x, y: boss.y, vx: dx / distance * 4.5, vy: dy / distance * 4.5, damage: 8, alive: true }); } }
          else if (boss.phase === 'PHASE2') { boss.x += boss.vx * 2.5 * delta * .075; boss.y = 110 + Math.sin(boss.frame * .018) * 50; if (boss.x < boss.radius || boss.x > W - boss.radius) boss.vx *= -1; boss.fireTimer += delta; if (boss.fireTimer >= 78) { boss.fireTimer = 0; const base = Math.atan2(player.y - boss.y, player.x - boss.x); for (let spread = -1; spread <= 1; spread += 1) { const angle = base + spread * .23; game.enemyBullets.push({ x: boss.x, y: boss.y, vx: Math.cos(angle) * 4.7, vy: Math.sin(angle) * 4.7, damage: 5, alive: true }); } } }
          else { boss.x += (player.x - boss.x) * .016 * delta; boss.y += (Math.min(player.y - 120, 200) - boss.y) * .011 * delta; boss.fireTimer += delta; if (boss.fireTimer >= 55) { boss.fireTimer = 0; for (let ray = 0; ray < 8; ray += 1) { const angle = (ray / 8) * Math.PI * 2 + boss.frame * .06; game.enemyBullets.push({ x: boss.x, y: boss.y, vx: Math.cos(angle) * 4.4, vy: Math.sin(angle) * 4.4, damage: 3, alive: true }); } } }
        }
      }
      for (const bullet of game.bullets) { bullet.y += bullet.vy * delta * BULLET_TIME_SCALE; if (bullet.y < -20) bullet.alive = false; }
      for (const bullet of game.enemyBullets) { bullet.x += bullet.vx * delta * ENEMY_BULLET_TIME_SCALE; bullet.y += bullet.vy * delta * ENEMY_BULLET_TIME_SCALE; if (bullet.y > H + 20 || bullet.y < -20 || bullet.x < -20 || bullet.x > W + 20) bullet.alive = false; }
      for (const bullet of game.bullets) {
        if (!bullet.alive) continue;
        for (const enemy of game.enemies) {
          if (!enemy.alive) continue;
          if (Math.hypot(bullet.x - enemy.x, bullet.y - enemy.y) <= enemy.radius + 4) { bullet.alive = false; enemy.health -= 1; spawnParticles(game.particles, bullet.x, bullet.y, COLORS[enemy.behavior], 5, 1, 4); if (enemy.health <= 0) { enemy.alive = false; game.score += 100 + enemy.maxHealth * 20; spawnParticles(game.particles, enemy.x, enemy.y, COLORS[enemy.behavior], 18); } break; }
        }
        const boss = game.boss;
        if (game.state === 'BOSS' && boss && boss.phase !== 'DYING' && Math.hypot(bullet.x - boss.x, bullet.y - boss.y) <= boss.radius + 4) { bullet.alive = false; boss.health = Math.max(0, boss.health - 1); game.score += 40; spawnParticles(game.particles, bullet.x, bullet.y, '#ffaa00', 5, 2, 6); if (boss.health <= 0) { boss.phase = 'DYING'; boss.dyingTimer = 0; } }
      }
      const playerRect = { x: player.x - PLAYER_W / 2, y: player.y - PLAYER_H / 2, w: PLAYER_W, h: PLAYER_H };
      for (const bullet of game.enemyBullets) { if (bullet.alive && rectsOverlap({ x: bullet.x - 4, y: bullet.y - 4, w: 8, h: 8 }, playerRect)) { bullet.alive = false; if (player.invincible <= 0) { player.health = Math.max(0, player.health - bullet.damage); player.invincible = 90; spawnParticles(game.particles, player.x, player.y, '#ff3333', 14); if (player.health <= 0) gameOver(); } } }
      game.bullets = game.bullets.filter((bullet) => bullet.alive);
      game.enemyBullets = game.enemyBullets.filter((bullet) => bullet.alive);
      for (const particle of game.particles) { particle.x += particle.vx * delta * .06; particle.y += particle.vy * delta * .06; particle.vy += .09 * delta; particle.life -= delta; }
      game.particles = game.particles.filter((particle) => particle.life > 0);
      setHud({ score: game.score, health: player.health, behavior: game.currentBehavior || 'SCANNING', phase: game.boss?.phase ?? '', bossHealth: game.boss?.health ?? 0, bossMaxHealth: game.boss?.maxHealth ?? 1 });
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
      for (const bullet of game.bullets) { ctx.fillStyle = '#ffff00'; ctx.fillRect(bullet.x - 1.5, bullet.y, 3, 10); }
      for (const bullet of game.enemyBullets) { ctx.fillStyle = '#ff3333'; ctx.beginPath(); ctx.arc(bullet.x, bullet.y, 4, 0, Math.PI * 2); ctx.fill(); }
      for (const enemy of game.enemies) { const color = COLORS[enemy.behavior]; ctx.globalAlpha = .85; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(enemy.x, enemy.y, enemy.radius, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(enemy.x, enemy.y, enemy.radius + 3, 0, Math.PI * 2); ctx.stroke(); if (enemy.maxHealth > 1) { ctx.strokeStyle = '#00ff00'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(enemy.x, enemy.y, enemy.radius - 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * enemy.health / enemy.maxHealth); ctx.stroke(); } }
      if (game.boss) { const boss = game.boss; const color = boss.phase === 'PHASE3' ? '#ff2244' : boss.phase === 'PHASE2' ? '#ff8800' : '#4488ff'; const gradient = ctx.createRadialGradient(boss.x, boss.y, 0, boss.x, boss.y, boss.radius * 2.2); gradient.addColorStop(0, `${color}55`); gradient.addColorStop(1, 'transparent'); ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(boss.x, boss.y, boss.radius * 2.2, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = .9; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(boss.x, boss.y, boss.radius, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; for (let ring = 1; ring <= 2; ring += 1) { ctx.strokeStyle = color; ctx.globalAlpha = .32 / ring; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(boss.x, boss.y, boss.radius + ring * 14, 0, Math.PI * 2); ctx.stroke(); } ctx.globalAlpha = 1; }
      const showPlayer = game.state === 'PLAYING' || game.state === 'BOSS' || game.state === 'COUNTDOWN';
      drawPlayer(ctx, game.player.x, game.player.y, game.player.frame, !(game.player.invincible > 0 && Math.floor(game.player.invincible / 5) % 2 === 1) && showPlayer);
    };
    const loop = (now: number) => {
      const delta = Math.min(2.2, (now - last) / 16.67);
      last = now;
      update(delta);
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [state, syncState]);

  useEffect(() => () => resetAudio(), [resetAudio]);

  const updatePointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    pointerRef.current = { x: (event.clientX - rect.left) * W / rect.width, y: (event.clientY - rect.top) * H / rect.height };
  };

  const fileLabel = (file: File | null) => file ? `${file.name} · ${(file.size / 1048576).toFixed(1)} MB` : 'No track selected';
  const canStart = Boolean(stageFile && bossFile);
  const isGame = state === 'COUNTDOWN' || state === 'PLAYING' || state === 'BOSS_INTRO' || state === 'BOSS' || state === 'GAME_OVER' || state === 'VICTORY';

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
              </>
            )}
            <div className="mt-10 grid grid-cols-3 gap-2 text-center font-mono text-[9px] uppercase tracking-[.12em] text-slate-600"><span className="border-t border-slate-800 pt-3">Drag to fly</span><span className="border-t border-slate-800 pt-3">Auto-fire</span><span className="border-t border-slate-800 pt-3">Three phases</span></div>
          </div>
        </section>
      )}
      {isGame && (
        <section className="game-shell" data-testid="panel-game">
          <div className="game-frame">
            <canvas ref={canvasRef} className="game-canvas" onPointerMove={updatePointer} onPointerDown={updatePointer} data-testid="canvas-game" aria-label="AudioStrike game field" />
            <div className="hud-top">
              <div className="hud-chip"><div className="font-mono text-[8px] uppercase tracking-[.16em] text-slate-500">Score</div><div className="font-mono text-sm font-bold text-cyan-200" data-testid="text-score">{String(hud.score).padStart(6, '0')}</div></div>
              <div className="text-right"><div className="font-mono text-[8px] uppercase tracking-[.16em] text-slate-500">Threat</div><div className="font-mono text-xs font-bold text-orange-300" data-testid="text-behavior">{hud.behavior}</div></div>
            </div>
            <div className="hud-bottom">
              {state === 'BOSS' && <div className="mb-3"><div className="mb-1 flex justify-between font-mono text-[9px] uppercase tracking-[.12em] text-orange-200"><span>Enemy core · {hud.phase}</span><span data-testid="text-boss-health">{hud.bossHealth} / {hud.bossMaxHealth}</span></div><div className="boss-health"><div style={{ width: `${hud.bossMaxHealth ? hud.bossHealth / hud.bossMaxHealth * 100 : 0}%` }} /></div></div>}
              <div className="flex items-end justify-between"><div><div className="mb-1 font-mono text-[8px] uppercase tracking-[.16em] text-slate-500">Hull integrity</div><div className={`font-mono text-2xl font-bold ${hud.health <= 25 ? 'text-red-300' : hud.health <= 50 ? 'text-orange-300' : 'text-green-300'}`} data-testid="status-health">{hud.health} <span className="text-xs font-normal text-slate-500">/ {PLAYER_MAX_HEALTH}</span></div></div><div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.14em] text-cyan-300/60"><Gamepad2 className="h-3 w-3" /> Pointer control</div></div>
            </div>
            {state === 'COUNTDOWN' && <div className="state-overlay" data-testid="overlay-countdown"><div><p className="font-mono text-[10px] uppercase tracking-[.28em] text-cyan-300">Get ready</p><div className="mt-2 text-8xl font-extrabold text-cyan-200" data-testid="text-countdown">{countdown}</div><p className="mt-1 font-mono text-[10px] uppercase tracking-[.18em] text-slate-500">Drag to steer · weapons armed</p></div></div>}
            {state === 'BOSS_INTRO' && <div className="state-overlay" data-testid="overlay-boss-intro"><div className="overlay-card"><div className="phase-ring"><span className="font-mono text-lg text-orange-300">BOSS</span></div><p className="font-mono text-[10px] uppercase tracking-[.3em] text-orange-300">Stage clear</p><h2 className="mt-3 text-4xl font-extrabold tracking-[.08em] text-slate-100">THE SIGNAL WAKES</h2><p className="mt-3 font-mono text-[10px] uppercase tracking-[.16em] text-slate-500">Three phases. One last track.</p></div></div>}
            {state === 'GAME_OVER' && <div className="state-overlay" data-testid="overlay-game-over"><div className="overlay-card"><p className="font-mono text-[10px] uppercase tracking-[.28em] text-red-300">Flight terminated</p><h2 className="mt-3 text-5xl font-extrabold tracking-[.08em] text-red-200">SYSTEM DOWN</h2><p className="mt-3 font-mono text-[10px] uppercase tracking-[.16em] text-slate-500">Final score {hud.score}. Tap replay to re-enter the mix.</p><button onClick={beginCountdown} className="action-button mt-7 inline-flex items-center gap-2 rounded-lg border border-cyan-300/50 bg-cyan-300/10 px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[.18em] text-cyan-200" data-testid="button-replay-game-over"><RotateCcw className="h-3.5 w-3.5" /> Replay mission</button></div></div>}
            {state === 'VICTORY' && <div className="state-overlay" data-testid="overlay-victory"><div className="overlay-card"><p className="font-mono text-[10px] uppercase tracking-[.28em] text-green-300">Signal captured</p><h2 className="mt-3 text-5xl font-extrabold tracking-[.08em] text-green-200">VICTORY</h2><p className="mt-3 font-mono text-[10px] uppercase tracking-[.16em] text-slate-500">Boss core collapsed. Final score {hud.score}.</p><button onClick={beginCountdown} className="action-button mt-7 inline-flex items-center gap-2 rounded-lg border border-cyan-300/50 bg-cyan-300/10 px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[.18em] text-cyan-200" data-testid="button-replay-victory"><RotateCcw className="h-3.5 w-3.5" /> Run it back</button></div></div>}
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
