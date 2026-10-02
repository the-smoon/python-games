---
name: Weapon switching tradeoffs
description: User intent behind ranked weapon replacement, vulnerable wingmen, and local freeze effects.
---

Changing weapon type is meant to sacrifice the previous weapon's accumulated ranks, not retain a separate upgraded loadout. Hull repair offsets that loss without removing the tradeoff.

**Why:** The user explicitly described switching from a highly ranked weapon to rank 1 as a significant handicap, with lost rank potentially compensated by HP.

**How to apply:** Preserve replacement-based progression when tuning weapons or adding new weapon types; do not silently keep each weapon's rank for later switching.

Twin-gun companion ships are deliberately the only weapon bonus that can independently be damaged and destroyed.

**Why:** The user wants their extra firepower balanced by vulnerability and restored through another matching weapon pickup.

**How to apply:** Do not make wingmen invulnerable or add independent destructible upgrades to the other weapon families without a new user decision.

The spread weapon's freeze affects only enemies and bullets caught in its splash, not the entire screen.

**Why:** The user chose splash-local freezing when asked to distinguish it from the screen-clearing bomb.

**How to apply:** Keep the freeze/bomb distinction when adjusting effect size or adding status effects.