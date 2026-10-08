import { ARENA_HEIGHT, ARENA_WIDTH } from './gameArena.ts';
import type { ActiveBoss, BossSweepBeam, CombatWorld, DelayedBlast, LiveFeatures } from './gameRuntimeTypes';
import { audioIntensity } from './encounterRules.ts';

export const BOSS_DEATH_STUN_SECONDS = .45;
export const BOSS_DEATH_CONFUSION_SECONDS = 5;
export const BLAST_CHARGE_SECONDS = .9;
const DEBUFF_CHARGE_SECONDS = 2.6;
export const BOSS_SWEEP_TELEGRAPH_SECONDS = 1.05;
export const BOSS_SWEEP_DURATION_SECONDS = 2.7;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function disruptEnemies(world: Pick<CombatWorld, 'enemies'>, now: number) {
  for (const enemy of world.enemies) if (enemy.alive) {
    enemy.stunnedUntil = now + BOSS_DEATH_STUN_SECONDS;
    enemy.confusedUntil = enemy.stunnedUntil + BOSS_DEATH_CONFUSION_SECONDS;
    enemy.diving = false;
    enemy.fireTimer = Math.max(enemy.fireTimer, 45);
  }
}

/** Beat-gated secondary casts have an independent bounded cadence and never replace primary fire. */
export function castBossAbility(world: CombatWorld, boss: ActiveBoss, live: LiveFeatures, now: number) {
  boss.secondaryAt ??= now + 6;
  if (now < boss.secondaryAt || (!live.pulse && now < boss.secondaryAt + .8)) return null;
  const signature = audioIntensity(live) > .015 ? live : boss.features.signature;
  const selected = signature.high > signature.mid * 1.2 ? 1 : 2;
  const automaticCount = boss.abilitySerial ?? 0;
  const cycle = automaticCount % 4;
  const automaticKind = cycle < 2 ? 'BLAST' : cycle === 2
    ? (['DEBUFF', 'BUFF'] as const)[selected - 1] : 'SWEEP';
  const kind = (['BLAST', 'DEBUFF', 'BUFF', 'SWEEP'] as const)[boss.secondaryIndex ?? -1] ?? automaticKind;
  if (boss.secondaryIndex === undefined) boss.abilitySerial = automaticCount + 1;
  boss.secondaryIndex = undefined;
  boss.secondaryAt = now + clamp(8 - live.tempo / 90 - live.onset * 2, 4.5, 8);
  if (kind === 'BUFF') {
    for (const enemy of world.enemies) if (enemy.alive) enemy.buffUntil = now + 5;
  } else if (kind === 'SWEEP') {
    world.bossBeams ??= [];
    if (world.bossBeams.length < 1) {
      const safeWidth = 128;
      world.bossBeams.push({
        ownerId: boss.id,
        createdAt: now,
        activeAt: now + BOSS_SWEEP_TELEGRAPH_SECONDS,
        endsAt: now + BOSS_SWEEP_TELEGRAPH_SECONDS + BOSS_SWEEP_DURATION_SECONDS,
        startY: clamp(boss.y + boss.radius + 55, 245, 330),
        endY: ARENA_HEIGHT - 130,
        safeStartX: clamp(world.player.x, safeWidth / 2 + 12, ARENA_WIDTH - safeWidth / 2 - 12),
        safeDirection: live.high >= live.low ? 1 : -1,
        safeSpeed: clamp(100 + live.tempo * .25 + live.onset * 35, 115, 190),
        safeWidth,
        thickness: 30,
      });
    }
  } else if (world.blasts.length < 8) {
    const level = boss.originLevel ?? world.level;
    const circleCount = kind === 'BLAST' ? Math.min(6, 1 + Math.floor(Math.max(0, level - 1) / 2)) : 1;
    const points = [{ x: world.player.x, y: world.player.y }];
    for (let index = 1; index < circleCount; index += 1) {
      const angle = Math.PI * 2 * (index - 1) / Math.max(1, circleCount - 1) + Math.random() * .35;
      const distance = 135 + Math.random() * 100;
      points.push({
        x: clamp(world.player.x + Math.cos(angle) * distance, 84, 336),
        y: clamp(world.player.y + Math.sin(angle) * distance, 120, 780),
      });
    }
    for (const point of points.slice(0, 8 - world.blasts.length)) {
      world.blasts.push({ ...point, radius: kind === 'BLAST' ? 82 : 70, createdAt: now,
        explodeAt: now + (kind === 'BLAST' ? BLAST_CHARGE_SECONDS : DEBUFF_CHARGE_SECONDS),
        ownerId: boss.id, kind, detonated: false });
    }
  }
  return kind;
}

