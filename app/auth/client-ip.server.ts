import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The address the caller connected from, as the proxy in front saw it, or
 * null. Traefik appends the peer it saw to X-Forwarded-For, so everything
 * left of that hop, and cf-connecting-ip, is whatever the caller sent. The
 * auth library's own rate limits (`abuse.clientIp` in auth.server.ts) and the
 * email send limits both use this, so the two agree on who the client is.
 */
export function clientIp(request: Request): string | null {
  return (
    request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || null
  );
}

// The email transport is called deep inside the auth library and is never
// handed the request, so serveAuth() makes the client's address available to
// it for the length of the call.
const current = new AsyncLocalStorage<string | null>();

export function withClientIp<T>(ip: string | null, run: () => T): T {
  return current.run(ip, run);
}

export function currentClientIp(): string | null {
  return current.getStore() ?? null;
}

const HEXTETS = 8;
const PREFIX_HEXTETS = 4;

/**
 * The key a client's sends are counted under: the bare address, with an IPv6
 * address reduced to its /64 (one customer is usually handed a whole /64 and
 * could otherwise rotate through them), an IPv4-mapped one (dotted or hex) to its IPv4
 * address, and a missing one to a single shared "unknown" bucket.
 */
export function ipKey(ip: string | null): string {
  if (!ip) return "unknown";
  const bare = ip
    .trim()
    .toLowerCase()
    .replace(/^\[([^\]]+)\](:\d+)?$/, "$1")
    .replace(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/, "$1")
    .replace(/%.*$/, "");
  if (bare.startsWith("::ffff:") && bare.includes(".")) return bare.slice(7);
  if (!bare.includes(":")) return bare;
  const halves = bare.split("::");
  if (halves.length > 2) return bare;
  const [head = "", tail] = halves;
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const missing = HEXTETS - left.length - right.length;
  if (tail === undefined ? missing !== 0 : missing < 1) return bare;
  const hextets = [...left, ...Array<string>(missing).fill("0"), ...right];
  if (!hextets.every((h) => /^[0-9a-f]{1,4}$/.test(h))) return bare;
  // IPv4-mapped (::ffff:a.b.c.d) in hex form: ::ffff:102:304 is 1.2.3.4.
  const values = hextets.map((h) => parseInt(h, 16));
  if (values.slice(0, 5).every((v) => v === 0) && values[5] === 0xffff) {
    const [hi = 0, lo = 0] = values.slice(6);
    return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join(".");
  }
  const prefix = hextets
    .slice(0, PREFIX_HEXTETS)
    .map((h) => parseInt(h, 16).toString(16));
  return `${prefix.join(":")}::/64`;
}
