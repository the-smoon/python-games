---
name: Playlist source availability
description: Why playlist discovery and successful workspace downloads do not prove that every track works on the published server.
---

Treat public playlist visibility, individual video availability, and the affected runtime's ability to download media as separate checks. Do not infer published-server access from a successful workspace run.

**Why:** A reported public playlist passed discovery and duration checks but contained an unavailable video. The workspace prepared the remaining tracks successfully, while the earlier published request had failed without retaining enough diagnostic information to identify its exact cause.

**How to apply:** Diagnose the actual media preparation and transfer path, not only flat playlist metadata. Use safe failure categories from the affected runtime, and distinguish known unavailable videos from server-wide access blocks or conversion failures.