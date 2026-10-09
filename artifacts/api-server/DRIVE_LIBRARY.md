# Rhythm Fighter Drive library

The server uses the Replit Google Drive connector. Authorization stays on the
server; API responses contain file IDs, titles and sizes, never access tokens.

## Configuration

- `AUDIOSTRIKE_MUSIC_FOLDER_ID`: the designated music folder, configured as a
  non-secret environment variable.
- `AUDIOSTRIKE_GOOGLE_CLIENT_ID`: the app's Google OAuth client ID, in Secrets.
- `AUDIOSTRIKE_GOOGLE_CLIENT_SECRET`: the app's Google OAuth client secret, in
  Secrets.
- `SESSION_SECRET`: the existing session-signing secret in Secrets.

Configure the Google OAuth client as a Web application. Add this exact authorized
redirect URI for every Replit host serving the app:
`https://<host>/api/playlists/owner/google/callback`. The server derives trusted
hosts from `REPLIT_DEV_DOMAIN` and `REPLIT_DOMAINS`; it does not trust an arbitrary
request Host header. Use the same Google client for the root and legacy previews.
The sign-in flow requests only the OpenID Connect `openid email` scopes.

The server creates or reuses one direct child folder for shared playlists.
Playlist JSON files contain `{version: 1, trackIds: [...]}` only.
Songs must be direct children of the music folder; shortcuts and files outside
these folders are not followed. Existing MP3s can be added by the owner in Drive,
or through the protected uploader. Use Refresh to see changes.

All players may list, load and save playlists. Saving creates a new file and
rejects case-insensitive duplicate names instead of updating an existing file.
Playback requires 1–20 distinct tracks. Limits remain 24 MB and 12 minutes per
MP3, 192 MB per playlist. Files are parsed server-side before transfer or upload.

Only the Google account `danielsampson40@gmail.com`, with Google's `email_verified`
claim set to true, can receive an upload session. The server validates Google's
signed ID token, audience, issuer, expiry, nonce, and verified email. The OAuth
callback is protected by a signed, short-lived one-time state cookie and PKCE.
Owner sessions are time-limited, server-validated, HttpOnly, and SameSite=Strict;
production cookies are Secure. Rotating `SESSION_SECRET` invalidates sessions.
Cross-origin mutations are rejected. OAuth credentials are used only by the
server and are never included in app JavaScript or responses.

The `audiostrike_owner` cookie remains the owner-session cookie. The
`audiostrike_google_state` cookie is short-lived and SameSite=Lax so Google can
return through the top-level OAuth callback. Sign out clears the owner cookie.
The old `AUDIOSTRIKE_OWNER_PASSWORD` secret is no longer used for sign-in; keep
it in Secrets until an owner has verified Google sign-in and upload end to end.

Requests have size, pagination, timeout, concurrency and rate caps: 120 requests,
40 audio transfers, 10 writes and 5 sign-in attempts per IP per minute; at most
4 concurrent requests and 60 writes per server per hour. Limits are deliberately
conservative when the proxy aggregates clients behind one IP. Forwarded IP
headers are not trusted. Drive calls have a 60-second timeout and an operation
has a 120-second deadline. Upload bodies have a 60-second receive timeout.
These in-memory caps are per server instance, not a distributed quota.

Tests: `pnpm --filter @workspace/api-server test`,
`pnpm --filter @workspace/rhythm-fighter test`, and
`pnpm --filter @workspace/rhythm-fighter test:browser`. The legacy preview owner
panel check is `pnpm --filter @workspace/audiostrike test:browser`. Browser
regressions use synthetic audio fixtures; the opt-in live Drive check saves and
loads a temporary shared playlist, rejects anonymous uploads, and cleans up only
files it creates. Server tests exercise the Google callback with signed test ID
tokens and verify the owner upload path without using real Google credentials.

Keep the existing `AUDIOSTRIKE_MUSIC_FOLDER_ID`, `SESSION_SECRET`, the
`audiostrike_owner` session cookie, and the `AudioStrike Playlists` Drive folder.
They preserve existing library data and session compatibility; do not create
replacement folders or move Drive files. The old password secret can be removed
only after the Google sign-in and upload flow has been verified.