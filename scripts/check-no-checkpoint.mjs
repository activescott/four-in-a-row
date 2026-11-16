// Fails if the Prisma CLI calls checkpoint.prisma.io (its telemetry/version check).
// Runs the given command (default: `npx prisma generate`) with CHECKPOINT_DISABLE
// unset, behind a local proxy that logs and refuses every CONNECT/HTTP request.
import { spawn } from "node:child_process";
import http from "node:http";

const cmd = process.argv.slice(2);
if (cmd.length === 0) cmd.push("npx", "prisma", "generate");

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

const child = spawn(cmd[0], cmd.slice(1), { env, stdio: "inherit" });
const code = await new Promise((resolve) => child.on("close", resolve));
// Give a detached child a moment to finish a late request.
await new Promise((resolve) => setTimeout(resolve, 1000));
proxy.close();
proxy.closeAllConnections();

console.log(
  `\nproxy saw: ${hosts.length ? [...new Set(hosts)].join(", ") : "(nothing)"}`,
);
if (hosts.some((h) => /checkpoint\.prisma\.io/.test(h))) {
  console.error(`FAIL: \`${cmd.join(" ")}\` contacted checkpoint.prisma.io`);
  process.exit(1);
}
if (code !== 0) {
  console.error(`FAIL: \`${cmd.join(" ")}\` exited ${code}`);
  process.exit(code ?? 1);
}
console.log("ok: checkpoint.prisma.io was not contacted");
