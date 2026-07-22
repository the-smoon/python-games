"""
AudioStrike — all game entities: Player, Bullet, EnemyBullet, Enemy, Boss, Particle.
"""

import pygame
import math
import random
from constants import *


# ─────────────────────────────────────────────────────────────────────────────
# Particle
# ─────────────────────────────────────────────────────────────────────────────
class Particle:
    __slots__ = ("x", "y", "color", "vx", "vy", "life", "max_life")

    def __init__(self, x, y, color, vx, vy, life):
        self.x, self.y     = float(x), float(y)
        self.color         = color
        self.vx, self.vy   = float(vx), float(vy)
        self.life          = int(life)
        self.max_life      = int(life)

    def update(self):
        self.x  += self.vx
        self.y  += self.vy
        self.vy += 0.12
        self.life -= 1

    def alive(self) -> bool:
        return self.life > 0

    def draw(self, surf):
        ratio = self.life / self.max_life
        size  = max(1, int(3 * ratio))
        r, g, b = self.color
        col = (min(255, r), min(255, g), min(255, b))
        pygame.draw.circle(surf, col, (int(self.x), int(self.y)), size)


# ─────────────────────────────────────────────────────────────────────────────
# Player bullet
# ─────────────────────────────────────────────────────────────────────────────
class Bullet:
    def __init__(self, x: float, y: float):
        self.x, self.y = x, y
        self.alive     = True

    def update(self):
        self.y -= BULLET_SPEED
        if self.y < -BULLET_H:
            self.alive = False

    def draw(self, surf):
        bx = int(self.x) - BULLET_W // 2
        by = int(self.y)
        # Core
        pygame.draw.rect(surf, BRIGHT_GREEN, (bx, by, BULLET_W, BULLET_H))
        # Glow tip
        pygame.draw.rect(surf, WHITE, (bx, by, BULLET_W, 3))

    def get_rect(self) -> pygame.Rect:
        return pygame.Rect(self.x - BULLET_W // 2, self.y, BULLET_W, BULLET_H)


# ─────────────────────────────────────────────────────────────────────────────
# Enemy bullet
# ─────────────────────────────────────────────────────────────────────────────
class EnemyBullet:
    def __init__(self, x: float, y: float, vx: float, vy: float, color=RED):
        self.x, self.y   = float(x), float(y)
        self.vx, self.vy = float(vx), float(vy)
        self.radius      = ENEMY_BULLET_RADIUS
        self.alive       = True
        self.color       = color

    def update(self):
        self.x += self.vx
        self.y += self.vy
        off = 30
        if (self.y > SCREEN_H + off or self.y < -off
                or self.x < -off or self.x > SCREEN_W + off):
            self.alive = False

    def draw(self, surf):
        pygame.draw.circle(surf, self.color,
                           (int(self.x), int(self.y)), self.radius)
        pygame.draw.circle(surf, WHITE,
                           (int(self.x), int(self.y)), self.radius, 1)

    def get_rect(self) -> pygame.Rect:
        r = self.radius
        return pygame.Rect(self.x - r, self.y - r, r * 2, r * 2)


# ─────────────────────────────────────────────────────────────────────────────
# Player
# ─────────────────────────────────────────────────────────────────────────────
class Player:
    def __init__(self):
        self.x          = float(SCREEN_W // 2)
        self.y          = float(SCREEN_H - 90)
        self.health     = PLAYER_HEALTH
        self.invincible = 0
        self.fire_cd    = 0
        self.alive      = True
        self._frame     = 0

    def update(self, mouse_x: float, mouse_y: float):
        """Snap ship to mouse/touch position, clamped inside the play area."""
        hw = PLAYER_W // 2
        hh = PLAYER_H // 2
        self.x = max(float(hw),           min(float(SCREEN_W - hw), float(mouse_x)))
        self.y = max(float(hh) + 10.0,    min(float(SCREEN_H - hh - 10), float(mouse_y)))

        if self.invincible > 0: self.invincible -= 1
        if self.fire_cd    > 0: self.fire_cd    -= 1
        self._frame += 1

    def try_fire(self) -> list:
        """Autofire — caller just invokes every frame; rate is governed by fire_cd."""
        if self.fire_cd == 0:
            self.fire_cd = FIRE_COOLDOWN
            return [Bullet(self.x, self.y - PLAYER_H // 2)]
        return []

    def take_hit(self, particles: list):
        if self.invincible > 0:
            return
        self.health     -= 1
        self.invincible  = INVINCIBLE_DUR
        for _ in range(14):
            a   = random.uniform(0, math.tau)
            spd = random.uniform(2, 7)
            particles.append(Particle(self.x, self.y, RED,
                                      math.cos(a) * spd, math.sin(a) * spd,
                                      random.randint(20, 45)))
        if self.health <= 0:
            self.alive = False

    def draw(self, surf, frame: int):
        if self.invincible > 0 and (self.invincible // 5) % 2 == 1:
            return   # blink when hit

        x, y = int(self.x), int(self.y)
        hw, hh = PLAYER_W // 2, PLAYER_H // 2

        # Fuselage
        body = pygame.Rect(x - hw, y - hh, PLAYER_W, PLAYER_H)
        pygame.draw.rect(surf, GREEN, body, border_radius=4)

        # Cockpit window
        pygame.draw.rect(surf, CYAN,
                         pygame.Rect(x - 5, y - hh + 5, 10, 13),
                         border_radius=2)

        # Wing tips
        pygame.draw.polygon(surf, BRIGHT_GREEN, [
            (x - hw,      y +  4),
            (x - hw - 10, y + 20),
            (x - hw,      y + 20),
        ])
        pygame.draw.polygon(surf, BRIGHT_GREEN, [
            (x + hw,      y +  4),
            (x + hw + 10, y + 20),
            (x + hw,      y + 20),
        ])

        # Engine exhaust flicker
        elen = random.randint(10, 22)
        ey   = y + hh
        pygame.draw.rect(surf, ORANGE, (x - 5, ey,     10, elen), border_radius=3)
        pygame.draw.rect(surf, YELLOW, (x - 3, ey,      6, elen // 2), border_radius=3)

    def get_rect(self) -> pygame.Rect:
        return pygame.Rect(self.x - PLAYER_W // 2, self.y - PLAYER_H // 2,
                           PLAYER_W, PLAYER_H)


# ─────────────────────────────────────────────────────────────────────────────
# Enemy
# ─────────────────────────────────────────────────────────────────────────────
class Enemy:
    """
    Music-spawned enemy circle.  Behaviour and stats are determined at spawn
    time by the audio feature snapshot passed from the Spawner.
    """

    def __init__(self, x: float, y: float, radius: int, health: int,
                 speed: float, behavior: str, fire_rate: int = 0,
                 formation_id: int | None = None):
        self.x, self.y     = float(x), float(y)
        self.radius        = int(radius)
        self.health        = int(health)
        self.max_health    = int(health)
        self.speed         = float(speed)
        self.behavior      = behavior
        self.fire_rate     = int(fire_rate)
        self.fire_timer    = random.randint(0, max(1, fire_rate))
        self.formation_id  = formation_id
        self.alive         = True
        self.hurt_flash    = 0

        # Per-behaviour movement state
        self.t             = random.uniform(0, math.tau)
        self.dir           = random.choice([-1, 1])
        self.patrol_amp    = random.uniform(1.5, 3.0)
        self.patrol_freq   = random.uniform(0.025, 0.055)
        self.zigzag_speed  = speed * 2.2

        self.color = BEHAVIOR_COLORS.get(behavior, WHITE)

    # ── Movement + shooting ───────────────────────────────────────────────────

    def update(self, px: float, py: float,
               enemy_bullets: list, particles: list):
        self.t += 0.04

        beh = self.behavior

        if beh == "PATROL":
            self.x += math.sin(self.t * self.patrol_freq * 60) * self.patrol_amp
            self.y += self.speed * 0.65

        elif beh == "ZIGZAG":
            self.x += math.sin(self.t * 3.2) * self.zigzag_speed
            self.y += self.speed * 0.80

        elif beh == "FORMATION":
            self.y += self.speed * 0.50
            self.x += math.sin(self.t * 1.5) * 1.0

        elif beh == "SWARM":
            self.x += random.uniform(-self.speed, self.speed)
            self.y += self.speed * 1.25

        elif beh == "DIVE":
            if self.y < SCREEN_H * 0.28:
                # Drift toward player x
                dx = px - self.x
                self.x += max(-self.speed, min(self.speed, dx * 0.07))
                self.y += self.speed * 0.45
            else:
                # Full dive
                self.y += self.speed * 2.8

        elif beh == "SHOOTER":
            if self.y < SCREEN_H * 0.38:
                self.y += self.speed * 0.60
            else:
                # Hover and fire
                self.x += math.sin(self.t * 0.9) * 1.8

        elif beh == "TANK":
            self.y += self.speed * 0.38
            self.x += math.sin(self.t * self.patrol_freq * 40) * 1.0

        # Clamp x to screen
        r = self.radius
        self.x = max(float(r + 5), min(float(SCREEN_W - r - 5), self.x))

        # Shooting logic
        if self.fire_rate > 0:
            self.fire_timer -= 1
            if self.fire_timer <= 0:
                if beh == "SHOOTER":
                    self.fire_timer = self.fire_rate
                    self._shoot_aimed(px, py, enemy_bullets)
                elif beh in ("SWARM", "DIVE"):
                    self.fire_timer = self.fire_rate * 2
                    self._shoot_down(enemy_bullets)

        if self.hurt_flash > 0:
            self.hurt_flash -= 1

        # Out-of-screen prune
        if self.y > SCREEN_H + self.radius + 10:
            self.alive = False

    def _shoot_aimed(self, px, py, bullets):
        dx = px - self.x
        dy = py - self.y
        dist = max(1.0, math.hypot(dx, dy))
        spd  = ENEMY_BULLET_SPEED
        bullets.append(EnemyBullet(self.x, self.y + self.radius,
                                   dx / dist * spd, dy / dist * spd,
                                   self.color))

    def _shoot_down(self, bullets):
        bullets.append(EnemyBullet(self.x, self.y + self.radius,
                                   0, ENEMY_BULLET_SPEED, self.color))

    # ── Hit / death ───────────────────────────────────────────────────────────

    def take_hit(self, particles: list):
        self.health     -= 1
        self.hurt_flash  = 7
        if self.health <= 0:
            self.alive = False
            self._explode(particles)

    def _explode(self, particles: list):
        n = max(8, int(self.radius * 1.6))
        for _ in range(n):
            a   = random.uniform(0, math.tau)
            spd = random.uniform(1.5, self.radius * 0.3)
            particles.append(Particle(self.x, self.y, self.color,
                                      math.cos(a) * spd, math.sin(a) * spd,
                                      random.randint(25, 60)))

    def score_value(self) -> int:
        return int(SCORE_ENEMY_BASE * self.max_health * (1 + self.radius / 20))

    # ── Draw ─────────────────────────────────────────────────────────────────

    def draw(self, surf):
        cx, cy = int(self.x), int(self.y)
        r      = self.radius
        col    = WHITE if self.hurt_flash % 2 == 1 else self.color

        # Outer body
        pygame.draw.circle(surf, col, (cx, cy), r)
        # Dark inner
        if r > 8:
            inner_col = tuple(max(0, c - 70) for c in col)
            pygame.draw.circle(surf, inner_col, (cx, cy), r - 6)
        # Rim
        pygame.draw.circle(surf, WHITE, (cx, cy), r, 1)

        # Health bar (if multi-hit)
        if self.max_health > 1:
            bw = r * 2
            bx = cx - r
            by = cy + r + 4
            pygame.draw.rect(surf, DARK_GRAY, (bx, by, bw, 4))
            fw = int(bw * self.health / self.max_health)
            if fw > 0:
                pygame.draw.rect(surf, GREEN, (bx, by, fw, 4))

    def get_rect(self) -> pygame.Rect:
        r = self.radius
        return pygame.Rect(self.x - r, self.y - r, r * 2, r * 2)


# ─────────────────────────────────────────────────────────────────────────────
# Boss
# ─────────────────────────────────────────────────────────────────────────────
class Boss:
    """
    Music-driven boss.  Phase transitions are health-based (visual colour
    changes); attack patterns escalate each phase.
    """

    PHASE_COLORS = {
        "INTRO":  ( 80,  80, 220),
        "PHASE1": ( 80, 100, 255),
        "PHASE2": (255, 140,   0),
        "PHASE3": (255,  30,  30),
        "DYING":  (255, 255, 255),
    }

    def __init__(self, health: int):
        self.x          = float(SCREEN_W // 2)
        self.y          = float(-BOSS_RADIUS - 10)
        self.radius     = BOSS_RADIUS
        self.health     = int(health)
        self.max_health = int(health)
        self.alive      = True
        self.phase      = "INTRO"
        self.color      = self.PHASE_COLORS["INTRO"]
        self.t          = 0.0
        self.vx         = 2.0
        self.fire_timer = 80
        self.hurt_flash = 0
        self.dying_timer = 0

    # ── Update ────────────────────────────────────────────────────────────────

    def update(self, px: float, py: float, song_progress: float,
               enemy_bullets: list, particles: list):
        self.t += 0.03

        if self.phase == "INTRO":
            self.y += (float(BOSS_ENTRY_Y) - self.y) * 0.04
            if abs(self.y - BOSS_ENTRY_Y) < 2.0:
                self.y    = float(BOSS_ENTRY_Y)
                self.phase = self._health_phase()
            return

        if self.phase == "DYING":
            self.dying_timer -= 1
            for _ in range(4):
                a   = random.uniform(0, math.tau)
                spd = random.uniform(3, 10)
                col = random.choice([RED, ORANGE, YELLOW, WHITE])
                particles.append(Particle(
                    self.x + random.uniform(-self.radius, self.radius),
                    self.y + random.uniform(-self.radius, self.radius),
                    col, math.cos(a) * spd, math.sin(a) * spd,
                    random.randint(30, 70)))
            if self.dying_timer <= 0:
                self.alive = False
            return

        # Sync phase from health
        new_phase = self._health_phase()
        if new_phase != self.phase:
            self.phase = new_phase
            self.color = self.PHASE_COLORS[new_phase]

        # Movement
        if self.phase == "PHASE1":
            self.x = (SCREEN_W / 2
                      + math.sin(self.t * 0.7) * (SCREEN_W / 2 - self.radius - 20))
            self.y = BOSS_ENTRY_Y + math.sin(self.t * 1.1) * 28
            self.fire_timer -= 1
            if self.fire_timer <= 0:
                self.fire_timer = 90
                self._fire_aimed(px, py, enemy_bullets)

        elif self.phase == "PHASE2":
            self.x += self.vx * 2.8
            if self.x > SCREEN_W - self.radius - 10 or self.x < self.radius + 10:
                self.vx = -self.vx
            self.y = BOSS_ENTRY_Y + math.sin(self.t * 2.0) * 55
            self.fire_timer -= 1
            if self.fire_timer <= 0:
                self.fire_timer = 55
                self._fire_spread(px, py, enemy_bullets)

        elif self.phase == "PHASE3":
            dx = px - self.x
            self.x += max(-5.0, min(5.0, dx * 0.05)) + math.sin(self.t * 4) * 3.5
            self.y  = BOSS_ENTRY_Y + math.sin(self.t * 3.2) * 80
            self.fire_timer -= 1
            if self.fire_timer <= 0:
                self.fire_timer = 28
                self._fire_circle(enemy_bullets)
                # Also aimed
                if self.t % (math.pi * 2) < 0.1:
                    self._fire_aimed(px, py, enemy_bullets)

        self.x = max(float(self.radius + 10),
                     min(float(SCREEN_W - self.radius - 10), self.x))

        if self.hurt_flash > 0:
            self.hurt_flash -= 1

    def _health_phase(self) -> str:
        ratio = self.health / self.max_health
        if ratio > 0.66:
            return "PHASE1"
        elif ratio > 0.33:
            return "PHASE2"
        else:
            return "PHASE3"

    # ── Attack patterns ───────────────────────────────────────────────────────

    def _fire_aimed(self, px, py, bullets):
        dx = px - self.x
        dy = py - (self.y + self.radius)
        dist = max(1.0, math.hypot(dx, dy))
        spd  = ENEMY_BULLET_SPEED
        bullets.append(EnemyBullet(self.x, self.y + self.radius,
                                   dx / dist * spd, dy / dist * spd,
                                   self.color))

    def _fire_spread(self, px, py, bullets):
        dx = px - self.x
        dy = py - (self.y + self.radius)
        base = math.atan2(dy, dx)
        for i in range(5):
            a   = base + (i - 2) * 0.22
            spd = ENEMY_BULLET_SPEED
            bullets.append(EnemyBullet(self.x, self.y + self.radius,
                                       math.cos(a) * spd, math.sin(a) * spd,
                                       ORANGE))

    def _fire_circle(self, bullets):
        n = 14
        for i in range(n):
            a   = self.t + (i / n) * math.tau
            spd = ENEMY_BULLET_SPEED * 1.15
            bullets.append(EnemyBullet(self.x, self.y + self.radius,
                                       math.cos(a) * spd, math.sin(a) * spd,
                                       RED))

    # ── Hit ───────────────────────────────────────────────────────────────────

    def take_hit(self, particles: list):
        self.health     -= 1
        self.hurt_flash  = 6
        if self.health <= 0 and self.phase != "DYING":
            self.phase        = "DYING"
            self.dying_timer  = 150

    def is_dead(self) -> bool:
        return not self.alive

    # ── Draw ─────────────────────────────────────────────────────────────────

    def draw(self, surf):
        cx, cy = int(self.x), int(self.y)
        r      = self.radius
        col    = WHITE if self.hurt_flash % 2 == 1 else self.color

        # Glow rings
        for g in range(4):
            gr  = r + g * 5
            lum = max(0, 90 - g * 22)
            gc  = tuple(min(255, c + lum) for c in col)
            pygame.draw.circle(surf, gc, (cx, cy), gr, 2)

        # Body
        pygame.draw.circle(surf, col, (cx, cy), r)
        inner = tuple(max(0, c - 55) for c in col)
        pygame.draw.circle(surf, inner, (cx, cy), r - 12)

        # Rotating spines (decorative)
        n_spines = {"PHASE1": 4, "PHASE2": 6, "PHASE3": 10, "DYING": 0, "INTRO": 4
                    }.get(self.phase, 4)
        for i in range(n_spines):
            a  = self.t * 0.6 + (i / n_spines) * math.tau
            x1 = cx + math.cos(a) * (r - 16)
            y1 = cy + math.sin(a) * (r - 16)
            x2 = cx + math.cos(a) * (r - 3)
            y2 = cy + math.sin(a) * (r - 3)
            pygame.draw.line(surf, WHITE, (int(x1), int(y1)), (int(x2), int(y2)), 2)

        # Rim
        pygame.draw.circle(surf, WHITE, (cx, cy), r, 2)

    def get_rect(self) -> pygame.Rect:
        r = self.radius
        return pygame.Rect(self.x - r, self.y - r, r * 2, r * 2)
