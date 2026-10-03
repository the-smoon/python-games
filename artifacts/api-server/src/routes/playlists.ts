import { Router, type RequestHandler } from "express";
import path from "node:path";
import { playlistUrl } from "../lib/playlistManifest";
import { createJob, getJob, jobResponse, removeJob } from "../lib/playlistJobs";

const router = Router();
const limits = new Map<string, { calls: number; starts: number; since: number; startSince: number }>();
export const playlistRateLimit: RequestHandler = (req, res, next) => {
  const now = Date.now(), key = req.ip ?? "unknown";
  // Admission caps the map at 1000, so cleanup must also run at exactly that size.
  // Preserve a client's still-active request window even when its download quota expires.
  if (limits.size >= 1000) {
    for (const [ip, value] of limits) {
      if (now - value.startSince >= 30 * 60_000 && now - value.since >= 60_000) limits.delete(ip);
    }
  }
  if (!limits.has(key) && limits.size >= 1000) { res.status(429).json({ error: "Service busy. Try later." }); return; }
  const limit = limits.get(key) ?? { calls: 0, starts: 0, since: now, startSince: now };
  if (now - limit.since > 60_000) { limit.calls = 0; limit.since = now; }
  if (now - limit.startSince > 30 * 60_000) { limit.starts = 0; limit.startSince = now; }
  limits.set(key, limit);
  if (++limit.calls > 120 || (req.method === "POST" && limit.starts >= 3)) {
    res.setHeader("Retry-After", String(req.method === "POST" && limit.starts >= 3
      ? Math.ceil((30 * 60_000 - (now - limit.startSince)) / 1000) : 60));
    res.status(429).json({ error: "Playlist request limit reached. Try again later." }); return;
  }
  res.setHeader("Cache-Control", "no-store");
  next();
};
router.use("/playlists", playlistRateLimit);
router.post("/playlists", async (req, res) => {
  let url: string;
  try { url = playlistUrl(req.body?.url); }
  catch { res.status(400).json({ error: "Use a public https YouTube Music or YouTube playlist URL (/playlist?list=…)." }); return; }
  // Invalid URLs never consume the expensive-download quota.
  const limit = limits.get(req.ip ?? "unknown");
  if (limit) limit.starts++;
  try { res.status(202).json(jobResponse(await createJob(url))); }
  catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : "Cannot start download" }); }
});
router.get("/playlists/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) { res.status(404).json({ error: "Playlist expired or removed. Download it again." }); return; }
  res.json(jobResponse(job));
});
router.get("/playlists/:id/tracks/:index", (req, res) => {
  const job = getJob(req.params.id);
  const index = req.params.index;
  const track = /^\d{1,2}$/.test(index) ? job?.manifest?.tracks[Number(index)] : undefined;
  if (!job || job.state !== "ready" || !track) { res.status(404).json({ error: "Track unavailable" }); return; }
  res.type("audio/mpeg").sendFile(path.join(job.dir, track.file));
});
router.delete("/playlists/:id", async (req, res) => {
  await removeJob(req.params.id);
  res.status(204).end();
});
export default router;