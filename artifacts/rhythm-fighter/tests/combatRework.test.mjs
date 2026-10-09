import test from 'node:test';
import assert from 'node:assert/strict';
import { createSongDesign, createSongDesignPreview, songSpawnIdentity, songSectionAtTime } from '../src/songDesign.ts';
import { generateForm } from '../src/encounterRules.ts';
import { advanceSeekerProjectiles, chooseProjectile, createEnemyProjectile, firePattern, FrameCombatSimulation } from '../src/combatSimulation.ts';
import { pixelBurst, bossDeathBurst, advanceCombatEffects } from '../src/combatEffects.ts';
import {
  disruptEnemies, castBossAbility, advanceBlasts, advanceBossSweepBeams, bossSweepHitsPlayer, claimBossSweepDamage,
  bossSweepPosition, blastMovementField, BLAST_CHARGE_SECONDS, BOSS_SWEEP_TELEGRAPH_SECONDS,
} from '../src/bossAbilities.ts';
import { fireWeapon, newWeaponState, pickDrop, weaponStats, WEAPON_BALANCE } from '../src/weaponRules.ts';
import { createPlaybackWindow, playbackTimeForElapsed, setPlaybackWindow } from '../src/playbackClips.ts';

const signal = { rms: .5, onset: .3, low: .8, mid: .2, high: .05, centroid: .15, flatness: .1, pulse: true, tempo: 120 };
const features = (key, s = signal) => ({ duration: 80, analyzedSeconds: 80, analyzed: true, signature: s, motifs: Array(8).fill(s), songKey: key });
const enemy = () => ({ x: 150, y: 200, radius: 18, speed: 5, frame: 0, formX: 150, formY: 200, health: 100,
  maxHealth: 100, alive: true, fireTimer: 0, fireRate: 50, zigDir: 1, motion: 'SWEEP', behavior: 'PATROL', subBoss: false,
  shape: 'SQUARE', form: generateForm(signal, 0) });
const world = () => ({ enemies: [enemy()], player: { x: 210, y: 600, vx: 0, vy: 0 }, blasts: [], bossBeams: [], particles: [], debris: [], shockwaves: [] });
const simulation = new FrameCombatSimulation({ width: 420, height: 900, playerWidth: 20, playerHeight: 32, maxSpeed: 6.875, acceleration: .42, deceleration: .55 });

test('boss attack projectiles stay indestructible while ordinary enemy shots can be destroyed', () => {
  const bossLaser = [];
  firePattern(bossLaser, 100, 100, { x: 100, y: 500 }, 'TRACK', 'BOLT', 8, 8, 0, 7, true);
  assert.equal(bossLaser.length, 1);
  assert.equal(bossLaser[0].indestructible, true);
  const ordinary = [];
  firePattern(ordinary, 100, 100, { x: 100, y: 500 }, 'TRACK', 'BOLT', 8, 8, 0, 7);
  assert.notEqual(ordinary[0].indestructible, true);
});

test('song blueprints are stable and contrasting songs create different clean shape/palette identities', () => {
  const bass = features('bass-audio'), bright = features('bright-audio', { ...signal, low: .05, high: .9, centroid: .8 });
  assert.deepEqual(createSongDesign(bass), createSongDesign(bass));
  assert.notDeepEqual(createSongDesign(bass).shapes, createSongDesign(bright).shapes);
  assert.notDeepEqual(createSongDesign(bass).colors, createSongDesign(bright).colors);
  assert.notEqual(createSongDesign(bass).projectile, createSongDesign(bright).projectile);
  const shapes = new Set(Array.from({ length: 30 }, (_, i) => songSpawnIdentity(bass, signal, i).shape));
  assert.equal(shapes.size, 5);
  assert.ok(createSongDesign(bright).shapes.includes('ELBOW'));
  assert.notEqual(generateForm(signal, 1).widthScale, generateForm({ ...signal, low: .05, high: .9 }, 1).widthScale);
});

