// Terminates TLS in front of the app, as Traefik does in production, so the
// Secure session cookie works in every browser. WebKit drops Secure cookies
// on plain http://localhost. The certificate is self-signed for localhost
// and made fresh in a temp directory at each start.
//
// Usage: node e2e/tls-proxy.mts <https port> <app port>
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [listenPort, appPort] = process.argv.slice(2).map(Number);
const dir = mkdtempSync(join(tmpdir(), "e2e-tls-"));
const [key, cert] = [join(dir, "key.pem"), join(dir, "cert.pem")];
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost",
    "-keyout",
    key,
    "-out",
    cert,
  ],
  { stdio: "ignore" },
);

createServer(
  { key: readFileSync(key), cert: readFileSync(cert) },
  (req, res) => {
    // Host passes through unchanged. No X-Forwarded-For: the app would take
    // it as the client IP, and every browser here shares one.
    const upstream = request(
      {
        port: appPort,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, "x-forwarded-proto": "https" },
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.on("error", () => res.writeHead(502).end());
    req.pipe(upstream);
  },
).listen(listenPort, () =>
  console.log(`https://localhost:${listenPort} -> http://localhost:${appPort}`),
);
