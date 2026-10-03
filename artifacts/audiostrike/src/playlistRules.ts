export type LocalTrack = { id: string; title: string; file: File };
export type TrackManifest<T> = { version: 1; tracks: T[] };

export function levelPair<T>(tracks: readonly T[], level: number): { stage: T; boss: T } {
  if (!tracks.length || !Number.isSafeInteger(level) || level < 1) throw new Error('Invalid playlist or level');
  const start = ((level - 1) % tracks.length * 2) % tracks.length;
  return { stage: tracks[start], boss: tracks[(start + 1) % tracks.length] };
}

/** Fisher–Yates runs once before pairing; replay keeps the frozen run order. */
export function shuffleTracks<T>(tracks: readonly T[], random = Math.random): T[] {
  const result = [...tracks];
  for (let i = result.length - 1; i > 0; i--) {
    const sample = random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw new Error('Invalid random sample');
    const j = Math.floor(sample * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export function moveTrack<T>(tracks: readonly T[], from: number, to: number): T[] {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= tracks.length || to >= tracks.length) {
    throw new Error('Invalid track position');
  }
  const result = [...tracks];
  result.splice(to, 0, ...result.splice(from, 1));
  return result;
}
export function uploadedManifest(stage: File, boss: File): TrackManifest<LocalTrack> {
  return { version: 1, tracks: [
    { id: 'stage', title: stage.name, file: stage },
    { id: 'boss', title: boss.name, file: boss },
  ] };
}

export type RemotePlaylist = {
  id: string; state: 'downloading' | 'ready' | 'error'; message: string; completed: number; total: number;
  manifest?: { version: 1; skipped: number; tracks: { id: string; title: string; url: string }[] };
};
export function validateRemotePlaylist(value: unknown): RemotePlaylist {
  const job = value as RemotePlaylist;
  if (!job || typeof job.id !== 'string' || !/^[a-f0-9-]{36}$/.test(job.id) ||
      !['downloading', 'ready', 'error'].includes(job.state) || typeof job.message !== 'string' ||
      !Number.isInteger(job.completed) || !Number.isInteger(job.total) ||
      job.completed < 0 || job.total < job.completed || job.total > 20) throw new Error('Invalid playlist response');
  if (job.state === 'ready') {
    const manifest = job.manifest;
    if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.tracks) || !manifest.tracks.length ||
        manifest.tracks.length > 20 || !Number.isInteger(manifest.skipped) || manifest.skipped < 0) throw new Error('Invalid playlist manifest');
    manifest.tracks.forEach((track, i) => {
      if (!track || track.id !== String(i) || typeof track.title !== 'string' || !track.title.length ||
          track.title.length > 200 || track.url !== `/api/playlists/${job.id}/tracks/${i}`) {
        throw new Error('Unsafe playlist track reference');
      }
    });
  }
  return job;
}