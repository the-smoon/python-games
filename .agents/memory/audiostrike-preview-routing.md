---
name: Rhythm Fighter preview routing
description: Replit preview and mobile access constraint for the Rhythm Fighter browser game.
---

The Rhythm Fighter browser game is served reliably through its managed root web artifact, not through a manually configured workflow port URL.

**Why:** The direct development-domain URL with an explicit port opened blank or timed out externally, while the managed artifact workflow rendered correctly in the Replit preview.

**How to apply:** Keep `artifacts/audiostrike` as the canonical browser app and use its managed `artifacts/audiostrike: web` workflow and root preview when testing or sharing the game.

The primary artifact is now `rhythm-fighter` at the root preview path. The immutable `audiostrike` artifact remains on `/audiostrike-legacy/` during the identity transition.

**Why:** The registered artifact ID cannot be changed in place, and the user required the previous published version to remain available until the new identity was verified.

**How to apply:** Use `artifacts/rhythm-fighter` and its managed root workflow for new previews. Keep the old artifact isolated on its legacy route; do not move the old ID or publish over the prior version without an approved release.

The user specifically approved the boss-fight feel as a good baseline; preserve that encounter structure while tuning projectile balance.

**Why:** The boss fight was explicitly described as great before the projectile update.

**How to apply:** Prefer targeted combat-balance changes over redesigning the boss phases or encounter flow unless the user asks for that.

Rhythm Fighter uses browser-native Web Audio analysis during playback rather than uploading tracks or relying on precomputed beat timelines.

**Why:** Local file playback stays private, and live spectral response is available on the same managed browser route used by desktop and touchscreen previews.

**How to apply:** Keep stage and boss behavior driven from their active `AnalyserNode` streams; preserve the local-file flow unless server-side analysis is explicitly requested.