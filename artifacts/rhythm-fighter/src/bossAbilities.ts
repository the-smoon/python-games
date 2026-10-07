import type { ActiveBoss, CombatWorld, DelayedBlast, LiveFeatures } from './gameRuntimeTypes';
import { audioIntensity } from './encounterRules.ts';

export const BOSS_DEATH_STUN_SECONDS = .45;
export const BOSS_DEATH_CONFUSION_SECONDS = 5;
export const BLAST_CHARGE_SECONDS = .9;
const DEBUFF_CHARGE_SECONDS = 2.6;
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
  const automaticKind = automaticCount % 3 < 2 ? 'BLAST' : (['DEBUFF', 'BUFF'] as const)[selected - 1];
  const kind = (['BLAST', 'DEBUFF', 'BUFF'] as const)[boss.secondaryIndex ?? -1] ?? automaticKind;
  if (boss.secondaryIndex === undefined) boss.abilitySerial = automaticCount + 1;
  boss.secondaryIndex = undefined;
  boss.secondaryAt = now + clamp(8 - live.tempo / 90 - live.onset * 2, 4.5, 8);
  if (kind === 'BUFF') {
    for (const enemy of world.enemies) if (enemy.alive) enemy.buffUntil = now + 5;
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