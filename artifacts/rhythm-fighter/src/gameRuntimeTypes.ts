import type { AudioFingerprint } from './musicAnalysis';
import type { AttackPattern, FormProfile, MotionPattern, ShapeIdentity } from './encounterRules';
import { BOSS_ENCOUNTER_SECONDS, encounterProgress, type BossEncounter } from './gameRules';
import type { LaserBeam, Pickup, PlayerShot } from './weaponRules';
import type { SongDesign } from './songDesign';

export const ARENA_WIDTH = 420;
export const ARENA_HEIGHT = 900;

export type GameState = 'UPLOAD' | 'ANALYZING' | 'COUNTDOWN' | 'PLAYING' | 'BOSS_INTRO' | 'BOSS' | 'GAME_OVER';
export type Behavior = 'PATROL' | 'ZIGZAG' | 'FORMATION' | 'SWARM' | 'DIVE' | 'SHOOTER' | 'TANK';
export type FeatureSet = {
  duration: number;
  signature: AudioFingerprint;
  motifs: AudioFingerprint[];
  analyzedSeconds: number;
  analyzed: boolean;
  songKey?: string;
  design?: SongDesign;
};
export type LiveFeatures = AudioFingerprint;
export type EnemyShape = ShapeIdentity;
export type ProjectileKind = 'ORB' | 'BOLT' | 'SHARD' | 'RING' | 'SEEKER';
export type BossPhase = 'INTRO' | 'PHASE1' | 'PHASE2' | 'PHASE3' | 'DYING';

export type AudioReactiveTrack = {
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
  signature: LiveFeatures;
};

export type PlayerEntity = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  health: number;
  invincible: number;
  fireTimer: number;
  frame: number;
  debuffUntil?: number;
};

export type EnemyEntity = {
  x: number; y: number; radius: number; health: number; maxHealth: number; speed: number;
  behavior: Behavior; fireRate: number; fireTimer: number; frame: number; zigDir: number;
  formX: number; formY: number; diving: boolean; dvx: number; dvy: number; shape: EnemyShape;
  projectile: ProjectileKind; exiting: boolean; alive: boolean; form: FormProfile;
  motion: MotionPattern; designMotion: MotionPattern | 'HUNT'; motionChangedAt: number;
  pattern: AttackPattern; subBoss: boolean; ownerId?: number; originLevel?: number; frozenUntil?: number;
  color?: string; designProjectile?: ProjectileKind;
  designSignal?: LiveFeatures; musicSection?: number;
  stunnedUntil?: number; confusedUntil?: number; buffUntil?: number;
};
export type BulletEntity = PlayerShot;
export type EnemyBulletEntity = {
  x: number; y: number; vx: number; vy: number; damage: number; alive: boolean;
  kind?: ProjectileKind; radius: number; spin?: number; frozenUntil?: number; ownerId?: number;
  seekSecondsLeft?: number;
};
export type ParticleEntity = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; pixel?: boolean; size?: number };
export type DebrisEntity = {
  x: number; y: number; vx: number; vy: number; life: number; maxLife: number;
  color: string; size: number; angle: number; spin: number;
  generation?: number; split?: boolean; sparkTimer?: number;
};
export type BossEntity = {
  x: number; y: number; radius: number; health: number; maxHealth: number;
  shape: EnemyShape; designShape: EnemyShape; projectile: ProjectileKind; pattern: AttackPattern;
  motion: MotionPattern; designMotion: MotionPattern | 'HUNT'; motionChangedAt: number;
  form: FormProfile; parts: number; phase: BossPhase; frame: number; phaseFrame: number;
  vx: number; fireTimer: number; dyingTimer: number; subBossTimer: number; revision: number; frozenUntil?: number;
  color?: string; designProjectile?: ProjectileKind; secondaryAt?: number; secondaryIndex?: number;
  designSignal?: LiveFeatures; musicSection?: number; abilitySerial?: number;
};
export type ActiveBoss = BossEntity & {
  id: number;
  originLevel: number;
  features: FeatureSet;
  audio: HTMLAudioElement | null;
  reactive: AudioReactiveTrack | null;
};
export type Joystick = { pointerId: number | null; x: number; y: number; dx: number; dy: number };
export type DelayedBlast = {
  x: number; y: number; radius: number; createdAt: number; explodeAt: number; ownerId: number;
  kind: 'BLAST' | 'DEBUFF'; detonated: boolean;
};
export type Shockwave = { x: number; y: number; color: string; startedAt: number; until: number };
export type BossSweepBeam = {
  ownerId: number;
  createdAt: number;
  activeAt: number;
  endsAt: number;
  startY: number;
  endY: number;
  safeStartX: number;
  safeDirection: -1 | 1;
  safeSpeed: number;
  safeWidth: number;
  thickness: number;
};
export type CombatArsenal = {
  weapon: ReturnType<typeof import('./weaponRules').newWeaponState>;
  drops: Pickup[];
  beam: LaserBeam | null;
  splashes: { x: number; y: number; until: number }[];
  bombUntil: number;
  message: string;
  messageUntil: number;
  dropMisses: number;
};
export type CombatWorld = {
  state: GameState;
  level: number;
  stageFeatures: FeatureSet | null;
  bossFeatures: FeatureSet | null;
  audioContext: AudioContext | null;
  stageReactive: AudioReactiveTrack | null;
  bossReactive: AudioReactiveTrack | null;
  player: PlayerEntity;
  enemies: EnemyEntity[];
  bullets: BulletEntity[];
  enemyBullets: EnemyBulletEntity[];
  bossBeams: BossSweepBeam[];
  particles: ParticleEntity[];
  debris: DebrisEntity[];
  blasts: DelayedBlast[];
  shockwaves: Shockwave[];
  boss: BossEntity | null;
  score: number;
  frame: number;
  songStart: number;
  bossStart: number;
  beatIndex: number;
  spawnIndex: number;
  spawnCooldown: number;
  stageDone: boolean;
  bossArrivalAt: number;
  introTimer: number;
  countdown: number;
  countdownTimer: number;
  currentBehavior: string;
};

