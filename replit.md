# AudioStrike

A top-down vertical-scrolling shooter where all enemy behaviour — count, speed, health, fire rate, movement patterns, and boss phases — is driven in real time by audio analysis of two songs you choose.

## Run & Operate

### Game
- Start the **AudioStrike Game** workflow in the VNC tab
- You'll be prompted to pick two audio files:
  1. **Stage song** — drives all regular enemy generation
  2. **Boss song** — plays during the entire boss fight
- Controls: Arrow keys / WASD to move · Space to fire · ESC to quit
- After a restart (ENTER on Game Over / Victory screen) the already-analysed songs are reused instantly

### Dev commands
- `cd artifacts/jet-game && python main.py` — run directly from terminal
- `pip install -r artifacts/jet-game/requirements.txt` — install/refresh deps

## Stack

- Python 3.13 + Pygame 2 (game loop, rendering, audio playback)
- librosa (offline audio analysis)
- pnpm workspace for shared JS/TS libs (not used by the game itself)

## Where things live

```
artifacts/jet-game/
├── main.py            — entry point, tkinter file picker
├── game.py            — Game class, state machine, collision, draw
├── entities.py        — Player, Enemy, Boss, Bullet, Particle
├── spawner.py         — beat-synced enemy factory (reads AudioFeatures)
├── audio_analyzer.py  — librosa analysis → AudioFeatures
├── hud.py             — HUD rendering helpers
└── constants.py       — all numeric constants and colours
```

## Architecture decisions

- **Pre-analysis, not real-time** — librosa processes the full audio file before play begins, producing a frame-indexed feature timeline. The game clock reads from this timeline as the song plays via `pygame.mixer.music.get_pos()`. Avoids any real-time DSP complexity.
- **Beat-driven spawning** — enemies are created on beat timestamps, not on a fixed timer. Quiet passages auto-skip beats; sudden transients (onset > 0.88) force a spawn surge.
- **Six audio signals → six game axes** — each feature drives a distinct game dimension (see below).
- **Health-based boss phases** — boss phases (PHASE1/2/3) change with health ratio, not song time. Song energy still shapes boss health pool size.
- **tkinter before pygame** — file dialog runs before pygame display init to avoid X11 conflicts.

## Music → Game Parameter Mapping

| Audio feature | Game parameter |
|---|---|
| Sub-bass energy (20–300 Hz) | Enemy health (1–7 hp) and radius (10–44 px) |
| Overall RMS loudness | Enemy count per beat (1–4) |
| High freq energy (4–20 kHz) | Enemy speed and agility |
| Onset strength (transients) | Dive-bomb and swarm triggers; spawn surges |
| Mid energy (300–4000 Hz) | Enemy fire rate |
| Spectral flatness | Tonal → tight formations; noisy → scatter/swarm |
| Spectral centroid | Enemy movement jitter / zigzag amplitude |
| Song energy arc (mean RMS) | Boss total health pool |
| Beat timestamps | Spawn trigger timing |

## User preferences

_Populate as you build._

## Gotchas

- Pygame must NOT be imported before tkinter runs — `main.py` handles this ordering
- `pygame.mixer.music.get_pos()` returns –1 if music is not playing; `_song_pos()` guards this
- librosa analysis of a 4-minute song takes ~10–20 s; the progress bar shows both songs combined
- The stage-to-boss transition waits for all remaining enemies to die before showing the intro screen

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
