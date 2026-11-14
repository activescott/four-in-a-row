import { createRequestHandler } from "@react-router/express";
import express from "express";

const app = express();
app.disable("x-powered-by");
// Traefik terminates TLS one hop in front of the pod. Trusting that hop makes
// request.url carry its X-Forwarded-Proto and X-Forwarded-Host, so the auth
// Origin gate compares https with https.
app.set("trust proxy", 1);

app.use(
  "/assets",
  express.static("build/client/assets", { immutable: true, maxAge: "1y" }),
);
app.use(express.static("build/client", { maxAge: "1h" }));
app.all(
  "/{*splat}",
  createRequestHandler({ build: await import("./build/server/index.js") }),
);

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`listening on port ${port}`));
