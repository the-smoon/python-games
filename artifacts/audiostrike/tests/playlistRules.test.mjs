import assert from 'node:assert/strict';
import test from 'node:test';
import { levelPair, shuffleTracks, moveTrack, uploadedManifest, validateRemotePlaylist } from '../src/playlistRules.ts';

test('adjacent pairs cycle; odd lengths continue across the boundary', () => {
  const tracks = ['A', 'B', 'C'];
  assert.deepEqual([1, 2, 3, 4].map((level) => levelPair(tracks, level)), [
    { stage: 'A', boss: 'B' }, { stage: 'C', boss: 'A' },
    { stage: 'B', boss: 'C' }, { stage: 'A', boss: 'B' },
  ]);
  assert.deepEqual(levelPair(['A'], 100), { stage: 'A', boss: 'A' });
  assert.deepEqual(levelPair(['A', 'B', 'C', 'D'], 3), { stage: 'A', boss: 'B' });
  for (const level of [0, -1, 1.5, Infinity]) assert.throws(() => levelPair(tracks, level));
  assert.throws(() => levelPair([], 1));
});
test('manual ordering and once-only shuffle preserve every track without mutating input', () => {
  const tracks = ['A', 'B', 'C'];
  assert.deepEqual(moveTrack(tracks, 2, 0), ['C', 'A', 'B']);
  assert.deepEqual(levelPair(moveTrack(tracks, 2, 0), 1), { stage: 'C', boss: 'A' });
  const shuffled = shuffleTracks(tracks, () => 0);
  assert.deepEqual(shuffled, ['B', 'C', 'A']);
  assert.deepEqual(levelPair(shuffled, 2), { stage: 'A', boss: 'B' });
  assert.deepEqual(tracks, ['A', 'B', 'C']);
  assert.throws(() => shuffleTracks(tracks, () => 1));
  assert.throws(() => moveTrack(tracks, -1, 0));
});
test('separate upload selectors use the manifest path and repeat the same pair', () => {
  const stage = new File(['stage'], 'stage.wav'), boss = new File(['boss'], 'boss.wav');
  const manifest = uploadedManifest(stage, boss);
  assert.equal(manifest.version, 1);
  for (const level of [1, 2, 100]) {
    const pair = levelPair(manifest.tracks, level);
    assert.equal(pair.stage.file, stage); assert.equal(pair.boss.file, boss);
  }
});
test('remote manifests reject external, arbitrary, reordered-index and traversal paths', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const data = { id, state: 'ready', message: 'Ready', completed: 1, total: 1,
    manifest: { version: 1, skipped: 0, tracks: [{ id: '0', title: 'A', url: `/api/playlists/${id}/tracks/0` }] } };
  assert.deepEqual(validateRemotePlaylist(data), data);
  for (const url of ['https://evil.test/a.mp3', '/etc/passwd', '../a.mp3', `/api/playlists/${id}/tracks/1`]) {
    assert.throws(() => validateRemotePlaylist({ ...data, manifest: { ...data.manifest, tracks: [{ ...data.manifest.tracks[0], url }] } }));
  }
  assert.throws(() => validateRemotePlaylist({ ...data, manifest: { ...data.manifest, tracks: [] } }));
});