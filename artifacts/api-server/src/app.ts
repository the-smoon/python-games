import express, { type Express, type ErrorRequestHandler } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "4kb" }));
app.use(express.urlencoded({ extended: true, limit: "4kb" }));

app.use("/api", router);

const errors: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) { next(error); return; }
  const status = error.status === 413 ? 413 : error.status === 400 ? 400 : 500;
  if (status === 500) req.log.error("Unhandled API request error");
  res.status(status).json({ error: status === 413 ? "Request body exceeds 4 KB"
    : status === 400 ? "Invalid request body" : "The request could not be completed" });
};
app.use(errors);

export default app;
