"""
AudioStrike — beat-synchronised enemy spawner.

The Spawner reads the AudioFeatures timeline and, on each beat, determines
what kind of enemies to create based on the audio characteristics at that
moment in the song.
"""

import random
import math
from constants import *
from entities import Enemy
from audio_analyzer import AudioFeatures


class Spawner:
    def __init__(self, features: AudioFeatures):
        self.features          = features
        self.beat_index        = 0
        self.formation_counter = 0

    # ── Called every game frame ───────────────────────────────────────────────

    def update(self, song_time: float) -> list[Enemy]:
        """
        Advance through beat timeline up to *song_time* and return any
        newly created Enemy objects.
        """
        new_enemies: list[Enemy] = []
        bt = self.features.beat_times

        while self.beat_index < len(bt) and bt[self.beat_index] <= song_time:
            new_enemies += self._spawn_at_beat(self.beat_index)
            self.beat_index += 1

        return new_enemies

    # ── Beat processing ───────────────────────────────────────────────────────

    def _spawn_at_beat(self, beat_idx: int) -> list[Enemy]:
        t = self.features.beat_times[beat_idx]
        f = self.features.at(t)

        rms      = f["rms"]
        low      = f["low"]
        mid      = f["mid"]
        high     = f["high"]
        flatness = f["flatness"]
        onset    = f["onset"]
        centroid = f["centroid"]

        # Very quiet passage → skip most beats (breathing room)
        if rms < 0.15 and onset < 0.20:
            if beat_idx % 4 != 0:
                return []

        # ── How many enemies this beat ────────────────────────────────────────
        # Driven by overall loudness and sudden transients
        count = 1
        if rms   > 0.35: count = 2
        if rms   > 0.60: count = 3
        if onset > 0.88: count = max(count, 4)   # sharp transient = surge

        # ── Behaviour ─────────────────────────────────────────────────────────
        behavior = self._pick_behavior(rms, low, mid, high, flatness, onset, centroid)

        # ── Enemy stats from audio features ───────────────────────────────────

        # Health: bass energy = thick, heavy enemies
        # Range 1–7
        health = max(1, round(1 + low * 6))

        # Radius: combined bass + loudness
        raw_r  = low * 0.65 + rms * 0.35
        radius = int(ENEMY_MIN_RADIUS
                     + raw_r * (ENEMY_MAX_RADIUS - ENEMY_MIN_RADIUS))
        radius = max(ENEMY_MIN_RADIUS, min(ENEMY_MAX_RADIUS, radius))

        # Speed: high-frequency content + spectral brightness
        # Fast treble-heavy passages → nimble enemies
        speed = 1.0 + centroid * 3.2 + high * 1.6

        # Fire rate: mid energy determines aggression
        # 0 = never fires, 30 = fires every 0.5 s at 60 fps
        fire_rate = 0
        if behavior in ("SHOOTER", "SWARM", "DIVE") and mid > 0.28:
            fire_rate = max(30, int(180 - mid * 155))

        # ── Spawn positions ───────────────────────────────────────────────────
        formation_id = self.formation_counter if behavior == "FORMATION" else None
        xs = self._spawn_xs(count, behavior)

        enemies: list[Enemy] = []
        for x in xs:
            y = float(-radius - random.randint(0, 25))
            enemies.append(Enemy(x, y, radius, health, speed,
                                 behavior, fire_rate, formation_id))

        if behavior == "FORMATION":
            self.formation_counter += 1

        return enemies

    # ── Behaviour selection ───────────────────────────────────────────────────

    def _pick_behavior(self, rms, low, mid, high, flatness, onset, centroid) -> str:
        """
        Priority rules map dominant audio characteristics to enemy types.

        What each feature drives:
        • low  (sub-bass)  → TANK      — slow, large, high-health enemies
        • onset (transient) → DIVE      — sudden burst, dive-bombs the player
        • high + rms       → SWARM     — fast chaotic enemies on bright noisy sections
        • flatness (tonal) → FORMATION — tonal/harmonic music = orderly formations
        • mid + onset      → SHOOTER   — aggressive mid-heavy sections
        • high + centroid  → ZIGZAG    — bright, high-pitched sections
        • default          → PATROL    — steady descent, side-to-side sway
        """
        if low   > 0.75 and rms   > 0.48:  return "TANK"
        if onset > 0.90:                    return "DIVE"
        if high  > 0.68 and rms   > 0.52:  return "SWARM"
        if flatness < 0.25 and rms > 0.42: return "FORMATION"
        if mid   > 0.58 and onset > 0.44:  return "SHOOTER"
        if high  > 0.48 and centroid > 0.52: return "ZIGZAG"
        return "PATROL"

    # ── Spawn X positions ─────────────────────────────────────────────────────

    def _spawn_xs(self, count: int, behavior: str) -> list[float]:
        if behavior == "FORMATION":
            # Evenly spaced across the screen width
            spacing  = min(130, (SCREEN_W - 120) // max(1, count))
            total_w  = spacing * (count - 1)
            start_x  = (SCREEN_W - total_w) // 2
            return [float(start_x + i * spacing) for i in range(count)]
        else:
            return [float(random.randint(60, SCREEN_W - 60)) for _ in range(count)]