export function bossSweepPosition(beam: BossSweepBeam, now: number) {
  const duration = Math.max(.01, beam.endsAt - beam.activeAt);
  const progress = clamp((now - beam.activeAt) / duration, 0, 1);
  const active = now >= beam.activeAt && now < beam.endsAt;
  const y = now < beam.activeAt
    ? beam.startY
    : beam.startY + (beam.endY - beam.startY) * progress;
  const minX = beam.safeWidth / 2 + 12;
  const maxX = ARENA_WIDTH - minX;
  const range = maxX - minX;
  const raw = beam.safeStartX - minX +
    beam.safeDirection * beam.safeSpeed * Math.max(0, Math.min(now, beam.endsAt) - beam.activeAt);
  const cycle = Math.max(.01, range * 2);
  const wrapped = ((raw % cycle) + cycle) % cycle;
  const safeX = minX + (wrapped <= range ? wrapped : cycle - wrapped);
  return { y, safeX, progress, active };
}

export function bossSweepHitsPlayer(
  beam: BossSweepBeam,
  player: Pick<CombatWorld['player'], 'x' | 'y'>,
  now: number,
  playerWidth: number,
  playerHeight: number,
) {
  const position = bossSweepPosition(beam, now);
  if (!position.active ||
    Math.abs(player.y - position.y) > beam.thickness / 2 + playerHeight / 2) return false;
  const safeHalfWidth = Math.max(0, beam.safeWidth / 2 - playerWidth / 2);
  return Math.abs(player.x - position.safeX) > safeHalfWidth;
}

/** End expired sweeps and immediately remove hazards from bosses that are gone or dying. */
export function advanceBossSweepBeams(
  world: Pick<CombatWorld, 'bossBeams'>,
  bosses: readonly Pick<ActiveBoss, 'id' | 'phase'>[],
  now: number,
) {
  const activeOwners = new Set(bosses.filter((boss) => boss.phase !== 'DYING').map((boss) => boss.id));
  world.bossBeams = world.bossBeams.filter((beam) => beam.endsAt > now && activeOwners.has(beam.ownerId));
}

export function blastMovementField(blasts: readonly DelayedBlast[], x: number, y: number, now: number) {
  let speedScale = 1;
  let pullX = 0;
  let pullY = 0;
  for (const blast of blasts) {
    if (blast.kind !== 'BLAST' || blast.detonated || now >= blast.explodeAt) continue;
    const dx = blast.x - x;
    const dy = blast.y - y;
    const distance = Math.hypot(dx, dy);
    if (distance >= blast.radius || distance < .001) {
      if (distance < .001) speedScale = Math.min(speedScale, .48);
      continue;
    }
    const falloff = 1 - distance / blast.radius;
    speedScale = Math.min(speedScale, .8 - falloff * .32);
    const pull = falloff * .13;
    pullX += dx / distance * pull;
    pullY += dy / distance * pull;
  }
  const pullMagnitude = Math.hypot(pullX, pullY);
  if (pullMagnitude > .2) {
    pullX = pullX / pullMagnitude * .2;
    pullY = pullY / pullMagnitude * .2;
  }
  return { speedScale, pullX, pullY };
}

