# Rhythm Fighter Drive library

The server uses the Replit Google Drive connector. Authorization stays on the
server; API responses contain file IDs, titles and sizes, never access tokens.

## Configuration

- `AUDIOSTRIKE_MUSIC_FOLDER_ID`: the designated music folder, configured as a
  non-secret environment variable.
- `AUDIOSTRIKE_OWNER_PASSWORD`: a strong owner-only upload password in Secrets.
- `SESSION_SECRET`: the existing session-signing secret in Secrets.

The server creates or reuses one direct child folder for shared playlists.
Playlist JSON files contain `{version: 1, trackIds: [...]}` only.
Songs must be direct children of the music folder; shortcuts and files outside
these folders are not followed. Existing MP3s can be added by the owner in Drive,
or through the protected uploader. Use Refresh to see changes.

All players may list, load and save playlists. Saving creates a new file and
rejects case-insensitive duplicate names instead of updating an existing file.
Playback requires 1–20 distinct tracks. Limits remain 24 MB and 12 minutes per
MP3, 192 MB per playlist. Files are parsed server-side before transfer or upload.

Only an owner session can upload. The server verifies an HttpOnly, SameSite
cookie signed with `SESSION_SECRET`; rotating either secret invalidates old
sessions. Production cookies are Secure. Cross-origin mutations are rejected.
Do not share the owner password or expose it in client code.

Requests have size, pagination, timeout, concurrency and rate caps: 120 requests,
40 audio transfers, 10 writes and 5 sign-in attempts per IP per minute; at most
4 concurrent requests and 60 writes per server per hour. Limits are deliberately
conservative when the proxy aggregates clients behind one IP. Forwarded IP
headers are not trusted. Drive calls have a 60-second timeout and an operation
has a 120-second deadline. Upload bodies have a 60-second receive timeout.
These in-memory caps are per server instance, not a distributed quota.

Tests: `pnpm --filter @workspace/api-server test` and
`pnpm --filter @workspace/audiostrike test`. Browser regressions use the playlist
picker with synthetic audio fixtures; the live verification test additionally
uses the connected Drive account and cleans up only files it creates.