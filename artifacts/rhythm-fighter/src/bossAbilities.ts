import type { ActiveBoss, CombatWorld, DelayedBlast, LiveFeatures } from './gameRuntimeTypes';
import { audioIntensity } from './encounterRules.ts';

export const BOSS_DEATH_STUN_SECONDS = .45;
export const BOSS_DEATH_CONFUSION_SECONDS = 5;
export const BLAST_CHARGE_SECONDS = 5;
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
  const selected = signature.low > signature.high * 1.2 && signature.low > signature.mid ? 0
    : signature.high > signature.mid * 1.2 ? 1 : 2;
  const kind = (['BLAST', 'DEBUFF', 'BUFF'] as const)[boss.secondaryIndex ?? selected];
  boss.secondaryIndex = undefined;
  boss.secondaryAt = now + clamp(14 - live.tempo / 60 - live.onset * 3, 8, 14);
  if (kind === 'BUFF') {
    for (const enemy of world.enemies) if (enemy.alive) enemy.buffUntil = now + 5;
  } else if (world.blasts.length < 8) {
    const points = [{ x: world.player.x, y: world.player.y }];
    if (kind === 'BLAST' && audioIntensity(live) > .45) points.push({ x: 70 + Math.random() * 280, y: 250 + Math.random() * 480 });
    for (const point of points.slice(0, 8 - world.blasts.length)) {
      world.blasts.push({ ...point, radius: kind === 'BLAST' ? 82 : 70, createdAt: now,
        explodeAt: now + BLAST_CHARGE_SECONDS, ownerId: boss.id, kind, detonated: false });
    }
  }
  return kind;
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
    const t = clamp((now - b.createdAt) / BLAST_CHARGE_SECONDS, 0, 1);
    const color = b.kind === 'BLAST' ? '255, 108, 57' : '181, 105, 255';
    ctx.fillStyle = `rgba(${color}, ${b.detonated ? .7 * Math.max(0, 1 - (now - b.explodeAt) / .45) : .04 + t * t * .34})`;
    ctx.strokeStyle = `rgba(${color}, ${.3 + t * .7})`; ctx.lineWidth = 2 + t * 2;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (!b.detonated) {
      ctx.strokeStyle = `rgba(${color}, .95)`; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.radius + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t); ctx.stroke();
      ctx.fillStyle = '#fff3dd'; ctx.textAlign = 'center'; ctx.font = 'bold 11px monospace';
      ctx.fillText(`${b.kind === 'BLAST' ? 'BLAST' : 'SLOW'} ${Math.max(1, Math.ceil(b.explodeAt - now))}`, b.x, b.y + 4);
    }
  }
  if ((world.player.debuffUntil ?? 0) > now) {
    ctx.strokeStyle = '#b569ff'; ctx.lineWidth = 3; ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.arc(world.player.x, world.player.y, 29, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#dabaff'; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center';
    ctx.fillText(`SLOWED ${Math.ceil(world.player.debuffUntil! - now)}s`, world.player.x, world.player.y + 43);
  }
  ctx.restore();
}