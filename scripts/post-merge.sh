#!/bin/bash
set -e
pnpm install --frozen-lockfile
uv pip install --python "$(command -v python)" "yt-dlp==2026.8.19"
pnpm --filter db push
