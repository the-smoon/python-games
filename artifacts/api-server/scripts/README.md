# AudioStrike downloader

`stream2mp3.py` is the user's supplied downloader, with an added `--game-manifest`
mode. Its original command-line modes are retained. No other downloader is used.

Game mode accepts one public HTTPS YouTube Music or YouTube playlist URL and
`-o <temporary directory>`. It prints newline-delimited JSON progress
(`message`, `completed`, `total`), exits nonzero on preparation failure, and writes
`manifest.json` with `version: 1`, ordered `tracks` (`file`, `title`), and `skipped`.
Unavailable entries are omitted without changing the surviving tracks' order.
Numbered MP3 filenames keep duplicate song titles distinct.

Runtime requires Python 3.13+, yt-dlp (tracked in root pyproject.toml/uv.lock),
ffmpeg (root Nix configuration), and the available Node runtime for YouTube
extraction. The post-merge script restores yt-dlp. Python dependency errors are
reported to the player; credentials and cookies are not supported.

Limits: 20 playlist entries, 12 minutes per track, 24 MB per downloaded or converted
file, 192 MB total temporary output, 10-minute process deadline, 128 KB process
output, two active downloads, four retained jobs. Invalid URLs do not consume the
three-downloads-per-IP-per-30-minutes quota; all playlist requests share a
120-per-minute limit. The server does not trust arbitrary forwarded IP headers.
In a proxy setup, requests may therefore share a conservative quota.

Only UUID job IDs and track indexes cross the API boundary. The API never accepts
filesystem paths. Job IDs act as unguessable temporary capability tokens.
Downloads run without a shell in a separate process group; cancellation and
timeouts kill that group, including ffmpeg descendants.

Temporary files are deleted after transfer to the browser, on cancellation/error,
at 15-minute expiry, and on graceful server shutdown. A game session retains its
Files/object URLs in browser memory, not in a saved library. Reloading loses the
playlist. The job store and temporary directory are local to one server instance;
multiple-instance deployments need coordinated job ownership/storage before use.