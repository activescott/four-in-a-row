import { handleAuth } from "../auth.server";
import type { Route } from "./+types/auth.$provider.$action";

// The magic link's host comes from the request (Host, or X-Forwarded-Host
// behind Traefik), so a forged one would mail out a link to another site.
// Production requires APP_URL, so there only its host is served.
function serve(request: Request) {
  const appUrl = process.env.APP_URL;
  if (appUrl && new URL(request.url).host !== new URL(appUrl).host) {
    return new Response("Misdirected Request", { status: 421 });
  }
  return handleAuth({ request });
}

// Every /auth/:provider/:action endpoint: email initiate and verify (with the
// magic-link confirm page), and the passkey options and verify calls.
export const loader = ({ request }: Route.LoaderArgs) => serve(request);
export const action = ({ request }: Route.ActionArgs) => serve(request);
