import path from "node:path";
import { createRequestHandler } from "@react-router/express";
import express from "express";
import type { ServerBuild } from "react-router";

// Replaces react-router-serve, whose bare express() has no `trust proxy`.
// Traefik terminates TLS and forwards plain HTTP, so without it req.protocol
// is "http", request.url says http://, and the auth origin gate refuses every
// browser POST (Origin: https://...). Trust exactly one hop: the ingress.
export function createApp(build: ServerBuild) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  const assets = path.resolve(build.assetsBuildDirectory);
  app.use(
    "/assets",
    express.static(path.join(assets, "assets"), {
      immutable: true,
      maxAge: "1y",
    }),
  );
  app.use(express.static(assets));
  app.use(express.static("public", { maxAge: "1h" }));

  app.all("/{*splat}", createRequestHandler({ build }));
  return app;
}
