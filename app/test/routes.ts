// Calls a route loader or action the way React Router would, returning a
// thrown Response (a redirect from requireAuth, say) instead of rethrowing it.
export async function run<T>(
  handler: (args: never) => T | Promise<T>,
  request: Request,
  params: Record<string, string> = {},
): Promise<T | Response> {
  try {
    return await handler({ request, params, context: {} } as never);
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    throw thrown;
  }
}

export const ORIGIN = "http://localhost";

// A document form post from a page on this app, as a browser sends it.
export function formPost(
  path: string,
  fields: Record<string, string>,
  { cookie = "", referer }: { cookie?: string; referer?: string } = {},
) {
  return new Request(new URL(path, ORIGIN), {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
      cookie,
      ...(referer && { referer: new URL(referer, ORIGIN).toString() }),
    },
    body: new URLSearchParams(fields),
  });
}

export function get(path: string, headers: Record<string, string> = {}) {
  return new Request(new URL(path, ORIGIN), { headers });
}

export function jsonPost(path: string, body: unknown, cookie = "") {
  return new Request(new URL(path, ORIGIN), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

// Captures JSON log lines from a logger built with createLogger(destination).
export function logCapture() {
  const lines: Record<string, unknown>[] = [];
  return {
    lines,
    destination: { write: (line: string) => lines.push(JSON.parse(line)) },
    events: (event: string) => lines.filter((line) => line.event === event),
  };
}