test('song style previews are deterministic representatives and leave the saved analysis unchanged', () => {
  const bass = features('preview-bass'), bright = features('preview-bright', { ...signal, low: .05, high: .9, centroid: .8 });
  const before = structuredClone(bass);
  const bassPreview = createSongDesignPreview(bass);
  assert.deepEqual(createSongDesignPreview(bass), bassPreview);
  assert.notDeepEqual(createSongDesignPreview(bright), bassPreview);
  assert.deepEqual(bass, before, 'preview generation does not attach or mutate analysis data');
  assert.equal(bassPreview.enemy.projectile, createSongDesign(bass).sections[0].projectile);
  assert.equal(bassPreview.boss.shape, createSongDesign(bass).sections[0].shape);
  assert.equal(bassPreview.boss.wings, createSongDesign(bass).wings);
});

test('full-song motifs produce per-section enemy designs and follow playback position', () => {
  const song = features('changing-song');
  song.duration = 80;
  song.analyzedSeconds = 80;
  song.motifs = [
    signal,
    { ...signal, low: .04, mid: .12, high: .88, centroid: .9, flatness: .58 },
    { ...signal, low: .18, mid: .79, high: .03, centroid: .35, flatness: .18 },
    { ...signal, low: .56, mid: .32, high: .12, centroid: .18, flatness: .8 },
    { ...signal, low: .09, mid: .39, high: .52, centroid: .74, flatness: .72 },
    { ...signal, low: .91, mid: .04, high: .05, centroid: .12, flatness: .08 },
    { ...signal, low: .15, mid: .26, high: .59, centroid: .81, flatness: .31 },
    { ...signal, low: .35, mid: .58, high: .07, centroid: .4, flatness: .93 },
  ];
  const design = createSongDesign(song);
  song.design = design;
  assert.equal(songSectionAtTime(song, 0, 80), 0);
  assert.equal(songSectionAtTime(song, 70, 80), 7);
  assert.ok(new Set(design.sections.map((section) => section.color)).size > 1);
  assert.ok(new Set(design.sections.map((section) => section.projectile)).size >= 3);
  assert.notDeepEqual(songSpawnIdentity(song, song.motifs[0], 1, 0), songSpawnIdentity(song, song.motifs[5], 1, 5));
});

test('bright onset motifs select one readable seeker shot with bounded homing', () => {
  const seekerSignal = { ...signal, onset: .9, centroid: .75, high: .42, low: .2, mid: .38 };
  const song = features('seeker-song');
  song.motifs = [signal, seekerSignal];
  song.design = createSongDesign(song);
  assert.equal(song.design.sections[1].projectile, 'SEEKER');
  assert.equal(songSpawnIdentity(song, seekerSignal, 3, 1).projectile, 'SEEKER');
  assert.equal(chooseProjectile(seekerSignal, 'PATROL'), 'SEEKER');

  const shots = [];
  firePattern(shots, 100, 100, { x: 150, y: 300 }, 'BURST', 'SEEKER', 8, 3, 1, 7);
  assert.equal(shots.length, 1, 'seeker fire is a single projectile even for multi-shot patterns');
  const seeker = shots[0];
  assert.equal(seeker.kind, 'SEEKER');
  const initialSpeed = Math.hypot(seeker.vx, seeker.vy);
  const initialTurn = Math.atan2(seeker.vy, seeker.vx);
  advanceSeekerProjectiles([seeker], { x: 250, y: 100 }, 6);
  assert.ok(Math.atan2(seeker.vy, seeker.vx) < initialTurn, 'the projectile curves toward the player');
  assert.ok(Math.abs(Math.hypot(seeker.vx, seeker.vy) - initialSpeed) < 1e-9, 'steering does not accelerate the shot');
  assert.ok(seeker.seekSecondsLeft < .72 && seeker.seekSecondsLeft > 0);
  advanceSeekerProjectiles([seeker], { x: 250, y: 100 }, 60);
  assert.equal(seeker.seekSecondsLeft, 0);
  const committedVelocity = { x: seeker.vx, y: seeker.vy };
  advanceSeekerProjectiles([seeker], { x: 0, y: 0 }, 60);
  assert.deepEqual({ x: seeker.vx, y: seeker.vy }, committedVelocity, 'the final trajectory no longer tracks the player');

  const frozen = createEnemyProjectile(100, 100, 0, 8, 3, 'SEEKER');
  frozen.frozenUntil = 10;
  advanceSeekerProjectiles([frozen], { x: 200, y: 100 }, 12);
  assert.equal(frozen.vx, 0, 'frozen seekers do not turn');
  assert.equal(frozen.seekSecondsLeft, .72, 'frozen time does not consume the steering window');
});

