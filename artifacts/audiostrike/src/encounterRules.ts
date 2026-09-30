export type AudioSignals = {
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

export type AttackPattern = 'TRACK' | 'BURST' | 'RADIAL' | 'SPIRAL' | 'WAVE';
export type MotionPattern = 'ORBIT' | 'SWEEP' | 'CHASE' | 'DASH' | 'ZIGZAG';

export type FormProfile = {
  sides: number;
  lobes: number;
  spikes: number;
  innerRadius: number;
  rotation: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));

const signalValue = (signal: AudioSignals, key: Exclude<keyof AudioSignals, 'pulse' | 'tempo'>) =>
  clamp(signal[key], 0, 1);

const tempoIntensity = (tempo: number) => clamp(tempo / 180, 0, 1);

export function audioIntensity(signal: AudioSignals): number {
  const level =
    signalValue(signal, 'rms') * 0.24 +
    signalValue(signal, 'onset') * 0.16 +
    signalValue(signal, 'low') * 0.12 +
    signalValue(signal, 'mid') * 0.12 +
    signalValue(signal, 'high') * 0.12 +
    signalValue(signal, 'centroid') * 0.04 +
    signalValue(signal, 'flatness') * 0.04 +
    tempoIntensity(signal.tempo) * 0.08 +
    (signal.pulse ? 0.08 : 0);
  return clamp(level, 0, 1);
}

export function spawnProfile(
  signal: AudioSignals,
  level: number,
  progress: number,
): { count: number; cooldown: number; speedScale: number; fireScale: number; maxEnemies: number } {
  const intensity = audioIntensity(signal);
  const stageProgress = clamp(progress, 0, 1);
  const levelProgress = clamp((level - 1) / 10, 0, 1);
  const pulseBoost = signal.pulse ? 1 : 0;

  return {
    count: Math.round(clamp(1 + stageProgress * 1.6 + intensity * 3.5 + pulseBoost * 0.8 + levelProgress * 1.2, 1, 8)),
    cooldown: Math.round(clamp(96 - stageProgress * 20 - intensity * 48 - pulseBoost * 8 - levelProgress * 10, 24, 96)),
    speedScale: Number(clamp(0.78 + intensity * 0.72 + levelProgress * 0.18, 0.7, 1.7).toFixed(3)),
    fireScale: Number(clamp(0.72 + intensity * 0.92 + pulseBoost * 0.12 + levelProgress * 0.2, 0.65, 1.9).toFixed(3)),
    maxEnemies: Math.round(clamp(8 + stageProgress * 5 + intensity * 8 + levelProgress * 6, 8, 28)),
  };
}

export function generateForm(signal: AudioSignals, serial: number, scale = 1): FormProfile {
  const low = signalValue(signal, 'low');
  const mid = signalValue(signal, 'mid');
  const high = signalValue(signal, 'high');
  const centroid = signalValue(signal, 'centroid');
  const flatness = signalValue(signal, 'flatness');
  const onset = signalValue(signal, 'onset');
  const safeSerial = Number.isFinite(serial) ? Math.trunc(serial) : 0;
  const safeScale = clamp(scale, 0.5, 2);
  const variation = Math.abs(safeSerial * 7 + Math.round(low * 11) + Math.round(high * 17));

  return {
    sides: Math.round(clamp(4 + low * 4 + mid * 2 + (variation % 3), 3, 12)),
    lobes: Math.round(clamp(1 + mid * 4 + flatness * 3 + (variation % 2), 0, 8)),
    spikes: Math.round(clamp(high * 7 + onset * 5 + (signal.pulse ? 2 : 0) + (variation % 4), 0, 16)),
    innerRadius: Number(clamp((0.24 + flatness * 0.25 + high * 0.12 + (variation % 5) * 0.025) * safeScale, 0.18, 0.72).toFixed(3)),
    rotation: Number(((((safeSerial * 0.37 + centroid * Math.PI * 2 + low * 1.4) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)) - Math.PI).toFixed(3)),
  };
}

function selectPattern<T extends string>(
  scores: number[],
  patterns: readonly T[],
  serial: number,
): T {
  let strongest = 0;
  const safeSerial = Number.isFinite(serial) ? Math.trunc(serial) : 0;
  const variation = (index: number) => ((Math.sin(safeSerial * 12.9898 + index * 78.233) * 43758.5453) % 1 + 1) % 1 * 0.02;
  for (let index = 1; index < scores.length; index += 1) {
    if (scores[index] + variation(index) > scores[strongest] + variation(strongest)) strongest = index;
  }
  return patterns[strongest];
}

const ATTACKS: readonly AttackPattern[] = ['TRACK', 'BURST', 'RADIAL', 'SPIRAL', 'WAVE'];

export function chooseAttack(signal: AudioSignals, serial: number): AttackPattern {
  const low = signalValue(signal, 'low');
  const mid = signalValue(signal, 'mid');
  const high = signalValue(signal, 'high');
  const centroid = signalValue(signal, 'centroid');
  const flatness = signalValue(signal, 'flatness');
  const onset = signalValue(signal, 'onset');
  const tempo = tempoIntensity(signal.tempo);
  const pulse = signal.pulse ? 1 : 0;
  return selectPattern([
    mid * 0.65 + (1 - onset) * 0.2,
    high * 0.55 + onset * 0.7 + pulse * 0.25,
    low * 0.7 + signalValue(signal, 'rms') * 0.35 + pulse * 0.2,
    flatness * 0.55 + centroid * 0.4 + high * 0.2,
    tempo * 0.65 + mid * 0.35 + onset * 0.15,
  ], ATTACKS, serial);
}

const MOTIONS: readonly MotionPattern[] = ['ORBIT', 'SWEEP', 'CHASE', 'DASH', 'ZIGZAG'];

export function chooseMotion(signal: AudioSignals, serial: number): MotionPattern {
  const low = signalValue(signal, 'low');
  const mid = signalValue(signal, 'mid');
  const high = signalValue(signal, 'high');
  const centroid = signalValue(signal, 'centroid');
  const flatness = signalValue(signal, 'flatness');
  const onset = signalValue(signal, 'onset');
  const tempo = tempoIntensity(signal.tempo);
  const pulse = signal.pulse ? 1 : 0;
  return selectPattern([
    low * 0.55 + mid * 0.25 + (1 - onset) * 0.2,
    mid * 0.35 + high * 0.4 + centroid * 0.25,
    low * 0.35 + mid * 0.35 + signalValue(signal, 'rms') * 0.3,
    onset * 0.65 + pulse * 0.25 + tempo * 0.55 + mid * 0.3,
    high * 0.6 + centroid * 0.35 + flatness * 0.3,
  ], MOTIONS, serial);
}

export function bossHealth(duration: number, level: number): number {
  const safeDuration = clamp(duration, 0, Number.MAX_SAFE_INTEGER);
  const baseline = Math.round(2100 + Math.min(500, safeDuration * 8));
  const levelScale = 1 + clamp(level - 1, 0, 20) * 0.12;
  return Math.round((baseline / 2) * levelScale);
}