# Rhythm Fighter

The browser game is the `@workspace/rhythm-fighter` web artifact, served at the
root preview path. The previous `@workspace/audiostrike` artifact remains on
`/audiostrike-legacy/` during the identity transition; do not remove or replace
it as part of unrelated work.

## Music library and owner access

The API server reads the existing `AUDIOSTRIKE_MUSIC_FOLDER_ID` and
`SESSION_SECRET` settings. Owner uploads use Google OAuth configured with
`AUDIOSTRIKE_GOOGLE_CLIENT_ID` and `AUDIOSTRIKE_GOOGLE_CLIENT_SECRET` in Secrets;
only the verified account `danielsampson40@gmail.com` can upload. Register
`https://<Replit host>/api/playlists/owner/google/callback` as an authorized
redirect URI for each trusted Replit host. Shared playlists stay anonymous and
live in the existing `AudioStrike Playlists` child folder in Google Drive.
Owner sessions keep the `audiostrike_owner` cookie name. The old
`AUDIOSTRIKE_OWNER_PASSWORD` secret is not used for sign-in; do not remove it
until the Google owner sign-in and upload flow is verified.

## Checks

- `pnpm --filter @workspace/rhythm-fighter test`
- `pnpm --filter @workspace/api-server test`
- `pnpm --filter @workspace/rhythm-fighter test:browser` (with the managed
  Rhythm Fighter workflow running)

The current published version is not replaced as part of workspace preview
verification. Publish only through the normal, explicitly approved release
flow.
