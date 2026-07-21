"""
AudioStrike — music analysis module.

Loads an audio file with librosa and produces a time-indexed feature
timeline that the Spawner reads to drive enemy generation.
"""

import numpy as np
import librosa

HOP = 512
SR  = 22_050


# ─────────────────────────────────────────────────────────────────────────────
class AudioFeatures:
    """
    Per-frame audio features for one song.

    All per-frame arrays are normalised to [0, 1] and share the same
    length as `frame_times`.
    """

    def __init__(self, duration, tempo, beat_times, frame_times,
                 rms, centroid, flatness, onset,
                 low_energy, mid_energy, high_energy):
        self.duration    = float(duration)
        self.tempo       = float(np.atleast_1d(tempo)[0])
        self.beat_times  = np.asarray(beat_times, dtype=float)   # (n_beats,)
        self.frame_times = np.asarray(frame_times, dtype=float)  # (n_frames,)

        self.rms      = rms
        self.centroid = centroid
        self.flatness = flatness
        self.onset    = onset
        self.low      = low_energy
        self.mid      = mid_energy
        self.high     = high_energy

    # ------------------------------------------------------------------
    def at(self, t: float) -> dict:
        """Return all features at time *t* (seconds)."""
        idx = int(np.searchsorted(self.frame_times, t))
        idx = max(0, min(idx, len(self.frame_times) - 1))
        return {
            "rms":      float(self.rms[idx]),
            "centroid": float(self.centroid[idx]),
            "flatness": float(self.flatness[idx]),
            "onset":    float(self.onset[idx]),
            "low":      float(self.low[idx]),
            "mid":      float(self.mid[idx]),
            "high":     float(self.high[idx]),
        }

    def next_beat_after(self, t: float):
        """Return the timestamp of the next beat after *t*, or None."""
        idx = int(np.searchsorted(self.beat_times, t, side="right"))
        return float(self.beat_times[idx]) if idx < len(self.beat_times) else None


# ─────────────────────────────────────────────────────────────────────────────
def _norm(arr: np.ndarray) -> np.ndarray:
    mn, mx = arr.min(), arr.max()
    if mx == mn:
        return np.zeros_like(arr, dtype=float)
    return ((arr - mn) / (mx - mn)).astype(float)


def analyze(filepath: str, progress_cb=None) -> AudioFeatures:
    """
    Analyse an audio file and return an AudioFeatures object.

    *progress_cb* is an optional callable(float 0‥1) for progress reporting.
    """
    def _prog(p: float):
        if progress_cb:
            progress_cb(float(p))

    _prog(0.05)

    # ── Load ──────────────────────────────────────────────────────────────────
    y, sr = librosa.load(filepath, sr=SR, mono=True)
    duration = librosa.get_duration(y=y, sr=sr)
    _prog(0.15)

    # ── Beats ─────────────────────────────────────────────────────────────────
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, hop_length=HOP)
    beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=HOP)
    _prog(0.28)

    # ── RMS / spectral features ───────────────────────────────────────────────
    rms_raw      = librosa.feature.rms(y=y, hop_length=HOP)[0]
    centroid_raw = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=HOP)[0]
    flatness_raw = librosa.feature.spectral_flatness(y=y, hop_length=HOP)[0]
    _prog(0.46)

    onset_raw = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP)
    _prog(0.58)

    # ── Frequency band energy (STFT magnitude) ────────────────────────────────
    D     = np.abs(librosa.stft(y, hop_length=HOP))
    freqs = librosa.fft_frequencies(sr=sr)

    low_mask  = (freqs >=   20) & (freqs <=  300)
    mid_mask  = (freqs >   300) & (freqs <= 4000)
    high_mask = (freqs >  4000) & (freqs <= 20_000)

    def _band(mask):
        return D[mask, :].mean(axis=0) if mask.any() else np.zeros(D.shape[1])

    low_raw  = _band(low_mask)
    mid_raw  = _band(mid_mask)
    high_raw = _band(high_mask)
    _prog(0.78)

    # ── Align all feature arrays to the shortest ──────────────────────────────
    n = min(len(rms_raw), len(centroid_raw), len(flatness_raw),
            len(onset_raw), len(low_raw), len(mid_raw), len(high_raw))

    frame_times = librosa.frames_to_time(np.arange(n), sr=sr, hop_length=HOP)
    _prog(0.92)

    result = AudioFeatures(
        duration    = duration,
        tempo       = tempo,
        beat_times  = beat_times,
        frame_times = frame_times,
        rms         = _norm(rms_raw[:n]),
        centroid    = _norm(centroid_raw[:n]),
        flatness    = _norm(flatness_raw[:n]),
        onset       = _norm(onset_raw[:n]),
        low_energy  = _norm(low_raw[:n]),
        mid_energy  = _norm(mid_raw[:n]),
        high_energy = _norm(high_raw[:n]),
    )
    _prog(1.0)
    return result
