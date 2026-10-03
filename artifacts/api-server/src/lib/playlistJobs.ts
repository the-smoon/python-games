import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MAX_PLAYLIST_BYTES, MAX_TRACK_BYTES, validateManifest, type DiskManifest } from "./playlistManifest";
import { logger } from "./logger";

type Job = {
  id: string; dir: string; state: "downloading" | "ready" | "error";
  message: string; completed: number; total: number; expires: number;
  child?: ChildProcess; manifest?: DiskManifest; dispose?: () => void;
};
const jobs = new Map<string, Job>();
// Resolve from process cwd (artifact root in managed workflows), not the bundled module's directory.
const scriptPath = () => path.resolve(process.cwd(), process.cwd().endsWith("api-server") ? "scripts/stream2mp3.py" : "artifacts/api-server/scripts/stream2mp3.py");
export function getJob(id: string) { return /^[a-f0-9-]{36}$/.test(id) ? jobs.get(id) : undefined; }
export function jobResponse(job: Job) {
  return {
    id: job.id, state: job.state, message: job.message, completed: job.completed, total: job.total,
    manifest: job.manifest ? {
      version: 1, skipped: job.manifest.skipped,
      tracks: job.manifest.tracks.map((track, index) => ({
        id: String(index), title: track.title, url: `/api/playlists/${job.id}/tracks/${index}`,
      })),
    } : undefined,
  };
}
function kill(job: Job) {
  if (job.child?.pid) {
    try { process.kill(-job.child.pid, "SIGKILL"); } catch { /* already exited */ }
  }
}
export async function removeJob(id: string) {
  const job = jobs.get(id);
  if (!job) return;
  jobs.delete(id);
  kill(job);
  job.dispose?.();
  if (job.dir) await rm(job.dir, { recursive: true, force: true });
}
export async function inspectOutput(dir: string, manifest: unknown) {
  const parsed = validateManifest(manifest);
  let total = 0;
  for (const track of parsed.tracks) {
    const stat = await lstat(path.join(dir, track.file));
    if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || stat.size > MAX_TRACK_BYTES) {
      throw new Error("A downloaded track is empty, unsafe, or exceeds 24 MB");
    }
    total += stat.size;
  }
  if (total > MAX_PLAYLIST_BYTES) throw new Error("Playlist exceeds 192 MB");
  return parsed;
}
export async function createJob(url: string, options: { spawnProcess?: typeof spawn; timeoutMs?: number } = {}) {
  if (jobs.size >= 4 || [...jobs.values()].filter((job) => job.state === "downloading").length >= 2) {
    throw new Error("Download service is busy. Try again after another download finishes.");
  }
  // Reserve capacity before awaiting filesystem work.
  const id = randomUUID();
  const job: Job = { id, dir: "", state: "downloading", message: "Checking downloader dependencies", completed: 0, total: 0, expires: Date.now() + 15 * 60_000 };
  jobs.set(id, job);
  try { job.dir = await mkdtemp(path.join(tmpdir(), "audiostrike-")); }
  catch (error) { jobs.delete(id); throw error; }
  if (!jobs.has(id)) { await rm(job.dir, { recursive: true, force: true }); throw new Error("Download cancelled"); }
  const child = (options.spawnProcess ?? spawn)("python", ["-u", scriptPath(), url, "--game-manifest", "-o", job.dir], {
    cwd: job.dir, detached: true, shell: false, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });
  job.child = child;
  let outputBytes = 0, buffer = "", stderr = "", monitoring = false;
  const fail = async (message: string) => {
    if (!jobs.has(id) || job.state !== "downloading") return;
    job.state = "error"; job.message = message; job.dispose?.(); kill(job);
    await rm(job.dir, { recursive: true, force: true }).catch(() => undefined);
  };
  const timeout = setTimeout(() => void fail("Download exceeded the 10 minute time limit"), options.timeoutMs ?? 600_000);
  const monitor = setInterval(async () => {
    if (monitoring || job.state !== "downloading") return;
    monitoring = true;
    try {
      let total = 0;
      for (const file of await readdir(job.dir)) {
        const stat = await lstat(path.join(job.dir, file));
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_TRACK_BYTES) throw new Error("Downloaded file exceeds the 24 MB limit");
        total += stat.size;
      }
      if (total > MAX_PLAYLIST_BYTES) throw new Error("Download exceeds the 192 MB playlist limit");
    } catch (error) { await fail(error instanceof Error ? error.message : "Download output check failed"); }
    finally { monitoring = false; }
  }, 500);
  job.dispose = () => { clearTimeout(timeout); clearInterval(monitor); };
  const acceptOutput = (chunk: Buffer, error: boolean) => {
    outputBytes += chunk.length;
    if (outputBytes > 128 * 1024) { void fail("Downloader exceeded its output limit"); return; }
    if (error) { stderr = (stderr + chunk.toString()).slice(-1500); return; }
    buffer += chunk.toString();
    const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (typeof event.message === "string" && event.message.length <= 250 &&
            Number.isInteger(event.completed) && Number.isInteger(event.total) &&
            event.completed >= 0 && event.completed <= 20 && event.total >= 0 && event.total <= 20) {
          job.message = event.message; job.completed = event.completed; job.total = event.total;
        }
      } catch { /* supplied script also prints human-readable dependency diagnostics */ }
    }
  };
  child.stdout?.on("data", (chunk) => acceptOutput(chunk, false));
  child.stderr?.on("data", (chunk) => acceptOutput(chunk, true));
  child.on("error", () => void fail("Cannot start Python downloader. Check server dependencies."));
  child.on("close", async (code) => {
    if (!jobs.has(id) || job.state !== "downloading") { job.child = undefined; return; }
    job.dispose?.();
    if (code !== 0) {
      const missing = stderr.includes("Missing required dependencies");
      await fail(missing ? "Downloader dependencies missing: install yt-dlp and ffmpeg on the server."
        : stderr.includes("1–20") ? "Playlist exceeds 20 tracks or is empty. Use a shorter playlist."
        : stderr.includes("24 MB") ? "A track exceeds the 24 MB limit. Use shorter tracks."
        : "Playlist download failed. Check that it is public, has at most 20 short tracks, and is available from this server.");
      logger.warn({ code }, "Playlist downloader failed");
      job.child = undefined;
      return;
    }
    try {
      const stat = await lstat(path.join(job.dir, "manifest.json"));
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16_384) throw new Error("Invalid manifest file");
      const manifest = JSON.parse(await readFile(path.join(job.dir, "manifest.json"), "utf8"));
      const validated = await inspectOutput(job.dir, manifest);
      if (!jobs.has(id) || job.state !== "downloading") return;
      job.manifest = validated;
      job.state = "ready"; job.message = "Playlist ready for review";
    } catch (error) { await fail(error instanceof Error ? error.message : "Invalid playlist output"); }
    finally { job.child = undefined; }
  });
  return job;
}
const janitor = setInterval(() => {
  for (const job of jobs.values()) if (job.expires <= Date.now()) void removeJob(job.id);
}, 30_000);
janitor.unref();
export async function shutdownPlaylists() {
  clearInterval(janitor);
  await Promise.all([...jobs.keys()].map(removeJob));
}