import assert from 'node:assert/strict';
import test from 'node:test';
import {
  audioIntensity,
  blendAudioSignals,
  bossHealth,
  chooseAttack,
  chooseMotion,
  generateForm,
  spawnProfile,
  varyShapeIdentity,
} from '../src/encounterRules.ts';

const quiet = {
  rms: 0.04, onset: 0, low: 0.03, mid: 0.04, high: 0.02,
  centroid: 0.1, flatness: 0.08, pulse: false, tempo: 60,
};
const energetic = {
  rms: 0.9, onset: 0.95, low: 0.85, mid: 0.8, high: 0.9,
  centroid: 0.82, flatness: 0.76, pulse: true, tempo: 176,
};

test('energetic, fast and pulsed audio drives substantially higher encounter pressure', () => {
  assert.ok(audioIntensity(energetic) > audioIntensity(quiet) + 0.5);
  const calm = spawnProfile(quiet, 1, 0);
  const intense = spawnProfile(energetic, 1, 0);
  assert.ok(intense.count > calm.count);
  assert.ok(intense.cooldown < calm.cooldown);
  assert.ok(intense.speedScale > calm.speedScale);
  assert.ok(intense.fireScale > calm.fireScale);
});

test('quiet tracks remain playable and encounter values stay bounded', () => {
  const profile = spawnProfile(quiet, 1, 0);
  assert.equal(profile.count, 1);
  assert.ok(profile.cooldown >= 24 && profile.cooldown <= 96);
  assert.ok(profile.speedScale >= 0.7 && profile.speedScale <= 1.7);
  assert.ok(profile.fireScale >= 0.65 && profile.fireScale <= 1.9);

  for (const level of [-10, 1, 50]) {
    for (const progress of [-2, 0, 0.5, 1, 4]) {
      const result = spawnProfile(energetic, level, progress);
      assert.ok(result.count >= 1 && result.count <= 8);
      assert.ok(result.cooldown >= 24 && result.cooldown <= 96);
      assert.ok(result.maxEnemies >= 8 && result.maxEnemies <= 28);
      assert.ok(result.speedScale >= 0.7 && result.speedScale <= 1.7);
      assert.ok(result.fireScale >= 0.65 && result.fireScale <= 1.9);
    }
  }
});

test('form profiles are deterministic, bounded, and vary across audio and serials', () => {
  const first = generateForm(quiet, 3);
  assert.deepEqual(generateForm(quiet, 3), first);
  const forms = [
    generateForm(quiet, 0),
    generateForm(energetic, 1),
    generateForm({ ...quiet, low: 1, mid: 0.1, high: 0, flatness: 0.1 }, 2),
    generateForm({ ...quiet, low: 0, mid: 0.1, high: 1, flatness: 1, onset: 1, pulse: true }, 4),
  ];
  assert.ok(new Set(forms.map((form) => `${form.sides}:${form.lobes}:${form.spikes}:${form.innerRadius}`)).size >= 3);
  for (const form of [...forms, generateForm(energetic, 100, 100)]) {
    assert.ok(Number.isInteger(form.sides) && form.sides >= 3 && form.sides <= 12);
    assert.ok(Number.isInteger(form.lobes) && form.lobes >= 0 && form.lobes <= 8);
    assert.ok(Number.isInteger(form.spikes) && form.spikes >= 0 && form.spikes <= 16);
    assert.ok(form.innerRadius >= 0.18 && form.innerRadius <= 0.72);
    assert.ok(form.rotation >= -Math.PI && form.rotation <= Math.PI);
  }
});

test('attack and motion selection is deterministic and responsive to audio qualities', () => {
  const signals = [
    quiet,
    { ...quiet, low: 1, rms: 0.9, pulse: true },
    { ...quiet, mid: 1, tempo: 130 },
    { ...quiet, high: 1, centroid: 0.95, onset: 1, flatness: 1, pulse: true },
  ];
  const attacks = signals.map((signal, serial) => chooseAttack(signal, serial));
  const motions = signals.map((signal, serial) => chooseMotion(signal, serial));
  assert.ok(new Set(attacks).size >= 3);
  assert.ok(new Set(motions).size >= 3);
  for (let index = 0; index < signals.length; index += 1) {
    assert.equal(chooseAttack(signals[index], index), attacks[index]);
    assert.equal(chooseMotion(signals[index], index), motions[index]);
  }
});

test('shape identity and pre-match movement preference bias motion without replacing live rhythm', () => {
  assert.equal(chooseMotion(quiet, 4, 'TRIANGLE', 'DASH'), 'DASH');
  assert.equal(chooseMotion(quiet, 4, 'RING', 'ORBIT'), 'ORBIT');
  assert.deepEqual(['CIRCLE', 'DIAMOND', 'TRIANGLE', 'HEX', 'RING']
    .map((shape, index) => varyShapeIdentity(shape, 1)),
  ['DIAMOND', 'TRIANGLE', 'HEX', 'RING', 'CIRCLE']);

  const mixed = blendAudioSignals(quiet, energetic, .25);
  assert.equal(mixed.pulse, true, 'live pulses stay immediate');
  assert.ok(mixed.rms > quiet.rms && mixed.rms < energetic.rms, 'song structure remains the stronger baseline');
  assert.ok(mixed.tempo > quiet.tempo && mixed.tempo < energetic.tempo);
});

test('boss health is half the level-one baseline, then increases with bounded level scaling', () => {
  for (const duration of [0, 30, 60, 120]) {
    const baseline = Math.round(2100 + Math.min(500, duration * 8));
    assert.equal(bossHealth(duration, 1), Math.round(baseline / 2));
  }
  assert.ok(bossHealth(60, 2) > bossHealth(60, 1));
  assert.ok(bossHealth(60, 100) <= Math.round(2600 / 2 * 3.4));
  assert.equal(bossHealth(120, 1), bossHealth(1000, 1));
});