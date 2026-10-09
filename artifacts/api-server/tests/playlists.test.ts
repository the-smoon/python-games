import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { readFile } from "node:fs/promises";
import express from "express";
import { DriveLibrary, fileId, playlistName, MAX_TRACK_BYTES, readBounded, validateMp3, type DriveFile } from "../src/lib/driveLibrary";
import { createPlaylistRouter } from "../src/routes/playlists";

const mp3 = await readFile(new URL("./fixtures/tone.mp3", import.meta.url));
function fakeDrive() {
  const files = new Map<string, DriveFile>([
    ["music", { id: "music", name: "Music", mimeType: "application/vnd.google-apps.folder" }],
    ["songs", { id: "songs", name: "AudioStrike Playlists", mimeType: "application/vnd.google-apps.folder", parents: ["music"] }],
    ...["A", "B", "C"].map(id => [id, { id, name: `${id}.mp3`, mimeType: "audio/mpeg", size: String(mp3.length), parents: ["music"] }] as [string, DriveFile]),
    ["outside", { id: "outside", name: "secret.mp3", mimeType: "audio/mpeg", size: String(mp3.length), parents: ["private"] }],
  ]);
  const contents = new Map<string, Buffer>(["A", "B", "C", "outside"].map(id => [id, mp3]));
  const calls: string[] = [];
  let failure = 0, counter = 0;
  const request = async (path: string, init?: RequestInit) => {
    calls.push(path);
    if (failure) return Response.json({ token: "must never escape", error: "private error" }, { status: failure });
    const url = new URL(path, "https://www.googleapis.com");
    if (url.pathname === "/drive/v3/files" && init?.method === "POST") {
      const metadata = JSON.parse(String(init.body));
      const id = `created-${++counter}`;
      files.set(id, { id, ...metadata }); return Response.json({ id });
    }
    if (url.pathname === "/upload/drive/v3/files") {
      const body = Buffer.from(init?.body as Buffer);
      const text = body.toString("utf8"), metadataStart = text.indexOf("\r\n\r\n") + 4;
      const metadata = JSON.parse(text.slice(metadataStart, text.indexOf("\r\n--", metadataStart)));
      const contentStart = body.indexOf("\r\n\r\n", body.indexOf("\r\n--", metadataStart)) + 4;
      const content = body.subarray(contentStart, body.lastIndexOf("\r\n--"));
      const id = `created-${++counter}`, file = { id, ...metadata, size: String(content.length) };
      files.set(id, file); contents.set(id, content); return Response.json(file);
    }
    if (url.pathname === "/drive/v3/files") {
      const folder = url.searchParams.get("q")?.match(/^'([^']+)'/)?.[1];
      return Response.json({ files: [...files.values()].filter(file => file.parents?.includes(folder!) && !file.trashed) });
    }
    const id = url.pathname.split("/").pop()!;
    const file = files.get(id);
    if (!file) return Response.json({}, { status: 404 });
    if (url.searchParams.get("alt") === "media") return new Response(contents.get(id) as unknown as BodyInit);
    return Response.json(file);
  };
  return { files, contents, calls, library: new DriveLibrary(request, "music"), fail: (status: number) => { failure = status; } };
}
test("lists MP3s only in designated folder and retrieves validated audio", async () => {
  const drive = fakeDrive();
  drive.files.set("bad", { id: "bad", name: "oversize.mp3", mimeType: "audio/mpeg", size: String(MAX_TRACK_BYTES + 1), parents: ["music"] });
  assert.deepEqual((await drive.library.library()).map(track => track.id), ["A", "B", "C"]);
  assert.deepEqual(await drive.library.audio("A"), mp3);
  await assert.rejects(() => drive.library.audio("outside"), /not in the music library/);
  assert.ok(!drive.calls.some(path => path.includes("outside?alt=media")));
  drive.contents.set("A", Buffer.from("invalid"));
  await assert.rejects(() => drive.library.audio("A"), /changed/);
});
test("shared playlists save ordered references, load and never overwrite", async () => {
  const drive = fakeDrive();
  const saved = await drive.library.save("Test", ["C", "A", "B"]);
  assert.equal(saved.name, "Test");
  assert.deepEqual(JSON.parse(drive.contents.get(saved.id)!.toString()), { version: 1, trackIds: ["C", "A", "B"] });
  assert.deepEqual(drive.files.get(saved.id)?.parents, ["songs"], "new saves must continue using the existing AudioStrike Playlists folder");
  assert.deepEqual((await drive.library.load(saved.id)).tracks.map(track => track.id), ["C", "A", "B"]);
  assert.deepEqual(await drive.library.playlists(), [saved]);
  await assert.rejects(() => drive.library.save("test.json", ["A"]), /already exists/);
  await assert.rejects(() => drive.library.save("Empty", []), /1–20/);
  await assert.rejects(() => drive.library.save("Dupe", ["A", "A"]), /distinct/);
  await assert.rejects(() => drive.library.save("Outside", ["outside"]), /not in/);
  await assert.rejects(() => drive.library.load("A"), /not in the shared/);
  drive.contents.set(saved.id, Buffer.from("not json"));
  await assert.rejects(() => drive.library.load(saved.id), /invalid JSON/);
});
test("creates dedicated playlist child folder and rejects oversized or unsafe definitions", async () => {
  const drive = fakeDrive();
  drive.files.delete("songs");
  const id = await drive.library.playlistFolder();
  assert.deepEqual(drive.files.get(id)?.parents, ["music"]);
  assert.equal(drive.files.get(id)?.name, "AudioStrike Playlists");
  for (const value of ["../file", "", "https://evil"]) assert.throws(() => fileId(value));
  for (const value of ["../name", ".", "\u0000"]) assert.throws(() => playlistName(value));
  assert.equal(playlistName("  Good.json  "), "Good.json");
  await assert.rejects(() => readBounded(new Response(new Uint8Array(10)), 9), /size/);
  await assert.rejects(() => validateMp3(Buffer.from("ID3notanmp3")), /valid MP3/);
  await validateMp3(mp3);
});
test("playlist limits, deleted references, changed parents and concurrent saves fail explicitly", async () => {
  const drive = fakeDrive();
  const maxTracks = Array.from({ length: 21 }, (_, i) => `track-${i}`);
  for (const id of maxTracks) drive.files.set(id, { id, name: `${id}.mp3`, mimeType: "audio/mpeg", size: String(MAX_TRACK_BYTES), parents: ["music"] });
  await assert.rejects(() => drive.library.selected(maxTracks), /1–20/);
  await assert.rejects(() => drive.library.selected(maxTracks.slice(0, 9)), /192 MB/);
  const results = await Promise.allSettled([drive.library.save("Concurrent", ["A"]), drive.library.save("Concurrent", ["A"])]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const saved = await drive.library.save("Missing", ["B"]);
  drive.files.delete("B");
  await assert.rejects(() => drive.library.load(saved.id), /unavailable/);
  drive.files.get(saved.id)!.parents = ["private"];
  await assert.rejects(() => drive.library.load(saved.id), /not in the shared/);
  await assert.rejects(() => drive.library.upload("../song.mp3", mp3), /filename/);
  await assert.rejects(() => drive.library.upload("song.wav", mp3), /MP3 filename/);
  await assert.rejects(() => drive.library.upload("song.mp3", Buffer.alloc(MAX_TRACK_BYTES + 1)), /24 MB/);
});
test("Drive failures are actionable and never expose provider response or authorization", async () => {
  const drive = fakeDrive();
  drive.fail(403);
  await assert.rejects(() => drive.library.library(), error => {
    assert.match((error as Error).message, /access was denied/);
    assert.doesNotMatch((error as Error).message, /token|private/); return true;
  });
  const missing = new DriveLibrary(async () => { throw new Error("secret token"); }, "music");
  await assert.rejects(() => missing.library(), /unavailable or timed out/);
});
test("Google OIDC limits uploads to the verified owner and leaves shared music anonymous", async () => {
  const envKeys = ["SESSION_SECRET", "AUDIOSTRIKE_GOOGLE_CLIENT_ID", "AUDIOSTRIKE_GOOGLE_CLIENT_SECRET"] as const;
  const previousEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
  process.env.SESSION_SECRET = "test-only-session-key";
  process.env.AUDIOSTRIKE_GOOGLE_CLIENT_ID = "test-google-client-id";
  process.env.AUDIOSTRIKE_GOOGLE_CLIENT_SECRET = "test-google-client-secret";

  const ownerKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const attackerKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...ownerKey.publicKey.export({ format: "jwk" }), kid: "google-test-key", use: "sig", alg: "RS256" };
  let clock = Date.now();
  const tokens = new Map<string, { nonce: string; claims?: Record<string, unknown>; key?: typeof ownerKey.privateKey }>();
  const mintIdToken = (nonce: string, overrides: Record<string, unknown> = {}, key = ownerKey.privateKey) => {
    const now = Math.floor(clock / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "google-test-key", typ: "JWT" })).toString("base64url");
    const claims = Buffer.from(JSON.stringify({
      iss: "https://accounts.google.com", aud: "test-google-client-id", sub: "google-owner-subject",
      exp: now + 300, iat: now, nonce, email: "DanielSampson40@gmail.com", email_verified: true, ...overrides,
    })).toString("base64url");
    const signingInput = `${header}.${claims}`;
    const signer = createSign("RSA-SHA256");
    signer.update(signingInput); signer.end();
    return `${signingInput}.${signer.sign(key).toString("base64url")}`;
  };
  const oauthFetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.href === "https://oauth2.googleapis.com/token") {
      const form = new URLSearchParams(String(init?.body));
      assert.equal(form.get("client_id"), "test-google-client-id");
      assert.equal(form.get("client_secret"), "test-google-client-secret");
      assert.equal(form.get("grant_type"), "authorization_code");
      assert.equal(form.get("redirect_uri"), "https://rhythm-fighter.test/api/playlists/owner/google/callback");
      assert.ok(form.get("code_verifier"), "authorization code exchange must use PKCE");
      const data = tokens.get(form.get("code") ?? "");
      assert.ok(data, "only the test authorization codes should reach Google");
      return Response.json({ id_token: mintIdToken(data.nonce, data.claims, data.key) });
    }
    if (url.href === "https://www.googleapis.com/oauth2/v3/certs") {
      return Response.json({ keys: [jwk] }, { headers: { "cache-control": "public, max-age=3600" } });
    }
    throw new Error("Unexpected OAuth request");
  };
  const drive = fakeDrive();
  const app = express();
  app.use(express.json({ limit: "4kb" }));
  app.use("/api", createPlaylistRouter(drive.library, {
    oauthFetch,
    oauthRedirectUri: () => "https://rhythm-fighter.test/api/playlists/owner/google/callback",
    now: () => clock,
  }));
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address() as { port: number }, base = `http://127.0.0.1:${address.port}/api/playlists`;
  const upload = (cookie?: string, body = mp3) => fetch(`${base}/upload`, { method: "POST",
    headers: { "Content-Type": "audio/mpeg", "X-Filename": "new.mp3", ...(cookie ? { Cookie: cookie } : {}) }, body });
  const start = async (claims?: Record<string, unknown>, key?: typeof ownerKey.privateKey) => {
    const response = await fetch(`${base}/owner/google?returnTo=%2F`, { redirect: "manual", headers: { "X-Forwarded-Proto": "https" } });
    assert.equal(response.status, 302);
    const location = new URL(response.headers.get("location")!);
    assert.equal(location.origin, "https://accounts.google.com");
    assert.equal(location.searchParams.get("client_id"), "test-google-client-id");
    assert.equal(location.searchParams.get("scope"), "openid email");
    assert.equal(location.searchParams.get("code_challenge_method"), "S256");
    assert.ok(location.searchParams.get("code_challenge"));
    assert.ok(!location.href.includes("test-google-client-secret"), "the client secret must never enter the browser redirect");
    const stateCookie = response.headers.getSetCookie().find(value => value.startsWith("audiostrike_google_state="))!;
    assert.match(stateCookie, /HttpOnly/i); assert.match(stateCookie, /Secure/i); assert.match(stateCookie, /SameSite=Lax/i);
    const code = `test-code-${tokens.size}`;
    tokens.set(code, { nonce: location.searchParams.get("nonce")!, claims, key });
    return { cookie: stateCookie.split(";", 1)[0], state: location.searchParams.get("state")!, code };
  };
  const callback = (flow: { cookie: string; state: string; code: string }, state = flow.state) => {
    const url = new URL(`${base}/owner/google/callback`);
    url.searchParams.set("code", flow.code); url.searchParams.set("state", state);
    return fetch(url, { redirect: "manual", headers: { Cookie: flow.cookie, "X-Forwarded-Proto": "https" } });
  };
  try {
    assert.equal((await (await fetch(`${base}/owner`)).json() as { owner: boolean; configured: boolean }).configured, true);
    assert.equal((await upload()).status, 403);
    assert.equal((await upload("audiostrike_owner=123.forged")).status, 403);
    assert.notEqual((await fetch(`${base}/owner`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "legacy-password" }) })).status, 200, "the former password login endpoint must be gone");

    const ownerFlow = await start();
    assert.equal((await callback(ownerFlow, `${ownerFlow.state.slice(0, -1)}x`)).status, 400, "a forged state must be rejected");
    const ownerLogin = await callback(ownerFlow);
    assert.equal(ownerLogin.status, 303);
    assert.equal(ownerLogin.headers.get("location"), "/?ownerSignIn=success");
    const ownerSetCookie = ownerLogin.headers.getSetCookie().find(value => value.startsWith("audiostrike_owner="))!;
    assert.match(ownerSetCookie, /HttpOnly/i); assert.match(ownerSetCookie, /Secure/i);
    assert.match(ownerSetCookie, /SameSite=Strict/i); assert.match(ownerSetCookie, /Max-Age=28800/i);
    assert.match(ownerSetCookie, /Path=\/api\/playlists/i);
    const ownerCookie = ownerSetCookie.split(";", 1)[0];
    assert.equal((await (await fetch(`${base}/owner`, { headers: { Cookie: ownerCookie } })).json() as { owner: boolean }).owner, true);
    const uploaded = await upload(ownerCookie);
    assert.equal(uploaded.status, 201);
    assert.equal((await uploaded.json() as { title: string }).title, "new.mp3");
    assert.equal((await upload(ownerCookie, Buffer.from("not mp3"))).status, 422);
    const crossOrigin = await fetch(`${base}/upload`, { method: "POST", headers: {
      Cookie: ownerCookie, Origin: "https://evil.test", "Content-Type": "audio/mpeg",
    }, body: mp3 });
    assert.equal(crossOrigin.status, 403);

    for (const [claims, key] of [
      [{ email: "someone-else@gmail.com" }, undefined],
      [{ email_verified: false }, undefined],
      [{}, attackerKey.privateKey],
      [{ nonce: "not-the-issued-nonce" }, undefined],
    ] as const) {
      const flow = await start(claims, key);
      const rejected = await callback(flow);
      assert.equal(rejected.status, 303);
      assert.equal(rejected.headers.get("location"), "/?ownerSignIn=denied");
      const forbiddenCookie = rejected.headers.getSetCookie().find(value => value.startsWith("audiostrike_owner="));
      assert.equal(forbiddenCookie, undefined);
    }
    assert.equal((await upload()).status, 403, "rejected Google identities must not obtain a session usable by direct API requests");

    const logout = await fetch(`${base}/owner`, { method: "DELETE", headers: {
      Cookie: ownerCookie, Origin: `http://127.0.0.1:${address.port}`,
    } });
    assert.equal(logout.status, 204);
    assert.ok(logout.headers.getSetCookie().some(value => value.startsWith("audiostrike_owner=") &&
      /Expires=Thu, 01 Jan 1970 00:00:00 GMT/i.test(value)));

    assert.equal((await fetch(`${base}/library`)).status, 200);
    const saved = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Public", trackIds: ["A"] }) });
    assert.equal(saved.status, 201);
    const id = (await saved.json() as { id: string }).id;
    assert.equal((await fetch(`${base}/${id}`)).status, 200);
    assert.equal((await fetch(`${base}/audio/A`)).status, 200);

    const limitedApp = express();
    limitedApp.use("/api", createPlaylistRouter(drive.library, {
      oauthFetch, oauthRedirectUri: () => "https://rhythm-fighter.test/api/playlists/owner/google/callback",
    }));
    const limitedServer = limitedApp.listen(0);
    await new Promise<void>(resolve => limitedServer.once("listening", resolve));
    try {
      const limitedBase = `http://127.0.0.1:${(limitedServer.address() as { port: number }).port}/api/playlists`;
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) statuses.push((await fetch(`${limitedBase}/owner/google?returnTo=%2F`, { redirect: "manual" })).status);
      assert.equal(statuses.filter(status => status === 302).length, 5);
      assert.equal(statuses[5], 429, "Google sign-in start preserves the five-per-minute limit");
    } finally {
      limitedServer.closeAllConnections();
      await new Promise<void>(resolve => limitedServer.close(() => resolve()));
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const key of envKeys) {
      const value = previousEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});