export const PLAYBACK_CLIP_SECONDS = 30;

export type PlaybackWindow = Readonly<{ startSeconds: number; endSeconds: number }>;

const windows = new WeakMap<HTMLAudioElement, PlaybackWindow>();
const listeners = new WeakSet<HTMLAudioElement>();
const finished = new WeakSet<HTMLAudioElement>();

export function createPlaybackWindow(
  duration: number,
  enabled: boolean,
  isFirstTrack: boolean,
  random: () => number = Math.random,
): PlaybackWindow | null {
  if (!enabled) return null;
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Track duration must be positive to choose a playback clip');
  const clipLength = Math.min(PLAYBACK_CLIP_SECONDS, duration);
  const latestStart = duration - clipLength;
  const rawSample = isFirstTrack ? 0 : random();
  const sample = Math.max(0, Math.min(1, Number.isFinite(rawSample) ? rawSample : 0));
  const startSeconds = isFirstTrack ? 0 : sample * latestStart;
  return { startSeconds, endSeconds: startSeconds + clipLength };
}

export function setPlaybackWindow(audio: HTMLAudioElement, window: PlaybackWindow | null) {
  finished.delete(audio);
  if (window) windows.set(audio, window);
  else windows.delete(audio);
  // Clipped tracks are one-shot segments. Full tracks keep their existing loop.
  audio.loop = window === null;
  if (!listeners.has(audio)) {
    audio.addEventListener('timeupdate', () => stopPlaybackWindowAtEnd(audio));
    listeners.add(audio);
  }
  if (audio.readyState > 0) {
    seekToPlaybackStart(audio);
  } else if (window) {
    audio.addEventListener('loadedmetadata', () => {
      if (windows.get(audio) === window) seekToPlaybackStart(audio);
    }, { once: true });
  }
}

export function playbackWindowFor(audio: HTMLAudioElement): PlaybackWindow | null {
  return windows.get(audio) ?? null;
}

export function seekToPlaybackStart(audio: HTMLAudioElement) {
  finished.delete(audio);
  const window = windows.get(audio);
  if (audio.readyState > 0) audio.currentTime = window?.startSeconds ?? 0;
}

export function stopPlaybackWindowAtEnd(audio: HTMLAudioElement): boolean {
  const window = windows.get(audio);
  if (!window || finished.has(audio) || audio.currentTime < window.endSeconds - 0.04) return false;
  finished.add(audio);
  audio.pause();
  audio.currentTime = window.endSeconds;
  return true;
}

export function playbackTimeForElapsed(elapsedSeconds: number, duration: number, window: PlaybackWindow | null) {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) return window?.startSeconds ?? 0;
  if (window) {
    return Math.min(window.startSeconds + elapsedSeconds, window.endSeconds);
  }
  return Number.isFinite(duration) && duration > 0 ? elapsedSeconds % duration : 0;
}
