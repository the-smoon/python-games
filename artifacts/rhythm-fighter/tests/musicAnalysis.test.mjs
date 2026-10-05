import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeMusic } from '../src/musicAnalysis.ts';

function sineSection(sampleRate, duration, frequencyAt) {
  const data = new Float32Array(sampleRate * duration);
  for (let i = 0; i < data.length; i += 1) {
    const time = i / sampleRate;
    data[i] = Math.sin(2 * Math.PI * frequencyAt(time) * time) * .55;
  }
  return data;
}

test('pre-match scan distinguishes sound bands and keeps multiple musical motifs', () => {
  const sampleRate = 22050;
  const bass = analyzeMusic([sineSection(sampleRate, 8, () => 110)], sampleRate);
  const treble = analyzeMusic([sineSection(sampleRate, 8, () => 4200)], sampleRate);
  assert.equal(bass.motifs.length, 8);
  assert.ok(bass.signature.low > bass.signature.high);
  assert.ok(treble.signature.high > treble.signature.low);
  assert.equal(bass.analyzedSeconds, 8);
});

test('long-track motif sampling spans the complete song within a bounded scan', () => {
  const sampleRate = 800;
  const data = sineSection(sampleRate, 300, (time) => time < 150 ? 50 : 300);
  const result = analyzeMusic([data], sampleRate);
  assert.equal(result.analyzedSeconds, 300);
  assert.equal(result.motifs.length, 8);
  assert.ok(result.motifs[0].low > result.motifs[0].mid);
  assert.ok(result.motifs[7].mid > result.motifs[7].low,
    'late-song material contributes to encounter designs');
});