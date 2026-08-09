---
name: AudioStrike preview routing
description: Replit preview and mobile access constraint for the AudioStrike browser game.
---

The AudioStrike browser game is served reliably through its managed root web artifact, not through a manually configured workflow port URL.

**Why:** The direct development-domain URL with an explicit port opened blank or timed out externally, while the managed artifact workflow rendered correctly in the Replit preview.

**How to apply:** Keep `artifacts/audiostrike` as the canonical browser app and use its managed `artifacts/audiostrike: web` workflow and root preview when testing or sharing the game.

The user specifically approved the boss-fight feel as a good baseline; preserve that encounter structure while tuning projectile balance.

**Why:** The boss fight was explicitly described as great before the projectile update.

**How to apply:** Prefer targeted combat-balance changes over redesigning the boss phases or encounter flow unless the user asks for that.