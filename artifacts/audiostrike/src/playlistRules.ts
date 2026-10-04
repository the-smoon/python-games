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
export function validateLocalPlaylist(tracks: readonly LocalTrack[]) {
  if (!tracks.length || tracks.length > 20) throw new Error('Choose a playlist of 1–20 library tracks');
  let bytes = 0;
  const seen = new Set<string>();
  for (const track of tracks) {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(track.id) || seen.has(track.id) || !track.title ||
        !(track.file instanceof File) || !track.file.size || track.file.size > 24 * 1024 * 1024 ||
        track.file.type !== 'audio/mpeg') throw new Error('Choose valid MP3 tracks from the Drive library');
    seen.add(track.id);
    bytes += track.file.size;
  }
  if (bytes > 192 * 1024 * 1024) throw new Error('Playlist exceeds 192 MB');
}