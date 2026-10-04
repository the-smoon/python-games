import type { EnemyEntity, ActiveBoss } from './gameRuntimeTypes';
import type { FormProfile, ShapeIdentity } from './encounterRules';

export function shapePath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, shape: ShapeIdentity) {
  ctx.beginPath();
  if (shape === 'SQUARE') ctx.rect(x - r * .72, y - r * .72, r * 1.44, r * 1.44);
  else if (shape === 'RECTANGLE') ctx.rect(x - r, y - r * .55, r * 2, r * 1.1);
  else if (shape === 'OVAL') ctx.ellipse(x, y, r, r * .6, 0, 0, Math.PI * 2);
  else if (shape === 'CAPSULE') ctx.roundRect(x - r * .48, y - r, r * .96, r * 2, r * .48);
  else if (shape === 'ELBOW') {
    // A clean quarter-annulus, symmetric about its diagonal: the elbow-macaroni archetype.
    ctx.arc(x - r * .45, y - r * .45, r * 1.35, 0, Math.PI / 2);
    ctx.lineTo(x - r * .45, y + r * .25);
    ctx.arc(x - r * .45, y - r * .45, r * .7, Math.PI / 2, 0, true);
  } else if (shape === 'TRIANGLE') {
    ctx.moveTo(x, y - r); ctx.lineTo(x + r * .86, y + r * .7); ctx.lineTo(x - r * .86, y + r * .7);
  } else if (shape === 'DIAMOND') {
    ctx.moveTo(x, y - r); ctx.lineTo(x + r * .8, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r * .8, y);
  } else if (shape === 'HEX') {
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      if (i === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
  } else {
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (shape === 'RING') { ctx.moveTo(x + r * .52, y); ctx.arc(x, y, r * .52, 0, Math.PI * 2, true); }
  }
  ctx.closePath();
}

export function drawGeometricBody(
  ctx: CanvasRenderingContext2D, x: number, y: number, radius: number,
  form: FormProfile, color: string, shape: ShapeIdentity,
) {
  ctx.save(); ctx.translate(x, y);
  // Fixed orientation and matched axes keep the forms legible, not irregular animated blobs.
  ctx.scale(form.widthScale ?? 1, form.heightScale ?? 1);
  shapePath(ctx, 0, 0, radius, shape);
  ctx.fillStyle = color; ctx.strokeStyle = '#eafffa';
  ctx.lineWidth = Math.max(1.2, radius * .035); ctx.fill(); ctx.stroke();
  if (shape !== 'ELBOW' && shape !== 'RING') {
    shapePath(ctx, 0, 0, radius * .35, shape);
    ctx.fillStyle = '#0c182b'; ctx.globalAlpha *= .8; ctx.fill();
  }
  ctx.restore();
}

export function drawEnemyBody(ctx: CanvasRenderingContext2D, enemy: EnemyEntity, now: number) {
  drawGeometricBody(ctx, enemy.x, enemy.y, enemy.radius, enemy.form, enemy.color ?? '#76d5ff', enemy.shape);
  if ((enemy.confusedUntil ?? 0) > now || (enemy.buffUntil ?? 0) > now) {
    ctx.save(); ctx.strokeStyle = (enemy.confusedUntil ?? 0) > now ? '#d6faff' : '#ffcd5a';
    ctx.lineWidth = 2; ctx.setLineDash([3, 5]);
    ctx.beginPath(); ctx.arc(enemy.x, enemy.y, enemy.radius + 6, now * 2, now * 2 + Math.PI * 2); ctx.stroke(); ctx.restore();
  }
}

export function drawBossBody(ctx: CanvasRenderingContext2D, boss: ActiveBoss) {
  const color = boss.color ?? '#70aaff';
  const design = boss.features.design;
  ctx.save();
  if (boss.phase === 'DYING') {
    ctx.globalAlpha *= Math.max(0, 1 - boss.dyingTimer / 55);
    ctx.translate(boss.x, boss.y); ctx.scale(1 + boss.dyingTimer * .004, 1 + boss.dyingTimer * .004); ctx.translate(-boss.x, -boss.y);
  }
  // A permanent paired hull stays after detachable sub-enemies have all launched.
  const pairedParts = 1 + Math.ceil(boss.parts / 2);
  for (let tier = 0; tier < pairedParts; tier++) for (const side of [-1, 1]) {
    const x = boss.x + side * boss.radius * (.82 + tier * .32);
    const y = boss.y + boss.radius * (.15 + tier * .43);
    ctx.strokeStyle = color; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(boss.x + side * 18, boss.y + 8); ctx.lineTo(x, y); ctx.stroke();
    drawGeometricBody(ctx, x, y, boss.radius * (.48 - tier * .08), boss.form, color, design?.wings ?? 'RECTANGLE');
  }
  if (boss.shape === 'ELBOW') {
    for (const side of [-1, 1]) {
      ctx.save(); ctx.translate(boss.x, boss.y); ctx.scale(side, 1);
      drawGeometricBody(ctx, boss.radius * .18, 0, boss.radius * .65, boss.form, color, 'ELBOW');
      ctx.restore();
    }
  } else drawGeometricBody(ctx, boss.x, boss.y, boss.radius * .85, boss.form, color, boss.shape);
  drawGeometricBody(ctx, boss.x, boss.y - boss.radius * .56, boss.radius * .3, boss.form, design?.colors[2] ?? '#c0ffff', 'TRIANGLE');
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center';
  ctx.fillText(`L${boss.originLevel}`, boss.x, boss.y + 4);
  ctx.restore();
}