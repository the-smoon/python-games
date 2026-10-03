import app from "./app";
import { logger } from "./lib/logger";
import { shutdownPlaylists } from "./lib/playlistJobs";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close();
    void shutdownPlaylists().finally(() => process.exit(0));
  });
}
