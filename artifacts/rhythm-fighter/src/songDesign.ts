import type { FeatureSet, ProjectileKind } from './gameRuntimeTypes';
import type { ShapeIdentity, AudioSignals, AttackPattern, MotionPattern } from './encounterRules';
import { chooseAttack, chooseMotion } from './encounterRules.ts';

export type SongSectionDesign = {
  signal: AudioSignals;
  shape: ShapeIdentity;
  color: string;
  projectile: ProjectileKind;
  motion: MotionPattern;
  attack: AttackPattern;
};

export type SongDesign = {
  seed: number;
  shapes: ShapeIdentity[];
  colors: string[];
  core: ShapeIdentity;
  wings: ShapeIdentity;
  projectile: ProjectileKind;
  attack: AttackPattern;
  sections: SongSectionDesign[];
};

const ROSTERS: ShapeIdentity[][] = [
  ['SQUARE', 'RECTANGLE', 'CIRCLE', 'CAPSULE', 'HEX'],
  ['TRIANGLE', 'DIAMOND', 'OVAL', 'RECTANGLE', 'ELBOW'],
  ['CIRCLE', 'RING', 'OVAL', 'ELBOW', 'CAPSULE'],
  ['RECTANGLE', 'SQUARE', 'ELBOW', 'TRIANGLE', 'RING'],
];

/** A stable song blueprint, prepared at the song boundary; live audio never replaces its silhouette/palette. */
export function createSongDesign(features: FeatureSet): SongDesign {
  const s = features.signature;
  const key = features.songKey ?? JSON.stringify(s);
  let seed = 2166136261;
  for (const character of key) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0;
  const family = s.low > s.high * 1.3 ? 0 : s.high > s.low * 1.3 ? 1 : s.flatness < .24 ? 2 : 3;
  const roster = ROSTERS[family];
  const offset = seed % roster.length;
  const shapes = roster.map((_, i) => roster[(i + offset) % roster.length]);
  const hue = (Math.round(s.centroid * 160 + s.mid * 90 + s.low * 45) + seed % 180) % 360;
  const signatures = features.motifs.length ? features.motifs : [s];
  const sections = signatures.map((signal, index): SongSectionDesign => {
    const motifShape = Math.abs(Math.round(signal.low * 13 + signal.mid * 7 + signal.high * 17 +
      signal.centroid * 29 + index * .73 + seed % 7)) % shapes.length;
    const shape = shapes[motifShape];
    const sectionHue = (hue + Math.round((signal.centroid - s.centroid) * 100 +
      (signal.high - signal.low) * 35 + index * 13) + 720) % 360;
    return {
      signal,
      shape,
      color: `hsl(${sectionHue} 88% ${60 + index % 4 * 3}%)`,
      projectile: signal.high > .6 ? 'SHARD' : signal.low > .65 ? 'RING' : signal.mid > .45 ? 'BOLT' : 'ORB',
      motion: chooseMotion(signal, seed + index, shape),
      attack: chooseAttack(signal, seed + index),
    };
  });
  return {
    seed, shapes, core: shapes[0], wings: shapes[2],
    colors: Array.from({ length: 4 }, (_, i) => `hsl(${(hue + i * 22) % 360} 88% ${60 + i * 3}%)`),
    projectile: s.high > .6 ? 'SHARD' : s.low > .65 ? 'RING' : s.mid > .45 ? 'BOLT' : 'ORB',
    attack: chooseAttack(s, seed),
    sections,
  };
}

export function songSectionAtTime(features: FeatureSet, currentTime: number, mediaDuration?: number): number {
  const count = features.motifs.length;
  if (count <= 1) return 0;
  const duration = Number.isFinite(mediaDuration) && mediaDuration! > 0
    ? mediaDuration! : Math.max(features.duration, features.analyzedSeconds);
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const time = Math.max(0, Number.isFinite(currentTime) ? currentTime : 0);
  return Math.min(count - 1, Math.floor(Math.min(time, duration - Number.EPSILON) / duration * count));
}

export function songSpawnIdentity(
  features: FeatureSet, signal: AudioSignals, serial: number, sectionIndex?: number,
) {
  const design = features.design ?? createSongDesign(features);
  const index = ((Math.trunc(sectionIndex ?? Math.abs(serial)) % design.sections.length) + design.sections.length) % design.sections.length;
  const section = design.sections[index];
  // Full-song section signatures choose an identity; serial and live section differences add encounter-level variety.
  const archetype = Math.abs(Math.round(signal.low * 7 + signal.high * 11 + signal.mid * 5 +
    signal.centroid * 13 + serial * .61 + index * 2.3)) % design.shapes.length;
  return {
    shape: design.shapes[archetype],
    color: section.color,
    projectile: section.projectile,
    motion: section.motion,
    attack: section.attack,
    signal: section.signal,
    sectionIndex: index,
  };
}