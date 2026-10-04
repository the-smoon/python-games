import type { CombatWorld, ParticleEntity, ActiveBoss } from './gameRuntimeTypes';

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const cap = <T>(items: T[], max: number) => { if (items.length > max) items.splice(0, items.length - max); };

export function pixelBurst(particles: ParticleEntity[], x: number, y: number, color: string, count = 30, scale = 1) {
  for (let i = 0; i < count; i++) {
    const a = i / count * Math.PI * 2 + rand(-.18, .18), speed = rand(35, 125) * scale;
    const life = rand(24, 58);
    particles.push({ x: x + rand(-3, 3), y: y + rand(-3, 3), vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
      life, maxLife: life, color: i % 5 === 0 ? '#efffff' : color, pixel: true, size: rand(2, 4) });
  }
  cap(particles, 420);
}

export function bossDeathBurst(world: CombatWorld, boss: ActiveBoss, now: number) {
  const color = boss.color ?? '#ffbf69';
  pixelBurst(world.particles, boss.x, boss.y, color, 110, 1.8);
  world.shockwaves.push({ x: boss.x, y: boss.y, color, startedAt: now, until: now + 1.2 });
  for (let i = 0; i < 22; i++) {
    const a = i / 22 * Math.PI * 2 + rand(-.2, .2), speed = rand(3, 9), life = rand(65, 105);
    world.debris.push({ x: boss.x + Math.cos(a) * boss.radius * .4, y: boss.y + Math.sin(a) * boss.radius * .4,
      vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life, maxLife: life, color,
      size: rand(4, 11), angle: a, spin: rand(-.15, .15), generation: 0, split: false, sparkTimer: 0 });
  }
  cap(world.debris, 100);
}

export function advanceCombatEffects(world: CombatWorld, delta: number) {
  for (const p of world.particles) {
    p.x += p.vx * delta * .06; p.y += p.vy * delta * .06;
    if (p.pixel) { p.vx *= Math.pow(.978, delta); p.vy *= Math.pow(.978, delta); }
    else p.vy += .07 * delta;
    p.life -= delta;
  }
  world.particles = world.particles.filter(p => p.life > 0);
  const children: typeof world.debris = [];
  for (const d of world.debris) {
    d.x += d.vx * delta; d.y += d.vy * delta; d.vy += .035 * delta;
    d.angle += d.spin * delta; d.life -= delta;
    d.sparkTimer = (d.sparkTimer ?? 0) - delta;
    if (d.sparkTimer <= 0 && d.life > 0) { pixelBurst(world.particles, d.x, d.y, d.color, 1, .18); d.sparkTimer = 7; }
    if (d.life > 0 && !d.split && (d.generation ?? 0) < 2 && d.life < d.maxLife * .63) {
      d.split = true;
      for (const side of [-1, 1]) {
        const a = d.angle + side * .9, life = Math.max(12, d.life * .8);
        children.push({ ...d, vx: d.vx * .65 + Math.cos(a) * 2, vy: d.vy * .65 + Math.sin(a) * 2,
          size: d.size * .46, life, maxLife: life, generation: (d.generation ?? 0) + 1, split: false });
      }
      d.size *= .7;
    }
  }
  world.debris = [...world.debris.filter(d => d.life > 0), ...children]; cap(world.debris, 100);
}

const glowSprites = new Map<string, HTMLCanvasElement>();
function glowSprite(color: string) {
  let sprite = glowSprites.get(color);
  if (!sprite) {
    sprite = document.createElement('canvas'); sprite.width = sprite.height = 32;
    const c = sprite.getContext('2d')!;
    const glow = c.createRadialGradient(16, 16, 1, 16, 16, 16);
    glow.addColorStop(0, color); glow.addColorStop(.16, color); glow.addColorStop(1, 'transparent');
    c.fillStyle = glow; c.fillRect(0, 0, 32, 32);
    if (glowSprites.size >= 64) glowSprites.delete(glowSprites.keys().next().value!);
    glowSprites.set(color, sprite);
  }
  return sprite;
}

export function drawCombatEffects(ctx: CanvasRenderingContext2D, world: CombatWorld, now: number) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const p of world.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    const size = p.size ?? 4;
    if (p.pixel) {
      ctx.drawImage(glowSprite(p.color), p.x - size * 3, p.y - size * 3, size * 6, size * 6);
      ctx.fillStyle = p.color; ctx.fillRect(Math.round(p.x - size / 2), Math.round(p.y - size / 2), size, size);
      ctx.fillStyle = '#edffff'; ctx.fillRect(Math.round(p.x), Math.round(p.y), Math.max(1, size * .35), Math.max(1, size * .35));
    } else { ctx.fillStyle = p.color; ctx.fillRect(p.x - 2, p.y - 2, 4, 4); }
  }
  for (const d of world.debris) {
    ctx.save(); ctx.globalAlpha = Math.min(1, d.life / 18); ctx.translate(d.x, d.y); ctx.rotate(d.angle);
    ctx.fillStyle = '#253347'; ctx.strokeStyle = d.color; ctx.lineWidth = 1.5;
    ctx.fillRect(-d.size / 2, -d.size / 3, d.size, d.size * .66); ctx.strokeRect(-d.size / 2, -d.size / 3, d.size, d.size * .66);
    ctx.restore();
  }
  for (const w of world.shockwaves) {
    const t = Math.max(0, (now - w.startedAt) / (w.until - w.startedAt));
    ctx.globalAlpha = Math.max(0, (1 - t) * .85); ctx.strokeStyle = w.color;
    ctx.lineWidth = 3 + (1 - t) * 9; ctx.beginPath(); ctx.arc(w.x, w.y, 12 + t * 950, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}