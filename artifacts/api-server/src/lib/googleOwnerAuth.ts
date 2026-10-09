import { createHash, createHmac, createPublicKey, createVerify, randomBytes, timingSafeEqual } from "node:crypto";
import type { webcrypto } from "node:crypto";
import type { Request } from "express";

export const OWNER_EMAIL = "danielsampson40@gmail.com";
export const OWNER_COOKIE = "audiostrike_owner";
export const GOOGLE_STATE_COOKIE = "audiostrike_google_state";
export const OWNER_SESSION_MS = 8 * 60 * 60_000;
export const GOOGLE_STATE_MS = 10 * 60_000;
const GOOGLE_KEYS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export type GoogleLoginState = {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: "/" | "/audiostrike-legacy/";
  issuedAt: number;
};

type GoogleKey = webcrypto.JsonWebKey & { kid?: string; use?: string; alg?: string };
type GoogleClaims = {
  iss?: unknown;
  aud?: unknown;
  azp?: unknown;
  sub?: unknown;
  exp?: unknown;
  iat?: unknown;
  nonce?: unknown;
  email?: unknown;
  email_verified?: unknown;
};

function safeEqual(a: string, b: string) {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

export function getCookie(req: Request, name: string): string | undefined {
  const entry = req.headers.cookie?.split(";").map((part) => part.trim())
    .find((part) => part.slice(0, part.indexOf("=")) === name);
  if (!entry) return undefined;
  return entry.slice(entry.indexOf("=") + 1);
}

export function secureCookie(req: Request) {
  return process.env.NODE_ENV === "production" || req.secure || req.headers["x-forwarded-proto"] === "https";
}

export function googleOAuthConfigured() {
  return Boolean(process.env.SESSION_SECRET && process.env.AUDIOSTRIKE_GOOGLE_CLIENT_ID &&
    process.env.AUDIOSTRIKE_GOOGLE_CLIENT_SECRET);
}

export function isOwner(req: Request, now = Date.now()) {
  const secret = process.env.SESSION_SECRET;
  const value = getCookie(req, OWNER_COOKIE);
  if (!secret || !value) return false;
  const [expiry, signature, ...extra] = value.split(".");
  return extra.length === 0 && /^\d{13}$/.test(expiry ?? "") && Number(expiry) > now &&
    Number(expiry) <= now + OWNER_SESSION_MS && safeEqual(signature ?? "",
      createHmac("sha256", secret).update(`${expiry}:${OWNER_EMAIL}`).digest("hex"));
}

export function createOwnerSession(expiry: number) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("Owner sessions are not configured");
  const expiryString = String(expiry);
  const signature = createHmac("sha256", secret).update(`${expiryString}:${OWNER_EMAIL}`).digest("hex");
  return `${expiryString}.${signature}`;
}

