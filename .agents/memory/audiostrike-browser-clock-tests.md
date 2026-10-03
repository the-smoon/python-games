---
name: AudioStrike browser clock tests
description: Reliable timing of browser-level game-loop tests across timed phase transitions.
---

Advance timed gameplay with the browser test runner's clock rather than overriding `performance.now` independently of animation-frame timestamps.

**Why:** A shifted `performance.now` can disagree with the timestamp passed to `requestAnimationFrame` when React restarts its game-loop effect. That mismatch creates a large negative frame delta and can strand the boss intro indefinitely even though normal gameplay is fine.

**How to apply:** When testing timed phase changes, fast-forward the browser's coordinated clock so animation callbacks and performance time share the same timeline. Keep browser-level tests separate from fast unit tests because they need a running preview and Chromium.

Treat any fast-forward that crosses the stage boundary as coupled to the actual stage length. **Why:** A shorter skip can make a controller test appear to fail in the boss phase even when its controller behavior already passed in the stage. **How to apply:** When stage timing changes, adjust browser-test phase transitions as part of the same work.

Use monotonic encounter elapsed time for stage cutoffs, not the audio element's playback position. **Why:** Tracks deliberately loop independently of the encounter, so `currentTime` resets on each loop and would extend or strand a short-track stage. **How to apply:** Keep the audio playback position only for analysis and seeking; time stage transitions against the browser clock and fast-forward it as a unit in regressions.

Pause timing regressions should include temporary weapon effects, uncollected pickups, and soundtrack ownership during boss arrivals, not just the stage countdown.

**Why:** Freezing movement and compensating only the stage timer can appear correct while combat deadlines expire or an active soundtrack keeps playing. Pauses must preserve remaining durations across the whole run.

**How to apply:** Advance the coordinated browser clock beyond the duration of the effects while paused, compare combat and playback snapshots, then confirm the effects remain active and only the previously playing tracks resume.