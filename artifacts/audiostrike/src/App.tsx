import { useCallback, useEffect, useRef, useState } from 'react';
import { Crosshair, FileAudio, Gamepad2, Headphones, RotateCcw, Shield, Volume2, Zap } from 'lucide-react';

type GameState = 'UPLOAD' | 'ANALYZING' | 'COUNTDOWN' | 'PLAYING' | 'STAGE_EXIT' | 'BOSS_INTRO' | 'BOSS' | 'GAME_OVER' | 'VICTORY';
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
};
type EnemyShape = 'CIRCLE' | 'DIAMOND' | 'TRIANGLE' | 'HEX' | 'RING';
type ProjectileKind = 'ORB' | 'BOLT' | 'SHARD' | 'RING';
type BossFirePattern = 'TRACK' | 'BURST' | 'RADIAL';
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
};
type BulletEntity = { x: number; y: number; vy: number; alive: boolean };
type EnemyBulletEntity = { x: number; y: number; vx: number; vy: number; damage: number; alive: boolean; kind?: ProjectileKind; radius?: number; spin?: number };
type ParticleEntity = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string };
type BossEntity = { x: number; y: number; radius: number; health: number; maxHealth: number; shape: EnemyShape; projectile: ProjectileKind; pattern: BossFirePattern; phase: 'INTRO' | 'PHASE1' | 'PHASE2' | 'PHASE3' | 'DYING'; frame: number; vx: number; fireTimer: number; dyingTimer: number };

const W = 800;
const H = 600;
const PLAYER_MAX_HEALTH = 100;
const PLAYER_BULLET_SPEED = 48;
const PLAYER_FIRE_INTERVAL = 8;
const BULLET_TIME_SCALE = 0.22;
const ENEMY_MOTION_TIME_SCALE = 0.18;
const ENEMY_BULLET_TIME_SCALE = 0.19;
const STAGE_LEVEL_SECONDS = 60;
const SPAWN_COOLDOWN_MULTIPLIER = 1.7;
const PLAYER_MAX_SPEED = 5.5;
const PLAYER_ACCELERATION = .32;
const PLAYER_DECELERATION = .45;
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

const blankLiveFeatures = (): LiveFeatures => ({ rms: 0, onset: 0, low: 0, mid: 0, high: 0, centroid: 0, flatness: 0, pulse: false });

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
  const pulse = track.lastTime >= 0 && onset > .38 && now - track.lastPulseAt > .2;
  if (pulse) track.lastPulseAt = now;
  track.lastTime = now;
  track.lastFeatures = { rms, onset, low, mid, high, centroid, flatness, pulse };
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
  const variation = (Math.sin(serial * 2.31 + features.centroid * 9) + 1) / 2;
  if (features.low > .72 && variation > .28) return 'HEX';
  if (features.high > .64 && features.centroid > .48) return 'TRIANGLE';
  if (features.flatness < .28 && features.mid > .3) return 'DIAMOND';
  if (variation > .78) return 'RING';
  return 'CIRCLE';
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

function chooseBossFirePattern(features: LiveFeatures, serial: number): BossFirePattern {
  const variation = (Math.sin(serial * .071 + features.centroid * 8) + 1) / 2;
  const burstSignal = features.high * .52 + features.onset * .32 + features.mid * .12 + variation * .16 + (features.pulse ? .12 : 0);
  const radialSignal = features.low * .55 + features.rms * .25 + (1 - features.centroid) * .12 + variation * .16;
  if (burstSignal > .7 && features.high > .34) return 'BURST';
  if (radialSignal > .68 && features.low > .34) return 'RADIAL';
  return 'TRACK';
}

function createEnemyProjectile(x: number, y: number, vx: number, vy: number, damage: number, kind: ProjectileKind): EnemyBulletEntity {
  const speedScale: Record<ProjectileKind, number> = { ORB: 1, BOLT: 1.12, SHARD: 1.28, RING: .78 };
  const radius: Record<ProjectileKind, number> = { ORB: 4, BOLT: 3, SHARD: 4, RING: 6 };
  return { x, y, vx: vx * speedScale[kind], vy: vy * speedScale[kind], damage, alive: true, kind, radius: radius[kind], spin: Math.atan2(vy, vx) };
}

