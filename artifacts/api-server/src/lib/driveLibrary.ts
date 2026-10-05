import { ReplitConnectors } from "@replit/connectors-sdk";
import { parseBuffer } from "music-metadata";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

export const MAX_TRACK_BYTES = 24 * 1024 * 1024;
export const MAX_PLAYLIST_BYTES = 192 * 1024 * 1024;
export class LibraryError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export type DriveFile = { id: string; name: string; mimeType: string; size?: string; parents?: string[]; trashed?: boolean };
export type DriveTrack = { id: string; title: string; size: number };
export type DriveRequest = (path: string, init?: RequestInit) => Promise<Response>;
const connectors = new ReplitConnectors();
const proxyFetch = connectors.createProxyFetch("google-drive");
export const driveRequestContext = new AsyncLocalStorage<AbortSignal>();
const driveRequest: DriveRequest = (path, init) => proxyFetch(path, { ...init,
  signal: AbortSignal.any([AbortSignal.timeout(60_000), ...(driveRequestContext.getStore() ? [driveRequestContext.getStore()!] : [])]),
});
export function fileId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) throw new LibraryError(400, "Invalid Drive file reference");
  return value;
}
export function playlistName(value: unknown): string {
  if (typeof value !== "string") throw new LibraryError(400, "Enter a playlist name");
  const name = value.trim().replace(/\.json$/i, "");
  if (!name || name.length > 80 || /[/\\\x00-\x1f]/.test(name) || name === "." || name === "..") {
    throw new LibraryError(400, "Use a playlist name of 1–80 characters without slashes");
  }
  return `${name}.json`;
}
export async function readBounded(response: Response, max: number): Promise<Buffer> {
  if (Number(response.headers.get("content-length")) > max) {
    await response.body?.cancel();
    throw new LibraryError(413, "File exceeds the size limit");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new LibraryError(502, "Drive returned an empty file");
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) throw new LibraryError(413, "File exceeds the size limit");
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => undefined); }
  if (!size) throw new LibraryError(422, "Drive returned an empty file");
  return Buffer.concat(chunks);
}
export async function validateMp3(bytes: Buffer) {
  if (!bytes.length || bytes.length > MAX_TRACK_BYTES) throw new LibraryError(413, "MP3 must be nonempty and at most 24 MB");
  try {
    const metadata = await parseBuffer(bytes, { mimeType: "audio/mpeg", size: bytes.length }, { duration: true, skipCovers: true });
    if (metadata.format.container !== "MPEG" || !metadata.format.codec?.startsWith("MPEG") ||
        !Number.isFinite(metadata.format.duration) || !metadata.format.duration || metadata.format.duration > 720) {
      throw new Error("Invalid MP3");
    }
  } catch { throw new LibraryError(422, "Use a valid MP3 no longer than 12 minutes"); }
}

