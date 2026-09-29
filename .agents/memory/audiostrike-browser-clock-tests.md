---
name: AudioStrike browser clock tests
description: Reliable timing of browser-level game-loop tests across timed phase transitions.
---

Advance timed gameplay with the browser test runner's clock rather than overriding `performance.now` independently of animation-frame timestamps.

**Why:** A shifted `performance.now` can disagree with the timestamp passed to `requestAnimationFrame` when React restarts its game-loop effect. That mismatch creates a large negative frame delta and can strand the boss intro indefinitely even though normal gameplay is fine.

**How to apply:** When testing timed phase changes, fast-forward the browser's coordinated clock so animation callbacks and performance time share the same timeline. Keep browser-level tests separate from fast unit tests because they need a running preview and Chromium.