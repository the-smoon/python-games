---
name: AudioStrike browser clock tests
description: Reliable timing of browser-level game-loop tests across timed phase transitions.
---

Advance timed gameplay with the browser test runner's clock rather than overriding `performance.now` independently of animation-frame timestamps.

**Why:** A shifted `performance.now` can disagree with the timestamp passed to `requestAnimationFrame` when React restarts its game-loop effect. That mismatch creates a large negative frame delta and can strand the boss intro indefinitely even though normal gameplay is fine.

**How to apply:** When testing timed phase changes, fast-forward the browser's coordinated clock so animation callbacks and performance time share the same timeline. Keep browser-level tests separate from fast unit tests because they need a running preview and Chromium.

Treat any fast-forward that crosses the stage boundary as coupled to the actual stage length. **Why:** A shorter skip can make a controller test appear to fail in the boss phase even when its controller behavior already passed in the stage. **How to apply:** When stage timing changes, adjust browser-test phase transitions as part of the same work.