---
name: Bazzite Chrome Flatpak controller detection
description: Confirmed OS-side cause of missing physical controller input in AudioStrike.
---

When a controller is absent from Chrome's own gamepad diagnostics on Bazzite, check the Chrome Flatpak sandbox before changing AudioStrike. The user confirmed that a per-user, read-only `/run/udev` filesystem override for `com.google.Chrome`, followed by a full Chrome restart, restored detection both in Chrome's gamepad diagnostics and in AudioStrike.

**Why:** The published game was secure and allowed the Gamepad API, but Chrome itself could not enumerate the device until the Flatpak permission changed. Browser tests with simulated pads cannot diagnose host device access.

**How to apply:** First distinguish browser enumeration from app detection using `chrome://gamepad-internals/`. For a Chrome Flatpak that cannot enumerate a controller, explain the read-only host device-metadata permission and ask the user to apply `flatpak override --user --filesystem=/run/udev:ro com.google.Chrome` locally, fully restart Chrome, and retest browser detection. Do not claim AudioStrike itself works until the user confirms it.