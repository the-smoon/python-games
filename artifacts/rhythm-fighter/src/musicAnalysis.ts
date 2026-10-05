export type AudioFingerprint = {
  rms: number;
  onset: number;
  low: number;
  mid: number;
  high: number;
  centroid: number;
  flatness: number;
  pulse: boolean;
  tempo: number;
};

export type MusicAnalysis = {
  signature: AudioFingerprint;
  motifs: AudioFingerprint[];
  analyzedSeconds: number;
};

const clamp = (value: number, min = 0, max = 1) =>
  Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function summarize(frames: AudioFingerprint[]): AudioFingerprint {
  if (!frames.length) return { rms: .04, onset: 0, low: .1, mid: .1, high: .1,
    centroid: .35, flatness: .2, pulse: false, tempo: 90 };
  const mean = (key: Exclude<keyof AudioFingerprint, 'pulse' | 'tempo'>) =>
    frames.reduce((sum, frame) => sum + frame[key], 0) / frames.length;
  const pulseFrames = frames.map((frame, index) => ({ index, energy: frame.onset }))
    .filter((frame, index, all) => frame.energy > .2 && frame.energy >= (all[index - 1]?.energy ?? 0) &&
      frame.energy >= (all[index + 1]?.energy ?? 0));
  const pulseIndices: number[] = [];
  for (const frame of pulseFrames) {
    if (pulseIndices.length === 0 || frame.index - pulseIndices[pulseIndices.length - 1] >= 1) {
      pulseIndices.push(frame.index);
    } else if (frame.energy > frames[pulseIndices[pulseIndices.length - 1]].onset) {
      pulseIndices[pulseIndices.length - 1] = frame.index;
    }
  }
  const intervals = pulseIndices.slice(1).map((index, i) => (index - pulseIndices[i]) * .5);
  const secondsPerBeat = median(intervals.filter((seconds) => seconds >= .25 && seconds <= 1.5));
  const tempo = secondsPerBeat ? Math.round(60 / secondsPerBeat) : 0;
  return {
    rms: mean('rms'), onset: mean('onset'), low: mean('low'), mid: mean('mid'), high: mean('high'),
    centroid: mean('centroid'), flatness: mean('flatness'),
    pulse: intervals.length >= 2 && tempo > 0, tempo,
  };
}

/** Analyze a decoded song before play and keep eight coarse sections for encounter design. */
export function analyzeMusic(channels: readonly Float32Array[], sampleRate: number): MusicAnalysis {
  if (!channels.length || !channels[0]?.length || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error('Decoded song has no usable audio samples');
  }
  const sampleCount = Math.min(...channels.map((channel) => channel.length));
  const decimation = Math.max(1, Math.round(sampleRate / 22050));
  const effectiveRate = sampleRate / decimation;
  const fftSize = 512;
  // Keep the scan bounded while spacing samples across the entire track, even when it is long.
  const hop = Math.max(Math.round(effectiveRate * .5), Math.ceil(sampleCount / decimation / 400));
  const real = new Float64Array(fftSize);
  const imaginary = new Float64Array(fftSize);
  const previous = new Float64Array(fftSize / 2);
  const frames: AudioFingerprint[] = [];

  for (let start = 0; start < sampleCount && frames.length < 400; start += hop * decimation) {
    real.fill(0); imaginary.fill(0);
    let energy = 0;
    for (let i = 0; i < fftSize; i++) {
      let sample = 0;
      const sourceStart = start + i * decimation;
      for (const channel of channels) {
        let sum = 0, count = 0;
        for (let k = 0; k < decimation && sourceStart + k < sampleCount; k++) {
          sum += channel[sourceStart + k]; count++;
        }
        sample += count ? sum / count : 0;
      }
      sample /= channels.length;
      energy += sample * sample;
      const window = .5 - .5 * Math.cos(2 * Math.PI * i / (fftSize - 1));
      real[i] = sample * window;
    }

    // In-place radix-2 FFT, avoiding per-frame allocations for long uploads.
    for (let i = 1, j = 0; i < fftSize; i++) {
      let bit = fftSize >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        [real[i], real[j]] = [real[j], real[i]];
        [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]];
      }
    }
    for (let size = 2; size <= fftSize; size <<= 1) {
      const angle = -2 * Math.PI / size, half = size >> 1;
      const stepReal = Math.cos(angle), stepImaginary = Math.sin(angle);
      for (let base = 0; base < fftSize; base += size) {
        let wr = 1, wi = 0;
        for (let offset = 0; offset < half; offset++) {
          const even = base + offset, odd = even + half;
          const tr = wr * real[odd] - wi * imaginary[odd];
          const ti = wr * imaginary[odd] + wi * real[odd];
          real[odd] = real[even] - tr; imaginary[odd] = imaginary[even] - ti;
          real[even] += tr; imaginary[even] += ti;
          const nextWr = wr * stepReal - wi * stepImaginary;
          wi = wr * stepImaginary + wi * stepReal; wr = nextWr;
        }
      }
    }
    let low = 0, mid = 0, high = 0, total = 0, weighted = 0, geometric = 0, arithmetic = 0, flux = 0, count = 0;
    for (let bin = 1; bin < fftSize / 2; bin++) {
      const magnitude = Math.hypot(real[bin], imaginary[bin]) * 2 / fftSize;
      const frequency = bin * effectiveRate / fftSize;
      if (frequency < 180) low += magnitude;
      else if (frequency < 2200) mid += magnitude;
      else if (frequency < 10000) high += magnitude;
      total += magnitude; weighted += frequency * magnitude;
      arithmetic += magnitude; geometric += Math.log(Math.max(.00001, magnitude));
      flux += Math.max(0, magnitude - previous[bin - 1]);
      previous[bin - 1] = magnitude; count++;
    }
    frames.push({
      rms: clamp(Math.sqrt(energy / fftSize) * 2.2),
      onset: clamp(flux / Math.max(.0001, total) * 3.5),
      low: clamp(low / Math.max(.0001, total) * 1.25),
      mid: clamp(mid / Math.max(.0001, total) * 1.25),
      high: clamp(high / Math.max(.0001, total) * 1.25),
      centroid: clamp(total ? weighted / total / (effectiveRate / 2) : 0),
      flatness: clamp(Math.exp(geometric / Math.max(1, count)) / Math.max(.0001, arithmetic / Math.max(1, count)) * .65),
      pulse: false,
      tempo: 0,
    });
  }
  const signature = summarize(frames);
  const motifs = Array.from({ length: 8 }, (_, index) => {
    const start = Math.floor(frames.length * index / 8);
    const end = Math.max(start + 1, Math.floor(frames.length * (index + 1) / 8));
    return summarize(frames.slice(start, end));
  });
  return { signature, motifs, analyzedSeconds: sampleCount / sampleRate };
}