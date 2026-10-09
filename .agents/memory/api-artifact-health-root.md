---
name: API artifact health root
description: Distinguish the API artifact's base-path health probe from real Drive and application routes.
---

The API artifact's `/api` base path may be probed directly, separately from `/api/healthz`; both should return a minimal healthy response.

**Why:** The published service logged a failing `/api` health check while `/api/healthz`, the music library, saved playlists, and Drive audio requests were healthy.

**How to apply:** For a reported published 404, check `/api`, `/api/healthz`, and the specific data route independently before attributing the error to Drive.
