import assert from 'node:assert/strict';
import test from 'node:test';
import { levelPair, shuffleTracks, moveTrack, uploadedManifest, validateRemotePlaylist } from '../src/playlistRules.ts';
import { releaseBossAudio, SoundtrackLifecycle } from '../src/soundtrackLifecycle.ts';

function fakeAudio(paused = true) {
  const calls = { pauses: 0, removed: [], loads: 0 };
  const audio = {
    paused,
    volume: 1,
    pause() { this.paused = true; calls.pauses += 1; },
    removeAttribute(name) { calls.removed.push(name); },
    load() { calls.loads += 1; },
  };
  return { audio, calls };
}

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

test('soundtrack selects the newest living boss, then older living bosses, then the stage track', () => {
  const stage = fakeAudio();
  const oldest = fakeAudio(false);
  const newest = fakeAudio(false);
  const dying = fakeAudio(false);
  const stageReactive = { name: 'stage analysis' };
  const oldestReactive = { name: 'oldest boss analysis' };
  const newestReactive = { name: 'newest boss analysis' };
  const bosses = [
    { id: 1, health: 100, phase: 'PHASE1', audio: oldest.audio, reactive: oldestReactive },
    { id: 2, health: 100, phase: 'PHASE1', audio: newest.audio, reactive: newestReactive },
    { id: 3, health: 0, phase: 'DYING', audio: dying.audio, reactive: { name: 'dying boss analysis' } },
  ];
  const lifecycle = new SoundtrackLifecycle();
  const played = [];
  const playTrack = (audio, name) => {
    audio.paused = false;
    played.push({ audio, name });
  };

  assert.equal(lifecycle.select(bosses, stage.audio, newest.audio, stageReactive, playTrack), newestReactive);
  assert.equal(played.at(-1).audio, newest.audio);
  assert.equal(played.at(-1).name, 'Boss track');
  assert.equal(oldest.audio.paused, true);
  assert.equal(dying.audio.paused, true);
  assert.equal(stage.audio.paused, true);

  bosses[1].health = 0;
  bosses[1].phase = 'DYING';
  assert.equal(lifecycle.select(bosses, stage.audio, newest.audio, stageReactive, playTrack), oldestReactive);
  assert.equal(played.at(-1).audio, oldest.audio);
  assert.equal(played.at(-1).name, 'Boss track');
  assert.equal(newest.audio.paused, true);
  assert.equal(stage.audio.paused, true);

  bosses[0].health = 0;
  bosses[0].phase = 'DYING';
  assert.equal(lifecycle.select(bosses, stage.audio, newest.audio, stageReactive, playTrack), stageReactive);
  assert.equal(played.at(-1).audio, stage.audio);
  assert.equal(played.at(-1).name, 'Stage track');
  lifecycle.select(bosses, stage.audio, newest.audio, stageReactive, playTrack);
  assert.equal(played.filter(({ audio }) => audio === stage.audio).length, 1, 'keep the current owner playing without restarting it');
});

test('user pause resumes only tracks that were playing and keeps their ownership labels', () => {
  const stage = fakeAudio(false);
  const boss = fakeAudio(false);
  const alreadyPausedBoss = fakeAudio();
  const lifecycle = new SoundtrackLifecycle();
  const bosses = [
    { id: 1, health: 100, phase: 'PHASE1', audio: boss.audio },
    { id: 2, health: 100, phase: 'PHASE1', audio: alreadyPausedBoss.audio },
  ];

  const tracks = lifecycle.pauseForUser(stage.audio, boss.audio, bosses);
  assert.deepEqual(tracks, [stage.audio, boss.audio]);
  assert.equal(stage.calls.pauses, 1);
  assert.equal(boss.calls.pauses, 1, 'a boss track also passed as current audio is paused only once');
  assert.equal(alreadyPausedBoss.audio.paused, true);
  assert.equal(alreadyPausedBoss.calls.pauses, 0);

  const resumed = [];
  lifecycle.resumeAfterUserPause(tracks, stage.audio, (audio, name) => {
    audio.paused = false;
    resumed.push({ audio, name });
  });
  assert.deepEqual(resumed, [
    { audio: stage.audio, name: 'Stage track' },
    { audio: boss.audio, name: 'Boss track' },
  ]);
  assert.equal(alreadyPausedBoss.audio.paused, true, 'tracks paused before user pause must stay paused');
});

test('boss-audio release pauses playback and disconnects and reloads its media resources', () => {
  const { audio, calls } = fakeAudio(false);
  let sourceDisconnects = 0;
  let analyserDisconnects = 0;

  releaseBossAudio({
    audio,
    reactive: {
      source: { disconnect() { sourceDisconnects += 1; } },
      analyser: { disconnect() { analyserDisconnects += 1; } },
    },
  });

  assert.equal(audio.paused, true);
  assert.equal(calls.pauses, 1);
  assert.deepEqual(calls.removed, ['src']);
  assert.equal(calls.loads, 1);
  assert.equal(sourceDisconnects, 1);
  assert.equal(analyserDisconnects, 1);
});