export function createSignedLoginState(state: GoogleLoginState, secret: string) {
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function readSignedLoginState(value: string | undefined, secret: string, now = Date.now()): GoogleLoginState | null {
  if (!value) return null;
  const [payload, signature, ...extra] = value.split(".");
  if (extra.length || !payload || !signature) return null;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (!safeEqual(signature, expected)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<GoogleLoginState>;
    if (typeof decoded.state !== "string" || !/^[A-Za-z0-9_-]{40,64}$/.test(decoded.state) ||
      typeof decoded.nonce !== "string" || !/^[A-Za-z0-9_-]{40,64}$/.test(decoded.nonce) ||
      typeof decoded.verifier !== "string" || !/^[A-Za-z0-9_-]{43,128}$/.test(decoded.verifier) ||
      (decoded.returnTo !== "/" && decoded.returnTo !== "/audiostrike-legacy/") ||
      typeof decoded.issuedAt !== "number" || !Number.isSafeInteger(decoded.issuedAt) ||
      decoded.issuedAt > now + 60_000 || now - decoded.issuedAt > GOOGLE_STATE_MS) return null;
    return decoded as GoogleLoginState;
  } catch {
    return null;
  }
}

function parseJwtPart<T>(value: string): T | null {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

function maxAge(headers: Headers) {
  const match = headers.get("cache-control")?.match(/(?:^|,)\s*max-age=(\d+)/i);
  const seconds = match ? Number(match[1]) : 3600;
  return Math.min(Math.max(seconds, 60), 86_400) * 1000;
}

export function createGoogleIdentityVerifier(fetcher: typeof fetch, now: () => number) {
  let cachedKeys: GoogleKey[] = [];
  let cachedUntil = 0;

  async function getKeys(force = false): Promise<GoogleKey[]> {
    if (!force && cachedKeys.length && cachedUntil > now()) return cachedKeys;
    const response = await fetcher(GOOGLE_KEYS_URL, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("Google signing keys are unavailable");
    const body = await response.json() as { keys?: unknown };
    if (!Array.isArray(body.keys)) throw new Error("Google signing keys were invalid");
    cachedKeys = body.keys.filter((key): key is GoogleKey =>
      typeof key === "object" && key !== null && (key as GoogleKey).kty === "RSA" &&
      typeof (key as GoogleKey).kid === "string");
    if (!cachedKeys.length) throw new Error("Google signing keys were invalid");
    cachedUntil = now() + maxAge(response.headers);
    return cachedKeys;
  }

  return async function verifyGoogleIdentity(idToken: string, expectedNonce: string, clientId: string): Promise<string | null> {
    if (idToken.length > 16_384) return null;
    const parts = idToken.split(".");
    if (parts.length !== 3) return null;
    const [encodedHeader, encodedClaims, encodedSignature] = parts;
    const header = parseJwtPart<{ alg?: unknown; kid?: unknown }>(encodedHeader);
    const claims = parseJwtPart<GoogleClaims>(encodedClaims);
    if (header?.alg !== "RS256" || typeof header.kid !== "string" || !claims) return null;

    let keys = await getKeys();
    let key = keys.find((candidate) => candidate.kid === header.kid && (!candidate.alg || candidate.alg === "RS256") &&
      (!candidate.use || candidate.use === "sig"));
    if (!key) {
      keys = await getKeys(true);
      key = keys.find((candidate) => candidate.kid === header.kid && (!candidate.alg || candidate.alg === "RS256") &&
        (!candidate.use || candidate.use === "sig"));
    }
    if (!key) return null;

    let signatureValid = false;
    try {
      const verifier = createVerify("RSA-SHA256");
      verifier.update(`${encodedHeader}.${encodedClaims}`);
      verifier.end();
      signatureValid = verifier.verify(createPublicKey({ key, format: "jwk" }), Buffer.from(encodedSignature, "base64url"));
    } catch {
      return null;
    }
    if (!signatureValid) return null;

    const seconds = Math.floor(now() / 1000);
    const audiences = typeof claims.aud === "string" ? [claims.aud] : Array.isArray(claims.aud) ? claims.aud : [];
    const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
    if ((claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com") ||
      !audiences.includes(clientId) || (audiences.length > 1 && claims.azp !== clientId) ||
      typeof claims.sub !== "string" || !claims.sub ||
      typeof claims.exp !== "number" || claims.exp <= seconds ||
      typeof claims.iat !== "number" || claims.iat > seconds + 60 || seconds - claims.iat > 3600 ||
      typeof claims.nonce !== "string" || !safeEqual(claims.nonce, expectedNonce) ||
      claims.email_verified !== true || email !== OWNER_EMAIL) return null;
    return email;
  };
}

export async function exchangeGoogleCode(
  code: string,
  verifier: string,
  redirectUri: string,
  fetcher: typeof fetch,
): Promise<string | null> {
  const clientId = process.env.AUDIOSTRIKE_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.AUDIOSTRIKE_GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  const response = await fetcher(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  const tokens = await response.json() as { id_token?: unknown };
  return typeof tokens.id_token === "string" ? tokens.id_token : null;
}

export function googleRedirectUri(req: Request): string | null {
  const configured = [
    process.env.REPLIT_DEV_DOMAIN,
    ...(process.env.REPLIT_DOMAINS ?? "").split(","),
  ].flatMap((value) => {
    const domain = value?.trim();
    if (!domain) return [];
    try {
      return [new URL(domain.includes("://") ? domain : `https://${domain}`).hostname.toLowerCase()];
    } catch {
      return [];
    }
  });
  const hostname = req.hostname.toLowerCase().replace(/\.$/, "");
  const localDevelopment = process.env.NODE_ENV !== "production" &&
    (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1");
  if (!configured.includes(hostname) && !localDevelopment) return null;
  if (localDevelopment) {
    const protocol = req.secure || req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
    return `${protocol}://${req.get("host")}/api/playlists/owner/google/callback`;
  }
  return `https://${hostname}/api/playlists/owner/google/callback`;
}
