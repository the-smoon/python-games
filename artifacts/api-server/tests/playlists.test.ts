import assert from "node:assert/strict";
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
test("owner upload requires signed cookie; invalid login, forged cookie and cross-origin blocked", async () => {
  process.env.AUDIOSTRIKE_OWNER_PASSWORD = "test-only-owner-password";
  process.env.SESSION_SECRET = "test-only-session-key";
  const drive = fakeDrive(), app = express();
  app.use(express.json({ limit: "4kb" }));
  app.use("/api", createPlaylistRouter(drive.library));
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address() as { port: number }, base = `http://127.0.0.1:${address.port}/api/playlists`;
  const upload = (cookie?: string, body = mp3) => fetch(`${base}/upload`, { method: "POST",
    headers: { "Content-Type": "audio/mpeg", "X-Filename": "new.mp3", ...(cookie ? { Cookie: cookie } : {}) }, body });
  try {
    assert.equal((await upload()).status, 403);
    assert.equal((await upload("audiostrike_owner=123.forged")).status, 403);
    const wrong = await fetch(`${base}/owner`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "wrong" }) });
    assert.equal(wrong.status, 401);
    const login = await fetch(`${base}/owner`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: process.env.AUDIOSTRIKE_OWNER_PASSWORD }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")!;
    assert.match(cookie, /^audiostrike_owner=/, "owner sessions must keep the established cookie name");
    assert.match(cookie, /HttpOnly/i); assert.match(cookie, /SameSite=Strict/i);
    const uploaded = await upload(cookie);
    assert.equal(uploaded.status, 201);
    assert.equal((await uploaded.json() as { title: string }).title, "new.mp3");
    assert.equal((await upload(cookie, Buffer.from("not mp3"))).status, 422);
    const crossOrigin = await fetch(`${base}/upload`, { method: "POST", headers: { Cookie: cookie, Origin: "https://evil.test", "Content-Type": "audio/mpeg" }, body: mp3 });
    assert.equal(crossOrigin.status, 403);
    const list = await fetch(`${base}/library`);
    assert.equal(list.status, 200);
    const saved = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Public", trackIds: ["A"] }) });
    assert.equal(saved.status, 201);
    const id = (await saved.json() as { id: string }).id;
    assert.equal((await fetch(`${base}/${id}`)).status, 200);
    assert.equal((await fetch(`${base}/audio/A`)).status, 200);
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await fetch(`${base}/owner`, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"password":"wrong"}' })).status);
    assert.ok(statuses.includes(429));
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});