test('random playback clips keep the first track at zero and wrap elapsed time inside later 30-second windows', () => {
  assert.equal(createPlaybackWindow(80, false, false), null);
  let randomCalls = 0;
  const first = createPlaybackWindow(80, true, true, () => { randomCalls += 1; return .8; });
  assert.deepEqual(first, { startSeconds: 0, endSeconds: 30 });
  assert.equal(randomCalls, 0);
  const later = createPlaybackWindow(80, true, false, () => .5);
  assert.deepEqual(later, { startSeconds: 25, endSeconds: 55 });
  assert.equal(playbackTimeForElapsed(35, 80, later), 30);
  assert.deepEqual(createPlaybackWindow(12, true, false, () => .75), { startSeconds: 0, endSeconds: 12 });
});

test('audio playback loops back to its selected clip start instead of the beginning of the file', () => {
  const events = {};
  const audio = {
    readyState: 1,
    currentTime: 0,
    addEventListener(name, listener) { events[name] = listener; },
  };
  setPlaybackWindow(audio, { startSeconds: 25, endSeconds: 55 });
  assert.equal(audio.currentTime, 25);
  audio.currentTime = 55;
  events.timeupdate();
  assert.equal(audio.currentTime, 25);
  setPlaybackWindow(audio, null);
  assert.equal(audio.currentTime, 0);
});

test('pixel bursts radiate in all directions and boss debris splits into bounded generations', () => {
  const w = world();
  pixelBurst(w.particles, 200, 200, '#77ffff', 40);
  assert.equal(w.particles.length, 40);
  assert.ok(w.particles.every(p => p.pixel));
  for (const signs of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) assert.ok(w.particles.some(p => Math.sign(p.vx) === signs[0] && Math.sign(p.vy) === signs[1]));
  bossDeathBurst(w, { x: 200, y: 200, radius: 55, color: '#77ffff' }, 10);
  assert.equal(w.shockwaves.length, 1); assert.equal(w.debris.length, 22);
  let sawSecondGeneration = false;
  for (let i = 0; i < 100; i++) {
    advanceCombatEffects(w, 1);
    sawSecondGeneration ||= w.debris.some(d => d.generation === 2);
    assert.ok(w.particles.length <= 420 && w.debris.length <= 100);
  }
  assert.ok(sawSecondGeneration, 'splinters themselves shed smaller splinters before fading');
  for (let i = 0; i < 180; i++) advanceCombatEffects(w, 1);
  assert.equal(w.debris.length, 0);
});

test('boss death briefly stuns, then gives exactly five seconds of slow wandering; bosses are not targets', () => {
  const w = world(), e = w.enemies[0];
  disruptEnemies(w, 10);
  assert.equal(e.stunnedUntil, 10.45); assert.equal(e.confusedUntil, 15.45);
  simulation.moveEnemy(e, w.player, signal, 1, 10.2);
  assert.equal(e.x, 150); assert.equal(e.frame, 0);
  assert.equal(simulation.moveEnemy(e, w.player, signal, 1, 11), .28);
  assert.equal(simulation.moveEnemy(e, w.player, signal, 1, 15.45), 1);
});

