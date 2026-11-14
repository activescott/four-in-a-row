import type { ServerBuild } from "react-router";
import { createApp } from "./app.ts";

process.env.NODE_ENV ??= "production";

const buildPath = new URL("../build/server/index.js", import.meta.url).href;
const build = (await import(buildPath)) as ServerBuild;
const port = Number(process.env.PORT ?? 3000);

const server = createApp(build).listen(
  port,
  process.env.HOST ?? "0.0.0.0",
  () => console.log(`server listening on port ${port}`),
);

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => server.close());
}
