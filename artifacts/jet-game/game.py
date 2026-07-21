"""
AudioStrike — main Game class.

State machine:
  ANALYZING  →  COUNTDOWN  →  PLAYING  →  BOSS_INTRO  →  BOSS
                                 ↓                           ↓
                             GAME_OVER ←─────────────────────┘
                             VICTORY   ←─── (boss dies)
"""

import pygame
import sys
import math
import random
import threading
import os

import audio_analyzer
from constants import *
from entities import Player, Enemy, Boss, Bullet, EnemyBullet, Particle
from spawner import Spawner
from hud import draw_hud, draw_boss_bar


class Game:
    def __init__(self, stage_path: str, boss_path: str,
                 existing_screen: pygame.Surface | None = None):
        # pygame may already be initialised by main.py; these calls are safe
        # to repeat.
        pygame.init()
        if not pygame.mixer.get_init():
            try:
                pygame.mixer.init(frequency=44100, size=-16, channels=2, buffer=2048)
            except pygame.error:
                pass  # no audio device; timing falls back to wall-clock ticks

        if existing_screen is not None:
            self.screen = existing_screen
        else:
            self.screen = pygame.display.set_mode((SCREEN_W, SCREEN_H))
        pygame.display.set_caption(TITLE)
        self.clock  = pygame.time.Clock()

        # Fonts
        self.font_sm = pygame.font.SysFont("monospace", 14, bold=True)
        self.font_md = pygame.font.SysFont("monospace", 18, bold=True)
        self.font_lg = pygame.font.SysFont("monospace", 36, bold=True)
        self.font_xl = pygame.font.SysFont("monospace", 60, bold=True)

        self.stage_path = stage_path
        self.boss_path  = boss_path

        # Analysis
        self.stage_features  = None
        self.boss_features   = None
        self.analysis_progress = 0.0
        self.analysis_done   = False
        self.analysis_error  = None

        # Global frame counter
        self.frame = 0
        self.score = 0

        # Scrolling starfield (x, y, size, brightness)
        self.stars = [
            (random.randint(0, SCREEN_W),
             random.randint(0, SCREEN_H),
             random.randint(1, 3),
             random.uniform(0.25, 1.0))
            for _ in range(130)
        ]

        # Game entities
        self.player:        Player           = Player()
        self.enemies:       list[Enemy]      = []
        self.bullets:       list[Bullet]     = []
        self.enemy_bullets: list[EnemyBullet]= []
        self.particles:     list[Particle]   = []
        self.boss:          Boss | None      = None

        # Gameplay bookkeeping
        self.spawner:            Spawner | None = None
        self.song_time:          float          = 0.0
        self.song_start_ticks:   int            = 0   # pygame.time.get_ticks() when music started
        self.boss_start_ticks:   int            = 0
        self.stage_done:         bool           = False
        self.waiting_for_clear:  bool           = False
        self.boss_intro_timer:   int            = 0
        self.beat_flash:         int            = 0
        self.beat_check_idx:     int            = 0
        self.current_behavior:   str            = ""
        self.victory_timer:      int            = 0

        # Countdown
        self.countdown:       int = 3
        self.countdown_timer: int = 0

        # State
        self.state = "ANALYZING"

        # Kick off background analysis immediately
        self._start_analysis()

    # ── Background analysis ───────────────────────────────────────────────────

    def _start_analysis(self):
        def _run():
            try:
                def p1(v): self.analysis_progress = v * 0.50
                self.stage_features = audio_analyzer.analyze(self.stage_path, p1)

                def p2(v): self.analysis_progress = 0.50 + v * 0.50
                self.boss_features  = audio_analyzer.analyze(self.boss_path, p2)

                self.analysis_done = True
            except Exception as exc:
                self.analysis_error = str(exc)

        threading.Thread(target=_run, daemon=True).start()

    # ── State transitions ─────────────────────────────────────────────────────

    def _begin_countdown(self):
        self.state           = "COUNTDOWN"
        self.countdown       = 3
        self.countdown_timer = FPS

    def _begin_playing(self):
        self.state = "PLAYING"
        # Reset everything
        self.player         = Player()
        self.enemies        = []
        self.bullets        = []
        self.enemy_bullets  = []
        self.particles      = []
        self.boss           = None
        self.score          = 0
        self.stage_done     = False
        self.waiting_for_clear = False
        self.current_behavior  = ""
        self.beat_check_idx    = 0
        self.beat_flash        = 0

        self.spawner = Spawner(self.stage_features)

        try:
            pygame.mixer.music.load(self.stage_path)
            pygame.mixer.music.play()
        except pygame.error:
            pass  # no audio device; timing still works via wall-clock
        self.song_start_ticks = pygame.time.get_ticks()

    def _begin_boss_intro(self):
        self.state            = "BOSS_INTRO"
        self.boss_intro_timer = 200        # ~3.3 s
        # Clear the field
        self.enemies       = []
        self.enemy_bullets = []
        try:
            pygame.mixer.music.stop()
        except pygame.error:
            pass

    def _begin_boss(self):
        self.state = "BOSS"
        hp = max(150, int(BOSS_HEALTH_BASE * (0.5 + float(self.boss_features.rms.mean()))))
        self.boss           = Boss(hp)
        self.bullets        = []
        self.enemy_bullets  = []
        self.beat_check_idx = 0
        self.beat_flash     = 0

        try:
            pygame.mixer.music.load(self.boss_path)
            pygame.mixer.music.play()
        except pygame.error:
            pass
        self.boss_start_ticks = pygame.time.get_ticks()

    def _game_over(self):
        self.state = "GAME_OVER"
        try: pygame.mixer.music.stop()
        except pygame.error: pass

    def _victory(self):
        self.state         = "VICTORY"
        self.victory_timer = 360
        try: pygame.mixer.music.stop()
        except pygame.error: pass

    # ── Main loop ─────────────────────────────────────────────────────────────

    def run(self):
        while True:
            self._handle_events()
            self._update()
            self._draw()
            self.clock.tick(FPS)
            self.frame += 1

    # ── Events ────────────────────────────────────────────────────────────────

    def _handle_events(self):
        for evt in pygame.event.get():
            if evt.type == pygame.QUIT:
                pygame.quit(); sys.exit()
            if evt.type == pygame.KEYDOWN:
                if evt.key == pygame.K_ESCAPE:
                    pygame.quit(); sys.exit()
                if evt.key == pygame.K_RETURN:
                    if self.state in ("GAME_OVER", "VICTORY"):
                        self._begin_countdown()

    # ── Update dispatcher ─────────────────────────────────────────────────────

    def _update(self):
        if self.state == "ANALYZING":
            self._update_analyzing()
        elif self.state == "COUNTDOWN":
            self._update_countdown()
        elif self.state == "PLAYING":
            self._update_playing()
        elif self.state == "BOSS_INTRO":
            self._update_boss_intro()
        elif self.state == "BOSS":
            self._update_boss()
        elif self.state == "VICTORY":
            self._update_victory()

    def _update_analyzing(self):
        if self.analysis_error:
            print(f"[ERROR] Audio analysis failed: {self.analysis_error}")
            pygame.quit(); sys.exit(1)
        if self.analysis_done:
            self._begin_countdown()

    def _update_countdown(self):
        self.countdown_timer -= 1
        if self.countdown_timer <= 0:
            self.countdown -= 1
            if self.countdown <= 0:
                self._begin_playing()
            else:
                self.countdown_timer = FPS

    def _update_playing(self):
        keys = pygame.key.get_pressed()
        self.player.update(keys)
        self.bullets.extend(self.player.try_fire(keys))

        # Song position
        self.song_time = self._song_pos()

        # Beat flash
        self._tick_beat_flash(self.stage_features)

        # Enemy spawning
        if not self.stage_done and self.spawner:
            new = self.spawner.update(self.song_time)
            slots = MAX_ENEMIES_ON_SCREEN - len(self.enemies)
            if new:
                self.enemies.extend(new[:max(0, slots)])
                self.current_behavior = new[-1].behavior

        # Detect stage song end (use wall-clock; mixer.get_busy() unreliable with dummy driver)
        if (not self.stage_done
                and self.stage_features
                and self.song_time >= self.stage_features.duration):
            self.stage_done        = True
            self.waiting_for_clear = True

        # Update enemies
        for e in self.enemies:
            e.update(self.player.x, self.player.y,
                     self.enemy_bullets, self.particles)

        # Update projectiles + particles
        for b  in self.bullets:       b.update()
        for eb in self.enemy_bullets: eb.update()
        for p  in self.particles:     p.update()

        # Collisions ───────────────────────────────────────────────────────────

        # Player bullets → enemies
        for b in self.bullets:
            if not b.alive: continue
            br = b.get_rect()
            for e in self.enemies:
                if not e.alive: continue
                if br.colliderect(e.get_rect()):
                    b.alive = False
                    e.take_hit(self.particles)
                    if not e.alive:
                        self.score += e.score_value()
                    break

        # Enemy bullets → player
        pr = self.player.get_rect()
        for eb in self.enemy_bullets:
            if not eb.alive: continue
            if pr.colliderect(eb.get_rect()):
                self.player.take_hit(self.particles)
                eb.alive = False

        # Enemy body → player (circle vs rect)
        for e in self.enemies:
            if not e.alive: continue
            cx = max(float(pr.left), min(e.x, float(pr.right)))
            cy = max(float(pr.top),  min(e.y, float(pr.bottom)))
            if math.hypot(e.x - cx, e.y - cy) < e.radius:
                self.player.take_hit(self.particles)

        # Prune dead objects
        self.bullets       = [b  for b  in self.bullets       if b.alive]
        self.enemy_bullets = [eb for eb in self.enemy_bullets if eb.alive]
        self.enemies       = [e  for e  in self.enemies        if e.alive]
        self.particles     = [p  for p  in self.particles      if p.alive()]

        # Player dead?
        if not self.player.alive:
            self._game_over(); return

        # All enemies cleared after song ended → boss time
        if self.waiting_for_clear and len(self.enemies) == 0:
            self._begin_boss_intro()

    def _update_boss_intro(self):
        self.boss_intro_timer -= 1
        for p in self.particles: p.update()
        self.particles = [p for p in self.particles if p.alive()]
        if self.boss_intro_timer <= 0:
            self._begin_boss()

    def _update_boss(self):
        keys = pygame.key.get_pressed()
        self.player.update(keys)
        self.bullets.extend(self.player.try_fire(keys))

        boss_time     = self._song_pos()
        song_progress = boss_time / max(1.0, self.boss_features.duration)

        # Beat flash synced to boss song
        self._tick_beat_flash(self.boss_features)

        if self.boss:
            self.boss.update(self.player.x, self.player.y,
                             song_progress, self.enemy_bullets, self.particles)

        for b  in self.bullets:       b.update()
        for eb in self.enemy_bullets: eb.update()
        for p  in self.particles:     p.update()

        # Player bullets → boss
        if self.boss and self.boss.phase not in ("INTRO", "DYING"):
            r2 = self.boss.radius ** 2
            for b in self.bullets:
                if not b.alive: continue
                dx = b.x - self.boss.x
                dy = (b.y + BULLET_H / 2) - self.boss.y
                if dx * dx + dy * dy <= r2:
                    b.alive = False
                    self.boss.take_hit(self.particles)
                    self.score += 10

        # Enemy bullets → player
        pr = self.player.get_rect()
        for eb in self.enemy_bullets:
            if not eb.alive: continue
            if pr.colliderect(eb.get_rect()):
                self.player.take_hit(self.particles)
                eb.alive = False

        # Prune
        self.bullets       = [b  for b  in self.bullets       if b.alive]
        self.enemy_bullets = [eb for eb in self.enemy_bullets if eb.alive]
        self.particles     = [p  for p  in self.particles      if p.alive()]

        if not self.player.alive:
            self._game_over(); return

        if self.boss and self.boss.is_dead():
            self.score += SCORE_BOSS
            self._victory()

    def _update_victory(self):
        self.victory_timer -= 1
        for p in self.particles: p.update()
        self.particles = [p for p in self.particles if p.alive()]
        # Victory fireworks
        if self.frame % 7 == 0:
            x   = random.randint(80, SCREEN_W - 80)
            y   = random.randint(80, SCREEN_H - 350)
            col = random.choice([RED, ORANGE, YELLOW, GREEN, CYAN, PURPLE, PINK])
            for _ in range(18):
                a   = random.uniform(0, math.tau)
                spd = random.uniform(3, 9)
                self.particles.append(
                    Particle(x, y, col,
                             math.cos(a) * spd, math.sin(a) * spd,
                             random.randint(40, 80)))

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _song_pos(self) -> float:
        """
        Return current song position in seconds using wall-clock ticks.
        This works regardless of whether a real audio device is present.
        """
        if self.state == "BOSS":
            return (pygame.time.get_ticks() - self.boss_start_ticks) / 1000.0
        else:
            return (pygame.time.get_ticks() - self.song_start_ticks) / 1000.0

    def _tick_beat_flash(self, features):
        """Advance beat_check_idx and set beat_flash on crossing a beat."""
        if features is None: return
        bt   = features.beat_times
        song = self._song_pos()
        while self.beat_check_idx < len(bt) and bt[self.beat_check_idx] <= song:
            self.beat_flash     = 8
            self.beat_check_idx += 1
        if self.beat_flash > 0:
            self.beat_flash -= 1

    # ── Draw dispatcher ───────────────────────────────────────────────────────

    def _draw(self):
        self.screen.fill(DARK_BG)
        self._draw_stars()

        {
            "ANALYZING":  self._draw_analyzing,
            "COUNTDOWN":  self._draw_countdown,
            "PLAYING":    self._draw_playing,
            "BOSS_INTRO": self._draw_boss_intro,
            "BOSS":       self._draw_boss_state,
            "GAME_OVER":  self._draw_game_over,
            "VICTORY":    self._draw_victory,
        }.get(self.state, lambda: None)()

        pygame.display.flip()

    def _draw_stars(self):
        for sx, sy, size, brightness in self.stars:
            sy2 = int((sy + self.frame * 0.35) % SCREEN_H)
            lum = int(255 * brightness)
            pygame.draw.circle(self.screen, (lum, lum, lum), (int(sx), sy2), size)
        # Beat pulse overlay
        if self.beat_flash > 0:
            alpha = self.beat_flash * 6          # max ~48
            s = pygame.Surface((SCREEN_W, SCREEN_H))
            s.set_alpha(alpha)
            s.fill((alpha, alpha, 0))
            self.screen.blit(s, (0, 0))

    # ── State-specific draw methods ───────────────────────────────────────────

    def _draw_analyzing(self):
        title = self.font_xl.render("AUDIOSTRIKE", True, CYAN)
        self.screen.blit(title, (SCREEN_W // 2 - title.get_width() // 2, 170))

        sub = self.font_md.render("Music-driven aerial combat", True, MID_GRAY)
        self.screen.blit(sub, (SCREEN_W // 2 - sub.get_width() // 2, 250))

        msg = self.font_md.render("Analyzing music — please wait...", True, WHITE)
        self.screen.blit(msg, (SCREEN_W // 2 - msg.get_width() // 2, 320))

        bx, by, bw, bh = SCREEN_W // 2 - 190, 375, 380, 22
        pygame.draw.rect(self.screen, DARK_GRAY, (bx, by, bw, bh), border_radius=10)
        fw = int(bw * self.analysis_progress)
        if fw:
            pygame.draw.rect(self.screen, CYAN, (bx, by, fw, bh), border_radius=10)
        pygame.draw.rect(self.screen, WHITE, (bx, by, bw, bh), 1, border_radius=10)

        pct = self.font_sm.render(f"{int(self.analysis_progress * 100)}%", True, WHITE)
        self.screen.blit(pct, (SCREEN_W // 2 - pct.get_width() // 2, by + bh + 10))

        hint = self.font_sm.render(
            "Extracting beats · energy · spectral features · frequency bands",
            True, MID_GRAY)
        self.screen.blit(hint, (SCREEN_W // 2 - hint.get_width() // 2, 435))

        # Feature legend
        items = [
            ("Sub-bass energy",   "→ Enemy health & size",      PURPLE),
            ("Tempo / beats",     "→ Spawn timing & count",     BLUE),
            ("High frequencies",  "→ Enemy speed & agility",    CYAN),
            ("Onset transients",  "→ Dive-bombs & swarms",      ORANGE),
            ("Mid energy",        "→ Enemy fire rate",          RED),
            ("Spectral flatness", "→ Formations vs. scatter",   GREEN),
            ("Song energy arc",   "→ Boss phase transitions",   GOLD),
        ]
        ly = 490
        for left, right, col in items:
            t = self.font_sm.render(f"  {left:<22} {right}", True, col)
            self.screen.blit(t, (SCREEN_W // 2 - t.get_width() // 2, ly))
            ly += 22

    def _draw_countdown(self):
        title = self.font_xl.render("AUDIOSTRIKE", True, CYAN)
        self.screen.blit(title, (SCREEN_W // 2 - title.get_width() // 2, 180))

        num = self.font_xl.render(str(self.countdown), True, YELLOW)
        self.screen.blit(num, (SCREEN_W // 2 - num.get_width() // 2, 340))

        ctrl = self.font_sm.render(
            "ARROWS / WASD  to move     SPACE to fire     ESC to quit",
            True, MID_GRAY)
        self.screen.blit(ctrl, (SCREEN_W // 2 - ctrl.get_width() // 2, 480))

    def _draw_playing(self):
        for e in self.enemies:       e.draw(self.screen)
        for b  in self.bullets:      b.draw(self.screen)
        for eb in self.enemy_bullets: eb.draw(self.screen)
        for p  in self.particles:    p.draw(self.screen)
        self.player.draw(self.screen, self.frame)

        dur  = self.stage_features.duration if self.stage_features else 1.0
        prog = self.song_time / max(1.0, dur)
        draw_hud(self.screen, self.font_sm, self.font_md,
                 self.player, self.score, self.current_behavior,
                 self.beat_flash, prog, self.state)

        if self.waiting_for_clear and self.enemies:
            msg = self.font_lg.render("Clear the screen!", True, YELLOW)
            self.screen.blit(msg,
                             (SCREEN_W // 2 - msg.get_width() // 2, SCREEN_H // 2 - 30))

    def _draw_boss_intro(self):
        ratio = abs(math.sin(self.boss_intro_timer * 0.05))
        col   = (int(255 * ratio), 0, 0)
        warn  = self.font_xl.render("!  BOSS INCOMING  !", True, col)
        self.screen.blit(warn, (SCREEN_W // 2 - warn.get_width() // 2, SCREEN_H // 2 - 70))

        sub = self.font_md.render("Prepare yourself...", True, WHITE)
        self.screen.blit(sub, (SCREEN_W // 2 - sub.get_width() // 2, SCREEN_H // 2 + 40))

        for p in self.particles: p.draw(self.screen)

    def _draw_boss_state(self):
        if self.boss:
            self.boss.draw(self.screen)
        for b  in self.bullets:       b.draw(self.screen)
        for eb in self.enemy_bullets: eb.draw(self.screen)
        for p  in self.particles:     p.draw(self.screen)
        self.player.draw(self.screen, self.frame)

        boss_time = self._song_pos()
        prog      = boss_time / max(1.0, self.boss_features.duration)
        phase_lbl = self.boss.phase if self.boss else ""
        draw_hud(self.screen, self.font_sm, self.font_md,
                 self.player, self.score, f"BOSS — {phase_lbl}",
                 self.beat_flash, prog, self.state)

        if self.boss:
            draw_boss_bar(self.screen, self.font_md, self.boss)

    def _draw_game_over(self):
        go = self.font_xl.render("GAME OVER", True, RED)
        self.screen.blit(go, (SCREEN_W // 2 - go.get_width() // 2, 240))

        sc = self.font_lg.render(f"Score: {self.score:,}", True, WHITE)
        self.screen.blit(sc, (SCREEN_W // 2 - sc.get_width() // 2, 350))

        re = self.font_md.render("Press ENTER to restart", True, YELLOW)
        self.screen.blit(re, (SCREEN_W // 2 - re.get_width() // 2, 440))

    def _draw_victory(self):
        v = self.font_xl.render("V I C T O R Y", True, GOLD)
        self.screen.blit(v, (SCREEN_W // 2 - v.get_width() // 2, 210))

        sc = self.font_lg.render(f"Final Score:  {self.score:,}", True, WHITE)
        self.screen.blit(sc, (SCREEN_W // 2 - sc.get_width() // 2, 320))

        for p in self.particles: p.draw(self.screen)

        if self.victory_timer < 240:
            re = self.font_md.render("Press ENTER to play again", True, YELLOW)
            self.screen.blit(re, (SCREEN_W // 2 - re.get_width() // 2, 430))
