import { generateForm } from '../encounterRules';
import { EncounterScheduler } from '../encounterScheduler';
import { encounterProgress } from '../gameRules';
import type { ActiveBoss, CombatArsenal, CombatWorld, FeatureSet, PlayerEntity } from '../gameRuntimeTypes';
import { blankLiveFeatures } from '../soundtrackLifecycle';
import { levelPair, type LocalTrack } from '../playlistRules';
import type { PickupType } from '../weaponRules';

type PreparedTrack = LocalTrack & { url: string; features: FeatureSet };
type SpectrumBand = 'bass' | 'bright';

export type AudioStrikeTestApi = {
  snapshot: () => object;
  setScore: (score: number) => void;
  finishBoss: (id?: number) => void;
  spawnSubBoss: () => void;
  setEncounterElapsed: (seconds: number) => void;
  setBossHealth: (id: number, health: number) => void;
  castSecondary: (id: number, kind: 'BLAST' | 'DEBUFF' | 'BUFF') => void;
  setAudioSpectrum: (id: number, band: SpectrumBand) => void;
  drop: (type: PickupType, x?: number, y?: number) => void;
  setPlayer: (values: Partial<PlayerEntity>) => void;
  clearArena: () => void;
  spawnTarget: (x: number, y: number, health: number, subBoss?: boolean, speed?: number, fireRate?: number) => void;
  enemyShot: (x: number, y: number, damage?: number) => void;
  freezeAt: (x: number, y: number) => void;
  setVolley: (value: number) => void;
  endRun: () => void;
};

type HarnessWindow = Window & {
  __AUDIOSTRIKE_TEST_MODE__?: boolean;
  __AUDIOSTRIKE_TEST__?: AudioStrikeTestApi;
};

type HarnessRuntime = {
  getGame: () => CombatWorld;
  getRunProgress: () => { levelReached: number; bossLevelReached: number | null };
  getArsenal: () => CombatArsenal;
  getEncounters: () => EncounterScheduler<ActiveBoss>;
  getStageAudio: () => HTMLAudioElement | null;
  getBossAudio: () => HTMLAudioElement | null;
  getPrepared: () => PreparedTrack[];
  paused: () => boolean;
  stars: readonly { y: number }[];
  audibleTrack: () => HTMLAudioElement | null;
  gameNow: () => number;
  damageProtected: () => boolean;
  finishBoss: (id?: number) => void;
  spawnSubBoss: () => void;
  addDrop: (type: PickupType, x: number, y: number) => void;
  clearPlayerShots: () => void;
  makeEnemyShot: (x: number, y: number, damage: number) => void;
  freezeAt: (x: number, y: number) => void;
  endRun: () => void;
};

