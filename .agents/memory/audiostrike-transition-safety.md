---
name: AudioStrike transition safety
description: Why game transitions must recover from invalid movement coordinates instead of waiting indefinitely.
---

Do not make timed AudioStrike stage transitions depend solely on a player position threshold. Validate movement inputs and give exit states a bounded time fallback.

**Why:** A real-browser run reached the end of a stage with a non-finite player coordinate. The animation loop and exit timer kept advancing, but the boss never appeared because comparison with that coordinate could never become true; there was no browser exception.

**How to apply:** When changing joystick math, player movement, or stage/boss transitions, check for non-finite values and ensure an invalid position cannot strand the run.