export type EncounterState<TBoss extends ActiveBoss = ActiveBoss> = {
  bosses: readonly TBoss[];
  encounter: Readonly<BossEncounter> | null;
  serial: number;
  protectedUntil: number;
};

export type CombatViewSnapshot = {
  combatHud: {
    weapon: CombatArsenal['weapon'];
    now: number;
    message: string;
    messageUntil: number;
  };
  bosses: { id: number; level: number; health: number; maxHealth: number }[];
  bossSecondsLeft: number;
  hud: {
    level: number;
    score: number;
    health: number;
    behavior: string;
    phase: string;
    bossHealth: number;
    bossMaxHealth: number;
    stageSecondsLeft: number;
  };
};

/** Build the immutable presentation data React renders; entity collections stay in the runtime. */
export function createCombatViewSnapshot(
  world: CombatWorld,
  arsenal: CombatArsenal,
  bosses: readonly ActiveBoss[],
  encounter: Readonly<BossEncounter> | null,
  now: number,
  stageSecondsLeft: number,
): CombatViewSnapshot {
  const phase = world.boss?.phase ?? '';
  return {
    combatHud: {
      weapon: { ...arsenal.weapon, companions: [...arsenal.weapon.companions] },
      now: now / 1000,
      message: arsenal.message,
      messageUntil: arsenal.messageUntil,
    },
    bosses: bosses.map((boss) => ({
      id: boss.id, level: boss.originLevel, health: boss.health, maxHealth: boss.maxHealth,
    })),
    bossSecondsLeft: encounter ? encounterProgress(encounter, now).secondsLeft : BOSS_ENCOUNTER_SECONDS,
    hud: {
      level: world.level,
      score: world.score,
      health: world.player.health,
      behavior: world.currentBehavior || 'SCANNING',
      phase,
      bossHealth: world.boss?.health ?? 0,
      bossMaxHealth: world.boss?.maxHealth ?? 1,
      stageSecondsLeft: world.state === 'BOSS_INTRO'
        ? Math.ceil(Math.max(0, world.introTimer) / 60)
        : stageSecondsLeft,
    },
  };
}