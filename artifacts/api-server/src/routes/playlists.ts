import { Router, raw, type Request, type RequestHandler } from "express";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { DriveLibrary, driveLibrary, driveRequestContext, LibraryError, MAX_TRACK_BYTES } from "../lib/driveLibrary";

const COOKIE = "audiostrike_owner";
function equal(a: string, b: string) {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}
function sessionSecret() { return process.env.SESSION_SECRET; }
function owner(req: Request) {
  const secret = sessionSecret();
  const value = req.headers.cookie?.split(";").map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!secret || !process.env.AUDIOSTRIKE_OWNER_PASSWORD || !value) return false;
  const [expiry, signature] = value.split(".");
  return /^\d{13}$/.test(expiry ?? "") && Number(expiry) > Date.now() && Number(expiry) <= Date.now() + 8 * 3600_000 &&
    equal(signature ?? "", createHmac("sha256", secret).update(`${expiry}:${process.env.AUDIOSTRIKE_OWNER_PASSWORD}`).digest("hex"));
}
export function createPlaylistRouter(library: DriveLibrary = driveLibrary) {
  const router = Router();
  const clients = new Map<string, { since: number; requests: number; writes: number; logins: number; audio: number }>();
  let active = 0;
  let globalWriteWindow = Date.now(), globalWrites = 0;
  const limit: RequestHandler = (req, res, next) => {
    const now = Date.now();
    for (const [key, value] of clients) if (now - value.since >= 60_000) clients.delete(key);
    // Do not trust arbitrary X-Forwarded-For values.
    const key = req.ip ?? "unknown";
    if (!clients.has(key) && clients.size >= 1000) { res.status(429).json({ error: "Service busy. Try later." }); return; }
    const quota = clients.get(key) ?? { since: now, requests: 0, writes: 0, logins: 0, audio: 0 };
    clients.set(key, quota);
    const login = req.path === "/owner" && req.method === "POST";
    const write = req.method === "POST" && !login;
    const audio = req.path.startsWith("/audio/");
    if (now - globalWriteWindow >= 3600_000) { globalWrites = 0; globalWriteWindow = now; }
    if (++quota.requests > 120 || (login && ++quota.logins > 5) || (write && (++quota.writes > 10 || ++globalWrites > 60)) || (audio && ++quota.audio > 40) || active >= 4) {
      res.setHeader("Retry-After", "60");
      res.status(429).json({ error: "Music library request limit reached. Try again later." }); return;
    }
    active++;
    let released = false;
    const release = () => { if (!released) { active--; released = true; } };
    res.once("finish", release); res.once("close", release);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  };
  const sameOrigin: RequestHandler = (req, res, next) => {
    const origin = req.headers.origin;
    if (req.headers["sec-fetch-site"] === "cross-site" || (origin && (!/^https?:\/\//.test(origin) || new URL(origin).host !== req.get("host")))) {
      res.status(403).json({ error: "Use the music library from Rhythm Fighter itself" }); return;
    }
    next();
  };
  const requireOwner: RequestHandler = (req, res, next) => {
    if (!owner(req)) { res.status(403).json({ error: "Owner sign-in is required to upload music" }); return; }
    next();
  };
  const handle = (action: RequestHandler): RequestHandler => async (req, res, next) => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 120_000);
    const disconnect = () => { if (!res.writableFinished) abort.abort(); };
    res.once("close", disconnect);
    try { await driveRequestContext.run(abort.signal, () => action(req, res, next)); }
    catch (error) {
      const known = error instanceof LibraryError;
      res.status(known ? error.status : 503).json({ error: known ? error.message : "Drive could not complete the request. Try again." });
    }
    finally { clearTimeout(timer); res.off("close", disconnect); }
  };
  router.use("/playlists", limit);
  router.get("/playlists/owner", (req, res) => res.json({ owner: owner(req), configured: Boolean(sessionSecret() && process.env.AUDIOSTRIKE_OWNER_PASSWORD) }));
  router.post("/playlists/owner", sameOrigin, (req, res) => {
    const password = process.env.AUDIOSTRIKE_OWNER_PASSWORD, secret = sessionSecret();
    if (!password || !secret) { res.status(503).json({ error: "The owner must configure the upload password in Secrets" }); return; }
    if (typeof req.body?.password !== "string" || req.body.password.length > 256 || !equal(req.body.password, password)) {
      res.status(401).json({ error: "Incorrect owner password" }); return;
    }
    const expiry = String(Date.now() + 8 * 3600_000);
    const signature = createHmac("sha256", secret).update(`${expiry}:${password}`).digest("hex");
    res.cookie(COOKIE, `${expiry}.${signature}`, { httpOnly: true, secure: process.env.NODE_ENV === "production" || req.headers["x-forwarded-proto"] === "https", sameSite: "strict", path: "/api/playlists", maxAge: 8 * 3600_000 });
    res.json({ owner: true, configured: true });
  });
  router.delete("/playlists/owner", sameOrigin, (_req, res) => {
    res.clearCookie(COOKIE, { httpOnly: true, sameSite: "strict", path: "/api/playlists" });
    res.status(204).end();
  });
  router.get("/playlists/library", handle(async (_req, res) => { res.json(await library.library()); }));
  router.get("/playlists/audio/:id", handle(async (req, res) => {
    const bytes = await library.audio(String(req.params.id));
    res.type("audio/mpeg").send(bytes);
  }));
  router.get("/playlists", handle(async (_req, res) => { res.json(await library.playlists()); }));
  router.post("/playlists", sameOrigin, handle(async (req, res) => {
    res.status(201).json(await library.save(req.body?.name, req.body?.trackIds));
  }));
  router.post("/playlists/upload", sameOrigin, requireOwner, raw({ type: "audio/mpeg", limit: MAX_TRACK_BYTES }), handle(async (req, res) => {
    if (!Buffer.isBuffer(req.body)) throw new LibraryError(400, "Upload the MP3 with Content-Type audio/mpeg");
    let name: string;
    try { name = decodeURIComponent(req.get("X-Filename") ?? ""); }
    catch { throw new LibraryError(400, "Invalid MP3 filename"); }
    res.status(201).json(await library.upload(name, req.body));
  }));
  router.get("/playlists/:id", handle(async (req, res) => { res.json(await library.load(String(req.params.id))); }));
  return router;
}
export default createPlaylistRouter();