import { Router, type RequestHandler } from "express";
import { and, eq, count } from "drizzle-orm";
import { db, songAnalysisTable } from "@workspace/db";
import { GetSongAnalysisParams, GetSongAnalysisResponse, StoreSongAnalysisBody, StoreSongAnalysisParams } from "@workspace/api-zod";

const router = Router();
const VERSION = 1;
const quotas = new Map<string, { since: number; reads: number; writes: number }>();
let globalWindow = Date.now(), globalWrites = 0, active = 0;
const limit: RequestHandler = (req, res, next) => {
  const now = Date.now();
  for (const [key, q] of quotas) if (now - q.since >= 60_000) quotas.delete(key);
  if (now - globalWindow >= 3600_000) { globalWindow = now; globalWrites = 0; }
  const key = req.ip ?? "unknown";
  const q = quotas.get(key) ?? { since: now, reads: 0, writes: 0 };
  if ((!quotas.has(key) && quotas.size >= 1000) || active >= 4 ||
    ++q.reads > 100 || (req.method === "PUT" && (++q.writes > 25 || ++globalWrites > 400))) {
    res.setHeader("Retry-After", "60"); res.status(429).json({ error: "Song cache is busy. Try again later." }); return;
  }
  quotas.set(key, q); active++;
  let released = false;
  const release = () => { if (!released) { active--; released = true; } };
  res.once("finish", release); res.once("close", release);
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
};
router.use("/song-analysis", limit);
router.get("/song-analysis/:hash", async (req, res): Promise<void> => {
  const parsed = GetSongAnalysisParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid audio fingerprint" }); return; }
  try {
    const [row] = await db.select().from(songAnalysisTable).where(and(eq(songAnalysisTable.hash, parsed.data.hash), eq(songAnalysisTable.version, VERSION))).limit(1);
    if (!row) { res.status(404).json({ error: "Song has not been analyzed yet" }); return; }
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json(GetSongAnalysisResponse.parse(row.document));
  } catch {
    req.log.warn("Song analysis cache lookup failed");
    res.status(503).json({ error: "Saved song analysis is unavailable" });
  }
});
router.put("/song-analysis/:hash", async (req, res): Promise<void> => {
  const origin = req.headers.origin;
  let foreignOrigin = req.headers["sec-fetch-site"] === "cross-site";
  try { if (origin) foreignOrigin ||= !/^https?:\/\//.test(origin) || new URL(origin).host !== req.get("host"); }
  catch { foreignOrigin = true; }
  if (foreignOrigin) {
    res.status(403).json({ error: "Save song analysis from Rhythm Fighter itself" }); return;
  }
  const params = StoreSongAnalysisParams.safeParse(req.params), body = StoreSongAnalysisBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid song analysis document" }); return; }
  try {
    const where = and(eq(songAnalysisTable.hash, params.data.hash), eq(songAnalysisTable.version, VERSION));
    const [existing] = await db.select().from(songAnalysisTable).where(where).limit(1);
    if (existing) { res.json(GetSongAnalysisResponse.parse(existing.document)); return; }
    const [capacity] = await db.select({ total: count() }).from(songAnalysisTable);
    if (capacity.total >= 10000) { res.status(429).json({ error: "Song analysis cache has reached its storage limit" }); return; }
    await db.insert(songAnalysisTable).values({ hash: params.data.hash, version: VERSION, document: body.data })
      .onConflictDoNothing({ target: [songAnalysisTable.hash, songAnalysisTable.version] });
    const [saved] = await db.select().from(songAnalysisTable).where(where).limit(1);
    res.json(GetSongAnalysisResponse.parse(saved.document));
  } catch {
    req.log.warn("Song analysis cache write failed");
    res.status(503).json({ error: "Song analysis could not be saved" });
  }
});
export default router;