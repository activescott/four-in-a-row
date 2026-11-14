import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import type { ServerBuild } from "react-router";
import { afterAll, expect, test, vi } from "vitest";
import type { PrismaClient } from "./app/generated/prisma/client";
import { createPgliteDb } from "./app/pglite.server";

const { getDb } = vi.hoisted(() => ({
  getDb: vi.fn<() => Promise<PrismaClient>>(),
}));
vi.mock("./app/db.server", () => ({ getDb }));

// The auth module reads the database when it first loads.
const db = await createPgliteDb();
getDb.mockResolvedValue(db);

const authRoute = await import("./app/routes/auth.$provider.$action");
const { createApp } = await import("./server.mjs");

// Just enough of a server build to route /auth/:provider/:action through
// react-router, the way the production build does.
const build = {
  entry: { module: { default: () => new Response(null, { status: 500 }) } },
  routes: {
    root: { id: "root", path: "", module: {} },
    auth: {
      id: "auth",
      parentId: "root",
      path: "auth/:provider/:action",
      module: authRoute,
    },
  },
  assets: {
    entry: { imports: [], module: "" },
    routes: {},
    url: "",
    version: "test",
  },
  publicPath: "/",
  assetsBuildDirectory: "build/client",
  basename: "/",
  future: {},
  ssr: true,
  isSpaMode: false,
  prerender: [],
  routeDiscovery: { mode: "lazy", manifestPath: "/__manifest" },
} as unknown as ServerBuild;

const server = createApp(build).listen(0);
await new Promise((resolve) => server.once("listening", resolve));
const { port } = server.address() as AddressInfo;

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.$disconnect();
});

// Posts the login form over plain HTTP, as the TLS-terminating ingress
// forwards it: Host is the public host, Origin is the browser's https origin.
function postInitiate(headers: Record<string, string>) {
  const body = new URLSearchParams({ email: "seed@example.com" }).toString();
  return new Promise<{ status: number; location?: string }>(
    (resolve, reject) => {
      const req = httpRequest(
        {
          port,
          method: "POST",
          path: "/auth/email/initiate",
          headers: {
            host: "host",
            origin: "https://host",
            "content-type": "application/x-www-form-urlencoded",
            accept: "text/html",
            ...headers,
          },
        },
        (res) => {
          res.resume();
          resolve({ status: res.statusCode!, location: res.headers.location });
        },
      );
      req.on("error", reject);
      req.end(body);
    },
  );
}

test("a browser POST forwarded by the TLS-terminating ingress passes the origin gate", async () => {
  const response = await postInitiate({ "x-forwarded-proto": "https" });
  expect(response.status).toBe(302);
  expect(response.location).toContain("sent=1");
});

test("the origin gate still refuses an https Origin on a plain http request", async () => {
  const response = await postInitiate({});
  expect(response.status).toBe(400);
});
