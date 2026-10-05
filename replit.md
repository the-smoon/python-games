# Rhythm Fighter

The browser game is the `@workspace/rhythm-fighter` web artifact, served at the
root preview path. The previous `@workspace/audiostrike` artifact remains on
`/audiostrike-legacy/` during the identity transition; do not remove or replace
it as part of unrelated work.

## Music library and owner access

The API server reads the existing `AUDIOSTRIKE_MUSIC_FOLDER_ID`,
`AUDIOSTRIKE_OWNER_PASSWORD`, and `SESSION_SECRET` settings. Keep these names
and their current values. Shared playlists live in the existing `AudioStrike
Playlists` child folder in Google Drive, and owner sessions keep the
`audiostrike_owner` cookie name. Renaming these compatibility identifiers
would disconnect saved data or existing sign-in configuration.

## Checks

- `pnpm --filter @workspace/rhythm-fighter test`
- `pnpm --filter @workspace/api-server test`
- `pnpm --filter @workspace/rhythm-fighter test:browser` (with the managed
  Rhythm Fighter workflow running)

The current published version is not replaced as part of workspace preview
verification. Publish only through the normal, explicitly approved release
flow.
