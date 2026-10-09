import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import express, { type ErrorRequestHandler } from "express";
process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:1/run_score_tests";
const { createRunScoresRouter } = await import("../src/routes/run-scores");

type ScoreInput = {
  runId: string;
  name: string;
  score: number;
  levelReached: number;
  bossLevelReached: number | null;
  playlistMetadata: {
    playlistName: string;
    intendedTrackOrder: { trackId: string; title: string }[];
    tracksPlayed: { trackId: string; title: string; startSeconds: number; endSeconds: number }[];
  };
};

function memoryStore() {
  const rows = new Map<string, {
    id: number;
    runId: string;
    name: string;
    score: number;
    levelReached: number;
    bossLevelReached: number | null;
    playlistMetadata: ScoreInput["playlistMetadata"];
    createdAt: Date;
  }>();
  let writes = 0;
  return {
    rows,
    get writes() { return writes; },
    save: async (input: ScoreInput) => {
      const existing = rows.get(input.runId);
      if (existing) return { row: existing, created: false };
      const row = { id: rows.size + 1, ...input, createdAt: new Date("2026-10-04T12:00:00.000Z") };
      rows.set(input.runId, row);
      writes += 1;
      return { row, created: true };
    },
  };
}

async function withApi(save: ReturnType<typeof memoryStore>["save"], run: (baseUrl: string) => Promise<void>) {
  const app = express();
  app.post("/run-scores", express.json({ limit: "80kb" }));
  app.use(express.json({ limit: "4kb" }));
  app.use(createRunScoresRouter(save));
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    res.status(error.status ?? 500).json({ error: "Invalid request body" });
  };
  app.use(errors);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

function input(runId: string, overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    runId,
    name: "NEON PILOT",
    score: 7654321,
    levelReached: 5,
    bossLevelReached: 4,
    playlistMetadata: {
      playlistName: "Arcade set",
      intendedTrackOrder: [
        { trackId: "track-a", title: "Stage song" },
        { trackId: "track-b", title: "Boss song" },
      ],
      tracksPlayed: [{ trackId: "track-a", title: "Stage song", startSeconds: 0, endSeconds: 30 }],
    },
    ...overrides,
  };
}

async function send(baseUrl: string, body: unknown, origin = baseUrl) {
  const response = await fetch(`${baseUrl}/run-scores`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() as Record<string, unknown> };
}

test("saves a run once and returns the original score for duplicate run IDs", async () => {
  const store = memoryStore();
  const runId = "c6d3a9b1-fd22-4f12-89b3-2a5b63917c00";
  await withApi(store.save, async baseUrl => {
    const first = await send(baseUrl, input(runId));
    assert.equal(first.response.status, 201);
    assert.equal(first.body.name, "NEON PILOT");
    assert.equal(first.body.levelReached, 5);
    assert.equal(first.body.bossLevelReached, 4);
    assert.deepEqual(first.body.playlistMetadata, input(runId).playlistMetadata);

    const duplicate = await send(baseUrl, input(runId, { name: "CHANGED NAME", score: 1 }));
    assert.equal(duplicate.response.status, 200);
    assert.equal(duplicate.body.id, first.body.id);
    assert.equal(duplicate.body.name, first.body.name);
    assert.equal(duplicate.body.score, first.body.score);
    assert.equal(duplicate.body.createdAt, first.body.createdAt);
    assert.equal(store.rows.size, 1);
    assert.equal(store.writes, 1);
  });
});

test("rejects cross-origin, invalid scores, and invalid display names before saving", async () => {
  const store = memoryStore();
  const runId = "85db6e2a-1b7b-4b12-8a8e-2d52e3d82a40";
  await withApi(store.save, async baseUrl => {
    assert.equal((await send(baseUrl, input(runId), "https://attacker.invalid")).response.status, 403);
    assert.equal((await send(baseUrl, input(runId, { score: -1 }))).response.status, 400);
    assert.equal((await send(baseUrl, input(runId, { name: "N".repeat(25) }))).response.status, 400);
    assert.equal((await send(baseUrl, input(runId, { name: "BAD\u0000NAME" }))).response.status, 400);
    assert.equal(store.writes, 0);
  });
});

test("rejects inconsistent playlist clips and tracks not in the intended order", async () => {
  const store = memoryStore();
  const runId = "c4f2e6a1-9b74-4c20-8fd3-50a123456789";
  await withApi(store.save, async baseUrl => {
    const reversed = input(runId, {
      playlistMetadata: {
        playlistName: "Broken",
        intendedTrackOrder: [{ trackId: "track-a", title: "Stage song" }],
        tracksPlayed: [{ trackId: "track-a", title: "Stage song", startSeconds: 20, endSeconds: 10 }],
      },
    });
    const notInOrder = input(runId, {
      playlistMetadata: {
        playlistName: "Broken",
        intendedTrackOrder: [{ trackId: "track-a", title: "Stage song" }],
        tracksPlayed: [{ trackId: "track-b", title: "Not in order", startSeconds: 0, endSeconds: 10 }],
      },
    });
    const zeroLength = input(runId, {
      playlistMetadata: {
        playlistName: "Broken",
        intendedTrackOrder: [{ trackId: "track-a", title: "Stage song" }],
        tracksPlayed: [{ trackId: "track-a", title: "Stage song", startSeconds: 10, endSeconds: 10 }],
      },
    });
    const tooLongClip = input(runId, {
      playlistMetadata: {
        playlistName: "Broken",
        intendedTrackOrder: [{ trackId: "track-a", title: "Stage song" }],
        tracksPlayed: [{ trackId: "track-a", title: "Stage song", startSeconds: 0, endSeconds: 721 }],
      },
    });
    assert.equal((await send(baseUrl, reversed)).response.status, 400);
    assert.equal((await send(baseUrl, notInOrder)).response.status, 400);
    assert.equal((await send(baseUrl, zeroLength)).response.status, 400);
    assert.equal((await send(baseUrl, tooLongClip)).response.status, 400);
    assert.equal(store.writes, 0);
  });
});

