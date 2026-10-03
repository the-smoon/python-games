import assert from "node:assert/strict";
import { once, EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, writeFile, rm, symlink, truncate, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { playlistUrl, validateManifest, MAX_TRACK_BYTES } from "../src/lib/playlistManifest";
import { createJob, inspectOutput, jobResponse, removeJob, shutdownPlaylists } from "../src/lib/playlistJobs";
import app from "../src/app";
import { playlistRateLimit } from "../src/routes/playlists";
import type { Request, Response } from "express";

test.after(shutdownPlaylists);
const manifest = { version: 1 as const, skipped: 0, tracks: [
  { file: "0002.mp3", title: "Second first" }, { file: "0001.mp3", title: "First second" },
] };
test("validates and canonicalizes supported URLs without accepting arbitrary hosts", () => {
  assert.equal(playlistUrl("https://www.youtube.com/playlist?list=PL_Test&foo=bar"), "https://music.youtube.com/playlist?list=PL_Test");
  for (const url of ["http://music.youtube.com/playlist?list=x", "https://music.youtube.com.evil.test/playlist?list=x",
    "https://localhost/playlist?list=x", "https://user@music.youtube.com/playlist?list=x",
    "https://music.youtube.com:8080/playlist?list=x", "https://music.youtube.com/watch?v=x",
    "https://music.youtube.com/playlist?list=../../file", "; touch /tmp/x", null]) assert.throws(() => playlistUrl(url));
});
test("manifest order is retained and paths/counts/titles are strictly validated", () => {
  assert.deepEqual(validateManifest(manifest), manifest);
  for (const file of ["../0001.mp3", "/etc/passwd", "https://evil.test/a.mp3", "a.mp3"]) {
    assert.throws(() => validateManifest({ ...manifest, tracks: [{ file, title: "A" }] }));
  }
  assert.throws(() => validateManifest({ ...manifest, tracks: [] }));
  assert.throws(() => validateManifest({ ...manifest, tracks: Array(21).fill(manifest.tracks[0]) }));
  assert.throws(() => validateManifest({ ...manifest, tracks: Array(2).fill(manifest.tracks[0]) }));
});
test("download output rejects symlinks, missing files, per-track and total oversize", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "playlist-validation-"));
  try {
    for (const track of manifest.tracks) await writeFile(path.join(dir, track.file), "mp3");
    assert.deepEqual(await inspectOutput(dir, manifest), manifest);
    await rm(path.join(dir, "0001.mp3"));
    await symlink(path.join(dir, "0002.mp3"), path.join(dir, "0001.mp3"));
    await assert.rejects(inspectOutput(dir, manifest), /unsafe/);
    await rm(path.join(dir, "0001.mp3"));
    await assert.rejects(inspectOutput(dir, manifest));
    await truncate(path.join(dir, "0002.mp3"), MAX_TRACK_BYTES + 1);
    await assert.rejects(inspectOutput(dir, { ...manifest, tracks: [manifest.tracks[0]] }), /24 MB/);
    const tracks = [];
    for (let index = 1; index <= 9; index++) {
      const file = `${String(index).padStart(4, "0")}.mp3`;
      await writeFile(path.join(dir, file), "");
      await truncate(path.join(dir, file), MAX_TRACK_BYTES);
      tracks.push({ file, title: "A" });
    }
    await assert.rejects(inspectOutput(dir, { version: 1, skipped: 0, tracks }), /192 MB/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
function fakeProcess() {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
  const calls: unknown[][] = [];
  const spawnProcess = (...args: unknown[]) => { calls.push(args); return child; };
  return { child, calls, spawnProcess: spawnProcess as unknown as NonNullable<Parameters<typeof createJob>[1]>["spawnProcess"] };
}
async function waitState(job: Awaited<ReturnType<typeof createJob>>, state: string) {
  for (let i = 0; i < 100 && job.state !== state; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(job.state, state);
}
test("safe argv, progress, ordered manifest, and explicit cleanup", async () => {
  const fake = fakeProcess();
  const job = await createJob("https://music.youtube.com/playlist?list=PL_Test", fake);
  try {
    assert.equal(fake.calls[0][0], "python");
    assert.equal((fake.calls[0][2] as { shell: boolean }).shell, false);
    assert.ok((fake.calls[0][1] as string[]).includes("--game-manifest"));
    fake.child.stdout.write(JSON.stringify({ message: "Downloading 1/2", completed: 0, total: 2 }) + "\n");
    assert.equal(jobResponse(job).total, 2);
    for (const track of manifest.tracks) await writeFile(path.join(job.dir, track.file), "mp3");
    await writeFile(path.join(job.dir, "manifest.json"), JSON.stringify(manifest));
    fake.child.emit("close", 0);
    await waitState(job, "ready");
    assert.deepEqual(jobResponse(job).manifest?.tracks.map((track) => track.title), ["Second first", "First second"]);
  } finally { await removeJob(job.id); }
  await assert.rejects(stat(job.dir), { code: "ENOENT" });
});
test("download errors, timeout, excessive output, corrupt manifest and cancellation remove files", async () => {
  for (const mode of ["exit", "timeout", "output", "manifest", "cancel"]) {
    const fake = fakeProcess();
    const job = await createJob("https://music.youtube.com/playlist?list=PL_Test", { ...fake, timeoutMs: mode === "timeout" ? 10 : 10000 });
    if (mode === "exit") { fake.child.stderr.write("Missing required dependencies"); fake.child.emit("close", 1); }
    if (mode === "output") fake.child.stdout.write("x".repeat(128 * 1024 + 1));
    if (mode === "manifest") {
      await writeFile(path.join(job.dir, "manifest.json"), '{"tracks":[]}');
      fake.child.emit("close", 0);
    }
    if (mode === "cancel") await removeJob(job.id);
    else { await waitState(job, "error"); await removeJob(job.id); }
    await assert.rejects(stat(job.dir), { code: "ENOENT" });
  }
});
test("global concurrency admits two downloads and rejects a third", async () => {
  const one = await createJob("https://music.youtube.com/playlist?list=A", fakeProcess());
  const two = await createJob("https://music.youtube.com/playlist?list=B", fakeProcess());
  try { await assert.rejects(createJob("https://music.youtube.com/playlist?list=C", fakeProcess()), /busy/); }
  finally { await removeJob(one.id); await removeJob(two.id); }
});
test("expired rate-limit clients release capacity for new players", (context) => {
  let now = Date.now() - 31 * 60_000;
  context.mock.method(Date, "now", () => now);
  const request = (ip: string) => {
    let admitted = false, status = 200;
    const res = {
      status(code: number) { status = code; return res; },
      json() { return res; },
      setHeader() {},
    };
    playlistRateLimit({ ip, method: "GET" } as Request, res as unknown as Response, () => { admitted = true; });
    return { admitted, status };
  };
  for (let index = 0; index < 1000; index++) {
    assert.equal(request(`capacity-test-${index}`).admitted, true);
  }
  assert.deepEqual(request("new-player"), { admitted: false, status: 429 }, "unexpired capacity is bounded");
  now += 30 * 60_000 + 1;
  assert.deepEqual(request("new-player"), { admitted: true, status: 200 }, "expired entries release slots at exactly 1000 clients");
  assert.equal(request("another-new-player").admitted, true);
});
test("API rejects invalid URLs, unknown jobs, arbitrary track paths and oversized bodies", async () => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  try {
    const response = await fetch(`${base}/playlists`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: "https://evil.test/playlist?list=x" }) });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /public/);
    assert.equal((await fetch(`${base}/playlists/unknown`)).status, 404);
    assert.equal((await fetch(`${base}/playlists/11111111-1111-4111-8111-111111111111/tracks/etc`)).status, 404);
    const oversized = await fetch(`${base}/playlists`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: "x".repeat(6000) }) });
    assert.equal(oversized.status, 413);
    assert.match((await oversized.json()).error, /4 KB/);
    // Full API success and MP3 retrieval with the supplied runner's validated output.
    const fake = fakeProcess();
    const job = await createJob("https://music.youtube.com/playlist?list=A", fake);
    await writeFile(path.join(job.dir, "0001.mp3"), "mp3");
    await writeFile(path.join(job.dir, "manifest.json"), JSON.stringify({ version: 1, skipped: 0, tracks: [{ file: "0001.mp3", title: "A" }] }));
    fake.child.emit("close", 0);
    await waitState(job, "ready");
    assert.equal((await fetch(`${base}/playlists/${job.id}`)).status, 200);
    const audio = await fetch(`${base}/playlists/${job.id}/tracks/0`);
    assert.match(audio.headers.get("content-type")!, /audio\/mpeg/);
    assert.equal(await audio.text(), "mp3");
    assert.equal((await fetch(`${base}/playlists/${job.id}`, { method: "DELETE" })).status, 204);
    assert.equal((await fetch(`${base}/playlists/${job.id}`)).status, 404);
    let rateLimited = false;
    for (let index = 0; index < 121; index++) {
      const response = await fetch(`${base}/playlists/unknown`);
      if (response.status === 429) {
        assert.equal(response.headers.get("retry-after"), "60");
        rateLimited = true; break;
      }
    }
    assert.equal(rateLimited, true, "polling is rate limited");
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});