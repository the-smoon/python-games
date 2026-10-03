---
name: AudioStrike playlist intent
description: User permission to adapt the supplied downloader and the intended continuous playlist pairing.
---

Keep all downloading inside the user's supplied stream2mp3.py; modifying it for the game's needs is allowed.

**Why:** The user provided the script and explicitly said, "Please feel free to read, and modify the script as needed for the purpose of the game." They did not request a replacement downloader.

**How to apply:** Extend its game adapter when downloader behavior changes rather than adding a separate downloader to the API.

Pair the playlist continuously across its boundary, rather than padding or discarding an odd last track. Shuffle once at the start and retain that order for replay.

**Why:** The agreed playlist behavior maps adjacent songs to stage/boss roles and loops; retaining the odd last song avoids losing user-selected music.

**How to apply:** An A/B/C list produces A/B, C/A, B/C, then repeats. A single song supplies both roles. Both uploaded files still use the same pairing path.