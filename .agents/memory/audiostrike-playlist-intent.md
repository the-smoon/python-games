---
name: AudioStrike playlist intent
description: Drive-library scope and the intended continuous playlist pairing.
---

Use the owner's designated Google Drive music folder, not YouTube downloading or separate local stage/boss selectors. Playlists are a shared library of references, not per-player private data; only the owner adds MP3s.

**Why:** The user requested replacing unreliable YouTube access with Drive music and explicitly excluded general player accounts and private playlists.

**How to apply:** Keep Drive authorization server-side and scope music and playlist operations to the designated folders. Do not expand into player accounts or private playlists without a new request.

Pair the playlist continuously across its boundary, rather than padding or discarding an odd last track. Shuffle once at the start and retain that order for replay.

**Why:** The agreed playlist behavior maps adjacent songs to stage/boss roles and loops; retaining the odd last song avoids losing user-selected music.

**How to apply:** An A/B/C list produces A/B, C/A, B/C, then repeats. A single song supplies both roles.