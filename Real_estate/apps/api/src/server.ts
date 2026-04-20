import Fastify from "fastify";
import cors from "@fastify/cors";
import analyzeRoute from "./routes/analyze.js";
import fromUrlRoute from "./routes/from-url.js";

export function buildServer() {
  const app = Fastify({
    logger: {
      transport: {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "HH:MM:ss" },
      },
    },
  });

  app.register(cors, { origin: true });

  app.get("/health", async () => ({ status: "ok" }));

  app.register(analyzeRoute);
  app.register(fromUrlRoute);

  return app;
}
