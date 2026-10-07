export const PLAYBACK_CLIP_SECONDS = 30;

export type PlaybackWindow = Readonly<{ startSeconds: number; endSeconds: number }>;

const windows = new WeakMap<HTMLAudioElement, PlaybackWindow>();
const listeners = new WeakSet<HTMLAudioElement>();

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
  if (window) windows.set(audio, window);
  else windows.delete(audio);
  if (!listeners.has(audio)) {
    audio.addEventListener('timeupdate', () => wrapPlaybackWindow(audio));
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
  const window = windows.get(audio);
  if (audio.readyState > 0) audio.currentTime = window?.startSeconds ?? 0;
}

export function wrapPlaybackWindow(audio: HTMLAudioElement): boolean {
  const window = windows.get(audio);
  if (!window || audio.currentTime < window.endSeconds - 0.04) return false;
  audio.currentTime = window.startSeconds;
  return true;
}

export function playbackTimeForElapsed(elapsedSeconds: number, duration: number, window: PlaybackWindow | null) {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) return window?.startSeconds ?? 0;
  if (window) {
    const clipLength = window.endSeconds - window.startSeconds;
    if (clipLength <= 0) return window.startSeconds;
    return window.startSeconds + elapsedSeconds % clipLength;
  }
  return Number.isFinite(duration) && duration > 0 ? elapsedSeconds % duration : 0;
}
