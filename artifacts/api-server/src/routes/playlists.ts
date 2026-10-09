import { Router, raw, type Request, type RequestHandler } from "express";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { DriveLibrary, driveLibrary, driveRequestContext, LibraryError, MAX_TRACK_BYTES } from "../lib/driveLibrary";
import {
  createGoogleIdentityVerifier, createOwnerSession, createSignedLoginState, exchangeGoogleCode,
  getCookie, GOOGLE_STATE_COOKIE, GOOGLE_STATE_MS, googleOAuthConfigured, googleRedirectUri,
  isOwner, OWNER_COOKIE, OWNER_SESSION_MS, readSignedLoginState, secureCookie, type GoogleLoginState,
} from "../lib/googleOwnerAuth";

type PlaylistRouterOptions = {
  oauthFetch?: typeof fetch;
  oauthRedirectUri?: (req: Request) => string | null;
  now?: () => number;
};

export function createPlaylistRouter(library: DriveLibrary = driveLibrary, options: PlaylistRouterOptions = {}) {
  const router = Router();
  const oauthFetch = options.oauthFetch ?? fetch;
  const now = options.now ?? Date.now;
  const redirectUriFor = options.oauthRedirectUri ?? googleRedirectUri;
  const verifyGoogleIdentity = createGoogleIdentityVerifier(oauthFetch, now);
  const clients = new Map<string, { since: number; requests: number; writes: number; logins: number; audio: number }>();
  let active = 0;
  let globalWriteWindow = Date.now(), globalWrites = 0;
  const limit: RequestHandler = (req, res, next) => {
    const current = Date.now();
    for (const [key, value] of clients) if (current - value.since >= 60_000) clients.delete(key);
    // Do not trust arbitrary X-Forwarded-For values.
    const key = req.ip ?? "unknown";
    if (!clients.has(key) && clients.size >= 1000) { res.status(429).json({ error: "Service busy. Try later." }); return; }
    const quota = clients.get(key) ?? { since: current, requests: 0, writes: 0, logins: 0, audio: 0 };
    clients.set(key, quota);
    const login = req.path === "/owner/google" && req.method === "GET";
    const write = req.method === "POST" && !login;
    const audio = req.path.startsWith("/audio/");
    if (current - globalWriteWindow >= 3600_000) { globalWrites = 0; globalWriteWindow = current; }
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
    if (!isOwner(req)) { res.status(403).json({ error: "Owner sign-in is required to upload music" }); return; }
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
  router.get("/playlists/owner", (req, res) => res.json({
    owner: isOwner(req, now()),
    configured: googleOAuthConfigured() && Boolean(redirectUriFor(req)),
  }));
  router.get("/playlists/owner/google", (req, res) => {
    const secret = process.env.SESSION_SECRET;
    const clientId = process.env.AUDIOSTRIKE_GOOGLE_CLIENT_ID;
    const redirectUri = redirectUriFor(req);
    const returnTo = req.query.returnTo;
    if (!secret || !clientId || !process.env.AUDIOSTRIKE_GOOGLE_CLIENT_SECRET || !redirectUri) {
      res.status(503).json({ error: "Google owner sign-in is not configured for this app address" }); return;
    }
    if (returnTo !== "/" && returnTo !== "/audiostrike-legacy/") {
      res.status(400).json({ error: "Invalid sign-in return path" }); return;
    }
    const state: GoogleLoginState = {
      state: randomBytes(32).toString("base64url"),
      nonce: randomBytes(32).toString("base64url"),
      verifier: randomBytes(32).toString("base64url"),
      returnTo,
      issuedAt: now(),
    };
    const challenge = createHash("sha256").update(state.verifier).digest("base64url");
    const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorization.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email",
      state: state.state,
      nonce: state.nonce,
      code_challenge: challenge,
      code_challenge_method: "S256",
      prompt: "select_account",
    }).toString();
    res.cookie(GOOGLE_STATE_COOKIE, createSignedLoginState(state, secret), {
      httpOnly: true, secure: secureCookie(req), sameSite: "lax",
      path: "/api/playlists/owner/google", maxAge: GOOGLE_STATE_MS,
    });
    res.redirect(302, authorization.toString());
  });
  router.get("/playlists/owner/google/callback", async (req, res): Promise<void> => {
    const secret = process.env.SESSION_SECRET;
    const stateValue = typeof req.query.state === "string" ? req.query.state : "";
    const state = secret ? readSignedLoginState(getCookie(req, GOOGLE_STATE_COOKIE), secret, now()) : null;
    res.clearCookie(GOOGLE_STATE_COOKIE, {
      httpOnly: true, secure: secureCookie(req), sameSite: "lax", path: "/api/playlists/owner/google",
    });
    if (!state || !stateValue || !/^[A-Za-z0-9_-]{40,64}$/.test(stateValue) ||
      state.state.length !== stateValue.length || !timingSafeEqual(Buffer.from(state.state), Buffer.from(stateValue))) {
      res.status(400).json({ error: "Google sign-in state is invalid or expired" }); return;
    }
    const finish = (result: "success" | "denied") => {
      const separator = state.returnTo.includes("?") ? "&" : "?";
      res.redirect(303, `${state.returnTo}${separator}ownerSignIn=${result}`);
    };
    if (req.query.error || typeof req.query.code !== "string" || !secret ||
      !process.env.AUDIOSTRIKE_GOOGLE_CLIENT_ID || !process.env.AUDIOSTRIKE_GOOGLE_CLIENT_SECRET) {
      finish("denied"); return;
    }
    try {
      const redirectUri = redirectUriFor(req);
      if (!redirectUri) { finish("denied"); return; }
      const idToken = await exchangeGoogleCode(req.query.code, state.verifier, redirectUri, oauthFetch);
      if (!idToken) { finish("denied"); return; }
      const email = await verifyGoogleIdentity(idToken, state.nonce, process.env.AUDIOSTRIKE_GOOGLE_CLIENT_ID);
      if (!email) { finish("denied"); return; }
      res.cookie(OWNER_COOKIE, createOwnerSession(now() + OWNER_SESSION_MS), {
        httpOnly: true, secure: secureCookie(req), sameSite: "strict",
        path: "/api/playlists", maxAge: OWNER_SESSION_MS,
      });
      finish("success");
    } catch {
      finish("denied");
    }
  });
  router.delete("/playlists/owner", sameOrigin, (req, res) => {
    res.clearCookie(OWNER_COOKIE, { httpOnly: true, secure: secureCookie(req), sameSite: "strict", path: "/api/playlists" });
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