function drawShape(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, shape: EnemyShape, color: string) {
  ctx.fillStyle = color;
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
  ctx.fill();
  if (shape === 'RING') {
    ctx.globalAlpha = .72;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, radius * .16);
    ctx.beginPath();
    ctx.arc(x, y, radius * .58, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawEnemyProjectile(ctx: CanvasRenderingContext2D, bullet: EnemyBulletEntity) {
  const kind = bullet.kind ?? 'ORB';
  const radius = bullet.radius ?? 4;
  const color = kind === 'SHARD' ? '#ffcc33' : kind === 'BOLT' ? '#ff5577' : kind === 'RING' ? '#ff8844' : '#ff3333';
  ctx.save();
  ctx.translate(bullet.x, bullet.y);
  ctx.rotate((bullet.spin ?? 0) + performance.now() * .002);
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
  const gameRef = useRef({ state: 'UPLOAD' as GameState, stageFeatures: null as FeatureSet | null, bossFeatures: null as FeatureSet | null, audioContext: null as AudioContext | null, stageReactive: null as AudioReactiveTrack | null, bossReactive: null as AudioReactiveTrack | null, player: { x: W / 2, y: H / 2, vx: 0, vy: 0, health: PLAYER_MAX_HEALTH, invincible: 0, fireTimer: 0, frame: 0 }, enemies: [] as EnemyEntity[], bullets: [] as BulletEntity[], enemyBullets: [] as EnemyBulletEntity[], particles: [] as ParticleEntity[], boss: null as BossEntity | null, score: 0, frame: 0, songStart: 0, bossStart: 0, beatIndex: 0, spawnIndex: 0, spawnCooldown: 0, stageDone: false, stageExitTimer: 0, introTimer: 0, countdown: 3, countdownTimer: 0, victoryTimer: 0, currentBehavior: '' });
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
      beginCountdown();
    }
  }, [bossFile, resetAudio, stageFile, syncState]);

  const beginCountdown = useCallback(() => {
    const game = gameRef.current;
    game.player = { x: W / 2, y: H / 2, vx: 0, vy: 0, health: PLAYER_MAX_HEALTH, invincible: 0, fireTimer: 0, frame: 0 };
    game.enemies = []; game.bullets = []; game.enemyBullets = []; game.particles = []; game.boss = null;
      game.score = 0; game.frame = 0; game.beatIndex = 0; game.spawnIndex = 0; game.spawnCooldown = 0; game.stageDone = false; game.stageExitTimer = 0; game.introTimer = 0;
    resetReactiveTrack(game.stageReactive);
    resetReactiveTrack(game.bossReactive);
    game.countdown = 3; game.countdownTimer = 58; game.currentBehavior = 'SCANNING';
    joystickRef.current = neutralJoystick();
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
      const stars = Array.from({ length: 180 }, (_, index) => ({ x: random(0, W), y: random(0, H), size: 1, brightness: random(.28, .9), speed: .55 + (index % 4) * .22 }));
    let raf = 0;
    let last = performance.now();
    const getGameTime = () => {
      const game = gameRef.current;
      const audio = game.state === 'BOSS' ? bossAudioRef.current : stageAudioRef.current;
      if (game.state === 'BOSS' && audio && Number.isFinite(audio.currentTime) && audio.currentTime > 0) return audio.currentTime;
      return game.state === 'BOSS' ? (performance.now() - game.bossStart) / 1000 : (performance.now() - game.songStart) / 1000;
    };
    const rectsOverlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
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
        void game.audioContext?.resume();
        void stageAudioRef.current.play().catch(() => undefined);
      }
      game.songStart = performance.now();
    };
    const beginBossIntro = () => {
      const game = gameRef.current;
      joystickRef.current = neutralJoystick();
      game.player.vx = 0; game.player.vy = 0;
      game.state = 'BOSS_INTRO'; game.introTimer = 180; game.enemies = []; game.enemyBullets = [];
      stageAudioRef.current?.pause();
      if (bossAudioRef.current) {
        bossAudioRef.current.currentTime = 0;
        bossAudioRef.current.volume = 0;
        void game.audioContext?.resume();
        void bossAudioRef.current.play().catch(() => undefined);
      }
      syncState('BOSS_INTRO');
    };
    const beginBoss = () => {
      const game = gameRef.current;
      const features = game.bossFeatures ?? { duration: 28 };
      const hp = Math.max(165, Math.round(180 + Math.min(55, features.duration)));
      game.player.x = W / 2;
      game.player.y = H / 2;
      game.player.vx = 0; game.player.vy = 0;
      joystickRef.current = neutralJoystick();
      game.player.invincible = 0;
      game.boss = { x: W / 2, y: -70, radius: 55, health: hp, maxHealth: hp, shape: 'RING', projectile: 'ORB', pattern: 'TRACK', phase: 'INTRO', frame: 0, vx: 1.8, fireTimer: 0, dyingTimer: 0 };
      game.bullets = []; game.enemyBullets = []; game.beatIndex = 0;
      game.state = 'BOSS'; game.bossStart = performance.now();
      resetReactiveTrack(game.bossReactive);
      if (bossAudioRef.current) bossAudioRef.current.volume = .72;
      void game.audioContext?.resume();
      syncState('BOSS');
    };
    const gameOver = () => {
      joystickRef.current = neutralJoystick();
      stageAudioRef.current?.pause(); bossAudioRef.current?.pause();
      syncState('GAME_OVER');
    };
    const victory = () => {
      joystickRef.current = neutralJoystick();
      bossAudioRef.current?.pause();
      gameRef.current.victoryTimer = 360;
      syncState('VICTORY');
    };
    const update = (delta: number) => {
      const game = gameRef.current;
      game.frame += 1;
      const backgroundScrolling = game.state === 'COUNTDOWN' || game.state === 'PLAYING' || game.state === 'BOSS' || game.state === 'VICTORY';
      if (backgroundScrolling) {
        for (const star of stars) { star.y += star.speed * delta * .35; if (star.y > H) { star.y = 0; star.x = random(0, W); } }
      }
      if (game.state === 'COUNTDOWN') {
        game.countdownTimer -= delta;
        if (game.countdownTimer <= 0) {
          game.countdown -= 1;
          if (game.countdown <= 0) beginPlaying();
          else { game.countdownTimer = 58; setCountdown(game.countdown); }
        }
        return;
      }
      if (game.state === 'STAGE_EXIT') {
        game.stageExitTimer += delta;
        game.player.y += 8 * delta;
        for (const enemy of game.enemies) enemy.y += (12 + enemy.speed * 2.2) * delta;
        game.enemies = game.enemies.filter((enemy) => enemy.y < H + enemy.radius + 24);
        if (game.stageExitTimer >= 42 && game.player.y > H + 24) beginBossIntro();
        return;
      }
      if (game.state === 'BOSS_INTRO') {
        game.introTimer -= delta;
        const introProgress = clamp(1 - game.introTimer / 180, 0, 1);
        if (stageAudioRef.current) stageAudioRef.current.volume = .72 * clamp(1 - introProgress * 1.35, 0, 1);
        if (bossAudioRef.current) bossAudioRef.current.volume = .72 * clamp((introProgress - .12) / .72, 0, 1);
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
      const joystick = joystickRef.current;
      const targetVx = joystick.dx * PLAYER_MAX_SPEED;
      const targetVy = joystick.dy * PLAYER_MAX_SPEED;
      const changeX = targetVx - player.vx;
      const changeY = targetVy - player.vy;
      const distance = Math.hypot(changeX, changeY);
      const velocityStep = (joystick.pointerId === null ? PLAYER_DECELERATION : PLAYER_ACCELERATION) * delta;
      if (distance <= velocityStep) {
        player.vx = targetVx; player.vy = targetVy;
      } else {
        player.vx += changeX / distance * velocityStep;
        player.vy += changeY / distance * velocityStep;
      }
      player.x = clamp(player.x + player.vx * delta, 22, W - 22);
      player.y = clamp(player.y + player.vy * delta, 28, H - 28);
      if ((player.x === 22 && player.vx < 0) || (player.x === W - 22 && player.vx > 0)) player.vx = 0;
      if ((player.y === 28 && player.vy < 0) || (player.y === H - 28 && player.vy > 0)) player.vy = 0;
      player.frame += 1;
      player.invincible = Math.max(0, player.invincible - delta);
      player.fireTimer -= delta;
      if (player.fireTimer <= 0) {
        const gunY = player.y - 18;
        game.bullets.push(
          { x: player.x - 13, y: gunY, vy: -PLAYER_BULLET_SPEED, alive: true },
          { x: player.x - 7, y: gunY, vy: -PLAYER_BULLET_SPEED, alive: true },
          { x: player.x + 7, y: gunY, vy: -PLAYER_BULLET_SPEED, alive: true },
          { x: player.x + 13, y: gunY, vy: -PLAYER_BULLET_SPEED, alive: true },
        );
        player.fireTimer = PLAYER_FIRE_INTERVAL;
      }
      if (game.state === 'PLAYING') {
        const live = readReactiveTrack(game.stageReactive);
        const songTime = getGameTime();
        game.spawnCooldown -= delta;
        game.currentBehavior = chooseBehavior(live);
        if (live.pulse && game.spawnCooldown <= 0 && game.enemies.length < 20) {
          const behavior = chooseBehavior(live);
          const intensity = clamp(live.rms * .65 + live.onset * .35, .12, 1);
          const count = Math.min(5, 1 + Math.floor(intensity * 3) + (live.onset > .8 ? 1 : 0));
          const spawnSerial = game.spawnIndex;
          game.spawnIndex += 1;
          for (let enemyIndex = 0; enemyIndex < count && game.enemies.length < 20; enemyIndex += 1) {
            const variation = (Math.sin((spawnSerial + enemyIndex) * 2.17 + live.centroid * 8) + 1) / 2;
            const radius = clamp(9 + live.low * 22 + variation * 13 + live.high * 5, 9, 48);
            const x = behavior === 'FORMATION' ? (W / (count + 1)) * (enemyIndex + 1) : random(radius + 18, W - radius - 18);
            const health = 1 + Math.round(live.low * 5);
            const shape = chooseEnemyShape(live, spawnSerial + enemyIndex);
            const projectile = chooseProjectile(live, behavior);
            game.enemies.push({ x, y: -radius - 12, radius, health, maxHealth: health, speed: 2.4 + live.high * 6.2, behavior, fireRate: live.mid > .4 ? Math.round(150 - live.mid * 55) : 0, fireTimer: randomInt(24, 120), frame: 0, zigDir: Math.random() > .5 ? 1 : -1, formX: x, formY: -radius - 12, diving: false, dvx: 0, dvy: 0, shape, projectile, exiting: false, alive: true });
          }
          game.spawnCooldown = clamp((58 - intensity * 22 - live.high * 5) * SPAWN_COOLDOWN_MULTIPLIER, 48, 100);
        }
        if (!game.stageDone && songTime >= STAGE_LEVEL_SECONDS) {
          game.stageDone = true;
          game.stageExitTimer = 0;
          for (const enemy of game.enemies) enemy.exiting = true;
          game.enemyBullets = [];
          stageAudioRef.current?.pause();
          joystickRef.current = neutralJoystick();
          player.vx = 0; player.vy = 0;
          game.state = 'STAGE_EXIT';
          syncState('STAGE_EXIT');
          return;
        }
        for (const enemy of game.enemies) {
          enemy.frame += delta;
           if (enemy.exiting) { enemy.fireRate = 0; enemy.y += (12 + enemy.speed * 2.2) * delta; }
           else if (enemy.behavior === 'PATROL') { enemy.y += enemy.speed * delta * ENEMY_MOTION_TIME_SCALE; enemy.x += Math.sin(enemy.frame * .03) * .6; }
          else if (enemy.behavior === 'ZIGZAG') { enemy.y += enemy.speed * .65 * delta * ENEMY_MOTION_TIME_SCALE; enemy.x += enemy.zigDir * enemy.speed * 1.6 * delta * ENEMY_MOTION_TIME_SCALE; if (enemy.x < enemy.radius || enemy.x > W - enemy.radius) enemy.zigDir *= -1; }
          else if (enemy.behavior === 'FORMATION') { enemy.formY += enemy.speed * .4 * delta * ENEMY_MOTION_TIME_SCALE; enemy.y += (enemy.formY - enemy.y) * .08; enemy.x += (enemy.formX + Math.sin(enemy.frame * .022) * 15 - enemy.x) * .08; }
          else if (enemy.behavior === 'SWARM') { const dx = player.x - enemy.x; const dy = player.y - enemy.y; const distance = Math.hypot(dx, dy) || 1; enemy.x += (dx / distance) * enemy.speed * .4 * delta * ENEMY_MOTION_TIME_SCALE + random(-1.5, 1.5); enemy.y += enemy.speed * .6 * delta * ENEMY_MOTION_TIME_SCALE + (dy / distance) * enemy.speed * .2 * delta * ENEMY_MOTION_TIME_SCALE; }
          else if (enemy.behavior === 'DIVE') { if (!enemy.diving) { enemy.y += enemy.speed * .5 * delta * ENEMY_MOTION_TIME_SCALE; if (enemy.y > 100 && Math.random() < .022 * delta) { enemy.diving = true; const dx = player.x - enemy.x; const dy = player.y - enemy.y; const distance = Math.hypot(dx, dy) || 1; enemy.dvx = dx / distance * enemy.speed * 3.2; enemy.dvy = dy / distance * enemy.speed * 3.2; } } else { enemy.x += enemy.dvx * delta * ENEMY_MOTION_TIME_SCALE; enemy.y += enemy.dvy * delta * ENEMY_MOTION_TIME_SCALE; } }
          else if (enemy.behavior === 'SHOOTER') { enemy.y += enemy.speed * .25 * delta * ENEMY_MOTION_TIME_SCALE; if (enemy.y > 80) enemy.y += (80 + (enemy.x / W) * 60 - enemy.y) * .03; enemy.x += Math.sin(enemy.frame * .026) * enemy.speed * .5; }
          else { enemy.y += enemy.speed * .32 * delta * ENEMY_MOTION_TIME_SCALE; enemy.x += Math.sin(enemy.frame * .014) * enemy.speed * .3; }
           if (!enemy.exiting && enemy.fireRate > 0 && enemy.behavior !== 'SWARM' && !enemy.diving) {
            enemy.fireTimer -= delta;
            if (enemy.fireTimer <= 0) {
              enemy.fireTimer = enemy.fireRate;
              const dx = player.x - enemy.x, dy = player.y - enemy.y, distance = Math.hypot(dx, dy) || 1;
                if (enemy.behavior === 'SHOOTER') { const angle = Math.atan2(dy, dx); game.enemyBullets.push(createEnemyProjectile(enemy.x, enemy.y, Math.cos(angle) * 7.4, Math.sin(angle) * 7.4, 4, enemy.projectile)); }
                else game.enemyBullets.push(createEnemyProjectile(enemy.x, enemy.y, dx / distance * 7.4, dy / distance * 7.4, enemy.behavior === 'TANK' ? 9 : 6, enemy.projectile));
            }
          }
          if (enemy.y > H + 70 || enemy.x < -90 || enemy.x > W + 90) enemy.alive = false;
            const enemyOnScreen = enemy.y + enemy.radius >= 0 && enemy.y - enemy.radius <= H;
            if (!enemy.exiting && enemyOnScreen && enemyHitsPlayer(enemy, player)) { enemy.alive = false; const impactDamage = enemy.behavior === 'TANK' ? 25 : enemy.behavior === 'DIVE' ? 20 : enemy.behavior === 'SWARM' ? 10 : 14; if (player.invincible <= 0) { player.health = Math.max(0, player.health - impactDamage); player.invincible = 90; spawnParticles(game.particles, player.x, player.y, '#ff3333', 14); if (player.health <= 0) gameOver(); } }
        }
        game.enemies = game.enemies.filter((enemy) => enemy.alive);
      } else if (game.boss) {
        const boss = game.boss;
        boss.frame += delta;
        if (boss.phase === 'INTRO') { boss.y += (100 - boss.y) * .03 * delta; if (boss.y >= 98) boss.phase = boss.health / boss.maxHealth > .66 ? 'PHASE1' : 'PHASE2'; }
        else if (boss.phase === 'DYING') { boss.dyingTimer += delta; if (game.frame % 4 === 0) spawnParticles(game.particles, boss.x + random(-boss.radius, boss.radius), boss.y + random(-boss.radius, boss.radius), ['#ff4444', '#ff8800', '#ffff00', '#ffffff'][randomInt(0, 3)], 12, 2, 9); if (boss.dyingTimer >= 150) { boss.phase = 'DYING'; victory(); } }
        else {
          const live = readReactiveTrack(game.bossReactive);
          const healthRatio = boss.health / boss.maxHealth;
          boss.phase = healthRatio > .66 ? 'PHASE1' : healthRatio > .33 ? 'PHASE2' : 'PHASE3';
          boss.shape = chooseBossShape(live);
          boss.projectile = chooseProjectile(live, 'BOSS');
          boss.pattern = chooseBossFirePattern(live, boss.frame);
          game.currentBehavior = live.pulse ? 'BOSS PULSE' : 'BOSS TRACKING';
          boss.fireTimer -= delta;
          if (live.pulse && live.high > .5) boss.vx *= -1;
          if (boss.phase === 'PHASE1') {
            boss.x += boss.vx * (1.2 + live.high * 3.6) * delta;
            boss.y = 105 + Math.sin(boss.frame * (.012 + live.mid * .02)) * (18 + live.low * 42);
            if (boss.x < boss.radius || boss.x > W - boss.radius) boss.vx *= -1;
          } else if (boss.phase === 'PHASE2') {
            boss.x += boss.vx * (2 + live.high * 5) * delta;
            boss.y = 110 + Math.sin(boss.frame * (.015 + live.mid * .025)) * (25 + live.low * 55);
            if (boss.x < boss.radius || boss.x > W - boss.radius) boss.vx *= -1;
          } else {
            boss.x += (player.x - boss.x) * (.012 + live.mid * .012) * delta;
            boss.y += (Math.min(player.y - 120, 200) - boss.y) * (.008 + live.low * .012) * delta;
          }
          const fireThreshold = boss.phase === 'PHASE1' ? .72 : boss.phase === 'PHASE2' ? .68 : .62;
          if (boss.fireTimer <= 0 && (live.pulse || live.rms > fireThreshold)) {
            if (boss.pattern === 'TRACK') {
              boss.fireTimer = clamp(54 - live.onset * 16 - live.mid * 8, 24, 54);
              const dx = player.x - boss.x, dy = player.y - boss.y, distance = Math.hypot(dx, dy) || 1;
              game.enemyBullets.push(createEnemyProjectile(boss.x, boss.y, dx / distance * 8, dy / distance * 8, 8, boss.projectile));
            } else if (boss.pattern === 'BURST') {
              boss.fireTimer = clamp(45 - live.onset * 13 - live.mid * 7, 20, 45);
              const base = Math.atan2(player.y - boss.y, player.x - boss.x);
              const spreadCount = live.high > .72 ? 5 : 3;
              for (let spread = 0; spread < spreadCount; spread += 1) {
                const angle = base + (spread - (spreadCount - 1) / 2) * (.16 + live.high * .08);
                game.enemyBullets.push(createEnemyProjectile(boss.x, boss.y, Math.cos(angle) * 8.4, Math.sin(angle) * 8.4, 5, boss.projectile));
              }
            } else {
              boss.fireTimer = clamp(36 - live.onset * 10 - live.low * 7, 16, 36);
              const rayCount = 8 + Math.round(live.high * 4);
              for (let ray = 0; ray < rayCount; ray += 1) {
                const angle = (ray / rayCount) * Math.PI * 2 + boss.frame * (.025 + live.high * .05);
                game.enemyBullets.push(createEnemyProjectile(boss.x, boss.y, Math.cos(angle) * (7.4 + live.low * 1.2), Math.sin(angle) * (7.4 + live.low * 1.2), 3, boss.projectile));
              }
            }
          }
        }
      }
      for (const bullet of game.bullets) { bullet.y += bullet.vy * delta * BULLET_TIME_SCALE; if (bullet.y < -20) bullet.alive = false; }
      for (const bullet of game.enemyBullets) { bullet.x += bullet.vx * delta * ENEMY_BULLET_TIME_SCALE; bullet.y += bullet.vy * delta * ENEMY_BULLET_TIME_SCALE; if (bullet.y > H + 20 || bullet.y < -20 || bullet.x < -20 || bullet.x > W + 20) bullet.alive = false; }
      for (const bullet of game.bullets) {
        if (!bullet.alive) continue;
        for (const enemyBullet of game.enemyBullets) {
          if (!enemyBullet.alive) continue;
           if (Math.hypot(bullet.x - enemyBullet.x, bullet.y - enemyBullet.y) <= (enemyBullet.radius ?? 4) + 5) {
            bullet.alive = false;
            enemyBullet.alive = false;
            spawnParticles(game.particles, enemyBullet.x, enemyBullet.y, '#00ffff', 5, 1, 4);
            break;
          }
        }
        if (!bullet.alive) continue;
        for (const enemy of game.enemies) {
          if (!enemy.alive) continue;
          if (Math.hypot(bullet.x - enemy.x, bullet.y - enemy.y) <= enemy.radius + 4) { bullet.alive = false; enemy.health -= 1; spawnParticles(game.particles, bullet.x, bullet.y, COLORS[enemy.behavior], 5, 1, 4); if (enemy.health <= 0) { enemy.alive = false; game.score += 100 + enemy.maxHealth * 20; spawnParticles(game.particles, enemy.x, enemy.y, COLORS[enemy.behavior], 18); } break; }
        }
        const boss = game.boss;
        if (game.state === 'BOSS' && boss && boss.phase !== 'DYING' && Math.hypot(bullet.x - boss.x, bullet.y - boss.y) <= boss.radius + 4) { bullet.alive = false; boss.health = Math.max(0, boss.health - 1); game.score += 40; spawnParticles(game.particles, bullet.x, bullet.y, '#ffaa00', 5, 2, 6); if (boss.health <= 0) { boss.phase = 'DYING'; boss.dyingTimer = 0; } }
      }
      const playerRect = { x: player.x - PLAYER_W / 2, y: player.y - PLAYER_H / 2, w: PLAYER_W, h: PLAYER_H };
       for (const bullet of game.enemyBullets) { const radius = bullet.radius ?? 4; if (bullet.alive && rectsOverlap({ x: bullet.x - radius, y: bullet.y - radius, w: radius * 2, h: radius * 2 }, playerRect)) { bullet.alive = false; if (player.invincible <= 0) { player.health = Math.max(0, player.health - bullet.damage); player.invincible = 90; spawnParticles(game.particles, player.x, player.y, '#ff3333', 14); if (player.health <= 0) gameOver(); } } }
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
       for (const bullet of game.enemyBullets) drawEnemyProjectile(ctx, bullet);
       for (const enemy of game.enemies) {
         const color = COLORS[enemy.behavior];
         ctx.globalAlpha = .85;
         drawShape(ctx, enemy.x, enemy.y, enemy.radius, enemy.shape, color);
         ctx.globalAlpha = 1;
         ctx.strokeStyle = color;
         ctx.lineWidth = 2;
         ctx.beginPath();
         ctx.arc(enemy.x, enemy.y, enemy.radius + 3, 0, Math.PI * 2);
         ctx.stroke();
         if (enemy.maxHealth > 1) { ctx.strokeStyle = '#00ff00'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(enemy.x, enemy.y, enemy.radius - 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * enemy.health / enemy.maxHealth); ctx.stroke(); }
       }
       if (game.boss) {
         const boss = game.boss;
         const color = boss.phase === 'PHASE3' ? '#ff2244' : boss.phase === 'PHASE2' ? '#ff8800' : '#4488ff';
         const gradient = ctx.createRadialGradient(boss.x, boss.y, 0, boss.x, boss.y, boss.radius * 2.2);
         gradient.addColorStop(0, `${color}55`); gradient.addColorStop(1, 'transparent');
         ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(boss.x, boss.y, boss.radius * 2.2, 0, Math.PI * 2); ctx.fill();
         ctx.globalAlpha = .9;
         drawShape(ctx, boss.x, boss.y, boss.radius, boss.shape, color);
         ctx.globalAlpha = 1;
         for (let ring = 1; ring <= 2; ring += 1) { ctx.strokeStyle = color; ctx.globalAlpha = .32 / ring; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(boss.x, boss.y, boss.radius + ring * 14, 0, Math.PI * 2); ctx.stroke(); }
         ctx.globalAlpha = 1;
       }
      const showPlayer = game.state === 'PLAYING' || game.state === 'STAGE_EXIT' || game.state === 'BOSS' || game.state === 'COUNTDOWN';
      drawPlayer(ctx, game.player.x, game.player.y, game.player.frame, !(game.player.invincible > 0 && Math.floor(game.player.invincible / 5) % 2 === 1) && showPlayer);
       if (game.state === 'PLAYING' || game.state === 'BOSS') drawJoystick(ctx, joystickRef.current);
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

  const pointerPosition = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * W / rect.width, y: (event.clientY - rect.top) * H / rect.height };
  };
  const onJoystickDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if ((gameRef.current.state !== 'PLAYING' && gameRef.current.state !== 'BOSS') || joystickRef.current.pointerId !== null) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    const { x, y } = pointerPosition(event);
    joystickRef.current = { pointerId: event.pointerId, x, y, dx: 0, dy: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onJoystickMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const joystick = joystickRef.current;
    if (joystick.pointerId !== event.pointerId) return;
    event.preventDefault();
    const { x, y } = pointerPosition(event);
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
  const canStart = Boolean(stageFile && bossFile);
  const isGame = state === 'COUNTDOWN' || state === 'PLAYING' || state === 'STAGE_EXIT' || state === 'BOSS_INTRO' || state === 'BOSS' || state === 'GAME_OVER' || state === 'VICTORY';

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
            <div className="mt-10 grid grid-cols-3 gap-2 text-center font-mono text-[9px] uppercase tracking-[.12em] text-slate-600"><span className="border-t border-slate-800 pt-3">Press + drag joystick to steer</span><span className="border-t border-slate-800 pt-3">Auto-fire</span><span className="border-t border-slate-800 pt-3">Three phases</span></div>
          </div>
        </section>
      )}
      {isGame && (
        <section className="game-shell" data-testid="panel-game">
          <div className="game-frame">
            <canvas ref={canvasRef} className="game-canvas" onPointerDown={onJoystickDown} onPointerMove={onJoystickMove} onPointerUp={onJoystickRelease} onPointerCancel={onJoystickRelease} onLostPointerCapture={onJoystickRelease} data-testid="canvas-game" aria-label="AudioStrike game field. Press and drag to steer with a joystick." />
            <div className="hud-top">
              <div className="hud-chip"><div className="font-mono text-[8px] uppercase tracking-[.16em] text-slate-500">Score</div><div className="font-mono text-sm font-bold text-cyan-200" data-testid="text-score">{String(hud.score).padStart(6, '0')}</div></div>
              <div className="text-right"><div className="font-mono text-[8px] uppercase tracking-[.16em] text-slate-500">Threat</div><div className="font-mono text-xs font-bold text-orange-300" data-testid="text-behavior">{hud.behavior}</div></div>
            </div>
            <div className="hud-bottom">
              {state === 'BOSS' && <div className="mb-3"><div className="mb-1 flex justify-between font-mono text-[9px] uppercase tracking-[.12em] text-orange-200"><span>Enemy core · {hud.phase}</span><span data-testid="text-boss-health">{hud.bossHealth} / {hud.bossMaxHealth}</span></div><div className="boss-health"><div style={{ width: `${hud.bossMaxHealth ? hud.bossHealth / hud.bossMaxHealth * 100 : 0}%` }} /></div></div>}
              <div className="flex items-end justify-between"><div><div className="mb-1 font-mono text-[8px] uppercase tracking-[.16em] text-slate-500">Hull integrity</div><div className={`font-mono text-2xl font-bold ${hud.health <= 25 ? 'text-red-300' : hud.health <= 50 ? 'text-orange-300' : 'text-green-300'}`} data-testid="status-health">{hud.health} <span className="text-xs font-normal text-slate-500">/ {PLAYER_MAX_HEALTH}</span></div></div><div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.14em] text-cyan-300/60"><Gamepad2 className="h-3 w-3" /> Drag joystick to steer</div></div>
            </div>
            {state === 'COUNTDOWN' && <div className="state-overlay" data-testid="overlay-countdown"><div><p className="font-mono text-[10px] uppercase tracking-[.28em] text-cyan-300">Get ready</p><div className="mt-2 text-8xl font-extrabold text-cyan-200" data-testid="text-countdown">{countdown}</div><p className="mt-1 font-mono text-[10px] uppercase tracking-[.18em] text-slate-500">Press + drag to steer · weapons auto-fire</p></div></div>}
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
