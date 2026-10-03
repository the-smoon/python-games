import { newestLivingBoss } from './gameRules.ts';
import type { ActiveBoss, AudioReactiveTrack, LiveFeatures } from './gameRuntimeTypes';

export const blankLiveFeatures = (): LiveFeatures => ({
  rms: 0, onset: 0, low: 0, mid: 0, high: 0, centroid: 0, flatness: 0, pulse: false, tempo: 0,
});

export function createReactiveTrack(context: AudioContext, element: HTMLAudioElement): AudioReactiveTrack {
  const source = context.createMediaElementSource(element);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = .58;
  source.connect(analyser);
  analyser.connect(context.destination);
  return {
    element,
    analyser,
    source,
    frequencies: new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount)),
    waveform: new Uint8Array(new ArrayBuffer(analyser.fftSize)),
    previousSpectrum: new Float32Array(new ArrayBuffer(analyser.frequencyBinCount * Float32Array.BYTES_PER_ELEMENT)),
    energyBaseline: .02,
    lastTime: -1,
    lastPulseAt: -10,
    lastFeatures: blankLiveFeatures(),
    signature: blankLiveFeatures(),
  };
}

export function resetReactiveTrack(track: AudioReactiveTrack | null) {
  if (!track) return;
  track.previousSpectrum.fill(0);
  track.energyBaseline = .02;
  track.lastTime = -1;
  track.lastPulseAt = -10;
  track.lastFeatures = blankLiveFeatures();
  track.signature = blankLiveFeatures();
}

export function readReactiveTrack(track: AudioReactiveTrack | null): LiveFeatures {
  if (!track) return blankLiveFeatures();
  track.analyser.getByteFrequencyData(track.frequencies);
  track.analyser.getByteTimeDomainData(track.waveform);
  const sampleRate = track.analyser.context.sampleRate;
  const binWidth = sampleRate / track.analyser.fftSize;
  const band = (minHz: number, maxHz: number) => {
    const first = Math.max(0, Math.min(track.frequencies.length - 1, Math.floor(minHz / binWidth)));
    const last = Math.max(first + 1, Math.min(track.frequencies.length, Math.ceil(maxHz / binWidth)));
    let total = 0;
    for (let index = first; index < last; index += 1) total += track.frequencies[index] / 255;
    return total / Math.max(1, last - first);
  };
  let waveformEnergy = 0;
  for (const sample of track.waveform) {
    const centered = (sample - 128) / 128;
    waveformEnergy += centered * centered;
  }
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const rms = clamp(Math.sqrt(waveformEnergy / track.waveform.length) * 2.2, 0, 1);
  const low = clamp(band(35, 180) * 1.35, 0, 1);
  const mid = clamp(band(180, 2200) * 1.55, 0, 1);
  const high = clamp(band(2200, Math.min(10000, sampleRate / 2)) * 1.9, 0, 1);
  let flux = 0;
  let weightedFrequency = 0;
  let totalMagnitude = 0;
  let logMagnitude = 0;
  let magnitudeTotal = 0;
  for (let index = 1; index < track.frequencies.length; index += 1) {
    const magnitude = track.frequencies[index] / 255;
    flux += Math.max(0, magnitude - track.previousSpectrum[index]);
    const frequency = index * binWidth;
    weightedFrequency += frequency * magnitude;
    totalMagnitude += magnitude;
    if (magnitude > .001) {
      logMagnitude += Math.log(magnitude);
      magnitudeTotal += 1;
    }
    track.previousSpectrum[index] = magnitude;
  }
  const centroid = clamp(totalMagnitude ? weightedFrequency / totalMagnitude / (sampleRate / 2) : 0, 0, 1);
  const flatness = clamp(magnitudeTotal ? Math.exp(logMagnitude / magnitudeTotal) /
    Math.max(.001, totalMagnitude / Math.max(1, track.frequencies.length - 1)) : 0, 0, 1);
  const normalizedFlux = clamp(flux / Math.max(1, track.frequencies.length - 1) * 8, 0, 1);
  const onset = clamp((normalizedFlux - track.energyBaseline) * 7 + normalizedFlux * .28, 0, 1);
  track.energyBaseline = track.energyBaseline * .94 + normalizedFlux * .06;
  const now = track.element.currentTime;
  if (now < track.lastTime) track.lastPulseAt = -10;
  const pulse = track.lastTime >= 0 && onset > .38 && now - track.lastPulseAt > .2;
  let tempo = track.lastFeatures.tempo * .995;
  if (pulse && track.lastPulseAt >= 0) {
    const interval = now - track.lastPulseAt;
    if (interval >= .2 && interval <= 2) tempo = tempo * .68 + clamp(60 / interval, 0, 180) * .32;
  }
  if (pulse) track.lastPulseAt = now;
  track.lastTime = now;
  track.lastFeatures = { rms, onset, low, mid, high, centroid, flatness, pulse, tempo };
  for (const key of ['rms', 'onset', 'low', 'mid', 'high', 'centroid', 'flatness', 'tempo'] as const) {
    track.signature[key] = track.signature[key] * .985 + track.lastFeatures[key] * .015;
  }
  track.signature.pulse = pulse;
  return track.lastFeatures;
}

export function releaseBossAudio(boss: Pick<ActiveBoss, 'audio' | 'reactive'>) {
  boss.audio?.pause();
  boss.reactive?.source.disconnect();
  boss.reactive?.analyser.disconnect();
  if (boss.audio) {
    boss.audio.removeAttribute('src');
    boss.audio.load();
  }
}

export class SoundtrackLifecycle {
  private current: HTMLAudioElement | null = null;
  get audible() { return this.current; }

  pauseForUser(stageAudio: HTMLAudioElement | null, bossAudio: HTMLAudioElement | null, bosses: readonly ActiveBoss[]) {
    const tracks = [...new Set([stageAudio, bossAudio, ...bosses.map((boss) => boss.audio)])]
      .filter((audio): audio is HTMLAudioElement => Boolean(audio && !audio.paused));
    tracks.forEach((audio) => audio.pause());
    return tracks;
  }

  resumeAfterUserPause(
    tracks: readonly HTMLAudioElement[],
    stageAudio: HTMLAudioElement | null,
    playTrack: (audio: HTMLAudioElement, name: string) => void,
  ) {
    tracks.forEach((audio) => playTrack(audio, audio === stageAudio ? 'Stage track' : 'Boss track'));
  }

  select(
    bosses: readonly ActiveBoss[],
    stageAudio: HTMLAudioElement | null,
    currentBossAudio: HTMLAudioElement | null,
    stageReactive: AudioReactiveTrack | null,
    playTrack: (audio: HTMLAudioElement, name: string) => void,
  ) {
    const owner = newestLivingBoss([...bosses]);
    const selected = owner?.audio ?? stageAudio;
    const tracks = new Set([stageAudio, currentBossAudio, ...bosses.map((boss) => boss.audio)]);
    for (const track of tracks) if (track && track !== selected) track.pause();
    if (selected) {
      selected.volume = .72;
      if (this.current !== selected) playTrack(selected, owner ? 'Boss track' : 'Stage track');
    }
    this.current = selected;
    return owner?.reactive ?? stageReactive;
  }

  clear() {
    this.current = null;
  }
}