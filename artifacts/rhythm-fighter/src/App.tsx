import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Crosshair, Gamepad2, Headphones, Pause, Play, RotateCcw, Volume2, Zap } from 'lucide-react';
import { submitRunScore, type RunScoreInput } from '@workspace/api-client-react';
import { advanceBossDeath, advanceProjectiles, attackInterval, bossPhase, configureGameplayAudio, damageBoss, enemyShotHitsPlayer, nextLevel, playerShotHitsTarget, stageProgress as getStageProgress, STAGE_LEVEL_SECONDS, BOSS_ARRIVAL_SECONDS } from './gameRules';
import { getControllerStatus, mapGamepadInput, neutralControllerVector, selectActiveGamepad } from './gamepadControls';
import { audioIntensity, blendAudioSignals, bossHealth, chooseAttack, chooseMotion, generateForm, spawnProfile } from './encounterRules';
import { advancePickup, bombDamage, clearLaserHits, collectPickup, companionPositions, enemyDropChance, fireWeapon, freezeSplash, laserHitsTarget, newWeaponState, pickDrop, slowScale, tickFrozenBullet, WEAPON_BALANCE, type PickupType } from './weaponRules';
import WeaponHUD from './WeaponHUD';
import { drawFrozenHalo, drawWeaponEffects } from './weaponVisuals';
import { analyzeMusic } from './musicAnalysis';
import PlaylistSetup from './PlaylistSetup';
import { levelPair, shuffleTracks, validateLocalPlaylist, type LocalTrack } from './playlistRules';
import { separateBossPositions } from './gameRules';
import { EncounterScheduler } from './encounterScheduler';
import { FrameCombatSimulation } from './combatSimulation';
import { ARENA_HEIGHT as H, ARENA_WIDTH as W, createCombatViewSnapshot, type ActiveBoss, type CombatArsenal, type CombatWorld, type EnemyBulletEntity, type EnemyEntity, type FeatureSet, type GameState, type Joystick, type LiveFeatures, type ParticleEntity } from './gameRuntimeTypes';
import { blankLiveFeatures, createReactiveTrack, readReactiveTrack, releaseBossAudio, resetReactiveTrack, SoundtrackLifecycle } from './soundtrackLifecycle';
import { advanceSeekerProjectiles, chooseBehavior, chooseProjectile, createEnemyProjectile, firePattern } from './combatSimulation';
import { shapePath, drawEnemyBody, drawBossBody } from './enemyVisuals';
import { pixelBurst, bossDeathBurst, advanceCombatEffects, drawCombatEffects } from './combatEffects';
import { disruptEnemies, castBossAbility, advanceBlasts, advanceBossSweepBeams, bossSweepHitsPlayer, drawBossAbilities, blastMovementField } from './bossAbilities';
import { createSongDesign, songSpawnIdentity, songSectionAtTime } from './songDesign';
import { prepareSong } from './songAnalysisCache';
import type { SongPreviewState } from './SongDesignPreview';
import { createPlaybackWindow, playbackTimeForElapsed, playbackWindowFor, seekToPlaybackStart, setPlaybackWindow } from './playbackClips';
const PLAYER_MAX_HEALTH = 100;
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
type PreparedSong = Awaited<ReturnType<typeof prepareSong>>;
type SongPreparation = {
  file: File;
  promise: Promise<PreparedSong>;
  progress: number;
  observers: Set<(value: number) => void>;
};

async function inspectAudio(file: File, progress: (value: number) => void): Promise<FeatureSet> {
  progress(8);
  let decoder: AudioContext | null = null;
  try {
    decoder = new window.AudioContext();
    const decoded = await decoder.decodeAudioData(await file.arrayBuffer());
    progress(70);
    const analysis = analyzeMusic(Array.from({ length: decoded.numberOfChannels }, (_, channel) => decoded.getChannelData(channel)), decoded.sampleRate);
    progress(100);
    return { duration: clamp(decoded.duration || 42, 18, 720), ...analysis, analyzed: true };
  } catch {
    // Keep playback available for files the browser cannot decode for pre-analysis.
    const url = URL.createObjectURL(file);
    const element = new Audio(url);
    element.preload = 'metadata';
    const duration = await new Promise<number>((resolve) => {
      const finish = () => resolve(Number.isFinite(element.duration) ? element.duration : 42);
      element.addEventListener('loadedmetadata', finish, { once: true });
      window.setTimeout(finish, 1800);
    });
    URL.revokeObjectURL(url);
    const fallback = analyzeMusic([new Float32Array(512)], 22050);
    return { duration: clamp(duration || 42, 18, 720), ...fallback, analyzed: false };
  } finally {
    if (decoder && decoder.state !== 'closed') await decoder.close().catch(() => undefined);
  }
}

