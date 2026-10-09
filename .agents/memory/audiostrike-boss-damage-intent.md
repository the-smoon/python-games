---
name: Shield-only hit protection
description: All connected damage can hurt the player unless an active shield absorbs it.
---

Remove temporary hit-invulnerability: every connected enemy or boss hit, including blasts, lasers, and sweeping beams, can damage the player unless an active shield absorbs it. Keep actual safe zones safe and prevent a single sustained attack from applying unintended per-frame damage.

**Why:** The user explicitly replaced source-specific invulnerability exceptions with a consistent rule that only an active shield protects the player.

**How to apply:** Remove temporary hit-invulnerability as a damage gate for all sources; keep shield absorption and the actual geometry of boss safe zones.