export class DriveLibrary {
  private folderPromise?: Promise<string>;
  private writing = false;
  constructor(private request: DriveRequest = driveRequest, private folder = process.env.AUDIOSTRIKE_MUSIC_FOLDER_ID) {}
  private musicFolder() {
    if (!this.folder) throw new LibraryError(503, "The owner must configure the Drive music folder");
    return fileId(this.folder);
  }
  private async call(path: string, init?: RequestInit) {
    let response: Response;
    try { response = await this.request(path, init); }
    catch { throw new LibraryError(503, "Drive is unavailable or timed out. Try again later."); }
    if (!response.ok) {
      await response.body?.cancel();
      throw new LibraryError(response.status === 404 ? 404 : 503, response.status === 404
        ? "Drive file or folder is unavailable"
        : response.status === 401 || response.status === 403
          ? "Drive access was denied. The owner must check the connection and folder permissions."
          : "Drive request failed. Try again later.");
    }
    return response;
  }
  private async metadata(id: string): Promise<DriveFile> {
    const response = await this.call(`/drive/v3/files/${fileId(id)}?fields=id,name,mimeType,size,parents,trashed&supportsAllDrives=true`);
    return response.json() as Promise<DriveFile>;
  }
  private async list(folder: string): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 10; page++) {
      const params = new URLSearchParams({ q: `'${fileId(folder)}' in parents and trashed = false`,
        fields: "nextPageToken,incompleteSearch,files(id,name,mimeType,size)", pageSize: "100",
        orderBy: "name", supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
      if (pageToken) params.set("pageToken", pageToken);
      const data = await (await this.call(`/drive/v3/files?${params}`)).json() as { incompleteSearch?: boolean; files: DriveFile[]; nextPageToken?: string };
      if (data.incompleteSearch || !Array.isArray(data.files)) throw new LibraryError(503, "Drive returned an incomplete library. Try again.");
      files.push(...data.files);
      pageToken = data.nextPageToken;
      if (!pageToken) return files;
    }
    throw new LibraryError(413, "Library exceeds 1,000 files. Ask the owner to reduce this folder.");
  }
  private track(file: DriveFile): DriveTrack {
    const size = Number(file.size);
    if (!/\.mp3$/i.test(file.name) || !["audio/mpeg", "audio/mp3"].includes(file.mimeType) ||
        !Number.isSafeInteger(size) || size <= 0 || size > MAX_TRACK_BYTES) {
      throw new LibraryError(422, "A selected track is not a valid MP3 or exceeds 24 MB");
    }
    return { id: fileId(file.id), title: file.name.slice(0, 200), size };
  }
  private async music(id: string) {
    const file = await this.metadata(id);
    if (file.trashed || !file.parents?.includes(this.musicFolder())) throw new LibraryError(404, "Track is not in the music library");
    return this.track(file);
  }
  async library() {
    return (await this.list(this.musicFolder())).filter(file => /\.mp3$/i.test(file.name) &&
      ["audio/mpeg", "audio/mp3"].includes(file.mimeType) && Number(file.size) > 0 && Number(file.size) <= MAX_TRACK_BYTES).map(file => this.track(file));
  }
  async audio(id: string) {
    const track = await this.music(id);
    const bytes = await readBounded(await this.call(`/drive/v3/files/${fileId(id)}?alt=media&supportsAllDrives=true`), MAX_TRACK_BYTES);
    if (bytes.length !== track.size) throw new LibraryError(502, "Drive track changed during retrieval. Refresh the library.");
    await validateMp3(bytes);
    return bytes;
  }
  async playlistFolder(): Promise<string> {
    if (!this.folderPromise) {
      this.folderPromise = (async () => {
        const folder = await this.metadata(this.musicFolder());
        if (folder.trashed || folder.mimeType !== "application/vnd.google-apps.folder") throw new LibraryError(503, "Configured Drive music folder is unavailable");
        const matches = (await this.list(this.musicFolder())).filter(file => file.name === "AudioStrike Playlists" && file.mimeType === "application/vnd.google-apps.folder");
        if (matches.length > 1) throw new LibraryError(409, "Multiple shared playlist folders exist. Ask the owner to keep one.");
        if (matches.length) return fileId(matches[0].id);
        const created = await (await this.call("/drive/v3/files?fields=id&supportsAllDrives=true", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "AudioStrike Playlists", mimeType: "application/vnd.google-apps.folder", parents: [this.musicFolder()] }),
        })).json() as { id: string };
        return fileId(created.id);
      })().catch(error => { this.folderPromise = undefined; throw error; });
    }
    return this.folderPromise;
  }
  async playlists() {
    return (await this.list(await this.playlistFolder())).filter(file => file.mimeType === "application/json" && /\.json$/i.test(file.name))
      .map(file => ({ id: fileId(file.id), name: file.name.replace(/\.json$/i, "") }));
  }
  async selected(ids: unknown) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 20 || new Set(ids).size !== ids.length) throw new LibraryError(400, "Choose 1–20 distinct library tracks");
    const tracks: DriveTrack[] = [];
    for (const id of ids) tracks.push(await this.music(fileId(id)));
    if (tracks.reduce((sum, track) => sum + track.size, 0) > MAX_PLAYLIST_BYTES) throw new LibraryError(413, "Playlist exceeds 192 MB");
    return tracks;
  }
  async load(id: string) {
    const file = await this.metadata(id);
    if (file.trashed || !file.parents?.includes(await this.playlistFolder()) || file.mimeType !== "application/json") {
      throw new LibraryError(404, "Saved playlist is not in the shared playlist folder");
    }
    const bytes = await readBounded(await this.call(`/drive/v3/files/${fileId(id)}?alt=media&supportsAllDrives=true`), 8192);
    let definition;
    try { definition = JSON.parse(bytes.toString("utf8")); }
    catch { throw new LibraryError(422, "Saved playlist contains invalid JSON"); }
    if (definition.version !== 1) throw new LibraryError(422, "Saved playlist version is unsupported");
    return { id, name: file.name.replace(/\.json$/i, ""), tracks: await this.selected(definition.trackIds) };
  }
  private async uploadFile(name: string, mimeType: string, bytes: Buffer, folder: string) {
    const boundary = `audiostrike-${randomUUID()}`;
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, mimeType, parents: [folder] })}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
      bytes, Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return (await this.call("/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size&supportsAllDrives=true", {
      method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body,
    })).json() as Promise<DriveFile>;
  }
  async save(name: unknown, ids: unknown) {
    const filename = playlistName(name);
    if (this.writing) throw new LibraryError(429, "Another playlist is being saved. Try again.");
    this.writing = true;
    try {
      const tracks = await this.selected(ids);
      const folder = await this.playlistFolder();
      if ((await this.list(folder)).some(file => file.name.toLowerCase() === filename.toLowerCase())) {
        throw new LibraryError(409, "A playlist with that name already exists. Choose another name.");
      }
      const file = await this.uploadFile(filename, "application/json", Buffer.from(JSON.stringify({ version: 1, trackIds: tracks.map(track => track.id) })), folder);
      return { id: fileId(file.id), name: filename.replace(/\.json$/i, "") };
    } finally { this.writing = false; }
  }
  async upload(name: string, bytes: Buffer) {
    if (!name || name.length > 200 || /[/\\\x00-\x1f]/.test(name) || !/\.mp3$/i.test(name)) throw new LibraryError(400, "Choose an MP3 filename without slashes");
    await validateMp3(bytes);
    return this.track(await this.uploadFile(name, "audio/mpeg", bytes, this.musicFolder()));
  }
}
export const driveLibrary = new DriveLibrary();