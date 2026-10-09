---
name: Durable numerical song analyses
description: Why AudioStrike reuses versioned content-addressed analysis documents without storing audio bytes in its database.
---

Reuse successfully decoded numerical song analyses across sessions, keyed by audio content and analyzer version. Do not persist fabricated fallback analyses or raw song bytes in the analysis database.

**Why:** The user requested durable documents that can be queried quickly before new songs/levels; redecoding every session would defeat that requirement. Drive remains the audio source.

**How to apply:** Prefetch numerical analyses while preparing the selected playlist, then build the song's visual blueprint from the in-memory document at its boundary without waiting on a new network request. Analyzer changes need a new version, not silent replacement of immutable older results.

If the cache is unavailable, explicitly warn the player and use a fresh analysis for that run rather than claiming persistence succeeded.

**Why:** Cached data is an optimization, not a reason to prevent playable audio, but silent cache failures hide a broken durable-analysis feature.

**How to apply:** Keep request deadlines, validation, and read/write quotas around public cache access, and keep its failure messages separate from successful playback.

Keep actual media `playbackDuration` separate from the analysis/gameplay `duration` and `analyzedSeconds`. Choose playback windows from `playbackDuration`; keep the analysis document intact when selecting a clip.

**Why:** `analyzedSeconds` is the amount of audio sampled, while the existing gameplay duration has an 18-second floor for encounter balance. Neither is a safe clip boundary for a shorter file.

**How to apply:** Carry the actual playback duration with each prepared track and choose non-first clip bounds from it before the countdown; keep the first track anchored at zero. If cached document semantics change, bump its version so old documents cannot supply invalid clip metadata.

Browser cache-reuse tests should verify that analysis is reused without another write, not require a fixed number of server reads; local browser storage can satisfy some entries while the shared API serves others.

**Why:** A reload may mix browser-local and server-side cache hits, so exact network-read counts can fail even when durable reuse works.

**How to apply:** Assert successful cached results and no unnecessary resaves; only assert a specific request count when the test clears both cache layers first.