import { PICKUP_INFO, WEAPON_BALANCE, companionPositions } from './weaponRules';
import type { LaserBeam, Pickup, PlayerShot, WeaponState } from './weaponRules';

const COL = { TWIN: '#ffe45e', SPREAD: '#ff9a52', LASER: '#ee8cff' } as const;

function ring(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number, w = 2) {
  ctx.globalAlpha = Math.max(0, alpha);
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
  ctx.stroke();
}

export function drawFrozenHalo(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  ctx.save();
  ring(ctx, x, y, radius + 4, '#aef4ff', .8, 2);
  ctx.fillStyle = '#56e9ff';
  ctx.globalAlpha = .16;
  ctx.beginPath();
  ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = .7;
  ctx.strokeStyle = '#e6fcff';
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3 + Math.PI / 6;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * (radius + 1), y + Math.sin(a) * (radius + 1));
    ctx.lineTo(x + Math.cos(a) * (radius + 8), y + Math.sin(a) * (radius + 8));
    ctx.stroke();
  }
  ctx.restore();
}

export function drawWeaponEffects(
  ctx: CanvasRenderingContext2D, weapon: WeaponState, player: { x: number; y: number },
  shots: PlayerShot[], beam: LaserBeam | null, drops: Pickup[], now: number,
  bombUntil: number, splashes: { x: number; y: number; until: number }[], shieldBlastUntil: number,
) {
  ctx.save();
  try {
    // pickups
    for (const d of drops) {
      if (!d.alive) continue;
      const info = PICKUP_INFO[d.type];
      const locked = (d.type === 'TWIN' || d.type === 'SPREAD' || d.type === 'LASER') &&
        weapon.weaponSwitchUntil > now;
      const left = d.expiresAt - now;
      if (left < 3 && Math.floor(now * 8) % 2 === 0) continue;
      const pulse = 1 + Math.sin(now * 6 + d.x) * .08;
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.scale(pulse, pulse);
       ctx.fillStyle = 'rgba(7,8,15,.9)';
       ctx.strokeStyle = locked ? '#55616f' : info.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
       if (d.type === 'REPAIR') ctx.rect(-11, -11, 22, 22);
       else if (d.type === 'MINI_REPAIR') { ctx.moveTo(0, -14); ctx.lineTo(14, 0); ctx.lineTo(0, 14); ctx.lineTo(-14, 0); ctx.closePath(); }
      else if (d.type === 'BOMB') { ctx.moveTo(0, -14); ctx.lineTo(13, 0); ctx.lineTo(0, 14); ctx.lineTo(-13, 0); ctx.closePath(); }
       else if (d.type === 'RAPID' || d.type === 'SHIELD' || d.type === 'SHIELD_2' || d.type === 'SHIELD_3') { for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; ctx.lineTo(Math.cos(a) * 13, Math.sin(a) * 13); } ctx.closePath(); }
      else ctx.arc(0, 0, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
       ctx.fillStyle = locked ? '#65717e' : info.color;
      ctx.font = `700 ${info.glyph.length > 1 ? 10 : 13}px 'Space Mono', monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(info.glyph, 0, 1);
       if (locked) {
         ctx.fillStyle = 'rgba(0,0,0,.72)';
         ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
         ctx.fillStyle = '#a7b1bd';
         ctx.font = "700 7px 'Space Mono', monospace";
         ctx.fillText('LOCK', 0, 1);
       }
      ctx.restore();
    }

    // shots
    for (const s of shots) {
      if (!s.alive) continue;
      const c = s.shieldBurst ? '#7ff7ff' : COL[s.weapon];
      const rk = s.rank;
      ctx.globalAlpha = 1;
      if (s.weapon === 'SPREAD') {
        const col = s.freeze ? '#aef4ff' : c;
        const r = s.radius + rk * .3;
        ctx.fillStyle = col;
        ctx.globalAlpha = .35;
        ctx.beginPath(); ctx.arc(s.x - s.vx * .006, s.y - s.vy * .006, r + 2, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.fill();
        if (s.freeze) ring(ctx, s.x, s.y, r + 3, '#fff', .8, 1);
      } else {
        const w = 2 + rk * .5, h = 9 + rk * 1.5;
        ctx.fillStyle = c;
        ctx.globalAlpha = .3;
        ctx.fillRect(s.x - w, s.y, w * 2, h + 6);
        ctx.globalAlpha = 1;
        ctx.fillRect(s.x - w / 2, s.y, w, h);
        ctx.fillStyle = '#fffbe0';
        ctx.fillRect(s.x - .5, s.y, 1, h * .6);
      }
    }
    ctx.globalAlpha = 1;

    // companions
    if (weapon.type === 'TWIN') {
      for (const c of companionPositions(player, weapon)) {
        if (c.health <= 0) continue;
        const hit = c.health / WEAPON_BALANCE.companionHP;
        ctx.save();
        ctx.translate(c.x, c.y + Math.sin(now * 5 + c.index) * 1.5);
        ctx.fillStyle = '#10121f';
        ctx.strokeStyle = hit < .4 ? '#ff6286' : '#ffe45e';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, -12); ctx.lineTo(8, 8); ctx.lineTo(0, 4); ctx.lineTo(-8, 8); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#56e9ff';
        ctx.fillRect(-1.5, 8, 3, 3 + Math.sin(now * 30) * 1.5);
        ctx.restore();
      }
    }

    // shield
    if (weapon.shieldUntil > now && weapon.shieldHP > 0) {
      const left = weapon.shieldUntil - now;
      const color = weapon.shieldTier === 3 ? '#bc8cff' : weapon.shieldTier === 2 ? '#4ce6ff' : '#7cb8ff';
      if (left > 1.5 || Math.floor(now * 10) % 2 === 0) {
        const p = 1 + Math.sin(now * 8) * .04;
        ctx.save();
        ctx.translate(player.x, player.y);
        ctx.scale(p, p);
         ctx.fillStyle = color; ctx.globalAlpha = .13;
        ctx.beginPath(); ctx.ellipse(0, 0, 30, 36, 0, 0, Math.PI * 2); ctx.fill();
         ctx.globalAlpha = .9; ctx.strokeStyle = color; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.ellipse(0, 0, 30, 36, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
    }

    if (shieldBlastUntil > now) {
      const progress = Math.min(1, (shieldBlastUntil - now) / .38);
      ctx.save();
      ctx.fillStyle = `rgba(89, 230, 255, ${.24 * progress})`;
      ctx.strokeStyle = `rgba(175, 250, 255, ${.9 * progress})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(player.x - 16, player.y - 12);
      ctx.lineTo(player.x - 68 * progress, player.y - 86 * progress);
      ctx.lineTo(player.x + 68 * progress, player.y - 86 * progress);
      ctx.lineTo(player.x + 16, player.y - 12);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    // laser charge
    if (weapon.type === 'LASER' && weapon.chargeStartedAt !== null) {
      const t = Math.min(1, (now - weapon.chargeStartedAt) / (.65 - (weapon.rank - 1) * .1));
      ctx.fillStyle = '#ee8cff';
      ctx.globalAlpha = .25 + t * .4;
      ctx.beginPath(); ctx.arc(player.x, player.y - 20, 4 + t * 10, 0, Math.PI * 2); ctx.fill();
      ring(ctx, player.x, player.y - 20, 22 - t * 14, '#f6c8ff', .9, 1.5);
      ctx.globalAlpha = 1;
    }

    // beam
    if (beam && beam.until > now) {
      const f = Math.min(1, (beam.until - now) / .16);
      const w = beam.width * (.6 + f * .4);
      ctx.fillStyle = '#ee8cff'; ctx.globalAlpha = .35 * f + .1;
      ctx.fillRect(beam.x - w, 0, w * 2, beam.y);
      ctx.globalAlpha = .9;
      ctx.fillStyle = '#f9dcff';
      ctx.fillRect(beam.x - w / 2, 0, w, beam.y);
      ctx.fillStyle = '#fff'; ctx.globalAlpha = 1;
      ctx.fillRect(beam.x - w / 6, 0, w / 3, beam.y);
    }

    // bomb flash
    if (bombUntil > now) {
      const f = Math.min(1, (bombUntil - now) / .35);
      ctx.fillStyle = '#ff6286'; ctx.globalAlpha = .28 * f;
      ctx.fillRect(-10, -10, 2000, 2000);
      ring(ctx, player.x, player.y, (1 - f) * 360, '#ffd0da', .8 * f, 4);
    }

    // splashes
    for (const sp of splashes) {
      if (sp.until <= now) continue;
      const f = Math.min(1, (sp.until - now) / .5);
      const r = WEAPON_BALANCE.freezeRadius * (1.1 - f * .6);
      ring(ctx, sp.x, sp.y, r, '#aef4ff', f, 2.5);
      ring(ctx, sp.x, sp.y, r * .6, '#fff', f * .6, 1);
    }
  } finally {
    ctx.restore();
  }
}
