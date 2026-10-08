---
name: Boss damage through hit invulnerability
description: Which boss hazards pierce temporary player invulnerability and how their safety rules remain intact.
---

Boss blast detonations, the direct aimed BOLT shot, and the moving safe-lane sweep can damage the player through temporary hit-invulnerability. Regular enemy hits and other boss projectile patterns still respect it. Shields and encounter-transition protection block all damage. The sweep's safe lane remains safe, and a sweep can damage the player at most once per cast.

**Why:** The user requested these boss-specific exceptions; a sustained beam that damages every frame would drain health immediately, so bound each cast to one hit.

**How to apply:** Keep bypass rules attached to their specific attack sources rather than disabling invulnerability globally. Preserve shields, transition protection, and safe-lane collision checks.
