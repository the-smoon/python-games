"""
AudioStrike — heads-up display rendering helpers.
"""

import pygame
from constants import *


def draw_hud(surf, font_sm, font_md,
             player, score: int, behavior_label: str,
             beat_flash: int, song_progress: float, state: str):
    """Render the in-game HUD (score, health, song bar, beat indicator)."""

    # ── Score ─────────────────────────────────────────────────────────────────
    score_surf = font_md.render(f"SCORE  {score:>08,}", True, WHITE)
    surf.blit(score_surf, (10, 10))

    # ── Player health pips ────────────────────────────────────────────────────
    pip_w, pip_h = 18, 10
    for i in range(PLAYER_HEALTH):
        col = GREEN if i < player.health else DARK_GRAY
        rx  = 10 + i * (pip_w + 4)
        ry  = SCREEN_H - 26
        pygame.draw.rect(surf, col, (rx, ry, pip_w, pip_h), border_radius=2)
        pygame.draw.rect(surf, WHITE, (rx, ry, pip_w, pip_h), 1, border_radius=2)

    # ── Song progress bar (bottom centre) ────────────────────────────────────
    bar_x = SCREEN_W // 2 - 110
    bar_y = SCREEN_H - 18
    bar_w = 220
    bar_h = 6
    pygame.draw.rect(surf, DARK_GRAY, (bar_x, bar_y, bar_w, bar_h), border_radius=3)
    fill_w = int(bar_w * min(1.0, max(0.0, song_progress)))
    if fill_w > 0:
        bar_col = CYAN if state == "BOSS" else BLUE
        pygame.draw.rect(surf, bar_col, (bar_x, bar_y, fill_w, bar_h), border_radius=3)
    pygame.draw.rect(surf, MID_GRAY, (bar_x, bar_y, bar_w, bar_h), 1, border_radius=3)

    # ── Beat pulse indicator (bottom right) ───────────────────────────────────
    if beat_flash > 0:
        lum = int(255 * beat_flash / 8)
        pygame.draw.circle(surf, (lum, lum, 0), (SCREEN_W - 22, SCREEN_H - 22), 8)
    else:
        pygame.draw.circle(surf, DARK_GRAY, (SCREEN_W - 22, SCREEN_H - 22), 8, 1)

    # ── Current wave / behaviour (top right) ─────────────────────────────────
    if behavior_label:
        lab = font_sm.render(f"WAVE: {behavior_label}", True, YELLOW)
        surf.blit(lab, (SCREEN_W - lab.get_width() - 10, 10))


def draw_boss_bar(surf, font_md, boss):
    """Render the boss health bar at the top of the screen."""
    label = font_md.render("B O S S", True, RED)
    surf.blit(label, (SCREEN_W // 2 - label.get_width() // 2, 6))

    bar_x = SCREEN_W // 2 - 210
    bar_y = 28
    bar_w = 420
    bar_h = 14

    pygame.draw.rect(surf, DARK_GRAY, (bar_x, bar_y, bar_w, bar_h), border_radius=5)

    ratio  = max(0.0, boss.health / boss.max_health)
    fill_w = int(bar_w * ratio)
    if fill_w > 0:
        phase_col = {
            "PHASE1": BLUE,
            "PHASE2": ORANGE,
            "PHASE3": RED,
            "DYING":  WHITE,
            "INTRO":  BLUE,
        }.get(boss.phase, RED)
        pygame.draw.rect(surf, phase_col, (bar_x, bar_y, fill_w, bar_h), border_radius=5)

    pygame.draw.rect(surf, WHITE, (bar_x, bar_y, bar_w, bar_h), 1, border_radius=5)

    hp_surf = font_md.render(f"{max(0, boss.health)} / {boss.max_health}", True, WHITE)
    surf.blit(hp_surf,
              (SCREEN_W // 2 - hp_surf.get_width() // 2, bar_y + bar_h + 3))