export function installGameTestHarness(target: HarnessWindow, runtime: HarnessRuntime) {
  if (!target.__AUDIOSTRIKE_TEST_MODE__) return () => undefined;

  target.__AUDIOSTRIKE_TEST__ = {
    snapshot: () => {
      const game = runtime.getGame();
      const arsenal = runtime.getArsenal();
      const encounters = runtime.getEncounters();
      const now = runtime.gameNow();
      const owner = encounters.livingBoss();
      return {
        state: game.state,
        paused: runtime.paused(),
        level: game.level,
        runProgress: runtime.getRunProgress(),
        spawnIndex: game.spawnIndex,
        enemyCount: game.enemies.length,
        subBossCount: game.enemies.filter((enemy) => enemy.subBoss).length,
        hostileShots: game.enemyBullets.length,
        bossHealth: game.boss?.health,
        bossMaxHealth: game.boss?.maxHealth,
        bossX: game.boss?.x,
        bossY: game.boss?.y,
        bossRadius: game.boss?.radius,
        bossShape: game.boss?.shape,
        bossMotion: game.boss?.motion,
        bosses: encounters.bosses.map((boss) => ({
          id: boss.id, level: boss.originLevel, health: boss.health, maxHealth: boss.maxHealth,
          x: boss.x, y: boss.y, phase: boss.phase, frame: boss.frame, dyingTimer: boss.dyingTimer,
          src: boss.audio?.src, paused: boss.audio?.paused, fireTimer: boss.fireTimer,
           shape: boss.shape, color: boss.color, projectile: boss.projectile, secondaryAt: boss.secondaryAt,
        })),
        encounter: encounters.encounter ? {
          ...encounters.encounter, ...encounterProgress(encounters.encounter, now),
        } : null,
        audibleBossId: owner?.id ?? null,
        audibleSrc: runtime.audibleTrack()?.src,
        audibleFeatures: (owner?.reactive ?? game.stageReactive)?.lastFeatures,
        damageProtected: runtime.damageProtected(),
        stageAnalysis: game.stageFeatures ? {
          ...game.stageFeatures.signature, analyzed: game.stageFeatures.analyzed,
          analyzedSeconds: game.stageFeatures.analyzedSeconds, motifCount: game.stageFeatures.motifs.length,
          songKey: game.stageFeatures.songKey, design: game.stageFeatures.design,
        } : null,
        bossAnalysis: game.bossFeatures ? {
          ...game.bossFeatures.signature, analyzed: game.bossFeatures.analyzed,
          analyzedSeconds: game.bossFeatures.analyzedSeconds, motifCount: game.bossFeatures.motifs.length,
          songKey: game.bossFeatures.songKey, design: game.bossFeatures.design,
        } : null,
        stageTime: (now - game.songStart) / 1000,
        stageAudioTime: runtime.getStageAudio()?.currentTime,
        stageAudioPaused: runtime.getStageAudio()?.paused,
        stageAudioSrc: runtime.getStageAudio()?.src,
        trackOrder: runtime.getPrepared().map((track) => track.title),
        stageTrackTitle: runtime.getPrepared().length ? levelPair(runtime.getPrepared(), game.level).stage.title : null,
        bossTrackTitle: runtime.getPrepared().length ? levelPair(runtime.getPrepared(), game.level).boss.title : null,
        bossAudioTime: runtime.getBossAudio()?.currentTime,
        bossAudioPaused: runtime.getBossAudio()?.paused,
        bossAudioSrc: runtime.getBossAudio()?.src,
        starY: runtime.stars[0]?.y,
        playerHealth: game.player.health,
        player: { ...game.player },
        now: now / 1000,
        weapon: { ...arsenal.weapon, companions: [...arsenal.weapon.companions] },
        drops: arsenal.drops.map((drop) => ({ ...drop })),
        shots: game.bullets.map((shot) => ({ ...shot })),
        beam: arsenal.beam,
        pixelCount: game.particles.filter(p => p.pixel).length,
        debris: game.debris.map(d => ({ generation: d.generation, size: d.size })),
        shockwaves: game.shockwaves.map(w => ({ ...w })),
        blasts: game.blasts.map(b => ({ ...b })),
        enemies: game.enemies.map((enemy) => ({
          x: enemy.x, y: enemy.y, health: enemy.health, shape: enemy.shape,
          motion: enemy.motion, pattern: enemy.pattern, projectile: enemy.projectile, subBoss: enemy.subBoss,
          ownerId: enemy.ownerId, frame: enemy.frame, speed: enemy.speed,
          frozenUntil: enemy.frozenUntil, fireTimer: enemy.fireTimer, alive: enemy.alive,
          exiting: enemy.exiting, fireRate: enemy.fireRate,
          stunnedUntil: enemy.stunnedUntil, confusedUntil: enemy.confusedUntil, buffUntil: enemy.buffUntil,
          color: enemy.color,
        })),
        enemyShots: game.enemyBullets.map((shot) => ({ ...shot })),
      };
    },
    setScore: (score) => { runtime.getGame().score = score; },
    finishBoss: runtime.finishBoss,
    spawnSubBoss: runtime.spawnSubBoss,
    setEncounterElapsed: (seconds) => runtime.getEncounters().setEncounterStart(runtime.gameNow() - seconds * 1000),
    setBossHealth: (id, health) => {
      const boss = runtime.getEncounters().findBoss(id);
      if (boss) {
        boss.health = health;
        boss.maxHealth = Math.max(boss.maxHealth, health);
      }
    },
    castSecondary: (id, kind) => {
      const boss = runtime.getEncounters().findBoss(id);
      if (boss) { boss.secondaryAt = runtime.gameNow() / 1000 - 1; boss.secondaryIndex = ['BLAST', 'DEBUFF', 'BUFF'].indexOf(kind); }
    },
    setAudioSpectrum: (id, band) => {
      const track = runtime.getEncounters().findBoss(id)?.reactive;
      if (!track) throw new Error('Boss analyser is unavailable');
      // Deterministic analyser input, still consumed through the real audible-track selection.
      track.analyser.getByteFrequencyData = (array) => {
        array.fill(0);
        const binWidth = track.analyser.context.sampleRate / track.analyser.fftSize;
        const from = Math.floor((band === 'bass' ? 35 : 3000) / binWidth);
        const to = Math.ceil((band === 'bass' ? 180 : 9000) / binWidth);
        array.fill(220, from, to);
      };
      track.analyser.getByteTimeDomainData = (array) => {
        for (let index = 0; index < array.length; index += 1) array[index] = 128 + Math.round(Math.sin(index * .2) * 50);
      };
    },
    drop: (type, x, y) => {
      const player = runtime.getGame().player;
      if (type === 'BOMB') runtime.clearPlayerShots();
      runtime.addDrop(type, x ?? player.x, y ?? player.y);
    },
    setPlayer: (values) => Object.assign(runtime.getGame().player, values),
    clearArena: () => {
      const game = runtime.getGame();
      const arsenal = runtime.getArsenal();
      game.enemies = [];
      game.bullets = [];
      game.enemyBullets = [];
      game.spawnCooldown = 1e9;
      arsenal.drops = [];
    },
    spawnTarget: (x, y, health, subBoss = false, speed = 0, fireRate = 0) => {
      const game = runtime.getGame();
      game.enemies.push({
        x, y, radius: 18, health, maxHealth: health, speed,
        behavior: 'PATROL', fireRate, fireTimer: 0, frame: 0, zigDir: 1,
        formX: x, formY: y, diving: false, dvx: 0, dvy: 0, shape: 'CIRCLE',
        projectile: 'ORB', designProjectile: 'ORB', exiting: false, alive: true, subBoss,
        form: generateForm(blankLiveFeatures(), 1), motion: 'SWEEP', designMotion: 'SWEEP',
        motionChangedAt: speed ? Infinity : runtime.gameNow() / 1000, pattern: 'TRACK',
      });
    },
    enemyShot: (x, y, damage = 5) => runtime.makeEnemyShot(x, y, damage),
    freezeAt: (x, y) => runtime.freezeAt(x, y),
    setVolley: (value) => { runtime.getArsenal().weapon.volley = value; },
    endRun: runtime.endRun,
  };
  return () => { delete target.__AUDIOSTRIKE_TEST__; };
}
