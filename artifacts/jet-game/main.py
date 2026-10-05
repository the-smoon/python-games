#!/usr/bin/env python3
"""
Rhythm Fighter — entry point.

Initialises pygame, runs the native file-picker twice (stage song + boss
song), then hands off to the Game class.
"""

import sys
import os

import os
import pygame
from constants import *


def _init_mixer() -> bool:
    """Try real audio; fall back to dummy driver if no device is found."""
    try:
        pygame.mixer.init(frequency=44100, size=-16, channels=2, buffer=2048)
        return True
    except pygame.error:
        # No audio device (e.g. Replit VNC) — use SDL dummy driver so the
        # rest of mixer's API still works for timing/state checks.
        os.environ["SDL_AUDIODRIVER"] = "dummy"
        try:
            pygame.mixer.init(frequency=44100, size=-16, channels=2, buffer=2048)
        except pygame.error:
            pass   # mixer completely unavailable; timing falls back to ticks
        return False


def _welcome_screen(screen: pygame.Surface, font_xl, font_md, font_sm) -> None:
    """Brief splash before the first file picker opens."""
    screen.fill(DARK_BG)

    title = font_xl.render("RHYTHM FIGHTER", True, CYAN)
    screen.blit(title, (SCREEN_W // 2 - title.get_width() // 2, 180))

    tag = font_md.render("Music-driven aerial combat", True, MID_GRAY)
    screen.blit(tag, (SCREEN_W // 2 - tag.get_width() // 2, 262))

    lines = [
        "You will choose  TWO  audio files:",
        "",
        "  1)  STAGE SONG  — drives all enemy behaviour",
        "       (enemy count · speed · health · patterns · fire rate)",
        "",
        "  2)  BOSS SONG   — plays during the entire boss fight",
        "       (boss phases sync to song energy changes)",
        "",
        "Supported formats:  MP3 · WAV · OGG · FLAC · M4A",
        "",
        "Press  ENTER  to begin",
    ]
    y = 340
    for line in lines:
        s = font_sm.render(line, True, WHITE if line and not line.startswith("  ") else MID_GRAY)
        screen.blit(s, (SCREEN_W // 2 - s.get_width() // 2, y))
        y += 22

    pygame.display.flip()

    # Wait for ENTER or quit
    clock = pygame.time.Clock()
    while True:
        for evt in pygame.event.get():
            if evt.type == pygame.QUIT:
                pygame.quit(); sys.exit()
            if evt.type == pygame.KEYDOWN:
                if evt.key == pygame.K_ESCAPE:
                    pygame.quit(); sys.exit()
                if evt.key in (pygame.K_RETURN, pygame.K_KP_ENTER, pygame.K_SPACE):
                    return
        clock.tick(60)


if __name__ == "__main__":
    # ── Bootstrap pygame display (needed for file picker) ─────────────────────
    pygame.init()
    _init_mixer()
    screen = pygame.display.set_mode((SCREEN_W, SCREEN_H))
    pygame.display.set_caption(TITLE)

    font_sm = pygame.font.SysFont("monospace", 14, bold=True)
    font_md = pygame.font.SysFont("monospace", 18, bold=True)
    font_lg = pygame.font.SysFont("monospace", 36, bold=True)
    font_xl = pygame.font.SysFont("monospace", 60, bold=True)

    # ── Welcome splash ────────────────────────────────────────────────────────
    _welcome_screen(screen, font_xl, font_md, font_sm)

    # ── File selection ────────────────────────────────────────────────────────
    from file_picker import pick_audio_file

    stage_path = pick_audio_file(screen, "Pick STAGE SONG  (drives enemy behaviour)")
    if not stage_path:
        print("No stage song selected — exiting.")
        pygame.quit(); sys.exit(0)

    boss_path = pick_audio_file(screen, "Pick BOSS SONG  (plays during boss fight)")
    if not boss_path:
        print("No boss song selected — exiting.")
        pygame.quit(); sys.exit(0)

    # Validate
    for label, path in [("Stage song", stage_path), ("Boss song", boss_path)]:
        if not os.path.isfile(path):
            print(f"{label} not found: {path}")
            pygame.quit(); sys.exit(1)

    # ── Launch game (reuses the running pygame instance) ──────────────────────
    from game import Game

    g = Game(stage_path, boss_path, existing_screen=screen)
    g.run()