test("accepts metadata at its field and collection limits and persists the full shape", async () => {
  const store = memoryStore();
  const runId = "3d12e8a0-ec4d-4f50-8ef1-2ab3c4d5e6f7";
  const tracks = Array.from({ length: 20 }, (_, index) => ({
    trackId: `${String(index).padStart(2, "0")}-${"a".repeat(197)}`,
    title: "中".repeat(255),
  }));
  const playlistMetadata = {
    playlistName: "P".repeat(80),
    intendedTrackOrder: tracks,
    tracksPlayed: tracks.map((track) => ({ ...track, startSeconds: 0, endSeconds: 720 })),
  };
  const score = input(runId, { playlistMetadata });
  assert.ok(Buffer.byteLength(JSON.stringify(score)) > 4 * 1024,
    "the valid maximum metadata payload exceeds the standard JSON request limit");

  await withApi(store.save, async (baseUrl) => {
    const response = await send(baseUrl, score);
    assert.equal(response.response.status, 201);
    assert.deepEqual(response.body.playlistMetadata, playlistMetadata);
    assert.deepEqual(store.rows.get(runId)?.playlistMetadata, playlistMetadata);
    assert.equal(store.writes, 1);
  });
});

test("rejects oversized metadata fields, collections, and unknown properties", async () => {
  const store = memoryStore();
  const runId = "c4f2e6a1-9b74-4c20-8fd3-50a123456789";
  const base = input(runId);
  const oversizedName = input(runId, {
    playlistMetadata: { ...base.playlistMetadata, playlistName: "P".repeat(81) },
  });
  const emptyOrder = input(runId, {
    playlistMetadata: { ...base.playlistMetadata, intendedTrackOrder: [] },
  });
  const tooManyTracks = input(runId, {
    playlistMetadata: {
      ...base.playlistMetadata,
      intendedTrackOrder: Array.from({ length: 21 }, (_, index) => ({
        trackId: `track-${index}`,
        title: "Track",
      })),
    },
  });
  const oversizedTitle = input(runId, {
    playlistMetadata: {
      ...base.playlistMetadata,
      intendedTrackOrder: [{ trackId: "track-a", title: "T".repeat(256) }],
    },
  });
  const oversizedId = input(runId, {
    playlistMetadata: {
      ...base.playlistMetadata,
      intendedTrackOrder: [{ trackId: "a".repeat(201), title: "Track" }],
    },
  });
  const metadataWithExtra = {
    ...base.playlistMetadata,
    unexpected: "not allowed",
  };
  const trackWithExtra = {
    ...base.playlistMetadata.intendedTrackOrder[0],
    unexpected: "not allowed",
  };
  const extraMetadataField = { ...base, playlistMetadata: metadataWithExtra };
  const extraTrackField = {
    ...base,
    playlistMetadata: { ...base.playlistMetadata, intendedTrackOrder: [trackWithExtra] },
  };
  const extraTopLevelField = { ...base, unexpected: "not allowed" };

  await withApi(store.save, async (baseUrl) => {
    for (const body of [oversizedName, emptyOrder, tooManyTracks, oversizedTitle, oversizedId]) {
      assert.equal((await send(baseUrl, body)).response.status, 400);
    }
    assert.equal(store.writes, 0);
  });

  await withApi(store.save, async (baseUrl) => {
    for (const body of [extraMetadataField, extraTrackField, extraTopLevelField]) {
      assert.equal((await send(baseUrl, body)).response.status, 400);
    }
    assert.equal(store.writes, 0);
  });
});

test("rejects JSON requests above the dedicated run-score body limit", async () => {
  const store = memoryStore();
  await withApi(store.save, async (baseUrl) => {
    const runId = "d1e2f3a4-b5c6-4d7e-8f90-a1b2c3d4e5f6";
    const body = input(runId, {
      playlistMetadata: {
        ...input(runId).playlistMetadata,
        playlistName: "P".repeat(81 * 1024),
      },
    });
    assert.equal((await send(baseUrl, body)).response.status, 413);
    assert.equal(store.writes, 0);
  });
});

test("limits submissions from one client and returns Retry-After", async () => {
  const store = memoryStore();
  await withApi(store.save, async baseUrl => {
    for (let index = 0; index < 5; index += 1) {
      const id = `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
      assert.equal((await send(baseUrl, input(id))).response.status, 201);
    }
    const sixth = await send(baseUrl, input("00000000-0000-4000-8000-000000000005"));
    assert.equal(sixth.response.status, 429);
    assert.equal(sixth.response.headers.get("retry-after"), "60");
    assert.equal(store.writes, 5);
  });
});