test('boss blast zones charge quickly, grow with level, and buffs expire rather than stack', () => {
  const w = world(), boss = { id: 1, originLevel: 5, features: features('bass'), secondaryAt: 0, secondaryIndex: 0 };
  assert.equal(castBossAbility(w, boss, signal, 10), 'BLAST');
  assert.equal(w.blasts.length, 3, 'level five casts three simultaneous circles');
  assert.ok(w.blasts.every(b => Math.abs(b.explodeAt - b.createdAt - BLAST_CHARGE_SECONDS) < 1e-9));
  assert.equal(advanceBlasts(w, 10 + BLAST_CHARGE_SECONDS - .01).length, 0);
  assert.equal(advanceBlasts(w, 10 + BLAST_CHARGE_SECONDS).length, 3);
  assert.equal(advanceBlasts(w, 10 + BLAST_CHARGE_SECONDS + .1).length, 0);
  boss.secondaryAt = 15; boss.secondaryIndex = 1;
  assert.equal(castBossAbility(w, boss, signal, 16), 'DEBUFF');
  assert.equal(w.blasts.at(-1).kind, 'DEBUFF');
  boss.secondaryAt = 16; boss.secondaryIndex = 2;
  assert.equal(castBossAbility(w, boss, signal, 17), 'BUFF');
  assert.equal(w.enemies[0].buffUntil, 22);
  assert.equal(simulation.moveEnemy(w.enemies[0], w.player, signal, 1, 18), 1.35);
  assert.equal(simulation.moveEnemy(w.enemies[0], w.player, signal, 1, 22), 1);
  boss.secondaryAt = 22;
  boss.abilitySerial = 2;
  assert.equal(castBossAbility(w, boss, { ...signal, low: .02, high: .9, mid: .05 }, 23), 'DEBUFF',
    'surviving boss secondary attacks follow the currently audible song, not its origin song');
});

test('active blast circles pull the ship inward and slow movement until detonation', () => {
  const blast = { x: 250, y: 500, radius: 82, createdAt: 2, explodeAt: 3, ownerId: 1, kind: 'BLAST', detonated: false };
  const field = blastMovementField([blast], 209, 500, 2.5);
  assert.ok(field.speedScale < 1 && field.speedScale > .45);
  assert.ok(field.pullX > 0, 'the field pushes an offset ship toward the circle center');
  assert.equal(blastMovementField([blast], 100, 500, 2.5).speedScale, 1);
  assert.equal(blastMovementField([blast], 209, 500, 3).speedScale, 1, 'the field ends at detonation');
  const highLevel = world();
  assert.equal(castBossAbility(highLevel, { id: 2, originLevel: 11, features: features('high'), secondaryAt: 0, secondaryIndex: 0 }, signal, 0), 'BLAST');
  assert.equal(highLevel.blasts.length, 6, 'the highest tested level adds more circles than level five');
});