export function advanceBlasts(world: Pick<CombatWorld, 'blasts'>, now: number): DelayedBlast[] {
  const detonations = world.blasts.filter(b => !b.detonated && now >= b.explodeAt);
  for (const b of detonations) b.detonated = true;
  world.blasts = world.blasts.filter(b => now < b.explodeAt + .45);
  return detonations;
}

export function drawBossAbilities(ctx: CanvasRenderingContext2D, world: CombatWorld, now: number) {
  ctx.save();
  for (const beam of world.bossBeams) {
    const { y, safeX, active } = bossSweepPosition(beam, now);
    const left = safeX - beam.safeWidth / 2;
    const right = safeX + beam.safeWidth / 2;
    if (active) {
      ctx.fillStyle = 'rgba(255, 45, 91, .72)';
      ctx.fillRect(0, y - beam.thickness / 2, Math.max(0, left), beam.thickness);
      ctx.fillRect(right, y - beam.thickness / 2, Math.max(0, ARENA_WIDTH - right), beam.thickness);
      ctx.fillStyle = 'rgba(255, 225, 232, .95)';
      ctx.fillRect(0, y - 2, Math.max(0, left), 4);
      ctx.fillRect(right, y - 2, Math.max(0, ARENA_WIDTH - right), 4);
      ctx.fillStyle = 'rgba(0, 229, 255, .1)';
      ctx.fillRect(left, y - beam.thickness / 2 - 6, beam.safeWidth, beam.thickness + 12);
    } else {
      ctx.setLineDash([9, 7]);
      ctx.strokeStyle = 'rgba(255, 100, 132, .78)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(ARENA_WIDTH, y); ctx.stroke();
      ctx.fillStyle = 'rgba(0, 229, 255, .13)';
      ctx.fillRect(left, y - beam.thickness / 2 - 8, beam.safeWidth, beam.thickness + 16);
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(90, 248, 255, .95)';
    ctx.lineWidth = 2;
    ctx.strokeRect(left, y - beam.thickness / 2 - 6, beam.safeWidth, beam.thickness + 12);
  }
  for (const b of world.blasts) {
    const chargeTime = Math.max(.1, b.explodeAt - b.createdAt);
    const t = clamp((now - b.createdAt) / chargeTime, 0, 1);
    const color = b.kind === 'BLAST' ? '255, 108, 57' : '181, 105, 255';
    ctx.fillStyle = `rgba(${color}, ${b.detonated ? .7 * Math.max(0, 1 - (now - b.explodeAt) / .45) : .04 + t * t * .34})`;
    ctx.strokeStyle = `rgba(${color}, ${.3 + t * .7})`; ctx.lineWidth = 2 + t * 2;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (!b.detonated) {
      ctx.strokeStyle = `rgba(${color}, .95)`; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.radius + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t); ctx.stroke();
      if (b.kind === 'BLAST') {
        const coreRadius = 9 + t * 6;
        const core = ctx.createRadialGradient(b.x, b.y, 1, b.x, b.y, coreRadius * 2.2);
        core.addColorStop(0, 'rgba(0, 0, 0, .98)');
        core.addColorStop(.42, 'rgba(12, 8, 18, .94)');
        core.addColorStop(1, 'rgba(26, 12, 18, 0)');
        ctx.fillStyle = core;
        ctx.beginPath(); ctx.arc(b.x, b.y, coreRadius * 2.2, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(255, 178, 120, .72)'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(b.x, b.y, coreRadius * (1.25 + Math.sin(now * 18) * .1), 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = '#fff3dd'; ctx.textAlign = 'center'; ctx.font = 'bold 10px monospace';
      ctx.fillText('LEAVE', b.x, b.y + 4);
    }
  }
  if ((world.player.debuffUntil ?? 0) > now) {
    ctx.strokeStyle = '#b569ff'; ctx.lineWidth = 3; ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.arc(world.player.x, world.player.y, 29, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}