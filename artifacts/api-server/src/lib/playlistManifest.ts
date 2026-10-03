export const MAX_TRACKS = 20;
export const MAX_TRACK_BYTES = 24 * 1024 * 1024;
export const MAX_PLAYLIST_BYTES = 192 * 1024 * 1024;

export function playlistUrl(input: unknown): string {
  if (typeof input !== "string" || input.length > 512) throw new Error("Enter a YouTube Music playlist URL");
  const url = new URL(input);
  const id = url.searchParams.get("list");
  if (url.protocol !== "https:" || !["music.youtube.com", "www.youtube.com", "youtube.com"].includes(url.hostname)
      || url.username || url.password || url.port || url.pathname !== "/playlist"
      || !id || !/^[A-Za-z0-9_-]{1,200}$/.test(id)) {
    throw new Error("Use an https YouTube Music or YouTube /playlist?list=… URL");
  }
  return `https://music.youtube.com/playlist?list=${id}`;
}

export type DiskManifest = { version: 1; tracks: { file: string; title: string }[]; skipped: number };
export function validateManifest(input: unknown): DiskManifest {
  const data = input as DiskManifest;
  if (!data || data.version !== 1 || !Array.isArray(data.tracks) || !data.tracks.length
      || data.tracks.length > MAX_TRACKS || !Number.isInteger(data.skipped) || data.skipped < 0 || data.skipped > MAX_TRACKS) {
    throw new Error("Downloader returned an invalid manifest");
  }
  const seen = new Set<string>();
  for (const track of data.tracks) {
    if (!track || typeof track.file !== "string" || !/^\d{4}\.mp3$/.test(track.file)
        || seen.has(track.file) || typeof track.title !== "string" || !track.title.length || track.title.length > 200) {
      throw new Error("Downloader returned an unsafe track path or title");
    }
    seen.add(track.file);
  }
  return data;
}