const fallbackFeatures = (duration: number): FeatureSet => ({
  duration, signature: blankLiveFeatures(), motifs: Array.from({ length: 8 }, () => blankLiveFeatures()),
  analyzedSeconds: 0, analyzed: false,
});

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
  const color = kind === 'SEEKER' ? '#65f3ff' : kind === 'SHARD' ? '#ffcc33' : kind === 'BOLT' ? '#ff5577' : kind === 'RING' ? '#ff8844' : '#ff3333';
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
  } else if (kind === 'SEEKER') {
    ctx.beginPath();
    ctx.moveTo(radius * 1.7, 0);
    ctx.lineTo(-radius * .45, -radius * .75);
    ctx.lineTo(-radius * .15, 0);
    ctx.lineTo(-radius * .45, radius * .75);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-radius * .4, 0); ctx.lineTo(-radius * 2.2, 0); ctx.stroke();
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
  const encountersRef = useRef(new EncounterScheduler<ActiveBoss>());
  const runProgressRef = useRef<{ levelReached: number; bossLevelReached: number | null }>({
    levelReached: 1,
    bossLevelReached: null,
  });
  const activeRunIdRef = useRef<string | null>(null);
  const finalRunRef = useRef<Omit<RunScoreInput, 'name'> | null>(null);
  const pendingScoreRunsRef = useRef(new Set<string>());
  const savedScoreRunsRef = useRef(new Set<string>());
  const soundtrackRef = useRef(new SoundtrackLifecycle());
  const testHarnessCleanupRef = useRef<() => void>(() => {});
  const testHarnessLoadingRef = useRef(false);
  const combatSimulationRef = useRef(new FrameCombatSimulation({
    width: W, height: H, playerWidth: PLAYER_W, playerHeight: PLAYER_H,
    maxSpeed: PLAYER_MAX_SPEED, acceleration: PLAYER_ACCELERATION, deceleration: PLAYER_DECELERATION,
  }));
  const stageAudioRef = useRef<HTMLAudioElement | null>(null);
  const bossAudioRef = useRef<HTMLAudioElement | null>(null);
  const joystickRef = useRef<Joystick>(neutralJoystick());
  const starsRef = useRef<{ x: number; y: number; size: number; brightness: number; speed: number }[]>([]);
  const gameRef = useRef<CombatWorld>({ state: 'UPLOAD', level: 1, stageFeatures: null, bossFeatures: null, audioContext: null, stageReactive: null, bossReactive: null, player: { x: W / 2, y: H / 2, vx: 0, vy: 0, health: PLAYER_MAX_HEALTH, invincible: 0, fireTimer: 0, frame: 0 }, enemies: [], bullets: [], enemyBullets: [], bossBeams: [], particles: [], debris: [], blasts: [], shockwaves: [], boss: null, score: 0, frame: 0, songStart: 0, bossStart: 0, beatIndex: 0, spawnIndex: 0, spawnCooldown: 0, stageDone: false, bossArrivalAt: 0, introTimer: 0, countdown: 3, countdownTimer: 0, currentBehavior: '' });
  const arsenalRef = useRef<CombatArsenal>({
    weapon: newWeaponState(), drops: [], beam: null,
    splashes: [] as { x: number; y: number; until: number }[],
    bombUntil: 0, message: '', messageUntil: 0, dropMisses: 0,
  });
  const [combatHud, setCombatHud] = useState({ weapon: newWeaponState(), now: 0, message: '', messageUntil: 0 });
  const [state, setState] = useState<GameState>('UPLOAD');
  const [paused, setPaused] = useState(false);
  const pauseRef = useRef({ since: null as number | null, total: 0, tracks: [] as HTMLAudioElement[] });
  // All combat deadlines share a monotonic clock that excludes paused time.
  const gameNow = useCallback(() => {
    const clock = pauseRef.current;
    return (clock.since ?? performance.now()) - clock.total;
  }, []);
  const [playlistTracks, setPlaylistTracks] = useState<LocalTrack[]>([]);
  const [previewTrackId, setPreviewTrackId] = useState<string | null>(null);
  const [songPreview, setSongPreview] = useState<SongPreviewState>({ trackId: '', status: 'idle' });
  const [randomOrder, setRandomOrder] = useState(false);
  const [randomClips, setRandomClips] = useState(false);
  const [playlistBusy, setPlaylistBusy] = useState(false);
  const preparedRef = useRef<(LocalTrack & { url: string; features: FeatureSet; playbackWindow: ReturnType<typeof createPlaybackWindow> })[]>([]);
  const preparedSongsRef = useRef(new Map<string, SongPreparation>());
  const [stageProgress, setStageProgress] = useState(0);
  const [bossProgress, setBossProgress] = useState(0);
  const [analysisMessage, setAnalysisMessage] = useState('Waiting for stage track');
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [hud, setHud] = useState({ level: 1, score: 0, health: PLAYER_MAX_HEALTH, behavior: 'SCANNING', phase: '', bossHealth: 0, bossMaxHealth: 1, stageSecondsLeft: STAGE_LEVEL_SECONDS });
  const [audioError, setAudioError] = useState('');
  const [bossHud, setBossHud] = useState<{ id: number; level: number; health: number; maxHealth: number }[]>([]);
  const [bossSecondsLeft, setBossSecondsLeft] = useState(30);
  const [musicWarning, setMusicWarning] = useState('');
  const [controllerStatus, setControllerStatus] = useState('Checking for controller…');
  const controllerStatusRef = useRef('Checking for controller…');
  const [finalRun, setFinalRun] = useState<Omit<RunScoreInput, 'name'> | null>(null);
  const [scoreName, setScoreName] = useState('');
  const [scoreSaveState, setScoreSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const syncState = useCallback((next: GameState) => {
    gameRef.current.state = next;
    setState(next);
  }, []);

  const resetAudio = useCallback(() => {
    for (const boss of encountersRef.current.bosses) releaseBossAudio(boss);
    encountersRef.current.reset();
    soundtrackRef.current.clear();
    stageAudioRef.current?.pause();
    bossAudioRef.current?.pause();
    gameRef.current.stageReactive?.source.disconnect();
    gameRef.current.bossReactive?.source.disconnect();
    gameRef.current.stageReactive?.analyser.disconnect();
    gameRef.current.bossReactive?.analyser.disconnect();
    if (gameRef.current.audioContext) void gameRef.current.audioContext.close();
    for (const track of preparedRef.current) URL.revokeObjectURL(track.url);
    preparedRef.current = [];
    stageAudioRef.current = null;
    bossAudioRef.current = null;
    gameRef.current.audioContext = null;
    gameRef.current.stageReactive = null;
    gameRef.current.bossReactive = null;
  }, []);

  const prepareTrack = useCallback((track: LocalTrack, onProgress: (value: number) => void) => {
    const cache = preparedSongsRef.current;
    const existing = cache.get(track.id);
    if (existing?.file === track.file) {
      existing.observers.add(onProgress);
      onProgress(existing.progress);
      return existing.promise.finally(() => existing.observers.delete(onProgress));
    }

    const entry: SongPreparation = {
      file: track.file,
      progress: 0,
      observers: new Set([onProgress]),
      promise: Promise.resolve(null as unknown as PreparedSong),
    };
    const report = (value: number) => {
      entry.progress = value;
      for (const observer of entry.observers) observer(value);
    };
    entry.promise = prepareSong(track.file, inspectAudio, report).catch((error) => {
      if (cache.get(track.id) === entry) cache.delete(track.id);
      throw error;
    });
    cache.set(track.id, entry);
    return entry.promise.finally(() => entry.observers.delete(onProgress));
  }, []);

  const loadLevelTracks = useCallback((level: number) => {
    if (!preparedRef.current.length) return;
    const pair = levelPair(preparedRef.current, level);
    const game = gameRef.current;
    stageAudioRef.current?.pause();
    // Each arrival gets its own retained track. Never mutate a surviving boss's media.
    const retained = encountersRef.current.bosses.some((boss) => boss.audio === bossAudioRef.current);
    if (!retained) releaseBossAudio({ audio: bossAudioRef.current, reactive: game.bossReactive });
    bossAudioRef.current = new Audio(pair.boss.url);
    bossAudioRef.current.loop = true;
    bossAudioRef.current.volume = .72;
    game.bossReactive = game.audioContext ? createReactiveTrack(game.audioContext, bossAudioRef.current) : null;
    if (stageAudioRef.current && bossAudioRef.current) {
      if (stageAudioRef.current.src !== pair.stage.url) stageAudioRef.current.src = pair.stage.url;
      if (bossAudioRef.current.src !== pair.boss.url) bossAudioRef.current.src = pair.boss.url;
      setPlaybackWindow(stageAudioRef.current, pair.stage.playbackWindow);
      setPlaybackWindow(bossAudioRef.current, pair.boss.playbackWindow);
    }
    game.stageFeatures = { ...pair.stage.features, design: createSongDesign(pair.stage.features) };
    game.bossFeatures = { ...pair.boss.features, design: createSongDesign(pair.boss.features) };
    resetReactiveTrack(game.stageReactive); resetReactiveTrack(game.bossReactive);
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

  const togglePause = useCallback(() => {
    const game = gameRef.current;
    if (!['PLAYING', 'BOSS_INTRO', 'BOSS'].includes(game.state)) return;
    const clock = pauseRef.current;
    if (clock.since === null) {
      clock.since = performance.now();
      clock.tracks = soundtrackRef.current.pauseForUser(
        stageAudioRef.current, bossAudioRef.current, encountersRef.current.bosses);
      const pointerId = joystickRef.current.pointerId;
      joystickRef.current = neutralJoystick();
      if (pointerId !== null && canvasRef.current?.hasPointerCapture(pointerId)) {
        canvasRef.current.releasePointerCapture(pointerId);
      }
      setPaused(true);
    } else {
      clock.total += performance.now() - clock.since;
      clock.since = null;
      resumeAudio();
      soundtrackRef.current.resumeAfterUserPause(clock.tracks, stageAudioRef.current, playTrack);
      clock.tracks = [];
      setPaused(false);
    }
  }, [playTrack, resumeAudio]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || (event.code !== 'Escape' && event.code !== 'KeyP')) return;
      if (event.target instanceof HTMLElement && event.target.matches('input, textarea, [contenteditable="true"]')) return;
      if (!['PLAYING', 'BOSS_INTRO', 'BOSS'].includes(gameRef.current.state)) return;
      event.preventDefault();
      togglePause();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePause]);

  const startAnalysis = useCallback(async () => {
    if (playlistBusy) return;
    try { validateLocalPlaylist(playlistTracks); }
    catch (error) {
      setMusicWarning(error instanceof Error ? error.message : 'Choose a valid playlist');
      return;
    }
    const manifest = { version: 1 as const, tracks: playlistTracks };
    syncState('ANALYZING');
    setMusicWarning('');
    setAnalysisProgress(2);
    setAnalysisMessage('Reading stage metadata');
    resetAudio();
    try {
      const ordered = randomOrder ? shuffleTracks(manifest.tracks) : manifest.tracks;
      for (let index = 0; index < ordered.length; index++) {
        const track = ordered[index];
        setAnalysisMessage(`Mapping track ${index + 1}/${ordered.length}: ${track.title}`);
        const prepared = await prepareTrack(track, (value) => {
          if (index % 2 === 0) setStageProgress(value); else setBossProgress(value);
          setAnalysisProgress(Math.round((index + value / 100) / ordered.length * 100));
        });
        if (prepared.warning) setMusicWarning(prepared.warning);
        const url = URL.createObjectURL(track.file);
        const duration = randomClips && prepared.features.analyzedSeconds > 0
          ? prepared.features.analyzedSeconds : prepared.features.duration;
        preparedRef.current.push({
          ...track,
          features: { ...prepared.features, duration },
          url,
          playbackWindow: createPlaybackWindow(duration, randomClips, index === 0),
        });
      }
      if (preparedRef.current.some((track) => !track.features.analyzed)) {
        setMusicWarning('A track could not be pre-analyzed. Live audio will still guide combat where available.');
      }
      const game = gameRef.current;
      stageAudioRef.current = new Audio();
      bossAudioRef.current = new Audio();
      loadLevelTracks(1);
      configureGameplayAudio(stageAudioRef.current, bossAudioRef.current);
      const AudioContextConstructor = window.AudioContext;
      stageAudioRef.current.preload = 'auto';
      bossAudioRef.current.preload = 'auto';
      stageAudioRef.current.volume = .72;
      bossAudioRef.current.volume = .72;
      try {
        if (!AudioContextConstructor) throw new Error('Web Audio is not supported');
        const audioContext = new AudioContextConstructor();
        game.audioContext = audioContext;
        game.stageReactive = createReactiveTrack(audioContext, stageAudioRef.current);
        game.bossReactive = createReactiveTrack(audioContext, bossAudioRef.current);
        await audioContext.resume();
      } catch {
        setMusicWarning('Live sound analysis is unavailable; the pre-match music map will still guide enemy designs.');
      }
      beginCountdown();
    } catch (error) {
      resetAudio();
      setMusicWarning(error instanceof Error ? error.message : 'Track preparation failed. Try again.');
      syncState('UPLOAD');
    }
  }, [resetAudio, syncState, playlistTracks, playlistBusy, randomOrder, randomClips, loadLevelTracks, prepareTrack]);

  const beginCountdown = useCallback((rerollPlaybackClips = false) => {
    const game = gameRef.current;
    if (rerollPlaybackClips && randomClips) {
      preparedRef.current.forEach((track, index) => {
        track.playbackWindow = createPlaybackWindow(track.features.duration, true, index === 0);
      });
    }
    for (const boss of encountersRef.current.bosses) releaseBossAudio(boss);
    encountersRef.current.reset();
    soundtrackRef.current.clear();
    pauseRef.current = { since: null, total: 0, tracks: [] };
    setPaused(false); setBossHud([]); setBossSecondsLeft(30);
    activeRunIdRef.current = crypto.randomUUID();
    finalRunRef.current = null;
    runProgressRef.current = { levelReached: 1, bossLevelReached: null };
    setFinalRun(null);
    setScoreName('');
    setScoreSaveState('idle');
    game.level = 1;
    loadLevelTracks(1);
    arsenalRef.current = { weapon: newWeaponState(), drops: [], beam: null, splashes: [],
      bombUntil: 0, message: '', messageUntil: 0, dropMisses: 0 };
    setCombatHud({ weapon: newWeaponState(), now: 0, message: '', messageUntil: 0 });
    game.player = { x: W / 2, y: H / 2, vx: 0, vy: 0, health: PLAYER_MAX_HEALTH, invincible: 0, fireTimer: 0, frame: 0 };
      game.enemies = []; game.bullets = []; game.enemyBullets = []; game.bossBeams = []; game.particles = []; game.debris = []; game.blasts = []; game.shockwaves = []; game.boss = null;
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
      seekToPlaybackStart(stageAudioRef.current);
      stageAudioRef.current.volume = 0;
      // Start from the replay button's user gesture, then seek back at the end of the countdown.
      resumeAudio();
      playTrack(stageAudioRef.current, 'Stage track');
    }
    syncState('COUNTDOWN');
  }, [playTrack, resumeAudio, syncState, loadLevelTracks, randomClips]);

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
    let last = gameNow();
    const getGameTime = () => {
      const game = gameRef.current;
      return game.state === 'BOSS' ? (gameNow() - game.bossStart) / 1000 : (gameNow() - game.songStart) / 1000;
    };
    const selectSoundtrack = () => {
      const run = encountersRef.current;
      return soundtrackRef.current.select(
        run.bosses, stageAudioRef.current, bossAudioRef.current, gameRef.current.stageReactive, playTrack,
      );
    };
    const beginPlaying = () => {
      const game = gameRef.current;
      syncState('PLAYING');
      resetReactiveTrack(game.stageReactive);
      if (stageAudioRef.current) {
        seekToPlaybackStart(stageAudioRef.current);
        stageAudioRef.current.volume = .72;
        resumeAudio();
        playTrack(stageAudioRef.current, 'Stage track');
      }
      game.songStart = gameNow();
    };
    const beginBossIntro = () => {
      const game = gameRef.current;
      resetReactiveTrack(game.bossReactive);
      game.state = 'BOSS_INTRO'; game.bossArrivalAt = gameNow() + BOSS_ARRIVAL_SECONDS * 1000; game.introTimer = BOSS_ARRIVAL_SECONDS * 60;
      // Pause regular spawning, but let existing enemies continue normal combat.
      encountersRef.current.protectUntil(game.bossArrivalAt);
      setAudioError('');
      // The incoming song takes ownership when its boss actually joins combat.
      syncState('BOSS_INTRO');
    };
    const beginBoss = () => {
      const game = gameRef.current;
      const features = game.bossFeatures ?? fallbackFeatures(28);
      const live = readReactiveTrack(game.bossReactive);
      const hp = bossHealth(features.duration, game.level);
      runProgressRef.current.levelReached = Math.max(runProgressRef.current.levelReached, game.level);
      runProgressRef.current.bossLevelReached = Math.max(runProgressRef.current.bossLevelReached ?? 0, game.level);
      game.player.y = clamp(game.player.y, 90, H - 150);
      const musicSection = songSectionAtTime(features, bossAudioRef.current?.currentTime ?? 0, bossAudioRef.current?.duration);
      const section = features.design?.sections[musicSection] ?? createSongDesign(features).sections[musicSection];
      const structure = section.signal;
      const reactiveSignature = game.bossReactive?.signature ?? live;
      const shape = section.shape;
      const formSignal = blendAudioSignals(structure, reactiveSignature, .32);
      const id = encountersRef.current.createBossId();
      const boss: ActiveBoss = {
        id, originLevel: game.level, features, audio: bossAudioRef.current, reactive: game.bossReactive,
        x: W / 2, y: -35, radius: 55, health: hp, maxHealth: hp, shape, designShape: shape,
        projectile: section.projectile, designProjectile: section.projectile, color: section.color,
        pattern: chooseAttack(blendAudioSignals(structure, live, .4), game.level), secondaryAt: gameNow() / 1000 + 6,
        motion: chooseMotion(blendAudioSignals(structure, live, .4), game.level, shape, section.motion),
        designMotion: section.motion, designSignal: structure, musicSection, motionChangedAt: gameNow() / 1000,
        form: generateForm(formSignal, game.level * 37),
        parts: 2 + Math.min(2, Math.floor(game.level / 3)), phase: 'INTRO',
        frame: 0, phaseFrame: 0, vx: 1, fireTimer: 0, dyingTimer: 0, subBossTimer: 0, revision: 0,
      };
      game.boss = boss;
      encountersRef.current.addBoss(boss);
      encountersRef.current.setEncounter(id, gameNow());
      game.beatIndex = 0;
      game.state = 'BOSS'; game.bossStart = gameNow();
      selectSoundtrack();
      resumeAudio();
      syncState('BOSS');
    };
    const spawnSubBoss = (live: LiveFeatures, boss = encountersRef.current.bosses.at(-1)) => {
      const game = gameRef.current;
      if (!boss || game.enemies.filter((enemy) => enemy.ownerId === boss.id && enemy.alive).length >= 3) return;
      boss.parts = Math.max(0, boss.parts - 1);
      const level = boss.originLevel;
      const serial = game.spawnIndex++ + level * 29;
      const musicSection = songSectionAtTime(boss.features, boss.audio?.currentTime ?? 0, boss.audio?.duration);
      const motif = boss.features.motifs[musicSection] ?? boss.features.signature;
      const spawnIdentity = songSpawnIdentity(boss.features, motif, serial, musicSection);
      const shape = spawnIdentity.shape;
      const design = blendAudioSignals(motif, boss.reactive?.signature ?? live, .4);
      const radius = 22 + live.low * 8;
      const x = clamp(boss.x + (serial % 2 ? 1 : -1) * (boss.radius + 16), radius, W - radius);
      const health = Math.round(clamp(12 + level * 3 + live.low * 8, 12, 65));
      game.enemies.push({
        x, y: boss.y, radius, health, maxHealth: health, speed: 3.5 + audioIntensity(live) * 4 + Math.min(3, level * .35),
        behavior: 'SHOOTER', fireRate: clamp(85 - audioIntensity(live) * 40 - level * 2, 24, 90),
        fireTimer: 38, frame: 0, zigDir: serial % 2 ? 1 : -1, formX: x, formY: boss.y,
        diving: false, dvx: 0, dvy: 0, shape,
        projectile: spawnIdentity.projectile, designProjectile: spawnIdentity.projectile, color: spawnIdentity.color,
        form: generateForm(design, serial, 1.1),
        motion: chooseMotion(blendAudioSignals(motif, live, .4), serial, shape, spawnIdentity.motion),
        designMotion: spawnIdentity.motion, designSignal: spawnIdentity.signal, musicSection,
        motionChangedAt: gameNow() / 1000,
        pattern: chooseAttack(blendAudioSignals(spawnIdentity.signal, live, .4), serial),
        subBoss: true, ownerId: boss.id, originLevel: level, exiting: false, alive: true,
      });
    };
    const clearHostilesOnBossDeath = (boss: ActiveBoss) => {
      const game = gameRef.current;
      for (const enemy of game.enemies) {
        if (enemy.ownerId === boss.id) spawnParticles(game.particles, enemy.x, enemy.y, '#ffb347', 10, 2, 7);
      }
      game.enemies = game.enemies.filter((enemy) => enemy.ownerId !== boss.id);
      game.enemyBullets = game.enemyBullets.filter((bullet) => bullet.ownerId !== boss.id);
      game.blasts = game.blasts.filter((blast) => blast.ownerId !== boss.id);
      game.bossBeams = game.bossBeams.filter((beam) => beam.ownerId !== boss.id);
    };
    const addDrop = (type: PickupType, x: number, y: number) => {
      const arsenal = arsenalRef.current;
      if (arsenal.drops.length >= WEAPON_BALANCE.maxDrops) return;
      arsenal.drops.push({ type, x: clamp(x, 22, W - 22), y: clamp(y, 80, H - 130),
        expiresAt: gameNow() / 1000 + WEAPON_BALANCE.dropSeconds, alive: true });
    };
    const killEnemy = (enemy: EnemyEntity, allowDrop = true) => {
      if (!enemy.alive) return;
      const game = gameRef.current;
      enemy.alive = false;
      game.score += 100 + enemy.maxHealth * 20;
      pixelBurst(game.particles, enemy.x, enemy.y, enemy.color ?? COLORS[enemy.behavior], Math.round(22 + enemy.radius * .6));
      if (allowDrop && !enemy.exiting) {
        const arsenal = arsenalRef.current;
        arsenal.dropMisses += 1;
        if (Math.random() < enemyDropChance(enemy) ||
          arsenal.dropMisses >= WEAPON_BALANCE.dropPity) {
          addDrop(pickDrop(Math.random()), enemy.x, enemy.y);
          arsenal.dropMisses = 0;
        }
      }
    };
    const hitBoss = (amount: number, boss: ActiveBoss, allowIntroDamage = false) => {
      const game = gameRef.current;
      if (boss.phase === 'DYING' || (boss.phase === 'INTRO' && !allowIntroDamage)) return;
      if (damageBoss(boss, amount)) game.score += 40;
      if (boss.health === 0) {
        if (Math.random() < WEAPON_BALANCE.bossRepairChance) addDrop('REPAIR', boss.x, boss.y);
        else if (Math.random() < WEAPON_BALANCE.bossDropChance) addDrop(pickDrop(Math.random() * .66), boss.x, boss.y);
        clearHostilesOnBossDeath(boss);
        bossDeathBurst(game, boss, gameNow() / 1000);
        disruptEnemies(game, gameNow() / 1000);
        if (encountersRef.current.encounter?.id === boss.id && !encountersRef.current.encounter.advanced) {
          encountersRef.current.protectUntil(gameNow() + 2500);
          finishEncounter(boss.id);
        }
        selectSoundtrack();
      }
    };
    const splash = (x: number, y: number) => {
      const game = gameRef.current;
      const now = gameNow() / 1000;
      const targets = [...game.enemies, ...encountersRef.current.bosses.filter((boss) => boss.phase !== 'DYING')];
      freezeSplash(x, y, targets, game.enemyBullets, now);
      const splashes = arsenalRef.current.splashes;
      if (splashes.length < 24) splashes.push({ x, y, until: now + .4 });
    };
    const triggerBomb = () => {
      const game = gameRef.current;
      if (game.state === 'GAME_OVER') return;
      for (const shot of game.enemyBullets) spawnParticles(game.particles, shot.x, shot.y, '#ffb2cc', 2);
      game.enemyBullets = [];
      for (const enemy of game.enemies) {
        if (!enemy.alive || enemy.y + enemy.radius < 0 || enemy.y - enemy.radius > H) continue;
        enemy.health = Math.max(0, enemy.health - bombDamage(enemy));
        // Bomb kills score normally, but never generate another pickup chain.
        if (enemy.health === 0) killEnemy(enemy, false);
      }
      for (const boss of encountersRef.current.bosses) hitBoss(WEAPON_BALANCE.bombBossDamage, boss, true);
      arsenalRef.current.bombUntil = gameNow() / 1000 + .45;
    };
    const receivePickup = (type: PickupType) => {
      const game = gameRef.current;
      if (game.state === 'GAME_OVER') return;
      const arsenal = arsenalRef.current;
      const now = gameNow() / 1000;
      const result = collectPickup(arsenal.weapon, type, game.player.health, now);
      game.player.health = result.health;
      arsenal.beam = null;
      arsenal.message = result.message; arsenal.messageUntil = now + 2.5;
      spawnParticles(game.particles, game.player.x, game.player.y, '#c5fff2', 10, 2, 7);
      if (result.bomb) triggerBomb();
    };
    const beginNextLevel = () => {
      const game = gameRef.current;
      game.level = nextLevel(game.level);
      game.bossBeams = [];
      runProgressRef.current.levelReached = Math.max(runProgressRef.current.levelReached, game.level);
      loadLevelTracks(game.level);
      game.stageDone = false;
      game.spawnCooldown = 0;
      resetReactiveTrack(game.stageReactive);
      if (stageAudioRef.current) {
        seekToPlaybackStart(stageAudioRef.current);
        stageAudioRef.current.volume = .72;
      }
      game.songStart = gameNow();
      syncState('PLAYING');
      selectSoundtrack();
      setHud((previous) => ({ ...previous, level: game.level, stageSecondsLeft: STAGE_LEVEL_SECONDS, phase: '' }));
    };
    const finishEncounter = (defeatedId?: number) => {
      if (encountersRef.current.advance(gameNow(), defeatedId)) beginNextLevel();
    };
    const gameOver = () => {
      const game = gameRef.current;
      if (game.state === 'GAME_OVER') return;
      const runId = activeRunIdRef.current ?? crypto.randomUUID();
      activeRunIdRef.current = runId;
      const summary = {
        runId,
        score: game.score,
        levelReached: Math.max(runProgressRef.current.levelReached, game.level),
        bossLevelReached: runProgressRef.current.bossLevelReached,
      };
      finalRunRef.current = summary;
      setFinalRun(summary);
      setScoreName('');
      setScoreSaveState('idle');
      joystickRef.current = neutralJoystick();
      arsenalRef.current.beam = null;
      arsenalRef.current.weapon.chargeStartedAt = null;
      game.bullets = [];
      game.bossBeams = [];
      stageAudioRef.current?.pause(); bossAudioRef.current?.pause();
      for (const boss of encountersRef.current.bosses) releaseBossAudio(boss);
      encountersRef.current.reset();
      soundtrackRef.current.clear();
      game.boss = null;
      syncState('GAME_OVER');
    };
    const canAttack = () => gameRef.current.state !== 'GAME_OVER';
    const damageProtected = () => gameRef.current.state === 'BOSS_INTRO' || gameNow() < encountersRef.current.protectedUntil;
    const update = (delta: number) => {
      const game = gameRef.current;
      game.frame += 1;
       for (const star of stars) { star.y += star.speed * delta * .35; if (star.y > H) { star.y = 0; star.x = random(0, W); } }
      advanceCombatEffects(game, delta);
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
        game.introTimer = Math.max(0, (game.bossArrivalAt - gameNow()) / 1000 * 60);
        if (game.introTimer <= 0) beginBoss();
      }
      if (game.state !== 'PLAYING' && game.state !== 'BOSS' && game.state !== 'BOSS_INTRO') return;
      const arsenal = arsenalRef.current;
      const now = gameNow() / 1000;
      game.shockwaves = game.shockwaves.filter(effect => effect.until > now);
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
        joystick = joystickRef.current = neutralJoystick();
      }
      combatSimulationRef.current.movePlayer(player, {
        x: joystick.dx, y: joystick.dy, active: isSteering,
      }, delta, game.state === 'BOSS', now, blastMovementField(game.blasts, player.x, player.y, now));
      player.invincible = Math.max(0, player.invincible - delta);
      finishEncounter();
      const volley = fireWeapon(arsenal.weapon, player, now);
      game.bullets.push(...volley.shots.slice(0, Math.max(0, WEAPON_BALANCE.maxBullets - game.bullets.length)));
      if (volley.beam) arsenal.beam = volley.beam;
      const live = readReactiveTrack(selectSoundtrack());
      for (const blast of advanceBlasts(game, now)) {
        pixelBurst(game.particles, blast.x, blast.y, blast.kind === 'BLAST' ? '#ffb06b' : '#d9a6ff', 45, 1.2);
        if (Math.hypot(player.x - blast.x, player.y - blast.y) <= blast.radius + PLAYER_W / 2 &&
          !damageProtected() && player.invincible <= 0 && arsenal.weapon.shieldUntil <= now) {
          if (blast.kind === 'DEBUFF') {
            player.debuffUntil = now + 5;
            arsenal.message = 'Disrupted · movement and fire slowed for 5s'; arsenal.messageUntil = now + 5;
          } else {
            player.health = Math.max(0, player.health - 18); player.invincible = 90;
            if (player.health <= 0) gameOver();
          }
        }
      }
      if (game.state === 'PLAYING') {
        const songTime = getGameTime();
        const stage = getStageProgress(songTime);
        stageSecondsLeft = stage.secondsLeft;
        const progress = stage.progress;
        game.spawnCooldown -= delta;
        game.currentBehavior = chooseBehavior(live);
        if (!game.stageDone && stage.finished) {
          game.stageDone = true;
          beginBossIntro();
        }
        const pressure = spawnProfile(live, game.level, progress);
        const regularEnemyCount = () => game.enemies.filter((enemy) => !enemy.subBoss).length;
        if (game.state === 'PLAYING' && (game.spawnCooldown <= 0 || (live.pulse && game.spawnCooldown <= 10)) && regularEnemyCount() < pressure.maxEnemies) {
          const count = pressure.count;
          const spawnSerial = game.spawnIndex;
          game.spawnIndex += count;
          for (let enemyIndex = 0; enemyIndex < count && regularEnemyCount() < pressure.maxEnemies; enemyIndex += 1) {
            const serial = spawnSerial + enemyIndex + game.level * 17;
            const variation = (Math.sin(serial * 2.17 + live.centroid * 8) + 1) / 2;
            const radius = clamp(9 + live.low * 17 + variation * 10 + live.high * 5, 9, 42);
            const health = clamp(1 + Math.round(live.low * 3 + progress * 3 + (game.level - 1) * 1.2), 1, 22);
            const features = game.stageFeatures ?? fallbackFeatures(30);
            const musicSection = songSectionAtTime(features, stageAudioRef.current?.currentTime ?? songTime,
              stageAudioRef.current?.duration);
            const motif = features.motifs[musicSection] ?? features.signature ?? live;
            const design = blendAudioSignals(motif, game.stageReactive?.signature ?? live, .4);
            const spawnIdentity = songSpawnIdentity(features, motif, serial, musicSection);
            const shape = spawnIdentity.shape;
            const projectile = spawnIdentity.projectile;
            const designSignal = spawnIdentity.signal;
            const behavior = chooseBehavior(blendAudioSignals(designSignal, live, .4));
            const x = behavior === 'FORMATION' ? (W / (count + 1)) * (enemyIndex + 1) : random(radius + 18, W - radius - 18);
            const motion = chooseMotion(blendAudioSignals(designSignal, live, .4), serial, shape, spawnIdentity.motion);
            const pattern = chooseAttack(blendAudioSignals(designSignal, live, .4), serial);
            game.enemies.push({
              x, y: -radius - 12, radius, health, maxHealth: health,
              speed: (2.4 + live.high * 6.2 + progress * 2.4) * pressure.speedScale,
              behavior,
              fireRate: clamp((112 - live.mid * 42) / pressure.fireScale, 28, 140),
              fireTimer: randomInt(20, 80), frame: 0, zigDir: Math.random() > .5 ? 1 : -1,
              formX: x, formY: -radius - 12, diving: false, dvx: 0, dvy: 0, shape, projectile,
              designProjectile: projectile, color: spawnIdentity.color,
              form: generateForm(design, serial, .8), motion, designMotion: spawnIdentity.motion,
              designSignal, musicSection, motionChangedAt: gameNow() / 1000, pattern,
              subBoss: false, exiting: false, alive: true,
            });
          }
          game.spawnCooldown = pressure.cooldown;
        }
      }
      const completedBosses = new Set<ActiveBoss>();
      for (const boss of encountersRef.current.bosses) {
        const level = boss.originLevel;
        boss.frame += delta;
        if (boss.phase === 'INTRO') {
          boss.y += (120 - boss.y) * .035 * delta * slowScale(boss, now);
          if (boss.y >= 117) { boss.phase = bossPhase(boss.health, boss.maxHealth); boss.phaseFrame = 0; boss.subBossTimer = 180; spawnSubBoss(live, boss); }
        } else if (boss.phase === 'DYING') {
          const deathComplete = advanceBossDeath(boss, delta);
          if (boss.dyingTimer < 95 && Math.floor((boss.dyingTimer - delta) / 15) !== Math.floor(boss.dyingTimer / 15)) {
            pixelBurst(game.particles, boss.x + random(-boss.radius, boss.radius), boss.y + random(-boss.radius, boss.radius), boss.color ?? '#ffdca0', 24, 1.3);
          }
          if (deathComplete) {
            game.score += 1000 + boss.originLevel * 500;
            completedBosses.add(boss);
            releaseBossAudio(boss);
          }
        } else {
          const musicSection = songSectionAtTime(boss.features, boss.audio?.currentTime ?? 0, boss.audio?.duration);
          if (musicSection !== boss.musicSection) {
            const section = (boss.features.design ?? createSongDesign(boss.features)).sections[musicSection];
            if (section) {
              boss.musicSection = musicSection;
              boss.designSignal = section.signal;
              boss.shape = section.shape;
              boss.designShape = section.shape;
              boss.color = section.color;
              boss.designProjectile = section.projectile;
              boss.designMotion = section.motion;
              boss.form = generateForm(blendAudioSignals(section.signal, live, .32), boss.revision + level * 37);
              const sectionSignal = blendAudioSignals(section.signal, live, .4);
              boss.motion = chooseMotion(sectionSignal, boss.revision + level * 37, section.shape, section.motion);
              boss.pattern = chooseAttack(sectionSignal, boss.revision + level * 37);
              boss.motionChangedAt = now;
            }
          }
          const nextPhase = bossPhase(boss.health, boss.maxHealth);
          if (boss.phase !== nextPhase) {
            boss.phase = nextPhase;
            boss.phaseFrame = 0;
            boss.revision += 1;
            boss.vx = boss.x > W / 2 ? -1 : 1;
            boss.pattern = chooseAttack(blendAudioSignals(boss.designSignal ?? boss.features.signature, live, .4),
              boss.revision + level * 37);
            spawnSubBoss(live, boss);
          }
          const bossDelta = delta * slowScale(boss, now);
          boss.phaseFrame += bossDelta;
          if ((boss.phaseFrame > 160 && live.pulse) || boss.phaseFrame > 260) {
            boss.revision += 1;
            boss.phaseFrame = 0;
          }
          if (boss.phaseFrame < delta * 2) {
            const serial = boss.revision + level * 37;
            const sectionSignal = blendAudioSignals(boss.designSignal ?? boss.features.signature, live, .4);
            boss.motion = chooseMotion(sectionSignal, serial, boss.shape, boss.designMotion);
            boss.pattern = chooseAttack(sectionSignal, serial);
          }
          if (live.pulse && now - boss.motionChangedAt > .22) {
            const sectionSignal = blendAudioSignals(boss.designSignal ?? boss.features.signature, live, .4);
            const serial = boss.revision + Math.floor(boss.phaseFrame);
            boss.motion = chooseMotion(sectionSignal, serial, boss.shape, boss.designMotion);
            boss.pattern = chooseAttack(sectionSignal, serial);
            boss.motionChangedAt = now;
          }
          boss.projectile = boss.designProjectile ?? chooseProjectile(live, 'BOSS');
          game.currentBehavior = `BOSS ${boss.pattern}`;
          boss.subBossTimer -= bossDelta;
          if (boss.subBossTimer <= 0 && (live.pulse || audioIntensity(live) > .55 || boss.subBossTimer <= -150)) {
            spawnSubBoss(live, boss);
            boss.subBossTimer = clamp(680 - audioIntensity(live) * 350 - level * 15, 240, 680);
          }
          combatSimulationRef.current.moveBoss(boss, player, live, bossDelta);
          castBossAbility(game, boss, live, now);
          boss.fireTimer -= bossDelta * (1 + audioIntensity(live) * .45);
          if (boss.fireTimer <= 0) {
            firePattern(game.enemyBullets, boss.x, boss.y + boss.radius * .3, player, boss.pattern, boss.projectile, 7.4 + Math.min(2, level * .18), boss.pattern === 'TRACK' ? 8 : 4, game.frame, boss.id);
            boss.fireTimer = clamp(attackInterval(live, level, true) - live.tempo * .06, 26, 110);
          }
        }
      }
      encountersRef.current.retainBosses((boss) => !completedBosses.has(boss));
      advanceBossSweepBeams(game, encountersRef.current.bosses, now);
      separateBossPositions(encountersRef.current.bosses, W);
      game.boss = encountersRef.current.bosses.at(-1) ?? null;
      for (const enemy of game.enemies) {
        if (!canAttack()) break;
        if (!enemy.alive) continue;
        const confused = (enemy.confusedUntil ?? 0) > now;
        const designSignal = enemy.designSignal ?? live;
        const combatSignal = blendAudioSignals(designSignal, live, .4);
        enemy.behavior = chooseBehavior(combatSignal);
        enemy.pattern = confused
          ? (['TRACK', 'WAVE', 'SPIRAL'] as const)[Math.abs(Math.floor(enemy.frame / 18 + enemy.formX)) % 3]
          : chooseAttack(combatSignal, Math.floor(enemy.frame));
        enemy.projectile = enemy.designProjectile ?? chooseProjectile(live, enemy.behavior);
        if (live.pulse && now - enemy.motionChangedAt > .22 && !enemy.exiting) {
          const nextMotion = chooseMotion(combatSignal, Math.floor(enemy.frame + game.spawnIndex),
            enemy.shape, enemy.designMotion);
          if (nextMotion !== enemy.motion) {
            enemy.motion = nextMotion;
            enemy.diving = false;
          }
          enemy.motionChangedAt = now;
        }
        const enemyDelta = combatSimulationRef.current.moveEnemy(enemy, player, live, delta, now);
        if (!enemy.exiting && enemy.fireRate > 0) {
          enemy.fireTimer -= enemyDelta * (1 + audioIntensity(live) * .7);
          if (enemy.fireTimer <= 0) {
            const aim = confused ? { x: enemy.x + Math.sin(enemy.frame + enemy.formX) * 150, y: enemy.y + Math.cos(enemy.frame + enemy.formX) * 150 } : player;
            firePattern(game.enemyBullets, enemy.x, enemy.y, aim, enemy.pattern, enemy.projectile, 7 + Math.min(2, (enemy.originLevel ?? game.level) * .12), enemy.subBoss ? 5 : 3, Math.round(enemy.frame), enemy.ownerId);
            enemy.fireTimer = enemy.fireRate * clamp(attackInterval(live, enemy.originLevel ?? game.level) / 100, .45, 1.5);
          }
        }
        if (enemy.y > H + 70) enemy.alive = false;
        const enemyOnScreen = enemy.y + enemy.radius >= 0 && enemy.y - enemy.radius <= H;
        for (const companion of companionPositions(player, arsenal.weapon)) {
          if (!damageProtected() && enemy.alive && companion.health > 0 && !enemy.exiting &&
            enemyShotHitsPlayer(enemy, companion, 14, 20)) {
            arsenal.weapon.companions[companion.index] = Math.max(0, companion.health - 14);
            killEnemy(enemy, false);
            spawnParticles(game.particles, companion.x, companion.y, '#ffe45e', 8);
          }
        }
        if (enemy.alive && !enemy.exiting && enemyOnScreen &&
          combatSimulationRef.current.enemyHitsPlayer(enemy, player)) {
          enemy.alive = false;
          pixelBurst(game.particles, enemy.x, enemy.y, enemy.color ?? COLORS[enemy.behavior], 30);
          if (!damageProtected() && player.invincible <= 0 && arsenal.weapon.shieldUntil <= now) {
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
        for (const boss of encountersRef.current.bosses) {
          if (boss.phase !== 'INTRO' && laserHitsTarget(volley.beam, boss)) hitBoss(volley.beam.damage, boss);
        }
      }
      for (const bullet of game.enemyBullets) {
        if (tickFrozenBullet(bullet, now) && !bullet.alive) spawnParticles(game.particles, bullet.x, bullet.y, '#b8f6ff', 5);
      }
      advanceSeekerProjectiles(game.enemyBullets, player, delta);
      game.enemyBullets = game.enemyBullets.filter((bullet) => bullet.alive);
      advanceProjectiles(game.bullets, game.enemyBullets, delta, W, H);
      if (arsenal.beam && now < arsenal.beam.until && canAttack()) {
        const cleared = clearLaserHits(arsenal.beam, game.enemyBullets);
        // Clear bullets for the full visible beam lifespan; cap sparks through dense volleys.
        cleared.slice(0, 16).forEach((bullet) => spawnParticles(game.particles, bullet.x, bullet.y, '#b8f6ff', 2, 1, 3));
        if (cleared.length) game.enemyBullets = game.enemyBullets.filter((bullet) => bullet.alive);
      }
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
        const boss = encountersRef.current.bosses.find((boss) =>
          boss.phase !== 'INTRO' && boss.phase !== 'DYING' && playerShotHitsTarget(bullet, boss));
        if (boss) {
          bullet.alive = false;
          if (bullet.freeze) splash(bullet.x, bullet.y);
          hitBoss(bullet.damage, boss);
          spawnParticles(game.particles, bullet.x, bullet.y, '#ffaa00', 5, 2, 6);
        }
      }
      for (const bullet of game.enemyBullets) {
        if (!canAttack()) break;
        if (!bullet.alive || bullet.frozenUntil) continue;
        for (const companion of companionPositions(player, arsenal.weapon)) {
          if (!damageProtected() && bullet.alive && companion.health > 0 && enemyShotHitsPlayer(bullet, companion, 14, 20)) {
            bullet.alive = false;
            arsenal.weapon.companions[companion.index] = Math.max(0, companion.health - bullet.damage);
            spawnParticles(game.particles, companion.x, companion.y, '#ffe45e', 5);
          }
        }
        if (bullet.alive && enemyShotHitsPlayer(bullet, player, PLAYER_W, PLAYER_H)) {
          bullet.alive = false;
          if (!damageProtected() && player.invincible <= 0 && arsenal.weapon.shieldUntil <= now) {
            player.health = Math.max(0, player.health - bullet.damage); player.invincible = 90;
            spawnParticles(game.particles, player.x, player.y, '#ff3333', 14);
            if (player.health <= 0) gameOver();
          }
        }
      }
      const sweepHit = game.bossBeams.some((beam) =>
        bossSweepHitsPlayer(beam, player, now, PLAYER_W, PLAYER_H));
      if (sweepHit && !damageProtected() && player.invincible <= 0 &&
        arsenal.weapon.shieldUntil <= now) {
        player.health = Math.max(0, player.health - 16);
        player.invincible = 90;
        spawnParticles(game.particles, player.x, player.y, '#ff5577', 14);
        if (player.health <= 0) gameOver();
      }
      if (canAttack()) {
        for (const pickup of arsenal.drops) {
          if (advancePickup(pickup, player, now, delta / 60, H)) receivePickup(pickup.type);
        }
      }
      arsenal.drops = arsenal.drops.filter((drop) => drop.alive && drop.expiresAt > now);
      game.enemies = game.enemies.filter((enemy) => enemy.alive);
      game.bullets = game.bullets.filter((bullet) => bullet.alive);
      game.enemyBullets = game.enemyBullets.filter((bullet) => bullet.alive);
      const snapshot = createCombatViewSnapshot(
        game, arsenal, encountersRef.current.bosses, encountersRef.current.encounter, gameNow(), stageSecondsLeft,
      );
      setCombatHud(snapshot.combatHud);
      setBossHud(snapshot.bosses);
      setBossSecondsLeft(snapshot.bossSecondsLeft);
      setHud(snapshot.hud);
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
      drawBossAbilities(ctx, game, gameNow() / 1000);
      drawCombatEffects(ctx, game, gameNow() / 1000);
       for (const bullet of game.enemyBullets) {
         drawEnemyProjectile(ctx, bullet);
         if ((bullet.frozenUntil ?? 0) > gameNow() / 1000) drawFrozenHalo(ctx, bullet.x, bullet.y, bullet.radius);
       }
       for (const enemy of game.enemies) {
         ctx.globalAlpha = .85;
           drawEnemyBody(ctx, enemy, gameNow() / 1000);
          if (enemy.subBoss) { ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(enemy.x, enemy.y, enemy.radius + 7, 0, Math.PI * 2); ctx.stroke(); }
         ctx.globalAlpha = 1;
          drawEnemyDamage(ctx, enemy);
          if (slowScale(enemy, gameNow() / 1000) < 1) drawFrozenHalo(ctx, enemy.x, enemy.y, enemy.radius);
       }
       for (const boss of encountersRef.current.bosses) {
         ctx.globalAlpha = .9;
          drawBossBody(ctx, boss);
         ctx.globalAlpha = 1;
         if (slowScale(boss, gameNow() / 1000) < 1) drawFrozenHalo(ctx, boss.x, boss.y, boss.radius);
       }
       const showPlayer = game.state === 'PLAYING' || game.state === 'BOSS_INTRO' || game.state === 'BOSS' || game.state === 'COUNTDOWN';
        drawPlayer(ctx, game.player.x, game.player.y, game.player.frame, showPlayer, game.player.health);
        const arsenal = arsenalRef.current;
        if (showPlayer) drawWeaponEffects(ctx, arsenal.weapon, game.player, game.bullets, arsenal.beam,
          arsenal.drops, gameNow() / 1000, arsenal.bombUntil, arsenal.splashes);
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
    const testMode = (window as Window & {
      __RHYTHM_FIGHTER_TEST_MODE__?: boolean;
      __AUDIOSTRIKE_TEST_MODE__?: boolean;
    }).__RHYTHM_FIGHTER_TEST_MODE__ ||
      (window as Window & { __AUDIOSTRIKE_TEST_MODE__?: boolean }).__AUDIOSTRIKE_TEST_MODE__;
    if (import.meta.env.DEV && testMode && !testHarnessLoadingRef.current) {
      testHarnessLoadingRef.current = true;
      void import('./dev/gameTestHarness').then(({ installGameTestHarness }) => {
        testHarnessCleanupRef.current = installGameTestHarness(window, {
          getGame: () => gameRef.current,
          getRunProgress: () => ({ ...runProgressRef.current }),
          getArsenal: () => arsenalRef.current,
          getEncounters: () => encountersRef.current,
          getStageAudio: () => stageAudioRef.current,
          getBossAudio: () => bossAudioRef.current,
          getPrepared: () => preparedRef.current,
          paused: () => pauseRef.current.since !== null,
          stars,
          audibleTrack: () => soundtrackRef.current.audible,
          gameNow,
          damageProtected,
          finishBoss: (id) => {
            const boss = encountersRef.current.findBoss(id ?? encountersRef.current.encounter?.id ?? -1);
            if (!boss) throw new Error('No boss to finish');
            hitBoss(boss.health, boss, true);
          },
          spawnSubBoss: () => spawnSubBoss(readReactiveTrack(gameRef.current.bossReactive)),
          addDrop: (type, x, y) => addDrop(type, x, y),
          clearPlayerShots: () => { gameRef.current.bullets = []; },
          makeEnemyShot: (x, y, damage) => {
            gameRef.current.enemyBullets.push(createEnemyProjectile(x, y, 0, 0, damage, 'ORB'));
          },
          freezeAt: splash,
          endRun: gameOver,
        });
      });
    }
    const loop = () => {
      const now = gameNow();
      const delta = Math.max(0, Math.min(2.2, (now - last) / 16.67));
      last = now;
      if (pauseRef.current.since === null) {
        update(delta);
        draw();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [gameNow, playTrack, resumeAudio, state, syncState, loadLevelTracks]);

  useEffect(() => () => {
    testHarnessCleanupRef.current();
    resetAudio();
  }, [resetAudio]);

  const pointerPosition = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;
    return { x: (event.clientX - rect.left) * W / rect.width, y: (event.clientY - rect.top) * H / rect.height };
  };
  const onJoystickDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (pauseRef.current.since !== null) return;
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

  const retryAudio = () => {
    if (pauseRef.current.since !== null) return;
    const game = gameRef.current;
    const owner = encountersRef.current.livingBoss();
    const bossTrack = Boolean(owner);
    const audio = owner?.audio ?? stageAudioRef.current;
    if (!audio) return;
    if (!bossTrack && game.state === 'PLAYING' && Number.isFinite(audio.duration) && audio.duration > 0) {
      audio.currentTime = playbackTimeForElapsed((gameNow() - game.songStart) / 1000,
        audio.duration, playbackWindowFor(audio));
    }
    audio.volume = game.state === 'COUNTDOWN' ? 0 : .72;
    resumeAudio();
    playTrack(audio, bossTrack ? 'Boss track' : 'Stage track');
  };
  const handleSaveRunScore = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const run = finalRunRef.current;
    const name = scoreName.trim();
    if (!run || !name || pendingScoreRunsRef.current.has(run.runId) || savedScoreRunsRef.current.has(run.runId)) return;

    pendingScoreRunsRef.current.add(run.runId);
    setScoreSaveState('saving');
    try {
      await submitRunScore({ ...run, name });
      savedScoreRunsRef.current.add(run.runId);
      if (finalRunRef.current?.runId === run.runId) setScoreSaveState('saved');
    } catch {
      if (finalRunRef.current?.runId === run.runId) setScoreSaveState('error');
    } finally {
      pendingScoreRunsRef.current.delete(run.runId);
    }
  }, [scoreName]);
  const selectedPreviewTrack = playlistTracks.find((track) => track.id === previewTrackId) ?? playlistTracks[0] ?? null;
  useEffect(() => {
    const currentTracks = new Map(playlistTracks.map((track) => [track.id, track.file]));
    for (const [id, preparation] of preparedSongsRef.current) {
      if (currentTracks.get(id) !== preparation.file) preparedSongsRef.current.delete(id);
    }
  }, [playlistTracks]);
  useEffect(() => {
    if (!selectedPreviewTrack) {
      setSongPreview({ trackId: '', status: 'idle' });
      return;
    }
    let current = true;
    const { id } = selectedPreviewTrack;
    setSongPreview({ trackId: id, status: 'loading', progress: 0 });
    void prepareTrack(selectedPreviewTrack, (progress) => {
      if (current) setSongPreview((previous) => previous.trackId === id
        ? { ...previous, status: 'loading', progress }
        : previous);
    }).then((prepared) => {
      if (!current) return;
      setSongPreview({
        trackId: id,
        status: prepared.features.analyzed ? 'ready' : 'unavailable',
        features: prepared.features,
        message: prepared.warning || undefined,
      });
    }).catch((error: unknown) => {
      if (!current) return;
      setSongPreview({
        trackId: id,
        status: 'error',
        message: error instanceof Error ? error.message : 'The song analysis failed.',
      });
    });
    return () => { current = false; };
  }, [selectedPreviewTrack?.id, selectedPreviewTrack?.file, prepareTrack]);
  const canStart = !playlistBusy && playlistTracks.length > 0;
  const isGame = state === 'COUNTDOWN' || state === 'PLAYING' || state === 'BOSS_INTRO' || state === 'BOSS' || state === 'GAME_OVER';

  return (
    <main className="arcade-app" data-testid="page-rhythm-fighter">
      <div className="scanline" aria-hidden="true" />
      {!isGame && (
        <section className="upload-shell arcade-grid flex min-h-[100dvh] items-center justify-center px-4 py-10" data-testid="panel-upload">
          <div className="w-full max-w-[560px]">
            <div className="mb-9 text-center">
              <div className="mb-3 flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-[.32em] text-cyan-300/60"><Zap className="h-3.5 w-3.5" /> Local signal combat</div>
              <h1 className="title-mark text-5xl font-extrabold sm:text-7xl" data-testid="text-title">RHYTHM FIGHTER</h1>
              <p className="mt-3 font-mono text-[11px] uppercase tracking-[.22em] text-slate-500">Music-driven aerial combat</p>
            </div>
            {state === 'ANALYZING' ? (
              <div className="hud-panel rounded-xl p-7 sm:p-9" data-testid="panel-analyzing">
                <div className="mb-6 flex items-center gap-3"><Headphones className="h-5 w-5 text-cyan-300" /><div><p className="font-mono text-xs uppercase tracking-[.18em] text-cyan-300">Analyzing music</p><p className="mt-1 text-sm text-slate-500">{analysisMessage}</p></div></div>
                <div className="h-3 overflow-hidden rounded-full bg-slate-900"><div className="h-full rounded-full bg-cyan-300 transition-[width] duration-300" style={{ width: `${analysisProgress}%` }} /></div>
                <div className="mt-3 flex justify-between font-mono text-[10px] uppercase text-slate-500"><span>Stage {stageProgress}%</span><span data-testid="text-analysis-progress">{analysisProgress}%</span><span>Boss {bossProgress}%</span></div>
                <p className="mt-5 text-center text-xs leading-relaxed text-slate-400">This pre-match scan shapes enemy and boss designs. During play, live music drives new waves, attacks, and movement changes.</p>
                <p className="mt-8 text-center font-mono text-[10px] uppercase tracking-[.14em] text-slate-600">Features stay in your browser. No upload.</p>
              </div>
            ) : (
              <>
                <PlaylistSetup tracks={playlistTracks} onTracks={setPlaylistTracks} random={randomOrder} onRandom={setRandomOrder}
                  randomClips={randomClips} onRandomClips={setRandomClips} onBusy={setPlaylistBusy}
                  selectedTrackId={selectedPreviewTrack?.id ?? null} onSelectTrack={setPreviewTrackId} preview={songPreview} />
                <button onClick={startAnalysis} disabled={!canStart} className="action-button mt-5 flex w-full items-center justify-center gap-3 rounded-xl border border-cyan-300/50 bg-cyan-300/10 py-4 font-mono text-xs font-bold uppercase tracking-[.2em] text-cyan-200 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-slate-900/50 disabled:text-slate-600" data-testid="button-analyze"><Crosshair className="h-4 w-4" /> Analyze and play</button>
                {musicWarning && <p role="alert" className="mt-3 text-sm text-amber-200">{musicWarning}</p>}
            <div className="mt-5 flex items-center justify-center gap-2 font-mono text-[10px] uppercase tracking-[.14em] text-slate-600"><Volume2 className="h-3 w-3" /> Shared Drive MP3 library</div>
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
            <canvas ref={canvasRef} className="game-canvas" onPointerDown={onJoystickDown} onPointerMove={onJoystickMove} onPointerUp={onJoystickRelease} onPointerCancel={onJoystickRelease} onLostPointerCapture={onJoystickRelease} data-testid="canvas-game" aria-label="Rhythm Fighter game field. Steer with touch or a game controller; weapons fire automatically." />
            <WeaponHUD {...combatHud} />
            {(state === 'PLAYING' || state === 'BOSS_INTRO' || state === 'BOSS') && !paused && <button type="button" className="pause-button" onClick={togglePause} data-testid="button-pause" aria-label="Pause game" title="Pause game (Esc or P)"><Pause className="h-4 w-4" aria-hidden="true" /><span>Pause</span></button>}
            <div className="hud-top">
              <div className="hud-chip"><div className="font-mono text-[8px] uppercase tracking-[.16em] text-slate-500">Score</div><div className="font-mono text-sm font-bold text-cyan-200" data-testid="text-score">{String(hud.score).padStart(6, '0')}</div></div>
              <div className="hud-chip font-mono" data-testid="text-level"><div className="text-[8px] uppercase tracking-[.16em] text-slate-500">Level</div><div className="text-sm font-bold text-cyan-200">{hud.level}</div></div>
              {['PLAYING', 'BOSS_INTRO', 'BOSS'].includes(state) && <div className="hud-stage-timer font-mono" role="timer" aria-label={state === 'BOSS' ? `Next level in ${bossSecondsLeft} seconds` : `Boss arrives in ${hud.stageSecondsLeft} seconds`} data-testid={state === 'BOSS' ? 'text-boss-time' : 'text-stage-time'}><div className="text-[8px] uppercase tracking-[.12em] text-slate-400">{state === 'BOSS' ? 'Next level' : 'Boss in'}</div><div className="text-sm font-bold tabular-nums text-cyan-200">{state === 'BOSS' ? bossSecondsLeft : hud.stageSecondsLeft}s</div></div>}
              <div className="text-right"><div className="font-mono text-[8px] uppercase tracking-[.16em] text-slate-500">Threat</div><div className="font-mono text-xs font-bold text-orange-300" data-testid="text-behavior">{hud.behavior}</div></div>
            </div>
            <div className="hud-bottom">
              {bossHud.length > 0 && <div className="mb-2" data-testid="hud-bosses">
                <div className="mb-1 flex justify-between font-mono text-[9px] uppercase text-orange-200"><span>{bossHud.filter((boss) => boss.health > 0).length} active bosses</span><span>Newest song leads</span></div>
                <div className="pointer-events-auto flex gap-1 overflow-x-auto" tabIndex={0} aria-label="Active boss health">{bossHud.map((boss) => <div key={boss.id} className="min-w-[64px] flex-1" aria-label={`Level ${boss.level} boss: ${Math.ceil(boss.health)} of ${boss.maxHealth} health`}>
                  <div className="truncate font-mono text-[9px] text-orange-200">L{boss.level} <span data-testid={boss.id === bossHud.at(-1)?.id ? 'text-boss-health' : undefined}>{boss.health === 0 ? 'down' : bossHud.length === 1 ? `${Math.ceil(boss.health)} / ${boss.maxHealth}` : `${Math.ceil(boss.health / boss.maxHealth * 100)}%`}</span></div>
                  <div className="boss-health"><div style={{ width: `${boss.health / boss.maxHealth * 100}%` }} /></div>
                </div>)}</div>
              </div>}
              <p className="controller-status mb-2" data-testid="controller-status" aria-live="polite"><Gamepad2 className="h-3 w-3 shrink-0" />{controllerStatus}</p>
              <div className="flex items-end justify-between gap-2"><div className="hull-status"><div className="mb-1 font-mono text-[8px] uppercase tracking-[.16em] text-slate-400">Hull integrity</div><div className={`whitespace-nowrap font-mono text-2xl font-bold ${hud.health <= 25 ? 'text-red-300' : hud.health <= 50 ? 'text-orange-300' : 'text-green-300'}`} data-testid="status-health">{hud.health} <span className="text-xs font-normal text-slate-400">/ {PLAYER_MAX_HEALTH}</span></div></div><div className="steering-hint flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.14em] text-cyan-300/60"><Gamepad2 className="h-3 w-3" /> Touch, stick, or D-pad</div></div>
            </div>
            {musicWarning && <p className="mx-auto mb-3 max-w-md rounded border border-amber-400/30 bg-amber-950/30 px-3 py-2 text-center text-xs text-amber-200" role="status" data-testid="text-music-warning">{musicWarning}</p>}
            {audioError && !paused && <div className="audio-alert" role="alert"><span>{audioError}</span><button type="button" onClick={retryAudio} className="rounded border border-orange-300 px-2 py-1 font-bold text-orange-200">Retry audio</button></div>}
            {state === 'COUNTDOWN' && <div className="state-overlay" data-testid="overlay-countdown"><div><p className="font-mono text-[10px] uppercase tracking-[.28em] text-cyan-300">Get ready</p><div className="mt-2 text-8xl font-extrabold text-cyan-200" data-testid="text-countdown">{countdown}</div><p className="mt-1 font-mono text-[10px] uppercase tracking-[.18em] text-slate-500">Touch, left stick, or D-pad · weapons auto-fire</p></div></div>}
            {paused && <div className="state-overlay" data-testid="overlay-paused" role="dialog" aria-modal="true" aria-labelledby="pause-title"><div className="overlay-card"><h2 id="pause-title" className="text-4xl font-extrabold tracking-[.08em] text-cyan-200">PAUSED</h2><p className="mt-3 text-slate-300">Combat, timer, and music are paused.</p><button type="button" autoFocus onClick={togglePause} className="action-button mt-6 inline-flex items-center gap-2 rounded-lg border border-cyan-300/50 bg-cyan-300/10 px-5 py-3 font-mono text-xs font-bold uppercase text-cyan-200" data-testid="button-resume"><Play className="h-4 w-4" aria-hidden="true" /> Resume game</button><p className="mt-3 font-mono text-[10px] text-slate-400">Esc or P to resume</p></div></div>}
            {state === 'BOSS_INTRO' && <div className="pointer-events-none absolute inset-x-0 top-[17%] text-center" data-testid="overlay-boss-intro"><p className="font-mono text-xs font-bold uppercase tracking-[.24em] text-orange-300">Stage {hud.level} complete · incoming boss</p></div>}
            {state === 'GAME_OVER' && finalRun && <div className="state-overlay" data-testid="overlay-game-over"><div className="overlay-card">
              <p className="font-mono text-[10px] uppercase tracking-[.28em] text-red-300">Flight terminated</p>
              <h2 className="mt-3 text-5xl font-extrabold tracking-[.08em] text-red-200">SYSTEM DOWN</h2>
              <p className="mt-3 font-mono text-xs uppercase tracking-[.12em] text-slate-300" data-testid="text-final-run-score">Final score {finalRun.score}</p>
              <p className="mt-2 font-mono text-[10px] uppercase tracking-[.12em] text-slate-400" data-testid="text-run-progress">
                Level reached {finalRun.levelReached} · {finalRun.bossLevelReached === null ? 'No boss reached' : `Boss reached at level ${finalRun.bossLevelReached}`}
              </p>
              <form className="mt-5" onSubmit={handleSaveRunScore}>
                <label htmlFor="run-score-name" className="mb-2 block font-mono text-[10px] uppercase tracking-[.16em] text-cyan-200">Enter a callsign to save this run</label>
                <input
                  id="run-score-name"
                  className="w-full rounded-md border border-cyan-300/40 bg-slate-950/80 px-3 py-2 text-center font-mono text-sm text-white outline-none focus:border-cyan-200 focus:ring-2 focus:ring-cyan-300/30"
                  value={scoreName}
                  onChange={(event) => setScoreName(event.currentTarget.value)}
                  maxLength={24}
                  autoComplete="nickname"
                  aria-label="Name for saved run score"
                  data-testid="input-run-score-name"
                />
                <p className="mt-1 font-mono text-[9px] text-slate-500">Up to 24 characters</p>
                <p className="mt-2 min-h-4 font-mono text-[10px] text-cyan-200" role="status" aria-live="polite" data-testid="status-run-score">
                  {scoreSaveState === 'saving' && 'Saving run…'}
                  {scoreSaveState === 'saved' && 'Run score saved'}
                  {scoreSaveState === 'error' && 'Could not save this run. Check your connection and retry.'}
                </p>
                <div className="mt-3 flex flex-col justify-center gap-2 sm:flex-row">
                  {scoreSaveState !== 'saved' && <button
                    type="submit"
                    disabled={!scoreName.trim() || scoreSaveState === 'saving'}
                    className="action-button inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-300/50 bg-cyan-300/10 px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[.18em] text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                    data-testid="button-save-run-score"
                  >{scoreSaveState === 'saving' ? 'Saving…' : scoreSaveState === 'error' ? 'Retry saving score' : 'Save run score'}</button>}
                  <button type="button" onClick={() => beginCountdown(true)} className="action-button inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-300/50 bg-cyan-300/10 px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[.18em] text-cyan-200" data-testid="button-replay-game-over"><RotateCcw className="h-3.5 w-3.5" /> Replay mission</button>
                </div>
              </form>
            </div></div>}
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
