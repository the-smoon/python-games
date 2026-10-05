import { Router, type RequestHandler } from "express";
import { eq } from "drizzle-orm";
import type { RunScore as RunScoreRow } from "@workspace/db";
import { SubmitRunScoreBody, SubmitRunScoreResponse, type RunScoreInput } from "@workspace/api-zod";

type SaveRunScore = (input: RunScoreInput) => Promise<{ row: RunScoreRow; created: boolean }>;

async function saveRunScore(input: RunScoreInput): Promise<{ row: RunScoreRow; created: boolean }> {
  const { db, runScoresTable } = await import("@workspace/db");
  const [inserted] = await db.insert(runScoresTable).values(input).onConflictDoNothing({
    target: runScoresTable.runId,
  }).returning();
  if (inserted) return { row: inserted, created: true };

  const [existing] = await db.select().from(runScoresTable)
    .where(eq(runScoresTable.runId, input.runId))
    .limit(1);
  if (!existing) throw new Error("Conflicting score could not be read");
  return { row: existing, created: false };
}

export function createRunScoresRouter(save: SaveRunScore = saveRunScore) {
  const router = Router();
  const clients = new Map<string, { since: number; writes: number }>();
  let globalWindow = Date.now();
  let globalWrites = 0;
  let active = 0;

  const limit: RequestHandler = (req, res, next) => {
    const now = Date.now();
    for (const [key, quota] of clients) {
      if (now - quota.since >= 60_000) clients.delete(key);
    }
    if (now - globalWindow >= 60 * 60_000) {
      globalWindow = now;
      globalWrites = 0;
    }

    const key = req.ip ?? "unknown";
    if (!clients.has(key) && clients.size >= 1000) {
      res.setHeader("Retry-After", "60");
      res.status(429).json({ error: "Score submissions are busy. Try again later." });
      return;
    }
    const quota = clients.get(key) ?? { since: now, writes: 0 };
    if (now - quota.since >= 60_000) {
      quota.since = now;
      quota.writes = 0;
    }

    if (++quota.writes > 5 || ++globalWrites > 400 || active >= 8) {
      res.setHeader("Retry-After", "60");
      res.status(429).json({ error: "Score submission limit reached. Try again later." });
      clients.set(key, quota);
      return;
    }
    clients.set(key, quota);
    active++;
    let released = false;
    const release = () => {
      if (released) return;
      active--;
      released = true;
    };
    res.once("finish", release);
    res.once("close", release);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  };

  router.post("/run-scores", limit, async (req, res): Promise<void> => {
    const origin = req.headers.origin;
    let foreignOrigin = req.headers["sec-fetch-site"] === "cross-site";
    try {
      if (origin) foreignOrigin ||= !/^https?:\/\//.test(origin) || new URL(origin).host !== req.get("host");
    } catch {
      foreignOrigin = true;
    }
    if (foreignOrigin) {
      res.status(403).json({ error: "Save run scores from Rhythm Fighter itself." });
      return;
    }

    const parsed = SubmitRunScoreBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid run score." });
      return;
    }

    const name = parsed.data.name.trim();
    if (!name || /[\u0000-\u001f\u007f-\u009f]/.test(name)) {
      res.status(400).json({ error: "Enter a display name without control characters." });
      return;
    }

    try {
      const saved = await save({ ...parsed.data, name });
      res.status(saved.created ? 201 : 200).json(SubmitRunScoreResponse.parse(saved.row));
    } catch {
      req.log.warn("Run score could not be saved");
      res.status(503).json({ error: "Run score could not be saved. Try again." });
    }
  });

  return router;
}

export default createRunScoresRouter();