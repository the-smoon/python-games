---
name: Weapon switching and rank cap
description: Current intent for weapon switching, rank-seven drops, returning wingmen, and local freeze effects.
---

Weapon type switches preserve the current active rank; weapon pickups are unavailable for 10 seconds after switching. Reaching rank 7 turns later weapon-type drops into +10 mini-health for the rest of the run, while regular health pickups remain +25. Player base health is 200, shield tiers have 100/200/300 health, rank 1 weapons must remain useful, and rank 6–7 effects should scale exponentially.

**Why:** The user replaced the earlier rank-reset design with preserved rank and specified a 10-second weapon-drop cooldown, rank-7 health conversion, stronger base weapons, and steep top-rank scaling; later feedback set the hull and shield values.

**How to apply:** Keep one active rank across weapon type changes; do not reset it or create hidden per-type rank progress. Apply rank-7 drop conversion only within the current run.

Twin-gun companions can be damaged and destroyed, but each destroyed ship immediately starts a visible replacement flight from below the arena and rejoins at full health.

**Why:** The user requested that wingmen remain damageable and able to explode, but be replaced immediately rather than lost for the rest of the run.

**How to apply:** Keep wingmen vulnerable while active; start the off-screen return animation on lethal damage and restore the replacement when it reaches formation.

Wingmen should be substantially tougher and stronger than the original fragile version. Each weapon should retain a distinct role, and regular-enemy health drops should remain rare apart from the explicit rank-7 conversion of weapon drops into mini-health.

**Why:** The user requested durable wingmen, useful rank-1 weapons, exponentially stronger ranks 6–7, and a specific rank-7 mini-health drop rule.

**How to apply:** Compare realistic single-target damage as well as area control and defensive utility; preserve the stationary-laser tradeoff and wingman vulnerability when adjusting balance.

The spread weapon's freeze affects only enemies and bullets caught in its splash, not the entire screen.

**Why:** The user chose splash-local freezing when asked to distinguish it from the screen-clearing bomb.

**How to apply:** Keep the freeze/bomb distinction when adjusting effect size or adding status effects.