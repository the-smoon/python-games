---
name: AudioStrike geometric visuals and death effects
description: User intent for clean enemy shapes, composite bosses, Nox-inspired explosions, and death-wave disruption.
---

Use clean, symmetric geometric enemy silhouettes, including rectangles, ovals, and elbow-like curved forms, rather than irregular animated blobs. Bosses should remain visibly composite geometric machines even after launching all detachable sub-enemies.

**Why:** The user explicitly requested simple recognizable shape variety and bosses composed of multiple shapes; detaching every wing must not leave a boss looking like an ordinary enemy.

**How to apply:** Keep a permanent paired hull distinct from detachable parts. Use song analysis for proportions and palettes, and maintain geometric legibility in portrait.

Regular deaths use luminous radial square pixels. Boss deaths additionally shed large debris that splinters into smaller pieces and produce a shockwave: briefly stun non-boss enemies, then give them five seconds of sluggish/random movement and firing. Other bosses are immune to this disruption.

**Why:** The user requested these effects and specifically excluded other bosses from the death-wave status.

**How to apply:** Bound recursive debris and particle growth. Treat Nox as a visual inspiration, not a verified exact death-effect recipe; available research supports glow, transparency, particles, and shrapnel, not every detail of the requested recipe.

Boss blast/debuff zones must visibly charge and brighten for five seconds before applying their effects. Dead owners must not leave pending hostile zones.

**Why:** The user requested five-second brightening circles; the warning is meant to let players move out before detonation.

**How to apply:** Keep zone positions fixed at cast time, show the remaining charge, and retain owner-specific cleanup when bosses stack or die.