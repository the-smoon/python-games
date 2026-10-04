---
name: Boss survival intent
description: User-selected stacking behavior and soundtrack priority for endless encounters.
---

Spawn later bosses on schedule even if earlier bosses survive. Do not impose a one-boss limit or silently remove survivors to simplify progression.

**Why:** The user explicitly chose stacking rather than waiting for surviving bosses to die.

**How to apply:** Keep level scheduling separate from boss lifetime when changing encounters, transitions, or difficulty.

At stage end, stop spawning regular enemies without forcing existing enemies to flee or clearing them on boss arrival. Existing enemies continue normal combat; regular spawning resumes when the current boss's 30-second encounter expires or that boss is killed.

**Why:** The user explicitly requested that enemies no longer rush off-screen at level end, while preserving the existing encounter completion rules.

**How to apply:** Preserve survivors across stage-to-boss transitions. Keep normal enemy movement and lifetime rules, boss-owned sub-enemy cleanup, and transition damage protection unchanged.

Play only the newest living boss's song as the shared combat soundtrack; regular enemies must remain responsive to that audible song. If its boss dies, restore the newest remaining living boss's song before falling back to the current stage's assigned song.

**Why:** The user chose newest-living-boss priority rather than playing simultaneous boss songs. Surviving bosses may temporarily override the stage song without changing its playlist assignment.

**How to apply:** Preserve this priority when changing playlist pairing, playback, live analysis, or enemy behavior.