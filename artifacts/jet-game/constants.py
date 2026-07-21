"""
AudioStrike — all game constants live here.
"""

# ── Screen ────────────────────────────────────────────────────────────────────
SCREEN_W = 800
SCREEN_H = 900
FPS = 60
TITLE = "AudioStrike"

# ── Colors ────────────────────────────────────────────────────────────────────
BLACK        = (  0,   0,   0)
WHITE        = (255, 255, 255)
DARK_BG      = (  5,   5,  20)
GREEN        = (  0, 200,  80)
BRIGHT_GREEN = (  0, 255, 110)
RED          = (255,  50,  50)
BLUE         = ( 50, 150, 255)
YELLOW       = (255, 220,   0)
ORANGE       = (255, 140,   0)
PURPLE       = (180,  50, 255)
CYAN         = (  0, 220, 255)
PINK         = (255,  80, 200)
GOLD         = (255, 210,   0)
DARK_GRAY    = ( 35,  35,  55)
MID_GRAY     = ( 80,  80, 110)

# ── Enemy behaviour → colour ──────────────────────────────────────────────────
BEHAVIOR_COLORS = {
    "PATROL":    BLUE,
    "ZIGZAG":    CYAN,
    "FORMATION": GREEN,
    "SWARM":     YELLOW,
    "DIVE":      ORANGE,
    "SHOOTER":   RED,
    "TANK":      PURPLE,
}

# ── Player ────────────────────────────────────────────────────────────────────
PLAYER_W        = 36
PLAYER_H        = 52
PLAYER_SPEED    = 5
PLAYER_HEALTH   = 5
INVINCIBLE_DUR  = 90      # frames of invincibility after a hit
FIRE_COOLDOWN   = 5       # frames between player bullets
BULLET_SPEED    = 16
BULLET_W        = 2
BULLET_H        = 10

# ── Enemy ─────────────────────────────────────────────────────────────────────
ENEMY_MIN_RADIUS     = 10
ENEMY_MAX_RADIUS     = 44
ENEMY_BULLET_SPEED   = 4
ENEMY_BULLET_RADIUS  = 4
MAX_ENEMIES_ON_SCREEN = 16

# ── Boss ──────────────────────────────────────────────────────────────────────
BOSS_RADIUS      = 72
BOSS_HEALTH_BASE = 300      # scaled by mean song energy
BOSS_ENTRY_Y     = 140      # y the boss settles at after entering

# ── Scoring ───────────────────────────────────────────────────────────────────
SCORE_ENEMY_BASE = 50
SCORE_BOSS       = 10_000