test('boss sweeps telegraph first, move their safe lane, damage outside it, and clear with their owner', () => {
  const w = world();
  const boss = {
    id: 41, x: 210, y: 118, radius: 55, originLevel: 2, phase: 'PHASE1',
    features: features('sweep-song'), secondaryAt: 0, secondaryIndex: 3,
  };
  assert.equal(castBossAbility(w, boss, { ...signal, high: .9, low: .1, pulse: true }, 10), 'SWEEP');
  assert.equal(w.bossBeams.length, 1);
  const beam = w.bossBeams[0];
  assert.equal(beam.ownerId, boss.id);
  assert.ok(Math.abs(beam.activeAt - beam.createdAt - BOSS_SWEEP_TELEGRAPH_SECONDS) < 1e-9);

  const warningTime = beam.createdAt + BOSS_SWEEP_TELEGRAPH_SECONDS / 2;
  const warning = bossSweepPosition(beam, warningTime);
  assert.equal(warning.active, false);
  assert.equal(bossSweepHitsPlayer(beam, { x: warning.safeX, y: warning.y }, warningTime, 20, 32), false);

  const firstSweep = bossSweepPosition(beam, beam.activeAt + .5);
  const laterSweep = bossSweepPosition(beam, beam.activeAt + 1);
  assert.ok(firstSweep.active);
  assert.ok(firstSweep.y > beam.startY && firstSweep.y < beam.endY);
  assert.notEqual(firstSweep.safeX, laterSweep.safeX, 'the cyan lane moves while the beam crosses the arena');
  assert.equal(bossSweepHitsPlayer(beam, { x: firstSweep.safeX, y: firstSweep.y }, beam.activeAt + .5, 20, 32), false);
  assert.equal(bossSweepHitsPlayer(beam, { x: 10, y: firstSweep.y }, beam.activeAt + .5, 20, 32), true);
  const damageInstance = { ...beam };
  assert.equal(claimBossSweepDamage(damageInstance), true);
  assert.equal(claimBossSweepDamage(damageInstance), false, 'one active beam cannot deal damage every frame through invulnerability');

  advanceBossSweepBeams(w, [boss], beam.activeAt + .5);
  assert.equal(w.bossBeams.length, 1);
  advanceBossSweepBeams(w, [{ ...boss, phase: 'DYING' }], beam.activeAt + .5);
  assert.equal(w.bossBeams.length, 0, 'a dying owner cannot leave a lingering hazard');
  w.bossBeams.push(beam);
  advanceBossSweepBeams(w, [boss], beam.endsAt);
  assert.equal(w.bossBeams.length, 0, 'expired sweeps are removed');
});

test('automatic boss attacks use blast zones more often than alternate abilities', () => {
  const w = world();
  const boss = { id: 3, originLevel: 1, features: features('frequent-blasts'), secondaryAt: 0 };
  const casts = [];
  for (let i = 0; i < 6; i += 1) {
    const now = boss.secondaryAt;
    casts.push(castBossAbility(w, boss, signal, now));
    advanceBlasts(w, now + BLAST_CHARGE_SECONDS + .5);
  }
  assert.equal(casts.filter(kind => kind === 'BLAST').length, 4);
  assert.equal(casts.filter(kind => kind !== 'BLAST').length, 2);
});

test('all weapon families gain steep rank-six and rank-seven power; rank-seven twin companions remain durable', () => {
  for (const type of ['TWIN', 'SPREAD', 'LASER']) {
    const amount = (rank) => {
      const stats = weaponStats(type, rank);
      return type === 'LASER' ? stats.laserDamage : stats.damage;
    };
    assert.ok(amount(1) > 0, `${type} has useful rank-one damage`);
    assert.ok(amount(6) > amount(5) * 1.5, `${type} gains a large rank-six increase`);
    assert.ok(amount(7) > amount(6) * 1.4, `${type} gains another large rank-seven increase`);
    assert.ok(amount(7) > amount(5) * 2, `${type} has exponentially improved top-rank damage`);
  }
  assert.ok(WEAPON_BALANCE.companionHP >= 80);
  const state = newWeaponState(); state.rank = 7; state.companions = [90, 90];
  const shots = fireWeapon(state, { x: 210, y: 600, vx: 0, vy: 0 }, 0).shots;
  assert.ok(shots.at(-1).damage >= shots[0].damage * 2);
});

test('regular repair remains a rare two-percent drop and no weapon emits free repairs', () => {
  const repairs = Array.from({ length: 1000 }, (_, i) => pickDrop(i / 1000)).filter(d => d === 'REPAIR').length;
  assert.equal(repairs, 20);
  assert.ok(WEAPON_BALANCE.bossRepairChance > 0 && WEAPON_BALANCE.bossRepairChance <= .15);
});