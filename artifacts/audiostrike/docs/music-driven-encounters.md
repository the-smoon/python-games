# Music-driven encounter design

Before a run, AudioStrike decodes each selected track locally and samples across its full duration. An aggregate fingerprint gives the stage and boss their baseline visual and movement identities; eight section motifs provide additional shapes and movement preferences for regular enemies, sub-bosses, and boss phases.

During play, the reactive analyser remains active. Live features continue to select wave timing and size, attack patterns, projectile types, combat intensity, and beat-triggered movement changes. A live pulse can adjust an entity's movement, but its pre-match song profile and geometric identity continue to bias the result.

The pre-match scan is capped at 400 evenly spaced FFT frames per track and never uploads audio. If a browser cannot decode a selected file for analysis, AudioStrike falls back to a neutral structural profile and reports the limitation; playable tracks can still use live analysis.