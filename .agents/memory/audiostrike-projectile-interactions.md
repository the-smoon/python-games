---
name: Player-projectile collision intent
description: How player projectiles should interact with hostile bullets, enemies, bosses, and laser targets.
---

Common enemy bullets are destroyed when touched by a player projectile, but the player projectile continues on its path. Indestructible boss hazards are not cleared and do not stop player shots. Ordinary player bullets end on enemy or boss hulls; the sustained laser beam continues through targets.

**Why:** The user explicitly distinguished bullet interception from hitting a ship and retained the laser as the piercing exception.

**How to apply:** Keep projectile-vs-projectile handling separate from hull-hit handling. Do not consume a player bullet for clearing hostile shots; preserve target-hit stopping for non-laser projectiles.
