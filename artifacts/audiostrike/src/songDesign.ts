import type { FeatureSet, ProjectileKind } from './gameRuntimeTypes';
import type { ShapeIdentity, AudioSignals, AttackPattern } from './encounterRules';
import { chooseAttack } from './encounterRules.ts';

export type SongDesign = {
  seed: number;
  shapes: ShapeIdentity[];
  colors: string[];
  core: ShapeIdentity;
  wings: ShapeIdentity;
  projectile: ProjectileKind;
  attack: AttackPattern;
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
  return {
    seed, shapes, core: shapes[0], wings: shapes[2],
    colors: Array.from({ length: 4 }, (_, i) => `hsl(${(hue + i * 22) % 360} 88% ${60 + i * 3}%)`),
    projectile: s.high > .6 ? 'SHARD' : s.low > .65 ? 'RING' : s.mid > .45 ? 'BOLT' : 'ORB',
    attack: chooseAttack(s, seed),
  };
}

export function songSpawnIdentity(features: FeatureSet, signal: AudioSignals, serial: number) {
  const design = features.design ?? createSongDesign(features);
  // The audio chooses an archetype within this song's roster, rather than an arbitrary global cycle.
  const archetype = Math.abs(Math.round(signal.low * 7 + signal.high * 11 + signal.mid * 5 + serial * .61)) % design.shapes.length;
  return { shape: design.shapes[archetype], color: design.colors[archetype % design.colors.length], projectile: design.projectile };
}