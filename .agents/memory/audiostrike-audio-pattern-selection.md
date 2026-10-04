---
name: Audio-driven encounter design
description: How pre-match song motifs and live audio share control of encounter appearance and behavior.
---

Analyze the whole selected track before the match and use its section motifs for enemy/boss silhouettes and baseline movement identity. Prepare a distinct per-song roster and palette before spawning; entities retain their geometric silhouette, palette, and projectile appearance after spawning. During play, keep live audio active for spawn timing and size, attack patterns and cadence, secondary-attack selection, combat intensity, and beat-triggered movement changes.

All living enemies and bosses, including survivors from earlier songs, must respond to the currently audible soundtrack. Their origin song defines their visual identity, not a private movement/firing soundtrack.

Use deterministic variation only to break near-ties, not to rotate through a fixed list regardless of the audio.

**Why:** The user requested distinct designs prepared before each song boundary, and explicitly required survivors' movement and attacks to follow the currently playing music. Rotating patterns by an entity serial also made distinct songs produce nearly the same mix of behaviors.

**How to apply:** When adjusting encounter profiles, keep the full-track map as the design baseline and compare contrasting bass-heavy and bright songs. Keep live responses distinct, and keep deterministic variation smaller than meaningful audio differences.