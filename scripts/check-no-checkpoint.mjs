// Fails if the Prisma CLI calls checkpoint.prisma.io (its telemetry/version check).
// Runs the given command (default: every Prisma entry point the repo documents,
// see DEFAULTS) with CHECKPOINT_DISABLE unset, behind a local proxy that logs and
// refuses every CONNECT/HTTP request.
import { spawn } from "node:child_process";
import http from "node:http";

// `npm run prisma` is the documented way to run the CLI: npm runs it from the
// repo root whatever the cwd, so it must stay quiet even from a subdirectory.
const DEFAULTS = [
  ["npx", "prisma", "generate"],
  ["npx", "prisma", "validate"],
  ["npx", "prisma", "version"],
  ["npm", "run", "prisma", "--", "version"],
  ["sh", "-c", "cd app && npm run prisma -- validate"],
  // The same without prisma.config.mts, so only the npm script can set the env.
  [
    "npm",
    "run",
    "prisma",
    "--",
    "validate",
    "--config",
    "scripts/no-env-prisma.config.mts",
  ],
];
const argv = process.argv.slice(2);
const commands = argv.length ? [argv] : DEFAULTS;

const hosts = [];
const proxy = http.createServer((req, res) => {
  hosts.push(req.headers.host ?? req.url);
  res.writeHead(403).end();
});
proxy.on("connect", (req, socket) => {
  hosts.push(req.url);
  socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
});
await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${proxy.address().port}`;

const env = { ...process.env };
delete env.CHECKPOINT_DISABLE;
for (const k of ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"])
  env[k] = url;
env.NO_PROXY = env.no_proxy = "";
env.NODE_USE_ENV_PROXY = "1";

const TIMEOUT_MS = 120_000;

// Runs a command with the proxy env; resolves { code, signal, timedOut }.
async function run(argv) {
  // detached: own process group, so a timeout can kill npx's grandchildren too.
  const child = spawn(argv[0], argv.slice(1), {
    env,
    stdio: "inherit",
    detached: true,
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }, TIMEOUT_MS);
  const result = await new Promise((resolve) =>
    child.on("close", (code, signal) => resolve({ code, signal })),
  );
  clearTimeout(timer);
  return { ...result, timedOut };
}

// Canary: a request that must reach the proxy. If a Node change makes it ignore
// NODE_USE_ENV_PROXY, the check would pass vacuously, so fail instead.
const CANARY_HOST = "canary.invalid";
await run([
  process.execPath,
  "-e",
  `fetch("https://${CANARY_HOST}/").catch(() => {})`,
]);
if (!hosts.some((h) => h.includes(CANARY_HOST))) {
  console.error(
    "FAIL: canary request did not go through the proxy; NODE_USE_ENV_PROXY may no longer be honored, so this check cannot detect anything",
  );
  process.exit(1);
}

let failed = false;
for (const cmd of commands) {
  console.log(`\n$ ${cmd.join(" ")}`);
  const { code, signal, timedOut } = await run(cmd);
  // Give a detached child a moment to finish a late request.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const seen = hosts.splice(0);
  console.log(
    `proxy saw: ${seen.length ? [...new Set(seen)].join(", ") : "(nothing)"}`,
  );
  const problem = seen.some((h) => /checkpoint\.prisma\.io/.test(h))
    ? "contacted checkpoint.prisma.io"
    : timedOut
      ? `timed out after ${TIMEOUT_MS / 1000}s and was killed`
      : signal
        ? `was killed by ${signal}`
        : code !== 0
          ? `exited ${code}`
          : null;
  if (problem) {
    console.error(`FAIL: \`${cmd.join(" ")}\` ${problem}`);
    failed = true;
  }
}
proxy.close();
proxy.closeAllConnections();
if (failed) process.exit(1);
console.log("ok: checkpoint.prisma.io was not contacted");
